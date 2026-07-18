import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildMinimalImdfZip } from "../../tests/fixtures/buildMinimalImdfZip";
import { makePublishRunner } from "../src/jobs/publish";
import { cleanupTestApps, loginCookie, makeTestApp } from "./helpers";

afterEach(cleanupTestApps);

const KVB_MAGIC = Buffer.from([0x4b, 0x56, 0x42, 0x00]); // "KVB\0"
const LEVEL_1F = "b1000001-0000-4000-8000-0000000000b1";

function syntheticUnitId(i: number): string {
  return `f${i.toString(16).padStart(7, "0")}-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
}

/**
 * A valid IMDF archive with `count` synthetic unit features, used only to
 * make native compile take long enough (see `coreNative.test.ts`'s "off
 * the Node.js event loop" test, ~80ms for 4000 features) that a
 * publish-plumbing regression which blocks the event loop would be
 * unmistakable.
 */
async function buildExpensiveImdfZip(count: number): Promise<Uint8Array> {
  const features = [];
  for (let i = 0; i < count; i++) {
    const lon = 139.76 + (i % 100) * 0.0001;
    const lat = 35.68 + Math.floor(i / 100) * 0.0001;
    features.push({
      id: syntheticUnitId(i),
      type: "Feature",
      feature_type: "unit",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [lon, lat],
            [lon + 0.00005, lat],
            [lon + 0.00005, lat + 0.00005],
            [lon, lat + 0.00005],
            [lon, lat],
          ],
        ],
      },
      properties: {
        category: "room",
        restriction: null,
        accessibility: null,
        name: { en: `Room ${i}` },
        alt_name: null,
        display_point: { type: "Point", coordinates: [lon + 0.000025, lat + 0.000025] },
        level_id: LEVEL_1F,
      },
    });
  }
  const collection = { type: "FeatureCollection", features };
  return buildMinimalImdfZip({ replaceEntries: { "unit.geojson": JSON.stringify(collection) } });
}

async function createVenue(app: FastifyInstance, cookie: string, name = "Test Station") {
  const res = await app.inject({
    method: "POST",
    url: "/api/venues",
    headers: { cookie },
    payload: { name },
  });
  return res.json().venue as { id: number; slug: string };
}

function multipartZip(bytes: Uint8Array): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----kirikoTestBoundary";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="venue.zip"\r\nContent-Type: application/zip\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, Buffer.from(bytes), tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe("upload + publish", () => {
  it("uploads an IMDF zip, publishes a compiled KVB bundle, and exposes stats", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venue = await createVenue(app, cookie);
    const { payload, headers } = multipartZip(await buildMinimalImdfZip());

    const upload = await app.inject({
      method: "POST",
      url: `/api/venues/${venue.id}/versions`,
      headers: { ...headers, cookie },
      payload,
    });
    expect(upload.statusCode).toBe(202);
    const { jobId, seq, versionId } = upload.json();
    expect(seq).toBe(1);

    await app.queue.idle();

    const job = await app.inject({ method: "GET", url: `/api/jobs/${jobId}`, headers: { cookie } });
    expect(job.json().status).toBe("done");

    const list = await app.inject({ method: "GET", url: "/api/venues", headers: { cookie } });
    const latest = list.json().venues[0].latest;
    expect(latest.seq).toBe(1);
    expect(latest.status).toBe("published");
    expect(latest.stats).toEqual({ levels: 3, features: 27 });

    const row = app.db
      .prepare("SELECT source_blob_hash AS sourceHash, bundle_hash AS bundleHash FROM versions WHERE id = ?")
      .get(versionId) as { sourceHash: string; bundleHash: string };
    expect(row.bundleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.bundleHash).not.toBe(row.sourceHash);
    const bundleBytes = app.blobs.read(row.bundleHash);
    expect(bundleBytes.subarray(0, 4)).toEqual(KVB_MAGIC);
  });

  it("marks a garbage upload failed with a stable structured error and keeps the venue unpublished", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venue = await createVenue(app, cookie);
    const { payload, headers } = multipartZip(new TextEncoder().encode("not a zip"));

    const upload = await app.inject({
      method: "POST",
      url: `/api/venues/${venue.id}/versions`,
      headers: { ...headers, cookie },
      payload,
    });
    expect(upload.statusCode).toBe(202);
    const { versionId } = upload.json();
    await app.queue.idle();

    const job = await app.inject({
      method: "GET",
      url: `/api/jobs/${upload.json().jobId}`,
      headers: { cookie },
    });
    expect(job.json().status).toBe("error");
    const jobError = JSON.parse(job.json().error) as { code: string; message: string };
    expect(jobError.code).toBe("unsupported_file");

    const row = app.db
      .prepare("SELECT status, bundle_hash AS bundleHash, source_blob_hash AS sourceHash, error FROM versions WHERE id = ?")
      .get(versionId) as { status: string; bundleHash: string | null; sourceHash: string; error: string | null };
    expect(row.status).toBe("failed");
    expect(row.bundleHash).toBeNull();
    expect(row.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(app.blobs.has(row.sourceHash)).toBe(true);
    const versionError = JSON.parse(row.error ?? "null") as { code: string; message: string };
    expect(versionError.code).toBe("unsupported_file");

    const list = await app.inject({ method: "GET", url: "/api/venues", headers: { cookie } });
    expect(list.json().venues[0].latest).toBeNull();
  });

  it("re-publishing the same version stores exactly one content-addressed bundle blob", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venue = await createVenue(app, cookie);
    const { payload, headers } = multipartZip(await buildMinimalImdfZip());

    const upload = await app.inject({
      method: "POST",
      url: `/api/venues/${venue.id}/versions`,
      headers: { ...headers, cookie },
      payload,
    });
    const { versionId } = upload.json();
    await app.queue.idle();

    const first = app.db
      .prepare("SELECT bundle_hash AS bundleHash FROM versions WHERE id = ?")
      .get(versionId) as { bundleHash: string };

    // Re-run the publish runner directly for the same version, simulating a
    // retry: identical (datasetId, seq) source must compile to identical
    // bytes, so the content-addressed blob table gains no duplicate row.
    const runner = makePublishRunner(app.db, app.blobs);
    await runner(JSON.stringify({ versionId }));

    const second = app.db
      .prepare("SELECT bundle_hash AS bundleHash FROM versions WHERE id = ?")
      .get(versionId) as { bundleHash: string };
    expect(second.bundleHash).toBe(first.bundleHash);

    const blobRows = app.db
      .prepare("SELECT COUNT(*) AS c FROM blobs WHERE hash = ?")
      .get(first.bundleHash) as { c: number };
    expect(blobRows.c).toBe(1);
  });

  it("keeps the queue responsive to other requests while a compile is in flight", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venue = await createVenue(app, cookie);
    const { payload, headers } = multipartZip(await buildExpensiveImdfZip(4000));

    const upload = await app.inject({
      method: "POST",
      url: `/api/venues/${venue.id}/versions`,
      headers: { ...headers, cookie },
      payload,
    });
    expect(upload.statusCode).toBe(202);

    let jobSettled = false;
    const idle = app.queue.idle().then(() => {
      jobSettled = true;
    });

    // Issued while the compile's native AsyncTask is still running on
    // libuv's thread pool (see coreNative.test.ts's "off the Node.js event
    // loop" test); if publish ever blocked the event loop synchronously,
    // this unrelated request could not be served until the job settled.
    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    expect(jobSettled).toBe(false);

    await idle;
    const job = await app.inject({
      method: "GET",
      url: `/api/jobs/${upload.json().jobId}`,
      headers: { cookie },
    });
    expect(job.json().status).toBe("done");
  });
});
