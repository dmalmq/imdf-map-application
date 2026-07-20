# Point-Facility POIs — Markers + Route-to-Facility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import point facilities as a third combined-GDB layer, render them as floor-aware GL symbol markers, and route to a tapped facility via its pre-linked network node.

**Architecture:** New pure crate `kiriko-facilities` parses `point_facility_network` GeoJSON into `Facilities`, resolving each facility's `nodeid1` to a route anchor via the graph's `NODEID → index` map (now returned by `kiriko-route`). `kiriko-bundle` gains KVB §7 `facilities`; `kiriko-node` compile embeds it; `kiriko-wasm` exposes `facilities()` + `hasFacilities`. The TS server extracts the facility layer to GeoJSON (gdal3.js) and threads it through publish; the client GDB flow gains a third optional file; the viewer adds a GL symbol layer with tap → **Route here** reusing the shipped A\*.

**Tech Stack:** Rust (edition 2024), `geojson`, `postcard`, napi-rs 3, wasm-bindgen, React/MapLibre/Vitest, Fastify + gdal3.js.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-point-facility-poi-design.md`.
- Source layer: `point_facility_network`. Anchor from `nodeid1` only.
- Icons: `image` basename (sans extension) → `src/map/icons/marker/<name>.png` if present, else generic `pin`.
- KVB §7 `facilities`, version 1, optional, postcard DTO, emitted only when non-empty; backward compatible (older decoders ignore it); id-ascending directory (…,5,7).
- GDAL stays in TypeScript; all facility interpretation in Rust.
- Venue-only and venue+network imports stay byte-identical (no §7).
- Facilities without a graph: render-only, anchors `None` (no route-to).
- Deferred: wifi/beacon/floor_all/not_ar layers, store/building icons, name search, `nodeid2`.
- TDD; `cargo test` for Rust, `pnpm exec tsc --noEmit` + Vitest for TS; commit per task; no push.

## File map

| File | Role |
|------|------|
| `core/crates/kiriko-route/src/build.rs`, `graph.rs`/`lib.rs` | return `node_ids: Vec<u64>` parallel to nodes |
| `core/crates/kiriko-facilities/*` | new crate: types + build |
| `core/Cargo.toml` | add member |
| `core/crates/kiriko-bundle/{Cargo.toml,src/format.rs,sections.rs,codec.rs}` | §7 codec + `facilities` on doc |
| `core/crates/kiriko-node/src/lib.rs`, `kiriko-bundle/src/codec.rs` | compile threads facilities GeoJSON |
| `core/crates/kiriko-wasm/src/lib.rs` | `facilities()` + `hasFacilities` |
| `server/src/gdb/{facilities.ts,routes.ts,types.ts}`, `core/native.ts`, `jobs/publish.ts` | extract + inspect + publish |
| `src/gdb/types.ts`, `src/gallery/{api.ts,GalleryPage.tsx,GdbImportDialog.tsx}`, `src/imdf/types.ts` | third file + summary + warning code |
| `src/bundle/*`, `src/map/*`, `src/app/*` | facilities symbol layer + tap + Route here |

---

### Task 1: `kiriko-route` returns NODEID→index mapping

**Files:** Modify `core/crates/kiriko-route/src/build.rs`, `src/graph.rs` (or a new return struct), `src/lib.rs`; update `core/crates/kiriko-bundle/src/codec.rs` caller.

**Interfaces (Produces):**

```rust
pub struct RouteGraphBuild {
    pub graph: RouteGraph,
    pub warnings: Vec<RouteBuildWarning>,
    pub node_ids: Vec<u64>, // node_ids[i] = source NODEID of graph.nodes[i]
}
pub fn build_route_graph(
    junctions_geojson: &str, paths_geojson: &str, level_ordinals: &[f64],
) -> Result<RouteGraphBuild, RouteBuildError>;
```

- [ ] **Step 1: Update tests** in `build.rs` for the new return type; add:

```rust
#[test]
fn returns_node_ids_parallel_to_nodes() {
    let b = build_route_graph(JUNCTIONS, PATHS, &[0.0, 1.0]).unwrap();
    assert_eq!(b.node_ids.len(), b.graph.nodes.len());
    // NODEID 1 maps to the node at its index
    let idx = b.node_ids.iter().position(|&id| id == 1).unwrap();
    assert!((b.graph.nodes[idx].lon - 139.0).abs() < 1e-9);
}
```
Change existing tests from tuple destructuring `let (g, warns) = ...` to `let b = ...; b.graph / b.warnings`.

- [ ] **Step 2: Run — RED**: `cargo test -p kiriko-route` (compile failures + new test).

- [ ] **Step 3: Implement** — return `RouteGraphBuild`. `node_ids` = `by_id.keys().copied().collect()` captured **before** `by_id.into_values()` (same BTreeMap order as nodes and as `index`). Keep `graph`/`warnings` as today.

```rust
let node_ids: Vec<u64> = by_id.keys().copied().collect();
let nodes: Vec<RouteNode> = by_id.into_values().collect();
// ...warnings loop...
Ok(RouteGraphBuild { graph: RouteGraph { nodes, edges }, warnings, node_ids })
```
Export `RouteGraphBuild` from `lib.rs`.

- [ ] **Step 4: Update caller** in `kiriko-bundle/src/codec.rs` `compile_imdf_with_network`: `let build = kiriko_route::build_route_graph(...)?; ... document.graph = Some(build.graph)` and fold `build.warnings`. (Keep behavior identical.)

- [ ] **Step 5: Run — GREEN**: `cargo test -p kiriko-route -p kiriko-bundle`.

- [ ] **Step 6: Commit**

```bash
git add core/crates/kiriko-route core/crates/kiriko-bundle/src/codec.rs
git commit -m "feat(core): route build returns NODEID->index mapping"
```

---

### Task 2: `kiriko-facilities` crate

**Files:** Create `core/crates/kiriko-facilities/{Cargo.toml,src/lib.rs,src/build.rs,src/types.rs}`; modify `core/Cargo.toml` members.

**Interfaces (Produces):**

```rust
pub struct Facilities { pub items: Vec<Facility> }
pub struct Facility { pub lon: f64, pub lat: f64, pub ordinal: f64,
    pub name: String, pub icon: String, pub anchor: Option<FacilityAnchor> }
pub struct FacilityAnchor { pub lon: f64, pub lat: f64, pub ordinal: f64 }
pub struct FacilityBuildWarning { pub code: String, pub detail: String }
pub struct FacilityBuildError { pub message: String }
pub fn build_facilities(
    facilities_geojson: &str,
    graph: &kiriko_route::RouteGraph,
    node_ids: &[u64],
) -> Result<(Facilities, Vec<FacilityBuildWarning>), FacilityBuildError>;
```

- [ ] **Step 1: `Cargo.toml`**

```toml
[package]
name = "kiriko-facilities"
edition.workspace = true
rust-version.workspace = true
license.workspace = true

[dependencies]
geojson.workspace = true
serde.workspace = true
kiriko-route = { path = "../kiriko-route" }
```
Add `"crates/kiriko-facilities"` to `core/Cargo.toml` members.

- [ ] **Step 2: Failing tests** in `build.rs`:

```rust
const FAC: &str = r#"{"type":"FeatureCollection","features":[
 {"type":"Feature","properties":{"name":"Store A","floor":"F1","image":"/marker/ticket.png","nodeid1":10},"geometry":{"type":"Point","coordinates":[139.0,35.0]}},
 {"type":"Feature","properties":{"name":"Store B","floor":"F1","image":"","nodeid1":-1},"geometry":{"type":"Point","coordinates":[139.001,35.0]}},
 {"type":"Feature","properties":{"name":"Bad","floor":"garbage","image":"","nodeid1":10},"geometry":{"type":"Point","coordinates":[139.0,35.0]}}]}"#;

fn graph() -> (kiriko_route::RouteGraph, Vec<u64>) {
    (kiriko_route::RouteGraph {
        nodes: vec![kiriko_route::RouteNode { lon: 139.5, lat: 35.5, ordinal: 0.0 }],
        edges: vec![],
    }, vec![10])
}

#[test]
fn builds_with_icon_and_anchor() {
    let (g, ids) = graph();
    let (f, warns) = build_facilities(FAC, &g, &ids).unwrap();
    assert_eq!(f.items.len(), 2); // "Bad" dropped (unmapped floor)
    let a = f.items.iter().find(|x| x.name == "Store A").unwrap();
    assert_eq!(a.icon, "ticket");
    assert_eq!(a.anchor, Some(FacilityAnchor { lon: 139.5, lat: 35.5, ordinal: 0.0 }));
    let b = f.items.iter().find(|x| x.name == "Store B").unwrap();
    assert_eq!(b.icon, "");
    assert_eq!(b.anchor, None); // nodeid1 = -1
    assert!(warns.iter().any(|w| w.code == "unmapped_floor"));
}

#[test]
fn deterministic() {
    let (g, ids) = graph();
    assert_eq!(build_facilities(FAC, &g, &ids).unwrap().0, build_facilities(FAC, &g, &ids).unwrap().0);
}
```

- [ ] **Step 3: Run — RED**: `cargo test -p kiriko-facilities`.

- [ ] **Step 4: Implement** — parse FeatureCollection; per feature: `name` (trim, default ""), Point coords, `floor`→`kiriko_route::floor_to_ordinal` (None → drop + `unmapped_floor`); `icon` = basename of `image` without extension (`/marker/ticket.png`→`ticket`; ""→""); `anchor`: read `nodeid1` as i64; if `>= 0` and present in a `node_ids`→index map, set anchor from `graph.nodes[idx]`, else `None` + `unresolved_anchor` warning. Build `BTreeMap<u64,u32>` from `node_ids`. Sort items by `(ordinal, lon, lat, name)`. Malformed JSON → `FacilityBuildError`. `#[derive(PartialEq)]` on types for tests.

- [ ] **Step 5: Run — GREEN**: `cargo test -p kiriko-facilities`.

- [ ] **Step 6: Commit**

```bash
git add core/Cargo.toml core/crates/kiriko-facilities
git commit -m "feat(core): kiriko-facilities crate — parse facilities + resolve anchors"
```

---

### Task 3: KVB §7 facilities encode/decode

**Files:** Modify `core/crates/kiriko-bundle/Cargo.toml` (add `kiriko-facilities`), `src/format.rs`, `src/sections.rs`, `src/codec.rs`, `tests/bundle.rs`.

**Interfaces:** `BundleDocument.facilities: Option<kiriko_facilities::Facilities>`.

- [ ] **Step 1: `format.rs`** — add `pub(crate) const SECTION_FACILITIES: u16 = 7;` (document id 7); leave `REQUIRED_SECTIONS` unchanged.

- [ ] **Step 2: Failing tests** (`sections.rs` or `codec.rs` tests): §7 round-trips; absent → `None`; malformed §7 (e.g. anchor with non-finite) rejected; §5 and §7 coexist with directory ids ascending. Mirror the §5 graph tests.

- [ ] **Step 3: Run — RED**: `cargo test -p kiriko-bundle facilit`.

- [ ] **Step 4: Implement** — `Cargo.toml`: `kiriko-facilities = { path = "../kiriko-facilities" }`. `sections.rs`: `FacilitiesSectionDto { items: Vec<FacilityDto> }`, `FacilityDto { lon, lat, ordinal, name, icon, anchor: Option<AnchorDto> }`, `AnchorDto { lon, lat, ordinal }`; `encode_facilities`/`decode_facilities` with `canonical_f64` on all coords. `codec.rs`: add `pub facilities: Option<Facilities>` to `BundleDocument` (update constructors/doc-tests + `tests/bundle.rs` `minimal_document`); `encode_bundle` pushes `(SECTION_FACILITIES, SECTION_VERSION, encode_facilities)` when `Some` & non-empty (after §5); `decode_bundle` reads §7 → `facilities`; `compile_imdf` sets `None`.

- [ ] **Step 5: Run — GREEN**: `cargo test -p kiriko-bundle`.

- [ ] **Step 6: Commit**

```bash
git add core/crates/kiriko-bundle
git commit -m "feat(core): KVB section 7 facilities encode/decode"
```

---

### Task 4: compile embeds facilities + warning plumbing

**Files:** Modify `core/crates/kiriko-bundle/src/codec.rs` (+`error.rs`), `core/crates/kiriko-model/src/model.rs` (WarningCode), `core/crates/kiriko-node/src/lib.rs`; `server/src/core/native.ts`, `src/imdf/types.ts`.

**Interfaces:** `compile_imdf_with_network(..., facilities_geojson: Option<&str>)`; napi `compileImdf(..., networkJunctionsGeoJson?, networkPathsGeoJson?, facilitiesGeoJson?)`.

- [ ] **Step 1: Failing test** in `kiriko-bundle`: compile with IMDF + network + facilities GeoJSON → `decode_bundle(bundle).facilities.is_some()` with expected item; compile without facilities → `None`.

- [ ] **Step 2: RED**: `cargo test -p kiriko-bundle compile`.

- [ ] **Step 3: Implement** — extend `compile_imdf_with_network` with `facilities_geojson: Option<&str>`: after graph build, if facilities GeoJSON present and a graph exists, call `kiriko_facilities::build_facilities(&graph, &build.node_ids)`; if no graph, build with an empty graph + empty node_ids (anchors all `None`) and warn. Set `document.facilities` when non-empty. Add `WarningCode::FacilityBuild` (model) + `WarningCodeDto` variant (append last for postcard stability) + fold facility warnings as `ViewerWarning`. Update `compile_imdf` to pass `None`.

- [ ] **Step 4: napi** — `kiriko-node/src/lib.rs`: add optional `facilities_geojson: Option<String>` to the compile binding/task; call the extended entry.

- [ ] **Step 5: Bridge allowlist** — add `"facility_build"` to `ViewerWarningCode` + `WARNING_CODES` in `server/src/core/native.ts`, and to `src/imdf/types.ts` `ViewerWarningCode` (same pattern as `route_build`).

- [ ] **Step 6: Build addon** — `pnpm --filter @kiriko/node build`; confirm `index.d.ts` shows `facilitiesGeoJson`.

- [ ] **Step 7: GREEN + tsc**: `cargo test -p kiriko-bundle`; `pnpm --dir server exec tsc --noEmit`; `pnpm exec tsc --noEmit`.

- [ ] **Step 8: Commit**

```bash
git add core server/src/core/native.ts src/imdf/types.ts
git commit -m "feat(core): compile embeds facilities section from GeoJSON"
```

---

### Task 5: `kiriko-wasm` facilities accessor

**Files:** Modify `core/crates/kiriko-wasm/Cargo.toml` (add `kiriko-facilities` if needed), `src/lib.rs`; rebuild `pkg`.

**Interfaces:** `decodeBundle` result gains `hasFacilities`; new `facilities(bundle) → [{lon,lat,ordinal,name,icon,anchor:{lon,lat,ordinal}|null}]`.

- [ ] **Step 1: Rust test** — decode a bundle built with facilities → `facilities()` returns the items; `hasFacilities` true; a §7-less bundle → empty + false.

- [ ] **Step 2: RED**: `cargo test -p kiriko-wasm`.

- [ ] **Step 3: Implement** — add `has_facilities` to the decode DTO (mirror `has_graph`); `#[wasm_bindgen(js_name = "facilities")] pub fn facilities_js(bundle: &[u8]) -> Result<JsValue, JsError>` decoding and serializing a `FacilityDto` list (camelCase, `anchor` null when `None`).

- [ ] **Step 4: Build wasm** — `pnpm --filter @kiriko/wasm build`; confirm `pkg` exports `facilities` + `hasFacilities`.

- [ ] **Step 5: Commit**

```bash
git add core/crates/kiriko-wasm/src core/crates/kiriko-wasm/Cargo.toml
git commit -m "feat(core): wasm facilities accessor + hasFacilities flag"
```

---

### Task 6: server — extract + inspect-facilities + publish

**Files:** Create `server/src/gdb/facilities.ts`; modify `server/src/gdb/{routes.ts,types.ts}`, `server/src/jobs/publish.ts`, `server/src/core/native.ts` (metadata field); test `server/test/gdbFacilities.test.ts`.

**Interfaces:** `POST /api/gdb/inspect-facilities` → `{ facilitiesBlobHash, facilityCount, floors }`; `GdbPublishRequest.facilitiesBlobHash?`.

- [ ] **Step 1: `facilities.ts`** — `extractFacilitiesGeoJson(stagedPath) → { geojson: string, facilityCount: number, floors: string[] }` via gdal `ogr2ogr point_facility_network` → WGS84 GeoJSON; throw `GdbSourceError("missing_facility_layer")` if the layer is absent. Reuse `serializeGdalOperation` + output cap (mirror `network.ts`).

- [ ] **Step 2: Failing test** `gdbFacilities.test.ts` (mirror `gdbNetwork.test.ts` mocking): extract returns count/floors; `inspect-facilities` returns summary; publish with `facilitiesBlobHash` (and networkBlobHash) → compile receives facilities GeoJSON (assert via compile mock / decode); publish without → unchanged; missing layer → 400.

- [ ] **Step 3: RED**: `pnpm --dir server exec vitest run gdbFacilities`.

- [ ] **Step 4: Implement** — add `inspect-facilities` route (stage, extract, summary, `removeStagedGdb` finally); `GdbPublishSchema` + request gain optional `facilitiesBlobHash`; publish re-opens/stages the facilities blob, extracts GeoJSON, stores as blob, threads its hash through the publish job payload → `compileImdf(..., facilitiesGeoJson)`; `CompileVenueMetadata` gains `facilitiesGeoJson?`. 404 missing blob; 400 missing layer. `types.ts` (server) + mirror in `src/gdb/types.ts`: `FacilitiesInspectResponse`, `facilitiesBlobHash`.

- [ ] **Step 5: GREEN + tsc**: `pnpm --dir server exec vitest run gdb && pnpm --dir server exec tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add server/src server/test
git commit -m "feat(server): combined import — point-facility extract + section 7"
```

---

### Task 7: client — optional facility file + summary

**Files:** Modify `src/gdb/types.ts`, `src/gallery/api.ts`, `src/gallery/GalleryPage.tsx`, `src/gallery/GdbImportDialog.tsx`; tests `GdbImportDialog.test.tsx`, `gallery.test.tsx`.

**Interfaces:** `api.inspectGdbFacilities(file)`, `publishGdb(..., facilitiesBlobHash?)`; dialog facility summary.

- [ ] **Step 1: Failing tests** — dialog shows "Facilities: N places, K floors" when a facility summary is attached, hidden otherwise; publish includes `facilitiesBlobHash` when added. Keep network + existing GDB tests green.

- [ ] **Step 2: RED**: `pnpm exec vitest run GdbImportDialog gallery.test`.

- [ ] **Step 3: Implement** — `src/gdb/types.ts` mirrors `FacilitiesInspectResponse`; `api.inspectGdbFacilities(file)`; `publishGdb` gains optional `facilitiesBlobHash` (appended to body when present); GalleryPage GDB flow: a second optional "Add point facilities" input → `inspectGdbFacilities` → store summary/hash → dialog renders summary → publish passes hash. Bilingual copy (`施設: N件 / Facilities: N places`).

- [ ] **Step 4: GREEN + tsc**: `pnpm exec vitest run GdbImportDialog gallery.test && pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/gdb src/gallery
git commit -m "feat(web): optional point-facility selection in GDB import"
```

---

### Task 8: viewer — facility symbol layer + Route here

**Files:** Modify bundle worker + `src/bundle/*` (decode facilities, `hasFacilities`), `src/map/*` (symbol layer + icon images), `src/app/*` (toggle, tap popup, Route here). Tests in `src/bundle`, `src/map`, `src/app`.

**Interfaces:** Consumes wasm `facilities()`/`hasFacilities`; reuses `routeKirikoBundle`.

- [ ] **Step 1: Study** how §5/route was wired in the routing slice (`src/bundle/routeKirikoBundle.ts`, `src/map/routeFeatures.ts`, viewer Directions) and the icon-import pattern (`src/map/markerIcons.ts`); mirror them.

- [ ] **Step 2: Failing tests** — (a) facilities decoded + exposed (`hasFacilities`); (b) symbol layer source contains only active-floor facilities and switches with level; (c) icon resolves to staged name or `pin` fallback; (d) tap a facility → popup with name; **Route here** with an anchor calls route and draws a line; anchor-less disables **Route here**. Mock the worker/wasm facility + route calls.

- [ ] **Step 3: RED**: `pnpm exec vitest run src/bundle src/map src/app`.

- [ ] **Step 4: Implement**
  - Bundle worker: expose decoded facilities + `hasFacilities`; add a `facilities` message (or include in decode result).
  - Icons: import the staged `src/map/icons/marker/*.png` and a `pin`; register as MapLibre images (`map.addImage`), keyed by basename.
  - Symbol layer `LAYER_FACILITIES` on a dedicated GeoJSON source: `icon-image` = `["coalesce",["image",["get","icon"]],["image","pin"]]`, filtered to active ordinal, `text-field` = `name` at close zoom, zoom range from source min/max (fold into layer `minzoom`/stops). Facility layer toggle control.
  - Tap handler on the symbol layer: popup with name + floor; **Route here** → if origin set, route origin→anchor; else enter Directions "tap start" then route; draw with existing route layer. Disable when `anchor` null.

- [ ] **Step 5: GREEN + tsc**: `pnpm exec vitest run src/bundle src/map src/app && pnpm exec tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat(web): facility markers + Route here"
```

---

### Task 9: verification + Tokyo smoke

**Files:** none (fixes only).

- [ ] **Step 1:** `cargo test --manifest-path core/Cargo.toml --workspace`.
- [ ] **Step 2:** `pnpm core:build` (node + wasm).
- [ ] **Step 3:** `pnpm exec tsc --noEmit` and `pnpm --dir server exec tsc --noEmit`.
- [ ] **Step 4:** `pnpm exec vitest run` and `pnpm --dir server exec vitest run`.
- [ ] **Step 5: Manual smoke** — zip `tokyo station/point_facility_WebMercator_202006.gdb`; import venue + network + point-facility together → publish → open viewer → facility markers appear floor-filtered with icons/pins → tap a store → **Route here** → route drawn. Screenshot.
- [ ] **Step 6:** Commit any fixes.

---

## Spec coverage

| Spec section | Task |
|---|---|
| §5 kiriko-facilities | 2 (dep: 1) |
| §6 KVB §7 | 3 |
| §7 compile integration + warning | 4 |
| §8 wasm | 5 |
| §9 server | 6 |
| §10 client | 7 |
| §11 viewer | 8 |
| §12–13 testing + success | 1–9 |

## Self-review notes

- Types threaded consistently: `RouteGraphBuild.node_ids`, `build_facilities`, `Facilities/Facility/FacilityAnchor`, `BundleDocument.facilities`, `SECTION_FACILITIES=7`, `facilitiesGeoJson`, `facilities()`/`hasFacilities`, `inspectGdbFacilities`, `facilitiesBlobHash`, `LAYER_FACILITIES`.
- Backward compatibility: Task 3 absent-section test; required sections unchanged.
- Warning code `facility_build` added to Rust model, server bridge, and client type together (Task 4), mirroring the routing slice's `route_build` fix so publish never fails on it.

## Execution handoff

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between.
2. **Inline Execution** — batch with checkpoints.
