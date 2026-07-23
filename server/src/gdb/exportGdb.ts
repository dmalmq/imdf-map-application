/**
 * Package a synthesized/real routing network (`net_junction` + `net_path`
 * WGS84 GeoJSON, produced by the Rust `export_network`) into a File
 * Geodatabase `.gdb.zip`, byte-for-byte re-importable through this server's
 * own `/api/gdb/inspect-network` path.
 *
 * GDAL stays in TypeScript (the boundary rule): this module only moves bytes
 * through gdal3.js. Two `ogr2ogr` calls write the two feature classes into a
 * single OpenFileGDB directory (the second `-update -append`), and the
 * resulting `.gdb/*` files are zipped under a `net.gdb/` root so the archive
 * matches the shape the importer validates.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { asArray, asRecord } from "./convert";
import { getGdal, serializeGdalOperation, type GdalInstance } from "./gdal";

/** The `.gdb` root directory name inside the produced archive. */
export const EXPORT_GDB_ROOT = "net.gdb";

async function openGeoJson(gdal: GdalInstance, path: string): Promise<unknown> {
  const opened = asRecord(await gdal.open(path));
  const dataset = asArray(opened.datasets)[0];
  if (dataset === undefined) {
    throw new Error(`GDAL returned no dataset from ${basename(path)}.`);
  }
  return dataset;
}

/** Zip entry path for a gdal3.js output file at `.../net.gdb/<name>`. */
function gdbEntryPath(local: string): string {
  const marker = `/${EXPORT_GDB_ROOT}/`;
  const idx = local.indexOf(marker);
  return idx >= 0 ? `${EXPORT_GDB_ROOT}/${local.slice(idx + marker.length)}` : `${EXPORT_GDB_ROOT}/${basename(local)}`;
}

async function packageNetworkGdbZipUnlocked(
  junctionsGeoJson: string,
  pathsGeoJson: string,
): Promise<Uint8Array> {
  const gdal = await getGdal();
  const dir = mkdtempSync(join(tmpdir(), "kiriko-netexport-"));
  try {
    const junctionsPath = join(dir, "net_junction.geojson");
    const pathsPath = join(dir, "net_path.geojson");
    writeFileSync(junctionsPath, junctionsGeoJson);
    writeFileSync(pathsPath, pathsGeoJson);

    // First layer creates the .gdb; second appends into the same directory.
    const junctionsDataset = await openGeoJson(gdal, junctionsPath);
    try {
      await gdal.ogr2ogr(
        junctionsDataset,
        ["-f", "OpenFileGDB", "-nln", "net_junction", "-t_srs", "EPSG:4326"],
        "net",
      );
    } finally {
      await gdal.close(junctionsDataset).catch(() => undefined);
    }

    const pathsDataset = await openGeoJson(gdal, pathsPath);
    let output: unknown;
    try {
      output = await gdal.ogr2ogr(
        pathsDataset,
        ["-f", "OpenFileGDB", "-update", "-append", "-nln", "net_path", "-t_srs", "EPSG:4326"],
        "net",
      );
    } finally {
      await gdal.close(pathsDataset).catch(() => undefined);
    }

    const outputRecord = asRecord(output);
    const files = asArray(outputRecord.all)
      .map((entry) => asRecord(entry).local)
      .filter((local): local is string => typeof local === "string" && local.length > 0);
    if (files.length === 0) {
      throw new Error("GDAL produced no File Geodatabase output files.");
    }

    const writer = new ZipWriter(new Uint8ArrayWriter());
    const seen = new Set<string>();
    for (const local of files) {
      const entry = gdbEntryPath(local);
      if (seen.has(entry)) continue;
      seen.add(entry);
      const bytes = await gdal.getFileBytes({ local });
      await writer.add(entry, new Uint8ArrayReader(bytes));
    }
    return await writer.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Package `net_junction`/`net_path` GeoJSON into a `.gdb.zip` with exclusive
 * access to the shared GDAL runtime.
 */
export function packageNetworkGdbZip(
  junctionsGeoJson: string,
  pathsGeoJson: string,
): Promise<Uint8Array> {
  return serializeGdalOperation(() =>
    packageNetworkGdbZipUnlocked(junctionsGeoJson, pathsGeoJson),
  );
}
