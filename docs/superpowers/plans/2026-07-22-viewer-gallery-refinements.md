# Viewer & Gallery Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four independent viewer/gallery refinements — hide `venue`/`level` polygons until selected, add routing/point data to an existing dataset, a two-pane issue-comments view, and re-openable GDB layer mapping.

**Architecture:** Changes 2 & 4 share a persistence groundwork: each GDB version becomes self-describing for reprocessing (raw GDB blob + plan + extracted bundle-input blob refs stored on the `versions` row). "Add routing/facilities" reuses the latest published version's compiled IMDF; "Edit mapping" re-inspects the retained raw GDB and republishes with an edited plan. Both preserve prior routing/facilities via an "omitted inherits" rule. Changes 1 & 3 are client-only (map layer filters; issue-panel CSS/layout).

**Tech Stack:** Fastify + better-sqlite3 (server), gdal3.js (fake in tests), React 19 + MapLibre (client), vitest, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-07-22-viewer-gallery-refinements-design.md`.

## Global Constraints

- Strict TypeScript, no `any`. Match existing patterns.
- Every user-facing string is bilingual (`{ ja, en }`), both provided.
- Bundles are immutable — every reprocess creates a **new version** (never mutate a published one).
- No Rust/`@kiriko/*` changes; server tests use the fake GDAL/compile harness in `server/test/gdbFacilities.test.ts` (`makeTestApp`, `fake`, `PUBLISH_PLAN`, `JUNCTIONS_GEOJSON`, `PATHS_GEOJSON`, `FACILITIES_GEOJSON`).
- New `WarningCode`s: none introduced.
- Commit after each task with a Conventional Commit message.

---

## Phase 1 — Persistence groundwork (server)

### Task 1: Persist reprocess inputs on GDB publish

**Files:**
- Create: `server/src/db/migrations/003_gdb_reprocess.sql`
- Modify: `server/src/gdb/routes.ts` (publish handler version insert, ~lines 527-542)
- Test: `server/test/gdbFacilities.test.ts` (append a describe)

**Interfaces:**
- Produces: `versions` gains nullable columns `gdb_source_blob_hash TEXT`, `gdb_plan_json TEXT`, `net_junctions_blob_hash TEXT`, `net_paths_blob_hash TEXT`, `facilities_blob_hash TEXT`, populated by publish. Later tasks read these.

- [ ] **Step 1: Write the migration**

`server/src/db/migrations/003_gdb_reprocess.sql`:
```sql
-- Make GDB versions self-describing for reprocessing (add routing/facilities;
-- re-open & edit layer mapping). All nullable; older/IMDF versions leave them NULL.
ALTER TABLE versions ADD COLUMN gdb_source_blob_hash TEXT;
ALTER TABLE versions ADD COLUMN gdb_plan_json TEXT;
ALTER TABLE versions ADD COLUMN net_junctions_blob_hash TEXT;
ALTER TABLE versions ADD COLUMN net_paths_blob_hash TEXT;
ALTER TABLE versions ADD COLUMN facilities_blob_hash TEXT;
```

- [ ] **Step 2: Write the failing test**

Append to `server/test/gdbFacilities.test.ts`:
```ts
describe("GDB publish persists reprocess inputs", () => {
  it("stores raw GDB blob, plan, and bundle-input refs on the version row", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venueId = await createVenue(app, cookie);
    const blobHash = putBlob(app, await validGdbZipBytes("venue.gdb"));
    const networkBlobHash = putBlob(app, await validGdbZipBytes("net.gdb"));
    const facilitiesBlobHash = putBlob(app, await validGdbZipBytes("facilities.gdb"));

    const response = await app.inject({
      method: "POST",
      url: "/api/gdb/publish",
      headers: { cookie },
      payload: { venueId, blobHash, networkBlobHash, facilitiesBlobHash, plan: PUBLISH_PLAN },
    });
    expect(response.statusCode, response.body).toBe(202);
    const { versionId } = response.json() as { versionId: number };
    await app.queue.idle();

    const row = app.db
      .prepare(
        "SELECT gdb_source_blob_hash AS g, gdb_plan_json AS p, net_junctions_blob_hash AS j, net_paths_blob_hash AS t, facilities_blob_hash AS f FROM versions WHERE id = ?",
      )
      .get(versionId) as { g: string; p: string; j: string; t: string; f: string };
    expect(row.g).toBe(blobHash);
    expect(JSON.parse(row.p).layers.length).toBeGreaterThan(0);
    expect(row.j).toMatch(/^[0-9a-f]{64}$/);
    expect(row.t).toMatch(/^[0-9a-f]{64}$/);
    expect(row.f).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && pnpm exec vitest run gdbFacilities -t "persists reprocess inputs"`
Expected: FAIL — columns don't exist / values NULL.

- [ ] **Step 4: Implement — persist on insert**

In `server/src/gdb/routes.ts`, replace the version INSERT (currently lines ~531-535) so it also writes the five columns. `plan` here is the request plan; normalize it the same way conversion does (import `normalizeGdbPlan` from `./mapping` if not already imported):
```ts
const info = db
  .prepare(
    `INSERT INTO versions
       (venue_id, seq, public_id, source_blob_hash, source_kind,
        gdb_source_blob_hash, gdb_plan_json,
        net_junctions_blob_hash, net_paths_blob_hash, facilities_blob_hash)
     VALUES (?, ?, ?, ?, 'gdb', ?, ?, ?, ?, ?)`,
  )
  .run(
    venueId,
    nextSeq,
    newPublicVersionId(),
    imdfHash,
    blobHash,
    JSON.stringify(normalizeGdbPlan(plan)),
    networkJunctionsHash ?? null,
    networkPathsHash ?? null,
    facilitiesGeoJsonHash ?? null,
  );
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && pnpm exec vitest run gdbFacilities -t "persists reprocess inputs"`
Expected: PASS. Then full file: `cd server && pnpm exec vitest run gdbFacilities` — Expected: all PASS (existing publish tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add server/src/db/migrations/003_gdb_reprocess.sql server/src/gdb/routes.ts server/test/gdbFacilities.test.ts
git commit -m "feat(server): persist raw GDB, plan, and bundle-input refs on gdb versions"
```

### Task 2: Bundle-input resolution — omitted inherits prior version

**Files:**
- Modify: `server/src/gdb/routes.ts` (publish handler: after computing `networkJunctionsHash`/`networkPathsHash`/`facilitiesGeoJsonHash`, before the version insert)
- Test: `server/test/gdbFacilities.test.ts`

**Interfaces:**
- Produces: publish resolves each bundle input as **supplied-overrides / omitted-inherits-latest-published**. Task 3 (augment) and Task 6 (edit) rely on this so reprocessing never silently drops routing/facilities.

- [ ] **Step 1: Write the failing test**

```ts
describe("GDB publish inherits prior bundle inputs when omitted", () => {
  it("a re-publish without network reuses the prior published version's routing", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venueId = await createVenue(app, cookie);
    const blobHash = putBlob(app, await validGdbZipBytes("venue.gdb"));
    const networkBlobHash = putBlob(app, await validGdbZipBytes("net.gdb"));

    // v1: venue + routing.
    const first = await app.inject({
      method: "POST", url: "/api/gdb/publish", headers: { cookie },
      payload: { venueId, blobHash, networkBlobHash, plan: PUBLISH_PLAN },
    });
    expect(first.statusCode, first.body).toBe(202);
    await app.queue.idle();
    const v1 = (first.json() as { versionId: number }).versionId;
    const v1Refs = app.db
      .prepare("SELECT net_junctions_blob_hash AS j, net_paths_blob_hash AS t FROM versions WHERE id = ?")
      .get(v1) as { j: string; t: string };

    // v2: venue only (no network) → inherits v1 routing.
    fake.compileCalls.length = 0;
    const second = await app.inject({
      method: "POST", url: "/api/gdb/publish", headers: { cookie },
      payload: { venueId, blobHash, plan: PUBLISH_PLAN },
    });
    expect(second.statusCode, second.body).toBe(202);
    await app.queue.idle();
    const v2 = (second.json() as { versionId: number }).versionId;

    const v2Refs = app.db
      .prepare("SELECT net_junctions_blob_hash AS j, net_paths_blob_hash AS t FROM versions WHERE id = ?")
      .get(v2) as { j: string; t: string };
    expect(v2Refs.j).toBe(v1Refs.j);
    expect(v2Refs.t).toBe(v1Refs.t);
    // The compile actually received the inherited routing GeoJSON.
    expect(fake.compileCalls[0]!.metadata["networkJunctionsGeoJson"]).toBe(JUNCTIONS_GEOJSON);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm exec vitest run gdbFacilities -t "inherits prior bundle inputs"`
Expected: FAIL — v2 refs are NULL (no inheritance yet).

- [ ] **Step 3: Implement the resolution**

In `server/src/gdb/routes.ts` publish handler, after the network/facilities extraction blocks (they set `networkJunctionsHash`/`networkPathsHash`/`facilitiesGeoJsonHash` when supplied) and before the version insert, add inheritance from the latest published version when a group was omitted:
```ts
// Reprocess rule: supplied inputs override; omitted inputs inherit the
// venue's latest published version so re-publishing never silently drops
// routing/facilities. New venues have no prior → inherit nothing.
const prior = db
  .prepare(
    `SELECT net_junctions_blob_hash AS j, net_paths_blob_hash AS t, facilities_blob_hash AS f
       FROM versions WHERE venue_id = ? AND status = 'published' ORDER BY seq DESC LIMIT 1`,
  )
  .get(venueId) as { j: string | null; t: string | null; f: string | null } | undefined;
if (networkBlobHash === undefined && prior) {
  networkJunctionsHash = prior.j ?? undefined;
  networkPathsHash = prior.t ?? undefined;
}
if (facilitiesBlobHash === undefined && prior) {
  facilitiesGeoJsonHash = prior.f ?? undefined;
}
```
(Then the existing job enqueue + Task-1 version insert both see the resolved hashes.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm exec vitest run gdbFacilities -t "inherits prior bundle inputs"` — Expected: PASS.
Then `cd server && pnpm exec vitest run gdbFacilities` — Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/gdb/routes.ts server/test/gdbFacilities.test.ts
git commit -m "feat(server): gdb publish inherits prior version routing/facilities when omitted"
```

---

## Phase 2 — Change 2: Add routing / facilities (server + client)

### Task 3: `POST /api/gdb/augment` endpoint

**Files:**
- Modify: `server/src/gdb/routes.ts` (new route; factor the network/facilities extraction into a shared helper reused by publish + augment)
- Test: `server/test/gdbFacilities.test.ts`

**Interfaces:**
- Produces: `POST /api/gdb/augment` body `{ venueId: number, networkBlobHash?: string, facilitiesBlobHash?: string }` → `202 { jobId, versionId, seq }`; `400 { error: "no_augment_data" }`; `404 { error: "no_base_version" | "not_found" | "network_blob_not_found" | "facilities_blob_not_found" }`. Client `api.augmentGdb` (Task 4) calls it.

- [ ] **Step 1: Write the failing tests**

```ts
describe("POST /api/gdb/augment", () => {
  async function publishBase(app: Awaited<ReturnType<typeof makeTestApp>>["app"], cookie: string) {
    const venueId = await createVenue(app, cookie);
    const blobHash = putBlob(app, await validGdbZipBytes("venue.gdb"));
    const r = await app.inject({
      method: "POST", url: "/api/gdb/publish", headers: { cookie },
      payload: { venueId, blobHash, plan: PUBLISH_PLAN },
    });
    expect(r.statusCode, r.body).toBe(202);
    await app.queue.idle();
    return { venueId, baseImdf: (app.db.prepare("SELECT source_blob_hash AS s FROM versions WHERE id = ?").get((r.json() as { versionId: number }).versionId) as { s: string }).s };
  }

  it("adds routing to an existing dataset as a new version reusing the base IMDF", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const { venueId, baseImdf } = await publishBase(app, cookie);
    const networkBlobHash = putBlob(app, await validGdbZipBytes("net.gdb"));
    fake.compileCalls.length = 0;

    const res = await app.inject({
      method: "POST", url: "/api/gdb/augment", headers: { cookie },
      payload: { venueId, networkBlobHash },
    });
    expect(res.statusCode, res.body).toBe(202);
    const { versionId, seq } = res.json() as { versionId: number; seq: number };
    expect(seq).toBe(2);
    await app.queue.idle();

    const row = app.db
      .prepare("SELECT source_blob_hash AS s, net_junctions_blob_hash AS j FROM versions WHERE id = ?")
      .get(versionId) as { s: string; j: string };
    expect(row.s).toBe(baseImdf); // geometry reused, no reconversion
    expect(row.j).toMatch(/^[0-9a-f]{64}$/);
    expect(fake.compileCalls[0]!.metadata["networkJunctionsGeoJson"]).toBe(JUNCTIONS_GEOJSON);
  });

  it("carries forward prior facilities when only routing is added", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venueId = await createVenue(app, cookie);
    const blobHash = putBlob(app, await validGdbZipBytes("venue.gdb"));
    const facilitiesBlobHash = putBlob(app, await validGdbZipBytes("facilities.gdb"));
    await app.inject({ method: "POST", url: "/api/gdb/publish", headers: { cookie }, payload: { venueId, blobHash, facilitiesBlobHash, plan: PUBLISH_PLAN } });
    await app.queue.idle();
    const networkBlobHash = putBlob(app, await validGdbZipBytes("net.gdb"));
    fake.compileCalls.length = 0;

    const res = await app.inject({ method: "POST", url: "/api/gdb/augment", headers: { cookie }, payload: { venueId, networkBlobHash } });
    expect(res.statusCode, res.body).toBe(202);
    await app.queue.idle();
    expect(fake.compileCalls[0]!.metadata["facilitiesGeoJson"]).toBe(FACILITIES_GEOJSON);
    expect(fake.compileCalls[0]!.metadata["networkJunctionsGeoJson"]).toBe(JUNCTIONS_GEOJSON);
  });

  it("400 when neither network nor facilities is provided", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const { venueId } = await publishBase(app, cookie);
    const res = await app.inject({ method: "POST", url: "/api/gdb/augment", headers: { cookie }, payload: { venueId } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "no_augment_data" });
  });

  it("404 when the venue has no published base version", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venueId = await createVenue(app, cookie);
    const networkBlobHash = putBlob(app, await validGdbZipBytes("net.gdb"));
    const res = await app.inject({ method: "POST", url: "/api/gdb/augment", headers: { cookie }, payload: { venueId, networkBlobHash } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "no_base_version" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && pnpm exec vitest run gdbFacilities -t "augment"`
Expected: FAIL — route 404s (unregistered) / not matched.

- [ ] **Step 3: Factor the extraction helper**

In `server/src/gdb/routes.ts`, extract the two extraction blocks currently inline in publish into module-scope helpers so augment reuses them (signatures — keep bodies identical to the existing inline logic, returning the stored blob hashes or throwing the same `GdbSourceError`/error bodies):
```ts
// Returns { junctionsHash, pathsHash } after extracting + storing GeoJSON blobs; throws on bad archive.
async function extractAndStoreNetwork(server: FastifyInstance, networkBlobHash: string): Promise<{ junctionsHash: string; pathsHash: string }> { /* moved from publish */ }
// Returns the stored facilities GeoJSON blob hash; throws on bad archive.
async function extractAndStoreFacilities(server: FastifyInstance, facilitiesBlobHash: string): Promise<string> { /* moved from publish */ }
```
Update the publish handler to call these (behavior unchanged). Run `cd server && pnpm exec vitest run gdbFacilities` to confirm publish still green before adding the route.

- [ ] **Step 4: Register the augment route**

Add inside `registerGdbRoutes` (mirror the publish handler's schema/preHandler style):
```ts
app.post(
  "/api/gdb/augment",
  {
    preHandler: requireSession,
    schema: {
      body: Type.Object({
        venueId: Type.Integer({ minimum: 1 }),
        networkBlobHash: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
        facilitiesBlobHash: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
      }),
      response: {
        202: Type.Object({ jobId: Type.String(), versionId: Type.Number(), seq: Type.Number() }),
        400: ErrorSchema,
        404: Type.Object({ error: Type.String() }),
      },
    },
  },
  async (request, reply) => {
    const { venueId, networkBlobHash, facilitiesBlobHash } =
      request.body as { venueId: number; networkBlobHash?: string; facilitiesBlobHash?: string };
    const db = request.server.db;
    const venue = db.prepare("SELECT id FROM venues WHERE id = ? AND tenant_id = ?").get(venueId, TENANT_ID);
    if (!venue) return reply.code(404).send({ error: "not_found" });
    if (networkBlobHash === undefined && facilitiesBlobHash === undefined) {
      return reply.code(400).send(errorBody("no_augment_data", "no_augment_data"));
    }
    if (networkBlobHash !== undefined && !request.server.blobs.has(networkBlobHash)) {
      return reply.code(404).send({ error: "network_blob_not_found" });
    }
    if (facilitiesBlobHash !== undefined && !request.server.blobs.has(facilitiesBlobHash)) {
      return reply.code(404).send({ error: "facilities_blob_not_found" });
    }
    const base = db
      .prepare(
        `SELECT source_blob_hash AS s, source_kind AS k, gdb_source_blob_hash AS g, gdb_plan_json AS p,
                net_junctions_blob_hash AS j, net_paths_blob_hash AS t, facilities_blob_hash AS f
           FROM versions WHERE venue_id = ? AND status = 'published' ORDER BY seq DESC LIMIT 1`,
      )
      .get(venueId) as
      | { s: string; k: string; g: string | null; p: string | null; j: string | null; t: string | null; f: string | null }
      | undefined;
    if (!base) return reply.code(404).send({ error: "no_base_version" });

    let networkJunctionsHash = base.j ?? undefined;
    let networkPathsHash = base.t ?? undefined;
    if (networkBlobHash !== undefined) {
      try {
        const r = await extractAndStoreNetwork(request.server, networkBlobHash);
        networkJunctionsHash = r.junctionsHash;
        networkPathsHash = r.pathsHash;
      } catch (error) {
        if (isGdbSourceError(error)) return reply.code(400).send(errorBody(error.code, error.message, error.details));
        request.log.error({ err: error }, "gdb augment network extract failed");
        return reply.code(400).send(errorBody("gdb_network_extraction_failed", "gdb_network_extraction_failed", { detail: error instanceof Error ? error.message : String(error) }));
      }
    }
    let facilitiesGeoJsonHash = base.f ?? undefined;
    if (facilitiesBlobHash !== undefined) {
      try {
        facilitiesGeoJsonHash = await extractAndStoreFacilities(request.server, facilitiesBlobHash);
      } catch (error) {
        if (isGdbSourceError(error)) return reply.code(400).send(errorBody(error.code, error.message, error.details));
        request.log.error({ err: error }, "gdb augment facilities extract failed");
        return reply.code(400).send(errorBody("gdb_facilities_extraction_failed", "gdb_facilities_extraction_failed", { detail: error instanceof Error ? error.message : String(error) }));
      }
    }

    const nextSeq = ((db.prepare("SELECT MAX(seq) AS m FROM versions WHERE venue_id = ?").get(venueId) as { m: number | null }).m ?? 0) + 1;
    const info = db
      .prepare(
        `INSERT INTO versions
           (venue_id, seq, public_id, source_blob_hash, source_kind,
            gdb_source_blob_hash, gdb_plan_json,
            net_junctions_blob_hash, net_paths_blob_hash, facilities_blob_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(venueId, nextSeq, newPublicVersionId(), base.s, base.k, base.g, base.p,
           networkJunctionsHash ?? null, networkPathsHash ?? null, facilitiesGeoJsonHash ?? null);
    const versionId = Number(info.lastInsertRowid);
    const jobId = request.server.queue.enqueue("publish_imdf", { versionId, networkJunctionsHash, networkPathsHash, facilitiesGeoJsonHash });
    return reply.code(202).send({ jobId, versionId, seq: nextSeq });
  },
);
```
Add `no_augment_data` to any error-copy allowlists if the client maps it (Task 4 copy).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && pnpm exec vitest run gdbFacilities -t "augment"` — Expected: all 4 PASS.
Then `cd server && pnpm exec vitest run gdbFacilities` — Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/gdb/routes.ts server/test/gdbFacilities.test.ts
git commit -m "feat(server): POST /api/gdb/augment adds routing/facilities to an existing dataset"
```

### Task 4: Client — Add routing/facilities action + dialog + flow

**Files:**
- Modify: `src/gallery/api.ts` (add `augmentGdb`)
- Create: `src/gallery/AddDataDialog.tsx`
- Create: `src/gallery/AddDataDialog.test.tsx`
- Modify: `src/gallery/DatasetCard.tsx` (`onAddData?` + button)
- Modify: `src/gallery/DatasetCard.test.tsx` (or `gallery.test.tsx`)
- Modify: `src/gallery/GalleryPage.tsx` (AddData flow)
- Test: `src/gallery/gallery.test.tsx`

**Interfaces:**
- Consumes: `POST /api/gdb/augment` (Task 3); `api.inspectGdbNetwork`, `api.inspectGdbFacilities`, `api.waitForJob` (existing).
- Produces: `api.augmentGdb(venueId: number, opts: { networkBlobHash?: string; facilitiesBlobHash?: string }): Promise<{ jobId: string; versionId: number; seq: number }>`.

- [ ] **Step 1: Write the failing api test**

In `src/gallery/api.test.ts`:
```ts
it("augmentGdb posts venueId + blob hashes and returns the accepted job", async () => {
  fetchMock.mockResolvedValueOnce(okJson({ jobId: "j1", versionId: 2, seq: 2 }));
  const out = await api.augmentGdb(7, { networkBlobHash: "n".repeat(64) });
  expect(out).toEqual({ jobId: "j1", versionId: 2, seq: 2 });
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("/api/gdb/augment");
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({ venueId: 7, networkBlobHash: "n".repeat(64) });
});
```
(Use the same `fetchMock`/`okJson` helpers the existing `api.test.ts` uses; check the top of that file for their names and mirror them.)

- [ ] **Step 2: Run it — Expected FAIL** (`augmentGdb` undefined)

Run: `pnpm exec vitest run src/gallery/api.test.ts -t augmentGdb`

- [ ] **Step 3: Implement `augmentGdb`**

In `src/gallery/api.ts`, add to the `api` object:
```ts
async augmentGdb(
  venueId: number,
  opts: { networkBlobHash?: string; facilitiesBlobHash?: string },
): Promise<{ jobId: string; versionId: number; seq: number }> {
  const res = await fetch("/api/gdb/augment", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      venueId,
      ...(opts.networkBlobHash ? { networkBlobHash: opts.networkBlobHash } : {}),
      ...(opts.facilitiesBlobHash ? { facilitiesBlobHash: opts.facilitiesBlobHash } : {}),
    }),
  });
  if (!res.ok) {
    let parsed: GdbError = { code: "gdb_conversion_failed", message: `${res.status}` };
    try { parsed = (await res.json()) as GdbError; } catch { /* non-JSON */ }
    throw parsed;
  }
  return (await res.json()) as { jobId: string; versionId: number; seq: number };
},
```

- [ ] **Step 4: Run it — Expected PASS**

- [ ] **Step 5: Build `AddDataDialog` + test**

`src/gallery/AddDataDialog.tsx` — a focused dialog with two file pickers (network, facilities), showing the inspect summaries and enabling Import when ≥1 is attached. Reuse the summary copy from `GdbImportDialog` (`Routing network: N nodes…`, `Facilities: N places…`). Props:
```ts
export interface AddDataDialogProps {
  locale: LocaleCode;
  venueName: string;
  network: NetworkInspectResponse | null;
  facilities: FacilitiesInspectResponse | null;
  busy: boolean;
  error: GdbError | null;
  onAddNetwork: (file: File) => void;
  onAddFacilities: (file: File) => void;
  onImport: () => void;
  onCancel: () => void;
}
```
Render a `role="dialog"` with `aria-label` = title (en `Add routing / facilities`, ja `経路・地点データを追加`), the two `<label>`-wrapped file inputs (mirror `GdbImportDialog` lines ~711-745), summary lines when `network`/`facilities` present, an Import button disabled while `busy` or when both are null, and a Cancel button. `AddDataDialog.test.tsx`: renders dialog; uploading a network file calls `onAddNetwork`; Import disabled with nothing attached, enabled after a summary is present; Import calls `onImport`.

- [ ] **Step 6: Run the dialog test — iterate to PASS**

Run: `pnpm exec vitest run src/gallery/AddDataDialog.test.tsx`

- [ ] **Step 7: DatasetCard action + test**

In `src/gallery/DatasetCard.tsx`: add `onAddData?: () => void` to props, a `ui.addData` entry (`{ ja: "経路・地点データを追加", en: "Add routing / facilities" }`), and render a `btn-ghost` button (guarded by `onAddData`) alongside the existing actions. Add a `DatasetCard.test.tsx` case: button present iff `onAddData` provided; click invokes it.

- [ ] **Step 8: GalleryPage AddData flow + test**

In `src/gallery/GalleryPage.tsx`: add an `addDataFlow` state (`idle | { venueId; venueName; network; facilities; busy; error }`), an `openAddData(venue)` opener, `onAddDataNetwork`/`onAddDataFacilities` file handlers (call `inspectGdbNetwork`/`inspectGdbFacilities`, store summary), and `submitAddData` (call `api.augmentGdb(venueId, { networkBlobHash, facilitiesBlobHash })` → `waitForJob` → `reload` + notice; never `createVenue`/`deleteVenue`). Wire `onAddData={() => openAddData(venue)}` on each `DatasetCard`, and render `<AddDataDialog … />` when the flow is open. Add a `gallery.test.tsx` case mirroring "imports a geodatabase as a new version": open Add data on a card → attach a mocked network inspection → Import → assert `augmentGdb` called with the card's venue id + network blob hash, `createVenue` not called.

- [ ] **Step 9: Run client suites + tsc**

Run: `pnpm exec vitest run src/gallery && pnpm exec tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 10: Commit**

```bash
git add src/gallery/api.ts src/gallery/AddDataDialog.tsx src/gallery/AddDataDialog.test.tsx src/gallery/DatasetCard.tsx src/gallery/DatasetCard.test.tsx src/gallery/GalleryPage.tsx src/gallery/gallery.test.tsx src/gallery/api.test.ts
git commit -m "feat(gallery): Add routing / facilities action for existing datasets"
```

---

## Phase 3 — Change 4: Edit mapping (server + client)

### Task 5: `GET /api/venues/:id/gdb-mapping` endpoint

**Files:**
- Modify: `server/src/gdb/routes.ts` (new route reusing `inspectGdbArchive` + staging helpers)
- Test: `server/test/gdbFacilities.test.ts`

**Interfaces:**
- Produces: `GET /api/venues/:id/gdb-mapping` → `200 { blobHash: string; inspection: GdbInspection; plan: GdbMappingPlan }`; `404 { error: "no_editable_mapping" | "not_found" }`. Client `api.getGdbMapping` (Task 6) consumes it.

- [ ] **Step 1: Write the failing tests**

```ts
describe("GET /api/venues/:id/gdb-mapping", () => {
  it("returns the stored raw-GDB inspection and plan for a gdb dataset", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venueId = await createVenue(app, cookie);
    const blobHash = putBlob(app, await validGdbZipBytes("venue.gdb"));
    await app.inject({ method: "POST", url: "/api/gdb/publish", headers: { cookie }, payload: { venueId, blobHash, plan: PUBLISH_PLAN } });
    await app.queue.idle();

    const res = await app.inject({ method: "GET", url: `/api/venues/${venueId}/gdb-mapping`, headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { blobHash: string; inspection: unknown; plan: { layers: unknown[] } };
    expect(body.blobHash).toBe(blobHash);
    expect(Array.isArray(body.plan.layers)).toBe(true);
    expect(body.inspection).toBeTruthy();
  });

  it("404 no_editable_mapping when the venue has no gdb version", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venueId = await createVenue(app, cookie);
    const res = await app.inject({ method: "GET", url: `/api/venues/${venueId}/gdb-mapping`, headers: { cookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "no_editable_mapping" });
  });
});
```

- [ ] **Step 2: Run — Expected FAIL** (`cd server && pnpm exec vitest run gdbFacilities -t "gdb-mapping"`)

- [ ] **Step 3: Register the route**

```ts
app.get(
  "/api/venues/:id/gdb-mapping",
  { preHandler: requireSession, schema: { params: Type.Object({ id: Type.Integer({ minimum: 1 }) }) } },
  async (request, reply) => {
    const { id } = request.params as { id: number };
    const db = request.server.db;
    if (!db.prepare("SELECT id FROM venues WHERE id = ? AND tenant_id = ?").get(id, TENANT_ID)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const row = db
      .prepare(
        `SELECT gdb_source_blob_hash AS g, gdb_plan_json AS p
           FROM versions WHERE venue_id = ? AND gdb_source_blob_hash IS NOT NULL
           ORDER BY seq DESC LIMIT 1`,
      )
      .get(id) as { g: string; p: string } | undefined;
    if (!row || !request.server.blobs.has(row.g)) {
      return reply.code(404).send({ error: "no_editable_mapping" });
    }
    const staged = stageGdbBlobForGdal(request.server.blobs.path(row.g), row.g);
    try {
      const inspection = await inspectGdbArchive(staged); // same call the inspect route uses
      return reply.code(200).send({ blobHash: row.g, inspection, plan: JSON.parse(row.p) });
    } finally {
      removeStagedGdb(staged);
    }
  },
);
```
(Confirm the inspect route's exact helper name — it may be `inspectGdbArchive` or wrapped in `serializeGdalOperation`; reuse whatever `POST /api/gdb/inspect` calls, including its serialization guard.)

- [ ] **Step 4: Run — Expected PASS** (both cases), then `cd server && pnpm exec vitest run gdbFacilities` all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/gdb/routes.ts server/test/gdbFacilities.test.ts
git commit -m "feat(server): GET gdb-mapping returns stored GDB inspection + plan for re-editing"
```

### Task 6: Client — Edit mapping action + seeded dialog flow

**Files:**
- Modify: `src/gallery/api.ts` (`getGdbMapping`)
- Modify: `src/gallery/DatasetCard.tsx` (`onEditMapping?` + button, shown when `venue.latest?.editableMapping`)
- Modify: `src/gallery/GalleryPage.tsx` (edit-mapping target + flow)
- Test: `src/gallery/api.test.ts`, `src/gallery/gallery.test.tsx`, `src/gallery/DatasetCard.test.tsx`

**Interfaces:**
- Consumes: `GET /api/venues/:id/gdb-mapping` (Task 5); existing `GdbImportDialog` (`inspection` + `initialPlan` + `venueNameLocked` + `onImport`), existing `publishGdb`.
- Produces: `api.getGdbMapping(venueId: number): Promise<{ blobHash: string; inspection: GdbInspection; plan: GdbMappingPlan }>`.

- [ ] **Step 1: api test + impl**

Test (`api.test.ts`): `getGdbMapping(7)` GETs `/api/venues/7/gdb-mapping` and returns the parsed body. Impl:
```ts
async getGdbMapping(venueId: number): Promise<{ blobHash: string; inspection: GdbInspection; plan: GdbMappingPlan }> {
  return request(`/api/venues/${venueId}/gdb-mapping`);
},
```
Run: `pnpm exec vitest run src/gallery/api.test.ts -t getGdbMapping` (FAIL → PASS).

- [ ] **Step 2: GalleryPage edit-mapping flow**

Extend `GdbTarget` with `| { mode: "edit-mapping"; venueId: number; venueName: string }`. Add `startEditMapping(venue)` that (instead of the file input) calls `api.getGdbMapping(venue.id)` and sets `gdbFlow` to `phase: "review"` with `data: { blobHash, inspection, suggestedPlan: plan }`, `network: null, facilities: null`, `target: { mode: "edit-mapping", venueId, venueName }`. In `publishGdbPlan`, the `edit-mapping` branch behaves like `version`: `venueId = target.venueId`, call `api.publishGdb(venueId, data.blobHash, plan)`, never `createVenue`/`deleteVenue`. Pass `venueNameLocked={gdbFlow.target.mode !== "create"}` to the dialog.

- [ ] **Step 3: DatasetCard action**

Add `onEditMapping?: () => void` + `ui.editMapping` (`{ ja: "マッピングを編集", en: "Edit mapping" }`) + a guarded button. Gallery passes `onEditMapping` only when the venue has an editable GDB mapping — add an `editableMapping?: boolean` to the venue's `latest` summary from `GET /api/venues` (server: include `gdb_source_blob_hash IS NOT NULL` on the latest version), or gate on `venue.latest?.sourceKind === "gdb"` if that field already exists. Verify which fields `VenueSummary.latest` carries and use the smallest sufficient signal.

- [ ] **Step 4: Tests**

- `DatasetCard.test.tsx`: Edit mapping button present iff `onEditMapping` provided; click invokes it.
- `gallery.test.tsx`: mock `getGdbMapping` → clicking Edit mapping opens the review dialog seeded (venue name locked, shows a layer row) → Import calls `publishGdb` with the stored `blobHash` + edited plan; `createVenue` not called.

- [ ] **Step 5: Run + tsc**

Run: `pnpm exec vitest run src/gallery && pnpm exec tsc --noEmit` — PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/gallery/api.ts src/gallery/DatasetCard.tsx src/gallery/DatasetCard.test.tsx src/gallery/GalleryPage.tsx src/gallery/gallery.test.tsx src/gallery/api.test.ts
git commit -m "feat(gallery): Edit mapping re-opens the GDB layer dialog for an existing dataset"
```

> **Note (if `editableMapping` needs the server):** if `GET /api/venues` must expose whether the latest version has a stored GDB mapping, add that read + a server test in this task's commit (venues route + its test file). Keep it in this task since the button visibility depends on it.

---

## Phase 4 — Change 1: Hide `venue` + `level` until selected (client)

### Task 7: Generalize the selected-only fill; index venue/level for search

**Files:**
- Modify: `src/map/featureLayers.ts` (rename `LAYER_BUILDING_FILL` → `LAYER_SELECTABLE_CONTEXT_FILL`; broaden filter; drop `venue` from context; drop `matchLevelFloor` from walkway; retarget theme paint)
- Modify: `src/map/featureLayers.test.ts`
- Modify: `src/search/buildSearchEntries.ts` (index `venue` + `level`)
- Test: `src/search/buildSearchEntries.test.ts`

**Interfaces:**
- Produces: `LAYER_SELECTABLE_CONTEXT_FILL` replaces `LAYER_BUILDING_FILL` (update every import site — grep confirms it's only `featureLayers.ts` + `featureLayers.test.ts`).

- [ ] **Step 1: Write/adjust the failing test**

Replace the existing `it("hides building polygons by default …")` in `src/map/featureLayers.test.ts` with a generalized version:
```ts
it("hides venue/building/level polygons by default, tinting only the selected one", () => {
  for (const t of ["venue", "building", "level"] as const) {
    expect(JSON.stringify(findLayer(LAYER_CONTEXT_FILL).filter)).not.toContain(t === "building" ? "building" : t);
  }
  const sel = findLayer(LAYER_SELECTABLE_CONTEXT_FILL);
  expect(sel.type).toBe("fill");
  expect(JSON.stringify(sel.filter)).toContain("venue");
  expect(JSON.stringify(sel.filter)).toContain("level");
  expect(JSON.stringify(sel.filter)).toContain("building");
  const opacity = (sel as FillLayerSpecification).paint?.["fill-opacity"];
  expect(JSON.stringify(opacity)).toContain("selected");
  // Search-only: not hit-tested on the map.
  expect(CLICKABLE_LAYER_IDS).not.toContain(LAYER_SELECTABLE_CONTEXT_FILL);
  // Level no longer paints the walkway floor plate.
  expect(JSON.stringify(findLayer(LAYER_WALKWAY_FILL).filter)).not.toContain("level");
});
```
Update the import from `LAYER_BUILDING_FILL` to `LAYER_SELECTABLE_CONTEXT_FILL`.

- [ ] **Step 2: Run — Expected FAIL** (`pnpm exec vitest run src/map/featureLayers.test.ts`)

- [ ] **Step 3: Implement layer changes in `src/map/featureLayers.ts`**

- Rename the export `LAYER_BUILDING_FILL` → `LAYER_SELECTABLE_CONTEXT_FILL` (value e.g. `"indoor-selectable-context-fill"`).
- `LAYER_CONTEXT_FILL` + `LAYER_CONTEXT_OUTLINE` filters: `matchFeatureType("footprint")` (drop `venue`).
- `LAYER_WALKWAY_FILL` + `LAYER_WALKWAY_OUTLINE` filters: `matchWalkwayUnit` only (drop the `["any", matchLevelFloor, …]`).
- The renamed selectable-context fill: `filter: matchFeatureType("building", "venue", "level")`, same `fill-opacity ["case", ["boolean", ["feature-state","selected"], false], 0.12, 0]`, `fill-color: c.selected`; keep it out of `CLICKABLE_LAYER_IDS`.
- In `applyThemePaintProperties`, change `setPaintProperty(LAYER_BUILDING_FILL, "fill-color", c.selected)` → `setPaintProperty(LAYER_SELECTABLE_CONTEXT_FILL, "fill-color", c.selected)`.
- Update the fixed-layer-order comment (§4.2) accordingly.

- [ ] **Step 4: Run — Expected PASS** (`pnpm exec vitest run src/map/featureLayers.test.ts`)

- [ ] **Step 5: Index venue/level for search (test-first)**

`src/search/buildSearchEntries.test.ts`: add a case asserting a `venue` feature and a `level` feature (each with a label) produce search entries. Run → FAIL. Then in `src/search/buildSearchEntries.ts` add `venue: true` and `level: true` to `INDEXED_TYPES`. Run → PASS.

- [ ] **Step 6: Full map + search suites + tsc**

Run: `pnpm exec vitest run src/map src/search && pnpm exec tsc --noEmit` — PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add src/map/featureLayers.ts src/map/featureLayers.test.ts src/search/buildSearchEntries.ts src/search/buildSearchEntries.test.ts
git commit -m "feat(viewer): hide venue/level polygons until selected (search-only, like buildings)"
```

---

## Phase 5 — Change 3: Two-pane issue/comments view (client)

### Task 8: Two-pane IssueDetail

**Files:**
- Modify: `src/issues/IssuesPanel.tsx` (apply a wide modifier while a detail is open)
- Modify: `src/issues/IssueDetail.tsx` (two-column layout: metadata/controls | thread)
- Modify: `src/app/app.css` (`.floating-panel--issues-wide` width; `.issue-detail--two-pane` grid; compact stack)
- Test: `src/issues/IssueDetail.test.tsx`, `src/issues/IssuesPanel.test.tsx`

**Interfaces:**
- Consumes: existing `IssueController` state (no change). Produces: no new exports; a structural/CSS change only.

- [ ] **Step 1: Write the failing test**

In `src/issues/IssueDetail.test.tsx`, add a case asserting the detail renders a two-pane structure — e.g. a container with class `issue-detail--two-pane` containing a metadata region and a thread region (`aria-label`/testid for the thread). Assert the reply thread and the root body are both present within their respective panes.

- [ ] **Step 2: Run — Expected FAIL** (`pnpm exec vitest run src/issues/IssueDetail.test.tsx`)

- [ ] **Step 3: Implement the two-pane layout**

In `IssueDetail.tsx`, wrap the body in `<div className="issue-detail issue-detail--two-pane">` with two children: a `left` column (root body editor, metadata rows, role-gated controls) and a `right` column (`<section aria-label={thread label}>` containing the reply list + `ReplyComposer`). Keep all existing handlers/props. In `IssuesPanel.tsx`, when the controller is showing a detail (not the queue/composer), pass a signal up so `App.tsx` adds `floating-panel--issues-wide` — simplest: `IssuesPanel` renders a wrapper `<div className="issues-panel issues-panel--detail">` when in detail view and the CSS widens via that inner class (no `App.tsx` change needed). Prefer the inner-class approach to avoid threading state through `App`.

- [ ] **Step 4: Add CSS in `src/app/app.css`**

Near the existing `.floating-panel--issues .floating-panel__body` rule (~line 1224):
```css
.issue-detail--two-pane {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: var(--space-3);
  min-height: 0;
}
.issue-detail--two-pane .issue-detail__thread {
  overflow-y: auto;
  min-height: 0;
}
.issues-panel--detail { width: min(760px, 92vw); }

@media (max-width: 899px) {
  .issue-detail--two-pane { grid-template-columns: 1fr; }
  .issues-panel--detail { width: auto; }
}
```
(Match the existing panel width variable/pattern; adjust the widened width to sit within the map viewport.)

- [ ] **Step 5: Run — Expected PASS**, then full issues suite:

Run: `pnpm exec vitest run src/issues && pnpm exec tsc --noEmit` — PASS, clean. If any existing `IssueDetail`/`IssuesPanel` test asserts single-column structure, update it to the two-pane structure (behavior/queries unchanged, only container shape).

- [ ] **Step 6: Commit**

```bash
git add src/issues/IssueDetail.tsx src/issues/IssuesPanel.tsx src/app/app.css src/issues/IssueDetail.test.tsx src/issues/IssuesPanel.test.tsx
git commit -m "feat(issues): two-pane issue detail giving the comment thread room"
```

---

## Phase 6 — Verification

### Task 9: Full-suite verification + smoke

**Files:** none (verification only).

- [ ] **Step 1: Client + server suites + typecheck**

Run:
```bash
pnpm exec vitest run 2>&1 | grep -iE "Test Files|Tests |FAIL"
cd server && pnpm exec vitest run 2>&1 | grep -iE "Test Files|Tests |FAIL"; cd ..
pnpm exec tsc --noEmit; echo "TSC=$?"
cd server && pnpm exec tsc --noEmit; echo "SRV_TSC=$?"; cd ..
```
Expected: all suites PASS, `TSC=0`, `SRV_TSC=0`.

- [ ] **Step 2: Migration smoke**

Boot the server once against a scratch DB (or run the existing server smoke test) and confirm migration `003_gdb_reprocess.sql` applies without error and the `versions` columns exist:
```bash
cd server && pnpm exec vitest run gdbFacilities 2>&1 | grep -iE "Test Files|Tests |FAIL"
```
(The Task 1/2 tests exercise the new columns on a freshly-migrated in-memory DB.)

- [ ] **Step 3: Manual browser smoke (record results)**

With backend + Vite running, verify each change on the Tokyo dataset:
- C1: open a floor — venue/level not filled; select a venue/level via search → it tints.
- C2: dataset card → Add routing / facilities → attach a network `.gdb.zip` → Import → new version opens with routing.
- C4: dataset card → Edit mapping → dialog opens seeded (venue name locked) → toggle a layer → Import → new version; prior routing/facilities still present.
- C3: open an issue → comments render in the two-pane view with room.

- [ ] **Step 4: Commit any test-only fixes** discovered during verification (no source changes expected here).

```bash
git add -A && git commit -m "test: verification fixes for viewer & gallery refinements" || echo "nothing to commit"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** C1 → Task 7; C2 → Tasks 1-4; C3 → Task 8; C4 → Tasks 1,2,5,6; groundwork → Tasks 1-2; verification → Task 9.
- **Type consistency:** `augmentGdb` shape matches the augment 202 body; `getGdbMapping` returns `{ blobHash, inspection, plan }` matching the endpoint; `LAYER_SELECTABLE_CONTEXT_FILL` replaces every `LAYER_BUILDING_FILL` reference.
- **Immutability:** every reprocess path (augment, edit-mapping) inserts a new `versions` row; none mutate existing rows.
- **Copy:** every new UI string added with both `ja` and `en`.
