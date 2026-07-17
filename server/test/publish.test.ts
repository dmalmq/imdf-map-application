import { afterEach, describe, expect, it } from "vitest";
import { buildMinimalImdfZip } from "../../tests/fixtures/buildMinimalImdfZip";
import { cleanupTestApps, loginCookie, makeTestApp } from "./helpers";

afterEach(cleanupTestApps);

async function createVenue(app: Awaited<ReturnType<typeof makeTestApp>>["app"], cookie: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/venues",
    headers: { cookie },
    payload: { name: "Test Station" },
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
  it("uploads an IMDF zip, publishes it, and exposes stats", async () => {
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
    const { jobId, seq } = upload.json();
    expect(seq).toBe(1);

    await app.queue.idle();

    const job = await app.inject({ method: "GET", url: `/api/jobs/${jobId}`, headers: { cookie } });
    expect(job.json().status).toBe("done");

    const list = await app.inject({ method: "GET", url: "/api/venues", headers: { cookie } });
    const latest = list.json().venues[0].latest;
    expect(latest.seq).toBe(1);
    expect(latest.status).toBe("published");
    expect(latest.stats.levels).toBe(3);
  });

  it("marks a garbage upload failed and keeps the venue unpublished", async () => {
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
    await app.queue.idle();

    const job = await app.inject({
      method: "GET",
      url: `/api/jobs/${upload.json().jobId}`,
      headers: { cookie },
    });
    expect(job.json().status).toBe("error");
    expect(job.json().error).toContain("ZIP");

    const list = await app.inject({ method: "GET", url: "/api/venues", headers: { cookie } });
    expect(list.json().venues[0].latest).toBeNull();
  });
});
