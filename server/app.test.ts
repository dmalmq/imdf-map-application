// @vitest-environment node
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { request, type IncomingMessage, type Server } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { hashPassword } from "./auth";
import { PlatformStore } from "./store";

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const PUT_QUERY = "name=Tokyo&kind=venue-snapshot&levelCount=2&featureCount=10&sourceName=T.gdb";

interface TestServer {
  base: string;
  server: Server;
  dataDir: string;
  store: PlatformStore;
}

const servers: Server[] = [];

async function boot(options?: { maxUploadBytes?: number; appDir?: string }): Promise<TestServer> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "gis-app-"));
  const store = await PlatformStore.open(dataDir);
  await store.upsertUser({ username: "admin", role: "admin", ...hashPassword("admin-pw") });
  await store.upsertUser({ username: "alice", role: "user", ...hashPassword("alice-pw") });
  const server = createApp({
    store,
    appDir: options?.appDir ?? null,
    ...(options?.maxUploadBytes !== undefined ? { maxUploadBytes: options.maxUploadBytes } : {}),
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { base: `http://127.0.0.1:${address.port}`, server, dataDir, store };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

async function login(base: string, username: string, password: string): Promise<string> {
  const response = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie") ?? "";
  return cookie.split(";")[0] ?? "";
}

async function chunkedPut(url: string, cookie: string, chunks: Buffer[]): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const req = request(url, { method: "PUT", headers: { cookie } }, (response) => {
    response.resume();
    response.on("end", () => resolve(response.statusCode ?? 0));
  });
  req.on("error", reject);
  for (const chunk of chunks) req.write(chunk);
  req.end();
  return promise;
}

interface PausedDownload {
  response: IncomingMessage;
  done: Promise<void>;
}

async function pausedDownload(url: string): Promise<PausedDownload> {
  const headers = Promise.withResolvers<PausedDownload>();
  const req = request(url, (response) => {
    const done = Promise.withResolvers<void>();
    response.pause();
    response.on("end", done.resolve);
    response.on("error", done.reject);
    headers.resolve({ response, done: done.promise });
  });
  req.on("error", headers.reject);
  req.end();
  return headers.promise;
}

describe("platform API", () => {
  it("login/me/logout lifecycle with bad-credential rejection", async () => {
    const { base } = await boot();
    const bad = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "nope" }),
    });
    expect(bad.status).toBe(401);
    const cookie = await login(base, "admin", "admin-pw");
    const me = await fetch(`${base}/api/me`, { headers: { cookie } });
    expect(await me.json()).toEqual({ account: { username: "admin", role: "admin" } });
    const out = await fetch(`${base}/api/logout`, { method: "POST", headers: { cookie } });
    expect(out.status).toBe(204);
    const meAfter = await fetch(`${base}/api/me`, { headers: { cookie } });
    expect(meAfter.status).toBe(401);
  });

  it("write-gating matrix: anonymous 401, user 403 on publish, admin 200", async () => {
    const { base } = await boot();
    const anon = await fetch(`${base}/api/datasets/tokyo?${PUT_QUERY}`, { method: "PUT", body: ZIP });
    expect(anon.status).toBe(401);
    const userCookie = await login(base, "alice", "alice-pw");
    const forbidden = await fetch(`${base}/api/datasets/tokyo?${PUT_QUERY}`, {
      method: "PUT",
      headers: { cookie: userCookie },
      body: ZIP,
    });
    expect(forbidden.status).toBe(403);
    const adminCookie = await login(base, "admin", "admin-pw");
    const ok = await fetch(`${base}/api/datasets/tokyo?${PUT_QUERY}`, {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: ZIP,
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { dataset: { id: string; name: string } };
    expect(body.dataset).toMatchObject({ id: "tokyo", name: "Tokyo" });
    const catalog = await fetch(`${base}/api/catalog`);
    expect(((await catalog.json()) as { datasets: unknown[] }).datasets).toHaveLength(1);
    // Delete gating mirrors publish gating.
    expect((await fetch(`${base}/api/datasets/tokyo`, { method: "DELETE" })).status).toBe(401);
    expect(
      (await fetch(`${base}/api/datasets/tokyo`, { method: "DELETE", headers: { cookie: userCookie } })).status,
    ).toBe(403);
  });

  it("serves the blob with an ETag and honors if-none-match", async () => {
    const { base } = await boot();
    const adminCookie = await login(base, "admin", "admin-pw");
    await fetch(`${base}/api/datasets/tokyo?${PUT_QUERY}`, {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: ZIP,
    });

    const blob = await fetch(`${base}/datasets/tokyo.zip`);
    expect(blob.status).toBe(200);
    expect(Buffer.from(await blob.arrayBuffer())).toEqual(ZIP);
    const etag = blob.headers.get("etag");
    expect(etag).toBeTruthy();
    const cached = await fetch(`${base}/datasets/tokyo.zip`, {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(cached.status).toBe(304);
    expect(await fetch(`${base}/datasets/missing.zip`).then((r) => r.status)).toBe(404);
  });

  it("leases paused downloads through overwrite and delete, then reclaims generations", async () => {
    const { base, store } = await boot();
    const adminCookie = await login(base, "admin", "admin-pw");
    const large = Buffer.alloc(16 * 1024 * 1024, 1);
    large[0] = 0x50;
    large[1] = 0x4b;
    large[2] = 0x03;
    large[3] = 0x04;
    await fetch(`${base}/api/datasets/tokyo?${PUT_QUERY}`, {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: large,
    });
    const firstPath = store.blobPath("tokyo");
    const firstDownload = await pausedDownload(`${base}/datasets/tokyo.zip`);
    const replacement = Buffer.alloc(16 * 1024 * 1024, 2);
    replacement[0] = 0x50;
    replacement[1] = 0x4b;
    replacement[2] = 0x03;
    replacement[3] = 0x04;
    expect(
      (
        await fetch(`${base}/api/datasets/tokyo?${PUT_QUERY}`, {
          method: "PUT",
          headers: { cookie: adminCookie },
          body: replacement,
        })
      ).status,
    ).toBe(200);
    expect(existsSync(firstPath)).toBe(true);
    firstDownload.response.resume();
    await firstDownload.done;
    await expect.poll(() => existsSync(firstPath)).toBe(false);

    const secondPath = store.blobPath("tokyo");
    const secondDownload = await pausedDownload(`${base}/datasets/tokyo.zip`);
    expect(
      (
        await fetch(`${base}/api/datasets/tokyo`, {
          method: "DELETE",
          headers: { cookie: adminCookie },
        })
      ).status,
    ).toBe(204);
    expect(existsSync(secondPath)).toBe(true);
    secondDownload.response.resume();
    await secondDownload.done;
    await expect.poll(() => existsSync(secondPath)).toBe(false);
  }, 30_000);

  it("releases a blob lease when the client aborts before streaming starts", async () => {
    const { base, store } = await boot();
    await store.putDataset(
      {
        id: "tokyo",
        name: "Tokyo",
        kind: "venue-snapshot",
        levelCount: 2,
        featureCount: 10,
        sourceName: "T.gdb",
      },
      ZIP,
    );
    const blobPath = store.blobPath("tokyo");
    const acquired = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    const originalAcquire = store.acquireBlob.bind(store);
    store.acquireBlob = (id) => {
      const lease = originalAcquire(id);
      acquired.resolve();
      return lease;
    };
    const client = request(`${base}/datasets/tokyo.zip`);
    client.on("error", () => undefined);
    client.on("close", closed.resolve);
    client.end();
    await acquired.promise;
    client.destroy();
    await closed.promise;
    store.acquireBlob = originalAcquire;
    expect(await store.deleteDataset("tokyo")).toBe(true);
    await expect.poll(() => existsSync(blobPath)).toBe(false);
  });

  it("rejects invalid publishes: bad id, bad meta, non-zip body, oversize", async () => {
    const { base } = await boot({ maxUploadBytes: 16 });
    const adminCookie = await login(base, "admin", "admin-pw");
    const headers = { cookie: adminCookie };
    expect(
      (await fetch(`${base}/api/datasets/Bad_ID?${PUT_QUERY}`, { method: "PUT", headers, body: ZIP })).status,
    ).toBe(400);
    expect(
      (await fetch(`${base}/api/datasets/tokyo?kind=venue-snapshot`, { method: "PUT", headers, body: ZIP })).status,
    ).toBe(400);
    expect(
      (
        await fetch(
          `${base}/api/datasets/tokyo?name=Tokyo&kind=venue-snapshot&sourceName=T.gdb`,
          { method: "PUT", headers, body: ZIP },
        )
      ).status,
    ).toBe(400);
    expect(
      (await fetch(`${base}/api/datasets/tokyo?${PUT_QUERY}`, { method: "PUT", headers, body: Buffer.from("not a zip at all") })).status,
    ).toBe(400);
    const big = Buffer.alloc(64, 1);
    big[0] = 0x50; big[1] = 0x4b; big[2] = 0x03; big[3] = 0x04;
    expect(
      (await fetch(`${base}/api/datasets/tokyo?${PUT_QUERY}`, { method: "PUT", headers, body: big })).status,
    ).toBe(413);
    expect(await chunkedPut(`${base}/api/datasets/tokyo?${PUT_QUERY}`, adminCookie, [ZIP, big])).toBe(413);
    expect(
      (
        await fetch(`${base}/api/datasets/Bad_ID`, {
          method: "DELETE",
          headers,
        })
      ).status,
    ).toBe(400);
    expect((await fetch(`${base}/datasets/Bad_ID.zip`)).status).toBe(400);
    expect((await fetch(`${base}/api/catalog`).then((r) => r.json()) as { datasets: unknown[] }).datasets).toEqual([]);
  });

  it("comments: user posts (author from session), owner/admin delete, foreign delete forbidden", async () => {
    const { base } = await boot();
    const adminCookie = await login(base, "admin", "admin-pw");
    await fetch(`${base}/api/datasets/tokyo?${PUT_QUERY}`, { method: "PUT", headers: { cookie: adminCookie }, body: ZIP });
    const userCookie = await login(base, "alice", "alice-pw");
    const anon = await fetch(`${base}/api/datasets/tokyo/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(anon.status).toBe(401);
    const posted = await fetch(`${base}/api/datasets/tokyo/comments`, {
      method: "POST",
      headers: { cookie: userCookie, "content-type": "application/json" },
      body: JSON.stringify({ text: "ここが狭い", levelId: "ordinal:0", lngLat: [139.76, 35.68], author: "spoofed" }),
    });
    expect(posted.status).toBe(201);
    const comment = ((await posted.json()) as { comment: { id: string; author: string } }).comment;
    expect(comment.author).toBe("alice");
    expect(
      (await fetch(`${base}/api/datasets/tokyo/comments/${comment.id}`, { method: "DELETE", headers: { cookie: adminCookie } })).status,
    ).toBe(204);
    const again = await fetch(`${base}/api/datasets/tokyo/comments`, {
      method: "POST",
      headers: { cookie: userCookie, "content-type": "application/json" },
      body: JSON.stringify({ text: "second" }),
    });
    const second = ((await again.json()) as { comment: { id: string } }).comment;
    const adminOwnCookie = adminCookie;
    const foreign = await fetch(`${base}/api/datasets/tokyo/comments/${second.id}`, { method: "DELETE" });
    expect(foreign.status).toBe(401);
    const ownerDelete = await fetch(`${base}/api/datasets/tokyo/comments/${second.id}`, { method: "DELETE", headers: { cookie: userCookie } });
    expect(ownerDelete.status).toBe(204);
    expect(adminOwnCookie).toBeTruthy();
    expect((await fetch(`${base}/api/datasets/missing/comments`).then((r) => r.status))).toBe(404);
    expect(
      (await fetch(`${base}/api/datasets/tokyo/comments`, {
        method: "POST",
        headers: { cookie: userCookie, "content-type": "application/json" },
        body: JSON.stringify({ text: "" }),
      })).status,
    ).toBe(400);
  });

  it("serves static app files with SPA fallback and no traversal", async () => {
    const appDir = await mkdtemp(path.join(tmpdir(), "gis-dist-"));
    await writeFile(path.join(appDir, "index.html"), "<html>app</html>");
    await writeFile(path.join(appDir, "main.js"), "console.log(1)");
    const { base } = await boot({ appDir });
    expect(await fetch(`${base}/`).then((r) => r.text())).toContain("app");
    const js = await fetch(`${base}/main.js`);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(await fetch(`${base}/?dataset=tokyo`).then((r) => r.text())).toContain("app");
    expect((await fetch(`${base}/..%2f..%2fsecret`)).status).not.toBe(200);
    expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(404);
  });

  it("returns a typed 413 for oversized JSON bodies", async () => {
    const { base } = await boot();
    const response = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "x".repeat(70 * 1024) }),
    });
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: "too_large" });
  });

  it("sessions survive a server restart (same data dir)", async () => {
    const first = await boot();
    const cookie = await login(first.base, "alice", "alice-pw");
    const store = await PlatformStore.open(first.dataDir);
    const server = createApp({ store, appDir: null });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    const me = await fetch(`http://127.0.0.1:${address.port}/api/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
  });
});
