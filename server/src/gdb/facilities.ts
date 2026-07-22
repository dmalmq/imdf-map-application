/**
 * Server-side point-facility extraction: pulls the `Facility_Merge` layer
 * (the icon-bearing POI layer: `name`/`category`/`floor`/`image`) out of a
 * staged facilities `.gdb.zip` as WGS84 RFC7946 GeoJSON text, plus the
 * facility/floor summary shown in the import review dialog.
 *
 * GDAL stays in TypeScript and the server never interprets the facilities:
 * parsing the GeoJSON into the facility index lives in the Rust compiler.
 * This module only moves bytes through gdal3.js and counts features for the
 * summary.
 */
import { asArray, asRecord, asString, openGdbZip } from "./convert";
import { getGdal, serializeGdalOperation } from "./gdal";
import { extractLayerGeoJson, summarizeLayer } from "./network";
import { GDB_MAX_GENERATED_BYTES, GdbSourceError } from "./sourceValidation";
import type { FacilitiesExtraction } from "./types";

export const FACILITY_LAYER = "Facility_Merge";

async function extractFacilitiesGeoJsonUnlocked(path: string): Promise<FacilitiesExtraction> {
  const gdal = await getGdal();
  const dataset = await openGdbZip(gdal, path);
  try {
    const info = asRecord(await gdal.ogrinfo(dataset, ["-so", "-al"]));
    const layerNames = new Set(
      asArray(info.layers).map((layer) => asString(asRecord(layer).name)),
    );
    if (!layerNames.has(FACILITY_LAYER)) {
      throw new GdbSourceError(
        "missing_facility_layer",
        "Archive is missing the point-facility layer (Facility_Merge).",
        { missing: [FACILITY_LAYER] },
      );
    }

    const geojson = await extractLayerGeoJson(
      gdal,
      dataset,
      FACILITY_LAYER,
      "facilities_facility_merge",
    );
    const generatedBytes = Buffer.byteLength(geojson, "utf8");
    if (generatedBytes > GDB_MAX_GENERATED_BYTES) {
      throw new Error(
        `Facility extraction exceeded the ${GDB_MAX_GENERATED_BYTES}-byte output cap.`,
      );
    }

    const summary = summarizeLayer(geojson, FACILITY_LAYER);
    return {
      geojson,
      facilityCount: summary.featureCount,
      floors: [...new Set(summary.floors)].sort(),
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
 * Extract `point_facility_network` from a staged facilities `.gdb.zip`
 * (absolute filesystem path) with exclusive access to the GDAL runtime.
 * Throws `GdbSourceError("missing_facility_layer")` when the layer is absent.
 */
export function extractFacilitiesGeoJson(path: string): Promise<FacilitiesExtraction> {
  return serializeGdalOperation(() => extractFacilitiesGeoJsonUnlocked(path));
}
