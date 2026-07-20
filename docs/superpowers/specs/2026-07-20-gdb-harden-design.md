# Kiriko: GDB Harden + Auto-Prune

**Date:** 2026-07-20  
**Status:** Approved (design direction)  
**Depends on:** Frontend GDB import UI (`docs/superpowers/specs/2026-07-20-gdb-import-frontend-design.md`) and server GDB pipeline (`/api/gdb/inspect`, `/api/gdb/publish`, `suggestGdbMapping`, `buildGdbImdf`, `collectGdbConversionFailures`).

## 1. Context

The gallery can inspect a `.gdb.zip`, show a server-suggested mapping plan, and call publish. Against the canonical fixture `JRTokyoSta_3857.gdb.zip`:

- Inspect returns 318 layers and a near-complete suggested plan (~272 included, 15 buildings).
- Client blocking enables **Import** (structural rules pass).
- Publish with the default plan returns **400** `gdb_conversion_failed`.

Two classes of failure showed up in smoke:

1. **Contract drift — empty / null buildingId.**  
   Suggestion intentionally leaves unstructured POIs (e.g. `Free_shuttle_bus_busstop_Facility`) as `included` + `targetType: amenity` + `buildingId: null` + `levelRule: source-reference`, expecting building inheritance from a resolved level reference. Client `collectBlockingIssues` allows that. Conversion’s `requiredBuildingUuid` / map lookup still reject some of these paths; empty-string `buildingId` is treated as an unknown id (`""`) rather than null, which is a footgun at the JSON boundary.

2. **Deep conversion failures on included structured layers.**  
   Excluding only the free-shuttle layer still failed on geometry (e.g. `Yaechika_B2_Space` — incompatible GeometryCollection member). These cannot be predicted by the client’s structural checks without running GDAL + `buildGdbImdf`.

A pure helper already exists for (2): `collectGdbConversionFailures` repeatedly calls `buildGdbImdf`, records each blamed layer, and retries with that layer excluded. **Publish does not call it** — it runs one-shot `buildGdbImdf` and 400s.

### 1.1 Success criterion (this phase)

Dropping `JRTokyoSta_3857.gdb.zip` through the gallery with the **default suggested plan** (no manual row edits):

1. Import is enabled when the plan is structurally sound.
2. Publish returns **202** and the compile job completes.
3. The venue appears published and opens in the viewer.
4. Any layers dropped to make conversion succeed are **reported** to the user (not silent).

## 2. Goals

- Align client structural blocking with conversion’s real building requirements (including empty-string normalization).
- Light suggestion hygiene so unstructured layers without a level-reference field are not auto-included.
- Use `collectGdbConversionFailures` on the publish path so deep, blamed-layer failures auto-prune instead of hard-failing the whole import.
- Surface `excludedLayers` on the publish 202 response for gallery feedback.
- Optional: timeout guard on inspect so catalog-passing garbage cannot hang gdal3.js indefinitely.

## 3. Non-goals

- Import GDB as a new version of an existing venue.
- Bulk dialog editing UX, marker icons, streaming conversion progress.
- Shared npm package / codegen between client and server validation (document the contract; keep dual copies this phase).
- Persisting exclusions in a new DB column or changing the IMDF upload path.
- Re-implementing suggestion or full conversion on the client.
- Fixing every possible GDAL geometry edge so zero layers are ever excluded — auto-prune is the safety net.

## 4. Design

### 4.1 Approach

**Harden + auto-prune (single vertical slice):**

| Layer | Responsibility |
|--------|----------------|
| Suggestion | Fewer false-green includes for unstructured POIs without ref fields |
| Client blocking | Honest Import for structural building/level rules |
| Publish | Normalize plan → convert → build or auto-prune → 202 + exclusions |
| Gallery | Toast/banner when `excludedLayers` is non-empty |

### 4.2 Plan normalization

Pure helper (server; client mirrors before send):

```ts
function normalizeGdbPlan(plan: GdbMappingPlan): GdbMappingPlan {
  return {
    ...plan,
    layers: plan.layers.map((row) => ({
      ...row,
      buildingId: row.buildingId === "" ? null : row.buildingId,
    })),
  };
}
```

Apply on the server at the start of `/api/gdb/publish` (authoritative). Client also normalizes in `pruneUnusedBuildings` / immediately before `publishGdb` so the wire payload never sends `""`.

### 4.3 Suggestion hygiene (`suggestLayerPlan`)

Keep structured-prefix building assignment and level-rule precedence as today. Change only auto-`included` for unstructured names:

- Let `structured = STRUCTURED_NAME.test(name)`.
- After geometry gating produces a non-null `targetType` and the current include predicate would set `included = featureCount > 0 && !crossFloor`:
  - If `!structured` and `targetType !== "level"` and there is **no** `level_id` / `floor_id` field → force `included = false` (type and rules still filled for manual review).
  - If `!structured` but a source-reference field exists → keep include + `buildingId: null` (inheritance path).
- Do **not** invent placeholder buildings for unstructured prefixes.
- Structured layers with bad geometry stay includable when suggested; publish auto-prune handles them.

### 4.4 Client structural blocking (`collectBlockingIssues`)

Update rules (bilingual copy can reuse `needBuilding` / `levelNoBuilding`):

1. Treat missing building as `buildingId == null || buildingId === ""` or id ∉ `plan.buildings`.
2. **Level** rows: still require a known building; `source-reference` remains invalid as a level ordinal source (unchanged).
3. **Non-level** rows:
   - If `levelRule.kind === "source-reference"`: building optional (matches conversion inheritance when the reference resolves).
   - Else: require a known building.
4. No client checks for geometry family beyond target compatibility, unresolved refs, or empty converted layers — those remain server-side.

### 4.5 Publish auto-prune

In `registerGdbRoutes` publish handler, after successful `convertGdbLayers`:

```
plan = normalizeGdbPlan(plan)
try:
  archive = buildGdbImdf(conversion, plan)
  excluded = []
catch GdbConversionError:
  failures = collectGdbConversionFailures(conversion, plan)
  if failures empty:  # non-attributable or already exhausted
    return 400 with original error shape
  working = plan with each failures[].layer set included=false
  if no included layers with targetType remain:
    return 400 gdb_conversion_failed (reason: nothing convertible / include failure list)
  archive = buildGdbImdf(conversion, working)  # must succeed if collect returned a full residual set; if it throws, 400
  excluded = failures
continue existing IMDF zip → blob → version → enqueue path using archive
return 202 { jobId, versionId, seq, excludedLayers: excluded }
```

Notes:

- `collectGdbConversionFailures` already clones the plan per attempt and keys exclusions by `layerName` (same as today’s blamed `details.layer`). Keep that keying; document the known limitation that duplicate layer names across databases would collide (Tokyo is single-DB).
- GDAL is still invoked once for the originally included names. Prune only affects `buildGdbImdf`, not a second GDAL pass. Acceptable: conversion cost is dominated by the first pass; excluded layers’ GeoJSON may be present but unused.
- Hard 400 paths unchanged for: missing venue/blob, zero included names before convert, GDAL throw, non-`GdbConversionError` build failures (500).

### 4.6 Publish response contract

```ts
// 202 body (extends existing)
{
  jobId: string;
  versionId: number;
  seq: number;
  excludedLayers: Array<{ layer: string; reason: string }>; // always present; may be []
}
```

Typebox 202 schema gains `excludedLayers`. Client `api.publishGdb` return type matches. No job `result_json` change required for MVP feedback (sync body is enough before `waitForJob`).

### 4.7 Gallery UX for exclusions

After `publishGdb` resolves and `waitForJob` returns `done`:

- If `excludedLayers.length === 0`: existing success path (idle + reload).
- If non-empty: reload gallery and show a non-blocking bilingual toast, e.g.  
  - en: `Published with N layer(s) skipped (e.g. Yaechika_B2_Space).`  
  - ja: `公開しました（N レイヤーをスキップ: 例 Yaechika_B2_Space）。`  
- Reuse `.gallery-toast` styles. No modal required.
- On job error after 202, keep existing review-error path (version row remains, same as IMDF).

### 4.8 Inspect timeout (optional stretch, same phase if small)

Wrap `inspectGdbArchive` (or the route’s await) with a wall-clock timeout (60s). On timeout: 400 `gdb_inspection_failed` with a stable detail. Do not attempt to kill WASM mid-flight beyond abandoning the await and cleaning staged files in `finally`.

## 5. Architecture boundaries

- **`mapping.ts`**: suggestion include rule; `normalize` may live here or in a tiny `planNormalize.ts` next to types — prefer `mapping.ts` export `normalizeGdbPlan` used by routes.
- **`routes.ts`**: orchestration only (normalize → convert → build/prune → persist).
- **`planValidation.ts`**: structural blocking only; no prune simulation.
- **`api.ts` / `GalleryPage`**: transport + toast; no conversion logic.

## 6. Testing

### Server

- `normalizeGdbPlan`: `""` → `null`; leaves real ids and null alone.
- Suggestion: unstructured amenity without `floor_id`/`level_id` → `included: false`; with `floor_id` → can remain included with `buildingId: null`.
- Publish route (fake conversion injection or existing test doubles):
  - One good + one blamed bad layer → 202, `excludedLayers` names the bad layer, version enqueued.
  - All layers blamed → 400.
  - Clean plan → 202, `excludedLayers: []`.
- `gdbSmoke` (Tokyo fixture): inspect default plan → publish → job `done`; assert published venue; allow non-empty `excludedLayers`.

### Client

- `collectBlockingIssues`: empty-string buildingId on level / non-source-reference non-level → blocking; source-reference amenity with null building → no building-related block (other rules still apply).
- `publishGdb` typing accepts `excludedLayers`.
- Gallery test: mock publish returning one exclusion + job done → toast or accessible message present (if easy); at least reload still happens.

### Acceptance

Manual or automated smoke: Tokyo zip → Import → published card → open viewer. No manual layer table edits.

## 7. Risks and decisions

| Risk | Mitigation |
|------|------------|
| Auto-prune drops “important” layers silently | Always return and toast `excludedLayers` |
| `collectGdbConversionFailures` stops on non-layered errors | Preserve 400 with server reason |
| Client/server blocking drift | Document rules in this spec; tests on both sides for buildingId |
| Duplicate layer names across DBs | Out of scope; Tokyo is single DB; blame key stays layerName |
| Large prune loops | Bound already = included count + 1 |

## 8. Implementation order (for the plan)

1. `normalizeGdbPlan` + unit tests.  
2. Suggestion include hygiene + mapping tests.  
3. Publish prune + 202 `excludedLayers` + route/smoke tests.  
4. Client blocking + planValidation tests.  
5. Client API type + gallery toast.  
6. Inspect timeout (if still in budget).  
7. Full verification (tsc, vitest web+server, Tokyo smoke).
