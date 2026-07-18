import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMinimalImdfZip } from "../../tests/fixtures/buildMinimalImdfZip";
import { CoreCompileError, type CompileVenueMetadata, type ImdfStats, type ViewerWarning } from "../src/core/native";
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

describe("publish identity race", () => {
  it("never publishes onto, or fails, a version row whose id was reused by a different row while compiling", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venue = await createVenue(app, cookie);

    // Insert the *only* version row directly (bypassing the upload route)
    // so the versions table starts and ends this setup with exactly one
    // row — SQLite then deterministically reuses its rowid for the next
    // insert once it (and its venue) are deleted.
    const sourceA = await buildMinimalImdfZip();
    const { hash: sourceHashA } = app.blobs.put(sourceA);
    app.db.prepare("INSERT OR IGNORE INTO blobs (hash, size) VALUES (?, ?)").run(sourceHashA, sourceA.byteLength);
    const insertA = app.db
      .prepare("INSERT INTO versions (venue_id, seq, source_blob_hash, source_kind) VALUES (?, 1, ?, 'imdf')")
      .run(venue.id, sourceHashA);
    const versionId = Number(insertA.lastInsertRowid);

    // A deferred compile we control: resolves only once we say so, well
    // after the row has been deleted and replaced below.
    let resolveCompile!: (result: { bundle: Buffer; stats: ImdfStats; warnings: ViewerWarning[] }) => void;
    const deferred = new Promise<{ bundle: Buffer; stats: ImdfStats; warnings: ViewerWarning[] }>((resolve) => {
      resolveCompile = resolve;
    });
    const compile = async (_source: Buffer, _metadata: CompileVenueMetadata) => deferred;

    const runner = makePublishRunner(app.db, app.blobs, compile);
    const publishPromise = runner(JSON.stringify({ versionId }));

    // While the compile above is still pending: delete the venue (cascades
    // to delete its only version row) and create a brand new venue +
    // version. SQLite reuses the freed rowid since the table is empty
    // again, so the replacement deterministically gets the same id.
    app.db.prepare("DELETE FROM venues WHERE id = ?").run(venue.id);
    const venue2 = await createVenue(app, cookie, "Replacement Venue");
    const sourceB = await buildMinimalImdfZip({ extraEntries: { "note.txt": "replacement" } });
    const { hash: sourceHashB } = app.blobs.put(sourceB);
    app.db.prepare("INSERT OR IGNORE INTO blobs (hash, size) VALUES (?, ?)").run(sourceHashB, sourceB.byteLength);
    const insertB = app.db
      .prepare("INSERT INTO versions (venue_id, seq, source_blob_hash, source_kind) VALUES (?, 1, ?, 'imdf')")
      .run(venue2.id, sourceHashB);
    const replacementId = Number(insertB.lastInsertRowid);
    expect(replacementId).toBe(versionId); // confirms the rowid was actually reused

    const replacementBefore = app.db
      .prepare("SELECT status, bundle_hash AS bundleHash, source_blob_hash AS sourceHash, error FROM versions WHERE id = ?")
      .get(replacementId);

    // Now let the stale compile (against the *deleted* row's source)
    // resolve successfully.
    resolveCompile({
      bundle: Buffer.from([0x4b, 0x56, 0x42, 0x00, 0xde, 0xad]),
      stats: { levels: 3, features: 27 },
      warnings: [],
    });

    let caught: unknown;
    try {
      await publishPromise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const structured = JSON.parse((caught as Error).message) as { code: string; message: string };
    expect(structured.code).toBe("stale_version");

    // The replacement row (same reused id, different venue/seq/source) is
    // completely untouched: not published with the stale compile's bundle,
    // and not marked failed either.
    const replacementAfter = app.db
      .prepare("SELECT status, bundle_hash AS bundleHash, source_blob_hash AS sourceHash, error FROM versions WHERE id = ?")
      .get(replacementId);
    expect(replacementAfter).toEqual(replacementBefore);
    expect((replacementAfter as { sourceHash: string }).sourceHash).toBe(sourceHashB);
  });

  it("treats a same-id/seq/source/status but different-venue-slug replacement as stale: dataset identity is the only mismatch", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venue = await createVenue(app, cookie, "Original Venue");

    const source = await buildMinimalImdfZip();
    const { hash: sourceHash } = app.blobs.put(source);
    app.db.prepare("INSERT OR IGNORE INTO blobs (hash, size) VALUES (?, ?)").run(sourceHash, source.byteLength);
    const insert1 = app.db
      .prepare("INSERT INTO versions (venue_id, seq, source_blob_hash, source_kind) VALUES (?, 1, ?, 'imdf')")
      .run(venue.id, sourceHash);
    const versionId = Number(insert1.lastInsertRowid);

    let resolveCompile!: (result: { bundle: Buffer; stats: ImdfStats; warnings: ViewerWarning[] }) => void;
    const deferred = new Promise<{ bundle: Buffer; stats: ImdfStats; warnings: ViewerWarning[] }>((resolve) => {
      resolveCompile = resolve;
    });
    const compile = async (_source: Buffer, _metadata: CompileVenueMetadata) => deferred;
    const runner = makePublishRunner(app.db, app.blobs, compile);
    const publishPromise = runner(JSON.stringify({ versionId }));

    // Delete the venue (cascades the version) and recreate a venue with a
    // *different name/slug* that reuses the same emptied venue_id, then a
    // version that reuses the same emptied version id with the *same*
    // seq, *same* source hash, and *same* status as the row the pending
    // compile was launched against. The venue slug is the only thing that
    // differs — exactly the gap the old (id, venue_id, seq, source,
    // status) predicate alone could not see, since venue_id itself can be
    // reused too.
    app.db.prepare("DELETE FROM venues WHERE id = ?").run(venue.id);
    const venue2 = await createVenue(app, cookie, "Renamed Venue");
    expect(venue2.id).toBe(venue.id); // venue_id was reused
    expect(venue2.slug).not.toBe(venue.slug); // the only differing identity field
    const insert2 = app.db
      .prepare("INSERT INTO versions (venue_id, seq, source_blob_hash, source_kind) VALUES (?, 1, ?, 'imdf')")
      .run(venue2.id, sourceHash);
    const replacementId = Number(insert2.lastInsertRowid);
    expect(replacementId).toBe(versionId); // version id was reused too

    const replacementRow = app.db
      .prepare("SELECT seq, source_blob_hash AS sourceHash, status FROM versions WHERE id = ?")
      .get(replacementId) as { seq: number; sourceHash: string; status: string };
    expect(replacementRow.seq).toBe(1);
    expect(replacementRow.sourceHash).toBe(sourceHash);
    expect(replacementRow.status).toBe("draft");

    const replacementBefore = app.db
      .prepare("SELECT status, bundle_hash AS bundleHash, source_blob_hash AS sourceHash, error FROM versions WHERE id = ?")
      .get(replacementId);

    resolveCompile({
      bundle: Buffer.from([0x4b, 0x56, 0x42, 0x00, 0xbe, 0xef]),
      stats: { levels: 3, features: 27 },
      warnings: [],
    });

    let caught: unknown;
    try {
      await publishPromise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const structured = JSON.parse((caught as Error).message) as { code: string; message: string };
    expect(structured.code).toBe("stale_version");

    const replacementAfter = app.db
      .prepare("SELECT status, bundle_hash AS bundleHash, source_blob_hash AS sourceHash, error FROM versions WHERE id = ?")
      .get(replacementId);
    expect(replacementAfter).toEqual(replacementBefore);
  });

  it("reports stale_version instead of the original domain code when a genuine compile failure races a delete+recreate", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venue = await createVenue(app, cookie, "Original Venue");

    const source = await buildMinimalImdfZip();
    const { hash: sourceHash } = app.blobs.put(source);
    app.db.prepare("INSERT OR IGNORE INTO blobs (hash, size) VALUES (?, ?)").run(sourceHash, source.byteLength);
    const insert1 = app.db
      .prepare("INSERT INTO versions (venue_id, seq, source_blob_hash, source_kind) VALUES (?, 1, ?, 'imdf')")
      .run(venue.id, sourceHash);
    const versionId = Number(insert1.lastInsertRowid);

    let rejectCompile!: (error: unknown) => void;
    const deferred = new Promise<{ bundle: Buffer; stats: ImdfStats; warnings: ViewerWarning[] }>((_resolve, reject) => {
      rejectCompile = reject;
    });
    const compile = async (_source: Buffer, _metadata: CompileVenueMetadata) => deferred;
    const runner = makePublishRunner(app.db, app.blobs, compile);
    const publishPromise = runner(JSON.stringify({ versionId }));

    app.db.prepare("DELETE FROM venues WHERE id = ?").run(venue.id);
    const venue2 = await createVenue(app, cookie, "Renamed Venue");
    expect(venue2.id).toBe(venue.id);
    const insert2 = app.db
      .prepare("INSERT INTO versions (venue_id, seq, source_blob_hash, source_kind) VALUES (?, 1, ?, 'imdf')")
      .run(venue2.id, sourceHash);
    const replacementId = Number(insert2.lastInsertRowid);
    expect(replacementId).toBe(versionId);

    const replacementBefore = app.db
      .prepare("SELECT status, bundle_hash AS bundleHash, source_blob_hash AS sourceHash, error FROM versions WHERE id = ?")
      .get(replacementId);

    // The stale compile now genuinely fails on its own terms (a real
    // domain error) — but the row it was compiling for no longer exists,
    // so the reported job error must still be stale_version, never the
    // now-meaningless domain code.
    rejectCompile(new CoreCompileError("unsupported_file", "unsupported_file"));

    let caught: unknown;
    try {
      await publishPromise;
    } catch (error) {
      caught = error;
    }
    const structured = JSON.parse((caught as Error).message) as { code: string; message: string };
    expect(structured.code).toBe("stale_version");
    expect(structured.code).not.toBe("unsupported_file");

    const replacementAfter = app.db
      .prepare("SELECT status, bundle_hash AS bundleHash, source_blob_hash AS sourceHash, error FROM versions WHERE id = ?")
      .get(replacementId);
    expect(replacementAfter).toEqual(replacementBefore);
  });
});

describe("publish failure paths", () => {
  it("marks the version failed with a structured error when the retained source blob cannot be read", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venue = await createVenue(app, cookie);

    // A source hash the version row references but that was never
    // persisted via `blobs.put` — simulates a missing/corrupted blob.
    const missingHash = "0".repeat(64);
    const insert = app.db
      .prepare("INSERT INTO versions (venue_id, seq, source_blob_hash, source_kind) VALUES (?, 1, ?, 'imdf')")
      .run(venue.id, missingHash);
    const versionId = Number(insert.lastInsertRowid);

    const runner = makePublishRunner(app.db, app.blobs);
    await expect(runner(JSON.stringify({ versionId }))).rejects.toThrow();

    const row = app.db
      .prepare("SELECT status, bundle_hash AS bundleHash, source_blob_hash AS sourceHash, error FROM versions WHERE id = ?")
      .get(versionId) as { status: string; bundleHash: string | null; sourceHash: string; error: string | null };
    expect(row.status).toBe("failed");
    expect(row.bundleHash).toBeNull();
    expect(row.sourceHash).toBe(missingHash);
    const structured = JSON.parse(row.error ?? "null") as { code: string; message: string };
    expect(structured.code).toBe("internal_error");
    expect(structured.message).toBeTruthy();
  });

  it("marks the version failed with a structured error when persisting the compiled bundle blob fails, preserving the source", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venue = await createVenue(app, cookie);

    const realPut = app.blobs.put.bind(app.blobs);
    const putSpy = vi.spyOn(app.blobs, "put");
    // First call is the upload route storing the source blob — let it
    // succeed; only the *second* call (publish persisting the compiled
    // bundle) simulates the disk-full failure.
    putSpy.mockImplementationOnce((bytes) => realPut(bytes));
    putSpy.mockImplementation(() => {
      throw new Error("simulated disk full");
    });
    const { payload, headers } = multipartZip(await buildMinimalImdfZip());
    const upload = await app.inject({
      method: "POST",
      url: `/api/venues/${venue.id}/versions`,
      headers: { ...headers, cookie },
      payload,
    });
    const { versionId, jobId } = upload.json();
    await app.queue.idle();
    putSpy.mockRestore();

    const job = await app.inject({ method: "GET", url: `/api/jobs/${jobId}`, headers: { cookie } });
    expect(job.json().status).toBe("error");
    const jobError = JSON.parse(job.json().error) as { code: string; message: string };
    expect(jobError.code).toBe("internal_error");
    expect(jobError.message).toContain("simulated disk full");

    const row = app.db
      .prepare("SELECT status, bundle_hash AS bundleHash, source_blob_hash AS sourceHash FROM versions WHERE id = ?")
      .get(versionId) as { status: string; bundleHash: string | null; sourceHash: string };
    expect(row.status).toBe("failed");
    expect(row.bundleHash).toBeNull();
    expect(app.blobs.has(row.sourceHash)).toBe(true);
  });

  it("marks the version failed when the published-state SQLite write fails, and the failure write itself still commits", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venue = await createVenue(app, cookie);

    // Fires only on the transition to status='published' — the later
    // failure-marking UPDATE sets status='failed' instead, so it is
    // unaffected and must still commit.
    app.db.exec(`
      CREATE TRIGGER fail_on_publish_transition
      BEFORE UPDATE OF status ON versions
      WHEN NEW.status = 'published'
      BEGIN
        SELECT RAISE(ABORT, 'simulated publish commit failure');
      END;
    `);

    const { payload, headers } = multipartZip(await buildMinimalImdfZip());
    const upload = await app.inject({
      method: "POST",
      url: `/api/venues/${venue.id}/versions`,
      headers: { ...headers, cookie },
      payload,
    });
    const { versionId, jobId } = upload.json();
    await app.queue.idle();

    const job = await app.inject({ method: "GET", url: `/api/jobs/${jobId}`, headers: { cookie } });
    expect(job.json().status).toBe("error");
    const jobError = JSON.parse(job.json().error) as { code: string; message: string };
    expect(jobError.code).toBe("internal_error");
    expect(jobError.message).toContain("simulated publish commit failure");

    const row = app.db
      .prepare("SELECT status, bundle_hash AS bundleHash, source_blob_hash AS sourceHash FROM versions WHERE id = ?")
      .get(versionId) as { status: string; bundleHash: string | null; sourceHash: string };
    expect(row.status).toBe("failed");
    expect(row.bundleHash).toBeNull();
    expect(app.blobs.has(row.sourceHash)).toBe(true);
  });
});
