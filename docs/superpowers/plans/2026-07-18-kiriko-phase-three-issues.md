# Kiriko Phase Three Review Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship version-pinned map review issues with assignment, date-only deadlines, limited Markdown discussion, server-enforced permissions, and live SSE invalidation without changing KVB bytes or the direct/local ZIP viewer.

**Architecture:** Add a permanent public identity to every immutable published version and return it on the exact bundle response. The server stores mutable issue roots/replies in SQLite, validates map anchors through the existing Rust KVB decoder exposed as an asynchronous napi operation, and serves canonical REST projections plus revision-only SSE. The React viewer keeps issue synchronization separate from venue state, renders an Issues rail/panel and DOM map pins only for valid dataset provenance, and preserves local/source/embed behavior.

**Tech Stack:** Rust 1.97, `kiriko-bundle`, napi-rs 3, Node 24–26, pnpm 11, Fastify 5, TypeBox 0.34, better-sqlite3 12, React 19, MapLibre GL 5, `react-markdown` 10.1.0, `remark-breaks` 4.0.0, native `EventSource`, Vitest 4, Playwright 1.61.

## Global Constraints

- The approved source of truth is `docs/superpowers/specs/2026-07-18-kiriko-phase-three-issues-design.md`.
- KVB envelope, section versions, payloads, golden bytes, and `tests/fixtures/minimal.kvb.sha256` remain unchanged.
- `/v/` remains the static/cacheable bundle namespace. Dynamic issue REST/SSE routes live under `/api`.
- Every version has a unique non-null lowercase 64-hex `public_id`; latest and pinned bundle 200/304 responses emit it as `Kiriko-Version-Id`.
- Issue collections are keyed only by `public_id`, never by integer IDs, tenant/venue slugs, sequence, bundle hash, decoded metadata, or a latest alias.
- Public reads and SSE are allowed only for an exact published version. Reviewer directory and every mutation require a session. Every issue JSON response uses `Cache-Control: no-store`.
- Roles remain `viewer | member | admin`; admins may tombstone others but may not rewrite another author’s text.
- Viewer self-assignment transitions are exactly unassigned → self and self → unassigned. Members/admins may assign or clear any existing account.
- Roots have one optional assignee and one optional `YYYY-MM-DD` due date. Replies have neither. Closed roots accept replies; deleted roots reject new replies.
- Root/reply create uses a UUID-v4 request ID and target-bound SHA-256 idempotency hash. Replays do not allocate pins, increment revision, or emit SSE.
- Every patch/delete carries `expectedVersion`. Stale mutations return `409 stale_issue` with current resource and revision.
- Canonical collection GET reads revision, roots, replies, and reviewer joins from one SQLite snapshot. Only full GET responses advance web `appliedRevision`.
- Issue errors keep the flat `error` code and exact `{ error, message, details?, current?, revision? }` shape, including `500 internal_error` and `503 sse_capacity`.
- Markdown is normalized CRLF/CR → LF, rejects lone surrogates/whitespace-only/disallowed controls, and permits 1–4,000 Unicode scalar values. Raw HTML is never enabled.
- Due dates remain date-only strings and are never parsed as UTC midnight. Before local today is overdue; today through three local calendar days ahead is due soon. Timestamps are application-generated RFC 3339 UTC values ending in `Z`.
- Queue/pin summary is the first non-empty normalized Markdown source line with whitespace collapsed; keep its first 80 Unicode scalar values and append `…` iff it is longer.
- SSE carries revision invalidations only, emits current revision immediately, emits `: heartbeat` every 15 seconds, and caps connections at configurable defaults of 512 process-wide and 128 per version.
- Issues never initialize for `?embed=1`, `?src=`, hidden-input ZIPs, dropped ZIPs, or successful local replacement of a dataset.
- Issue failures never dispatch venue `load_failed` and never become archive/bundle errors.
- All user-facing copy is bilingual through the existing `{ ja, en }` pattern. Reuse Kiriko tokens and existing rail, panel, chip, input, button, and compact-sheet styles.
- TypeScript remains strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Commit no generated napi/WASM package files or native binaries.
- Commit after every task using the exact message shown in that task.

## Existing files and conventions

- `server/src/db/migrate.ts` applies each lexical `.sql` migration atomically and records its filename in `schema_migrations`.
- `server/src/db/migrations/001_init.sql` is applied history and must not be edited.
- `server/src/venues/uploadRoute.ts` contains the only production `INSERT INTO versions`.
- `server/src/jobs/publish.ts` snapshots a version before async native compilation and conditionally updates the exact row afterward.
- `server/src/serve/routes.ts` owns latest/pinned bundle MIME, ETag, cache policy, and 304 behavior.
- `server/src/core/native.ts` treats napi output as untrusted and maps domain failures without throwing raw native values.
- `src/bundle/loadKirikoBundle.ts` performs fetch → transferred worker decode → hydration and currently returns only `LoadedVenue`.
- `src/app/App.tsx` owns load-attempt tokens and preserves a previous venue while replacement loading fails.
- `src/state/viewerReducer.ts` stays issue-free; Phase Three adds a separate issue reducer/controller.
- `src/components/IconRail.tsx`, `FloatingPanel.tsx`, `src/app/app.css`, and `src/map/useFeatureMarkers.ts` are the UI/map patterns to extend.
- `playwright.config.ts` already runs live Vite + Fastify against fresh `.e2e-data` and gates Chromium/Firefox.

---

### Task 1: Permanent version provenance and review schema

**Files:**
- Create: `server/src/db/migrations/002_review_issues.sql`
- Modify: `server/src/venues/uploadRoute.ts`
- Modify: `server/src/jobs/publish.ts`
- Modify: `server/src/core/recompileLegacy.ts`
- Modify: `server/src/serve/routes.ts`
- Modify: `server/test/helpers.ts`
- Modify: `server/test/app.test.ts`
- Modify: `server/test/publish.test.ts`
- Modify: `server/test/serve.test.ts`
- Create: `server/test/issuesMigration.test.ts`

**Interfaces:**
- Consumes: the Phase Two `versions`, `venues`, `users`, bundle-hash, and serving contracts.
- Produces: `versions.public_id TEXT NOT NULL UNIQUE` with lowercase 64-hex enforcement; `comment_state`; `comments`; `newPublicVersionId(): string`; `Kiriko-Version-Id` on bundle 200/304 responses; publication stale-row guards that include `public_id`.

- [ ] **Step 1: Write the failing migration, serving, and publication tests**

Create an actual 001-era database in `issuesMigration.test.ts`, insert two version rows, run `migrate`, and assert preserved numeric IDs, stable rerun values, lowercase 64-hex uniqueness, `notnull = 1`, and the new tables/constraints. Extend `serve.test.ts` and `publish.test.ts` with these exact assertions:

```ts
expect(latest.headers["kiriko-version-id"]).toMatch(/^[0-9a-f]{64}$/);
expect(pinned.headers["kiriko-version-id"]).toBe(latest.headers["kiriko-version-id"]);
expect(notModified.headers["kiriko-version-id"]).toBe(latest.headers["kiriko-version-id"]);
expect(recreated.headers["kiriko-version-id"]).not.toBe(deletedPublicId);
expect(replacementRow.publicId).toBe(replacementPublicId);
expect(replacementRow.status).toBe("draft");
```

Update every direct test `INSERT INTO versions` to bind a fresh public ID so the RED failure is about production code/migration behavior rather than fixture setup.

- [ ] **Step 2: Run the focused tests to verify RED**

Run:

```bash
pnpm --filter kiriko-server exec vitest run test/issuesMigration.test.ts test/app.test.ts test/publish.test.ts test/serve.test.ts
```

Expected: FAIL because `public_id`, review tables, response header, and public-ID publish predicate do not exist.

- [ ] **Step 3: Implement the atomic migration**

`002_review_issues.sql` must rebuild `versions` while preserving `id` and every existing column, then create the issue tables. Use this schema contract:

```sql
ALTER TABLE versions RENAME TO versions_before_review_issues;

CREATE TABLE versions (
  id INTEGER PRIMARY KEY,
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  public_id TEXT NOT NULL UNIQUE
    CHECK (length(public_id) = 64 AND public_id = lower(public_id) AND public_id NOT GLOB '*[^0-9a-f]*'),
  source_blob_hash TEXT NOT NULL,
  bundle_hash TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','failed','archived')),
  source_kind TEXT NOT NULL DEFAULT 'imdf' CHECK (source_kind IN ('imdf','gdb')),
  stats_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (venue_id, seq)
);

INSERT INTO versions (
  id, venue_id, seq, public_id, source_blob_hash, bundle_hash,
  status, source_kind, stats_json, error, created_at
)
SELECT
  id, venue_id, seq, lower(hex(randomblob(32))), source_blob_hash, bundle_hash,
  status, source_kind, stats_json, error, created_at
FROM versions_before_review_issues;

DROP TABLE versions_before_review_issues;

CREATE TABLE comment_state (
  version_id INTEGER PRIMARY KEY REFERENCES versions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  next_pin_number INTEGER NOT NULL DEFAULT 1 CHECK (next_pin_number >= 1)
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  parent_id TEXT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  create_request_id TEXT NOT NULL,
  create_request_hash TEXT NOT NULL
    CHECK (length(create_request_hash) = 64 AND create_request_hash = lower(create_request_hash)
      AND create_request_hash NOT GLOB '*[^0-9a-f]*'),
  pin_number INTEGER,
  level_id TEXT,
  longitude REAL,
  latitude REAL,
  feature_id TEXT,
  body_markdown TEXT,
  status TEXT CHECK (status IN ('open','in_review','closed')),
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (id, version_id),
  UNIQUE (version_id, pin_number),
  UNIQUE (author_id, create_request_id),
  FOREIGN KEY (parent_id, version_id) REFERENCES comments(id, version_id),
  CHECK (
    (parent_id IS NULL AND pin_number IS NOT NULL AND level_id IS NOT NULL
      AND longitude IS NOT NULL AND latitude IS NOT NULL AND status IS NOT NULL)
    OR
    (parent_id IS NOT NULL AND pin_number IS NULL AND level_id IS NULL
      AND longitude IS NULL AND latitude IS NULL AND feature_id IS NULL
      AND status IS NULL AND assignee_id IS NULL AND due_date IS NULL)
  ),
  CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  CHECK ((deleted_at IS NULL AND body_markdown IS NOT NULL AND length(body_markdown) > 0)
    OR (deleted_at IS NOT NULL AND body_markdown IS NULL))
);
```

- [ ] **Step 4: Generate and propagate permanent IDs**

In `uploadRoute.ts` add one helper and bind it in the version insert:

```ts
import { randomBytes } from "node:crypto";

export function newPublicVersionId(): string {
  return randomBytes(32).toString("hex");
}
```

Extend `PublishRow`, its SELECT, and both success/failure identity predicates with `public_id`. Apply the same exact-row predicate to legacy recompilation updates. Do not add public ID to KVB compile metadata.

- [ ] **Step 5: Emit exact response provenance**

Change `findPublished` to return `{ hash, publicId }`. In `send`, set the header before the conditional branch:

```ts
reply.header("Kiriko-Version-Id", found.publicId);
reply.header("ETag", `"${found.hash}"`);
if (request.headers["if-none-match"] === `"${found.hash}"`) {
  return reply.code(304).send();
}
```

Keep bundle bytes, MIME, ETag, cache control, latest route, and `bundle@:seq` route unchanged.

- [ ] **Step 6: Run focused and full server checks**

Run:

```bash
pnpm --filter kiriko-server exec vitest run test/issuesMigration.test.ts test/app.test.ts test/publish.test.ts test/serve.test.ts
pnpm --filter kiriko-server typecheck
pnpm test:server
```

Expected: all tests pass; 200 and 304 responses carry the header; delete/recreate cannot reuse it.

- [ ] **Step 7: Commit**

```bash
git add server/src server/test
git commit -m "feat(server): add permanent review version identity"
```

---

### Task 2: Asynchronous native KVB anchor inspection

**Files:**
- Modify: `core/crates/kiriko-bundle/src/codec.rs`
- Modify: `core/crates/kiriko-bundle/src/lib.rs`
- Modify: `core/crates/kiriko-bundle/tests/bundle.rs`
- Modify: `core/crates/kiriko-node/src/lib.rs`
- Modify: `server/src/core/native.ts`
- Modify: `server/test/coreNative.test.ts`

**Interfaces:**
- Consumes: `decode_bundle(bytes) -> BundleDocument`, full-byte SHA-256, existing napi `AsyncTask` and resolved-domain-error convention.
- Produces: Rust `inspect_bundle`; JS `inspectBundle(Buffer): Promise<NativeInspectResponse>`; server `inspectVenueBundle(bundle, expectedBundleHash): Promise<BundleAnchorIndex>`.

- [ ] **Step 1: Add failing Rust inspection tests**

Assert the committed golden bundle produces its exact whole-file hash, level IDs, direct feature mappings, level-feature self-mapping, and null level-independent mappings. Also assert semantic rejection for duplicate/missing level relationships and propagation of all four existing decode codes.

```rust
let inspected = inspect_bundle(&bytes).expect("golden inspection");
assert_eq!(inspected.bundle_hash, "3e1add8208f77c98fdddf5253c98bb18f533e5b3bf3d35d92ac444525080e136");
assert_eq!(inspected.level_ids.len(), 3);
assert!(inspected.feature_levels.iter().any(|(feature, level)| feature == level));
```

- [ ] **Step 2: Verify Rust RED**

Run:

```bash
cargo test --manifest-path core/Cargo.toml -p kiriko-bundle --test bundle inspect_bundle
```

Expected: FAIL because `inspect_bundle` and `BundleInspection` do not exist.

- [ ] **Step 3: Implement the pure Rust projection**

Add and export:

```rust
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleInspection {
    pub bundle_hash: String,
    pub level_ids: Vec<String>,
    pub feature_levels: Vec<(String, Option<String>)>,
}

pub fn inspect_bundle(bytes: &[u8]) -> Result<BundleInspection, BundleError>;
```

Implementation rules:

1. Call `decode_bundle`; do not create a second binary parser.
2. Verify unique level IDs, exact level-row/level-feature correspondence, and every non-null feature level reference.
3. Map a `FeatureType::Level` feature to its own ID; use `feature.level_id` for every other type.
4. Compute lowercase SHA-256 over the complete input bytes, not the envelope payload digest.
5. Preserve canonical decoded order.

- [ ] **Step 4: Add failing napi/server bridge tests**

Extend `coreNative.test.ts` for raw export existence, golden projection, malformed/duplicate JSON, whole-file hash mismatch, all decode codes, and event-loop responsiveness:

```ts
let immediate = false;
setImmediate(() => { immediate = true; });
const index = await inspectVenueBundle(bundle, expectedHash);
expect(immediate).toBe(true);
expect(index.bundleHash).toBe(expectedHash);
expect(index.levelIds.size).toBe(3);
```

- [ ] **Step 5: Implement napi AsyncTask and defensive wrapper**

Expose this resolved envelope:

```rust
#[napi(object)]
pub struct NativeInspectResponse {
    pub ok: bool,
    pub inspection_json: Option<String>,
    pub error_json: Option<String>,
}

#[napi]
pub fn inspect_bundle(bundle: Buffer) -> AsyncTask<InspectTask>;
```

Copy the incoming napi `Buffer` once with `to_vec()` at the binding boundary and move that owned `Vec<u8>` into `InspectTask`, matching `CompileTask`; keep decode/hash/serialization off the event loop. Domain failures resolve `{ ok:false, errorJson }`; only napi/runtime failures reject.

In TypeScript export:

```ts
export interface BundleAnchorIndex {
  bundleHash: string;
  levelIds: ReadonlySet<string>;
  featureLevels: ReadonlyMap<string, string | null>;
}

export async function inspectVenueBundle(
  bundle: Buffer,
  expectedBundleHash: string,
  nativeInspect: NativeInspectFn = inspectBundle,
): Promise<BundleAnchorIndex>;
```

Validate every unknown field boundary, tuple arity, duplicate ID, hash form, and exact expected hash before creating the Set/Map. Map corrupt stored bytes to typed internal core errors; do not emit client `invalid_anchor` here.

- [ ] **Step 6: Verify native contracts and unchanged golden bytes**

Run:

```bash
cargo test --manifest-path core/Cargo.toml -p kiriko-bundle --test bundle inspect_bundle
cargo check --manifest-path core/Cargo.toml -p kiriko-node
pnpm core:build:node
pnpm --filter kiriko-server exec vitest run test/coreNative.test.ts
sha256sum -c tests/fixtures/minimal.kvb.sha256
node -e "const n=require('./core/crates/kiriko-node'); if(typeof n.inspectBundle!=='function') process.exit(1)"
npx -y node@24 -e "const n=require('./core/crates/kiriko-node'); if(typeof n.inspectBundle!=='function') process.exit(1)"
npx -y node@26 -e "const n=require('./core/crates/kiriko-node'); if(typeof n.inspectBundle!=='function') process.exit(1)"
```

Expected: all pass; golden hash unchanged; addon loads on Node 24 and 26.

- [ ] **Step 7: Commit source only**

```bash
git add core/crates/kiriko-bundle core/crates/kiriko-node/src/lib.rs server/src/core/native.ts server/test/coreNative.test.ts
git commit -m "feat(core): inspect KVB anchors through native bindings"
```

Confirm generated `index.js`, `index.d.ts`, `*.node`, and build directories are not staged.

---

### Task 3: Exact issue contracts and pure validation

**Files:**
- Modify: `server/src/auth/sessions.ts`
- Create: `server/src/issues/types.ts`
- Create: `server/src/issues/schemas.ts`
- Create: `server/src/issues/errors.ts`
- Create: `server/src/issues/validation.ts`
- Create: `server/test/issuesValidation.test.ts`

**Interfaces:**
- Consumes: `SessionUser`, TypeBox/Fastify conventions, approved error and Markdown contracts.
- Produces: `SessionRole`; public DTOs; create/patch/delete input types; exact TypeBox schemas; `IssueServiceError`; normalization/date/anchor/idempotency helpers.

- [ ] **Step 1: Write failing boundary tables**

Create table-driven tests for:

- CRLF and bare-CR normalization.
- 1 and 4,000 scalar acceptance; 0 and 4,001 rejection.
- astral characters counted once; lone high/low surrogate rejection.
- whitespace-only, C0/C1 control rejection; tab/LF acceptance.
- valid leap-day and invalid calendar dates without `Date` conversion.
- finite WGS84 coordinate bounds.
- UUID-v4 request ID shape.
- deterministic root/reply request hashes that change across kind, server-resolved numeric version ID, parent, absent/null-normalized fields, and body.
- exhaustive `viewer | member | admin` role typing.

```ts
expect(normalizeMarkdown("a\r\nb\rc")).toBe("a\nb\nc");
expect(validateDueDate("2028-02-29")).toBe("2028-02-29");
expect(() => validateDueDate("2027-02-29")).toThrowError("invalid_due_date");
expect(hashRootCreate(root, 1)).not.toBe(hashRootCreate(root, 2));
```

- [ ] **Step 2: Verify validation RED**

Run:

```bash
pnpm --filter kiriko-server exec vitest run test/issuesValidation.test.ts
```

Expected: FAIL because issue contracts and validators do not exist.

- [ ] **Step 3: Define domain and wire types**

Use these core shapes consistently in server and tests:

```ts
export type SessionRole = "viewer" | "member" | "admin";
export type IssueStatus = "open" | "in_review" | "closed";
export type IssueErrorCode =
  | "invalid_request" | "invalid_anchor" | "invalid_due_date" | "invalid_markdown"
  | "unauthorized" | "forbidden" | "not_found" | "stale_issue"
  | "idempotency_conflict" | "issue_deleted" | "sse_capacity" | "internal_error";

export interface IssueMutationResult {
  revision: number;
  versionId: number;
  publicVersionId: string;
  resourceId: string;
  replayed: boolean;
}

export type IssuePatch =
  | { type: "body"; bodyMarkdown: string; expectedVersion: number }
  | { type: "assignment"; assigneeId: number | null; expectedVersion: number }
  | { type: "due_date"; dueDate: string | null; expectedVersion: number }
  | { type: "status"; status: IssueStatus; expectedVersion: number };
```

Keep repository rows private and map tombstones to public DTOs so deleted Markdown cannot leak.

- [ ] **Step 4: Define exact TypeBox and issue error handling**

`schemas.ts` must export strict `additionalProperties:false` schemas for public ID, UUID-v4 request IDs, issue/reply/collection DTOs, `{ reviewers: ReviewerSummary[] }`, create bodies, each patch discriminant, delete body, mutation response, and IssueApiError. `errors.ts` must map only these statuses:

```ts
const ISSUE_STATUS = {
  invalid_request: 400, invalid_anchor: 400, invalid_due_date: 400, invalid_markdown: 400,
  unauthorized: 401, forbidden: 403, not_found: 404,
  stale_issue: 409, idempotency_conflict: 409, issue_deleted: 409,
  internal_error: 500, sse_capacity: 503,
} as const;
```

Unexpected DB/blob/native details log server-side and serialize only `{ error:"internal_error", message:"Could not update review issues." }`.

- [ ] **Step 5: Implement pure normalization and hashing**

Canonicalize optional values to explicit `null`, use sorted-key JSON, and hash the complete target-bound object:

```ts
export function hashReplyCreate(input: NormalizedReplyCreate, versionId: number, parentIssueId: string): string {
  return createHash("sha256").update(JSON.stringify({
    bodyMarkdown: input.bodyMarkdown,
    kind: "reply",
    parentIssueId,
    versionId,
  })).digest("hex");
}
```

Root hashing includes normalized body, level, coordinates, feature, assignee, due date, kind, and resolved numeric version ID. Reject non-finite values before serialization.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --filter kiriko-server exec vitest run test/issuesValidation.test.ts
pnpm --filter kiriko-server typecheck
```

Expected: PASS with exact boundary/error assertions.

- [ ] **Step 7: Commit**

```bash
git add server/src/auth/sessions.ts server/src/issues server/test/issuesValidation.test.ts
git commit -m "feat(server): define review issue contracts"
```

---

### Task 4: Transactional issue repository

**Files:**
- Create: `server/src/issues/repository.ts`
- Modify: `server/test/helpers.ts`
- Create: `server/test/issuesRepository.test.ts`

**Interfaces:**
- Consumes: Task 1 schema; Task 3 normalized inputs/types.
- Produces: `IssueRepository` with published-version resolution, snapshot collection reads, reviewer lookup, idempotent creates, versioned mutations, tombstones, and revision reads.

- [ ] **Step 1: Write failing repository transaction tests**

Cover all observable repository contracts:

1. Lazy state starts `{revision:0,nextPinNumber:1}`.
2. Root pins allocate 1,2,3 and deletion never reuses 2.
3. GET snapshot revision and rows are consistent/deterministically sorted.
4. A read-only replay probe returns the same resource/current revision without row/pin/revision changes; final create transactions repeat the lookup.
5. Exact root/reply replay still succeeds after mutable role, assignee-account, or parent tombstone changes; same request ID across kind/version/parent/payload conflicts.
6. Every non-replay mutation increments collection revision exactly once.
7. Stale row versions return the current public resource and revision.
8. Root/reply context lookups reject wrong-kind, unknown, deleted-version, and unpublished-version resources while exposing immutable author/version identity and current assignment/deletion/row-version state.
9. Closed roots accept replies; deleted roots reject new reply requests before and after concurrent deletion, while an exact committed reply replay still succeeds after parent deletion.
10. Root deletion nulls its body, forces `status='closed'`, preserves metadata/replies, and still permits existing reply authors to edit/delete their replies; reply deletion nulls only that reply body.
11. Deleting venue/version cascades state and comments.
12. Stored timestamps are exact `toISOString()` values under `TZ=Asia/Tokyo`.

- [ ] **Step 2: Verify repository RED**

Run:

```bash
TZ=Asia/Tokyo pnpm --filter kiriko-server exec vitest run test/issuesRepository.test.ts
```

Expected: FAIL because `IssueRepository` does not exist.

- [ ] **Step 3: Implement the repository surface**

Export this class surface; keep every operation synchronous and transaction-owned:

```ts
export class IssueRepository {
  constructor(private readonly db: Database.Database) {}
  resolvePublishedVersion(publicId: string): PublishedReviewVersion | null;
  getCollection(versionId: number): IssueCollection;
  getCurrentRevision(versionId: number): number;
  listReviewers(): ReviewerSummary[];
  getIssueContext(issueId: string): IssueMutationContext | null;
  getReplyContext(replyId: string): ReplyMutationContext | null;
  probeCreateReplay(authorId: number, requestId: string, requestHash: string): RepositoryMutationResult | null;
  createRoot(command: CreateRootCommand): RepositoryMutationResult;
  createReply(command: CreateReplyCommand): RepositoryMutationResult;
  patchIssue(command: PatchIssueCommand): RepositoryMutationResult;
  patchReply(command: PatchReplyCommand): RepositoryMutationResult;
  deleteIssue(command: DeleteIssueCommand): RepositoryMutationResult;
  deleteReply(command: DeleteReplyCommand): RepositoryMutationResult;
}
```

Implementation invariants:

- `resolvePublishedVersion` selects `id,public_id,bundle_hash` with `status='published'` and non-null bundle hash.
- Context lookups join a currently published version and return internal numeric/public version identity, author, assignee/status/deletion state, and row version needed by the permission service; wrong-kind and unpublished resources return null.
- `probeCreateReplay` reads the globally unique `(author_id,create_request_id)` row plus current collection revision in one transaction: absent returns null, equal hash returns replay metadata, unequal hash throws `idempotency_conflict`. It performs no target-state or permission check.
- Initialize state with `INSERT OR IGNORE` inside the same transaction as the read/write.
- Read state, roots, replies, authors, and assignees in one transaction; sort roots by pin and replies by `created_at,id`.
- Allocate pins with `UPDATE comment_state SET next_pin_number = next_pin_number + 1 WHERE version_id = ? RETURNING next_pin_number - 1 AS pin_number`.
- Recheck public ID/status/bundle hash and any non-null assignee account in the root-create transaction after async anchor inspection.
- Recheck reply parent same version, root-ness, and `deleted_at IS NULL` in reply-create transaction.
- Mutate with `WHERE id=? AND row_version=?`; a zero-row result must distinguish not-found from stale by a second in-transaction read.
- Store application `new Date().toISOString()` values passed in commands; never use SQL `datetime('now')` for comments.
- Root delete sets `status='closed'` atomically with its tombstone; reply patch/delete remains valid after root close/delete under row-version rules.
- Increment `comment_state.revision` in the same transaction and return it.
- Every mutation result, including replay/stale success envelopes where applicable, carries internal `versionId` and non-reusable `publicVersionId`; neither field is exposed by the REST mutation response.

- [ ] **Step 4: Prove idempotency and stale behavior**

Both `probeCreateReplay` and the final create transaction use the same request-key/hash decision. The final transaction repeats it before pin allocation and mutable target-state checks, closing the probe/create race. On matching hash, return `{resourceId,revision,replayed:true}` even if that existing root/reply or its parent was subsequently tombstoned. On mismatched hash, return `idempotency_conflict`. On stale update, return `{current,revision}` without incrementing revision.

- [ ] **Step 5: Run repository and migration suites**

Run:

```bash
TZ=Asia/Tokyo pnpm --filter kiriko-server exec vitest run test/issuesMigration.test.ts test/issuesRepository.test.ts
pnpm --filter kiriko-server typecheck
```

Expected: PASS; no hanging transaction; stable timestamps and pins.

- [ ] **Step 6: Commit**

```bash
git add server/src/issues/repository.ts server/test/helpers.ts server/test/issuesRepository.test.ts
git commit -m "feat(server): persist transactional review issues"
```

---

### Task 5: Anchor cache and permission service

**Files:**
- Create: `server/src/issues/anchorIndex.ts`
- Create: `server/src/issues/service.ts`
- Modify: `server/src/blobs/store.ts`
- Modify: `server/test/blobs.test.ts`
- Create: `server/test/issuesService.test.ts`

**Interfaces:**
- Consumes: `BlobStore`; `inspectVenueBundle`; `IssueRepository`; normalized commands; `SessionUser`.
- Produces: bounded/coalesced `AnchorIndexCache`; `IssueService`; `IssueRevisionPublisher = { publishRevision(publicVersionId, revision): void }`.

- [ ] **Step 1: Write failing service tests**

Use fakes for repository, BlobStore/native inspection, clock, ID factory, and publisher. Cover:

- Exact author/member/admin body/delete permission matrix.
- Viewer assignment transitions and member/admin assignment/clear.
- Due/status permissions; deleted root cannot reopen/mutate.
- Existing-account reviewer validation.
- Opaque-ID mutations authorize from `getIssueContext`/`getReplyContext`, recheck through expected row version/transaction rules, and never trust client ownership or version identity.
- Lost-response exact root/reply retries short-circuit through `probeCreateReplay` before mutable permission/account/parent/anchor validation, even after role, assignee, or tombstone state changes; mismatched reuse never bypasses validation as a replay.
- Unknown level/feature and cross-floor feature rejection; null-level feature acceptance.
- Concurrent identical cache misses call native inspection once.
- Cache keys by bundle hash, verifies returned hash, and evicts least-recent of 8 entries.
- Async blob reads do not call `readFileSync` on the issue request path.
- Async inspection followed by transaction re-resolution rejects changed public version/bundle.
- No SSE publication for validation failure, replay, stale result, or rollback.
- One publication keyed by the result’s non-reusable `publicVersionId` after each committed non-replay mutation; numeric row IDs never key fan-out.

- [ ] **Step 2: Verify service RED**

Run:

```bash
pnpm --filter kiriko-server exec vitest run test/blobs.test.ts
pnpm core:build:node
pnpm --filter kiriko-server exec vitest run test/issuesService.test.ts
```

Expected: FAIL because cache/service do not exist.

- [ ] **Step 3: Add asynchronous blob reads**

Add `BlobStore.readAsync(hash): Promise<Buffer>` using `node:fs/promises.readFile(this.path(hash))`; keep the existing synchronous `read` for unchanged bundle serving. Prove the method returns exact bytes and propagates missing-file errors in `blobs.test.ts`. `AnchorIndexCache` must use `readAsync`, never `read`.

- [ ] **Step 4: Implement a bounded coalescing cache**

Use no dependency. Keep at most 8 resolved indexes and one Promise per in-flight hash:

```ts
export class AnchorIndexCache {
  constructor(
    private readonly blobs: BlobStore,
    private readonly inspect: typeof inspectVenueBundle = inspectVenueBundle,
    private readonly maxEntries = 8,
  ) {}

  get(bundleHash: string): Promise<BundleAnchorIndex>;
  clear(): void;
}
```

Never cache a rejection or a hash mismatch. Touch insertion order on hit, evict the least-recent resolved entry, and clear in-flight state in `finally`.

- [ ] **Step 5: Implement service orchestration and permissions**

Expose methods matching the HTTP commands:

```ts
export class IssueService {
  getCollection(publicVersionId: string): IssueCollection;
  listReviewers(user: SessionUser): ReviewerSummary[];
  createIssue(user: SessionUser, publicVersionId: string, input: CreateIssueInput): Promise<IssueMutationResult>;
  createReply(user: SessionUser, issueId: string, input: CreateReplyInput): Promise<IssueMutationResult>;
  patchIssue(user: SessionUser, issueId: string, patch: IssuePatch): Promise<IssueMutationResult>;
  patchReply(user: SessionUser, replyId: string, patch: ReplyBodyPatch): Promise<IssueMutationResult>;
  deleteIssue(user: SessionUser, issueId: string, expectedVersion: number): Promise<IssueMutationResult>;
  deleteReply(user: SessionUser, replyId: string, expectedVersion: number): Promise<IssueMutationResult>;
}
```

Create flow is: pure schema/body/date/coordinate normalization → resolve the target’s server numeric version ID (root from public ID; reply from parent context) → compute the canonical request hash → call `probeCreateReplay`. Return an exact replay immediately without publication; throw a mismatched-key conflict immediately. Only an absent key proceeds through mutable role/assignment/account/deleted checks, root anchor inspection outside the transaction, and the final repository create, which repeats the replay decision before rechecking public ID/status/bundle or reply parent state. Publish the returned public-version revision only when `replayed === false`. Opaque patch/delete methods load typed repository context for permission decisions; expected-version and target-state rechecks make concurrent changes stale or deleted before commit.

- [ ] **Step 6: Run service/repository/native checks**

```bash
pnpm core:build:node
pnpm --filter kiriko-server exec vitest run test/blobs.test.ts test/coreNative.test.ts test/issuesRepository.test.ts test/issuesService.test.ts
pnpm --filter kiriko-server typecheck
```

Expected: PASS; asynchronous blob and native event-loop tests remain green.

- [ ] **Step 7: Commit**

```bash
git add server/src/blobs/store.ts server/src/issues/anchorIndex.ts server/src/issues/service.ts server/test/blobs.test.ts server/test/issuesService.test.ts
git commit -m "feat(server): enforce review issue permissions and anchors"
```

---

### Task 6: Bounded revision SSE

**Files:**
- Modify: `server/src/config.ts`
- Create: `server/src/issues/events.ts`
- Create: `server/src/issues/sseRoutes.ts`
- Modify: `server/test/helpers.ts`
- Modify: `server/test/auth.test.ts`
- Modify: `server/test/app.test.ts`
- Create: `server/test/issuesSse.test.ts`

**Interfaces:**
- Consumes: `IssueRepository.resolvePublishedVersion/getCurrentRevision`; Task 5 `IssueRevisionPublisher`.
- Produces: `IssueEventHub`; public `GET /api/review/versions/:publicVersionId/issues/events`; config defaults 512/128.

- [ ] **Step 1: Write failing hub and real-socket tests**

Test immediate revision framing, a commit injected during stream setup, normal commit publication, different public IDs remaining isolated even when a numeric row ID is reused, `closeVersion` ending only the deleted public ID and releasing its capacity, a 15-second heartbeat comment, no bodies/deltas, global/per-public-version capacity rejection, `Retry-After:15`, disconnect release, idempotent unsubscribe, empty public-ID state cleanup, and shutdown cleanup. Ordinary cases destroy their client response before `app.close()`; one dedicated real-socket case deliberately leaves a stream live, calls `app.close()`, and requires hub closure to end the response and let close resolve without a hang.

- [ ] **Step 2: Verify SSE RED**

Run:

```bash
pnpm --filter kiriko-server exec vitest run test/issuesSse.test.ts
```

Expected: FAIL because hub/stream/config do not exist.

- [ ] **Step 3: Implement validated config and event hub**

Add environment parsing with defaults:

```ts
issueSseMaxConnections: positiveInt(env.KIRIKO_ISSUE_SSE_MAX_CONNECTIONS, 512),
issueSseMaxPerVersion: positiveInt(env.KIRIKO_ISSUE_SSE_MAX_PER_VERSION, 128),
```


Add both fields to every direct `AppConfig` literal in `server/test/helpers.ts`, `auth.test.ts`, and `app.test.ts`; table-test zero, negative, non-integer, and non-numeric environment values against `positiveInt`.
The hub surface is:

```ts
export class IssueEventHub implements IssueRevisionPublisher {
  subscribe(
    publicVersionId: string,
    listener: (revision: number) => void,
    closeListener: () => void,
  ): () => void;
  publishRevision(publicVersionId: string, revision: number): void;
  closeVersion(publicVersionId: string): void;
  close(): void;
  readonly totalSubscribers: number;
}
```

Throw a typed capacity result before storing the listener. Unsubscribe must be safe twice. `closeVersion(publicVersionId)` invokes close listeners for exactly that non-reusable key and releases its capacity; `close()` does so for every key, clears all per-public-ID/global state, and prevents later publication. These paths terminate deleted-version streams and live SSE responses during Fastify `preClose`.

- [ ] **Step 4: Implement the public SSE route**

Resolve the published public ID before reserving capacity. On success set:

```ts
reply.raw.writeHead(200, {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
});
reply.raw.write(`event: revision\ndata: ${JSON.stringify({ revision })}\n\n`);
```

Avoid a read-then-subscribe lost-update window: resolve the version, reserve/subscribe under the exact non-reusable public ID first, buffer the maximum listener revision until headers are open, synchronously read current revision by internal ID, then emit one initial revision equal to `max(current, buffered)`. After the stream is open, emit committed listener revisions directly. Cleanup the reservation on every failure path.

Write `: heartbeat\n\n` every 15,000 ms. Install one idempotent cleanup for request abort, response close/error, timer, and hub unsubscribe. The hub close listener ends the raw response and runs the same cleanup. Capacity failure remains a normal JSON 503 with `Cache-Control: no-store` and is never hijacked.

Export this as an encapsulated route plugin and register it on the focused test app; Task 7 performs the single production `buildApp` registration so SSE and REST share one repository/hub/service graph.

- [ ] **Step 5: Verify SSE and config behavior**

Run:

```bash
pnpm --filter kiriko-server exec vitest run test/issuesSse.test.ts test/auth.test.ts
pnpm --filter kiriko-server typecheck
```

Expected: PASS; test process exits without open handles.

- [ ] **Step 6: Commit**

```bash
git add server/src/config.ts server/src/issues/events.ts server/src/issues/sseRoutes.ts server/test
git commit -m "feat(server): stream bounded issue revisions"
```

---

### Task 7: Issue REST routes and server integration

**Files:**
- Create: `server/src/issues/routes.ts`
- Modify: `server/src/venues/routes.ts`
- Modify: `server/src/venues/service.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/auth/guard.ts`
- Create: `server/test/issuesRoutes.test.ts`
- Modify: `server/test/venues.test.ts`

**Interfaces:**
- Consumes: Tasks 3–6 contracts, service, repository, cache, hub, and schemas.
- Produces: exact public collection/authenticated mutation routes; reviewer directory; scoped TypeBox validation error mapping; full server wiring.

- [ ] **Step 1: Write failing route integration tests**

Cover:

- Anonymous GET exact published collection and public SSE.
- Authenticated reviewer list with only `{id,username}`.
- `401`, `403`, `404`, every `400`, all three `409`, sanitized `500`, and `503` exact bodies/status schemas.
- Root create/replay, reply create, four issue patch operations, reply body patch, and both deletes.
- Stale response `current` discriminant/resource/revision.
- Deleted bodies absent from public JSON.
- Unpublished/unknown 64-hex version and opaque issue/reply IDs return identical `404 not_found`.
- All schemas reject additional properties, malformed UUID-v4 create request IDs, and malformed 64-hex public version IDs; issue/reply IDs remain opaque strings.
- Venue deletion atomically returns every deleted version’s public ID, closes those SSE subscribers after commit, releases capacity, and never closes or publishes into a recreated version’s stream.

- [ ] **Step 2: Verify REST RED**

Run:

```bash
pnpm core:build:node
pnpm --filter kiriko-server exec vitest run test/issuesRoutes.test.ts test/venues.test.ts
```

Expected: FAIL because routes are not registered.

- [ ] **Step 3: Register exact routes**

```text
GET    /api/review/versions/:publicVersionId/issues
POST   /api/review/versions/:publicVersionId/issues
GET    /api/review/versions/:publicVersionId/issues/events
GET    /api/reviewers
POST   /api/issues/:issueId/replies
PATCH  /api/issues/:issueId
PATCH  /api/replies/:replyId
DELETE /api/issues/:issueId
DELETE /api/replies/:replyId
```

Public GET/SSE have no session guard. Every other route uses `requireSession`. Collection GET returns `IssueCollection` directly; reviewer GET returns exactly `{ reviewers: ReviewerSummary[] }`; successful mutations return exactly `{ revision, resourceId }`, omitting internal `replayed`, `versionId`, and `publicVersionId`.
Collection, reviewer, and successful/error mutation JSON responses set `Cache-Control: no-store`; route tests assert it. SSE keeps its separate stream cache headers.

- [ ] **Step 4: Scope validation/error mapping**

Register issue routes in an encapsulated Fastify plugin with an error handler that converts only issue schema validation failures to `IssueApiError`. Add `message` to the existing 401 body without removing `error:"unauthorized"`; gallery callers remain compatible. Log unexpected causes and return sanitized `internal_error`.

- [ ] **Step 5: Wire dependencies and lifecycle**

In `buildApp`, construct repository → cache → hub → service after DB/blob creation and register SSE/REST routes. Change venue deletion to select the venue’s public version IDs and delete in one SQLite transaction, return them with the deletion result, then call `hub.closeVersion` for each only after commit; `registerVenueRoutes` receives that hub explicitly. Add a `preClose` hook that calls `hub.close()` so live responses/timers terminate before Fastify waits for sockets; keep cache cleanup and DB close in ordered `onClose` hooks. Prove production `app.close()` resolves with a live SSE client. Do not await native inspection inside a DB transaction.

- [ ] **Step 6: Run complete server acceptance**

Run:

```bash
pnpm core:build:node
pnpm --filter kiriko-server exec vitest run test/issuesMigration.test.ts test/issuesRepository.test.ts test/issuesValidation.test.ts test/issuesService.test.ts test/issuesSse.test.ts test/issuesRoutes.test.ts test/venues.test.ts
pnpm --filter kiriko-server typecheck
pnpm test:server
```

Expected: all server tests pass with no open handles.

- [ ] **Step 7: Commit**

```bash
git add server/src server/test
git commit -m "feat(server): expose version-pinned review issue API"
```

---

### Task 8: Preserve exact bundle provenance in the web loader

**Files:**
- Modify: `src/bundle/loadKirikoBundle.ts`
- Modify: `src/bundle/loadKirikoBundle.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: `Kiriko-Version-Id`; decoded `datasetId/version`; App attempt-token and previous-venue behavior.
- Produces: `KirikoBundleLoadResult`; App-level `BundleProvenance`; provenance stored only with an admitted successful load.

- [ ] **Step 1: Write failing loader provenance tests**

Add valid, missing, uppercase, short, and non-hex header cases. Assert decoded metadata survives, invalid/missing header still resolves the venue, and worker transfer/abort/cleanup remains unchanged.

```ts
expect(result.publicVersionId).toBe("a".repeat(64));
expect(result.metadata).toEqual({ datasetId: "default/minimal", version: 1 });
expect(missingHeaderResult.venue.venue.id).toBeDefined();
expect(missingHeaderResult.publicVersionId).toBeNull();
```

- [ ] **Step 2: Verify loader RED**

Run:

```bash
pnpm exec vitest run src/bundle/loadKirikoBundle.test.ts src/app/App.test.tsx
```

Expected: FAIL because loader returns only `LoadedVenue`.

- [ ] **Step 3: Return a load envelope without changing `LoadedVenue`**

```ts
export interface KirikoBundleLoadResult {
  venue: LoadedVenue;
  metadata: { datasetId: string; version: number };
  publicVersionId: string | null;
}

const PUBLIC_VERSION_ID = /^[0-9a-f]{64}$/;
```

Capture the header before reading/transferring the ArrayBuffer. On worker success, read metadata from `data.venue`, hydrate, and resolve the envelope. Missing/invalid identity is not a `VenueLoadError`.

- [ ] **Step 4: Generalize App successful-load provenance**

Use an App-private envelope:

```ts
type BundleProvenance = {
  datasetId: string;
  version: number;
  publicVersionId: string | null;
};

type ViewerLoadResult = { venue: LoadedVenue; provenance: BundleProvenance | null };
```

ZIP/source/drop closures return `{venue,provenance:null}`. Dataset closure maps the bundle result. Update provenance only after the same numeric attempt-token check that admits `load_succeeded`; retain old provenance through failed replacement, clear it after successful local replacement, and ignore stale bundle completions.

- [ ] **Step 5: Prove regressions**

Add App tests for valid identity, missing identity venue success, dataset-to-local teardown, failed local replacement retaining prior provenance, stale attempt suppression, `src` precedence, and embed provenance retained but not yet initialized.

Run:

```bash
pnpm exec vitest run src/bundle/loadKirikoBundle.test.ts src/app/App.test.tsx src/state/viewerReducer.test.ts
pnpm typecheck
```

Expected: PASS; no issue network code exists yet.

- [ ] **Step 6: Commit**

```bash
git add src/bundle/loadKirikoBundle.ts src/bundle/loadKirikoBundle.test.ts src/app/App.tsx src/app/App.test.tsx
git commit -m "feat(web): preserve bundle review provenance"
```

---

### Task 9: Issue API client and monotonic synchronization

**Files:**
- Create: `src/issues/types.ts`
- Create: `src/issues/api.ts`
- Create: `src/issues/api.test.ts`
- Create: `src/issues/issueReducer.ts`
- Create: `src/issues/issueReducer.test.ts`
- Create: `src/issues/useIssueSync.ts`
- Create: `src/issues/useIssueSync.test.tsx`

**Interfaces:**
- Consumes: exact Task 7 routes/errors; Task 8 `publicVersionId`.
- Produces: issue wire types/client; independent reducer; `useIssueSync(publicVersionId: string | null, options)` controller with canonical state and mutation commands.

- [ ] **Step 1: Write failing API contract tests**

Assert exact URLs, `credentials:"same-origin"`, AbortSignal, UUID request IDs, expectedVersion payloads, `{ reviewers }` unwrapping, error preservation, and EventSource URL construction. `IssueApiError` must preserve `status,error,message,details,current,revision` and never become `VenueLoadError`.

- [ ] **Step 2: Write failing reducer race tests**

Cover null-disabled initialization, controller filter/selection/draft/placement actions, one-time draft request-ID retention, feature-specific `400 invalid_anchor` recovery, duplicate/out-of-order observations, at-most-one GET, stale GET suppression, immediate follow-up GET, successful local revision 7 with unseen remote revision 6, version reset, old-key response suppression, 401/network/409 draft preservation, and selected-deleted fallback.

```ts
state = reduce(state, { type: "revision_observed", revision: 7 });
expect(state.highestObservedRevision).toBe(7);
expect(state.appliedRevision).toBe(5);
expect(state.refetchRequested).toBe(true);
```

- [ ] **Step 3: Verify client/reducer RED**

Run:

```bash
pnpm exec vitest run src/issues/api.test.ts src/issues/issueReducer.test.ts
```

Expected: FAIL because issue modules do not exist.

- [ ] **Step 4: Implement exact client and pure reducer**

The API client exposes:

```ts
getIssues(publicId: string, signal: AbortSignal): Promise<IssueCollection>;
createIssue(publicId: string, input: CreateIssueInput): Promise<IssueMutationResponse>;
createReply(issueId: string, input: CreateReplyInput): Promise<IssueMutationResponse>;
patchIssue(issueId: string, patch: IssuePatch): Promise<IssueMutationResponse>;
patchReply(replyId: string, patch: ReplyBodyPatch): Promise<IssueMutationResponse>;
deleteIssue(issueId: string, expectedVersion: number): Promise<IssueMutationResponse>;
deleteReply(replyId: string, expectedVersion: number): Promise<IssueMutationResponse>;
listReviewers(): Promise<ReviewerSummary[]>;
issueEventUrl(publicId: string): string;
```

The reducer owns collection/revisions/filter/selection/draft/pending/conflict/error/reconnecting state. Viewer reducer remains unchanged.

- [ ] **Step 5: Implement synchronization hook**

Use native `EventSource` and one AbortController per collection GET. `publicVersionId === null` is an idle/reset controller and must create no GET/EventSource; App passes null for hidden or identity-error modes rather than calling hooks conditionally. A successful mutation records its revision as observed and waits for canonical GET; it never advances `appliedRevision` or patches the collection directly. Key every callback by a generation token/public ID. Close EventSource and abort GET on key change/unmount.

Export one stable controller contract so the panel and App do not reach into reducer internals:

```ts
export interface IssueActor { id: number; username: string; role: "viewer" | "member" | "admin" }
export interface IssueCommands {
  createIssue(input: CreateIssueInput): Promise<void>;
  createReply(issueId: string, input: CreateReplyInput): Promise<void>;
  patchIssue(issueId: string, patch: IssuePatch): Promise<void>;
  patchReply(replyId: string, patch: ReplyBodyPatch): Promise<void>;
  deleteIssue(issueId: string, expectedVersion: number): Promise<void>;
  deleteReply(replyId: string, expectedVersion: number): Promise<void>;
}
export interface IssueUiActions {
  setFilter(filter: IssueFilter): void;
  selectIssue(issueId: string | null): void;
  startDraft(anchor: IssueAnchor): void;
  updateDraft(patch: IssueDraftPatch): void;
  cancelDraft(): void;
  setPlacement(active: boolean): void;
}
export interface IssueController {
  state: IssueState;
  commands: IssueCommands;
  ui: IssueUiActions;
  retryCollection(): void;
  resetNotice(): void;
}
```

`startDraft(anchor)` generates one UUID-v4 request ID and reducer state retains it until `cancelDraft` or successful canonical admission. App’s map/map-center placement callback is its only caller and invokes it exactly once after capture; Composer only calls `updateDraft`. If create returns `400 invalid_anchor` with `details` identifying `featureId`, clear only `draft.anchor.featureId`, preserve floor/coordinate/body/assignee/due/requestId, and expose a resubmit notice; never dispatch venue failure. Every filter, selection, draft field, placement mode, retry, and notice transition is reachable only through this controller surface; tests call these actions rather than dispatching reducer internals.

- [ ] **Step 6: Verify hook races and cleanup**

Use a fake EventSource and controlled Promises to prove null-disable, initial GET, immediate revision, burst coalescing, reconnect mismatch, old-version response ignore, network/stale indicators, mutation interleaving, and cleanup.

Run:

```bash
pnpm exec vitest run src/issues/api.test.ts src/issues/issueReducer.test.ts src/issues/useIssueSync.test.tsx
pnpm typecheck
```

Expected: PASS with deterministic no-timeout tests.

- [ ] **Step 7: Commit**

```bash
git add src/issues
git commit -m "feat(web): synchronize canonical review issues"
```

---

### Task 10: Safe Markdown, dates, and Issues panel

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/issues/MarkdownBody.tsx`
- Create: `src/issues/MarkdownBody.test.tsx`
- Create: `src/issues/issueDates.ts`
- Create: `src/issues/issueDates.test.ts`
- Create: `src/issues/IssueQueue.tsx`
- Create: `src/issues/IssueDetail.tsx`
- Create: `src/issues/IssueComposer.tsx`
- Create: `src/issues/IssuesPanel.tsx`
- Create: `src/issues/IssuesPanel.test.tsx`

**Interfaces:**
- Consumes: Task 9 controller/types; existing `FloatingPanel`, chips, buttons, locale pattern.
- Produces: safe Markdown boundary; date-only formatting/classification; queue/detail/composer panel with role-controlled actions and focus callbacks.

- [ ] **Step 1: Install pinned Markdown dependencies**

```bash
pnpm add --save-exact react-markdown@10.1.0 remark-breaks@4.0.0
```

Do not add `rehype-raw`, an HTML sanitizer, a date library, an SSE library, or a state library.

- [ ] **Step 2: Write failing Markdown/date tests**

Assert allowed paragraphs/breaks/emphasis/strong/lists/links/inline code; raw HTML rendered as text or omitted; no images/headings/tables/media; javascript/data/relative links disabled; safe external attributes. Mirror server normalization/scalar/control boundaries. Test due-date classification exactly: before local today is overdue, today through three local calendar days ahead is due soon, and day four is neither; never call `new Date("YYYY-MM-DD")`.

- [ ] **Step 3: Implement the only Markdown rendering boundary**

Use `react-markdown`, `remarkBreaks`, and exact allowed elements:

```tsx
<ReactMarkdown
  remarkPlugins={[remarkBreaks]}
  allowedElements={["p", "br", "em", "strong", "ol", "ul", "li", "a", "code"]}
  skipHtml
  urlTransform={safeIssueUrl}
  components={{
    a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  }}
>
  {body}
</ReactMarkdown>
```

Return no href for protocols outside `http:`, `https:`, and `mailto:`.

- [ ] **Step 4: Write failing panel tests**

Test Active/Assigned to me/Unassigned/Closed filters, all-floor active badge derivation, deterministic first-nonempty-line summaries with whitespace collapse and exact 80/81-scalar ellipsis boundaries, role matrix controls, self-assignment transitions, assignee/due/status, root/reply tombstones with reply edit/delete controls retained, closed replies, retry/error/conflict states, bundle-identity-disabled and auth-lookup-error states, placement capture/manual feature removal, automatic stale-feature `invalid_anchor` removal with draft/request-ID preservation and resubmit notice, character count, and focus callback behavior.

- [ ] **Step 5: Implement focused panel components**

Use this top-level contract:

```ts
export interface IssuesPanelProps {
  locale: LocaleCode;
  controller: IssueController;
  currentUser: IssueActor | null;
  reviewers: ReviewerSummary[];
  identityError: boolean;
  authError: boolean;
  onRetryAuth(): void;
  onRequestSignIn(): void;
  onBeginPlacement(): void;
  onCancelPlacement(): void;
}
```

`IssueQueue` filters but never mutates canonical collection. It derives summary from the first non-empty normalized Markdown source line, collapses whitespace, keeps the first 80 Unicode scalar values, and appends `…` iff it is longer; deleted roots use localized **Comment deleted**. `IssueDetail` enforces convenience visibility while server remains authoritative. `IssueComposer` mounts after App calls `controller.ui.startDraft(anchor)` from the successful placement callback, routes field changes through `updateDraft`, and never generates or replaces the controller-owned request ID. Assignment/deadline never block create. Every string has ja/en copy.

- [ ] **Step 6: Run focused UI helpers**

Run:

```bash
pnpm exec vitest run src/issues/MarkdownBody.test.tsx src/issues/issueDates.test.ts src/issues/IssuesPanel.test.tsx
pnpm typecheck
```

Expected: PASS; no unsafe DOM or UTC due-date conversion.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/issues
git commit -m "feat(web): add review issue panel and discussion"
```

---

### Task 11: Map issue pins, placement, and anchor camera

**Files:**
- Create: `src/map/useIssuePins.ts`
- Create: `src/map/useIssuePins.test.ts`
- Modify: `src/map/IndoorMap.tsx`
- Modify: `src/map/useFeatureMarkers.ts`
- Modify: `src/map/useFeatureMarkers.test.ts`
- Create: `src/map/IndoorMap.test.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: canonical filtered root issues and active floor; MapLibre map; current feature-marker centers.
- Produces: DOM issue pin overlay; placement payload; race-safe anchor-camera request; separate issue feature highlight.

- [ ] **Step 1: Write failing pin and IndoorMap interaction tests**

Cover current-floor/filter projection, closed hiding/default, stable pin order, accessible label, selected ARIA state, click propagation, keyboard activation, move/zoom reposition, cleanup, and independence from Labels visibility.

In `IndoorMap.test.tsx`, use the existing controlled MapLibre mock boundary to prove canvas versus feature-marker placement, ordinary selection suppression only while placing, keyboard “Place at map center,” cross-floor selection before camera centering, source-ready gating, reduced-motion camera options, and no InspectorPanel selection from issue highlighting.

```ts
expect(projectPins(issues, "1f", "active").map((pin) => pin.pinNumber)).toEqual([1, 4]);
expect(button.getAttribute("aria-label")).toContain("Issue #1");
expect(button.getAttribute("aria-pressed")).toBe("true");
```

- [ ] **Step 2: Verify map RED**

Run:

```bash
pnpm exec vitest run src/map/useIssuePins.test.ts src/map/useFeatureMarkers.test.ts src/map/IndoorMap.test.tsx
```

Expected: FAIL because pin/placement APIs do not exist.

- [ ] **Step 3: Implement a separate DOM pin overlay**

```ts
export interface MapIssuePin {
  id: string;
  pinNumber: number;
  levelId: string;
  longitude: number;
  latitude: number;
  summary: string;
  status: IssueStatus;
}
```

Project/reposition on map move/zoom, deterministic pin-number order, stop propagation, and remove all DOM/listeners on dependency change/unmount. Do not modify venue GeoJSON, KVB, or the Labels toggle.

- [ ] **Step 4: Add explicit placement and camera contracts**

Extend `IndoorMapProps` with one explicit nullable feature boundary:

```ts
issueReview: {
  placementMode: boolean;
  onPlaceIssue(anchor: { levelId: string; longitude: number; latitude: number; featureId: string | null }): void;
  pins: MapIssuePin[];
  selectedIssueId: string | null;
  onSelectIssue(issueId: string): void;
  featureId: string | null;
  cameraRequest: { key: number; levelId: string; longitude: number; latitude: number } | null;
} | null;
```

Update the existing App callsite to pass `issueReview={null}` in this task; Task 12 replaces null with the live controller projection. This keeps Task 11 typecheck-clean without no-op callbacks or optional transitional props.

Canvas click in placement mode queries current clickable layers, captures `event.lngLat`, and does not run ordinary feature selection. A feature-marker click in placement mode captures that marker center plus feature ID. Outside placement, existing selection remains behaviorally unchanged.

- [ ] **Step 5: Make row navigation and keyboard placement race-safe**

When `anchorCameraRequest.levelId` differs, dispatch/select the floor first; center only after the floor-source effect has applied. Respect reduced motion. Expose a keyboard-operable “Place at map center” callback/button contract so keyboard users can pan MapLibre then capture center without a pointer. Keep issue feature highlight separate from `viewerReducer.selectedFeatureId` so issue detail does not open InspectorPanel.

- [ ] **Step 6: Run map and existing viewer regressions**

Run:

```bash
pnpm exec vitest run src/map/useIssuePins.test.ts src/map/useFeatureMarkers.test.ts src/map/IndoorMap.test.tsx src/map/featureLayers.test.ts src/state/viewerReducer.test.ts
pnpm typecheck
```

Expected: PASS; direct placement/camera tests and existing feature-marker/inspector behavior remain green.

- [ ] **Step 7: Commit**

```bash
git add src/map src/app/App.tsx
git commit -m "feat(web): place and navigate map review pins"
```

---

### Task 12: App, rail, auth, responsive, and accessibility integration

**Files:**
- Modify: `src/components/IconRail.tsx`
- Modify: `src/components/icons.tsx`
- Modify: `src/components/components.test.tsx`
- Modify: `src/gallery/api.ts`
- Modify: `src/gallery/SignInModal.tsx`
- Modify: `src/gallery/signin.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/app.css`

**Interfaces:**
- Consumes: Tasks 8–11 provenance, controller, panel, and map contracts.
- Produces: end-to-end viewer Issues experience; draft-preserving sign-in; dataset-only lifecycle; responsive/focus-complete UI.

- [ ] **Step 1: Write failing rail/auth/App integration tests**

Add focused assertions for:

- Issues rail visibility only for normal bundle provenance; hidden in embed/local/source/drop.
- Missing identity shows issue-specific disabled panel and makes no issue request.
- Ready provenance calls `api.me()` once; signed-in identity then calls `listReviewers`, while a signed-out result remains public read-only.
- Auth/reviewer lookup failure leaves public issues usable, exposes a focused retry, and ignores a late result from an obsolete provenance generation.
- Badge counts active issues across every floor; badge caps at `99+`.
- Panel/filter/selected row/pin synchronization and floor/camera request.
- Placement map click and keyboard map-center placement.
- Optional feature attachment/removal, including a server-rejected stale feature clearing only `featureId` while preserving the draft/request ID for explicit resubmit.
- 401 opens dialog and preserves body/anchor/assignee/due/requestId; `invalid_anchor` recovery and every issue failure remain outside venue load errors.
- Sign-in success returns `ApiUser`, restores draft focus, and retries only on explicit submit.
- Successful local replacement closes SSE/clears issues; failed replacement retains the displayed prior issue session.
- Issue GET/SSE/mutation failures never render the viewer archive/bundle alert.
- Compact sheet exclusivity, focus entry/cancel restoration, ARIA state, and reduced motion.

- [ ] **Step 2: Verify integration RED**

Run:

```bash
pnpm exec vitest run src/components/components.test.tsx src/gallery/signin.test.tsx src/app/App.test.tsx
```

Expected: FAIL because App/rail/auth are not wired.

- [ ] **Step 3: Extend rail and sign-in surgically**

Add `issues` to `RailPanelId`, a localized Issues icon/label, caller-supplied visibility/count, and existing `aria-pressed`/badge behavior. Narrow `ApiUser.role` to the role union.

Extend `SignInModal` with optional `onCancel`, `onSignedIn(user)`, initial focus, `role="dialog"`, `aria-modal`, and focus restoration. Gallery’s mandatory sign-in remains valid when `onCancel` is absent.

- [ ] **Step 4: Initialize issue controller from successful provenance**

Availability rules:

```ts
const issueMode = params.embed
  ? { kind: "hidden" as const }
  : provenance === null
    ? { kind: "hidden" as const }
    : provenance.publicVersionId === null
      ? { kind: "identity_error" as const }
      : { kind: "ready" as const, publicVersionId: provenance.publicVersionId };
```

Initialize collection GET/EventSource only for `ready`. For ready provenance, generation-key `api.me()` and then `listReviewers()` when signed in; `null` means signed out, while non-401 auth/reviewer failures set panel-local `authError` without blocking public collection state. Do not derive from `params.dataset`. Close/reset issue collection state and ignore late auth/reviewer results on admitted provenance change. Keep all issue work outside `runLoad` and `toVenueLoadError`.

- [ ] **Step 5: Wire panel, map, auth, and lifecycle**

- Drive queue filters, selected issue, draft fields/request ID, placement mode, retry, and notices only through `IssueController.ui`/controller methods; panel and App never dispatch reducer events.
- Filter canonical roots into map pins by current filter and active floor, then replace Task 11’s `issueReview={null}` with the live pins/selection/placement/camera projection.
- Queue row selection uses `ui.selectIssue`, switches floor, then issues a keyed camera request.
- Placement minimizes the compact sheet; a valid map/feature or map-center capture calls `ui.startDraft(anchor)` exactly once, disables placement, then opens/focuses Composer. Composer field edits use `ui.updateDraft`; no draft exists before successful placement.
- Sign-in preserves draft/request ID in issue reducer; modal owns only credentials. `onSignedIn(user)` installs the returned actor, clears auth error, loads reviewers, restores draft focus, and retries a mutation only after the user explicitly submits it again.
- Close/reopen, assignment, deadline, reply, edit, and tombstone commands use server responses only as revision observations.
- A remotely deleted selected root returns to queue with a tombstone notice.

- [ ] **Step 6: Add token-only responsive styles**

Add Issues queue/detail/composer/status/due/pin/placement classes to `app.css`. Reuse existing tokens, `floating-panel--left`, list rows, chips, buttons, modal, safe-area, and compact `<900px` sheet. Include visible focus, textual overdue/due-soon, bounded thread scrolling, selected pin/row states, and no essential animation under `prefers-reduced-motion`.

- [ ] **Step 7: Run complete web verification**

Run:

```bash
pnpm exec vitest run src/bundle/loadKirikoBundle.test.ts src/issues src/map src/components/components.test.tsx src/gallery/signin.test.tsx src/app/App.test.tsx src/state/viewerReducer.test.ts
pnpm typecheck
pnpm build
```

Expected: all focused tests pass; production build succeeds; no issue requests in suppressed provenance tests.

- [ ] **Step 8: Commit**

```bash
git add src package.json pnpm-lock.yaml
git commit -m "feat(web): integrate version-pinned review issues"
```

---

### Task 13: Browser acceptance, architecture reconciliation, and CI gates

**Files:**
- Create: `e2e/issues.spec.ts`
- Modify: `e2e/helpers.ts`
- Modify: `e2e/embed.spec.ts`
- Modify: `e2e/viewer.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/superpowers/specs/2026-07-17-kiriko-platform-architecture-design.md`

**Interfaces:**
- Consumes: complete live Phase Three server/web behavior.
- Produces: Chromium/Firefox vertical acceptance; zero-request provenance proof; Node 24/26 native smoke; corrected architecture contract.

- [ ] **Step 1: Add deterministic live-stack helpers**

Extend `e2e/helpers.ts` with:

```ts
publishVenue(request, name, bytes?): Promise<{ venueId: number; slug: string; seq: number }>;
publishNextVersion(request, venueId, bytes?): Promise<{ seq: number }>;
openPublishedDataset(page, slug): Promise<{ publicVersionId: string }>;
collectIssueRequests(page): { requests: string[]; dispose(): void };
waitForIssueStream(page, publicVersionId): Promise<void>;
dropZip(page, bytes): Promise<void>;
waitForIssueStreamClose(page, publicVersionId): Promise<void>;
uniqueDatasetName(prefix, testInfo): string;
```

Poll jobs with a bounded deadline and surface server error JSON. Capture the exact bundle response header. Distinguish `/issues` GET from `/issues/events`. Do not use `networkidle` while EventSource is open.

- [ ] **Step 2: Write the signed-in workflow acceptance**

Create a unique venue, open its dataset in English, then place/create issue, assign `e2e`, set `2099-12-31`, reply, move open → in review → closed, filter Closed, and reopen. Assert accessible row/pin/detail/status/assignee/due/reply text; clean up the venue in `finally`.

- [ ] **Step 3: Write the two-context synchronization acceptance**

Use the existing authenticated `page` as author and a manually created anonymous context as observer:

```ts
const observerContext = await browser.newContext({ baseURL });
try {
  const observer = await observerContext.newPage();
  // Load both, establish observer GET + SSE baseline, mutate in author,
  // then require a later observer canonical GET and visible UI update.
} finally {
  await observerContext.close();
}
```

Install waits before mutation. Prove the observer performs a post-SSE canonical GET rather than receiving a body delta.

- [ ] **Step 4: Write version and deletion/recreation isolation acceptance**

Create an issue on version 1, publish version 2, and assert distinct response IDs plus empty latest collection while the old open page retains history. Then keep an old page open, delete venue, recreate same slug/sequence, and assert:

- replacement `Kiriko-Version-Id` differs even for byte-identical KVB;
- replacement collection is empty;
- old public-ID collection GET is `404 not_found`;
- old opaque issue mutation is `404 not_found`;
- old public-ID SSE response closes, its reconnect receives `404 not_found`, and its capacity is released before replacement mutation;
- original map remains rendered.

- [ ] **Step 5: Prove issue-free provenance**

Add zero issue-request assertions for:

- dataset `?embed=1`;
- explicit-source with/without embed;
- hidden-input local ZIP;
- genuine DataTransfer drop ZIP;
- local replacement of an already loaded dataset.

Track `/api/review/`, `/api/reviewers`, `/api/issues/`, and `/api/replies/` before navigation/drop.

- [ ] **Step 6: Run focused browser acceptance**

Run:

```bash
pnpm exec playwright test e2e/issues.spec.ts --project=chromium --workers=1
pnpm exec playwright test e2e/issues.spec.ts --project=firefox --workers=1
pnpm exec playwright test e2e/issues.spec.ts e2e/embed.spec.ts e2e/viewer.spec.ts --project=chromium --workers=1
pnpm exec playwright test e2e/issues.spec.ts e2e/embed.spec.ts e2e/viewer.spec.ts --project=firefox --workers=1
```

Expected: all pass against the real preview/Fastify/SQLite/native stack.

- [ ] **Step 7: Reconcile architecture and CI after behavior passes**

Update the architecture spec to record permanent public version identity/header, dynamic `/api/review` routes, `comment_state/comments`, native anchor inspection, immutable KVB separation, exact REST/SSE model, Issues terminology, and two-context/version-recreation acceptance. Remove obsolete generic numeric venue comment routes; leave unrelated roadmap sections unchanged.

In both Node 24 and Node 26 native-addon smoke commands, require both exports:

```js
const core = require('./core/crates/kiriko-node');
if (typeof core.compileImdf !== 'function' || typeof core.inspectBundle !== 'function') process.exit(1);
```

Do not add a duplicate issue-only CI job; existing acceptance already runs Chromium and Firefox.

- [ ] **Step 8: Run final Phase Three gates**

Run fresh, complete commands:

```bash
source "$HOME/.cargo/env"
cargo fmt --manifest-path core/Cargo.toml --all -- --check
cargo clippy --manifest-path core/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path core/Cargo.toml --workspace
pnpm core:build
pnpm --filter kiriko-server typecheck
pnpm test:server
pnpm typecheck
pnpm exec vitest run
pnpm build
pnpm exec playwright test --project=chromium
pnpm exec playwright test --project=firefox
npx -y node@24 -e "const n=require('./core/crates/kiriko-node'); if(typeof n.compileImdf!=='function'||typeof n.inspectBundle!=='function') process.exit(1)"
npx -y node@26 -e "const n=require('./core/crates/kiriko-node'); if(typeof n.compileImdf!=='function'||typeof n.inspectBundle!=='function') process.exit(1)"
sha256sum -c tests/fixtures/minimal.kvb.sha256
```

Expected: every command exits 0; no generated bindings are staged; golden KVB checksum is unchanged.

- [ ] **Step 9: Commit final acceptance**

```bash
git add e2e .github/workflows/ci.yml docs/superpowers/specs/2026-07-17-kiriko-platform-architecture-design.md
git commit -m "test: accept Phase Three review issues end to end"
```

## Final acceptance evidence

Record exact counts and commands in the final implementation report:

- Rust workspace tests, fmt, clippy, golden checksum.
- Server focused issue tests, full server suite, and typecheck.
- Web focused issue/map/App tests, full Vitest suite, typecheck, and production build.
- Chromium and Firefox Playwright results, including configured skips.
- Node 24 and 26 native addon loads.
- Confirmation that `?embed=1`, `?src=`, hidden-input ZIP, and dropped ZIP produce zero issue requests.
- Confirmation that delete/recreate cannot reuse public issue identity.
- Confirmation that no generated napi/WASM artifacts are committed.
