import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildMinimalImdfZip } from "../../tests/fixtures/buildMinimalImdfZip";
import { cleanupTestApps, loginCookie, makeTestApp } from "./helpers";

afterEach(cleanupTestApps);

const KVB_MAGIC = Buffer.from([0x4b, 0x56, 0x42, 0x00]); // "KVB\0"
const ZIP_MAGIC = Buffer.from([0x50, 0x4b]); // "PK"
const LATEST_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const PINNED_CACHE_CONTROL = "public, max-age=31536000, immutable";

async function createVenue(app: FastifyInstance, cookie: string, name: string) {
  const res = await app.inject({ method: "POST", url: "/api/venues", headers: { cookie }, payload: { name } });
  return res.json().venue as { id: number; slug: string };
}

function multipartZip(bytes: Uint8Array): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----kirikoServeBoundary";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="v.zip"\r\nContent-Type: application/zip\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, Buffer.from(bytes), tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

/** Uploads `bytes` as the venue's next version and waits for publish to settle (published or failed). */
async function uploadAndWait(app: FastifyInstance, cookie: string, venueId: number, bytes: Uint8Array): Promise<void> {
  const { payload, headers } = multipartZip(bytes);
  await app.inject({
    method: "POST",
    url: `/api/venues/${venueId}/versions`,
    headers: { ...headers, cookie },
    payload,
  });
  await app.queue.idle();
}

interface RouteFamily {
  path: "archive" | "bundle";
  contentType: string;
}

const ROUTE_FAMILIES: RouteFamily[] = [
  { path: "archive", contentType: "application/zip" },
  { path: "bundle", contentType: "application/vnd.kiriko.bundle" },
];

// Behavior shared by both route families through the same `findPublished`/
// `send` lookup: unknown venues, draft/failed exclusion, latest-seq
// selection, and the exact header/304 contract — asserted identically for
// `/archive` and `/bundle` so a regression in the shared lookup is caught
// regardless of which route a caller happens to exercise.
for (const { path, contentType } of ROUTE_FAMILIES) {
  describe(`${path} route: publication-state semantics`, () => {
    it("404s for an unknown venue", async () => {
      const { app } = await makeTestApp();
      const res = await app.inject({ method: "GET", url: `/v/default/nope/${path}` });
      expect(res.statusCode).toBe(404);
    });

    it("404s for latest and pinned when the venue has no published version (only a failed attempt)", async () => {
      const { app } = await makeTestApp();
      const cookie = await loginCookie(app);
      const venue = await createVenue(app, cookie, "Never Published");
      await uploadAndWait(app, cookie, venue.id, new TextEncoder().encode("not a zip"));

      const latest = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/${path}` });
      expect(latest.statusCode).toBe(404);
      const pinned = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/${path}@1` });
      expect(pinned.statusCode).toBe(404);
    });

    it("selects the highest published seq as latest, unaffected by a later failed attempt", async () => {
      const { app } = await makeTestApp();
      const cookie = await loginCookie(app);
      const venue = await createVenue(app, cookie, "Latest Selection");
      await uploadAndWait(app, cookie, venue.id, await buildMinimalImdfZip()); // seq 1: published
      await uploadAndWait(app, cookie, venue.id, new TextEncoder().encode("not a zip")); // seq 2: failed

      const latest = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/${path}` });
      expect(latest.statusCode).toBe(200);
      const pinned1 = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/${path}@1` });
      expect(pinned1.statusCode).toBe(200);
      expect(latest.headers["etag"]).toBe(pinned1.headers["etag"]); // latest is seq 1, the only published one

      const pinned2 = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/${path}@2` });
      expect(pinned2.statusCode).toBe(404); // seq 2 failed; never published
    });

    it("returns exact content-type/cache-control for latest and pinned, honors If-None-Match with 304, 404s an out-of-range seq", async () => {
      const { app } = await makeTestApp();
      const cookie = await loginCookie(app);
      const venue = await createVenue(app, cookie, "Header Matrix");
      await uploadAndWait(app, cookie, venue.id, await buildMinimalImdfZip());

      const latest = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/${path}` });
      expect(latest.statusCode).toBe(200);
      expect(latest.headers["content-type"]).toBe(contentType);
      expect(latest.headers["cache-control"]).toBe(LATEST_CACHE_CONTROL);
      const latestEtag = latest.headers["etag"] as string;
      expect(latestEtag).toMatch(/^"[0-9a-f]{64}"$/);
      const latestCached = await app.inject({
        method: "GET",
        url: `/v/default/${venue.slug}/${path}`,
        headers: { "if-none-match": latestEtag },
      });
      expect(latestCached.statusCode).toBe(304);

      const pinned = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/${path}@1` });
      expect(pinned.statusCode).toBe(200);
      expect(pinned.headers["content-type"]).toBe(contentType);
      expect(pinned.headers["cache-control"]).toBe(PINNED_CACHE_CONTROL);
      const pinnedEtag = pinned.headers["etag"] as string;
      expect(pinnedEtag).toMatch(/^"[0-9a-f]{64}"$/);
      expect(pinnedEtag).toBe(latestEtag); // only one published version, so latest === seq 1
      const pinnedCached = await app.inject({
        method: "GET",
        url: `/v/default/${venue.slug}/${path}@1`,
        headers: { "if-none-match": pinnedEtag },
      });
      expect(pinnedCached.statusCode).toBe(304);

      const outOfRange = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/${path}@99` });
      expect(outOfRange.statusCode).toBe(404);
    });
  });
}

describe("archive serving: byte content (transitional, source-only)", () => {
  it("serves each pinned version's exact original ZIP bytes, and latest matches the highest published seq", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venue = await createVenue(app, cookie, "Archive Bytes");
    const zip1 = await buildMinimalImdfZip();
    const zip2 = await buildMinimalImdfZip({ extraEntries: { "note.txt": "v2" } });
    await uploadAndWait(app, cookie, venue.id, zip1);
    await uploadAndWait(app, cookie, venue.id, zip2);

    const pinned1 = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/archive@1` });
    expect(Buffer.from(pinned1.rawPayload.subarray(0, 2))).toEqual(ZIP_MAGIC);
    expect(Buffer.from(pinned1.rawPayload)).toEqual(Buffer.from(zip1));

    const pinned2 = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/archive@2` });
    expect(Buffer.from(pinned2.rawPayload)).toEqual(Buffer.from(zip2));

    const latest = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/archive` });
    expect(Buffer.from(latest.rawPayload)).toEqual(Buffer.from(zip2)); // seq 2 is the latest published
  });
});

describe("bundle serving: byte content", () => {
  it("serves each pinned version as distinct KVB bytes, never ZIP magic, and latest matches the highest published seq", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venue = await createVenue(app, cookie, "Bundle Bytes");
    await uploadAndWait(app, cookie, venue.id, await buildMinimalImdfZip());
    await uploadAndWait(app, cookie, venue.id, await buildMinimalImdfZip({ extraEntries: { "note.txt": "v2" } }));

    const pinned1 = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/bundle@1` });
    const pinned2 = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/bundle@2` });
    expect(Buffer.from(pinned1.rawPayload.subarray(0, 4))).toEqual(KVB_MAGIC);
    expect(Buffer.from(pinned2.rawPayload.subarray(0, 4))).toEqual(KVB_MAGIC);
    expect(Buffer.from(pinned1.rawPayload.subarray(0, 2))).not.toEqual(ZIP_MAGIC);
    expect(pinned1.rawPayload).not.toEqual(pinned2.rawPayload); // distinct dataset/version embedded per bundle

    const latest = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/bundle` });
    expect(latest.rawPayload).toEqual(pinned2.rawPayload); // seq 2 is the latest published
  });
});
