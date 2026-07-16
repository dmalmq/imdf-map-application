# GIS Dataset Sharing Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot the IMDF/GDB viewer into an ACC/Forma-style intranet platform: admins publish reviewed datasets once, colleagues browse a gallery, view them instantly, and leave pinned comments — per `docs/superpowers/specs/2026-07-16-gis-dataset-sharing-design.md`.

**Architecture:** Publish-time snapshot bundles (serialized `LoadedVenue` in a ZIP) uploaded to one dependency-free Node intranet server that also stores the catalog, comments, accounts, and serves the built app. The viewer gains `?dataset=<id>` loading, a gallery landing page, a publish dialog, an account control, and a comments panel. Reads are public; writes are gated (`admin` publishes/deletes, `user` comments).

**Tech Stack:** Existing Vite 8 + React 19 + TypeScript strict app; `@zip.js/zip.js` (already a dependency) for bundle read/write; server uses only `node:http`/`node:fs`/`node:path`/`node:crypto`; vitest 4 + Playwright.

## Global Constraints

- Commands run through corepack: `corepack pnpm test --run <files>`, `corepack pnpm typecheck`, `corepack pnpm build`.
- TypeScript is strict with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`. Optional fields MUST be set via conditional spread (`...(x !== null ? { field: x } : {})`), never `field: undefined`. Type-only imports MUST use `import type`.
- The server (`server/*.ts`) has ZERO runtime dependencies: only `node:` builtins. No Express, no busboy.
- Dataset id regex everywhere: `^[a-z0-9][a-z0-9-]{0,63}$`.
- Upload cap: 600 MiB. Comment text: 1..2000 chars. Name: 1..120. sourceName: 1..200.
- API response envelopes: `{ datasets }`, `{ dataset }`, `{ comments }`, `{ comment }`, `{ account }`; errors are `{ code, message }` with 4xx/5xx status. DELETE returns 204.
- Roles: `admin` (publish, delete datasets, delete any comment), `user` (comment, delete own comments). Reads (catalog, blobs, comments, static app) are public — never gate a GET.
- Session cookie: name `gis_session`, `HttpOnly; Path=/; SameSite=Lax`.
- UI copy follows the existing pattern: `const ui = { key: { ja: "…", en: "…" } }` records; component CSS goes in `src/app/app.css` with BEM-ish block names.
- Existing behavior MUST NOT regress: `?src=` loading, embed mode, IMDF strict validation, GDB import review. GDAL WASM stays out of the viewer path.
- Tests colocated as `*.test.ts(x)`. Server tests use `// @vitest-environment node` as the first line. `tests/setup.ts` is already node-safe.
- Commit prefixes: `feat:`, `test:`, `docs:`, `chore:`.

## File Structure

```
server/types.ts                        (new)  wire types: CatalogEntry, CommentRecord, UserRecord, SessionRecord
server/store.ts                        (new)  PlatformStore: catalog/blobs/comments/users/sessions, atomic writes
server/auth.ts                         (new)  scrypt hashing, session tokens, cookie parsing
server/app.ts                          (new)  node:http router: API + gating + static serving
server/main.ts                         (new)  CLI: serve + add-user
server/tsconfig.json                   (new)  NodeNext build -> server/dist
server/store.test.ts                   (new)
server/auth.test.ts                    (new)
server/app.test.ts                     (new)
src/platform/types.ts                  (new)  client mirror of wire types + AccountInfo
src/platform/catalogClient.ts          (new)  fetch wrappers, PlatformError, slugify, URLs
src/platform/catalogClient.test.ts     (new)
src/imdf/venueSnapshot.ts              (new)  LoadedVenue <-> snapshot ZIP
src/imdf/venueSnapshot.test.ts         (new)
src/errors/ArchiveError.ts             (mod)  add "snapshot_version_mismatch"
src/app/viewerParams.ts                (mod)  add dataset param
src/components/resolveSelectedFeatureContent.ts (mod)  sourceAttributes + provenance
src/components/SelectedFeatureContent.tsx       (mod)  original attribute table
src/components/SignInDialog.tsx        (new)  modal sign-in form (App-level)
src/components/AccountStatus.tsx       (new)  menu row: name/role + sign in/out
src/components/ViewerMenu.tsx          (mod)  optional accountSlot
src/components/DatasetGallery.tsx      (new)  catalog cards
src/components/PublishDialog.tsx       (new)  publish flow
src/components/CommentsPanel.tsx       (new)  comments list/composer
src/map/IndoorMap.tsx                  (mod)  optional onMapClick + flyTo props
src/app/App.tsx                        (mod)  probe, gallery, dataset load, publish, comments wiring
src/app/App.test.tsx                   (mod)  integration tests
vitest.config.ts                       (mod)  include server tests
tsconfig.json                          (mod)  include server
playwright.config.ts                   (mod)  second webServer (platform)
e2e/platform.spec.ts                   (new)  full journey
package.json                           (mod)  build:server script
.gitignore                             (mod)  server/dist, data dirs
README.md                              (mod)  deployment section
```

---

### Task 1: Server storage engine

**Files:**
- Create: `server/types.ts`
- Create: `server/store.ts`
- Test: `server/store.test.ts`
- Modify: `vitest.config.ts`, `tsconfig.json`, `.gitignore`

**Interfaces:**
- Consumes: nothing (foundation).
- Produces (used by Tasks 2-4):
  - `server/types.ts`: `DatasetKind = "venue-snapshot" | "imdf"`, `Role = "admin" | "user"`, `CatalogEntry { id; name; kind; levelCount; featureCount; sourceName; updatedAt }`, `CommentRecord { id; author; text; createdAt; levelId?; lngLat?: [number, number]; featureId? }`, `UserRecord { username; role; salt; passwordHash }`, `SessionRecord { token; username; createdAt }` (all string/number fields as in the spec).
  - `server/store.ts`: `DATASET_ID_RE`, `StoredCatalogEntry extends CatalogEntry { contentHash: string }`, `BlobSnapshot { entry: StoredCatalogEntry; path: string }`, `class PlatformStore` with `static open(dataDir): Promise<PlatformStore>`, `listCatalog(): CatalogEntry[]`, `getEntry(id): StoredCatalogEntry | undefined`, `getBlobSnapshot(id): BlobSnapshot | undefined` (captures one entry and immutable generation path atomically for HTTP reads), `blobPath(id): string`, `putDataset(meta: Omit<CatalogEntry, "updatedAt">, blob: Buffer): Promise<CatalogEntry>`, `deleteDataset(id): Promise<boolean>`, `listComments(id): Promise<CommentRecord[]>`, `addComment(id, input: Omit<CommentRecord, "id" | "createdAt">): Promise<CommentRecord>`, `deleteComment(id, commentId): Promise<CommentRecord | null>`, `findUser(username): UserRecord | undefined`, `upsertUser(user): Promise<void>`, `findSession(token): SessionRecord | undefined`, `addSession(session): Promise<void>`, `deleteSession(token): Promise<void>`. Blob generations are immutable `<id>.<contentHash>.zip` files; overwrite/delete generations remain readable until `open()` startup GC, preventing GET races.

- [ ] **Step 1: Wire test/typecheck plumbing**

In `vitest.config.ts`, change the `include` line to:

```ts
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
```

In `tsconfig.json`, change the `include` array to:

```json
  "include": ["src", "e2e", "tests", "server", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
```

Append to `.gitignore`:

```
server/dist/
platform-data/
e2e/.platform-data/
```

- [ ] **Step 2: Write the failing store test**

Create `server/store.test.ts`:

```ts
// @vitest-environment node
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PlatformStore } from "./store";
import type { CatalogEntry } from "./types";

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "gis-store-"));
}

const META: Omit<CatalogEntry, "updatedAt"> = {
  id: "tokyo-station",
  name: "東京駅",
  kind: "venue-snapshot",
  levelCount: 15,
  featureCount: 17521,
  sourceName: "JRTokyoSta.gdb",
};

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

describe("PlatformStore", () => {
  it("puts a dataset, lists it without contentHash, and persists the blob", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    const entry = await store.putDataset(META, ZIP);
    expect(entry.updatedAt).toMatch(/^\d{4}-/);
    expect("contentHash" in entry).toBe(false);
    expect(store.listCatalog()).toEqual([entry]);
    expect(await readFile(store.blobPath("tokyo-station"))).toEqual(ZIP);
    expect(store.getEntry("tokyo-station")?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("overwrite replaces the entry; delete removes blob, entry, and comments", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    await store.putDataset({ ...META, name: "Tokyo v2" }, ZIP);
    expect(store.listCatalog()).toHaveLength(1);
    expect(store.listCatalog()[0]?.name).toBe("Tokyo v2");
    await store.addComment("tokyo-station", { author: "alice", text: "hi" });
    expect(await store.deleteDataset("tokyo-station")).toBe(true);
    expect(store.listCatalog()).toEqual([]);
    expect(await store.listComments("tokyo-station")).toEqual([]);
    expect(await store.deleteDataset("tokyo-station")).toBe(false);
  });

  it("comments append with server-assigned id/createdAt and delete by id", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    const created = await store.addComment("any", { author: "alice", text: "first", lngLat: [139.76, 35.68], levelId: "ordinal:0" });
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(await store.listComments("any")).toEqual([created]);
    expect(await store.deleteComment("any", created.id)).toEqual(created);
    expect(await store.deleteComment("any", created.id)).toBeNull();
  });

  it("drops catalog entries whose blob is missing at boot", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const catalogFile = path.join(dir, "catalog.json");
    const rows = JSON.parse(await readFile(catalogFile, "utf8")) as unknown[];
    await writeFile(
      catalogFile,
      JSON.stringify([...rows, { ...META, id: "dangling", updatedAt: "2026-01-01T00:00:00.000Z", contentHash: "0".repeat(64) }]),
    );
    const reopened = await PlatformStore.open(dir);
    expect(reopened.listCatalog().map((entry) => entry.id)).toEqual(["tokyo-station"]);
  });

  it("persists users and sessions across reopen", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.upsertUser({ username: "admin", role: "admin", salt: "aa", passwordHash: "bb" });
    await store.addSession({ token: "t1", username: "admin", createdAt: "2026-01-01T00:00:00.000Z" });
    const reopened = await PlatformStore.open(dir);
    expect(reopened.findUser("admin")?.role).toBe("admin");
    expect(reopened.findSession("t1")?.username).toBe("admin");
    await reopened.deleteSession("t1");
    expect(reopened.findSession("t1")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `corepack pnpm test --run server/store.test.ts`
Expected: FAIL — cannot resolve `./store` / `./types`.

- [ ] **Step 4: Implement the types and store**

Create `server/types.ts`:

```ts
/**
 * Wire types for the sharing platform server. src/platform/types.ts mirrors
 * these for the client; keep both in sync by hand. The server re-validates
 * all client input, so drift fails loudly rather than silently.
 */
export type DatasetKind = "venue-snapshot" | "imdf";
export type Role = "admin" | "user";

export interface CatalogEntry {
  id: string;
  name: string;
  kind: DatasetKind;
  levelCount: number;
  featureCount: number;
  sourceName: string;
  updatedAt: string;
}

export interface CommentRecord {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  levelId?: string;
  lngLat?: [number, number];
  featureId?: string;
}

export interface UserRecord {
  username: string;
  role: Role;
  salt: string;
  passwordHash: string;
}

export interface SessionRecord {
  token: string;
  username: string;
  createdAt: string;
}
```

Create `server/store.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogEntry, CommentRecord, SessionRecord, UserRecord } from "./types";

export const DATASET_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Catalog row as persisted; contentHash backs the blob ETag and never leaves the server. */
export interface StoredCatalogEntry extends CatalogEntry {
  contentHash: string;
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export class PlatformStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly catalog = new Map<string, StoredCatalogEntry>();
  private readonly users = new Map<string, UserRecord>();
  private readonly sessions = new Map<string, SessionRecord>();

  private constructor(private readonly dataDir: string) {}

  static async open(dataDir: string): Promise<PlatformStore> {
    const store = new PlatformStore(dataDir);
    await mkdir(path.join(dataDir, "blobs"), { recursive: true });
    await mkdir(path.join(dataDir, "comments"), { recursive: true });
    const rows = await readJsonFile<StoredCatalogEntry[]>(store.file("catalog.json"), []);
    const blobs = new Set(await readdir(path.join(dataDir, "blobs")));
    for (const row of rows) {
      if (blobs.has(`${row.id}.zip`)) {
        store.catalog.set(row.id, row);
      } else {
        console.warn(`[store] dropping catalog entry without blob: ${row.id}`);
      }
    }
    for (const user of await readJsonFile<UserRecord[]>(store.file("users.json"), [])) {
      store.users.set(user.username, user);
    }
    for (const session of await readJsonFile<SessionRecord[]>(store.file("sessions.json"), [])) {
      store.sessions.set(session.token, session);
    }
    return store;
  }

  private file(name: string): string {
    return path.join(this.dataDir, name);
  }

  blobPath(id: string): string {
    return path.join(this.dataDir, "blobs", `${id}.zip`);
  }

  private commentsPath(id: string): string {
    return path.join(this.dataDir, "comments", `${id}.json`);
  }

  /** All mutations run through one queue; each file write is temp + rename. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async atomicWrite(file: string, data: string | Buffer): Promise<void> {
    const tmp = `${file}.tmp-${randomUUID()}`;
    await writeFile(tmp, data);
    await rename(tmp, file);
  }

  listCatalog(): CatalogEntry[] {
    return [...this.catalog.values()]
      .map(({ contentHash: _hash, ...entry }) => entry)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  getEntry(id: string): StoredCatalogEntry | undefined {
    return this.catalog.get(id);
  }

  putDataset(meta: Omit<CatalogEntry, "updatedAt">, blob: Buffer): Promise<CatalogEntry> {
    return this.enqueue(async () => {
      const stored: StoredCatalogEntry = {
        ...meta,
        updatedAt: new Date().toISOString(),
        contentHash: createHash("sha256").update(blob).digest("hex"),
      };
      await this.atomicWrite(this.blobPath(meta.id), blob);
      this.catalog.set(meta.id, stored);
      await this.persistCatalog();
      const { contentHash: _hash, ...entry } = stored;
      return entry;
    });
  }

  deleteDataset(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      if (!this.catalog.delete(id)) {
        return false;
      }
      await this.persistCatalog();
      await rm(this.blobPath(id), { force: true });
      await rm(this.commentsPath(id), { force: true });
      return true;
    });
  }

  private persistCatalog(): Promise<void> {
    return this.atomicWrite(
      this.file("catalog.json"),
      JSON.stringify([...this.catalog.values()], null, 2),
    );
  }

  listComments(datasetId: string): Promise<CommentRecord[]> {
    return readJsonFile<CommentRecord[]>(this.commentsPath(datasetId), []);
  }

  addComment(
    datasetId: string,
    input: Omit<CommentRecord, "id" | "createdAt">,
  ): Promise<CommentRecord> {
    return this.enqueue(async () => {
      const record: CommentRecord = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      const all = await readJsonFile<CommentRecord[]>(this.commentsPath(datasetId), []);
      all.push(record);
      await this.atomicWrite(this.commentsPath(datasetId), JSON.stringify(all, null, 2));
      return record;
    });
  }

  deleteComment(datasetId: string, commentId: string): Promise<CommentRecord | null> {
    return this.enqueue(async () => {
      const all = await readJsonFile<CommentRecord[]>(this.commentsPath(datasetId), []);
      const index = all.findIndex((comment) => comment.id === commentId);
      if (index === -1) {
        return null;
      }
      const [removed] = all.splice(index, 1);
      await this.atomicWrite(this.commentsPath(datasetId), JSON.stringify(all, null, 2));
      return removed ?? null;
    });
  }

  findUser(username: string): UserRecord | undefined {
    return this.users.get(username);
  }

  upsertUser(user: UserRecord): Promise<void> {
    return this.enqueue(async () => {
      this.users.set(user.username, user);
      await this.atomicWrite(
        this.file("users.json"),
        JSON.stringify([...this.users.values()], null, 2),
      );
    });
  }

  findSession(token: string): SessionRecord | undefined {
    return this.sessions.get(token);
  }

  addSession(session: SessionRecord): Promise<void> {
    return this.enqueue(async () => {
      this.sessions.set(session.token, session);
      await this.persistSessions();
    });
  }

  deleteSession(token: string): Promise<void> {
    return this.enqueue(async () => {
      this.sessions.delete(token);
      await this.persistSessions();
    });
  }

  private persistSessions(): Promise<void> {
    return this.atomicWrite(
      this.file("sessions.json"),
      JSON.stringify([...this.sessions.values()], null, 2),
    );
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `corepack pnpm test --run server/store.test.ts`
Expected: PASS (5 tests). Also run `corepack pnpm typecheck` — expected clean.

- [ ] **Step 6: Commit**

```bash
git add server/types.ts server/store.ts server/store.test.ts vitest.config.ts tsconfig.json .gitignore
git commit -m "feat: add platform server storage engine"
```

---

### Task 2: Server auth helpers

**Files:**
- Create: `server/auth.ts`
- Test: `server/auth.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 3-4): `SESSION_COOKIE = "gis_session"`, `hashPassword(password: string, salt?: string): { salt: string; passwordHash: string }`, `verifyPassword(password: string, salt: string, passwordHash: string): boolean`, `newSessionToken(): string`, `parseCookies(header: string | undefined): Record<string, string>`.

- [ ] **Step 1: Write the failing test**

Create `server/auth.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hashPassword, newSessionToken, parseCookies, verifyPassword } from "./auth";

describe("auth", () => {
  it("scrypt hash round-trips and rejects a wrong password", () => {
    const { salt, passwordHash } = hashPassword("secret-pw");
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(passwordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyPassword("secret-pw", salt, passwordHash)).toBe(true);
    expect(verifyPassword("wrong", salt, passwordHash)).toBe(false);
    expect(verifyPassword("secret-pw", salt, "zz")).toBe(false);
  });

  it("session tokens are 64 hex chars and unique", () => {
    const a = newSessionToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newSessionToken()).not.toBe(a);
  });

  it("parses cookie headers tolerantly", () => {
    expect(parseCookies("gis_session=abc; other=1")).toEqual({ gis_session: "abc", other: "1" });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("junk")).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test --run server/auth.test.ts`
Expected: FAIL — cannot resolve `./auth`.

- [ ] **Step 3: Implement**

Create `server/auth.ts`:

```ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "gis_session";

export function hashPassword(
  password: string,
  salt?: string,
): { salt: string; passwordHash: string } {
  const actualSalt = salt ?? randomBytes(16).toString("hex");
  const passwordHash = scryptSync(password, actualSalt, 32).toString("hex");
  return { salt: actualSalt, passwordHash };
}

export function verifyPassword(password: string, salt: string, passwordHash: string): boolean {
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(passwordHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (header === undefined) {
    return cookies;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return cookies;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm test --run server/auth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/auth.ts server/auth.test.ts
git commit -m "feat: add scrypt password hashing and session helpers"
```

---

### Task 3: HTTP API with write-gating and static serving

**Files:**
- Create: `server/app.ts`
- Test: `server/app.test.ts`

**Interfaces:**
- Consumes: `PlatformStore`, `DATASET_ID_RE` (Task 1); auth helpers (Task 2).
- Produces (used by Task 4 and e2e): `interface AppOptions { store: PlatformStore; appDir: string | null; maxUploadBytes?: number }`, `createApp(options: AppOptions): http.Server`. Routes and envelopes exactly as in Global Constraints and the spec §3.

- [ ] **Step 1: Write the failing API test**

Create `server/app.test.ts`:

```ts
// @vitest-environment node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
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
  return { base: `http://127.0.0.1:${address.port}`, server, dataDir };
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
      (await fetch(`${base}/api/datasets/tokyo?${PUT_QUERY}`, { method: "PUT", headers, body: Buffer.from("not a zip at all") })).status,
    ).toBe(400);
    const big = Buffer.alloc(64, 1);
    big[0] = 0x50; big[1] = 0x4b; big[2] = 0x03; big[3] = 0x04;
    expect(
      (await fetch(`${base}/api/datasets/tokyo?${PUT_QUERY}`, { method: "PUT", headers, body: big })).status,
    ).toBe(413);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test --run server/app.test.ts`
Expected: FAIL — cannot resolve `./app`.

- [ ] **Step 3: Implement the HTTP app**

Create `server/app.ts`:

```ts
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import path from "node:path";
import { SESSION_COOKIE, newSessionToken, parseCookies, verifyPassword } from "./auth";
import { DATASET_ID_RE, PlatformStore } from "./store";
import type { CatalogEntry, CommentRecord, DatasetKind, UserRecord } from "./types";

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

class BodyTooLarge extends Error {}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { code, message });
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new BodyTooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
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
  const levelCount = Number(query.get("levelCount"));
  const featureCount = Number(query.get("featureCount"));
  if (
    !Number.isInteger(levelCount) ||
    levelCount < 0 ||
    !Number.isInteger(featureCount) ||
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
    const snapshot = store.getBlobSnapshot(id);
    if (snapshot === undefined) {
      sendError(res, 404, "not_found", "Dataset not found.");
      return;
    }
    const { entry, path: file } = snapshot;
    const etag = `"${entry.contentHash}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304);
      res.end();
      return;
    }
    // `file` and `entry` come from the same immutable snapshot; an overwrite
    // cannot pair an old ETag with a new generation path.
    const info = await stat(file);
    res.writeHead(200, {
      "content-type": "application/zip",
      "content-length": info.size,
      etag,
    });
    createReadStream(file).pipe(res);
  }

  async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
    if (appDir === null) {
      sendError(res, 404, "not_found", "Not found.");
      return;
    }
    const root = path.resolve(appDir);
    const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.slice(1));
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
    createReadStream(resolved).pipe(res);
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
        if (store.getEntry(id) === undefined) {
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
          const comment = await store.addComment(id, { ...input, author: user.username });
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
        await serveBlob(req, res, file.slice(0, -4));
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
      console.error("[server] unhandled", error);
      if (!res.headersSent) {
        sendError(res, 500, "internal_error", "Unexpected server error.");
      } else {
        res.destroy();
      }
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm test --run server/app.test.ts server/store.test.ts server/auth.test.ts`
Expected: PASS. Also `corepack pnpm typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/app.test.ts
git commit -m "feat: add platform HTTP API with write-gating and static serving"
```

---

### Task 4: Server entry point, add-user CLI, build script

**Files:**
- Create: `server/main.ts`
- Create: `server/tsconfig.json`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `createApp` (Task 3), `PlatformStore` (Task 1), `hashPassword` (Task 2).
- Produces: runnable service `node server/dist/main.js --port 8080 --data <dir> --app <dist>`; account CLI `node server/dist/main.js add-user <name> --role admin|user [--password <pw>] [--data <dir>]` (prompts for the password when `--password` is omitted). Used verbatim by Playwright (Task 14) and README (Task 15).

- [ ] **Step 1: Create the server build config**

Create `server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["*.ts"],
  "exclude": ["*.test.ts", "dist"]
}
```

NodeNext requires explicit extensions on relative imports at runtime. The server sources written in Tasks 1-3 import `./types`, `./store`, `./auth` without extensions — as part of this step change every relative import inside `server/*.ts` (not tests) to the `.js` form (`./types.js`, `./store.js`, `./auth.js`, `./app.js`). Test files may keep extensionless imports (vitest resolves them). Re-run `corepack pnpm test --run server` and `corepack pnpm typecheck` after the rename — both must stay green (the root `bundler` resolution accepts `.js` specifiers for `.ts` sources).

- [ ] **Step 2: Implement the CLI entry**

Create `server/main.ts`:

```ts
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { createApp } from "./app.js";
import { hashPassword } from "./auth.js";
import { PlatformStore } from "./store.js";

function argValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index !== -1 && index + 1 < args.length ? (args[index + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dataDir = path.resolve(argValue(args, "--data") ?? "./platform-data");

  if (args[0] === "add-user") {
    const username = args[1];
    const role = argValue(args, "--role");
    if (username === undefined || username.startsWith("--") || (role !== "admin" && role !== "user")) {
      console.error(
        "Usage: node server/dist/main.js add-user <name> --role admin|user [--password <pw>] [--data <dir>]",
      );
      process.exitCode = 1;
      return;
    }
    let password = argValue(args, "--password");
    if (password === null) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      password = await rl.question(`Password for ${username}: `);
      rl.close();
    }
    if (password.length < 4) {
      console.error("Password must be at least 4 characters.");
      process.exitCode = 1;
      return;
    }
    const store = await PlatformStore.open(dataDir);
    await store.upsertUser({ username, role, ...hashPassword(password) });
    console.log(`Stored ${role} account "${username}" in ${dataDir}`);
    return;
  }

  const port = Number(argValue(args, "--port") ?? "8080");
  const appArg = argValue(args, "--app");
  const store = await PlatformStore.open(dataDir);
  const server = createApp({ store, appDir: appArg === null ? null : path.resolve(appArg) });
  server.listen(port, () => {
    console.log(
      `GIS dataset platform listening on http://127.0.0.1:${port} (data: ${dataDir})`,
    );
  });
}

void main();
```

Add to `package.json` scripts (keep existing entries):

```json
    "build:server": "tsc -p server/tsconfig.json",
```

- [ ] **Step 3: Smoke-test the built server**

```bash
corepack pnpm build:server
node server/dist/main.js add-user smoke --role admin --password smoke-pw --data ./tmp-smoke-data
node server/dist/main.js --port 8125 --data ./tmp-smoke-data
```

In a second shell: `curl -s http://127.0.0.1:8125/api/catalog` → expected `{"datasets":[]}`; `curl -s -X POST http://127.0.0.1:8125/api/login -H "content-type: application/json" -d "{\"username\":\"smoke\",\"password\":\"smoke-pw\"}"` → expected `{"account":{"username":"smoke","role":"admin"}}`. Stop the server, delete `./tmp-smoke-data`.

- [ ] **Step 4: Commit**

```bash
git add server/main.ts server/tsconfig.json server/store.ts server/auth.ts server/app.ts package.json
git commit -m "feat: add platform server CLI entry and build script"
```

---

### Task 5: Venue snapshot bundle format

**Files:**
- Modify: `src/errors/ArchiveError.ts`
- Create: `src/imdf/venueSnapshot.ts`
- Test: `src/imdf/venueSnapshot.test.ts`

**Interfaces:**
- Consumes: `LoadedVenue` and friends from `src/imdf/types.ts`; `ArchiveError`.
- Produces (used by Tasks 11-12): `SNAPSHOT_SCHEMA_VERSION = 1`, `writeVenueSnapshot(venue: LoadedVenue, sourceName: string): Promise<Blob>`, `readVenueSnapshot(data: Blob): Promise<LoadedVenue>`; new `ArchiveErrorCode` `"snapshot_version_mismatch"`.

- [ ] **Step 1: Add the new error code**

In `src/errors/ArchiveError.ts`, append to the `ArchiveErrorCode` union:

```ts
  | "snapshot_version_mismatch";
```

and to `archiveErrorCopy`:

```ts
  snapshot_version_mismatch:
    "This dataset was published with an unsupported format version. Ask the publisher to republish it.",
```

(The `Record<ArchiveErrorCode, string>` type makes forgetting the copy a compile error.)

- [ ] **Step 2: Write the failing round-trip test**

Create `src/imdf/venueSnapshot.test.ts`:

```ts
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BlobWriter, TextReader, ZipWriter, configure } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { ArchiveError } from "../errors/ArchiveError";
import { normalizeVenue } from "./normalizeVenue";
import type { FeatureType, ImdfManifest, LoadedVenue, ParsedImdfArchive } from "./types";
import { readVenueSnapshot, writeVenueSnapshot } from "./venueSnapshot";

configure({ useWebWorkers: false });

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "tests",
  "fixtures",
  "minimal-imdf",
);

async function loadFixtureVenue(): Promise<LoadedVenue> {
  const manifest = JSON.parse(
    await readFile(path.join(FIXTURE_DIR, "manifest.json"), "utf8"),
  ) as ImdfManifest;
  const collections: ParsedImdfArchive["collections"] = {};
  for (const name of await readdir(FIXTURE_DIR)) {
    if (!name.endsWith(".geojson")) {
      continue;
    }
    collections[name.replace(/\.geojson$/, "") as FeatureType] = JSON.parse(
      await readFile(path.join(FIXTURE_DIR, name), "utf8"),
    ) as GeoJSON.FeatureCollection;
  }
  return normalizeVenue({ manifest, collections });
}

describe("venueSnapshot", () => {
  it("round-trips a LoadedVenue byte-for-byte including Maps and sourceProperties", async () => {
    const venue = await loadFixtureVenue();
    // Simulate a GDB-derived feature: original columns + provenance keys.
    const first = [...venue.featuresById.values()][0];
    expect(first).toBeDefined();
    first!.sourceProperties = {
      OBJECTID: 1,
      FLOOR: "1F",
      幅員: null,
      __gdb_database: "gdb-1",
      __gdb_layer: "net_path",
    };
    const blob = await writeVenueSnapshot(venue, "JRTokyoSta.gdb");
    const restored = await readVenueSnapshot(blob);
    expect(restored.featuresById).toBeInstanceOf(Map);
    expect(restored.renderFeaturesByLevel).toBeInstanceOf(Map);
    expect(restored.boundsByLevel).toBeInstanceOf(Map);
    expect(restored.enrichmentByFeatureId).toBeInstanceOf(Map);
    expect(restored).toEqual(venue);
    const restoredFirst = restored.featuresById.get(first!.id);
    expect(Object.entries(restoredFirst!.sourceProperties)).toEqual(
      Object.entries(first!.sourceProperties),
    );
  });

  it("rejects a non-zip blob as invalid_archive", async () => {
    await expect(readVenueSnapshot(new Blob(["not a zip"]))).rejects.toMatchObject({
      code: "invalid_archive",
    });
  });

  it("rejects a zip without snapshot.json as missing_required_file", async () => {
    const writer = new ZipWriter(new BlobWriter("application/zip"));
    await writer.add("other.json", new TextReader("{}"));
    const blob = await writer.close();
    await expect(readVenueSnapshot(blob)).rejects.toMatchObject({
      code: "missing_required_file",
    });
  });

  it("rejects a future schemaVersion as snapshot_version_mismatch", async () => {
    const venue = await loadFixtureVenue();
    const blob = await writeVenueSnapshot(venue, "x.gdb");
    const text = await new Response(blob).arrayBuffer().then(async (bytes) => {
      const { BlobReader, TextWriter, ZipReader } = await import("@zip.js/zip.js");
      const reader = new ZipReader(new BlobReader(new Blob([bytes])));
      const [entry] = await reader.getEntries();
      const content = await entry!.getData!(new TextWriter());
      await reader.close();
      return content;
    });
    const tampered = JSON.stringify({ ...(JSON.parse(text) as object), schemaVersion: 999 });
    const writer = new ZipWriter(new BlobWriter("application/zip"));
    await writer.add("snapshot.json", new TextReader(tampered));
    const bad = await writer.close();
    const error = await readVenueSnapshot(bad).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ArchiveError);
    expect((error as ArchiveError).code).toBe("snapshot_version_mismatch");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `corepack pnpm test --run src/imdf/venueSnapshot.test.ts`
Expected: FAIL — cannot resolve `./venueSnapshot`.

- [ ] **Step 4: Implement the snapshot module**

Create `src/imdf/venueSnapshot.ts`:

```ts
import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
  configure,
} from "@zip.js/zip.js";
import { ArchiveError } from "../errors/ArchiveError";
import type {
  BoundsTuple,
  ImdfManifest,
  LoadedVenue,
  SearchEntry,
  ViewerEnrichmentEntry,
  ViewerFeature,
  ViewerLevel,
  ViewerWarning,
} from "./types";

// Deflate on the calling thread: deterministic in jsdom/node tests, and the
// only writer is the publish flow, where a short main-thread stall is fine.
configure({ useWebWorkers: false });

export const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_ENTRY = "snapshot.json";

interface SerializedVenue {
  manifest: ImdfManifest;
  venue: ViewerFeature;
  levels: ViewerLevel[];
  featuresById: [string, ViewerFeature][];
  renderFeaturesByLevel: [string, GeoJSON.FeatureCollection][];
  searchEntries: SearchEntry[];
  boundsByLevel: [string, BoundsTuple][];
  enrichmentByFeatureId: [string, ViewerEnrichmentEntry][];
  warnings: ViewerWarning[];
}

interface SnapshotFile {
  schemaVersion: number;
  kind: string;
  generatedAt: string;
  sourceName: string;
  venue: SerializedVenue;
}

export async function writeVenueSnapshot(
  venue: LoadedVenue,
  sourceName: string,
): Promise<Blob> {
  const payload: SnapshotFile = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: "venue-snapshot",
    generatedAt: new Date().toISOString(),
    sourceName,
    venue: {
      manifest: venue.manifest,
      venue: venue.venue,
      levels: venue.levels,
      featuresById: [...venue.featuresById.entries()],
      renderFeaturesByLevel: [...venue.renderFeaturesByLevel.entries()],
      searchEntries: venue.searchEntries,
      boundsByLevel: [...venue.boundsByLevel.entries()],
      enrichmentByFeatureId: [...venue.enrichmentByFeatureId.entries()],
      warnings: venue.warnings,
    },
  };
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add(SNAPSHOT_ENTRY, new TextReader(JSON.stringify(payload)));
  return writer.close();
}

export async function readVenueSnapshot(data: Blob): Promise<LoadedVenue> {
  const reader = new ZipReader(new BlobReader(data));
  let text: string;
  try {
    const entries = await reader.getEntries();
    const entry = entries.find((candidate) => candidate.filename === SNAPSHOT_ENTRY);
    if (entry === undefined || entry.getData === undefined) {
      throw new ArchiveError(
        "missing_required_file",
        "The dataset bundle has no snapshot.json entry.",
      );
    }
    text = await entry.getData(new TextWriter());
  } catch (error) {
    if (error instanceof ArchiveError) {
      throw error;
    }
    throw new ArchiveError("invalid_archive", "The dataset bundle is not a readable ZIP.");
  } finally {
    await reader.close().catch(() => undefined);
  }
  let parsed: SnapshotFile;
  try {
    parsed = JSON.parse(text) as SnapshotFile;
  } catch {
    throw new ArchiveError("invalid_json", "snapshot.json is not valid JSON.");
  }
  if (parsed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || parsed.kind !== "venue-snapshot") {
    throw new ArchiveError(
      "snapshot_version_mismatch",
      "Unsupported dataset snapshot version.",
      { schemaVersion: parsed.schemaVersion },
    );
  }
  const venue = parsed.venue;
  if (
    typeof venue !== "object" ||
    venue === null ||
    !Array.isArray(venue.levels) ||
    !Array.isArray(venue.featuresById)
  ) {
    throw new ArchiveError("invalid_archive", "snapshot.json is missing required venue fields.");
  }
  return {
    manifest: venue.manifest,
    venue: venue.venue,
    levels: venue.levels,
    featuresById: new Map(venue.featuresById),
    renderFeaturesByLevel: new Map(venue.renderFeaturesByLevel),
    searchEntries: venue.searchEntries,
    boundsByLevel: new Map(venue.boundsByLevel),
    enrichmentByFeatureId: new Map(venue.enrichmentByFeatureId),
    warnings: venue.warnings,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `corepack pnpm test --run src/imdf/venueSnapshot.test.ts`
Expected: PASS (4 tests). `corepack pnpm typecheck` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/errors/ArchiveError.ts src/imdf/venueSnapshot.ts src/imdf/venueSnapshot.test.ts
git commit -m "feat: add venue snapshot bundle serialization"
```

---

### Task 6: `dataset` deep-link parameter

**Files:**
- Modify: `src/app/viewerParams.ts`
- Test: `src/app/viewerParams.test.ts` (existing file, add cases)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 10-13): `ViewerParams.dataset: string | null` — a validated dataset id (regex `^[a-z0-9][a-z0-9-]{0,63}$`), else `null`.

- [ ] **Step 1: Write the failing test**

Append to the `describe("parseViewerParams", …)` block in `src/app/viewerParams.test.ts`:

```ts
  it("accepts valid dataset ids and rejects invalid ones", () => {
    expect(parseViewerParams("?dataset=tokyo-station", BASE).dataset).toBe("tokyo-station");
    expect(parseViewerParams("?dataset=a", BASE).dataset).toBe("a");
    expect(parseViewerParams("?dataset=Tokyo", BASE).dataset).toBeNull();
    expect(parseViewerParams("?dataset=-bad", BASE).dataset).toBeNull();
    expect(parseViewerParams("?dataset=", BASE).dataset).toBeNull();
    expect(parseViewerParams("", BASE).dataset).toBeNull();
    expect(parseViewerParams(`?dataset=${"a".repeat(65)}`, BASE).dataset).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test --run src/app/viewerParams.test.ts`
Expected: FAIL — `dataset` is `undefined`.

- [ ] **Step 3: Implement**

In `src/app/viewerParams.ts`, add to the `ViewerParams` interface:

```ts
  dataset: string | null;
```

Add above `parseViewerParams`:

```ts
const DATASET_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
```

Inside `parseViewerParams`, before the return:

```ts
  const datasetRaw = params.get("dataset");
  const dataset = datasetRaw !== null && DATASET_ID_RE.test(datasetRaw) ? datasetRaw : null;
```

and add `dataset` to the returned object literal.

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm test --run src/app/viewerParams.test.ts`
Expected: PASS. Note: `src/app/App.test.tsx` may now fail to typecheck if it constructs `ViewerParams` literals — run `corepack pnpm typecheck` and add `dataset: null` to any such literal.

- [ ] **Step 5: Commit**

```bash
git add src/app/viewerParams.ts src/app/viewerParams.test.ts
git commit -m "feat: parse dataset deep-link parameter"
```

---

### Task 7: Platform API client

**Files:**
- Create: `src/platform/types.ts`
- Create: `src/platform/catalogClient.ts`
- Test: `src/platform/catalogClient.test.ts`

**Interfaces:**
- Consumes: server wire contract (Task 3 envelopes).
- Produces (used by Tasks 9-13):
  - `src/platform/types.ts`: `DatasetKind`, `Role`, `AccountInfo { username: string; role: Role }`, `CatalogEntry`, `CommentRecord`, `CommentInput { text: string; levelId?: string; lngLat?: [number, number]; featureId?: string }` — field-for-field mirrors of `server/types.ts`.
  - `src/platform/catalogClient.ts`: `class PlatformError extends Error { status: number; code: string }`, `fetchCatalog(signal?): Promise<CatalogEntry[]>`, `probeCatalog(timeoutMs = 3000): Promise<CatalogEntry[] | null>`, `datasetBlobUrl(id): string`, `datasetViewUrl(id, embed?): string`, `slugifyDatasetId(name): string`, `publishDataset(meta: PublishMeta, data: Blob): Promise<CatalogEntry>` where `PublishMeta { id; name; kind; levelCount; featureCount; sourceName }`, `fetchComments(datasetId, signal?): Promise<CommentRecord[]>`, `postComment(datasetId, input: CommentInput): Promise<CommentRecord>`, `deleteComment(datasetId, commentId): Promise<void>`, `login(username, password): Promise<AccountInfo>`, `logout(): Promise<void>`, `fetchMe(): Promise<AccountInfo | null>`.

- [ ] **Step 1: Write the failing test**

Create `src/platform/catalogClient.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PlatformError,
  datasetBlobUrl,
  datasetViewUrl,
  fetchCatalog,
  fetchMe,
  postComment,
  probeCatalog,
  publishDataset,
  slugifyDatasetId,
} from "./catalogClient";

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }): ReturnType<typeof vi.fn> {
  const impl = vi.fn().mockResolvedValue({ ok: true, status: 200, ...response });
  vi.stubGlobal("fetch", impl);
  return impl;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("catalogClient", () => {
  it("unwraps the datasets envelope", async () => {
    const entry = { id: "tokyo", name: "Tokyo", kind: "venue-snapshot", levelCount: 1, featureCount: 2, sourceName: "t.gdb", updatedAt: "2026-01-01T00:00:00.000Z" };
    mockFetch({ json: () => Promise.resolve({ datasets: [entry] }) });
    expect(await fetchCatalog()).toEqual([entry]);
  });

  it("throws PlatformError with the server code and message", async () => {
    mockFetch({ ok: false, status: 403, json: () => Promise.resolve({ code: "forbidden", message: "Publishing requires an admin account." }) });
    const error = await fetchCatalog().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PlatformError);
    expect((error as PlatformError).status).toBe(403);
    expect((error as PlatformError).code).toBe("forbidden");
    expect((error as PlatformError).message).toBe("Publishing requires an admin account.");
  });

  it("probeCatalog returns null on failure instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    expect(await probeCatalog(50)).toBeNull();
  });

  it("publishDataset PUTs the blob with URL-encoded metadata", async () => {
    const impl = mockFetch({ json: () => Promise.resolve({ dataset: { id: "shinjuku" } }) });
    const blob = new Blob(["zip"]);
    await publishDataset(
      { id: "shinjuku", name: "新宿駅", kind: "venue-snapshot", levelCount: 3, featureCount: 9, sourceName: "S.gdb" },
      blob,
    );
    const [url, init] = impl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/datasets/shinjuku?");
    expect(url).toContain(`name=${encodeURIComponent("新宿駅")}`);
    expect(url).toContain("kind=venue-snapshot");
    expect(url).toContain("levelCount=3");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(blob);
  });

  it("postComment posts JSON and unwraps the comment envelope", async () => {
    const impl = mockFetch({ json: () => Promise.resolve({ comment: { id: "c1", author: "alice", text: "hi", createdAt: "now" } }) });
    const posted = await postComment("tokyo", { text: "hi", lngLat: [139.7, 35.6] });
    expect(posted.id).toBe("c1");
    const [url, init] = impl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/datasets/tokyo/comments");
    expect(JSON.parse(init.body as string)).toEqual({ text: "hi", lngLat: [139.7, 35.6] });
  });

  it("fetchMe maps 401 to null", async () => {
    mockFetch({ ok: false, status: 401, json: () => Promise.resolve({ code: "unauthenticated", message: "x" }) });
    expect(await fetchMe()).toBeNull();
  });

  it("builds blob and view URLs and slugs", () => {
    expect(datasetBlobUrl("tokyo-station")).toBe("/datasets/tokyo-station.zip");
    expect(datasetViewUrl("tokyo-station")).toContain("/?dataset=tokyo-station");
    expect(datasetViewUrl("tokyo-station", true)).toContain("embed=1");
    expect(slugifyDatasetId("JR Tokyo Station 2026")).toBe("jr-tokyo-station-2026");
    expect(slugifyDatasetId("東京駅")).toBe("dataset");
    expect(slugifyDatasetId("--Weird__Name--")).toBe("weird-name");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test --run src/platform/catalogClient.test.ts`
Expected: FAIL — cannot resolve `./catalogClient`.

- [ ] **Step 3: Implement**

Create `src/platform/types.ts`:

```ts
/** Client mirror of server/types.ts — keep field-for-field in sync. */
export type DatasetKind = "venue-snapshot" | "imdf";
export type Role = "admin" | "user";

export interface AccountInfo {
  username: string;
  role: Role;
}

export interface CatalogEntry {
  id: string;
  name: string;
  kind: DatasetKind;
  levelCount: number;
  featureCount: number;
  sourceName: string;
  updatedAt: string;
}

export interface CommentRecord {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  levelId?: string;
  lngLat?: [number, number];
  featureId?: string;
}

export interface CommentInput {
  text: string;
  levelId?: string;
  lngLat?: [number, number];
  featureId?: string;
}
```

Create `src/platform/catalogClient.ts`:

```ts
import type {
  AccountInfo,
  CatalogEntry,
  CommentInput,
  CommentRecord,
  DatasetKind,
} from "./types";

export class PlatformError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

async function toPlatformError(response: Response): Promise<PlatformError> {
  let code = "http_error";
  let message = `Request failed (${response.status}).`;
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    if (typeof body.code === "string") {
      code = body.code;
    }
    if (typeof body.message === "string") {
      message = body.message;
    }
  } catch {
    // keep defaults
  }
  return new PlatformError(response.status, code, message);
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw await toPlatformError(response);
  }
  return (await response.json()) as T;
}

export async function fetchCatalog(signal?: AbortSignal): Promise<CatalogEntry[]> {
  const body = await requestJson<{ datasets: CatalogEntry[] }>("/api/catalog", {
    signal: signal ?? null,
  });
  return body.datasets;
}

/** Availability probe: any failure (network, non-2xx, timeout) is null, never a throw. */
export async function probeCatalog(timeoutMs = 3000): Promise<CatalogEntry[] | null> {
  try {
    return await fetchCatalog(AbortSignal.timeout(timeoutMs));
  } catch {
    return null;
  }
}

export function datasetBlobUrl(id: string): string {
  return `/datasets/${encodeURIComponent(id)}.zip`;
}

export function datasetViewUrl(id: string, embed = false): string {
  const query = new URLSearchParams({ dataset: id });
  if (embed) {
    query.set("embed", "1");
  }
  return `${window.location.origin}/?${query.toString()}`;
}

/** Dataset id suggestion from a display name; non-ASCII names fall back to "dataset". */
export function slugifyDatasetId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return /^[a-z0-9]/.test(slug) ? slug : "dataset";
}

export interface PublishMeta {
  id: string;
  name: string;
  kind: DatasetKind;
  levelCount: number;
  featureCount: number;
  sourceName: string;
}

export async function publishDataset(meta: PublishMeta, data: Blob): Promise<CatalogEntry> {
  const query = new URLSearchParams({
    name: meta.name,
    kind: meta.kind,
    levelCount: String(meta.levelCount),
    featureCount: String(meta.featureCount),
    sourceName: meta.sourceName,
  });
  const body = await requestJson<{ dataset: CatalogEntry }>(
    `/api/datasets/${encodeURIComponent(meta.id)}?${query.toString()}`,
    { method: "PUT", body: data, headers: { "content-type": "application/zip" } },
  );
  return body.dataset;
}

export async function fetchComments(
  datasetId: string,
  signal?: AbortSignal,
): Promise<CommentRecord[]> {
  const body = await requestJson<{ comments: CommentRecord[] }>(
    `/api/datasets/${encodeURIComponent(datasetId)}/comments`,
    { signal: signal ?? null },
  );
  return body.comments;
}

export async function postComment(
  datasetId: string,
  input: CommentInput,
): Promise<CommentRecord> {
  const body = await requestJson<{ comment: CommentRecord }>(
    `/api/datasets/${encodeURIComponent(datasetId)}/comments`,
    {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    },
  );
  return body.comment;
}

export async function deleteComment(datasetId: string, commentId: string): Promise<void> {
  const response = await fetch(
    `/api/datasets/${encodeURIComponent(datasetId)}/comments/${encodeURIComponent(commentId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw await toPlatformError(response);
  }
}

export async function login(username: string, password: string): Promise<AccountInfo> {
  const body = await requestJson<{ account: AccountInfo }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    headers: { "content-type": "application/json" },
  });
  return body.account;
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/logout", { method: "POST" });
  if (!response.ok) {
    throw await toPlatformError(response);
  }
}

export async function fetchMe(): Promise<AccountInfo | null> {
  const response = await fetch("/api/me");
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw await toPlatformError(response);
  }
  const body = (await response.json()) as { account: AccountInfo };
  return body.account;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm test --run src/platform/catalogClient.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/platform/types.ts src/platform/catalogClient.ts src/platform/catalogClient.test.ts
git commit -m "feat: add platform API client"
```

---

### Task 8: Original GDB attribute table in the feature card

**Files:**
- Modify: `src/components/resolveSelectedFeatureContent.ts`
- Modify: `src/components/SelectedFeatureContent.tsx`
- Modify: `src/app/app.css`
- Test: `src/components/selectedFeatureContent.test.ts` (add cases)

**Interfaces:**
- Consumes: `ViewerFeature.sourceProperties` (complete original properties; GDB features carry `__gdb_database` / `__gdb_layer` / `__gdb_resolved_level_id`).
- Produces: `ResolvedFeatureContent` gains `sourceAttributes: SourceAttribute[] | null` and `provenance: string | null`, where `interface SourceAttribute { field: string; value: string }`. `null` for IMDF features; for GDB features the card renders the attribute table INSTEAD of the IMDF `<dl>` summary.

- [ ] **Step 1: Write the failing resolver test**

Append to `src/components/selectedFeatureContent.test.ts` (reuse the file's existing `feature()` helper):

```ts
  it("exposes original GDB columns in original order with provenance, excluding __gdb_ keys", () => {
    const anchor = feature("anchor");
    const gdb = feature("unit", {
      sourceProperties: {
        OBJECTID: 7,
        名称: "コンコース",
        FLOOR: "B1F",
        width: null,
        tags: ["a", "b"],
        __gdb_database: "gdb-1",
        __gdb_layer: "TokyoSta_B1_Space",
        __gdb_resolved_level_id: "xyz",
      },
    });
    const resolved = resolveSelectedFeatureContent(venue(gdb, anchor, {}), gdb, "en");
    expect(resolved.provenance).toBe("TokyoSta_B1_Space (gdb-1)");
    expect(resolved.sourceAttributes).toEqual([
      { field: "OBJECTID", value: "7" },
      { field: "名称", value: "コンコース" },
      { field: "FLOOR", value: "B1F" },
      { field: "width", value: "null" },
      { field: "tags", value: '["a","b"]' },
    ]);
  });

  it("keeps sourceAttributes null for IMDF features", () => {
    const anchor = feature("anchor");
    const occupant = feature("occupant", { sourceProperties: { hours: "Mo-Fr 10:00-20:00" } });
    const resolved = resolveSelectedFeatureContent(venue(occupant, anchor, {}), occupant, "en");
    expect(resolved.sourceAttributes).toBeNull();
    expect(resolved.provenance).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test --run src/components/selectedFeatureContent.test.ts`
Expected: FAIL — `provenance` is `undefined`.

- [ ] **Step 3: Implement the resolver fields**

In `src/components/resolveSelectedFeatureContent.ts`, add to `ResolvedFeatureContent`:

```ts
  /** Original GDB columns in original field order; null for IMDF features. */
  sourceAttributes: SourceAttribute[] | null;
  /** "layer (database)" provenance line for GDB features; null otherwise. */
  provenance: string | null;
```

Add above the interface:

```ts
export interface SourceAttribute {
  field: string;
  value: string;
}

function formatAttributeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function resolveSourceAttributes(
  feature: ViewerFeature,
): { attributes: SourceAttribute[]; provenance: string } | null {
  const layer = feature.sourceProperties["__gdb_layer"];
  if (typeof layer !== "string") {
    return null;
  }
  const database = feature.sourceProperties["__gdb_database"];
  const attributes = Object.entries(feature.sourceProperties)
    .filter(([key]) => !key.startsWith("__gdb_"))
    .map(([field, value]) => ({ field, value: formatAttributeValue(value) }));
  return {
    attributes,
    provenance: typeof database === "string" ? `${layer} (${database})` : layer,
  };
}
```

Inside `resolveSelectedFeatureContent`, compute once and include both fields in the returned object:

```ts
  const source = resolveSourceAttributes(feature);
```

…and in the return literal:

```ts
    sourceAttributes: source !== null ? source.attributes : null,
    provenance: source !== null ? source.provenance : null,
```

- [ ] **Step 4: Run resolver tests, then render the table**

Run: `corepack pnpm test --run src/components/selectedFeatureContent.test.ts` — expected PASS. Typecheck will fail in `SelectedFeatureContent.tsx`? No — new fields are additive. Proceed to render:

In `src/components/SelectedFeatureContent.tsx`, add to the `ui` record:

```ts
  sourceData: { ja: "元データ", en: "Source data" },
```

Wrap the existing `<dl className="selected-feature__details">…</dl>` block so GDB features get the table instead:

```tsx
      {content.sourceAttributes !== null ? (
        <>
          <p className="selected-feature__provenance">{content.provenance}</p>
          <table className="selected-feature__attributes">
            <caption className="selected-feature__attributes-caption">
              {ui.sourceData[locale]}
            </caption>
            <tbody>
              {content.sourceAttributes.map((attribute) => (
                <tr key={attribute.field}>
                  <th scope="row">{attribute.field}</th>
                  <td>{attribute.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <dl className="selected-feature__details">
          {/* existing dl content unchanged */}
        </dl>
      )}
```

Append to `src/app/app.css`:

```css
.selected-feature__provenance {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--color-muted);
}

.selected-feature__attributes {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.selected-feature__attributes-caption {
  text-align: left;
  font-weight: 600;
  padding-bottom: 4px;
}

.selected-feature__attributes th {
  text-align: left;
  font-weight: 500;
  color: var(--color-muted);
  padding: 2px 8px 2px 0;
  vertical-align: top;
  white-space: nowrap;
}

.selected-feature__attributes td {
  padding: 2px 0;
  word-break: break-word;
}

.selected-feature__attributes tr + tr {
  border-top: 1px solid var(--color-border);
}
```

- [ ] **Step 5: Run the component suite**

Run: `corepack pnpm test --run src/components src/map/useSelectedFeaturePopup.test.tsx`
Expected: PASS — existing IMDF card tests unchanged (their features have no `__gdb_layer`).

- [ ] **Step 6: Commit**

```bash
git add src/components/resolveSelectedFeatureContent.ts src/components/SelectedFeatureContent.tsx src/components/selectedFeatureContent.test.ts src/app/app.css
git commit -m "feat: show original GDB attribute table in the feature card"
```

---

### Task 9: Account control in the viewer menu

**Files:**
- Create: `src/components/SignInDialog.tsx`
- Create: `src/components/AccountStatus.tsx`
- Modify: `src/components/ViewerMenu.tsx`
- Test: `src/components/SignInDialog.test.tsx`, `src/components/ViewerMenu.test.tsx` (add case)

**Interfaces:**
- Consumes: `login` (Task 7); `AccountInfo` (Task 7 types).
- Produces (used by Tasks 11-13 App wiring):
  - `SignInDialogProps { open: boolean; locale: LocaleCode; onClose: () => void; onSignedIn: (account: AccountInfo) => void }` — a modal `<dialog>` mounted at App level (so the comments panel's 401 recovery can open it even while the menu is closed). Renders nothing when `open` is false.
  - `AccountStatusProps { account: AccountInfo | null; locale: LocaleCode; onSignIn: () => void; onSignOut: () => void }` — the compact row that lives INSIDE the viewer menu per the spec: signed out → "サインイン / Sign in" button; signed in → `username (role)` plus a sign-out button. Presentational; calling `logout()` is the App's job.
  - `ViewerMenuProps` gains `accountSlot?: ReactNode` rendered at the bottom of the menu panel.

- [ ] **Step 1: Write the failing tests**

Create `src/components/SignInDialog.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInDialog } from "./SignInDialog";

const loginMock = vi.fn();

vi.mock("../platform/catalogClient", () => ({
  login: (...args: unknown[]) => loginMock(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("SignInDialog", () => {
  it("renders nothing while closed", () => {
    render(<SignInDialog open={false} locale="en" onClose={vi.fn()} onSignedIn={vi.fn()} />);
    expect(screen.queryByLabelText("Username")).toBeNull();
  });

  it("signs in and reports the account", async () => {
    loginMock.mockResolvedValue({ username: "admin", role: "admin" });
    const onSignedIn = vi.fn();
    render(<SignInDialog open locale="en" onClose={vi.fn()} onSignedIn={onSignedIn} />);
    await userEvent.type(screen.getByLabelText("Username"), "admin");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledWith({ username: "admin", role: "admin" });
    });
    expect(loginMock).toHaveBeenCalledWith("admin", "pw");
  });

  it("shows the server message on failure and stays open", async () => {
    loginMock.mockRejectedValue(new Error("Wrong username or password."));
    const onSignedIn = vi.fn();
    render(<SignInDialog open locale="en" onClose={vi.fn()} onSignedIn={onSignedIn} />);
    await userEvent.type(screen.getByLabelText("Username"), "x");
    await userEvent.type(screen.getByLabelText("Password"), "y");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Wrong username or password.")).toBeTruthy();
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});
```

Add to `src/components/ViewerMenu.test.tsx` (reuse the file's existing render helper/props; pass the new prop):

```tsx
  it("renders the account slot at the bottom of the open menu", async () => {
    renderMenu({ accountSlot: <span data-testid="account-slot">alice (user)</span> });
    await userEvent.click(screen.getByRole("button", { name: "メニュー" }));
    expect(await screen.findByTestId("account-slot")).toBeTruthy();
  });
```

(If the existing tests build props inline instead of a helper, replicate their prop object and add `accountSlot`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm test --run src/components/SignInDialog.test.tsx src/components/ViewerMenu.test.tsx`
Expected: SignInDialog FAILS to resolve; the new ViewerMenu case FAILS.

- [ ] **Step 3: Implement**

Create `src/components/SignInDialog.tsx` (jsdom lacks `showModal` — guard like `GdbImportDialog` does):

```tsx
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { LocaleCode } from "../imdf/types";
import { login } from "../platform/catalogClient";
import type { AccountInfo } from "../platform/types";

const ui = {
  heading: { ja: "アカウントにサインイン", en: "Sign in to your account" },
  username: { ja: "ユーザー名", en: "Username" },
  password: { ja: "パスワード", en: "Password" },
  submit: { ja: "送信", en: "Submit" },
  cancel: { ja: "キャンセル", en: "Cancel" },
} as const;

export interface SignInDialogProps {
  open: boolean;
  locale: LocaleCode;
  onClose: () => void;
  onSignedIn: (account: AccountInfo) => void;
}

export function SignInDialog({ open, locale, onClose, onSignedIn }: SignInDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.open = true;
      }
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    void login(String(data.get("username") ?? ""), String(data.get("password") ?? ""))
      .then((account) => {
        setBusy(false);
        onSignedIn(account);
      })
      .catch((caught: unknown) => {
        setBusy(false);
        setError(caught instanceof Error ? caught.message : String(caught));
      });
  };

  return (
    <dialog
      ref={dialogRef}
      className="signin-dialog"
      aria-label={ui.heading[locale]}
      onClose={onClose}
    >
      <form onSubmit={onSubmit}>
        <h2>{ui.heading[locale]}</h2>
        <label>
          {ui.username[locale]}
          <input name="username" autoComplete="username" required />
        </label>
        <label>
          {ui.password[locale]}
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error !== null ? <p className="signin-dialog__error">{error}</p> : null}
        <div className="signin-dialog__actions">
          <button type="button" onClick={onClose}>
            {ui.cancel[locale]}
          </button>
          <button type="submit" disabled={busy}>
            {ui.submit[locale]}
          </button>
        </div>
      </form>
    </dialog>
  );
}
```

Create `src/components/AccountStatus.tsx`:

```tsx
import type { LocaleCode } from "../imdf/types";
import type { AccountInfo } from "../platform/types";

const ui = {
  signIn: { ja: "サインイン", en: "Sign in" },
  signOut: { ja: "サインアウト", en: "Sign out" },
} as const;

export interface AccountStatusProps {
  account: AccountInfo | null;
  locale: LocaleCode;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function AccountStatus({ account, locale, onSignIn, onSignOut }: AccountStatusProps) {
  if (account === null) {
    return (
      <button type="button" className="account-status__button" onClick={onSignIn}>
        {ui.signIn[locale]}
      </button>
    );
  }
  return (
    <div className="account-status">
      <span className="account-status__name">
        {account.username} ({account.role})
      </span>
      <button type="button" className="account-status__button" onClick={onSignOut}>
        {ui.signOut[locale]}
      </button>
    </div>
  );
}
```

In `src/components/ViewerMenu.tsx`:

1. `import type { ReactNode } from "react";`
2. Add to `ViewerMenuProps`: `accountSlot?: ReactNode;` and destructure it in the component.
3. Render at the bottom of the portal panel, after the `showFileControls` block:

```tsx
              {accountSlot !== undefined ? (
                <div className="viewer-menu__account">{accountSlot}</div>
              ) : null}
```

Append to `src/app/app.css`:

```css
.viewer-menu__account {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
}

.account-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.account-status__name {
  font-size: 13px;
  color: var(--color-muted);
}

.signin-dialog {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  min-width: 280px;
}

.signin-dialog label {
  display: block;
  margin: 8px 0;
  font-size: 13px;
}

.signin-dialog input {
  display: block;
  width: 100%;
  margin-top: 4px;
}

.signin-dialog__error {
  color: var(--color-error);
  font-size: 13px;
}

.signin-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm test --run src/components/SignInDialog.test.tsx src/components/ViewerMenu.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SignInDialog.tsx src/components/SignInDialog.test.tsx src/components/AccountStatus.tsx src/components/ViewerMenu.tsx src/components/ViewerMenu.test.tsx src/app/app.css
git commit -m "feat: add account sign-in via the viewer menu"
```

---

### Task 10: Load published datasets via `?dataset=`

**Files:**
- Modify: `src/app/App.tsx`
- Test: `src/app/App.test.tsx` (new mock block + new describe)

**Interfaces:**
- Consumes: `parseViewerParams().dataset` (Task 6), `fetchCatalog`/`datasetBlobUrl` (Task 7), `readVenueSnapshot` (Task 5), existing `runVenueLoad`, `fetchImdfFile`, `loadImdfArchive`.
- Produces (used by Tasks 11-13): `loadDatasetById(datasetId: string): void` callback in `App`; `lastAttemptKindRef` union extended with `"dataset"`; `?dataset` wins over `?src`.

- [ ] **Step 1: Add the platform mock block to App.test.tsx**

In `src/app/App.test.tsx`, next to the existing `gdbMapping`/`GdbImportDialog` mocks (before the `import { App } from "./App";` line), add:

```ts
import type * as CatalogClientModule from "../platform/catalogClient";
import type { CatalogEntry } from "../platform/types";

const probeCatalogMock = vi.fn(async (): Promise<CatalogEntry[] | null> => null);
const fetchCatalogMock = vi.fn(async (): Promise<CatalogEntry[]> => []);
const fetchMeMock = vi.fn(async () => null);
const publishDatasetMock = vi.fn();
const fetchCommentsMock = vi.fn(async () => []);
const postCommentMock = vi.fn();
const deleteCommentMock = vi.fn();
const clientLoginMock = vi.fn();
const clientLogoutMock = vi.fn(async () => undefined);
const readVenueSnapshotMock = vi.fn();

vi.mock("../platform/catalogClient", async (importOriginal) => {
  const actual = await importOriginal<typeof CatalogClientModule>();
  return {
    ...actual, // PlatformError, slugifyDatasetId, datasetBlobUrl, datasetViewUrl stay real
    probeCatalog: (...args: unknown[]) => probeCatalogMock(...(args as [])),
    fetchCatalog: (...args: unknown[]) => fetchCatalogMock(...(args as [])),
    fetchMe: () => fetchMeMock(),
    publishDataset: (...args: unknown[]) => publishDatasetMock(...args),
    fetchComments: (...args: unknown[]) => fetchCommentsMock(...(args as [string])),
    postComment: (...args: unknown[]) => postCommentMock(...args),
    deleteComment: (...args: unknown[]) => deleteCommentMock(...args),
    login: (...args: unknown[]) => clientLoginMock(...args),
    logout: () => clientLogoutMock(),
  };
});

vi.mock("../imdf/venueSnapshot", () => ({
  SNAPSHOT_SCHEMA_VERSION: 1,
  readVenueSnapshot: (...args: unknown[]) => readVenueSnapshotMock(...args),
  writeVenueSnapshot: vi.fn(async () => new Blob(["snapshot"])),
}));

const CATALOG_SNAPSHOT_ENTRY: CatalogEntry = {
  id: "tokyo",
  name: "東京駅",
  kind: "venue-snapshot",
  levelCount: 2,
  featureCount: 10,
  sourceName: "JRTokyoSta.gdb",
  updatedAt: "2026-07-01T00:00:00.000Z",
};
```

The default implementations (`null` probe, `null` me, empty lists) keep every existing App test on the pre-platform behavior. `vi.clearAllMocks()` in the existing `afterEach` clears calls but keeps these implementations.

- [ ] **Step 2: Write the failing dataset-loading tests**

Add a new describe at the end of `src/app/App.test.tsx`:

```ts
describe("App dataset loading", () => {
  beforeEach(() => {
    loadImdfArchiveMock.mockReset();
    fetchImdfFileMock.mockReset();
    readVenueSnapshotMock.mockReset();
    fetchCatalogMock.mockResolvedValue([CATALOG_SNAPSHOT_ENTRY]);
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("loads a snapshot dataset from ?dataset= without the IMDF worker", async () => {
    window.history.replaceState(null, "", "/?dataset=tokyo");
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    expect(await screen.findByTestId("indoor-map-stub")).toBeTruthy();
    expect(fetchImdfFileMock).toHaveBeenCalledWith("/datasets/tokyo.zip", expect.anything());
    expect(readVenueSnapshotMock).toHaveBeenCalledTimes(1);
    expect(loadImdfArchiveMock).not.toHaveBeenCalled();
  });

  it("routes kind=imdf datasets through the strict IMDF loader", async () => {
    window.history.replaceState(null, "", "/?dataset=tokyo");
    fetchCatalogMock.mockResolvedValue([{ ...CATALOG_SNAPSHOT_ENTRY, kind: "imdf" }]);
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    expect(await screen.findByTestId("indoor-map-stub")).toBeTruthy();
    expect(loadImdfArchiveMock).toHaveBeenCalledTimes(1);
    expect(readVenueSnapshotMock).not.toHaveBeenCalled();
  });

  it("prefers ?dataset over ?src", async () => {
    window.history.replaceState(null, "", "/?src=/venues/other.zip&dataset=tokyo");
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await screen.findByTestId("indoor-map-stub");
    expect(fetchImdfFileMock).toHaveBeenCalledTimes(1);
    expect(fetchImdfFileMock).toHaveBeenCalledWith("/datasets/tokyo.zip", expect.anything());
  });

  it("unknown dataset id surfaces the error banner and Retry re-fetches", async () => {
    window.history.replaceState(null, "", "/?dataset=missing");
    fetchCatalogMock.mockResolvedValueOnce([]);
    render(<App />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(archiveErrorCopy.fetch_failed);
    fetchCatalogMock.mockResolvedValueOnce([{ ...CATALOG_SNAPSHOT_ENTRY, id: "missing" }]);
    fetchImdfFileMock.mockResolvedValue(zipFile("missing.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    const retry = alert.querySelector<HTMLButtonElement>(".viewer-notice__retry");
    expect(retry).toBeTruthy();
    await userEvent.click(retry!);
    expect(await screen.findByTestId("indoor-map-stub")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run to verify the new tests fail and old ones pass**

Run: `corepack pnpm test --run src/app/App.test.tsx`
Expected: the 4 new tests FAIL (no dataset handling yet); all pre-existing tests PASS (defaults preserve behavior). If pre-existing tests fail, fix the mock defaults before proceeding.

- [ ] **Step 4: Implement dataset loading in App**

In `src/app/App.tsx`:

1. Imports:

```ts
import { readVenueSnapshot } from "../imdf/venueSnapshot";
import { datasetBlobUrl, fetchCatalog } from "../platform/catalogClient";
```

2. Extend the attempt-kind ref union (line ~170):

```ts
  const lastAttemptKindRef = useRef<"src" | "dataset" | "imdf" | "gdb-archive" | "gdb-folder">(
    params.dataset !== null ? "dataset" : params.src !== null ? "src" : "imdf",
  );
```

3. Add the loader beside `loadFromSrc`:

```ts
  const loadDatasetById = useCallback(
    (datasetId: string) => {
      lastAttemptKindRef.current = "dataset";
      runVenueLoad(
        `${datasetId}.zip`,
        async (signal) => {
          const entries = await fetchCatalog(signal);
          const entry = entries.find((candidate) => candidate.id === datasetId);
          if (entry === undefined) {
            throw new ArchiveError("fetch_failed", "Dataset not found on the server.", {
              dataset: datasetId,
            });
          }
          const file = await fetchImdfFile(datasetBlobUrl(datasetId), signal);
          return entry.kind === "imdf" ? loadImdfArchive(file, signal) : readVenueSnapshot(file);
        },
        params.level ?? undefined,
      );
    },
    [params.level, runVenueLoad],
  );
```

4. `loadFromSrc` gains dataset precedence — change its guard to:

```ts
    if (params.src === null || params.dataset !== null) {
      return;
    }
```

5. Mount effect beside the existing `loadFromSrc` effect:

```ts
  useEffect(() => {
    if (params.dataset !== null) {
      loadDatasetById(params.dataset);
    }
  }, [params.dataset, loadDatasetById]);
```

6. Retry: locate the error-banner retry handler that calls `loadFromSrc()` when `lastAttemptKindRef.current === "src"` and add the analogous branch first:

```ts
      if (lastAttemptKindRef.current === "dataset" && params.dataset !== null) {
        loadDatasetById(params.dataset);
        return;
      }
```

The post-error focus fallback switch (`kind === "gdb-folder" ? … : kind === "gdb-archive" ? … : null`) needs no change — `"dataset"` falls through to `null` like `"src"`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `corepack pnpm test --run src/app/App.test.tsx`
Expected: PASS (all, including the 4 new). `corepack pnpm typecheck` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: load published datasets via dataset deep link"
```

---

### Task 11: Platform shell — probe, account state, gallery landing

**Files:**
- Create: `src/components/DatasetGallery.tsx`
- Test: `src/components/DatasetGallery.test.tsx`
- Modify: `src/app/App.tsx`, `src/app/app.css`
- Test: `src/app/App.test.tsx` (new describe)

**Interfaces:**
- Consumes: `probeCatalog`, `fetchMe`, `logout` (Task 7), `SignInDialog`/`AccountStatus`/ViewerMenu `accountSlot` (Task 9), `loadDatasetById` (Task 10).
- Produces (used by Tasks 12-13): App state `catalog: CatalogEntry[] | null` (null = server unreachable), `account: AccountInfo | null`, `signInOpen: boolean` + `setSignInOpen`; the account row lives in the viewer menu (spec §5) while the modal `SignInDialog` mounts at App level; `DatasetGalleryProps { entries: CatalogEntry[]; locale: LocaleCode; onOpen: (id: string) => void }`. (The `.platform-bar` region for Publish/Comments buttons is introduced in Task 12.)

- [ ] **Step 1: Write the failing gallery component test**

Create `src/components/DatasetGallery.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CatalogEntry } from "../platform/types";
import { DatasetGallery } from "./DatasetGallery";

const ENTRIES: CatalogEntry[] = [
  {
    id: "shinjuku",
    name: "新宿駅",
    kind: "venue-snapshot",
    levelCount: 6,
    featureCount: 40941,
    sourceName: "NW_POI_20260625.gdb",
    updatedAt: "2026-07-10T09:00:00.000Z",
  },
  {
    id: "tokyo-imdf",
    name: "Tokyo Station",
    kind: "imdf",
    levelCount: 3,
    featureCount: 120,
    sourceName: "tokyo.zip",
    updatedAt: "2026-07-01T09:00:00.000Z",
  },
];

describe("DatasetGallery", () => {
  it("renders one card per entry with kind badge and counts", () => {
    render(<DatasetGallery entries={ENTRIES} locale="en" onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: /新宿駅/ })).toBeTruthy();
    expect(screen.getByText("GDB")).toBeTruthy();
    expect(screen.getByText("IMDF")).toBeTruthy();
    expect(screen.getByText(/6 levels \/ 40941 features/)).toBeTruthy();
  });

  it("reports the clicked dataset id", async () => {
    const onOpen = vi.fn();
    render(<DatasetGallery entries={ENTRIES} locale="ja" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /新宿駅/ }));
    expect(onOpen).toHaveBeenCalledWith("shinjuku");
  });

  it("shows the empty message without entries", () => {
    render(<DatasetGallery entries={[]} locale="en" onOpen={vi.fn()} />);
    expect(screen.getByText("No datasets have been published yet.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test --run src/components/DatasetGallery.test.tsx`
Expected: FAIL — cannot resolve `./DatasetGallery`.

- [ ] **Step 3: Implement the gallery**

Create `src/components/DatasetGallery.tsx`:

```tsx
import type { LocaleCode } from "../imdf/types";
import type { CatalogEntry } from "../platform/types";

const ui = {
  heading: { ja: "データセット", en: "Datasets" },
  empty: {
    ja: "公開されたデータセットはまだありません。",
    en: "No datasets have been published yet.",
  },
  updated: { ja: "更新", en: "Updated" },
} as const;

const KIND_BADGE = { "venue-snapshot": "GDB", imdf: "IMDF" } as const;

function metaLine(entry: CatalogEntry, locale: LocaleCode): string {
  return locale === "ja"
    ? `${entry.levelCount} フロア / ${entry.featureCount} 地物`
    : `${entry.levelCount} levels / ${entry.featureCount} features`;
}

export interface DatasetGalleryProps {
  entries: CatalogEntry[];
  locale: LocaleCode;
  onOpen: (id: string) => void;
}

export function DatasetGallery({ entries, locale, onOpen }: DatasetGalleryProps) {
  return (
    <section className="dataset-gallery" aria-label={ui.heading[locale]}>
      <h2 className="dataset-gallery__heading">{ui.heading[locale]}</h2>
      {entries.length === 0 ? (
        <p className="dataset-gallery__empty">{ui.empty[locale]}</p>
      ) : (
        <ul className="dataset-gallery__list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="dataset-gallery__card"
                onClick={() => {
                  onOpen(entry.id);
                }}
              >
                <span className="dataset-gallery__kind">{KIND_BADGE[entry.kind]}</span>
                <span className="dataset-gallery__name">{entry.name}</span>
                <span className="dataset-gallery__meta">{metaLine(entry, locale)}</span>
                <span className="dataset-gallery__meta">
                  {ui.updated[locale]}: {new Date(entry.updatedAt).toLocaleDateString(
                    locale === "ja" ? "ja-JP" : "en-US",
                  )}
                  {" · "}
                  {entry.sourceName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

Append to `src/app/app.css`:

```css
.dataset-gallery {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px 8px;
}

.dataset-gallery__heading {
  font-size: 18px;
  margin: 0 0 12px;
}

.dataset-gallery__empty {
  color: var(--color-muted);
}

.dataset-gallery__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.dataset-gallery__card {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  cursor: pointer;
  text-align: left;
}

.dataset-gallery__card:hover {
  border-color: var(--color-accent);
}

.dataset-gallery__kind {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--color-accent);
}

.dataset-gallery__name {
  font-size: 15px;
  font-weight: 600;
}

.dataset-gallery__meta {
  font-size: 12px;
  color: var(--color-muted);
}

.platform-bar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 4: Write the failing App landing tests**

Add to `src/app/App.test.tsx`:

```ts
describe("App platform landing", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("shows the gallery when the server probe succeeds and opens a dataset in place", async () => {
    probeCatalogMock.mockResolvedValueOnce([CATALOG_SNAPSHOT_ENTRY]);
    fetchCatalogMock.mockResolvedValue([CATALOG_SNAPSHOT_ENTRY]);
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    const card = await screen.findByRole("button", { name: /東京駅/ });
    // The publisher's local-open controls stay available beside the gallery.
    expect(screen.getByRole("button", { name: "IMDF ZIP を開く" })).toBeTruthy();
    await userEvent.click(card);
    expect(await screen.findByTestId("indoor-map-stub")).toBeTruthy();
    expect(window.location.search).toContain("dataset=tokyo");
  });

  it("falls back to the plain dropzone landing when the probe fails", async () => {
    probeCatalogMock.mockResolvedValueOnce(null);
    render(<App />);
    expect(await screen.findByRole("button", { name: "IMDF ZIP を開く" })).toBeTruthy();
    expect(screen.queryByText("データセット")).toBeNull();
  });

  it("shows the account row in the viewer menu and reflects /api/me state", async () => {
    window.history.replaceState(null, "", "/?dataset=tokyo");
    probeCatalogMock.mockResolvedValueOnce([CATALOG_SNAPSHOT_ENTRY]);
    fetchMeMock.mockResolvedValueOnce({ username: "admin", role: "admin" });
    fetchCatalogMock.mockResolvedValue([CATALOG_SNAPSHOT_ENTRY]);
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await screen.findByTestId("indoor-map-stub");
    await userEvent.click(screen.getByRole("button", { name: "メニュー" }));
    expect(await screen.findByText(/admin \(admin\)/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "サインアウト" })).toBeTruthy();
  });
});
```

Run: `corepack pnpm test --run src/app/App.test.tsx` — the new describe MUST fail (no gallery yet).

- [ ] **Step 5: Wire the platform shell into App**

In `src/app/App.tsx`:

1. Imports:

```ts
import { AccountStatus } from "../components/AccountStatus";
import { SignInDialog } from "../components/SignInDialog";
import { DatasetGallery } from "../components/DatasetGallery";
import { fetchMe, logout, probeCatalog } from "../platform/catalogClient";
import type { AccountInfo, CatalogEntry } from "../platform/types";
```

2. State beside the existing gdb state:

```ts
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
```

3. Probe effect (once, non-embed):

```ts
  useEffect(() => {
    if (embed) {
      return;
    }
    let cancelled = false;
    void probeCatalog().then((entries) => {
      if (!cancelled) {
        setCatalog(entries);
      }
    });
    void fetchMe()
      .then((me) => {
        if (!cancelled) {
          setAccount(me);
        }
      })
      .catch(() => {
        /* signed-out default */
      });
    return () => {
      cancelled = true;
    };
  }, [embed]);
```

4. Gallery open handler (in-place load, keeps deep-link semantics):

```ts
  const openDataset = useCallback(
    (id: string) => {
      window.history.pushState(null, "", `/?dataset=${encodeURIComponent(id)}`);
      loadDatasetById(id);
    },
    [loadDatasetById],
  );
```

5. Mount the sign-in dialog at the app root (sibling of the map stage) and hand the account row to the viewer menu:

```tsx
          {!embed && catalog !== null ? (
            <SignInDialog
              open={signInOpen}
              locale={locale}
              onClose={() => {
                setSignInOpen(false);
              }}
              onSignedIn={(signedIn) => {
                setAccount(signedIn);
                setSignInOpen(false);
              }}
            />
          ) : null}
```

At the existing `<ViewerMenu` callsite, add the prop:

```tsx
                accountSlot={
                  !embed && catalog !== null ? (
                    <AccountStatus
                      account={account}
                      locale={locale}
                      onSignIn={() => {
                        setSignInOpen(true);
                      }}
                      onSignOut={() => {
                        void logout()
                          .catch(() => undefined)
                          .then(() => {
                            setAccount(null);
                          });
                      }}
                    />
                  ) : undefined
                }
```

6. Render the gallery above the dropzone inside the existing `showEmptyDropzone` branch (same parent container as `ImdfDropzone`):

```tsx
              {catalog !== null ? (
                <DatasetGallery entries={catalog} locale={locale} onOpen={openDataset} />
              ) : null}
```

`setSignInOpen` is also used by Task 13 (comments 401 recovery); it is already exercised here via the menu's sign-in button, so `noUnusedLocals` stays satisfied.

- [ ] **Step 6: Run tests to verify they pass**

Run: `corepack pnpm test --run src/app/App.test.tsx src/components/DatasetGallery.test.tsx`
Expected: PASS. `corepack pnpm typecheck` — clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/DatasetGallery.tsx src/components/DatasetGallery.test.tsx src/app/App.tsx src/app/App.test.tsx src/app/app.css
git commit -m "feat: add dataset gallery landing and platform shell"
```

---

### Task 12: Publish flow

**Files:**
- Create: `src/components/PublishDialog.tsx`
- Test: `src/components/PublishDialog.test.tsx`
- Modify: `src/app/App.tsx`
- Test: `src/app/App.test.tsx` (new describe)

**Interfaces:**
- Consumes: `writeVenueSnapshot` (Task 5), `publishDataset`, `slugifyDatasetId`, `datasetViewUrl` (Task 7), App platform state (Task 11).
- Produces: `PublishDialogProps { venue: LoadedVenue; defaultName: string; sourceName: string; kind: DatasetKind; imdfFile: File | null; existingIds: readonly string[]; locale: LocaleCode; onClose: () => void; onPublished: (entry: CatalogEntry) => void }`. App gains `localVenueKind: "imdf" | "gdb" | null` state and `lastImdfFileRef: File | null` (the retained last locally opened archive).

- [ ] **Step 1: Write the failing PublishDialog test**

Create `src/components/PublishDialog.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoadedVenue } from "../imdf/types";
import { PublishDialog } from "./PublishDialog";

const publishDatasetMock = vi.fn();
const writeVenueSnapshotMock = vi.fn(async () => new Blob(["snap"]));

vi.mock("../platform/catalogClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform/catalogClient")>();
  return {
    ...actual,
    publishDataset: (...args: unknown[]) => publishDatasetMock(...args),
  };
});

vi.mock("../imdf/venueSnapshot", () => ({
  writeVenueSnapshot: (...args: unknown[]) => writeVenueSnapshotMock(...args),
}));

function venueStub(): LoadedVenue {
  return {
    manifest: { version: "1.0.0", language: "ja" },
    venue: {} as LoadedVenue["venue"],
    levels: [{} as LoadedVenue["levels"][number], {} as LoadedVenue["levels"][number]],
    featuresById: new Map([["a", {} as never], ["b", {} as never], ["c", {} as never]]),
    renderFeaturesByLevel: new Map(),
    searchEntries: [],
    boundsByLevel: new Map(),
    enrichmentByFeatureId: new Map(),
    warnings: [],
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("PublishDialog", () => {
  it("prefills a slug id, warns on overwrite, and publishes a snapshot", async () => {
    publishDatasetMock.mockResolvedValue({ id: "tokyo-station" });
    render(
      <PublishDialog
        venue={venueStub()}
        defaultName="Tokyo Station"
        sourceName="JRTokyoSta.gdb"
        kind="venue-snapshot"
        imdfFile={null}
        existingIds={["tokyo-station"]}
        locale="en"
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    );
    const idInput = screen.getByLabelText("Dataset ID") as HTMLInputElement;
    expect(idInput.value).toBe("tokyo-station");
    expect(screen.getByText(/will replace the existing dataset/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(publishDatasetMock).toHaveBeenCalledTimes(1);
    });
    const [meta, blob] = publishDatasetMock.mock.calls[0] as [Record<string, unknown>, Blob];
    expect(meta).toMatchObject({
      id: "tokyo-station",
      name: "Tokyo Station",
      kind: "venue-snapshot",
      levelCount: 2,
      featureCount: 3,
      sourceName: "JRTokyoSta.gdb",
    });
    expect(writeVenueSnapshotMock).toHaveBeenCalledTimes(1);
    expect(blob).toBeInstanceOf(Blob);
    // Success view exposes copyable view/embed URLs.
    expect((screen.getByLabelText("View URL") as HTMLInputElement).value).toContain("dataset=tokyo-station");
    expect((screen.getByLabelText("Embed URL") as HTMLInputElement).value).toContain("embed=1");
  });

  it("uploads the retained original file for IMDF datasets", async () => {
    publishDatasetMock.mockResolvedValue({ id: "minimal" });
    const original = new File(["zip-bytes"], "minimal.zip", { type: "application/zip" });
    render(
      <PublishDialog
        venue={venueStub()}
        defaultName="Minimal"
        sourceName="minimal.zip"
        kind="imdf"
        imdfFile={original}
        existingIds={[]}
        locale="en"
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => {
      expect(publishDatasetMock).toHaveBeenCalledTimes(1);
    });
    expect(writeVenueSnapshotMock).not.toHaveBeenCalled();
    expect((publishDatasetMock.mock.calls[0] as unknown[])[1]).toBe(original);
  });

  it("surfaces server errors verbatim and keeps the form editable", async () => {
    publishDatasetMock.mockRejectedValue(new Error("Publishing requires an admin account."));
    render(
      <PublishDialog
        venue={venueStub()}
        defaultName="X"
        sourceName="x.gdb"
        kind="venue-snapshot"
        imdfFile={null}
        existingIds={[]}
        locale="en"
        onClose={vi.fn()}
        onPublished={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Publishing requires an admin account.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test --run src/components/PublishDialog.test.tsx`
Expected: FAIL — cannot resolve `./PublishDialog`.

- [ ] **Step 3: Implement the dialog**

Create `src/components/PublishDialog.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { LoadedVenue, LocaleCode } from "../imdf/types";
import { writeVenueSnapshot } from "../imdf/venueSnapshot";
import {
  datasetViewUrl,
  publishDataset,
  slugifyDatasetId,
} from "../platform/catalogClient";
import type { CatalogEntry, DatasetKind } from "../platform/types";

const ui = {
  heading: { ja: "データセットを公開", en: "Publish dataset" },
  name: { ja: "表示名", en: "Display name" },
  id: { ja: "データセットID", en: "Dataset ID" },
  overwrite: {
    ja: "このIDは既に存在します。公開すると既存のデータセットを置き換えます。",
    en: "This ID already exists. Publishing will replace the existing dataset.",
  },
  publish: { ja: "公開", en: "Publish" },
  close: { ja: "閉じる", en: "Close" },
  publishing: { ja: "公開中…", en: "Publishing…" },
  done: { ja: "公開しました", en: "Published" },
  viewUrl: { ja: "表示URL", en: "View URL" },
  embedUrl: { ja: "埋め込みURL", en: "Embed URL" },
  copy: { ja: "コピー", en: "Copy" },
  invalidId: {
    ja: "IDは英小文字・数字・ハイフン（64文字以内）です。",
    en: "IDs are lowercase letters, digits, and hyphens (max 64 chars).",
  },
} as const;

const DATASET_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface PublishDialogProps {
  venue: LoadedVenue;
  defaultName: string;
  sourceName: string;
  kind: DatasetKind;
  imdfFile: File | null;
  existingIds: readonly string[];
  locale: LocaleCode;
  onClose: () => void;
  onPublished: (entry: CatalogEntry) => void;
}

export function PublishDialog({
  venue,
  defaultName,
  sourceName,
  kind,
  imdfFile,
  existingIds,
  locale,
  onClose,
  onPublished,
}: PublishDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(defaultName);
  const [id, setId] = useState(() => slugifyDatasetId(defaultName));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<CatalogEntry | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.open = true;
      }
    }
  }, []);

  const idValid = DATASET_ID_RE.test(id);
  const overwrite = idValid && existingIds.includes(id);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!idValid || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    void (async () => {
      const data =
        kind === "imdf" && imdfFile !== null
          ? imdfFile
          : await writeVenueSnapshot(venue, sourceName);
      return publishDataset(
        {
          id,
          name,
          kind,
          levelCount: venue.levels.length,
          featureCount: venue.featuresById.size,
          sourceName,
        },
        data,
      );
    })()
      .then((entry) => {
        setBusy(false);
        setPublished(entry);
        onPublished(entry);
      })
      .catch((caught: unknown) => {
        setBusy(false);
        setError(caught instanceof Error ? caught.message : String(caught));
      });
  };

  return (
    <dialog
      ref={dialogRef}
      className="publish-dialog"
      aria-label={ui.heading[locale]}
      onClose={onClose}
    >
      {published === null ? (
        <form onSubmit={onSubmit}>
          <h2>{ui.heading[locale]}</h2>
          <label>
            {ui.name[locale]}
            <input
              value={name}
              required
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          <label>
            {ui.id[locale]}
            <input
              value={id}
              required
              onChange={(event) => {
                setId(event.target.value);
              }}
            />
          </label>
          {!idValid && id !== "" ? (
            <p className="publish-dialog__warning">{ui.invalidId[locale]}</p>
          ) : null}
          {overwrite ? <p className="publish-dialog__warning">{ui.overwrite[locale]}</p> : null}
          {error !== null ? <p className="publish-dialog__error">{error}</p> : null}
          <div className="publish-dialog__actions">
            <button type="button" onClick={onClose}>
              {ui.close[locale]}
            </button>
            <button type="submit" disabled={busy || !idValid || name.trim() === ""}>
              {busy ? ui.publishing[locale] : ui.publish[locale]}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <h2>{ui.done[locale]}</h2>
          <label>
            {ui.viewUrl[locale]}
            <input readOnly value={datasetViewUrl(published.id)} />
          </label>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(datasetViewUrl(published.id));
            }}
          >
            {ui.copy[locale]}
          </button>
          <label>
            {ui.embedUrl[locale]}
            <input readOnly value={datasetViewUrl(published.id, true)} />
          </label>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(datasetViewUrl(published.id, true));
            }}
          >
            {ui.copy[locale]}
          </button>
          <div className="publish-dialog__actions">
            <button type="button" onClick={onClose}>
              {ui.close[locale]}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
```

Append to `src/app/app.css`:

```css
.publish-dialog {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  min-width: 320px;
}

.publish-dialog label {
  display: block;
  margin: 8px 0;
  font-size: 13px;
}

.publish-dialog input {
  display: block;
  width: 100%;
  margin-top: 4px;
}

.publish-dialog__warning {
  color: var(--color-warning);
  font-size: 13px;
}

.publish-dialog__error {
  color: var(--color-error);
  font-size: 13px;
}

.publish-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
```

Run: `corepack pnpm test --run src/components/PublishDialog.test.tsx` — expected PASS (3 tests).

- [ ] **Step 4: Write the failing App publish-visibility tests**

Add to `src/app/App.test.tsx`:

```ts
describe("App publish flow", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  async function loadLocalImdf(): Promise<void> {
    loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    const user = userEvent.setup();
    const input = document.querySelector<HTMLInputElement>('input[accept=".zip,application/zip"]');
    expect(input).toBeTruthy();
    await user.upload(input!, zipFile("minimal.zip"));
    await screen.findByTestId("indoor-map-stub");
  }

  it("shows Publish only for admins with a locally loaded venue", async () => {
    probeCatalogMock.mockResolvedValueOnce([]);
    fetchMeMock.mockResolvedValueOnce({ username: "admin", role: "admin" });
    await loadLocalImdf();
    expect(await screen.findByRole("button", { name: "公開" })).toBeTruthy();
  });

  it("hides Publish for signed-out viewers and for datasets loaded from the server", async () => {
    probeCatalogMock.mockResolvedValueOnce([]);
    await loadLocalImdf();
    expect(screen.queryByRole("button", { name: "公開" })).toBeNull();
  });

  it("hides Publish for dataset-loaded venues even as admin", async () => {
    window.history.replaceState(null, "", "/?dataset=tokyo");
    probeCatalogMock.mockResolvedValueOnce([CATALOG_SNAPSHOT_ENTRY]);
    fetchMeMock.mockResolvedValueOnce({ username: "admin", role: "admin" });
    fetchCatalogMock.mockResolvedValue([CATALOG_SNAPSHOT_ENTRY]);
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await screen.findByTestId("indoor-map-stub");
    expect(screen.queryByRole("button", { name: "公開" })).toBeNull();
  });
});
```

Note: the IMDF file input selector must match the real accept attribute in `App.tsx` (check `ImdfDropzone`/App and reuse the exact string the existing tests use — App.test.tsx already has an IMDF input helper; prefer that helper instead of the inline query above if present).

Run: `corepack pnpm test --run src/app/App.test.tsx` — new describe MUST fail.

- [ ] **Step 5: Wire publish into App**

In `src/app/App.tsx`:

1. Imports: `PublishDialog` and `fetchCatalog` (already imported in Task 10).

2. State + ref:

```ts
  const [publishOpen, setPublishOpen] = useState(false);
  const [localVenueKind, setLocalVenueKind] = useState<"imdf" | "gdb" | null>(null);
  const lastImdfFileRef = useRef<File | null>(null);
```

3. Track provenance of the loaded venue:
   - In `handleFile` (local IMDF open), before `runVenueLoad`: `lastImdfFileRef.current = file; setLocalVenueKind("imdf");`
   - In `onGdbImport`'s success `.then` (right where `load_succeeded` is dispatched): `lastImdfFileRef.current = null; setLocalVenueKind("gdb");`
   - In `loadFromSrc` and `loadDatasetById`, before `runVenueLoad`: `lastImdfFileRef.current = null; setLocalVenueKind(null);`

4. Create the `.platform-bar` region (CSS landed in Task 11) inside the app root container, sibling of the map stage, hosting the Publish button (the Comments toggle joins it in Task 13):

```tsx
          {!embed && catalog !== null ? (
            <div className="platform-bar">
```

with this button as its content (close the `</div>` and the conditional after it):

```tsx
              {state.status === "ready" && localVenueKind !== null && account?.role === "admin" ? (
                <button
                  type="button"
                  className="account-control__button"
                  onClick={() => {
                    setPublishOpen(true);
                  }}
                >
                  {ui.publish[locale]}
                </button>
              ) : null}
```

with `publish: { ja: "公開", en: "Publish" }` added to App's `ui` record.

5. Dialog rendering beside the GDB dialog:

```tsx
          {publishOpen && state.status === "ready" && localVenueKind !== null ? (
            <PublishDialog
              venue={state.loadedVenue}
              defaultName={venueName ?? state.fileName}
              sourceName={state.fileName}
              kind={localVenueKind === "imdf" ? "imdf" : "venue-snapshot"}
              imdfFile={lastImdfFileRef.current}
              existingIds={(catalog ?? []).map((entry) => entry.id)}
              locale={locale}
              onClose={() => {
                setPublishOpen(false);
              }}
              onPublished={() => {
                void fetchCatalog()
                  .then(setCatalog)
                  .catch(() => {
                    /* catalog refresh is best-effort */
                  });
              }}
            />
          ) : null}
```

(`venueName` is App's existing memo; when it is empty fall back to `state.fileName`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `corepack pnpm test --run src/app/App.test.tsx src/components/PublishDialog.test.tsx`
Expected: PASS. `corepack pnpm typecheck` — clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/PublishDialog.tsx src/components/PublishDialog.test.tsx src/app/App.tsx src/app/App.test.tsx src/app/app.css
git commit -m "feat: add admin publish flow for local venues"
```

---

### Task 13: Comments with map pins

**Files:**
- Modify: `src/map/IndoorMap.tsx` (two optional props)
- Create: `src/components/CommentsPanel.tsx`
- Test: `src/components/CommentsPanel.test.tsx`
- Modify: `src/app/App.tsx`, `src/app/app.css`
- Test: `src/app/App.test.tsx` (stub extension + new describe)

**Interfaces:**
- Consumes: `fetchComments`/`postComment`/`deleteComment`/`PlatformError` (Task 7), App platform state (Tasks 11-12), `viewerReducer` actions `select_level` / `select_feature`.
- Produces:
  - `IndoorMapProps` gains `onMapClick?: ((lngLat: [number, number]) => void) | undefined` (when set, a map click reports its coordinate INSTEAD of feature selection) and `flyTo?: { lngLat: [number, number]; token: number } | null | undefined` (eases the camera when `token` changes).
  - `CommentsPanelProps { datasetId: string; account: AccountInfo | null; locale: LocaleCode; selectedFeatureId: string | null; pinDraft: { levelId: string; lngLat: [number, number] } | null; pinArmed: boolean; onArmPin: () => void; onClearPin: () => void; onFocusComment: (comment: CommentRecord) => void; onRequestSignIn: () => void }`.

- [ ] **Step 1: Add the IndoorMap props**

In `src/map/IndoorMap.tsx`:

1. Extend `IndoorMapProps`:

```ts
  /** When set, the next map click reports its lngLat instead of selecting features. */
  onMapClick?: ((lngLat: [number, number]) => void) | undefined;
  /** Imperative camera target; applied when token changes. */
  flyTo?: { lngLat: [number, number]; token: number } | null | undefined;
```

2. Mirror the existing ref pattern (like `venueRef`/`selectedIdRef`) for the click override:

```ts
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
```

3. At the very top of the existing `onClick` MapMouseEvent handler (the one registered via `map.on("click", onClick)`):

```ts
      const customClick = onMapClickRef.current;
      if (customClick !== undefined) {
        customClick([event.lngLat.lng, event.lngLat.lat]);
        return;
      }
```

4. Fly-to effect (place near the other `mapInstance`-dependent effects; `mapInstance` is the state set by `setMapInstance(map)` in `onLoad`):

```ts
  const lastFlyTokenRef = useRef(0);
  useEffect(() => {
    if (
      mapInstance === null ||
      flyTo === null ||
      flyTo === undefined ||
      flyTo.token === lastFlyTokenRef.current
    ) {
      return;
    }
    lastFlyTokenRef.current = flyTo.token;
    mapInstance.easeTo({ center: flyTo.lngLat, duration: EASE_DURATION_MS });
  }, [flyTo, mapInstance]);
```

Run: `corepack pnpm test --run src/map/IndoorMap.test.tsx` — existing tests must stay green (both props optional).

- [ ] **Step 2: Write the failing CommentsPanel test**

Create `src/components/CommentsPanel.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentRecord } from "../platform/types";
import { CommentsPanel } from "./CommentsPanel";

const fetchCommentsMock = vi.fn(async (): Promise<CommentRecord[]> => []);
const postCommentMock = vi.fn();
const deleteCommentMock = vi.fn(async () => undefined);

vi.mock("../platform/catalogClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform/catalogClient")>();
  return {
    ...actual,
    fetchComments: (...args: unknown[]) => fetchCommentsMock(...(args as [string])),
    postComment: (...args: unknown[]) => postCommentMock(...args),
    deleteComment: (...args: unknown[]) => deleteCommentMock(...args),
  };
});

const OLD: CommentRecord = {
  id: "c1",
  author: "alice",
  text: "old comment",
  createdAt: "2026-07-01T00:00:00.000Z",
};
const NEW: CommentRecord = {
  id: "c2",
  author: "bob",
  text: "new pinned comment",
  createdAt: "2026-07-02T00:00:00.000Z",
  levelId: "ordinal:0",
  lngLat: [139.76, 35.68],
};

function props(overrides?: Partial<Parameters<typeof CommentsPanel>[0]>) {
  return {
    datasetId: "tokyo",
    account: { username: "alice", role: "user" as const },
    locale: "en" as const,
    selectedFeatureId: null,
    pinDraft: null,
    pinArmed: false,
    onArmPin: vi.fn(),
    onClearPin: vi.fn(),
    onFocusComment: vi.fn(),
    onRequestSignIn: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("CommentsPanel", () => {
  it("lists comments newest first and focuses a pinned comment on click", async () => {
    fetchCommentsMock.mockResolvedValueOnce([OLD, NEW]);
    const p = props();
    render(<CommentsPanel {...p} />);
    const items = await screen.findAllByRole("listitem");
    expect(items[0]?.textContent).toContain("new pinned comment");
    expect(items[1]?.textContent).toContain("old comment");
    await userEvent.click(screen.getByRole("button", { name: /new pinned comment/ }));
    expect(p.onFocusComment).toHaveBeenCalledWith(NEW);
  });

  it("posts with the pin draft and clears it", async () => {
    fetchCommentsMock.mockResolvedValue([]);
    postCommentMock.mockResolvedValue({ ...NEW, id: "c9", text: "here" });
    const p = props({ pinDraft: { levelId: "ordinal:0", lngLat: [139.76, 35.68] } });
    render(<CommentsPanel {...p} />);
    await userEvent.type(await screen.findByLabelText("Comment"), "here");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => {
      expect(postCommentMock).toHaveBeenCalledWith("tokyo", {
        text: "here",
        levelId: "ordinal:0",
        lngLat: [139.76, 35.68],
      });
    });
    expect(p.onClearPin).toHaveBeenCalled();
  });

  it("shows a sign-in prompt instead of the composer when signed out", async () => {
    fetchCommentsMock.mockResolvedValueOnce([OLD]);
    const p = props({ account: null });
    render(<CommentsPanel {...p} />);
    await screen.findAllByRole("listitem");
    expect(screen.queryByLabelText("Comment")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Sign in to comment" }));
    expect(p.onRequestSignIn).toHaveBeenCalled();
  });

  it("offers delete only to the owner or an admin", async () => {
    fetchCommentsMock.mockResolvedValueOnce([OLD, NEW]);
    render(<CommentsPanel {...props({ account: { username: "alice", role: "user" } })} />);
    const items = await screen.findAllByRole("listitem");
    // alice owns OLD (rendered second), not NEW.
    expect(items[1]?.querySelector("button[aria-label='Delete comment']")).toBeTruthy();
    expect(items[0]?.querySelector("button[aria-label='Delete comment']")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `corepack pnpm test --run src/components/CommentsPanel.test.tsx`
Expected: FAIL — cannot resolve `./CommentsPanel`.

- [ ] **Step 4: Implement the panel**

Create `src/components/CommentsPanel.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { LocaleCode } from "../imdf/types";
import {
  PlatformError,
  deleteComment,
  fetchComments,
  postComment,
} from "../platform/catalogClient";
import type { AccountInfo, CommentInput, CommentRecord } from "../platform/types";

const ui = {
  heading: { ja: "コメント", en: "Comments" },
  comment: { ja: "コメント", en: "Comment" },
  post: { ja: "投稿", en: "Post" },
  pin: { ja: "地図にピンを打つ", en: "Pin on map" },
  pinArmed: { ja: "地図をクリックしてください…", en: "Click the map…" },
  pinSet: { ja: "ピン設定済み", en: "Pin set" },
  clearPin: { ja: "ピンを外す", en: "Remove pin" },
  attachFeature: { ja: "選択中の地物に紐付け", en: "Link selected feature" },
  signInPrompt: { ja: "サインインしてコメント", en: "Sign in to comment" },
  empty: { ja: "コメントはまだありません。", en: "No comments yet." },
  deleteLabel: { ja: "コメントを削除", en: "Delete comment" },
  loadFailed: {
    ja: "コメントを読み込めませんでした。",
    en: "Comments could not be loaded.",
  },
  retry: { ja: "再試行", en: "Retry" },
} as const;

export interface CommentsPanelProps {
  datasetId: string;
  account: AccountInfo | null;
  locale: LocaleCode;
  selectedFeatureId: string | null;
  pinDraft: { levelId: string; lngLat: [number, number] } | null;
  pinArmed: boolean;
  onArmPin: () => void;
  onClearPin: () => void;
  onFocusComment: (comment: CommentRecord) => void;
  onRequestSignIn: () => void;
}

export function CommentsPanel({
  datasetId,
  account,
  locale,
  selectedFeatureId,
  pinDraft,
  pinArmed,
  onArmPin,
  onClearPin,
  onFocusComment,
  onRequestSignIn,
}: CommentsPanelProps) {
  const [comments, setComments] = useState<CommentRecord[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [text, setText] = useState("");
  const [attachFeature, setAttachFeature] = useState(false);
  const [busy, setBusy] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoadError(false);
    fetchComments(datasetId)
      .then((loaded) => {
        setComments(
          [...loaded].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
        );
      })
      .catch(() => {
        setLoadError(true);
      });
  }, [datasetId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed === "" || busy) {
      return;
    }
    const input: CommentInput = {
      text: trimmed,
      ...(pinDraft !== null ? { levelId: pinDraft.levelId, lngLat: pinDraft.lngLat } : {}),
      ...(attachFeature && selectedFeatureId !== null
        ? { featureId: selectedFeatureId }
        : {}),
    };
    setBusy(true);
    setPostError(null);
    postComment(datasetId, input)
      .then(() => {
        setBusy(false);
        setText("");
        setAttachFeature(false);
        onClearPin();
        reload();
      })
      .catch((caught: unknown) => {
        setBusy(false);
        if (caught instanceof PlatformError && caught.status === 401) {
          onRequestSignIn();
        }
        setPostError(caught instanceof Error ? caught.message : String(caught));
      });
  };

  const canDelete = (comment: CommentRecord): boolean =>
    account !== null && (account.role === "admin" || account.username === comment.author);

  return (
    <aside className="comments-panel" aria-label={ui.heading[locale]}>
      <h2 className="comments-panel__heading">{ui.heading[locale]}</h2>
      {loadError ? (
        <p className="comments-panel__notice">
          {ui.loadFailed[locale]}{" "}
          <button type="button" onClick={reload}>
            {ui.retry[locale]}
          </button>
        </p>
      ) : null}
      {comments !== null && comments.length === 0 ? (
        <p className="comments-panel__notice">{ui.empty[locale]}</p>
      ) : null}
      <ul className="comments-panel__list">
        {(comments ?? []).map((comment) => (
          <li key={comment.id} className="comments-panel__item">
            <button
              type="button"
              className="comments-panel__body"
              onClick={() => {
                onFocusComment(comment);
              }}
            >
              <span className="comments-panel__author">
                {comment.author}
                {comment.lngLat !== undefined ? " 📍" : ""}
              </span>
              <span>{comment.text}</span>
              <time className="comments-panel__time" dateTime={comment.createdAt}>
                {new Date(comment.createdAt).toLocaleString(
                  locale === "ja" ? "ja-JP" : "en-US",
                )}
              </time>
            </button>
            {canDelete(comment) ? (
              <button
                type="button"
                aria-label={ui.deleteLabel[locale]}
                className="comments-panel__delete"
                onClick={() => {
                  void deleteComment(datasetId, comment.id)
                    .then(reload)
                    .catch(() => {
                      setLoadError(true);
                    });
                }}
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {account === null ? (
        <button type="button" className="comments-panel__signin" onClick={onRequestSignIn}>
          {ui.signInPrompt[locale]}
        </button>
      ) : (
        <form className="comments-panel__composer" onSubmit={onSubmit}>
          <label>
            {ui.comment[locale]}
            <textarea
              value={text}
              maxLength={2000}
              required
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          </label>
          <div className="comments-panel__pin-controls">
            {pinDraft !== null ? (
              <>
                <span>{ui.pinSet[locale]}</span>
                <button type="button" onClick={onClearPin}>
                  {ui.clearPin[locale]}
                </button>
              </>
            ) : (
              <button type="button" onClick={onArmPin} disabled={pinArmed}>
                {pinArmed ? ui.pinArmed[locale] : ui.pin[locale]}
              </button>
            )}
            <label>
              <input
                type="checkbox"
                checked={attachFeature}
                disabled={selectedFeatureId === null}
                onChange={(event) => {
                  setAttachFeature(event.target.checked);
                }}
              />
              {ui.attachFeature[locale]}
            </label>
          </div>
          {postError !== null ? <p className="comments-panel__notice">{postError}</p> : null}
          <button type="submit" disabled={busy || text.trim() === ""}>
            {ui.post[locale]}
          </button>
        </form>
      )}
    </aside>
  );
}
```

Append to `src/app/app.css`:

```css
.comments-panel {
  position: absolute;
  top: 56px;
  right: 12px;
  z-index: 25;
  width: 300px;
  max-height: calc(100% - 80px);
  overflow-y: auto;
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
}

.comments-panel__heading {
  font-size: 15px;
  margin: 0 0 8px;
}

.comments-panel__list {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.comments-panel__item {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.comments-panel__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  font: inherit;
}

.comments-panel__author {
  font-weight: 600;
  font-size: 12px;
}

.comments-panel__time {
  font-size: 11px;
  color: var(--color-muted);
}

.comments-panel__notice {
  font-size: 12px;
  color: var(--color-muted);
}

.comments-panel__composer textarea {
  display: block;
  width: 100%;
  min-height: 64px;
  margin-top: 4px;
}

.comments-panel__pin-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  font-size: 12px;
}
```

Run: `corepack pnpm test --run src/components/CommentsPanel.test.tsx` — expected PASS (4 tests).

- [ ] **Step 5: Wire comments into App (with stub extension and tests)**

1. In `src/app/App.test.tsx`, extend the `IndoorMapStub` inside the existing `vi.mock("../map/IndoorMap", …)` so pin capture is exercisable:

```tsx
        {props.onMapClick !== undefined ? (
          <button
            type="button"
            data-testid="map-click-proxy"
            onClick={() => {
              props.onMapClick!([139.76, 35.68]);
            }}
          >
            map click
          </button>
        ) : null}
```

2. Add the failing App tests:

```ts
describe("App comments", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  async function openDataset(): Promise<void> {
    window.history.replaceState(null, "", "/?dataset=tokyo");
    probeCatalogMock.mockResolvedValueOnce([CATALOG_SNAPSHOT_ENTRY]);
    fetchMeMock.mockResolvedValueOnce({ username: "alice", role: "user" });
    fetchCatalogMock.mockResolvedValue([CATALOG_SNAPSHOT_ENTRY]);
    fetchImdfFileMock.mockResolvedValue(zipFile("tokyo.zip"));
    readVenueSnapshotMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    await screen.findByTestId("indoor-map-stub");
  }

  it("opens the panel, arms a pin, captures a map click, and posts", async () => {
    fetchCommentsMock.mockResolvedValue([]);
    postCommentMock.mockResolvedValue({ id: "c1", author: "alice", text: "x", createdAt: "now" });
    await openDataset();
    await userEvent.click(screen.getByRole("button", { name: "コメント" }));
    await userEvent.click(await screen.findByRole("button", { name: "地図にピンを打つ" }));
    await userEvent.click(await screen.findByTestId("map-click-proxy"));
    await userEvent.type(screen.getByLabelText("コメント"), "ここが狭い");
    await userEvent.click(screen.getByRole("button", { name: "投稿" }));
    await waitFor(() => {
      expect(postCommentMock).toHaveBeenCalledWith(
        "tokyo",
        expect.objectContaining({ text: "ここが狭い", lngLat: [139.76, 35.68] }),
      );
    });
  });

  it("hides the comments toggle for local files and in embed mode", async () => {
    probeCatalogMock.mockResolvedValueOnce([]);
    loadImdfArchiveMock.mockResolvedValue(buildMinimalVenue());
    render(<App />);
    expect(screen.queryByRole("button", { name: "コメント" })).toBeNull();
  });
});
```

Run: `corepack pnpm test --run src/app/App.test.tsx` — new describe MUST fail.

3. Implement in `src/app/App.tsx`:

Imports: `CommentsPanel`, `type { CommentRecord }` added to the platform types import.

State:

```ts
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [pinArmed, setPinArmed] = useState(false);
  const [pinDraft, setPinDraft] = useState<{ levelId: string; lngLat: [number, number] } | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ lngLat: [number, number]; token: number } | null>(null);
  const flyTokenRef = useRef(0);
```

Handlers:

```ts
  const handlePinClick = useCallback(
    (lngLat: [number, number]) => {
      if (venueState === null) {
        return;
      }
      setPinDraft({ levelId: venueState.selectedLevelId, lngLat });
      setPinArmed(false);
    },
    [venueState],
  );

  const focusComment = useCallback(
    (comment: CommentRecord) => {
      if (comment.levelId !== undefined) {
        dispatch({ type: "select_level", levelId: comment.levelId });
      }
      if (comment.featureId !== undefined) {
        dispatch({
          type: "select_feature",
          featureId: comment.featureId,
          ...(comment.levelId !== undefined ? { levelId: comment.levelId } : {}),
        });
      }
      if (comment.lngLat !== undefined) {
        flyTokenRef.current += 1;
        setFlyTarget({ lngLat: comment.lngLat, token: flyTokenRef.current });
      }
    },
    [],
  );
```

`IndoorMap` props (spread-conditional to satisfy `exactOptionalPropertyTypes`):

```tsx
                onMapClick={pinArmed ? handlePinClick : undefined}
                flyTo={flyTarget}
```

Platform bar gains the toggle (only for datasets):

```tsx
              {params.dataset !== null ? (
                <button
                  type="button"
                  className="account-control__button"
                  onClick={() => {
                    setCommentsOpen((open) => !open);
                  }}
                >
                  {ui.comments[locale]}
                </button>
              ) : null}
```

with `comments: { ja: "コメント", en: "Comments" }` in App's `ui` record. Panel rendering (sibling of the platform bar):

```tsx
          {commentsOpen && params.dataset !== null && !embed ? (
            <CommentsPanel
              datasetId={params.dataset}
              account={account}
              locale={locale}
              selectedFeatureId={venueState?.selectedFeatureId ?? null}
              pinDraft={pinDraft}
              pinArmed={pinArmed}
              onArmPin={() => {
                setPinArmed(true);
              }}
              onClearPin={() => {
                setPinDraft(null);
                setPinArmed(false);
              }}
              onFocusComment={focusComment}
              onRequestSignIn={() => {
                setSignInOpen(true);
              }}
            />
          ) : null}
```

(No leftover plumbing to remove: `setSignInOpen` was introduced and used in Task 11.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `corepack pnpm test --run src/app/App.test.tsx src/components/CommentsPanel.test.tsx src/map/IndoorMap.test.tsx`
Expected: PASS. `corepack pnpm typecheck` — clean.

- [ ] **Step 7: Commit**

```bash
git add src/map/IndoorMap.tsx src/components/CommentsPanel.tsx src/components/CommentsPanel.test.tsx src/app/App.tsx src/app/App.test.tsx src/app/app.css
git commit -m "feat: add dataset comments with map pins"
```

---

### Task 14: End-to-end platform journey

**Files:**
- Modify: `playwright.config.ts`
- Create: `e2e/platform.spec.ts`

**Interfaces:**
- Consumes: the built server CLI (Task 4), snapshot writer (Task 5), the whole UI. Playwright `webServer` array boots BOTH the existing vite preview (4173) and the platform server (4174) with seeded accounts `admin/e2e-admin-pw` (admin) and `alice/e2e-alice-pw` (user).
- Produces: regression coverage for publish → gallery → view → comment → embed.

- [ ] **Step 1: Extend the Playwright config**

In `playwright.config.ts`, replace the single `webServer` object with an array — keep the existing vite entry EXACTLY as it is, and add:

```ts
  webServer: [
    {
      command:
        "corepack pnpm build && corepack pnpm exec vite preview --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command:
        "corepack pnpm build:server && node server/dist/main.js add-user admin --role admin --password e2e-admin-pw --data e2e/.platform-data && node server/dist/main.js add-user alice --role user --password e2e-alice-pw --data e2e/.platform-data && node server/dist/main.js --port 4174 --data e2e/.platform-data --app dist",
      url: "http://127.0.0.1:4174/api/catalog",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
```

Note: the platform server serves `dist` produced by the first entry's build; the readiness URL is the API, so a not-yet-built `dist` only affects static requests, which the spec makes after both servers are ready. `add-user` is an idempotent upsert, so reruns are safe.

- [ ] **Step 2: Write the platform spec**

Create `e2e/platform.spec.ts` (datasets get unique ids per run so a reused data dir never collides):

```ts
import { expect, request, test } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeVenue } from "../src/imdf/normalizeVenue";
import { writeVenueSnapshot } from "../src/imdf/venueSnapshot";
import type { FeatureType, ImdfManifest, ParsedImdfArchive } from "../src/imdf/types";
import {
  LEVEL_B1_EN,
  levelPill,
  minimalImdfZipBuffer,
  openMenu,
  VENUE_NAME_JA,
} from "./helpers";

const BASE = "http://127.0.0.1:4174";
const RUN_ID = `${Date.now()}`;
const SNAPSHOT_ID = `e2e-snap-${RUN_ID}`;

test.use({ baseURL: BASE });

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "tests",
  "fixtures",
  "minimal-imdf",
);

async function buildSnapshotBuffer(): Promise<Buffer> {
  const manifest = JSON.parse(
    await readFile(path.join(FIXTURE_DIR, "manifest.json"), "utf8"),
  ) as ImdfManifest;
  const collections: ParsedImdfArchive["collections"] = {};
  for (const name of await readdir(FIXTURE_DIR)) {
    if (!name.endsWith(".geojson")) {
      continue;
    }
    collections[name.replace(/\.geojson$/, "") as FeatureType] = JSON.parse(
      await readFile(path.join(FIXTURE_DIR, name), "utf8"),
    ) as GeoJSON.FeatureCollection;
  }
  const venue = normalizeVenue({ manifest, collections });
  const blob = await writeVenueSnapshot(venue, "e2e-fixture.gdb");
  return Buffer.from(await blob.arrayBuffer());
}

async function adminApi() {
  const api = await request.newContext({ baseURL: BASE });
  const login = await api.post("/api/login", {
    data: { username: "admin", password: "e2e-admin-pw" },
  });
  expect(login.ok()).toBeTruthy();
  return api;
}

test.describe("platform", () => {
  test.beforeAll(async () => {
    const api = await adminApi();
    const put = await api.put(
      `/api/datasets/${SNAPSHOT_ID}?name=${encodeURIComponent("E2E スナップショット")}&kind=venue-snapshot&levelCount=3&featureCount=20&sourceName=e2e-fixture.gdb`,
      {
        data: await buildSnapshotBuffer(),
        headers: { "content-type": "application/zip" },
      },
    );
    expect(put.ok()).toBeTruthy();
    await api.dispose();
  });

  test("snapshot datasets load through the bundle path", async ({ page }) => {
    // Targeted: kind=venue-snapshot goes through readVenueSnapshot, not the
    // IMDF worker. The full journey below uses a UI-published dataset.
    await page.goto(`/?dataset=${SNAPSHOT_ID}`);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await expect(page.getByText(VENUE_NAME_JA).first()).toBeVisible();
  });

  test("full journey: admin UI-publish -> gallery -> colleague view -> pinned comment -> embed", async ({ page }) => {
    const PUBLISHED_ID = `e2e-imdf-${RUN_ID}`;

    // Landing is public; no publish control anywhere while signed out.
    await page.goto("/");
    await expect(page.getByRole("button", { name: "公開" })).toHaveCount(0);

    // Open the minimal IMDF zip locally first (the account row lives in the
    // viewer menu, which exists once a venue is shown).
    const zip = await minimalImdfZipBuffer();
    await page
      .locator('input[type="file"][accept*="zip"]')
      .first()
      .setInputFiles({ name: "minimal-imdf.zip", mimeType: "application/zip", buffer: zip });
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await expect(page.getByRole("button", { name: "公開" })).toHaveCount(0);

    // Sign in as admin from the viewer menu. NOTE: the sign-in dialog mounts
    // at App level (outside the menu panel), so the menu's outside-click
    // handler closes the menu on the first dialog interaction — assert the
    // POST-sign-in effect (Publish appears), not menu content.
    await openMenu(page);
    await page.getByRole("button", { name: "サインイン" }).click();
    await page.getByLabel("ユーザー名").fill("admin");
    await page.getByLabel("パスワード").fill("e2e-admin-pw");
    await page.getByRole("button", { name: "送信" }).click();
    await expect(page.getByLabel("ユーザー名")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "公開" })).toBeVisible();

    // Publish it.
    await page.getByRole("button", { name: "公開" }).click();
    await page.getByLabel("表示名").fill("E2E 公開テスト");
    await page.getByLabel("データセットID").fill(PUBLISHED_ID);
    await page.getByRole("button", { name: "公開", exact: true }).last().click();
    await expect(page.getByLabel("表示URL")).toHaveValue(new RegExp(`dataset=${PUBLISHED_ID}`));
    await page.getByRole("button", { name: "閉じる" }).click();

    // Sign the admin out via the menu, then confirm the UI-published dataset
    // appears in the gallery.
    await openMenu(page);
    await page.getByRole("button", { name: "サインアウト" }).click();
    await page.goto("/");
    const card = page.getByRole("button", { name: /E2E 公開テスト/ });
    await expect(card).toBeVisible();

    // Colleague opens it from the gallery.
    await card.click();
    await expect(page).toHaveURL(new RegExp(`dataset=${PUBLISHED_ID}`));
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await expect(page.getByText(VENUE_NAME_JA).first()).toBeVisible();

    // Colleague signs in as alice via the menu.
    await openMenu(page);
    await page.getByRole("button", { name: "サインイン" }).click();
    await page.getByLabel("ユーザー名").fill("alice");
    await page.getByLabel("パスワード").fill("e2e-alice-pw");
    await page.getByRole("button", { name: "送信" }).click();
    // Dialog closes on success; the menu already closed itself on the first
    // dialog interaction (outside-click), so continue directly.
    await expect(page.getByLabel("ユーザー名")).toHaveCount(0);

    // Switch to B1 so the pin lands on a non-default level, then pin + post.
    await levelPill(page, LEVEL_B1_EN).click();
    await page.getByRole("button", { name: "コメント", exact: true }).click();
    await page.getByRole("button", { name: "地図にピンを打つ" }).click();
    const canvas = page.locator(".maplibregl-canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.getByLabel("コメント", { exact: true }).fill("ここを確認してください");
    await page.getByRole("button", { name: "投稿" }).click();
    await expect(page.getByText("ここを確認してください")).toBeVisible();

    // Persists across reload.
    await page.reload();
    await page.getByRole("button", { name: "コメント", exact: true }).click();
    await expect(page.getByText("ここを確認してください")).toBeVisible();

    // Embed deep link on the SAME dataset: chrome-free with the pin's level
    // preselected (same contract as embed.spec).
    await page.goto(`/?dataset=${PUBLISHED_ID}&embed=1&level=b1`);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await expect(levelPill(page, LEVEL_B1_EN)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "サインイン" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "コメント", exact: true })).toHaveCount(0);
  });
});
```

Selector caveats for the implementer: (a) the IMDF file input accept string must match the app (`.zip,application/zip`); (b) if the publish submit button's accessible name collides with the platform-bar Publish button, disambiguate with `dialog.getByRole(...)` scoping; (c) `getByLabel("コメント")` may match both toggle and textarea — scope to the panel via `page.locator(".comments-panel")` when needed. Adjust selectors, not behavior.

- [ ] **Step 3: Run the spec on Chromium**

Run: `corepack pnpm exec playwright test e2e/platform.spec.ts --project=chromium`
Expected: 2 passed. (Cross-browser projects will also pick this spec up in full runs; keep it browser-agnostic.)

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts e2e/platform.spec.ts
git commit -m "test: add end-to-end platform journey"
```

---

### Task 15: Deployment docs and final verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything.
- Produces: the shippable state.

- [ ] **Step 1: Add the deployment section to README.md**

Append:

```markdown
## Sharing platform (intranet server)

The viewer doubles as an ACC/Forma-style dataset sharing platform backed by a
single dependency-free Node service.

### Build and run

    corepack pnpm build          # frontend -> dist/
    corepack pnpm build:server   # server   -> server/dist/
    node server/dist/main.js --port 8080 --data D:\gis-platform-data --app dist

The `--data` directory is the entire persistent state (datasets, catalog,
comments, accounts, sessions) — back it up as one folder. Run the process
under Task Scheduler or NSSM on a Windows VM. Expose it on the intranet only:
reads are public by design; sign-in credentials transit as plain HTTP unless
IT terminates TLS in front (IIS/ARR reverse proxy).

### Accounts

Accounts are CLI-managed (no UI). Roles: `admin` publishes and deletes,
`user` comments.

    node server/dist/main.js add-user daniel --role admin --data D:\gis-platform-data
    node server/dist/main.js add-user alice --role user --data D:\gis-platform-data

Re-running `add-user` for an existing name resets the password/role.

### Publishing and sharing

1. Open the viewer menu and sign in, then open a GDB folder/archive or an IMDF ZIP locally.
2. Review the GDB mapping as usual, import, then click 公開 (Publish).
3. Share the view URL (`/?dataset=<id>`) or embed URL
   (`/?dataset=<id>&embed=1&level=b1f&lang=ja`) — the same `level`, `lang`,
   and `theme` deep-link parameters work for datasets.
```

- [ ] **Step 2: Full verification**

Run, in order, expecting all green:

```bash
corepack pnpm test --run
corepack pnpm typecheck
corepack pnpm build
corepack pnpm build:server
corepack pnpm exec playwright test e2e/platform.spec.ts e2e/embed.spec.ts --project=chromium
```

Then a manual smoke: `node server/dist/main.js --port 8080 --data ./tmp-verify --app dist`, add an admin, publish a real GDB corpus dataset (e.g. Tokyo strict subset) through the browser, open it from a second browser profile, leave a pinned comment, load the embed URL. Delete `./tmp-verify` afterwards.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document sharing platform deployment"
```
