/**
 * Server-side routing-network extraction: pulls the `net_junction` and
 * `net_path` layers out of a staged network `.gdb.zip` as WGS84 RFC7946
 * GeoJSON text, plus the node/edge/floor summary shown in the import review
 * dialog.
 *
 * The boundary rule from the route-slice design applies: GDAL stays in
 * TypeScript and the server never interprets the network — parsing the
 * GeoJSON into a graph, floor mapping, and A* all live in the Rust
 * `kiriko-route` crate at compile time. This module only moves bytes through
 * gdal3.js and counts features for the summary.
 */
import { asArray, asRecord, asString, openGdbZip } from "./convert";
import { getGdal, serializeGdalOperation, type GdalInstance } from "./gdal";
import { GDB_MAX_GENERATED_BYTES, GdbSourceError } from "./sourceValidation";
import type { NetworkExtraction } from "./types";

export const NETWORK_JUNCTION_LAYER = "net_junction";
export const NETWORK_PATH_LAYER = "net_path";

const NETWORK_LAYERS = [NETWORK_JUNCTION_LAYER, NETWORK_PATH_LAYER] as const;

/** Convert one OGR layer to WGS84 RFC7946 GeoJSON text via `ogr2ogr`. */
async function extractLayerGeoJson(
  gdal: GdalInstance,
  dataset: unknown,
  layerName: string,
  outputName: string,
): Promise<string> {
  const output = await gdal.ogr2ogr(
    dataset,
    [
      "-f", "GeoJSON",
      "-t_srs", "EPSG:4326",
      "-lco", "RFC7946=YES",
      "-nlt", "CONVERT_TO_LINEAR",
      "-dim", "XY",
      layerName,
    ],
    outputName,
  );
  const bytes = await gdal.getFileBytes(output);
  return new TextDecoder().decode(bytes);
}

/** Count features and collect distinct `FLOOR` property values from a converted layer. */
function summarizeLayer(geojson: string, layerName: string): {
  featureCount: number;
  floors: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(geojson);
  } catch {
    throw new Error(`Layer "${layerName}" did not convert to GeoJSON.`);
  }
  const record = asRecord(parsed);
  if (asString(record.type) !== "FeatureCollection") {
    throw new Error(`Layer "${layerName}" did not convert to a FeatureCollection.`);
  }
  const features = asArray(record.features);
  const floors: string[] = [];
  for (const feature of features) {
    const floor = asRecord(asRecord(feature).properties)["FLOOR"];
    if (typeof floor === "string" && floor.trim().length > 0) {
      floors.push(floor);
    }
  }
  return { featureCount: features.length, floors };
}

async function extractNetworkGeoJsonUnlocked(path: string): Promise<NetworkExtraction> {
  const gdal = await getGdal();
  const dataset = await openGdbZip(gdal, path);
  try {
    const info = asRecord(await gdal.ogrinfo(dataset, ["-so", "-al"]));
    const layerNames = new Set(
      asArray(info.layers).map((layer) => asString(asRecord(layer).name)),
    );
    const missing = NETWORK_LAYERS.filter((name) => !layerNames.has(name));
    if (missing.length > 0) {
      throw new GdbSourceError(
        "missing_network_layers",
        "Archive is missing the routing network layers (net_junction, net_path).",
        { missing },
      );
    }

    const junctions = await extractLayerGeoJson(
      gdal,
      dataset,
      NETWORK_JUNCTION_LAYER,
      "network_net_junction",
    );
    const paths = await extractLayerGeoJson(gdal, dataset, NETWORK_PATH_LAYER, "network_net_path");
    const generatedBytes =
      Buffer.byteLength(junctions, "utf8") + Buffer.byteLength(paths, "utf8");
    if (generatedBytes > GDB_MAX_GENERATED_BYTES) {
      throw new Error(
        `Network extraction exceeded the ${GDB_MAX_GENERATED_BYTES}-byte output cap.`,
      );
    }

    const junctionSummary = summarizeLayer(junctions, NETWORK_JUNCTION_LAYER);
    const pathSummary = summarizeLayer(paths, NETWORK_PATH_LAYER);
    const floors = [...new Set([...junctionSummary.floors, ...pathSummary.floors])].sort();
    return {
      junctions,
      paths,
      nodeCount: junctionSummary.featureCount,
      edgeCount: pathSummary.featureCount,
      floors,
    };
  } finally {
    try {
      await gdal.close(dataset);
    } catch {
      /* Best-effort close. */
    }
  }
}

/**
 * Extract `net_junction`/`net_path` from a staged `.gdb.zip` (absolute
 * filesystem path) with exclusive access to the GDAL runtime. Throws
 * `GdbSourceError("missing_network_layers")` when either layer is absent.
 */
export function extractNetworkGeoJson(path: string): Promise<NetworkExtraction> {
  return serializeGdalOperation(() => extractNetworkGeoJsonUnlocked(path));
}
