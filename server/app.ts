import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { SESSION_COOKIE, newSessionToken, parseCookies, verifyPassword } from "./auth.js";
import { DATASET_ID_RE, PlatformStore } from "./store.js";
import type { CatalogEntry, CommentRecord, DatasetKind, UserRecord } from "./types.js";

export interface AppOptions {
  store: PlatformStore;
  /** Directory of the built frontend (dist). null = API only (tests). */
  appDir: string | null;
  maxUploadBytes?: number;
}

const DEFAULT_MAX_UPLOAD = 600 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".zip": "application/zip",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function ifNoneMatch(header: string | string[] | undefined, etag: string): boolean {
  const value = Array.isArray(header) ? header.join(",") : header;
  return (
    value !== undefined &&
    value
      .split(",")
      .some((candidate) => candidate.trim() === "*" || candidate.trim().replace(/^W\//, "") === etag)
  );
}

class BodyTooLarge extends Error {}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { code, message });
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    req.resume();
    reject(new BodyTooLarge());
    return promise;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = false;
  req.on("data", (chunk: Buffer) => {
    if (tooLarge) return;
    total += chunk.length;
    if (total > maxBytes) {
      tooLarge = true;
      chunks.length = 0;
      reject(new BodyTooLarge());
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (!tooLarge) resolve(Buffer.concat(chunks));
  });
  req.on("error", (error) => {
    if (!tooLarge) reject(error);
  });
  return promise;
}

function isZip(body: Buffer): boolean {
  return (
    body.length >= 4 &&
    body[0] === 0x50 &&
    body[1] === 0x4b &&
    body[2] === 0x03 &&
    body[3] === 0x04
  );
}

interface DatasetMeta {
  id: string;
  name: string;
  kind: DatasetKind;
  levelCount: number;
  featureCount: number;
  sourceName: string;
}

function parseDatasetMeta(id: string, query: URLSearchParams): DatasetMeta | null {
  if (!DATASET_ID_RE.test(id)) {
    return null;
  }
  const name = (query.get("name") ?? "").trim();
  if (name.length === 0 || name.length > 120) {
    return null;
  }
  const kind = query.get("kind");
  if (kind !== "venue-snapshot" && kind !== "imdf") {
    return null;
  }
  const levelCountRaw = query.get("levelCount");
  const featureCountRaw = query.get("featureCount");
  if (levelCountRaw === null || featureCountRaw === null) {
    return null;
  }
  const levelCount = Number(levelCountRaw);
  const featureCount = Number(featureCountRaw);
  if (
    !Number.isSafeInteger(levelCount) ||
    levelCount < 0 ||
    !Number.isSafeInteger(featureCount) ||
    featureCount < 0
  ) {
    return null;
  }
  const sourceName = (query.get("sourceName") ?? "").trim();
  if (sourceName.length === 0 || sourceName.length > 200) {
    return null;
  }
  return { id, name, kind, levelCount, featureCount, sourceName };
}

type CommentInput = Omit<CommentRecord, "id" | "createdAt" | "author">;

function parseCommentInput(raw: unknown): CommentInput | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const text = typeof record["text"] === "string" ? record["text"].trim() : "";
  if (text.length === 0 || text.length > 2000) {
    return null;
  }
  const out: CommentInput = { text };
  if (record["levelId"] !== undefined) {
    const levelId = record["levelId"];
    if (typeof levelId !== "string" || levelId.length === 0 || levelId.length > 200) {
      return null;
    }
    out.levelId = levelId;
  }
  if (record["lngLat"] !== undefined) {
    const lngLat = record["lngLat"];
    if (!Array.isArray(lngLat) || lngLat.length !== 2) {
      return null;
    }
    const [lng, lat] = lngLat as unknown[];
    if (
      typeof lng !== "number" ||
      typeof lat !== "number" ||
      !Number.isFinite(lng) ||
      !Number.isFinite(lat)
    ) {
      return null;
    }
    out.lngLat = [lng, lat];
  }
  if (record["featureId"] !== undefined) {
    const featureId = record["featureId"];
    if (typeof featureId !== "string" || featureId.length === 0 || featureId.length > 200) {
      return null;
    }
    out.featureId = featureId;
  }
  return out;
}

export function createApp(options: AppOptions): Server {
  const { store, appDir } = options;
  const maxUpload = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD;

  function account(req: IncomingMessage): UserRecord | null {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token === undefined) {
      return null;
    }
    const session = store.findSession(token);
    if (session === undefined) {
      return null;
    }
    return store.findUser(session.username) ?? null;
  }

  async function readJson(req: IncomingMessage): Promise<unknown> {
    const body = await readBody(req, 64 * 1024);
    try {
      return JSON.parse(body.toString("utf8")) as unknown;
    } catch {
      return null;
    }
  }

  async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = (await readJson(req)) as Record<string, unknown> | null;
    const username = typeof raw?.["username"] === "string" ? raw["username"] : "";
    const password = typeof raw?.["password"] === "string" ? raw["password"] : "";
    const user = store.findUser(username);
    if (user === undefined || !verifyPassword(password, user.salt, user.passwordHash)) {
      sendError(res, 401, "invalid_credentials", "Wrong username or password.");
      return;
    }
    const token = newSessionToken();
    await store.addSession({ token, username: user.username, createdAt: new Date().toISOString() });
    res.setHeader(
      "set-cookie",
      `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`,
    );
    sendJson(res, 200, { account: { username: user.username, role: user.role } });
  }

  async function handleLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token !== undefined) {
      await store.deleteSession(token);
    }
    res.setHeader(
      "set-cookie",
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    res.writeHead(204);
    res.end();
  }

  async function handlePutDataset(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
    query: URLSearchParams,
  ): Promise<void> {
    const user = account(req);
    if (user === null) {
      sendError(res, 401, "unauthenticated", "Sign in to publish datasets.");
      return;
    }
    if (user.role !== "admin") {
      sendError(res, 403, "forbidden", "Publishing requires an admin account.");
      return;
    }
    const meta = parseDatasetMeta(id, query);
    if (meta === null) {
      sendError(res, 400, "invalid_dataset", "Invalid dataset id or metadata.");
      return;
    }
    let body: Buffer;
    try {
      body = await readBody(req, maxUpload);
    } catch (error) {
      if (error instanceof BodyTooLarge) {
        sendError(res, 413, "too_large", "Upload exceeds the 600 MiB limit.");
        return;
      }
      throw error;
    }
    if (!isZip(body)) {
      sendError(res, 400, "not_a_zip", "The uploaded dataset must be a ZIP file.");
      return;
    }
    const entry: CatalogEntry = await store.putDataset(meta, body);
    sendJson(res, 200, { dataset: entry });
  }

  async function serveBlob(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const lease = store.acquireBlob(id);
    if (lease === undefined) {
      sendError(res, 404, "not_found", "Dataset not found.");
      return;
    }
    const { entry, path: file } = lease;
    const release = (): void => {
      void lease.release();
    };
    res.once("close", release);
    const etag = `"${entry.contentHash}"`;
    if (ifNoneMatch(req.headers["if-none-match"], etag)) {
      res.off("close", release);
      await lease.release();
      res.writeHead(304);
      res.end();
      return;
    }
    let info;
    try {
      info = await stat(file);
    } catch (error) {
      res.off("close", release);
      await lease.release();
      throw error;
    }
    if (res.destroyed) {
      res.off("close", release);
      await lease.release();
      return;
    }
    res.writeHead(200, {
      "content-type": "application/zip",
      "content-length": info.size,
      etag,
    });
    res.off("close", release);
    try {
      await pipeline(createReadStream(file), res);
    } catch (error) {
      if (!res.destroyed) throw error;
    } finally {
      await lease.release();
    }
  }

  async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
    if (appDir === null) {
      sendError(res, 404, "not_found", "Not found.");
      return;
    }
    const root = path.resolve(appDir);
    let rel: string;
    try {
      rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.slice(1));
    } catch {
      sendError(res, 404, "not_found", "Not found.");
      return;
    }
    let resolved = path.resolve(root, rel);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      sendError(res, 404, "not_found", "Not found.");
      return;
    }
    let info = await stat(resolved).catch(() => null);
    if (info === null || info.isDirectory()) {
      resolved = path.join(root, "index.html");
      info = await stat(resolved).catch(() => null);
      if (info === null) {
        sendError(res, 404, "not_found", "Not found.");
        return;
      }
    }
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(resolved)] ?? "application/octet-stream",
      "content-length": info.size,
    });
    try {
      await pipeline(createReadStream(resolved), res);
    } catch (error) {
      if (!res.destroyed) throw error;
    }
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    const segments = url.pathname.split("/").filter((segment) => segment !== "");

    if (url.pathname === "/api/login" && method === "POST") {
      await handleLogin(req, res);
      return;
    }
    if (url.pathname === "/api/logout" && method === "POST") {
      await handleLogout(req, res);
      return;
    }
    if (url.pathname === "/api/me" && method === "GET") {
      const user = account(req);
      if (user === null) {
        sendError(res, 401, "unauthenticated", "Not signed in.");
      } else {
        sendJson(res, 200, { account: { username: user.username, role: user.role } });
      }
      return;
    }
    if (url.pathname === "/api/catalog" && method === "GET") {
      sendJson(res, 200, { datasets: store.listCatalog() });
      return;
    }

    // /api/datasets/:id[/comments[/:cid]]
    if (segments[0] === "api" && segments[1] === "datasets" && segments[2] !== undefined) {
      const id = segments[2];
      if (!DATASET_ID_RE.test(id)) {
        sendError(res, 400, "invalid_dataset", "Invalid dataset id.");
        return;
      }
      if (segments.length === 3 && method === "PUT") {
        await handlePutDataset(req, res, id, url.searchParams);
        return;
      }
      if (segments.length === 3 && method === "DELETE") {
        const user = account(req);
        if (user === null) {
          sendError(res, 401, "unauthenticated", "Sign in to delete datasets.");
          return;
        }
        if (user.role !== "admin") {
          sendError(res, 403, "forbidden", "Deleting datasets requires an admin account.");
          return;
        }
        if (await store.deleteDataset(id)) {
          res.writeHead(204);
          res.end();
        } else {
          sendError(res, 404, "not_found", "Dataset not found.");
        }
        return;
      }
      if (segments[3] === "comments") {
        const expectedGeneration = store.getBlobSnapshot(id)?.entry;
        if (expectedGeneration === undefined) {
          sendError(res, 404, "not_found", "Dataset not found.");
          return;
        }
        if (segments.length === 4 && method === "GET") {
          sendJson(res, 200, { comments: await store.listComments(id) });
          return;
        }
        if (segments.length === 4 && method === "POST") {
          const user = account(req);
          if (user === null) {
            sendError(res, 401, "unauthenticated", "Sign in to comment.");
            return;
          }
          const input = parseCommentInput(await readJson(req));
          if (input === null) {
            sendError(res, 400, "invalid_comment", "Comment text must be 1-2000 characters.");
            return;
          }
          const comment = await store.addComment(
            id,
            { ...input, author: user.username },
            expectedGeneration,
          );
          if (comment === undefined) {
            sendError(
              res,
              409,
              "dataset_changed",
              "Dataset changed while the comment was submitted.",
            );
            return;
          }
          sendJson(res, 201, { comment });
          return;
        }
        if (segments.length === 5 && segments[4] !== undefined && method === "DELETE") {
          const user = account(req);
          if (user === null) {
            sendError(res, 401, "unauthenticated", "Sign in to delete comments.");
            return;
          }
          const existing = (await store.listComments(id)).find(
            (comment) => comment.id === segments[4],
          );
          if (existing === undefined) {
            sendError(res, 404, "not_found", "Comment not found.");
            return;
          }
          if (user.role !== "admin" && existing.author !== user.username) {
            sendError(res, 403, "forbidden", "Only the author or an admin can delete this comment.");
            return;
          }
          await store.deleteComment(id, segments[4]);
          res.writeHead(204);
          res.end();
          return;
        }
      }
      sendError(res, 404, "not_found", "Not found.");
      return;
    }

    // /datasets/:id.zip
    if (segments[0] === "datasets" && segments.length === 2 && method === "GET") {
      const file = segments[1] ?? "";
      if (file.endsWith(".zip")) {
        const id = file.slice(0, -4);
        if (!DATASET_ID_RE.test(id)) {
          sendError(res, 400, "invalid_dataset", "Invalid dataset id.");
          return;
        }
        await serveBlob(req, res, id);
        return;
      }
    }

    if (url.pathname.startsWith("/api/")) {
      sendError(res, 404, "not_found", "Unknown API route.");
      return;
    }
    if (method !== "GET") {
      sendError(res, 405, "method_not_allowed", "Method not allowed.");
      return;
    }
    await serveStatic(res, url.pathname);
  }

  return createServer((req, res) => {
    void route(req, res).catch((error: unknown) => {
      if (error instanceof BodyTooLarge) {
        if (!res.headersSent) {
          sendError(res, 413, "too_large", "Request body exceeds the allowed limit.");
        } else {
          res.destroy();
        }
        return;
      }
      console.error("[server] unhandled", error);
      if (!res.headersSent) {
        sendError(res, 500, "internal_error", "Unexpected server error.");
      } else {
        res.destroy();
      }
    });
  });
}
