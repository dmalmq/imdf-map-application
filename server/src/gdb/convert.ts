/**
 * Server-side GDB inspect + convert, driving gdal3.js to enumerate layers and
 * reproject each selected one to WGS84 RFC7946 GeoJSON.
 *
 * Unlike the browser branch (which stages every selected file into the GDAL
 * Emscripten FS, holds datasets open across inspect→convert, and disposes them
 * on session close), the server path is stateless: both the inspect and the
 * publish/convert endpoints re-open a staged `.gdb.zip` from scratch. No
 * per-session GDAL state crosses HTTP requests; a process-local serializer
 * protects the shared Emscripten runtime from overlapping operations.
 */
import {
  getGdal,
  serializeGdalOperation,
  type GdalInstance,
  type GdalOgrLayer,
} from "./gdal";
import {
  GDB_MAX_GENERATED_BYTES,
} from "./sourceValidation";
import type {
  GdbConversionResult,
  GdbConvertedLayer,
  GdbFieldDescriptor,
  GdbGeometryFamily,
  GdbInspection,
  GdbLayerDescriptor,
} from "./types";

/** GDAL output readers. gdal3.js ships plain JS objects; these narrow unknown at the boundary. */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Open the staged `.gdb.zip` via GDAL's `/vsizip/` virtual filesystem. */
async function openGdbZip(gdal: GdalInstance, path: string): Promise<unknown> {
  // gdal3.js accepts an options/vfs arg list; the canonical GDAL form is the
  // `/vsizip/<path>` prefix. Try both — direct open of the zip first (gdal3.js
  // has special handling), then the explicit `/vsizip/` form.
  try {
    const opened = await gdal.open(path, [], ["vsizip"]);
    const datasets = asArray(asRecord(opened).datasets);
    if (datasets[0] !== undefined) return datasets[0];
  } catch {
    /* fall through to explicit /vsizip/ form */
  }
  const opened = await gdal.open(`/vsizip/${path}`);
  const datasets = asArray(asRecord(opened).datasets);
  if (datasets[0] === undefined) {
    throw new Error("GDAL returned no datasets from the uploaded archive.");
  }
  return datasets[0];
}

function classifyGeometry(layer: GdalOgrLayer): GdbGeometryFamily {
  const families = new Set<GdbGeometryFamily>();
  for (const field of asArray(layer.geometryFields)) {
    const type = asString(asRecord(field).type).toLowerCase();
    if (type.includes("point")) families.add("point");
    else if (type.includes("line")) families.add("line");
    else if (type.includes("polygon")) families.add("polygon");
  }
  if (families.size === 0) {
    const type = asString(layer.geometry).toLowerCase();
    if (type.includes("point")) families.add("point");
    else if (type.includes("line")) families.add("line");
    else if (type.includes("polygon")) families.add("polygon");
  }
  if (families.size === 0) return "none";
  if (families.size === 1) return [...families][0]!;
  return "mixed";
}

/** Recursively contains ≥1 finite lon/lat pair. */
function hasFiniteCoordinatePair(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (typeof value[0] === "number") {
    const lon = value[0];
    const lat = value[1];
    return typeof lat === "number" && Number.isFinite(lon) && Number.isFinite(lat);
  }
  for (const nested of value) {
    if (hasFiniteCoordinatePair(nested)) return true;
  }
  return false;
}

function geometryHasFiniteCoordinates(geometry: unknown): boolean {
  const record = asRecord(geometry);
  const type = asString(record.type);
  if (!type) return false;
  if (type === "GeometryCollection") {
    for (const nested of asArray(record.geometries)) {
      if (geometryHasFiniteCoordinates(nested)) return true;
    }
    return false;
  }
  return hasFiniteCoordinatePair(record.coordinates);
}

function hasGeometry(feature: unknown): boolean {
  return geometryHasFiniteCoordinates(asRecord(feature).geometry);
}

/**
 * Inspect a staged `.gdb.zip` (absolute filesystem path) and return one layer
 * descriptor per OGR layer in the first dataset.
 */
async function inspectGdbArchiveUnlocked(
  path: string,
  sourceName: string,
): Promise<GdbInspection> {
  const gdal = await getGdal();
  const dataset = await openGdbZip(gdal, path);
  try {
    const infoRecord = asRecord(await gdal.ogrinfo(dataset, ["-so", "-al"]));
    const ogrLayers = asArray(infoRecord.layers).map(asRecord);
    if (ogrLayers.length === 0) {
      throw new Error("GDAL returned no layers from the uploaded archive.");
    }

    const layers: GdbLayerDescriptor[] = [];
    for (const layer of ogrLayers) {
      const layerName = asString(layer.name);
      if (!layerName) continue;
      const fields: GdbFieldDescriptor[] = asArray(layer.fields).map((field) => {
        const record = asRecord(field);
        return { name: asString(record.name), type: asString(record.type) };
      });
      layers.push({
        key: { databaseId: "gdb-1", layerName },
        databaseName: sourceName,
        featureCount: asNumber(layer.featureCount),
        geometryFamily: classifyGeometry(layer),
        fields,
      });
    }

    if (layers.length === 0) {
      throw new Error("GDAL returned no named layers from the uploaded archive.");
    }

    return {
      sourceName,
      databases: [{ id: "gdb-1", name: sourceName }],
      layers,
      warnings: [],
    };
  } finally {
    try {
      await gdal.close(dataset);
    } catch {
      /* Best-effort close. */
    }
  }
}

/** Inspect one staged archive with exclusive access to the GDAL runtime. */
export function inspectGdbArchive(
  path: string,
  sourceName: string,
): Promise<GdbInspection> {
  return serializeGdalOperation(() => inspectGdbArchiveUnlocked(path, sourceName));
}

/** Sanitize an output layer name into a safe GDAL output stem. */
function sanitizeOutputName(layerName: string): string {
  const sanitized = String(layerName || "")
    .replace(/[\\/:*?"<>|\0]/g, "_")
    .trim()
    .replace(/\.+$/g, "")
    .slice(0, 80);
  return sanitized || "layer";
}

/**
 * Convert every included layer named in `selectedLayerNames` to a WGS84
 * RFC7946 GeoJSON FeatureCollection via `ogr2ogr`. Layers that produce no
 * spatial features fail conversion. Caller filters by the plan's `included`
 * flag before calling.
 */
async function convertGdbLayersUnlocked(
  path: string,
  selectedLayerNames: readonly string[],
): Promise<GdbConversionResult> {
  if (selectedLayerNames.length === 0) {
    return { layers: [], warnings: [] };
  }

  const gdal = await getGdal();
  const dataset = await openGdbZip(gdal, path);
  const layers: GdbConvertedLayer[] = [];
  const warnings: string[] = [];
  let generatedBytes = 0;

  try {
    for (let i = 0; i < selectedLayerNames.length; i += 1) {
      const layerName = selectedLayerNames[i]!;
      const outputName = `gdb_gdb-1_${i}_${sanitizeOutputName(layerName)}`;

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
      generatedBytes += bytes.byteLength;
      if (generatedBytes > GDB_MAX_GENERATED_BYTES) {
        throw new Error(
          `GDB conversion exceeded the ${GDB_MAX_GENERATED_BYTES}-byte output cap.`,
        );
      }

      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      const record = asRecord(parsed);
      if (asString(record.type) !== "FeatureCollection") {
        throw new Error(`Layer "${layerName}" did not convert to a FeatureCollection.`);
      }
      const features = asArray(record.features);
      const spatial = features.filter(hasGeometry);
      if (spatial.length === 0) {
        throw new Error(`Layer "${layerName}" produced no spatial features.`);
      }
      const skipped = features.length - spatial.length;
      if (skipped > 0) {
        warnings.push(
          `Layer "${layerName}" skipped ${skipped} feature(s) without geometry.`,
        );
      }
      layers.push({
        key: { databaseId: "gdb-1", layerName },
        featureCollection: {
          type: "FeatureCollection",
          features: spatial as GeoJSON.Feature[],
        },
        skippedGeometryCount: skipped,
      });
    }
  } finally {
    try {
      await gdal.close(dataset);
    } catch {
      /* Best-effort close. */
    }
  }

  return { layers, warnings };
}

/** Convert selected layers with exclusive access to the GDAL runtime. */
export function convertGdbLayers(
  path: string,
  selectedLayerNames: readonly string[],
): Promise<GdbConversionResult> {
  return serializeGdalOperation(() =>
    convertGdbLayersUnlocked(path, selectedLayerNames),
  );
}
