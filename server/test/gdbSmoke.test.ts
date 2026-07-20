/**
 * End-to-end GDB HTTP smoke test against a real `.gdb.zip` archive.
 *
 * Skipped unless `KIRIKO_GDB_SMOKE` points at the Tokyo fixture:
 *   KIRIKO_GDB_SMOKE=/home/apollo/Downloads/JRTokyoSta_3857.gdb.zip pnpm test -- gdbSmoke
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { GdbInspectResponse } from "../src/gdb/types";
import { cleanupTestApps, loginCookie, makeTestApp } from "./helpers";

const SMOKE_PATH = process.env["KIRIKO_GDB_SMOKE"];
const SKIP = !SMOKE_PATH || !existsSync(SMOKE_PATH);

function multipartZip(bytes: Uint8Array): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const boundary = "----kirikoGdbSmokeBoundary";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="JRTokyoSta_3857.gdb.zip"\r\n` +
      `Content-Type: application/zip\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, Buffer.from(bytes), tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

afterEach(cleanupTestApps);

describe.skipIf(SKIP)("GDB endpoint smoke", () => {
  it("inspects, publishes, and compiles a reviewed GDB plan", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);

    const create = await app.inject({
      method: "POST",
      url: "/api/venues",
      headers: { cookie },
      payload: { name: "Tokyo GDB Smoke" },
    });
    expect(create.statusCode).toBe(201);
    const venueId = (create.json().venue as { id: number }).id;

    const upload = multipartZip(new Uint8Array(readFileSync(SMOKE_PATH!)));
    const inspect = await app.inject({
      method: "POST",
      url: "/api/gdb/inspect",
      headers: { cookie, ...upload.headers },
      payload: upload.payload,
    });
    expect(inspect.statusCode).toBe(200);
    const inspected = inspect.json() as GdbInspectResponse;
    expect(inspected.inspection.layers.length).toBe(318);
    expect(inspected.suggestedPlan.layers.length).toBe(318);
    expect(inspected.blobHash).toMatch(/^[0-9a-f]{64}$/);

    const suggested = inspected.suggestedPlan;
    const selectedNames = new Set(["G空間_0_Floor", "G空間_0_Space"]);
    const selectedRows = suggested.layers.filter((row) => selectedNames.has(row.key.layerName));
    expect(selectedRows).toHaveLength(2);
    const buildingId = selectedRows[0]!.buildingId;
    expect(buildingId).not.toBeNull();

    const plan = {
      ...suggested,
      buildings: suggested.buildings.filter((building) => building.id === buildingId),
      layers: suggested.layers.map((row) => ({
        ...row,
        included: selectedNames.has(row.key.layerName),
      })),
    };

    const publish = await app.inject({
      method: "POST",
      url: "/api/gdb/publish",
      headers: { cookie },
      payload: {
        venueId,
        blobHash: inspected.blobHash,
        plan,
      },
    });
    expect(publish.statusCode, publish.body).toBe(202);
    const accepted = publish.json() as { jobId: string; versionId: number; seq: number };
    expect(accepted.seq).toBe(1);

    await app.queue.idle();
    const version = app.db
      .prepare(
        "SELECT status, source_kind AS sourceKind, source_blob_hash AS sourceHash, stats_json AS statsJson FROM versions WHERE id = ?",
      )
      .get(accepted.versionId) as {
      status: string;
      sourceKind: string;
      sourceHash: string;
      statsJson: string | null;
    };
    expect(version.status).toBe("published");
    expect(version.sourceKind).toBe("gdb");
    expect(
      app.db.prepare("SELECT 1 FROM blobs WHERE hash = ?").get(version.sourceHash),
    ).toBeDefined();
    const stats = JSON.parse(version.statsJson!) as { levels: number; features: number };
    expect(stats.levels).toBeGreaterThan(0);
    expect(stats.features).toBeGreaterThan(0);
  }, 30_000);
});
