import { afterEach, describe, expect, it } from "vitest";
import { buildMinimalImdfZip } from "../../tests/fixtures/buildMinimalImdfZip";
import { cleanupTestApps, loginCookie, makeTestApp } from "./helpers";

afterEach(cleanupTestApps);

describe("archive serving", () => {
  it("serves the latest published archive publicly with ETag and honors If-None-Match", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venueRes = await app.inject({
      method: "POST",
      url: "/api/venues",
      headers: { cookie },
      payload: { name: "Serve Station" },
    });
    const venue = venueRes.json().venue;
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

    const res = await app.inject({ method: "GET", url: `/v/default/${venue.slug}/archive` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.rawPayload.byteLength).toBe(zip.byteLength);
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
