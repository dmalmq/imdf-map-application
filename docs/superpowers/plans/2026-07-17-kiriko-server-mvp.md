# Kiriko Server MVP + Gallery Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running kiriko-server (auth, venues, IMDF upload → validate → publish, archive serving, OpenAPI) plus the web app's Gallery page consuming it.

**Architecture:** pnpm workspace: the existing Vite web app stays at the repo root (also the workspace root); a new `server/` package holds a single Fastify process with better-sqlite3, an in-process job queue, and a content-addressed blob directory. The gallery is a second root component in the existing React app, selected by URL (no router library). Published archives are public-read; everything under `/api` (except auth) requires a session. Server-side validation is structural only (zip/manifest/GeoJSON/stats) per spec §8.1 — deep validation stays in the viewer until the Rust core (Phase 2).

**Tech Stack:** Fastify 5 + @fastify/cookie + @fastify/multipart + @fastify/swagger, @sinclair/typebox (+ type provider), better-sqlite3, @zip.js/zip.js (already a web dep), vitest (`fastify.inject`, no ports), existing React 19 + Playwright setup.

## Global Constraints

- SQLite only — no Postgres, no Redis, no external queue (spec §4 ops posture).
- Blob keys are S3-compatible: `blobs/sha256/<first-2-hex>/<hash>` (spec §4 storage layout).
- Bundles/archives are immutable + content-addressed; publishing never overwrites (spec §4).
- OpenAPI-first: every `/api` route declares TypeBox schemas; spec served at `/api/openapi.json` (spec §4 API surface).
- TS strict mode everywhere, same compiler strictness as the root `tsconfig.json`.
- All user-facing web UI strings bilingual ja/en via the existing `ui = { key: { ja, en } }` pattern.
- Kiriko design tokens only (DESIGN.md): no new colors/shadows/radii; reuse `.btn-*`, `.chip`, `.kiriko-input`, `.floating-panel` styles where they fit.
- Server listens on `127.0.0.1:8790` by default; web dev/preview proxies `/api` and `/v` to it.
- Node ≥ 22 (repo already runs Node 26; `node:crypto` scrypt + native `Blob` required).
- Commit after every task; message style follows existing history (imperative, no scope prefixes).

## Existing files the engineer must know about

- `tests/fixtures/buildMinimalImdfZip.ts` — `buildMinimalImdfZip(): Promise<Uint8Array>`, deterministic valid IMDF zip (3 levels, warnings included). Reuse in server tests; never build new fixtures.
- `src/app/viewerParams.ts` — `parseViewerParams(search, base?)` returns `{ src, level, embed, locale }`. Task 8 extends it.
- `src/app/App.tsx` — the viewer; loads archives from `params.src` via `fetchImdfFile`. Unchanged except src derivation in Task 8.
- `src/app/app.css` — Kiriko tokens under `:root`; gallery styles append here.
- `e2e/helpers.ts` — Playwright helpers (`waitForReadyVenue`, etc.); gallery e2e adds to this file.
- `playwright.config.ts` — has a `webServer` entry (vite preview on 4173). Task 12 turns it into an array.

---

### Task 1: Workspace + server skeleton (healthz, DB, migrations, OpenAPI, test harness)

**Files:**
- Create: `pnpm-workspace.yaml`
- Modify: `package.json` (root: add workspace-aware scripts)
- Create: `server/package.json`, `server/tsconfig.json`
- Create: `server/src/config.ts`, `server/src/db/db.ts`, `server/src/db/migrate.ts`, `server/src/db/migrations/001_init.sql`
- Create: `server/src/app.ts`, `server/src/index.ts`
- Create: `server/test/helpers.ts`
- Test: `server/test/app.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `buildApp(config: AppConfig): Promise<FastifyInstance>` (server/src/app.ts); `AppConfig = { dataDir: string; sessionTtlDays: number; bootstrapUser?: string; bootstrapPassword?: string }` (server/src/config.ts, `configFromEnv(): AppConfig & { port: number }`); `openDb(dataDir): Database.Database` + `migrate(db): void`; test helper `makeTestApp(): Promise<{ app: FastifyInstance; dataDir: string }>` seeding bootstrap user `test`/`test-password`.

- [ ] **Step 1: Create workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "."
  - "server"
```

`server/package.json`:
```json
{
  "name": "kiriko-server",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest"
  }
}
```

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "test", "../tests/fixtures"]
}
```

Root `package.json`: add to `"scripts"`: `"dev:server": "pnpm --filter kiriko-server dev"`, `"test:server": "pnpm --filter kiriko-server test -- --run"`.

- [ ] **Step 2: Install server dependencies**

```bash
pnpm --filter kiriko-server add fastify @fastify/cookie @fastify/multipart @fastify/swagger @fastify/type-provider-typebox @sinclair/typebox better-sqlite3 @zip.js/zip.js
pnpm --filter kiriko-server add -D tsx typescript vitest @types/node @types/better-sqlite3
```

- [ ] **Step 3: Write the failing test**

`server/test/app.test.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, cleanupTestApps } from "./helpers";

afterEach(cleanupTestApps);

describe("app skeleton", () => {
  it("answers healthz and serves an OpenAPI document", async () => {
    const { app } = await makeTestApp();
    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });

    const spec = await app.inject({ method: "GET", url: "/api/openapi.json" });
    expect(spec.statusCode).toBe(200);
    expect(spec.json().openapi).toMatch(/^3\./);
  });

  it("runs migrations idempotently", async () => {
    const { app, dataDir } = await makeTestApp();
    const { openDb, migrate } = await import("../src/db/migrate-reexport");
    const db = openDb(dataDir);
    migrate(db); // second run must be a no-op, not an error
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining(["blobs", "jobs", "sessions", "tenants", "users", "venues", "versions"]),
    );
    db.close();
    await app.close();
  });
});
```

`server/test/helpers.ts`:
```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

const cleanups: Array<() => Promise<void>> = [];

export const TEST_USER = "test";
export const TEST_PASSWORD = "test-password";

export async function makeTestApp(): Promise<{ app: FastifyInstance; dataDir: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), "kiriko-test-"));
  const app = await buildApp({
    dataDir,
    sessionTtlDays: 30,
    bootstrapUser: TEST_USER,
    bootstrapPassword: TEST_PASSWORD,
  });
  cleanups.push(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { app, dataDir };
}

export async function cleanupTestApps(): Promise<void> {
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
}

/** Logs in as the bootstrap user; returns the session cookie header value. */
export async function loginCookie(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: TEST_USER, password: TEST_PASSWORD },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  }
  const cookie = res.cookies.find((c) => c.name === "kiriko_session");
  if (!cookie) {
    throw new Error("no session cookie set");
  }
  return `kiriko_session=${cookie.value}`;
}
```

(`loginCookie` fails until Task 2 — only `app.test.ts` runs now.)

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter kiriko-server test -- --run`
Expected: FAIL — cannot resolve `../src/app`.

- [ ] **Step 5: Implement config, db, migrations, app**

`server/src/config.ts`:
```ts
export interface AppConfig {
  dataDir: string;
  sessionTtlDays: number;
  bootstrapUser?: string;
  bootstrapPassword?: string;
}

export function configFromEnv(): AppConfig & { port: number } {
  const config: AppConfig & { port: number } = {
    dataDir: process.env["KIRIKO_DATA_DIR"] ?? "./data",
    sessionTtlDays: 30,
    port: Number(process.env["KIRIKO_PORT"] ?? 8790),
  };
  const user = process.env["KIRIKO_BOOTSTRAP_USER"];
  const password = process.env["KIRIKO_BOOTSTRAP_PASSWORD"];
  if (user !== undefined && password !== undefined) {
    config.bootstrapUser = user;
    config.bootstrapPassword = password;
  }
  return config;
}
```

`server/src/db/migrations/001_init.sql`:
```sql
CREATE TABLE tenants (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO tenants (id, slug, name) VALUES (1, 'default', 'JRE Internal');

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','viewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE venues (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE versions (
  id INTEGER PRIMARY KEY,
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  source_blob_hash TEXT NOT NULL,
  bundle_hash TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','failed','archived')),
  source_kind TEXT NOT NULL DEFAULT 'imdf' CHECK (source_kind IN ('imdf','gdb')),
  stats_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (venue_id, seq)
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','error')),
  payload_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE blobs (
  hash TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

(Diverges from spec §4 deliberately: no `api_keys`/`comments` tables yet — migrations are additive and those arrive in their phases; `versions.source_blob_hash` added for source retention; status gains `failed`.)

`server/src/db/db.ts`:
```ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function openDb(dataDir: string): Database.Database {
  mkdirSync(join(dataDir, "data"), { recursive: true });
  const db = new Database(join(dataDir, "data", "kiriko.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}
```

`server/src/db/migrate.ts`:
```ts
import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export function migrate(db: Database.Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const applied = new Set(
    db.prepare("SELECT name FROM schema_migrations").all().map((r) => (r as { name: string }).name),
  );
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    if (!file.endsWith(".sql") || applied.has(file)) {
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(file);
    });
    run();
  }
}
```

`server/src/db/migrate-reexport.ts` (test convenience):
```ts
export { openDb } from "./db";
export { migrate } from "./migrate";
```

`server/src/app.ts`:
```ts
import fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { AppConfig } from "./config";
import { openDb } from "./db/db";
import { migrate } from "./db/migrate";

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const db = openDb(config.dataDir);
  migrate(db);

  const app = fastify({ logger: { level: process.env["NODE_ENV"] === "test" ? "warn" : "info" } })
    .withTypeProvider<TypeBoxTypeProvider>();

  app.decorate("db", db);
  app.decorate("config", config);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 1 } });
  await app.register(swagger, {
    openapi: { info: { title: "Kiriko API", version: "0.1.0" } },
  });

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/api/openapi.json", async () => app.swagger());

  app.addHook("onClose", async () => {
    db.close();
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    db: import("better-sqlite3").Database;
    config: AppConfig;
  }
}
```

`server/src/index.ts`:
```ts
import { buildApp } from "./app";
import { configFromEnv } from "./config";

const config = configFromEnv();
const app = await buildApp(config);
await app.listen({ host: "127.0.0.1", port: config.port });
app.log.info(`kiriko-server on http://127.0.0.1:${config.port}`);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter kiriko-server test -- --run`
Expected: PASS (2 tests). Also run `pnpm --filter kiriko-server typecheck` — clean.

- [ ] **Step 7: Verify the root web app still works**

Run: `pnpm typecheck && pnpm test -- --run`
Expected: unchanged pass (workspace conversion must not break the web app).

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml server/
git commit -m "kiriko-server skeleton: workspace, SQLite migrations, healthz, OpenAPI"
```

---

### Task 2: Auth — passwords, sessions, login/logout/me, guard, bootstrap user

**Files:**
- Create: `server/src/auth/passwords.ts`, `server/src/auth/sessions.ts`, `server/src/auth/routes.ts`, `server/src/auth/guard.ts`, `server/src/auth/bootstrap.ts`
- Modify: `server/src/app.ts` (register auth routes + bootstrap)
- Test: `server/test/auth.test.ts`

**Interfaces:**
- Consumes: `app.db`, `app.config` from Task 1; `makeTestApp`, `loginCookie`, `TEST_USER`, `TEST_PASSWORD` from helpers.
- Produces: `hashPassword(password): string` / `verifyPassword(password, stored): boolean`; `createSession(db, userId, ttlDays): string` (returns raw token) / `sessionUser(db, token): SessionUser | null` / `destroySession(db, token): void` where `SessionUser = { id: number; username: string; role: string }`; `requireSession` Fastify preHandler that sets `request.user: SessionUser` or replies 401 `{ error: "unauthorized" }`; routes `POST /api/auth/login` → `{ user }` + cookie `kiriko_session` (httpOnly, SameSite=Lax, path=/), `POST /api/auth/logout` → 204, `GET /api/auth/me` → `{ user }` | 401; `ensureBootstrapUser(db, config): void` creates an admin when `users` is empty and bootstrap env is present.

- [ ] **Step 1: Write the failing tests**

`server/test/auth.test.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTestApps, loginCookie, makeTestApp, TEST_PASSWORD, TEST_USER } from "./helpers";

afterEach(cleanupTestApps);

describe("auth", () => {
  it("rejects bad credentials and accepts the bootstrap user", async () => {
    const { app } = await makeTestApp();
    const bad = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: TEST_USER, password: "wrong" },
    });
    expect(bad.statusCode).toBe(401);

    const good = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: TEST_USER, password: TEST_PASSWORD },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().user.username).toBe(TEST_USER);
    expect(good.json().user.role).toBe("admin");
    expect(good.cookies.some((c) => c.name === "kiriko_session" && c.httpOnly)).toBe(true);
  });

  it("me reflects the session; logout invalidates it", async () => {
    const { app } = await makeTestApp();
    const anon = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(anon.statusCode).toBe(401);

    const cookie = await loginCookie(app);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe(TEST_USER);

    const out = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(out.statusCode).toBe(204);
    const after = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter kiriko-server test -- --run test/auth.test.ts`
Expected: FAIL — 404 on `/api/auth/login`.

- [ ] **Step 3: Implement auth**

`server/src/auth/passwords.ts`:
```ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Format: scrypt$<salt-hex>$<hash-hex> */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) {
    return false;
  }
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}
```

`server/src/auth/sessions.ts`:
```ts
import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

export interface SessionUser {
  id: number;
  username: string;
  role: string;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(db: Database.Database, userId: number, ttlDays: number): string {
  const token = randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))",
  ).run(tokenHash(token), userId, `+${ttlDays} days`);
  return token;
}

export function sessionUser(db: Database.Database, token: string): SessionUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
    )
    .get(tokenHash(token));
  return (row as SessionUser | undefined) ?? null;
}

export function destroySession(db: Database.Database, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}
```

`server/src/auth/guard.ts`:
```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { sessionUser, type SessionUser } from "./sessions";

export async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies["kiriko_session"];
  const user = token ? sessionUser(request.server.db, token) : null;
  if (user === null) {
    await reply.code(401).send({ error: "unauthorized" });
    return;
  }
  request.user = user;
}

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser;
  }
}
```

`server/src/auth/bootstrap.ts`:
```ts
import type Database from "better-sqlite3";
import type { AppConfig } from "../config";
import { hashPassword } from "./passwords";

export function ensureBootstrapUser(db: Database.Database, config: AppConfig): void {
  if (config.bootstrapUser === undefined || config.bootstrapPassword === undefined) {
    return;
  }
  const count = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (count > 0) {
    return;
  }
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(
    config.bootstrapUser,
    hashPassword(config.bootstrapPassword),
  );
}
```

`server/src/auth/routes.ts`:
```ts
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { createSession, destroySession } from "./sessions";
import { requireSession } from "./guard";
import { verifyPassword } from "./passwords";

const UserSchema = Type.Object({
  id: Type.Number(),
  username: Type.String(),
  role: Type.String(),
});

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post(
    "/api/auth/login",
    {
      schema: {
        body: Type.Object({ username: Type.String(), password: Type.String() }),
        response: { 200: Type.Object({ user: UserSchema }) },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body as { username: string; password: string };
      const row = request.server.db
        .prepare("SELECT id, username, role, password_hash FROM users WHERE username = ?")
        .get(username) as
        | { id: number; username: string; role: string; password_hash: string }
        | undefined;
      if (!row || !verifyPassword(password, row.password_hash)) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      const token = createSession(request.server.db, row.id, request.server.config.sessionTtlDays);
      void reply.setCookie("kiriko_session", token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: request.server.config.sessionTtlDays * 24 * 60 * 60,
      });
      return { user: { id: row.id, username: row.username, role: row.role } };
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies["kiriko_session"];
    if (token) {
      destroySession(request.server.db, token);
    }
    void reply.clearCookie("kiriko_session", { path: "/" });
    return reply.code(204).send();
  });

  app.get(
    "/api/auth/me",
    { preHandler: requireSession, schema: { response: { 200: Type.Object({ user: UserSchema }) } } },
    async (request) => ({ user: request.user }),
  );
}
```

In `server/src/app.ts`, after the swagger registration add:
```ts
import { ensureBootstrapUser } from "./auth/bootstrap";
import { registerAuthRoutes } from "./auth/routes";
// ...
ensureBootstrapUser(db, config);
registerAuthRoutes(app);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter kiriko-server test -- --run`
Expected: PASS (auth + skeleton tests).

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "kiriko-server auth: scrypt passwords, cookie sessions, bootstrap admin"
```

---

### Task 3: Content-addressed blob store

**Files:**
- Create: `server/src/blobs/store.ts`
- Test: `server/test/blobs.test.ts`

**Interfaces:**
- Consumes: `AppConfig.dataDir`.
- Produces: `class BlobStore { constructor(dataDir: string); put(bytes: Uint8Array): { hash: string; size: number }; path(hash: string): string; has(hash: string): boolean; read(hash: string): Buffer }`. Layout: `<dataDir>/blobs/sha256/<hash[0..2]>/<hash>`. `put` is idempotent (same bytes → same hash, no rewrite) and atomic (tmp file + rename). Registered on the app as `app.blobs` in this task.

- [ ] **Step 1: Write the failing test**

`server/test/blobs.test.ts`:
```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BlobStore } from "../src/blobs/store";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("BlobStore", () => {
  it("stores content-addressed, idempotent, readable", () => {
    dir = mkdtempSync(join(tmpdir(), "kiriko-blob-"));
    const store = new BlobStore(dir);
    const bytes = new TextEncoder().encode("kiriko");
    const a = store.put(bytes);
    const b = store.put(bytes);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.size).toBe(6);
    expect(store.has(a.hash)).toBe(true);
    expect(store.read(a.hash).toString()).toBe("kiriko");
    expect(store.path(a.hash)).toContain(join("blobs", "sha256", a.hash.slice(0, 2), a.hash));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter kiriko-server test -- --run test/blobs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`server/src/blobs/store.ts`:
```ts
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class BlobStore {
  private readonly root: string;

  constructor(dataDir: string) {
    this.root = join(dataDir, "blobs", "sha256");
  }

  path(hash: string): string {
    return join(this.root, hash.slice(0, 2), hash);
  }

  has(hash: string): boolean {
    return existsSync(this.path(hash));
  }

  read(hash: string): Buffer {
    return readFileSync(this.path(hash));
  }

  put(bytes: Uint8Array): { hash: string; size: number } {
    const hash = createHash("sha256").update(bytes).digest("hex");
    const target = this.path(hash);
    if (!existsSync(target)) {
      const dir = join(this.root, hash.slice(0, 2));
      mkdirSync(dir, { recursive: true });
      const tmp = join(dir, `.tmp-${randomBytes(6).toString("hex")}`);
      writeFileSync(tmp, bytes);
      renameSync(tmp, target);
    }
    return { hash, size: bytes.byteLength };
  }
}
```

In `server/src/app.ts`: `app.decorate("blobs", new BlobStore(config.dataDir));` and extend the module declaration with `blobs: BlobStore;`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter kiriko-server test -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "kiriko-server blob store: content-addressed, atomic, idempotent"
```

---

### Task 4: Venues CRUD

**Files:**
- Create: `server/src/venues/service.ts`, `server/src/venues/routes.ts`
- Modify: `server/src/app.ts` (register)
- Test: `server/test/venues.test.ts`

**Interfaces:**
- Consumes: `requireSession` (Task 2), `app.db`.
- Produces: service functions `listVenues(db, tenantId): VenueSummary[]`, `createVenue(db, tenantId, name, userId): VenueRow`, `deleteVenue(db, tenantId, venueId): boolean`, `slugify(name): string`; types `VenueRow = { id: number; slug: string; name: string; createdAt: string }`, `VenueSummary = VenueRow & { latest: { seq: number; status: string; stats: VersionStats | null; createdAt: string } | null }`, `VersionStats = { levels: number; features: number }`. Routes (all `requireSession`, tenant fixed to 1 in phase 1): `GET /api/venues` → `{ venues: VenueSummary[] }`; `POST /api/venues` body `{ name }` → 201 `{ venue: VenueRow }` (slug auto-generated, `-2`/`-3`… suffix on collision); `DELETE /api/venues/:id` → 204 | 404.

- [ ] **Step 1: Write the failing tests**

`server/test/venues.test.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTestApps, loginCookie, makeTestApp } from "./helpers";

afterEach(cleanupTestApps);

describe("venues", () => {
  it("requires a session", async () => {
    const { app } = await makeTestApp();
    const res = await app.inject({ method: "GET", url: "/api/venues" });
    expect(res.statusCode).toBe(401);
  });

  it("creates with slugs, lists, and deletes", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/venues",
      headers: { cookie },
      payload: { name: "Shinjuku Station 構内図" },
    });
    expect(created.statusCode).toBe(201);
    const venue = created.json().venue;
    expect(venue.slug).toBe("shinjuku-station");

    // Same name → suffixed slug, not a 500.
    const again = await app.inject({
      method: "POST",
      url: "/api/venues",
      headers: { cookie },
      payload: { name: "Shinjuku Station" },
    });
    expect(again.json().venue.slug).toBe("shinjuku-station-2");

    const list = await app.inject({ method: "GET", url: "/api/venues", headers: { cookie } });
    expect(list.json().venues).toHaveLength(2);
    expect(list.json().venues[0].latest).toBeNull();

    const del = await app.inject({
      method: "DELETE",
      url: `/api/venues/${venue.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    const afterDelete = await app.inject({ method: "GET", url: "/api/venues", headers: { cookie } });
    expect(afterDelete.json().venues).toHaveLength(1);

    const missing = await app.inject({
      method: "DELETE",
      url: `/api/venues/${venue.id}`,
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter kiriko-server test -- --run test/venues.test.ts`
Expected: FAIL — 404 on `/api/venues`.

- [ ] **Step 3: Implement**

`server/src/venues/service.ts`:
```ts
import type Database from "better-sqlite3";

export interface VersionStats {
  levels: number;
  features: number;
}

export interface VenueRow {
  id: number;
  slug: string;
  name: string;
  createdAt: string;
}

export interface VenueSummary extends VenueRow {
  latest: { seq: number; status: string; stats: VersionStats | null; createdAt: string } | null;
}

/** ASCII-only slug; non-latin names fall back to "venue". */
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base !== "" ? base : "venue";
}

export function createVenue(
  db: Database.Database,
  tenantId: number,
  name: string,
  userId: number,
): VenueRow {
  const base = slugify(name);
  for (let n = 1; ; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    try {
      const info = db
        .prepare("INSERT INTO venues (tenant_id, slug, name, created_by) VALUES (?, ?, ?, ?)")
        .run(tenantId, slug, name, userId);
      const row = db
        .prepare("SELECT id, slug, name, created_at AS createdAt FROM venues WHERE id = ?")
        .get(info.lastInsertRowid) as VenueRow;
      return row;
    } catch (error) {
      if ((error as { code?: string }).code !== "SQLITE_CONSTRAINT_UNIQUE") {
        throw error;
      }
    }
  }
}

export function listVenues(db: Database.Database, tenantId: number): VenueSummary[] {
  const venues = db
    .prepare(
      "SELECT id, slug, name, created_at AS createdAt FROM venues WHERE tenant_id = ? ORDER BY created_at DESC, id DESC",
    )
    .all(tenantId) as VenueRow[];
  const latestStmt = db.prepare(
    `SELECT seq, status, stats_json AS statsJson, created_at AS createdAt
     FROM versions WHERE venue_id = ? AND status = 'published'
     ORDER BY seq DESC LIMIT 1`,
  );
  return venues.map((venue) => {
    const latest = latestStmt.get(venue.id) as
      | { seq: number; status: string; statsJson: string | null; createdAt: string }
      | undefined;
    return {
      ...venue,
      latest: latest
        ? {
            seq: latest.seq,
            status: latest.status,
            stats: latest.statsJson ? (JSON.parse(latest.statsJson) as VersionStats) : null,
            createdAt: latest.createdAt,
          }
        : null,
    };
  });
}

export function deleteVenue(db: Database.Database, tenantId: number, venueId: number): boolean {
  const info = db
    .prepare("DELETE FROM venues WHERE id = ? AND tenant_id = ?")
    .run(venueId, tenantId);
  return info.changes > 0;
}
```

`server/src/venues/routes.ts`:
```ts
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { requireSession } from "../auth/guard";
import { createVenue, deleteVenue, listVenues } from "./service";

const TENANT_ID = 1; // single tenant in phase 1

export function registerVenueRoutes(app: FastifyInstance): void {
  app.get("/api/venues", { preHandler: requireSession }, async (request) => ({
    venues: listVenues(request.server.db, TENANT_ID),
  }));

  app.post(
    "/api/venues",
    {
      preHandler: requireSession,
      schema: { body: Type.Object({ name: Type.String({ minLength: 1, maxLength: 200 }) }) },
    },
    async (request, reply) => {
      const { name } = request.body as { name: string };
      const venue = createVenue(request.server.db, TENANT_ID, name, request.user.id);
      return reply.code(201).send({ venue });
    },
  );

  app.delete(
    "/api/venues/:id",
    {
      preHandler: requireSession,
      schema: { params: Type.Object({ id: Type.Integer() }) },
    },
    async (request, reply) => {
      const { id } = request.params as { id: number };
      const deleted = deleteVenue(request.server.db, TENANT_ID, id);
      return deleted ? reply.code(204).send() : reply.code(404).send({ error: "not_found" });
    },
  );
}
```

Register in `app.ts`: `registerVenueRoutes(app);`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter kiriko-server test -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "kiriko-server venues: tenant-scoped CRUD with slug collision handling"
```

---

### Task 5: IMDF structural validation (Node)

**Files:**
- Create: `server/src/imdf/validateArchive.ts`
- Test: `server/test/validateArchive.test.ts`

**Interfaces:**
- Consumes: `tests/fixtures/buildMinimalImdfZip.ts` (root fixture) in tests.
- Produces: `validateImdfArchive(bytes: Uint8Array): Promise<ImdfStats>` where `ImdfStats = { levels: number; features: number; language: string | null; venueName: string | null }`; throws `ImdfValidationError` with `code: "not_zip" | "too_large" | "missing_file" | "bad_json" | "bad_manifest"` and a human message. Structural checks only (spec §8.1): zip magic, ≤ 200 MB, `manifest.json` + `venue.geojson` + `level.geojson` + `unit.geojson` present (possibly nested one folder deep), every `*.geojson` entry parses as a FeatureCollection, stats counted. **No IMDF semantic validation** — that stays in the viewer until Phase 2.

- [ ] **Step 1: Write the failing tests**

`server/test/validateArchive.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildMinimalImdfZip } from "../../tests/fixtures/buildMinimalImdfZip";
import { ImdfValidationError, validateImdfArchive } from "../src/imdf/validateArchive";

describe("validateImdfArchive", () => {
  it("accepts the minimal fixture and reports stats", async () => {
    const stats = await validateImdfArchive(await buildMinimalImdfZip());
    expect(stats.levels).toBe(3);
    expect(stats.features).toBeGreaterThan(10);
    expect(stats.language).toBe("ja-JP");
    expect(stats.venueName).toBe("東京駅テスト会場");
  });

  it("rejects non-zip bytes with not_zip", async () => {
    await expect(validateImdfArchive(new TextEncoder().encode("nope"))).rejects.toMatchObject({
      code: "not_zip",
    });
  });

  it("rejects a zip without manifest.json with missing_file", async () => {
    const { BlobWriter, TextReader, ZipWriter } = await import("@zip.js/zip.js");
    const writer = new ZipWriter(new BlobWriter("application/zip"));
    await writer.add("venue.geojson", new TextReader('{"type":"FeatureCollection","features":[]}'));
    const blob = await writer.close();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await expect(validateImdfArchive(bytes)).rejects.toMatchObject({ code: "missing_file" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter kiriko-server test -- --run test/validateArchive.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`server/src/imdf/validateArchive.ts`:
```ts
import { BlobReader, TextWriter, ZipReader, type Entry } from "@zip.js/zip.js";

export interface ImdfStats {
  levels: number;
  features: number;
  language: string | null;
  venueName: string | null;
}

export type ImdfValidationCode = "not_zip" | "too_large" | "missing_file" | "bad_json" | "bad_manifest";

export class ImdfValidationError extends Error {
  constructor(
    public readonly code: ImdfValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "ImdfValidationError";
  }
}

export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const REQUIRED = ["manifest.json", "venue.geojson", "level.geojson", "unit.geojson"];

/** Matches `name` at the archive root or nested exactly one folder deep. */
function findEntry(entries: Entry[], name: string): Entry | undefined {
  return entries.find((e) => {
    if (e.directory) {
      return false;
    }
    const parts = e.filename.split("/");
    return parts[parts.length - 1] === name && parts.length <= 2;
  });
}

async function readJson(entry: Entry): Promise<unknown> {
  const text = await entry.getData!(new TextWriter());
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ImdfValidationError("bad_json", `${entry.filename} is not valid JSON`);
  }
}

function featureCount(parsed: unknown, filename: string): number {
  const fc = parsed as { type?: string; features?: unknown[] };
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    throw new ImdfValidationError("bad_json", `${filename} is not a FeatureCollection`);
  }
  return fc.features.length;
}

export async function validateImdfArchive(bytes: Uint8Array): Promise<ImdfStats> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new ImdfValidationError("too_large", "archive exceeds 200 MB");
  }
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ImdfValidationError("not_zip", "not a ZIP archive");
  }

  const reader = new ZipReader(new BlobReader(new Blob([bytes])));
  try {
    const entries = await reader.getEntries();

    for (const name of REQUIRED) {
      if (!findEntry(entries, name)) {
        throw new ImdfValidationError("missing_file", `archive is missing ${name}`);
      }
    }

    const manifest = (await readJson(findEntry(entries, "manifest.json")!)) as {
      version?: unknown;
      language?: unknown;
    };
    if (typeof manifest.version !== "string") {
      throw new ImdfValidationError("bad_manifest", "manifest.json has no version");
    }
    const language = typeof manifest.language === "string" ? manifest.language : null;

    let features = 0;
    let levels = 0;
    let venueName: string | null = null;
    for (const entry of entries) {
      if (entry.directory || !entry.filename.endsWith(".geojson")) {
        continue;
      }
      const parsed = await readJson(entry);
      const count = featureCount(parsed, entry.filename);
      features += count;
      const base = entry.filename.split("/").pop()!;
      if (base === "level.geojson") {
        levels = count;
      }
      if (base === "venue.geojson") {
        const first = (parsed as { features: Array<{ properties?: { name?: Record<string, string> } }> })
          .features[0];
        const names = first?.properties?.name;
        if (names) {
          venueName = names[language ?? ""] ?? Object.values(names)[0] ?? null;
        }
      }
    }

    return { levels, features, language, venueName };
  } finally {
    await reader.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter kiriko-server test -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "kiriko-server IMDF structural validation with stats"
```

---

### Task 6: Upload + publish pipeline (jobs)

**Files:**
- Create: `server/src/jobs/queue.ts`, `server/src/jobs/publish.ts`, `server/src/jobs/routes.ts`
- Create: `server/src/venues/uploadRoute.ts`
- Modify: `server/src/app.ts` (queue wiring, route registration)
- Test: `server/test/publish.test.ts`

**Interfaces:**
- Consumes: `BlobStore` (Task 3), `validateImdfArchive`/`ImdfValidationError` (Task 5), `requireSession` (Task 2).
- Produces: `class JobQueue { constructor(db, runners: Record<string, (payloadJson: string) => Promise<unknown>>); enqueue(kind: string, payload: unknown): string; idle(): Promise<void> }` — serial in-process execution, rows in `jobs`; `makePublishRunner(db, blobs)` for kind `"publish_imdf"` with payload `{ versionId: number }`: reads the source blob → `validateImdfArchive` → on success sets version `status='published'`, `bundle_hash=source_blob_hash`, `stats_json`; on `ImdfValidationError` sets `status='failed'`, `error=message`, and rethrows so the job records `error`. Routes: `POST /api/venues/:id/versions` (multipart, field `file`) → 202 `{ jobId, versionId, seq }`; `GET /api/jobs/:id` → `{ id, kind, status, error, result }` | 404. App decorates `app.queue`, exposed for tests via `app.queue.idle()`.

- [ ] **Step 1: Write the failing tests**

`server/test/publish.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter kiriko-server test -- --run test/publish.test.ts`
Expected: FAIL — 404 on versions route.

- [ ] **Step 3: Implement**

`server/src/jobs/queue.ts`:
```ts
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type JobRunner = (payloadJson: string) => Promise<unknown>;

export class JobQueue {
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Database.Database,
    private readonly runners: Record<string, JobRunner>,
  ) {}

  enqueue(kind: string, payload: unknown): string {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO jobs (id, kind, payload_json) VALUES (?, ?, ?)")
      .run(id, kind, JSON.stringify(payload));
    this.chain = this.chain.then(() => this.run(id, kind));
    return id;
  }

  /** Resolves when every enqueued job has finished (tests, shutdown). */
  idle(): Promise<void> {
    return this.chain;
  }

  private async run(id: string, kind: string): Promise<void> {
    const update = this.db.prepare(
      "UPDATE jobs SET status = ?, result_json = ?, error = ?, updated_at = datetime('now') WHERE id = ?",
    );
    update.run("running", null, null, id);
    const runner = this.runners[kind];
    try {
      if (!runner) {
        throw new Error(`no runner for job kind ${kind}`);
      }
      const row = this.db.prepare("SELECT payload_json AS p FROM jobs WHERE id = ?").get(id) as {
        p: string;
      };
      const result = await runner(row.p);
      update.run("done", JSON.stringify(result ?? null), null, id);
    } catch (error) {
      update.run("error", null, error instanceof Error ? error.message : String(error), id);
    }
  }
}
```

`server/src/jobs/publish.ts`:
```ts
import type Database from "better-sqlite3";
import type { BlobStore } from "../blobs/store";
import { validateImdfArchive } from "../imdf/validateArchive";

export function makePublishRunner(db: Database.Database, blobs: BlobStore) {
  return async (payloadJson: string): Promise<{ versionId: number }> => {
    const { versionId } = JSON.parse(payloadJson) as { versionId: number };
    const version = db
      .prepare("SELECT id, source_blob_hash AS hash FROM versions WHERE id = ?")
      .get(versionId) as { id: number; hash: string } | undefined;
    if (!version) {
      throw new Error(`version ${versionId} not found`);
    }
    try {
      const stats = await validateImdfArchive(blobs.read(version.hash));
      db.prepare(
        "UPDATE versions SET status = 'published', bundle_hash = source_blob_hash, stats_json = ? WHERE id = ?",
      ).run(JSON.stringify(stats), versionId);
      return { versionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare("UPDATE versions SET status = 'failed', error = ? WHERE id = ?").run(
        message,
        versionId,
      );
      throw error;
    }
  };
}
```

`server/src/venues/uploadRoute.ts`:
```ts
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { requireSession } from "../auth/guard";

const TENANT_ID = 1;

export function registerUploadRoute(app: FastifyInstance): void {
  app.post(
    "/api/venues/:id/versions",
    { preHandler: requireSession, schema: { params: Type.Object({ id: Type.Integer() }) } },
    async (request, reply) => {
      const { id } = request.params as { id: number };
      const venue = request.server.db
        .prepare("SELECT id FROM venues WHERE id = ? AND tenant_id = ?")
        .get(id, TENANT_ID);
      if (!venue) {
        return reply.code(404).send({ error: "not_found" });
      }
      const file = await request.file();
      if (!file) {
        return reply.code(400).send({ error: "file_required" });
      }
      const bytes = await file.toBuffer();
      const { hash, size } = request.server.blobs.put(bytes);
      request.server.db
        .prepare("INSERT OR IGNORE INTO blobs (hash, size) VALUES (?, ?)")
        .run(hash, size);

      const db = request.server.db;
      const nextSeq =
        ((db.prepare("SELECT MAX(seq) AS m FROM versions WHERE venue_id = ?").get(id) as {
          m: number | null;
        }).m ?? 0) + 1;
      const info = db
        .prepare(
          "INSERT INTO versions (venue_id, seq, source_blob_hash, source_kind) VALUES (?, ?, ?, 'imdf')",
        )
        .run(id, nextSeq, hash);
      const versionId = Number(info.lastInsertRowid);
      const jobId = request.server.queue.enqueue("publish_imdf", { versionId });
      return reply.code(202).send({ jobId, versionId, seq: nextSeq });
    },
  );
}
```

`server/src/jobs/routes.ts`:
```ts
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { requireSession } from "../auth/guard";

export function registerJobRoutes(app: FastifyInstance): void {
  app.get(
    "/api/jobs/:id",
    { preHandler: requireSession, schema: { params: Type.Object({ id: Type.String() }) } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const row = request.server.db
        .prepare(
          "SELECT id, kind, status, error, result_json AS resultJson FROM jobs WHERE id = ?",
        )
        .get(id) as
        | { id: string; kind: string; status: string; error: string | null; resultJson: string | null }
        | undefined;
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        error: row.error,
        result: row.resultJson ? (JSON.parse(row.resultJson) as unknown) : null,
      };
    },
  );
}
```

In `server/src/app.ts`:
```ts
import { JobQueue } from "./jobs/queue";
import { makePublishRunner } from "./jobs/publish";
import { registerJobRoutes } from "./jobs/routes";
import { registerUploadRoute } from "./venues/uploadRoute";
// after blobs decoration:
const queue = new JobQueue(db, { publish_imdf: makePublishRunner(db, app.blobs) });
app.decorate("queue", queue);
// with the other registrations:
registerUploadRoute(app);
registerJobRoutes(app);
// extend module declaration: queue: JobQueue;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter kiriko-server test -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "kiriko-server upload + publish pipeline with in-process job queue"
```

---

### Task 7: Public archive serving (`/v/`)

**Files:**
- Create: `server/src/serve/routes.ts`
- Modify: `server/src/app.ts` (register)
- Test: `server/test/serve.test.ts`

**Interfaces:**
- Consumes: venues/versions rows (Tasks 4/6), `BlobStore.read`.
- Produces: `GET /v/:tenant/:venue/archive` — latest **published** version's archive; no auth (published = public-read in phase 1, spec §6 tiering arrives with API keys); headers `content-type: application/zip`, `etag: "<bundle_hash>"`, `cache-control: public, max-age=0, must-revalidate`; 304 on matching `if-none-match`; 404 when tenant/venue/published version missing. `GET /v/:tenant/:venue/archive@:seq` — specific published seq, `cache-control: public, max-age=31536000, immutable`. The web viewer consumes these URLs via its existing `?src=` loader — no viewer changes needed.

- [ ] **Step 1: Write the failing tests**

`server/test/serve.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter kiriko-server test -- --run test/serve.test.ts`
Expected: FAIL — 404 with no route / wrong shape (first assertion on 200 fails).

- [ ] **Step 3: Implement**

`server/src/serve/routes.ts`:
```ts
import { Type } from "@sinclair/typebox";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

function findPublished(
  db: Database.Database,
  tenantSlug: string,
  venueSlug: string,
  seq: number | null,
): { hash: string } | null {
  const row = db
    .prepare(
      `SELECT vr.bundle_hash AS hash FROM versions vr
       JOIN venues v ON v.id = vr.venue_id
       JOIN tenants t ON t.id = v.tenant_id
       WHERE t.slug = ? AND v.slug = ? AND vr.status = 'published'
         AND (? IS NULL OR vr.seq = ?)
       ORDER BY vr.seq DESC LIMIT 1`,
    )
    .get(tenantSlug, venueSlug, seq, seq) as { hash: string | null } | undefined;
  return row?.hash ? { hash: row.hash } : null;
}

export function registerServeRoutes(app: FastifyInstance): void {
  const params = Type.Object({ tenant: Type.String(), venue: Type.String() });

  app.get("/v/:tenant/:venue/archive", { schema: { params } }, async (request, reply) => {
    const { tenant, venue } = request.params as { tenant: string; venue: string };
    return send(reply, request, tenant, venue, null, "public, max-age=0, must-revalidate");
  });

  app.get(
    "/v/:tenant/:venue/archive@:seq",
    { schema: { params: Type.Object({ tenant: Type.String(), venue: Type.String(), seq: Type.Integer() }) } },
    async (request, reply) => {
      const { tenant, venue, seq } = request.params as { tenant: string; venue: string; seq: number };
      return send(reply, request, tenant, venue, seq, "public, max-age=31536000, immutable");
    },
  );

  function send(
    reply: import("fastify").FastifyReply,
    request: import("fastify").FastifyRequest,
    tenant: string,
    venue: string,
    seq: number | null,
    cacheControl: string,
  ) {
    const found = findPublished(app.db, tenant, venue, seq);
    if (!found) {
      return reply.code(404).send({ error: "not_found" });
    }
    const etag = `"${found.hash}"`;
    void reply.header("etag", etag).header("cache-control", cacheControl);
    if (request.headers["if-none-match"] === etag) {
      return reply.code(304).send();
    }
    return reply.type("application/zip").send(app.blobs.read(found.hash));
  }
}
```

Register in `app.ts`: `registerServeRoutes(app);`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter kiriko-server test -- --run`
Expected: PASS (all server suites — final server state: ~12 tests).

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "kiriko-server public archive serving with ETag and immutable pinned versions"
```

---

### Task 8: Web — API client, `dataset` param, root routing

**Files:**
- Create: `src/gallery/api.ts`
- Modify: `src/app/viewerParams.ts` (+ `dataset`), `src/app/App.tsx` (derive src from dataset), `src/main.tsx` (gallery/viewer switch), `vite.config.ts` (dev + preview proxy)
- Test: `src/app/viewerParams.test.ts` (extend), `src/gallery/api.test.ts`

**Interfaces:**
- Consumes: server API shapes (Tasks 2/4/6 `Produces`).
- Produces: `parseViewerParams` gains `dataset: string | null` (`?dataset=<slug>`, trimmed, empty→null) **and `forceViewer: boolean`** (bare `?viewer` flag, parsed exactly like `embed`; existing e2e specs use it in Task 12 to reach the upload-driven viewer without a dataset); `datasetArchiveUrl(slug): string` = `/v/default/${slug}/archive` (exported from `src/gallery/api.ts`); `src/gallery/api.ts` exports `ApiError extends Error { status: number }`, `api.me(): Promise<ApiUser | null>` (null on 401), `api.login(username, password): Promise<ApiUser>`, `api.logout(): Promise<void>`, `api.listVenues(): Promise<VenueSummary[]>`, `api.createVenue(name): Promise<VenueRow>`, `api.deleteVenue(id): Promise<void>`, `api.uploadVersion(venueId, file, onProgress): Promise<{ jobId: string }>` (XHR for progress events), `api.waitForJob(jobId): Promise<{ status: "done" } | { status: "error"; error: string }>` (poll every 500 ms, 60 s timeout); types `ApiUser = { id: number; username: string; role: string }`, `VenueRow = { id: number; slug: string; name: string; createdAt: string }`, `VenueSummary = VenueRow & { latest: { seq: number; status: string; stats: { levels: number; features: number } | null; createdAt: string } | null }`. `src/main.tsx` renders `<GalleryPage />` when `src === null && dataset === null && !embed`, else `<App />` (Task 9 provides GalleryPage; this task lands the switch with a placeholder `<div className="gallery-placeholder" />` component in `src/gallery/GalleryPage.tsx` that Task 9 replaces).

- [ ] **Step 1: Write the failing tests**

Append to `src/app/viewerParams.test.ts`:
```ts
  it("parses dataset slug, trimming and treating empty as absent", () => {
    expect(parseViewerParams("?dataset=shinjuku-station", BASE).dataset).toBe("shinjuku-station");
    expect(parseViewerParams("?dataset=%20abc%20", BASE).dataset).toBe("abc");
    expect(parseViewerParams("?dataset=", BASE).dataset).toBeNull();
    expect(parseViewerParams("", BASE).dataset).toBeNull();
  });

  it("parses the bare viewer flag", () => {
    expect(parseViewerParams("?viewer", BASE).forceViewer).toBe(true);
    expect(parseViewerParams("?viewer=1", BASE).forceViewer).toBe(true);
    expect(parseViewerParams("", BASE).forceViewer).toBe(false);
  });
```

`src/gallery/api.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, datasetArchiveUrl } from "./api";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe("gallery api client", () => {
  it("builds dataset archive URLs", () => {
    expect(datasetArchiveUrl("tokyo-station")).toBe("/v/default/tokyo-station/archive");
  });

  it("me() returns null on 401 instead of throwing", async () => {
    mockFetch(401, { error: "unauthorized" });
    expect(await api.me()).toBeNull();
  });

  it("listVenues unwraps the venues array and throws ApiError on failure", async () => {
    mockFetch(200, { venues: [{ id: 1, slug: "a", name: "A", createdAt: "", latest: null }] });
    expect((await api.listVenues())[0]?.slug).toBe("a");

    mockFetch(500, { error: "boom" });
    await expect(api.listVenues()).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/gallery src/app/viewerParams.test.ts`
Expected: FAIL — `dataset` undefined; `src/gallery/api` not found.

- [ ] **Step 3: Implement**

`src/app/viewerParams.ts` — add to the interface `dataset: string | null;` and `forceViewer: boolean;`, and in `parseViewerParams` before the return:
```ts
  const datasetRaw = params.get("dataset");
  const dataset = datasetRaw !== null && datasetRaw.trim() !== "" ? datasetRaw.trim() : null;

  const viewerRaw = params.get("viewer");
  const forceViewer =
    viewerRaw !== null && (viewerRaw === "" || /^(1|true)$/i.test(viewerRaw));
```
and include `dataset` and `forceViewer` in the returned object.

`src/gallery/api.ts`:
```ts
export interface ApiUser {
  id: number;
  username: string;
  role: string;
}

export interface VenueRow {
  id: number;
  slug: string;
  name: string;
  createdAt: string;
}

export interface VenueSummary extends VenueRow {
  latest: {
    seq: number;
    status: string;
    stats: { levels: number; features: number } | null;
    createdAt: string;
  } | null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function datasetArchiveUrl(slug: string): string {
  return `/v/default/${slug}/archive`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : {},
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  async me(): Promise<ApiUser | null> {
    try {
      return (await request<{ user: ApiUser }>("/api/auth/me")).user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return null;
      }
      throw error;
    }
  },

  async login(username: string, password: string): Promise<ApiUser> {
    const { user } = await request<{ user: ApiUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    return user;
  },

  async logout(): Promise<void> {
    await request<void>("/api/auth/logout", { method: "POST" });
  },

  async listVenues(): Promise<VenueSummary[]> {
    return (await request<{ venues: VenueSummary[] }>("/api/venues")).venues;
  },

  async createVenue(name: string): Promise<VenueRow> {
    return (
      await request<{ venue: VenueRow }>("/api/venues", {
        method: "POST",
        body: JSON.stringify({ name }),
      })
    ).venue;
  },

  async deleteVenue(id: number): Promise<void> {
    await request<void>(`/api/venues/${id}`, { method: "DELETE" });
  },

  uploadVersion(
    venueId: number,
    file: File,
    onProgress: (fraction: number) => void,
  ): Promise<{ jobId: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/venues/${venueId}/versions`);
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          onProgress(event.loaded / event.total);
        }
      });
      xhr.addEventListener("load", () => {
        if (xhr.status === 202) {
          resolve(JSON.parse(xhr.responseText) as { jobId: string });
        } else {
          reject(new ApiError(xhr.status, xhr.responseText));
        }
      });
      xhr.addEventListener("error", () => {
        reject(new ApiError(0, "network error"));
      });
      const form = new FormData();
      form.append("file", file);
      xhr.send(form);
    });
  },

  async waitForJob(
    jobId: string,
  ): Promise<{ status: "done" } | { status: "error"; error: string }> {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const job = await request<{ status: string; error: string | null }>(`/api/jobs/${jobId}`);
      if (job.status === "done") {
        return { status: "done" };
      }
      if (job.status === "error") {
        return { status: "error", error: job.error ?? "unknown error" };
      }
      if (Date.now() > deadline) {
        return { status: "error", error: "timed out" };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  },
};
```

`src/gallery/GalleryPage.tsx` (placeholder, replaced in Task 9):
```tsx
export function GalleryPage() {
  return <div className="gallery-placeholder" />;
}
```

`src/main.tsx` — replace the render call:
```tsx
import { GalleryPage } from "./gallery/GalleryPage";
import { parseViewerParams } from "./app/viewerParams";
// ...
const params = parseViewerParams(window.location.search);
const showViewer =
  params.src !== null || params.dataset !== null || params.embed || params.forceViewer;

createRoot(root).render(<StrictMode>{showViewer ? <App /> : <GalleryPage />}</StrictMode>);
```

`src/app/App.tsx` — derive the effective src (replace the two uses of `params.src` in `loadFromSrc` and `onRetry` gating):
```ts
import { datasetArchiveUrl } from "../gallery/api";
// inside App():
const effectiveSrc = params.src ?? (params.dataset !== null ? datasetArchiveUrl(params.dataset) : null);
```
`loadFromSrc` uses `effectiveSrc` instead of `params.src` (guard `if (effectiveSrc === null) return;` and fetch `effectiveSrc`); `onRetry` condition becomes `effectiveSrc !== null`.

`vite.config.ts` — add to the config object:
```ts
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8790",
      "/v": "http://127.0.0.1:8790",
    },
  },
  preview: {
    proxy: {
      "/api": "http://127.0.0.1:8790",
      "/v": "http://127.0.0.1:8790",
    },
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm typecheck && pnpm test -- --run`
Expected: PASS (existing viewer tests untouched; App tests still pass because `?src=`/upload paths are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/ vite.config.ts
git commit -m "web: gallery api client, ?dataset= deep links, gallery/viewer root switch"
```

---

### Task 9: Gallery page UI (header, grid, cards, filter, empty state)

**Files:**
- Create: `src/gallery/GalleryPage.tsx` (replace placeholder), `src/gallery/DatasetCard.tsx`
- Modify: `src/app/app.css` (gallery styles)
- Test: `src/gallery/gallery.test.tsx`

**Interfaces:**
- Consumes: `api`, `VenueSummary`, `datasetArchiveUrl` (Task 8).
- Produces: `GalleryPage` — loads `api.me()` then `api.listVenues()`; states: loading → signed-out (renders `SignInModal` from Task 10; until then a `.gallery-signin-pending` div) → ready. Ready layout per Figma 🗂: 64px flat header (KirikoMark + "Kiriko" wordmark, username chip + sign-out chip right), title row ("Datasets"/「データセット」+ filter `kiriko-input` + primary "Open local data" button), card grid `repeat(auto-fill, minmax(320px, 1fr))`, client-side name/slug filtering, empty-state card when no venues. `DatasetCard` props `{ venue: VenueSummary; locale: LocaleCode; onOpen(): void; onDelete(): void }` — placeholder pattern block, name, kind chip ("IMDF"), meta line `{levels} floors · {features} features · {date}` in mono, slug in mono caption, Open link + delete (…) button. Card "Open" navigates via `window.location.assign('/?dataset=' + venue.slug)`. Locale via the existing `ja/en` pattern with a `useState<LocaleCode>("ja")` + chips (no reducer — gallery is independent of the viewer).

- [ ] **Step 1: Write the failing tests**

`src/gallery/gallery.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VenueSummary } from "./api";

const me = vi.fn();
const listVenues = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: { ...actual.api, me: () => me(), listVenues: () => listVenues() },
  };
});

import { GalleryPage } from "./GalleryPage";

const VENUE: VenueSummary = {
  id: 1,
  slug: "tokyo-station",
  name: "東京駅構内図",
  createdAt: "2026-07-17 00:00:00",
  latest: {
    seq: 2,
    status: "published",
    stats: { levels: 4, features: 3204 },
    createdAt: "2026-07-17 00:00:00",
  },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("GalleryPage", () => {
  it("renders dataset cards with stats for a signed-in user", async () => {
    me.mockResolvedValue({ id: 1, username: "daniel", role: "admin" });
    listVenues.mockResolvedValue([VENUE]);
    render(<GalleryPage />);

    await waitFor(() => {
      expect(screen.getByText("東京駅構内図")).toBeTruthy();
    });
    expect(screen.getByText(/4/)).toBeTruthy();
    expect(screen.getByText(/3,204|3204/)).toBeTruthy();
    expect(screen.getByText("tokyo-station")).toBeTruthy();
  });

  it("filters cards by name", async () => {
    me.mockResolvedValue({ id: 1, username: "daniel", role: "admin" });
    listVenues.mockResolvedValue([
      VENUE,
      { ...VENUE, id: 2, slug: "shibuya", name: "Shibuya Station" },
    ]);
    const user = userEvent.setup();
    render(<GalleryPage />);
    await waitFor(() => {
      expect(screen.getByText("Shibuya Station")).toBeTruthy();
    });

    await user.type(screen.getByRole("searchbox"), "shibuya");
    expect(screen.queryByText("東京駅構内図")).toBeNull();
    expect(screen.getByText("Shibuya Station")).toBeTruthy();
  });

  it("shows the empty state when there are no datasets", async () => {
    me.mockResolvedValue({ id: 1, username: "daniel", role: "admin" });
    listVenues.mockResolvedValue([]);
    render(<GalleryPage />);
    await waitFor(() => {
      expect(screen.getByText("データセットがありません")).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/gallery`
Expected: FAIL — GalleryPage renders only the placeholder div.

- [ ] **Step 3: Implement**

`src/gallery/DatasetCard.tsx`:
```tsx
import type { LocaleCode } from "../imdf/types";
import type { VenueSummary } from "./api";

const ui = {
  open: { ja: "開く", en: "Open" },
  delete: { ja: "削除", en: "Delete" },
  floors: { ja: "フロア", en: "floors" },
  features: { ja: "地物", en: "features" },
  processing: { ja: "処理中・未公開", en: "not published yet" },
} as const;

export interface DatasetCardProps {
  venue: VenueSummary;
  locale: LocaleCode;
  onOpen: () => void;
  onDelete: () => void;
}

export function DatasetCard({ venue, locale, onOpen, onDelete }: DatasetCardProps) {
  const stats = venue.latest?.stats ?? null;
  const date = (venue.latest?.createdAt ?? venue.createdAt).slice(0, 10);
  return (
    <article className="dataset-card">
      <button type="button" className="dataset-card__thumb" aria-hidden="true" tabIndex={-1} onClick={onOpen} />
      <div className="dataset-card__body">
        <h3 className="dataset-card__name">{venue.name}</h3>
        <div className="dataset-card__chips">
          <span className="chip">IMDF</span>
        </div>
        <p className="dataset-card__meta">
          {stats
            ? `${stats.levels} ${ui.floors[locale]} · ${stats.features.toLocaleString()} ${ui.features[locale]} · ${date}`
            : ui.processing[locale]}
        </p>
        <p className="dataset-card__slug">{venue.slug}</p>
      </div>
      <div className="dataset-card__actions">
        <button type="button" className="btn-ghost" onClick={onDelete} aria-label={`${ui.delete[locale]}: ${venue.name}`}>
          {ui.delete[locale]}
        </button>
        <button type="button" className="btn-primary" onClick={onOpen}>
          {ui.open[locale]}
        </button>
      </div>
    </article>
  );
}
```

`src/gallery/GalleryPage.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { KirikoMark } from "../components/icons";
import type { LocaleCode } from "../imdf/types";
import { api, type ApiUser, type VenueSummary } from "./api";
import { DatasetCard } from "./DatasetCard";

const ui = {
  datasets: { ja: "データセット", en: "Datasets" },
  filter: { ja: "データセットを検索…", en: "Filter datasets…" },
  openLocal: { ja: "ローカルデータを開く", en: "Open local data" },
  empty: { ja: "データセットがありません", en: "No datasets yet" },
  emptyHint: {
    ja: "IMDF ZIP をアップロードして最初のデータセットを公開しましょう。",
    en: "Upload an IMDF ZIP to publish your first dataset.",
  },
  signOut: { ja: "サインアウト", en: "Sign out" },
  loadError: { ja: "読み込みに失敗しました", en: "Could not load datasets" },
} as const;

type GalleryState =
  | { phase: "loading" }
  | { phase: "signed-out" }
  | { phase: "ready"; user: ApiUser; venues: VenueSummary[] }
  | { phase: "error" };

export function GalleryPage() {
  const [locale, setLocale] = useState<LocaleCode>("ja");
  const [state, setState] = useState<GalleryState>({ phase: "loading" });
  const [filter, setFilter] = useState("");

  const reload = useCallback(async () => {
    try {
      const user = await api.me();
      if (user === null) {
        setState({ phase: "signed-out" });
        return;
      }
      setState({ phase: "ready", user, venues: await api.listVenues() });
    } catch {
      setState({ phase: "error" });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openVenue = (slug: string) => {
    window.location.assign(`/?dataset=${encodeURIComponent(slug)}`);
  };

  const header = (
    <header className="gallery-header">
      <div className="gallery-header__brand">
        <KirikoMark className="gallery-header__mark" />
        <span className="gallery-header__wordmark">Kiriko</span>
      </div>
      <div className="gallery-header__actions">
        {state.phase === "ready" ? (
          <>
            <span className="chip">{state.user.username}</span>
            <button
              type="button"
              className="chip"
              onClick={() => {
                void api.logout().then(reload);
              }}
            >
              {ui.signOut[locale]}
            </button>
          </>
        ) : null}
        <div className="locale-chips" role="group" aria-label="Language">
          <button
            type="button"
            className={locale === "ja" ? "chip chip--selected" : "chip"}
            aria-pressed={locale === "ja"}
            onClick={() => {
              setLocale("ja");
            }}
          >
            日本語
          </button>
          <button
            type="button"
            className={locale === "en" ? "chip chip--selected" : "chip"}
            aria-pressed={locale === "en"}
            onClick={() => {
              setLocale("en");
            }}
          >
            EN
          </button>
        </div>
      </div>
    </header>
  );

  if (state.phase === "loading") {
    return <div className="gallery">{header}</div>;
  }
  if (state.phase === "signed-out") {
    // Task 10 replaces this with <SignInModal onSignedIn={reload} />
    return (
      <div className="gallery">
        {header}
        <div className="gallery-signin-pending" />
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div className="gallery">
        {header}
        <p className="gallery__error" role="alert">
          {ui.loadError[locale]}
        </p>
      </div>
    );
  }

  const visible = state.venues.filter((venue) => {
    const q = filter.trim().toLowerCase();
    return q === "" || venue.name.toLowerCase().includes(q) || venue.slug.includes(q);
  });

  return (
    <div className="gallery">
      {header}
      <main className="gallery__main">
        <div className="gallery__title-row">
          <h1 className="gallery__title">{ui.datasets[locale]}</h1>
          <div className="kiriko-input gallery__filter">
            <input
              type="search"
              role="searchbox"
              value={filter}
              placeholder={ui.filter[locale]}
              aria-label={ui.filter[locale]}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
            />
          </div>
          {/* Task 11 wires this to the UploadModal */}
          <button type="button" className="btn-primary gallery__upload-btn">
            {ui.openLocal[locale]}
          </button>
        </div>
        {visible.length === 0 ? (
          <div className="gallery__empty">
            <h2>{ui.empty[locale]}</h2>
            <p>{ui.emptyHint[locale]}</p>
          </div>
        ) : (
          <div className="gallery__grid">
            {visible.map((venue) => (
              <DatasetCard
                key={venue.id}
                venue={venue}
                locale={locale}
                onOpen={() => {
                  openVenue(venue.slug);
                }}
                onDelete={() => {
                  /* Task 11 wires the confirm modal */
                }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
```

Append to `src/app/app.css` (after the embed chrome section):
```css
/* ── Gallery ───────────────────────────────────────────── */

.gallery {
  min-height: 100dvh;
  background: var(--color-app-bg);
}

.gallery-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
  padding: 0 clamp(16px, 8vw, 120px);
  background: var(--color-panel);
  border-bottom: 1px solid var(--color-border);
}

.gallery-header__brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.gallery-header__mark {
  color: var(--color-accent);
}

.gallery-header__wordmark {
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}

.gallery-header__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.gallery__main {
  padding: 40px clamp(16px, 8vw, 120px) 64px;
}

.gallery__title-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-6);
}

.gallery__title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  line-height: 32px;
  flex: 1;
}

.gallery__filter {
  width: 280px;
}

.gallery__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-6);
}

.dataset-card {
  display: flex;
  flex-direction: column;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: box-shadow 0.15s ease-out;
}

.dataset-card:hover {
  box-shadow: var(--shadow-floating);
}

.dataset-card__thumb {
  height: 96px;
  border: 0;
  background:
    linear-gradient(90deg, var(--color-accent-soft) 0 40%, transparent 0 44%),
    linear-gradient(var(--color-chip-fill) 0 0);
  background-color: var(--color-canvas);
  cursor: pointer;
}

.dataset-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
}

.dataset-card__name {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}

.dataset-card__meta {
  margin: 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--color-muted);
}

.dataset-card__slug {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 18px;
  color: var(--color-muted);
}

.dataset-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: 0 var(--space-4) var(--space-4);
}

.gallery__empty {
  max-width: 488px;
  margin: 96px auto 0;
  padding: 48px;
  text-align: center;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.gallery__empty h2 {
  margin: 0 0 var(--space-2);
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}

.gallery__empty p {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  color: var(--color-muted);
}

.gallery__error {
  margin: 96px auto;
  text-align: center;
  color: var(--color-error);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm typecheck && pnpm test -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "web gallery: header, dataset card grid, filter, empty state"
```

---

### Task 10: Sign-in modal + auth gating

**Files:**
- Create: `src/gallery/SignInModal.tsx`
- Modify: `src/gallery/GalleryPage.tsx` (render it in `signed-out` phase)
- Modify: `src/app/app.css` (modal styles)
- Test: `src/gallery/signin.test.tsx`

**Interfaces:**
- Consumes: `api.login` (Task 8), `GalleryState` phases (Task 9).
- Produces: `SignInModal` props `{ locale: LocaleCode; onSignedIn(): void }` — Figma 🚀 Sign-in: centered 400px card over dim overlay, KirikoMark, "Sign in to Kiriko"/「Kiriko にサインイン」, username + password `kiriko-input`s, error line "Wrong username or password."/「ユーザー名またはパスワードが違います」 on 401, full-width primary submit; calls `onSignedIn` after successful `api.login`. GalleryPage's `signed-out` phase renders `{header}<SignInModal locale={locale} onSignedIn={() => void reload()} />`.

- [ ] **Step 1: Write the failing tests**

`src/gallery/signin.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";

const login = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, login: (...a: unknown[]) => login(...a) } };
});

import { SignInModal } from "./SignInModal";

afterEach(() => {
  vi.clearAllMocks();
});

describe("SignInModal", () => {
  it("submits credentials and reports success", async () => {
    login.mockResolvedValue({ id: 1, username: "daniel", role: "admin" });
    const onSignedIn = vi.fn();
    const user = userEvent.setup();
    render(<SignInModal locale="en" onSignedIn={onSignedIn} />);

    await user.type(screen.getByLabelText("Username"), "daniel");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalled();
    });
    expect(login).toHaveBeenCalledWith("daniel", "secret");
  });

  it("shows the error line on 401 and keeps the form usable", async () => {
    login.mockRejectedValue(new ApiError(401, "invalid_credentials"));
    const user = userEvent.setup();
    render(<SignInModal locale="en" onSignedIn={() => {}} />);

    await user.type(screen.getByLabelText("Username"), "daniel");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Wrong username or password.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/gallery/signin.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/gallery/SignInModal.tsx`:
```tsx
import { useState, type FormEvent } from "react";
import { KirikoMark } from "../components/icons";
import type { LocaleCode } from "../imdf/types";
import { api, ApiError } from "./api";

const ui = {
  title: { ja: "Kiriko にサインイン", en: "Sign in to Kiriko" },
  username: { ja: "ユーザー名", en: "Username" },
  password: { ja: "パスワード", en: "Password" },
  submit: { ja: "サインイン", en: "Sign in" },
  wrong: {
    ja: "ユーザー名またはパスワードが違います",
    en: "Wrong username or password.",
  },
  failed: { ja: "サインインに失敗しました", en: "Sign-in failed" },
} as const;

export interface SignInModalProps {
  locale: LocaleCode;
  onSignedIn: () => void;
}

export function SignInModal({ locale, onSignedIn }: SignInModalProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    api
      .login(username, password)
      .then(() => {
        onSignedIn();
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError && err.status === 401 ? ui.wrong[locale] : ui.failed[locale]);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="modal-overlay">
      <form className="signin-card" onSubmit={onSubmit} aria-label={ui.title[locale]}>
        <div className="signin-card__brand">
          <KirikoMark size={32} className="signin-card__mark" />
          <h2 className="signin-card__title">{ui.title[locale]}</h2>
        </div>
        <div className="kiriko-input">
          <input
            aria-label={ui.username[locale]}
            placeholder={ui.username[locale]}
            autoComplete="username"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
          />
        </div>
        <div className="kiriko-input">
          <input
            type="password"
            aria-label={ui.password[locale]}
            placeholder={ui.password[locale]}
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </div>
        {error !== null ? (
          <p className="signin-card__error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn-primary signin-card__submit" disabled={busy}>
          {ui.submit[locale]}
        </button>
      </form>
    </div>
  );
}
```

GalleryPage `signed-out` branch becomes:
```tsx
  if (state.phase === "signed-out") {
    return (
      <div className="gallery">
        {header}
        <SignInModal
          locale={locale}
          onSignedIn={() => {
            void reload();
          }}
        />
      </div>
    );
  }
```
(and remove the `.gallery-signin-pending` div; add the import.)

Append to `src/app/app.css`:
```css
/* ── Modals (gallery) ──────────────────────────────────── */

.modal-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background: rgba(28, 25, 23, 0.24);
  z-index: var(--z-overlay);
}

.signin-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: min(400px, 100%);
  padding: var(--space-6);
  background: var(--color-panel);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-raised);
}

.signin-card__brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.signin-card__mark {
  color: var(--color-accent);
}

.signin-card__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}

.signin-card__error {
  margin: 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--color-error);
}

.signin-card__submit {
  justify-content: center;
}

.signin-card .kiriko-input input {
  width: 100%;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm typecheck && pnpm test -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "web gallery: sign-in modal and auth gating"
```

---

### Task 11: Upload modal + delete confirm

**Files:**
- Create: `src/gallery/UploadModal.tsx`, `src/gallery/ConfirmDeleteModal.tsx`
- Modify: `src/gallery/GalleryPage.tsx` (wire both)
- Modify: `src/app/app.css` (upload/progress/confirm styles)
- Test: `src/gallery/upload.test.tsx`

**Interfaces:**
- Consumes: `api.createVenue`, `api.uploadVersion`, `api.waitForJob`, `api.deleteVenue` (Task 8).
- Produces: `UploadModal` props `{ locale: LocaleCode; onClose(): void; onPublished(): void }` — flow: (1) pick/drop `.zip` (drop target per Figma 🚀 "Open local data", `.zip` accept, drag highlight) + dataset-name input prefilled from the file name (strip `.zip`, e.g. `shinjuku-station.zip` → `shinjuku-station`); (2) submit → `createVenue(name)` → `uploadVersion(id, file, setProgress)` with a progress bar; (3) `waitForJob` → done state with an "Open"/「開く」 primary linking `/?dataset=<slug>` + Close ghost, or the job error text with the form re-enabled. `ConfirmDeleteModal` props `{ locale: LocaleCode; venueName: string; onConfirm(): void; onCancel(): void }` — Figma delete confirm: message, ghost Cancel, destructive Confirm (`.btn-destructive` added to css). GalleryPage wires `gallery__upload-btn` → UploadModal (on `onPublished`: reload + close), card `onDelete` → ConfirmDeleteModal → `api.deleteVenue` → reload.

- [ ] **Step 1: Write the failing tests**

`src/gallery/upload.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const createVenue = vi.fn();
const uploadVersion = vi.fn();
const waitForJob = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      createVenue: (...a: unknown[]) => createVenue(...a),
      uploadVersion: (...a: unknown[]) => uploadVersion(...a),
      waitForJob: (...a: unknown[]) => waitForJob(...a),
    },
  };
});

import { UploadModal } from "./UploadModal";

afterEach(() => {
  vi.clearAllMocks();
});

function zipFile(name = "shinjuku-station.zip"): File {
  return new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], name, { type: "application/zip" });
}

describe("UploadModal", () => {
  it("prefills the name from the file, uploads, and reaches the done state", async () => {
    createVenue.mockResolvedValue({ id: 7, slug: "shinjuku-station", name: "shinjuku-station" });
    uploadVersion.mockResolvedValue({ jobId: "j1" });
    waitForJob.mockResolvedValue({ status: "done" });
    const onPublished = vi.fn();
    const user = userEvent.setup();
    render(<UploadModal locale="en" onClose={() => {}} onPublished={onPublished} />);

    await user.upload(screen.getByLabelText("IMDF ZIP"), zipFile());
    expect((screen.getByLabelText("Dataset name") as HTMLInputElement).value).toBe(
      "shinjuku-station",
    );

    await user.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(screen.getByText("Published")).toBeTruthy();
    });
    expect(createVenue).toHaveBeenCalledWith("shinjuku-station");
    expect(uploadVersion).toHaveBeenCalled();
    expect(onPublished).toHaveBeenCalled();
    const open = screen.getByRole("link", { name: "Open" });
    expect(open.getAttribute("href")).toBe("/?dataset=shinjuku-station");
  });

  it("surfaces a failed publish job and re-enables the form", async () => {
    createVenue.mockResolvedValue({ id: 8, slug: "bad", name: "bad" });
    uploadVersion.mockResolvedValue({ jobId: "j2" });
    waitForJob.mockResolvedValue({ status: "error", error: "not a ZIP archive" });
    const user = userEvent.setup();
    render(<UploadModal locale="en" onClose={() => {}} onPublished={() => {}} />);

    await user.upload(screen.getByLabelText("IMDF ZIP"), zipFile("bad.zip"));
    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText(/not a ZIP archive/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/gallery/upload.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/gallery/UploadModal.tsx`:
```tsx
import { useRef, useState, type DragEvent } from "react";
import type { LocaleCode } from "../imdf/types";
import { api } from "./api";
import { IconClose } from "../components/icons";

const ui = {
  title: { ja: "ローカルデータを開く", en: "Open local data" },
  dropTitle: { ja: "IMDF ZIP", en: "IMDF ZIP" },
  dropHint: { ja: "ドロップまたはクリックで選択", en: "Drop or click to choose" },
  nameLabel: { ja: "データセット名", en: "Dataset name" },
  publish: { ja: "公開", en: "Publish" },
  uploading: { ja: "アップロード中", en: "Uploading" },
  processing: { ja: "検証・公開処理中…", en: "Validating and publishing…" },
  published: { ja: "公開しました", en: "Published" },
  open: { ja: "開く", en: "Open" },
  close: { ja: "閉じる", en: "Close" },
  cancel: { ja: "キャンセル", en: "Cancel" },
} as const;

export interface UploadModalProps {
  locale: LocaleCode;
  onClose: () => void;
  onPublished: () => void;
}

type Phase =
  | { step: "form" }
  | { step: "uploading"; fraction: number }
  | { step: "processing" }
  | { step: "done"; slug: string }
  | { step: "failed"; message: string };

export function UploadModal({ locale, onClose, onPublished }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<Phase>({ step: "form" });
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFile = (candidate: File | undefined) => {
    if (!candidate || !candidate.name.toLowerCase().endsWith(".zip")) {
      return;
    }
    setFile(candidate);
    if (name === "") {
      setName(candidate.name.replace(/\.zip$/i, ""));
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    acceptFile(event.dataTransfer.files[0]);
  };

  const submit = () => {
    if (!file || name.trim() === "") {
      return;
    }
    setPhase({ step: "uploading", fraction: 0 });
    void (async () => {
      try {
        const venue = await api.createVenue(name.trim());
        const { jobId } = await api.uploadVersion(venue.id, file, (fraction) => {
          setPhase({ step: "uploading", fraction });
        });
        setPhase({ step: "processing" });
        const job = await api.waitForJob(jobId);
        if (job.status === "done") {
          setPhase({ step: "done", slug: venue.slug });
          onPublished();
        } else {
          setPhase({ step: "failed", message: job.error });
        }
      } catch (error) {
        setPhase({ step: "failed", message: error instanceof Error ? error.message : String(error) });
      }
    })();
  };

  const busy = phase.step === "uploading" || phase.step === "processing";

  return (
    <div className="modal-overlay">
      <div className="upload-modal" role="dialog" aria-label={ui.title[locale]}>
        <header className="upload-modal__header">
          <h2 className="upload-modal__title">{ui.title[locale]}</h2>
          <button type="button" className="floating-panel__close" aria-label={ui.close[locale]} onClick={onClose}>
            <IconClose />
          </button>
        </header>

        {phase.step === "done" ? (
          <div className="upload-modal__done">
            <p className="upload-modal__published">{ui.published[locale]}</p>
            <div className="upload-modal__footer">
              <button type="button" className="btn-ghost" onClick={onClose}>
                {ui.close[locale]}
              </button>
              <a className="btn-primary" href={`/?dataset=${encodeURIComponent(phase.slug)}`}>
                {ui.open[locale]}
              </a>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              className={dragActive ? "drop-target drop-target--active" : "drop-target"}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => {
                setDragActive(false);
              }}
              onDrop={onDrop}
              disabled={busy}
            >
              <span className="drop-target__title">{file ? file.name : ui.dropTitle[locale]}</span>
              <span className="drop-target__hint">{ui.dropHint[locale]}</span>
            </button>
            <input
              ref={inputRef}
              className="imdf-dropzone__input"
              type="file"
              accept=".zip,application/zip"
              aria-label={ui.dropTitle[locale]}
              onChange={(event) => {
                acceptFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <label className="upload-modal__name">
              <span>{ui.nameLabel[locale]}</span>
              <div className="kiriko-input">
                <input
                  aria-label={ui.nameLabel[locale]}
                  value={name}
                  disabled={busy}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              </div>
            </label>

            {phase.step === "uploading" ? (
              <div className="upload-modal__progress">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.round(phase.fraction * 100)}%` }} />
                </div>
                <span>{ui.uploading[locale]}…</span>
              </div>
            ) : null}
            {phase.step === "processing" ? <p className="upload-modal__processing">{ui.processing[locale]}</p> : null}
            {phase.step === "failed" ? (
              <p className="upload-modal__error" role="alert">
                {phase.message}
              </p>
            ) : null}

            <div className="upload-modal__footer">
              <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
                {ui.cancel[locale]}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={submit}
                disabled={busy || !file || name.trim() === ""}
              >
                {ui.publish[locale]}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

`src/gallery/ConfirmDeleteModal.tsx`:
```tsx
import type { LocaleCode } from "../imdf/types";

const ui = {
  title: { ja: "データセットを削除", en: "Delete dataset" },
  body: {
    ja: "は完全に削除されます。この操作は取り消せません。",
    en: "will be permanently deleted. This cannot be undone.",
  },
  cancel: { ja: "キャンセル", en: "Cancel" },
  confirm: { ja: "削除", en: "Delete" },
} as const;

export interface ConfirmDeleteModalProps {
  locale: LocaleCode;
  venueName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDeleteModal({ locale, venueName, onConfirm, onCancel }: ConfirmDeleteModalProps) {
  return (
    <div className="modal-overlay">
      <div className="confirm-modal" role="alertdialog" aria-label={ui.title[locale]}>
        <h2 className="confirm-modal__title">{ui.title[locale]}</h2>
        <p className="confirm-modal__body">
          <strong>{venueName}</strong> {ui.body[locale]}
        </p>
        <div className="confirm-modal__footer">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            {ui.cancel[locale]}
          </button>
          <button type="button" className="btn-destructive" onClick={onConfirm}>
            {ui.confirm[locale]}
          </button>
        </div>
      </div>
    </div>
  );
}
```

GalleryPage wiring — add state and handlers:
```tsx
const [uploadOpen, setUploadOpen] = useState(false);
const [deleting, setDeleting] = useState<VenueSummary | null>(null);
```
`gallery__upload-btn` gets `onClick={() => { setUploadOpen(true); }}`; card `onDelete={() => { setDeleting(venue); }}`; render at the end of the ready branch:
```tsx
{uploadOpen ? (
  <UploadModal
    locale={locale}
    onClose={() => {
      setUploadOpen(false);
    }}
    onPublished={() => {
      void reload();
    }}
  />
) : null}
{deleting !== null ? (
  <ConfirmDeleteModal
    locale={locale}
    venueName={deleting.name}
    onCancel={() => {
      setDeleting(null);
    }}
    onConfirm={() => {
      void api.deleteVenue(deleting.id).then(() => {
        setDeleting(null);
        return reload();
      });
    }}
  />
) : null}
```

Append to `src/app/app.css`:
```css
.upload-modal,
.confirm-modal {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: min(560px, 100%);
  padding: var(--space-6);
  background: var(--color-panel);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-raised);
}

.confirm-modal {
  width: min(400px, 100%);
}

.upload-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.upload-modal__title,
.confirm-modal__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}

.drop-target {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-height: 160px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-app-bg);
  cursor: pointer;
}

.drop-target--active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.drop-target__title {
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}

.drop-target__hint {
  font-size: 12px;
  line-height: 16px;
  color: var(--color-muted);
}

.upload-modal__name {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}

.upload-modal__progress {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: 12px;
  color: var(--color-muted);
}

.progress-track {
  height: 8px;
  border-radius: var(--radius-pill);
  background: var(--color-chip-fill);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  transition: width 0.15s ease-out;
}

.upload-modal__processing {
  margin: 0;
  font-size: 13px;
  line-height: 18px;
  color: var(--color-muted);
}

.upload-modal__error,
.confirm-modal__body {
  margin: 0;
  font-size: 13px;
  line-height: 18px;
}

.upload-modal__error {
  color: var(--color-error);
}

.upload-modal__published {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-success, #16a34a);
}

.upload-modal__footer,
.confirm-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.btn-destructive {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-md);
  background: var(--color-error);
  color: #ffffff;
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  transition: filter 0.15s ease-out;
}

.btn-destructive:hover {
  filter: brightness(0.92);
}
```

Also add to `:root` in `app.css`: `--color-success: #16a34a;` and change `.upload-modal__published` to `color: var(--color-success);`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm typecheck && pnpm test -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "web gallery: upload modal with publish progress, delete confirm"
```

---

### Task 12: Gallery e2e journey + Playwright/server wiring

**Files:**
- Modify: `playwright.config.ts` (webServer array + server boot)
- Create: `e2e/gallery.spec.ts`
- Modify: `e2e/helpers.ts` (gallery helpers)

**Interfaces:**
- Consumes: everything above; `buildMinimalImdfZip` fixture; bootstrap env from Task 1/2.
- Produces: green `pnpm test:e2e` including the gallery journey on chromium/firefox.

- [ ] **Step 1: Wire the server into Playwright**

In `playwright.config.ts`, replace the single `webServer` object with an array (keep the existing vite entry verbatim as the first element):
```ts
  webServer: [
    {
      command: "pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command:
        "rm -rf .e2e-data && KIRIKO_DATA_DIR=.e2e-data KIRIKO_PORT=8790 KIRIKO_BOOTSTRAP_USER=e2e KIRIKO_BOOTSTRAP_PASSWORD=e2e-password pnpm --filter kiriko-server start",
      url: "http://127.0.0.1:8790/healthz",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
```
Add `.e2e-data/` to `.gitignore`.

- [ ] **Step 2: Add gallery helpers**

Append to `e2e/helpers.ts`:
```ts
export const E2E_USER = "e2e";
export const E2E_PASSWORD = "e2e-password";

export async function signIn(page: Page): Promise<void> {
  await page.getByLabel(/Username|ユーザー名/).fill(E2E_USER);
  await page.getByLabel(/Password|パスワード/).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /Sign in|サインイン/ }).click();
  await expect(page.locator(".gallery__title")).toBeVisible();
}
```

- [ ] **Step 3: Write the journey spec**

`e2e/gallery.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { minimalImdfZipBuffer, signIn, VENUE_NAME_JA, waitForReadyVenue } from "./helpers";

test.describe("gallery journey", () => {
  test("sign in → upload → card → open in viewer", async ({ page }) => {
    await page.goto("/");

    // Anonymous visit shows the sign-in card.
    await expect(page.locator(".signin-card")).toBeVisible();
    await signIn(page);

    // Upload the fixture through the modal.
    await page.getByRole("button", { name: /Open local data|ローカルデータを開く/ }).click();
    const buffer = await minimalImdfZipBuffer();
    await page
      .locator('.upload-modal input[type="file"]')
      .setInputFiles({ name: "tokyo-test.zip", mimeType: "application/zip", buffer });
    await expect(page.getByLabel(/Dataset name|データセット名/)).toHaveValue("tokyo-test");
    await page.getByRole("button", { name: /Publish|公開/ }).click();

    // Published → open in the viewer via the modal link.
    const open = page.getByRole("link", { name: /^Open$|^開く$/ });
    await expect(open).toBeVisible({ timeout: 20_000 });
    await open.click();
    await waitForReadyVenue(page, VENUE_NAME_JA);
    expect(page.url()).toContain("dataset=tokyo-test");

    // Back to the gallery: the card shows stats from the publish pipeline.
    await page.goto("/");
    const card = page.locator(".dataset-card", { hasText: "tokyo-test" });
    await expect(card).toBeVisible();
    await expect(card.locator(".dataset-card__meta")).toContainText("3");
  });
});
```

- [ ] **Step 4: Run the suite**

Run: `pnpm exec playwright test --project=chromium e2e/gallery.spec.ts`
Expected: the gallery spec passes, but the existing upload-driven viewer specs FAIL — they `page.goto("/")` and now land on the gallery instead of the viewer. Fix using the `forceViewer` flag Task 8 added: append to `e2e/helpers.ts`:

```ts
/** Viewer entry for upload-driven specs (bypasses the gallery). */
export const VIEWER_URL = "/?viewer";
```

Replace `page.goto("/")` with `page.goto(VIEWER_URL)` in `e2e/viewer.spec.ts` (3 calls), `e2e/viewer.visual.spec.ts` (3 calls — the embed test keeps its `?src=…&embed=1` URL), and `e2e/viewer.performance.spec.ts` (all calls), importing `VIEWER_URL` in each.

Run: `pnpm exec playwright test --project=chromium --project=firefox`
Expected: fully green.

- [ ] **Step 5: Update visual baselines if the viewer URL change shifts nothing**

Run: `pnpm exec playwright test --project=chromium-visual`
Expected: PASS unchanged (same viewer pixels; only the URL differs). If a diff appears, inspect before regenerating — the gallery change must not alter viewer rendering.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts e2e/ .gitignore src/
git commit -m "e2e: gallery journey with live kiriko-server, viewer entry flag"
```

---

## Final verification (after all tasks)

```bash
pnpm typecheck && pnpm --filter kiriko-server typecheck   # both clean
pnpm test -- --run && pnpm test:server                     # all unit suites
pnpm exec playwright test --project=chromium --project=firefox
pnpm exec playwright test --project=chromium-visual
pnpm build
```

Manual smoke (two terminals): `pnpm dev:server` + `pnpm dev`, then browse `http://localhost:5173` → sign in with bootstrap credentials (`KIRIKO_BOOTSTRAP_USER=daniel KIRIKO_BOOTSTRAP_PASSWORD=… pnpm dev:server` first run) → upload a real station IMDF zip → open it in the viewer → confirm `?dataset=` deep link works in a private window (anonymous viewer read of a published archive).
