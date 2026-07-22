# Kiriko: Viewer & Gallery Refinements

**Date:** 2026-07-22
**Status:** Approved (design); implementation pending
**Depends on:** GDB import pipeline (`2026-07-20-gdb-import-frontend-design.md`, `2026-07-20-gdb-import-existing-venue-design.md`, `2026-07-20-gdb-harden-design.md`), route-follows-network (`2026-07-22-route-follows-network-design.md`), review issues (`server/src/db/migrations/002_review_issues.sql`).

## 1. Context

Four independent, user-requested refinements to the viewer and gallery:

1. **Hide `venue` + `level` polygons until selected** — mirror the existing buildings treatment so large enclosing polygons stop cluttering the map.
2. **Add routing / point data to an already-created dataset** — today routing/facilities can only arrive with a full GDB (re)import; there is no way to layer them onto an existing dataset without re-supplying the venue geometry.
3. **Two-pane issue/comments view** — the reply thread is cramped inside the narrow Issues rail; give comments room.
4. **Re-open & edit the GDB layer mapping of an existing dataset** — import with a partial/imperfect mapping, open the dataset, then fix unloaded layers or wrong mappings afterward without re-uploading the GDB.

These share no runtime state. Changes 2 and 4 both need a version to be **self-describing for reprocessing**, so they share one persistence groundwork (Section 5.4).

## 2. Goals

- **C1:** `venue` and `level` render invisibly until selected, tinting only while selected (exactly like `building`); removed from map hit-testing (search-only).
- **C2:** A dataset-card action attaches network and/or point `.gdb.zip` to an existing dataset, producing a new version that **reuses the latest version's compiled IMDF geometry** and adds/merges the routing graph (§5) and facilities (§7).
- **C3:** When an issue detail is open, the Issues panel presents a two-pane layout — issue body + metadata + controls on one side, the full reply thread with its own room on the other. Queue view unchanged.
- **C4:** A dataset-card action re-opens the layer-mapping dialog for a GDB dataset, seeded from the stored raw GDB + last plan (no re-upload), and republishes a corrected **new version** that **carries forward** the prior routing/facilities.
- New user-facing strings are bilingual (ja/en), per repo convention.

## 3. Non-goals

- In-place mutation of a published version (bundles are immutable; every reprocess is a new version).
- C4 "edit mapping" for IMDF (non-GDB) datasets — GDB datasets only (it needs a raw GDB + plan). C2 "add routing/facilities" works on any dataset (the network/point sources are always GDB `.gdb.zip`, independent of how the venue was created).
- Editing routing/point mappings field-by-field (C2 attaches whole extracted layers; C4 edits the venue plan).
- Renaming a venue from any reprocess flow (unchanged from existing version publish).
- Reworking the issue data model, reply threading depth, or the composer.
- Blob garbage collection (none exists; content-addressed blobs are retained).
- Changing client blocking rules to *require* a complete mapping — partial import already works (Section 5.5).

## 4. Change 1 — Hide `venue` + `level` until selected

### 4.1 Current

`src/map/featureLayers.ts`:
- `LAYER_CONTEXT_FILL` / `LAYER_CONTEXT_OUTLINE`: filter `venue | footprint`, opacity `0.55` — always on, in `CLICKABLE_LAYER_IDS`.
- `LAYER_WALKWAY_FILL` / `LAYER_WALKWAY_OUTLINE`: filter `["any", matchLevelFloor, matchWalkwayUnit]` — the `level` polygon is the opaque floor "plate"; walkway fill is clickable.
- `LAYER_BUILDING_FILL`: filter `building`, `fill-opacity ["case", feature-state selected, 0.12, 0]`, **not** in `CLICKABLE_LAYER_IDS`; outline comes from the unfiltered feature-state-driven `LAYER_SELECTED_OUTLINE`. Themed in `applyThemePaintProperties` (`fill-color = c.selected`).

### 4.2 Approach — generalize the building pattern

- Rename `LAYER_BUILDING_FILL` → `LAYER_SELECTABLE_CONTEXT_FILL`; broaden its filter to `matchFeatureType("building", "venue", "level")`. Keep the selected-only opacity and theme paint (retarget the `setPaintProperty` id).
- `LAYER_CONTEXT_FILL` / `LAYER_CONTEXT_OUTLINE`: filter `footprint` only (drop `venue`). Footprint stays as always-on context, unchanged.
- `LAYER_WALKWAY_FILL` / `LAYER_WALKWAY_OUTLINE`: filter `matchWalkwayUnit` only (drop `matchLevelFloor`). Walkway *units* still fill and stay clickable; the `level` polygon no longer paints a floor plate.
- `CLICKABLE_LAYER_IDS`: unchanged list, but the effect is that `venue` (was reachable via context fill) and `level` (was reachable via walkway fill) are no longer map-clickable — search-only, like buildings.
- The features are still *emitted* by `buildRenderFeatures` (venue always; levels via `renderFeaturesByLevel`); only their paint/hit-test changes.
- **Search reachability:** confirm `venue` and `level` appear in `src/search/buildSearchEntries.ts` so the selected-tint is reachable (buildings already are). Add them if absent.

### 4.3 Files / tests
- `src/map/featureLayers.ts`; `src/map/featureLayers.test.ts` (generalize the "hides building polygons" test to assert: `venue`/`level` fills tint only when selected, are not in `CLICKABLE_LAYER_IDS`; `LAYER_CONTEXT_FILL` no longer matches `venue`; `LAYER_WALKWAY_FILL` no longer matches `level`).
- `src/search/buildSearchEntries.ts` (+ test) only if venue/level are not already indexed.

### 4.4 Accepted tradeoff
The floor base plate disappears — only rooms / walkway-units / fixtures render over the basemap. (User-confirmed.)

## 5. Changes 2 & 4 — Reprocessing existing GDB datasets

### 5.1 Current publish (`server/src/gdb/routes.ts` `POST /api/gdb/publish`)

Body `{ venueId, blobHash, plan, networkBlobHash?, facilitiesBlobHash? }`:
1. Validates venue + blobs.
2. Extracts optional network → `net_junctions` / `net_paths` GeoJSON blobs; optional facilities → GeoJSON blob.
3. Converts the venue GDB with the plan → synthesized IMDF ZIP → blob (`imdfHash`), auto-pruning blamed layers.
4. Inserts `versions (venue_id, seq, public_id, source_blob_hash=imdfHash, source_kind='gdb')`.
5. Enqueues `publish_imdf { versionId, networkJunctionsHash?, networkPathsHash?, facilitiesGeoJsonHash? }`, which compiles the IMDF (+ §5/§7) through the Rust core.

The **raw GDB blob and the plan are not persisted**; extracted network/facilities blob refs live only in the transient job payload.

### 5.2 Persistence groundwork (shared by C2 + C4)

Migration `server/src/db/migrations/003_gdb_reprocess.sql` — nullable columns on `versions` (one `ALTER TABLE … ADD COLUMN` each, SQLite-safe):

| Column | Meaning |
|--------|---------|
| `gdb_source_blob_hash TEXT` | raw venue `.gdb.zip` blob (enables C4 re-map) |
| `gdb_plan_json TEXT` | the normalized `GdbMappingPlan` used (enables C4 seeding) |
| `net_junctions_blob_hash TEXT` | extracted `net_junction` GeoJSON blob (bundle §5 input) |
| `net_paths_blob_hash TEXT` | extracted `net_path` GeoJSON blob (bundle §5 input) |
| `facilities_blob_hash TEXT` | extracted facilities GeoJSON blob (bundle §7 input) |

These make a version **self-describing for reprocessing**: its geometry source (`source_blob_hash` = IMDF; `gdb_source_blob_hash` = raw GDB), its plan, and its bundle inputs are all recoverable. All content-addressed blobs are retained (no GC), so persisting the hash is sufficient.

Publish (5.1 step 4) populates these on insert:
`gdb_source_blob_hash=blobHash`, `gdb_plan_json=JSON.stringify(normalizedPlan)`, and the three bundle-input hashes from the resolved inputs (Section 5.3 rule).

### 5.3 Bundle-input resolution rule (publish + augment)

A reprocess must not silently drop routing/facilities. Both publish and augment resolve each of `{net_junctions, net_paths, facilities}` as:

> **supplied** (freshly extracted from a network/facilities `.gdb.zip` in this request) **overrides**; **omitted** → **inherit** the target venue's latest published version's stored ref.

Consequences:
- **C4 edit-mapping** publish sends only `{venueId, blobHash, plan}` → venue reconverts, routing/facilities **inherited** from the prior version. No regression.
- **C2 augment** sends network and/or facilities → those override; the other inherits (so "Add facilities" to a routing-only dataset keeps routing).
- **New-venue create** publish has no prior version → inherits nothing (unchanged).
- **Combined-import version** publish supplies all three GDBs → all override (unchanged behavior).

This is one rule applied server-side; it changes publish's "omitted network = no §5" only for venues that already have a prior version, which matches user intent (reprocess preserves).

### 5.4 Change 2 — "Add routing / facilities"

**Server:** new `POST /api/gdb/augment` (session-gated) — `{ venueId, networkBlobHash?, facilitiesBlobHash? }`:
1. Validate venue + tenant; require ≥1 of network/facilities (else 400 `no_augment_data`).
2. Find the venue's latest **published** version (`status='published'`, highest `seq`) — its `source_blob_hash` is the geometry to reuse (else 404 `no_base_version`).
3. Extract supplied network/facilities → GeoJSON blobs (shared helper factored out of the publish handler).
4. Resolve bundle inputs by Section 5.3 (supplied override, omitted inherit prior).
5. Insert new version: `source_blob_hash = prior.source_blob_hash` (geometry reused, **no GDB conversion**), `source_kind = prior.source_kind`, `seq = MAX+1`; persist the five reprocess columns (carry `gdb_source_blob_hash`/`gdb_plan_json` from prior so the dataset stays editable).
6. Enqueue `publish_imdf` with the resolved bundle-input hashes.

**Client:**
- `api.augmentGdb(venueId, { networkBlobHash?, facilitiesBlobHash? })`.
- `DatasetCard` action **Add routing / facilities** (`onAddData?`), rendered when signed-in ready and the dataset has ≥1 published version. Copy: en `Add routing / facilities`, ja `経路・地点データを追加`.
- A focused `AddDataDialog`: network + point `.gdb.zip` uploaders reusing `inspectGdbNetwork`/`inspectGdbFacilities` and their existing summary lines (`… nodes / … edges`, `Facilities: N places, M floors`); Import calls `augmentGdb`; no venue layer table.
- `GalleryPage` orchestration: an `AddData` flow (pick files → inspect → dialog → augment → `waitForJob` → reload); never touches `createVenue`/`deleteVenue`.

### 5.5 Change 4 — "Edit mapping"

**Partial import already works:** a plan may leave layers excluded; publish requires ≥1 included layer and auto-prunes blamed layers. So users can import quickly and refine later — no blocking-rule change. C4 supplies the "refine later" path.

**Server:** new `GET /api/venues/:id/gdb-mapping` (session-gated):
1. Find the venue's latest version with `gdb_source_blob_hash NOT NULL` (highest `seq`, **any status** — editing a failed or partial GDB import is a primary use case; else 404 `no_editable_mapping`).
2. Re-inspect the retained raw GDB blob (`inspectGdbArchive` on a staged copy — deterministic; nothing large stored) → `inspection`.
3. Return `{ blobHash: gdb_source_blob_hash, inspection, plan: JSON.parse(gdb_plan_json) }` (+ `suggestedPlan` optional for a "reset" affordance).

Edit → existing `publishGdb(venueId, storedBlobHash, editedPlan)` (no network/facilities in the request → inherited per 5.3). Produces a corrected new version.

**Client:**
- `api.getGdbMapping(venueId)`.
- `DatasetCard` action **Edit mapping** (`onEditMapping?`), shown when the dataset's latest version has a stored GDB mapping (`gdb_source_blob_hash`). Copy: en `Edit mapping`, ja `マッピングを編集`.
- `GalleryPage`: fetch mapping → open `GdbImportDialog` seeded with `inspection` + `plan`, `venueNameLocked`, in an **edit mode** with the venue-file dropzone hidden (no upload). Import → `publishGdb` with the stored `blobHash`.
- `GdbImportDialog`: accept an initial `inspection` + `plan` without a staged file; hide/skip the venue-file input in edit mode. Layer table, blocking rules, buildings unchanged.

### 5.6 Files / tests (C2 + C4)
- `server/src/db/migrations/003_gdb_reprocess.sql`.
- `server/src/gdb/routes.ts` (persist columns on publish; `/api/gdb/augment`; `/api/venues/:id/gdb-mapping`; bundle-input resolution helper; extraction helper factored out). Persisting/inheriting is orchestration only; no compile-path change.
- `src/gallery/api.ts` (`augmentGdb`, `getGdbMapping`, types); `src/gallery/GalleryPage.tsx` (two new flows); `src/gallery/DatasetCard.tsx` (two actions); `src/gallery/GdbImportDialog.tsx` (edit mode / seeded, no-upload); new `src/gallery/AddDataDialog.tsx`.
- **Server tests:** publish persists the five columns; augment reuses prior IMDF + attaches network → new version + job, carry-forward facilities, 404 no base version, 400 no data; GET mapping returns inspection + plan, 404 when none; publish inherits prior bundle inputs when omitted (job payload reuses them).
- **Client tests:** DatasetCard renders both actions when callbacks present; AddDataDialog inspect + import → `augmentGdb`; edit flow fetches mapping, seeds dialog, `publishGdb(storedBlobHash, editedPlan)`; api transport shapes.

## 6. Change 3 — Two-pane issue/comments view

### 6.1 Current
`src/issues/IssuesPanel.tsx` routes queue → `IssueDetail` (root + metadata + controls + reply thread) → composer, all stacked in the left `FloatingPanel` (`floating-panel--left floating-panel--issues`). All state lives in the `useIssueSync` controller.

### 6.2 Approach
When an issue **detail** is open, widen the issues panel and split `IssueDetail` into two panes:
- **Left:** root body, metadata rows, role-gated controls.
- **Right:** the reply/comment thread + reply composer, with its own scroll region so it no longer competes with the whole panel for vertical space.

Queue and composer-new views stay single-column. Purely presentational: `IssuesPanel` applies a wide modifier class while a detail is selected; `IssueDetail` lays out two columns; CSS adds the wide panel width and the two-pane grid (collapsing to stacked on compact/bottom-sheet layouts). Controller, commands, and reducers are untouched.

### 6.3 Files / tests
- `src/issues/IssuesPanel.tsx` (wide flag when detail active), `src/issues/IssueDetail.tsx` (two-column layout), panel CSS (`floating-panel--issues-wide`, two-pane grid, compact stack).
- Tests: `IssueDetail` renders body/metadata and the thread in the two-pane structure; existing `IssueDetail`/`IssuesPanel` tests still pass; a test asserting the wide layout applies only in detail view.

## 7. Success criteria

- **C1:** venue/level are invisible until selected, tint on selection, not map-clickable; footprint context and walkway-unit fills unchanged; floor renders rooms/units without a level plate.
- **C2:** from a dataset card, attaching a network and/or point `.gdb.zip` yields a new version with routing/facilities added on the same geometry; existing routing/facilities are preserved when only one is added.
- **C3:** opening an issue shows a roomy two-pane view; multiple comments are visible without cramping; queue view unchanged.
- **C4:** from a dataset card, the mapping dialog re-opens seeded from stored data (no upload); saving corrections yields a new version that keeps prior routing/facilities; a dataset imported with layers left unmapped can be fixed afterward.
- Web + server vitest and `tsc` green; migration applies cleanly; Tokyo-fixture smoke for C2/C4 reprocess.

## 8. Implementation order (for the plan)

1. **Persistence groundwork** — migration 003; publish persists the five columns; bundle-input resolution rule + extraction helper; server tests. (Foundation for C2 + C4.)
2. **C2 augment** — `/api/gdb/augment`, api, DatasetCard action, `AddDataDialog`, GalleryPage flow, tests.
3. **C4 edit mapping** — `GET gdb-mapping`, api, DatasetCard action, GdbImportDialog edit mode, GalleryPage flow, tests.
4. **C1 hide venue/level** — featureLayers generalization + search reachability + tests. (Independent; can land any time.)
5. **C3 two-pane comments** — IssuesPanel/IssueDetail layout + CSS + tests. (Independent.)
6. **Verification** — full web + server vitest, `tsc`, migration + Tokyo reprocess smoke.
