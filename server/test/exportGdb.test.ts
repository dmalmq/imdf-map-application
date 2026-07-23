/**
 * Real-GDAL round-trip for the network GDB export: `packageNetworkGdbZip`
 * must produce a `.gdb.zip` that this server's own import inspector reads
 * back as `net_junction` + `net_path` feature classes with the same feature
 * counts. No GDAL mock here — the whole point is exercising the real
 * OpenFileGDB write path.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectGdbArchive } from "../src/gdb/convert";
import { packageNetworkGdbZip } from "../src/gdb/exportGdb";

const JUNCTIONS = JSON.stringify({
  type: "FeatureCollection",
  name: "net_junction",
  features: [
    { type: "Feature", properties: { NODEID: 0, PATH_COUNT: 1, FLOOR: "F1", altitude: 0 }, geometry: { type: "Point", coordinates: [139.7, 35.69] } },
    { type: "Feature", properties: { NODEID: 1, PATH_COUNT: 1, FLOOR: "F1", altitude: 0 }, geometry: { type: "Point", coordinates: [139.701, 35.69] } },
  ],
});
const PATHS = JSON.stringify({
  type: "FeatureCollection",
  name: "net_path",
  features: [
    { type: "Feature", properties: { FNODEID: 0, TNODEID: 1, cost: 90000, FLOOR: "F1", PATHID: 1, RPATHID: 2 }, geometry: { type: "LineString", coordinates: [[139.7, 35.69], [139.701, 35.69]] } },
    { type: "Feature", properties: { FNODEID: 1, TNODEID: 0, cost: 90000, FLOOR: "F1", PATHID: 2, RPATHID: 1 }, geometry: { type: "LineString", coordinates: [[139.701, 35.69], [139.7, 35.69]] } },
  ],
});

describe("packageNetworkGdbZip", () => {
  it("writes a re-importable .gdb.zip with net_junction + net_path layers", async () => {
    const zip = await packageNetworkGdbZip(JUNCTIONS, PATHS);
    expect(zip.length).toBeGreaterThan(0);

    const dir = mkdtempSync(join(tmpdir(), "kiriko-exportgdb-test-"));
    const zipPath = join(dir, "net.gdb.zip");
    writeFileSync(zipPath, Buffer.from(zip));

    const inspection = await inspectGdbArchive(zipPath, "net.gdb.zip");
    const byName = new Map(inspection.layers.map((l) => [l.key.layerName, l]));
    expect(byName.has("net_junction")).toBe(true);
    expect(byName.has("net_path")).toBe(true);
    expect(byName.get("net_junction")?.featureCount).toBe(2);
    expect(byName.get("net_path")?.featureCount).toBe(2);
    expect(byName.get("net_junction")?.geometryFamily).toBe("point");
    expect(byName.get("net_path")?.geometryFamily).toBe("line");
  }, 60_000);
});
