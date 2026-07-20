# Kiriko: Frontend File Geodatabase Import

**Date:** 2026-07-20
**Status:** Approved
**Depends on:** Server-side GDB import pipeline (`/api/gdb/inspect`, `/api/gdb/publish`) and the existing IMDF upload/publish gallery flow.

## 1. Context

The server can already ingest a File Geodatabase: `POST /api/gdb/inspect` stages an uploaded `.gdb.zip`, enumerates its OGR layers via gdal3.js, and returns the layer summary plus a content-addressed blob hash; `POST /api/gdb/publish` takes a reviewed `GdbMappingPlan`, converts the selected layers to WGS84 GeoJSON, synthesizes a strict IMDF archive, and compiles it through the existing `publish_imdf` Rust path with `source_kind='gdb'`.

Nothing in the web app calls these endpoints. The gallery offers only the IMDF flow (`UploadModal` + `ImdfDropzone`), so a user still cannot import a `.gdb.zip` through the product. This phase closes that gap: a gallery entry that inspects a geodatabase, presents an editable mapping plan, and publishes it — wired to the server endpoints, not the browser-side gdal3.js conversion the abandoned `feature/gdb-import` branch used.

### 1.1 Template structure

`/home/apollo/Downloads/JRTokyoSta_3857.gdb.zip` is the canonical input structure; most real geodatabases are expected to match it:

- Structured layer names of the form `Prefix_Ordinal_Category` (e.g. `Shinmarubiru_5_Floor`, `G空間_0_Space`, `JRTokyoSta_B1_Fixture`).
- Category suffixes following the Tokyo (`_Floor`/`_Space`/`_Drawing`/`_Fixture`/`_Opening`) and Shinjuku (`_level`/`_unit`/`_detail`) conventions.
- Per-building name prefixes that group layers into buildings.
- EPSG:3857 source projection (reprojected to WGS84 during conversion).
- Several hundred layers per archive (318 in the fixture; ~272 convertible after suggestion filtering).

The suggestion logic already handles this structure server-side. The design's primary acceptance test is that dropping this fixture yields a **near-publish-ready plan** requiring only exception edits.

## 2. Goals

Ship one complete vertical slice:

- A gallery **"Import Geodatabase"** entry, distinct from the IMDF "Open local data" flow.
- Upload a `.gdb.zip` to `/api/gdb/inspect` and receive the inspection plus a server-suggested plan.
- A review dialog that edits the full `GdbMappingPlan`: venue name, buildings (add/rename/delete), and a per-layer table (include, target type, building, level rule, and id/ordinal/short-name/name/category field mappings), with pagination for hundreds of layers.
- Live, client-side **blocking-issue** feedback that disables Import until the plan is structurally valid.
- Publish via `/api/gdb/publish`, then poll the compile job, mirroring the IMDF `createVenue → publish → waitForJob` pattern.
- The imported venue appears in the gallery and renders through the existing IMDF viewer path.

## 3. Non-goals

- Marker icons / `GdbMarkerIcons` and the `public/icons/marker/*` assets — viewer rendering concerns, orthogonal to import. Imported venues render through the existing IMDF viewer. Deferred.
- Client-side `gdal3.js` / `gdb.worker` conversion — the server owns conversion; not ported from the branch.
- Importing a geodatabase as a new version of an existing venue — the server contract (`venueId`) allows it, but the dialog only creates new venues this phase.
- Streaming conversion progress — the flow uses the existing job-polling `processing` state, not a progress bar for the server-side conversion.
- Re-implementing suggestion or conversion logic on the client. The client holds only small structural-validation helpers.

## 4. Product and interaction model

### 4.1 Entry point

The gallery gains an **"Import Geodatabase"** action in the header, alongside the existing IMDF upload action. It opens a native file picker scoped to `.zip`/`.gdb.zip`. The IMDF `UploadModal` is untouched. The two formats have deliberately separate entries: both are `.zip`, and their flows diverge sharply (IMDF is one-shot; GDB requires an async inspect and a large review dialog), so format auto-detection is avoided.

### 4.2 Flow

```
Pick .gdb.zip
  → POST /api/gdb/inspect (multipart)      → { blobHash, inspection, suggestedPlan }
  → GdbImportDialog (edit plan, live validation)
  → Import:
      → api.createVenue(plan.venueName)     → { id }
      → POST /api/gdb/publish { venueId, blobHash, plan } → { jobId, versionId, seq }
      → api.waitForJob(jobId)               → done | error
  → refresh gallery
```

### 4.3 Review dialog

Ported and adapted from the branch's `GdbImportDialog`, driven entirely by the server response:

- **Venue name** — editable text, seeded from `suggestedPlan.venueName`.
- **Buildings** — add, rename, delete; seeded from the suggestion's structured-prefix groups.
- **Layer table** — one row per inspected layer, paginated (100 rows/page) with a name filter:
  - Include checkbox.
  - Database / layer name (read-only).
  - Feature count / geometry family (read-only).
  - Target type dropdown, restricted to types compatible with the layer's geometry family.
  - Building dropdown.
  - Level rule dropdown: source-reference / property / layer-name / fixed / none, with the field or fixed label+ordinal inputs the chosen kind requires.
  - Field-mapping dropdowns: id, ordinal, short-name, name, category — each listing the layer's fields plus "(none)".
- **Summary** — count of included layers and their total features.
- **Inspection warnings** — from `inspection.warnings`.
- **Blocking issues** — computed live from the edited plan; Import is disabled while non-empty.

### 4.4 Blocking issues (client, structural only)

Computed without conversion, from plan + inspection:

- A target type incompatible with (or missing for) the layer's geometry family.
- No level included and no fixed/property-derived level present.
- A level layer with no assigned building.
- A level layer with no resolvable ordinal source (ordinal/short-name/name field, layer-name token, property rule, or fixed rule).
- A non-level layer with no level rule.
- A non-level layer that needs a building or a source-reference rule but has neither.
- A fixed level rule missing a label or finite ordinal.
- A selected field that does not exist on the layer.

Deeper conversion failures (unresolved cross-layer references, empty converted layers) cannot be detected without running gdal and surface from `/publish` (§4.5).

### 4.5 Error handling

- **Inspect failures** (`invalid_geodatabase`, `gdb_too_large`, `gdb_inspection_failed`) render as localized copy in the dialog's pre-review state; no venue is created.
- **Structural problems** are caught live and never reach the server (Import disabled).
- **Synchronous publish 400** (`gdb_conversion_failed`, raised by conversion or `buildGdbImdf` before any version row exists): the just-created venue is deleted to avoid an empty orphan, and the failure is shown with the blamed layer and reason.
- **Accepted publish (202) then failed job**: the failed version remains visible, exactly as the IMDF flow leaves a failed version on a failed compile.

## 5. Architecture

### 5.1 Server change (minimal)

`/api/gdb/inspect` additionally returns `suggestedPlan`, computed by the existing `suggestGdbMapping(inspection)`. `GdbInspectResponse` gains `suggestedPlan: GdbMappingPlan`; the route's 200 schema adds the field. The server remains the single source of truth for suggestion; no other server changes.

### 5.2 Client units

- **`src/gdb/types.ts`** — a client mirror of the GDB API contract types (`GdbInspection`, `GdbLayerDescriptor`, `GdbFieldDescriptor`, `GdbLayerKey`, `GdbMappingPlan`, `GdbLayerPlan`, `GdbLevelRule`, `GdbBuildingPlan`, `GdbTargetType`, `GdbGeometryFamily`, `GdbInspectResponse`) plus `gdbLayerKeyString`. Mirrors server shapes the same way `gallery/api.ts` mirrors `VenueRow`/`VenueSummary`.
- **`src/gdb/planValidation.ts`** — pure, React-free structural helpers only: `gdbTargetTypesForGeometry`, `isGdbTargetGeometryCompatible`, `structuredFloorOrdinal`/`layerNameFloorOrdinal`, and `collectBlockingIssues(plan, inspection) → BlockingIssue[]`. No `suggestGdbMapping`, no `buildGdbImdf`, no conversion.
- **`src/components/GdbImportDialog.tsx`** — presentation plus local editable-plan state; props `{ inspection, suggestedPlan, blobHash, locale, onCancel, onPublished }`; depends on `planValidation` and the API types. If it grows large, extract `LayerRow` and `BuildingsEditor` subcomponents so each file stays focused.
- **`src/gallery/api.ts`** — add `inspectGdb(file, onProgress?)` (XHR multipart, mirroring `uploadVersion` for progress), `publishGdb(venueId, blobHash, plan)`; reuse `waitForJob`; add a `gdbErrorMessage` map for the GDB error codes.
- **`src/gallery/GalleryPage.tsx`** — the "Import Geodatabase" button and an orchestration state machine (idle → inspecting → review → publishing → done/failed), including the create-venue-then-publish sequence and the orphan-venue cleanup on a synchronous 400.

### 5.3 Boundaries

- `api.ts` owns the network contract only.
- `planValidation.ts` is pure and independently testable.
- `GdbImportDialog.tsx` owns presentation and local plan state.
- `GalleryPage.tsx` owns orchestration between the picker, inspect, dialog, and publish.

## 6. Testing

- **`planValidation`** unit tests: blocking-issue rules, geometry compatibility, floor-token resolution.
- **`GdbImportDialog`** React Testing Library tests (jsdom): renders the suggested plan; editing a target type updates the blocking-issue list; Import is disabled while blocking issues exist; Import sends the edited plan to a mocked `api`.
- **`api.test.ts`** additions: `inspectGdb` and `publishGdb` request shapes (mocked `fetch`/`XHR`), following the existing test pattern.
- **Server**: assert `/api/gdb/inspect` returns `suggestedPlan`; keep the real-fixture `gdbSmoke` end-to-end test as the integration proof.

## 7. Success criteria

- Dropping `JRTokyoSta_3857.gdb.zip` through the gallery inspects, presents a near-publish-ready plan, publishes with no manual edits beyond exceptions, and the venue appears and renders in the gallery.
- Structurally invalid edits disable Import with clear, localized blocking-issue text.
- A conversion failure surfaces the blamed layer and reason without leaving an empty orphan venue.
- The direct IMDF upload/publish path is unchanged.
- Focused web and server test commands pass.
