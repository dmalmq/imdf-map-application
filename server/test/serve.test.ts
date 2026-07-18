import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildMinimalImdfZip } from "../../tests/fixtures/buildMinimalImdfZip";
import { cleanupTestApps, loginCookie, makeTestApp } from "./helpers";

afterEach(cleanupTestApps);

const KVB_MAGIC = Buffer.from([0x4b, 0x56, 0x42, 0x00]); // "KVB\0"
const ZIP_MAGIC = Buffer.from([0x50, 0x4b]); // "PK"

async function publishVenue(app: FastifyInstance, name: string) {
  const cookie = await loginCookie(app);
  const venueRes = await app.inject({
    method: "POST",
    url: "/api/venues",
    headers: { cookie },
    payload: { name },
  });
  const venue = venueRes.json().venue as { id: number; slug: string };
  const zip = await buildMinimalImdfZip();
  const boundary = "----kirikoServeBoundary";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="v.zip"\r\nContent-Type: application/zip\r\n\r\n`,
    ),
    Buffer.from(zip),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  await app.inject({
    method: "POST",
    url: `/api/venues/${venue.id}/versions`,
    headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  await app.queue.idle();
  return { venue, zip };
}

describe("archive serving (transitional, source-only)", () => {
  it("serves the latest published archive publicly with ETag and honors If-None-Match", async () => {
    const { app } = await makeTestApp();
    const { venue, zip } = await publishVenue(app, "Serve Station");

    const res = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/archive` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.rawPayload.byteLength).toBe(zip.byteLength);
    expect(Buffer.from(res.rawPayload.subarray(0, 2))).toEqual(ZIP_MAGIC);
    const etag = res.headers["etag"] as string;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);

    const cached = await app.inject({
      method: "GET",
      url: `/v/default/${venue.slug}/archive`,
      headers: { "if-none-match": etag },
    });
    expect(cached.statusCode).toBe(304);

    const pinned = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/archive@1` });
    expect(pinned.statusCode).toBe(200);
    expect(pinned.headers["cache-control"]).toContain("immutable");
  });

  it("404s for unknown venues and unpublished ones", async () => {
    const { app } = await makeTestApp();
    const missing = await app.inject({ method: "GET", url: "/v/default/nope/archive" });
    expect(missing.statusCode).toBe(404);
  });
});

describe("bundle serving", () => {
  it("serves the latest published bundle as KVB bytes with exact headers, and honors If-None-Match", async () => {
    const { app } = await makeTestApp();
    const { venue } = await publishVenue(app, "Bundle Station");

    const res = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/bundle` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/vnd.kiriko.bundle");
    expect(res.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
    expect(Buffer.from(res.rawPayload.subarray(0, 4))).toEqual(KVB_MAGIC);
    expect(Buffer.from(res.rawPayload.subarray(0, 2))).not.toEqual(ZIP_MAGIC);
    const etag = res.headers["etag"] as string;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);

    const cached = await app.inject({
      method: "GET",
      url: `/v/default/${venue.slug}/bundle`,
      headers: { "if-none-match": etag },
    });
    expect(cached.statusCode).toBe(304);
  });

  it("serves a pinned bundle version with immutable, one-year cache-control", async () => {
    const { app } = await makeTestApp();
    const { venue } = await publishVenue(app, "Pinned Bundle Station");

    const res = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/bundle@1` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/vnd.kiriko.bundle");
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(Buffer.from(res.rawPayload.subarray(0, 4))).toEqual(KVB_MAGIC);
  });

  it("404s for unknown venues, unpublished versions, and out-of-range pinned sequences", async () => {
    const { app } = await makeTestApp();
    const missing = await app.inject({ method: "GET", url: "/v/default/nope/bundle" });
    expect(missing.statusCode).toBe(404);

    const { venue } = await publishVenue(app, "Range Station");
    const outOfRange = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/bundle@99` });
    expect(outOfRange.statusCode).toBe(404);
  });
});
