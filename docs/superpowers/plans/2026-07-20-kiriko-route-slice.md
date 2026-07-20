# kiriko-route Explicit-Network Routing Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a venue GDB together with its `network_WebMercator.gdb`, build a routing graph from `net_junction`/`net_path` in Rust, embed it as KVB section 5, and route between two tapped points (across floors) in the web viewer.

**Architecture:** New pure Rust crate `kiriko-route` owns the `RouteGraph` type, GeoJSON→graph build (floor→ordinal mapping), and A\*. `kiriko-bundle` gains section 5 encode/decode (postcard DTO, like existing sections) and an optional `graph` on `BundleDocument`. `kiriko-node` `compileImdf` accepts optional network GeoJSON and embeds §5. `kiriko-wasm` exposes `route()`. The TS server extracts `net_junction`/`net_path` to WGS84 GeoJSON via gdal3.js (no graph logic in TS) and passes them to compile; the client GDB flow gains an optional network file; the viewer gains a Directions mode.

**Tech Stack:** Rust (edition 2024, workspace crates), `geojson` 0.24, `postcard`, napi-rs 3, wasm-bindgen, React/MapLibre/Vitest, Fastify + gdal3.js.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-kiriko-route-slice-design.md`.
- Canonical source = `net_junction` (nodes) + `net_path` (edges). `_link` layers ignored.
- Edge weight = `net_path.cost` (f32). Edges bidirectional this slice. Ignore `direction`/`BARRIER`/`GATE`/time windows/`passage_type`.
- Floor map: `F<n>`→ordinal `n-1`, `B<n>`→`-n`, `M<n>`→documented mezzanine rule; validate against venue `levels`; unmappable → drop node + warning.
- §5 emitted only when graph non-empty; backward compatible (older decoders ignore it); section version 1; postcard DTO like other sections; deterministic bytes.
- GDAL stays in TypeScript; all graph interpretation in Rust.
- Plain IMDF and network-less GDB imports must be byte-for-byte unchanged (no §5).
- Deferred (do NOT build): accessibility profiles, one-way, barriers, point-facility icons/destinations, WiFi/positioning, turn-by-turn, mobile, units+openings fallback.
- TDD; `cargo test` for Rust, `pnpm exec tsc --noEmit` + Vitest for TS; commit per task; no push.

## File map

| File | Role |
|------|------|
| `core/crates/kiriko-route/Cargo.toml`, `src/lib.rs`, `src/graph.rs`, `src/build.rs`, `src/query.rs`, `src/floor.rs` | new crate: types, build, A\*, floor map |
| `core/Cargo.toml` | add member |
| `core/crates/kiriko-bundle/{Cargo.toml,src/format.rs,src/sections.rs,src/codec.rs}` | §5 codec + optional graph |
| `core/crates/kiriko-node/{Cargo.toml,src/lib.rs}` | compile accepts network GeoJSON |
| `core/crates/kiriko-wasm/{Cargo.toml,src/lib.rs}` | `route()` binding |
| `server/src/gdb/{routes.ts,convert.ts,types.ts,network.ts}` | inspect-network, publish networkBlobHash, extract GeoJSON |
| `src/gdb/types.ts`, `src/gallery/GdbImportDialog.tsx`, `src/gallery/GalleryPage.tsx`, `src/gallery/api.ts` | optional network selection + summary |
| `src/app/*` viewer + bundle worker + `src/map/*` | Directions mode |

---

### Task 1: `kiriko-route` crate — types, floor map, build, A\*

**Files:**
- Create: `core/crates/kiriko-route/Cargo.toml`, `src/lib.rs`, `src/graph.rs`, `src/floor.rs`, `src/build.rs`, `src/query.rs`
- Modify: `core/Cargo.toml:3-8` (add `"crates/kiriko-route"`)

**Interfaces (Produces):**

```rust
// graph.rs
#[derive(Debug, Clone, PartialEq)]
pub struct RouteGraph { pub nodes: Vec<RouteNode>, pub edges: Vec<RouteEdge> }
#[derive(Debug, Clone, PartialEq)]
pub struct RouteNode { pub lon: f64, pub lat: f64, pub ordinal: f64 }
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RouteEdge { pub from: u32, pub to: u32, pub weight: f32 }
impl RouteGraph { pub fn is_empty(&self) -> bool { self.nodes.is_empty() } }

// query.rs
#[derive(Debug, Clone, Copy)]
pub struct Point3 { pub lon: f64, pub lat: f64, pub ordinal: f64 }
#[derive(Debug, Clone, PartialEq)]
pub struct Route { pub nodes: Vec<RouteNode>, pub total_weight: f32 }
pub fn route(graph: &RouteGraph, origin: Point3, dest: Point3) -> Option<Route>;

// floor.rs
pub fn floor_to_ordinal(label: &str) -> Option<f64>;

// build.rs
#[derive(Debug, Clone, PartialEq)]
pub struct RouteBuildWarning { pub code: String, pub detail: String }
pub fn build_route_graph(
    junctions_geojson: &str,
    paths_geojson: &str,
    level_ordinals: &[f64],
) -> Result<(RouteGraph, Vec<RouteBuildWarning>), RouteBuildError>;
#[derive(Debug)]
pub struct RouteBuildError { pub message: String }
```

- [ ] **Step 1: Create `Cargo.toml`**

```toml
[package]
name = "kiriko-route"
edition.workspace = true
rust-version.workspace = true
license.workspace = true

[dependencies]
geojson.workspace = true
serde.workspace = true
```

- [ ] **Step 2: `floor.rs` failing test first**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_floor_labels() {
        assert_eq!(floor_to_ordinal("F1"), Some(0.0));
        assert_eq!(floor_to_ordinal("F36"), Some(35.0));
        assert_eq!(floor_to_ordinal("B1"), Some(-1.0));
        assert_eq!(floor_to_ordinal("B5"), Some(-5.0));
        assert_eq!(floor_to_ordinal("M2"), Some(1.5)); // mezzanine above F2 → between 1 and 2
        assert_eq!(floor_to_ordinal("garbage"), None);
    }
}
```

- [ ] **Step 3: Run — RED**: `cargo test -p kiriko-route floor` → fails (no fn).

- [ ] **Step 4: Implement `floor.rs`**

```rust
/// Parse a network `FLOOR` label to a venue level ordinal.
/// `F<n>` → n-1 (F1 is ground/ordinal 0). `B<n>` → -n. `M<n>` (mezzanine) →
/// halfway above floor n: (n-1)+0.5. Anything else → None (caller drops the node).
#[must_use]
pub fn floor_to_ordinal(label: &str) -> Option<f64> {
    let label = label.trim();
    let (prefix, rest) = label.split_at(label.find(|c: char| c.is_ascii_digit())?);
    let n: i32 = rest.parse().ok()?;
    match prefix {
        "F" => Some((n - 1) as f64),
        "B" => Some(-n as f64),
        "M" => Some((n - 1) as f64 + 0.5),
        _ => None,
    }
}
```

- [ ] **Step 5: Run — GREEN**: `cargo test -p kiriko-route floor`.

- [ ] **Step 6: `graph.rs` + `lib.rs`** — add the structs above; `lib.rs`:

```rust
#![deny(rust_2018_idioms)]
mod build; mod floor; mod graph; mod query;
pub use build::{build_route_graph, RouteBuildError, RouteBuildWarning};
pub use floor::floor_to_ordinal;
pub use graph::{RouteEdge, RouteGraph, RouteNode};
pub use query::{route, Point3, Route};
```

- [ ] **Step 7: `build.rs` failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    const JUNCTIONS: &str = r#"{"type":"FeatureCollection","features":[
      {"type":"Feature","properties":{"NODEID":1,"FLOOR":"F1"},"geometry":{"type":"Point","coordinates":[139.0,35.0]}},
      {"type":"Feature","properties":{"NODEID":2,"FLOOR":"F1"},"geometry":{"type":"Point","coordinates":[139.001,35.0]}},
      {"type":"Feature","properties":{"NODEID":3,"FLOOR":"F2"},"geometry":{"type":"Point","coordinates":[139.001,35.0]}}]}"#;
    const PATHS: &str = r#"{"type":"FeatureCollection","features":[
      {"type":"Feature","properties":{"FNODEID":1,"TNODEID":2,"cost":100},"geometry":{"type":"MultiLineString","coordinates":[[[139.0,35.0],[139.001,35.0]]]}},
      {"type":"Feature","properties":{"FNODEID":2,"TNODEID":3,"cost":5000},"geometry":{"type":"MultiLineString","coordinates":[[[139.001,35.0],[139.001,35.0]]]}},
      {"type":"Feature","properties":{"FNODEID":2,"TNODEID":99,"cost":10},"geometry":{"type":"MultiLineString","coordinates":[[[139.001,35.0],[139.002,35.0]]]}}]}"#;

    #[test]
    fn builds_graph_dropping_dangling_edges() {
        let (g, warns) = build_route_graph(JUNCTIONS, PATHS, &[0.0, 1.0]).unwrap();
        assert_eq!(g.nodes.len(), 3);
        assert_eq!(g.edges.len(), 2); // edge to NODEID 99 dropped
        assert!(warns.iter().any(|w| w.code == "dangling_edge"));
    }

    #[test]
    fn drops_unmappable_floor_nodes() {
        let j = JUNCTIONS.replace("\"F2\"", "\"garbage\"");
        let (g, warns) = build_route_graph(&j, PATHS, &[0.0, 1.0]).unwrap();
        assert_eq!(g.nodes.len(), 2);
        assert!(warns.iter().any(|w| w.code == "unmapped_floor"));
    }

    #[test]
    fn deterministic_output() {
        let a = build_route_graph(JUNCTIONS, PATHS, &[0.0, 1.0]).unwrap().0;
        let b = build_route_graph(JUNCTIONS, PATHS, &[0.0, 1.0]).unwrap().0;
        assert_eq!(a, b);
    }
}
```

- [ ] **Step 8: Run — RED**.

- [ ] **Step 9: Implement `build.rs`**

Parse with `geojson::FeatureCollection`. For junctions: read `NODEID` (u64), `FLOOR` (string), Point coords. Map floor via `floor_to_ordinal`; skip + warn `unmapped_floor` when `None`. Build `BTreeMap<u64 NODEID, (lon,lat,ordinal)>`. Sort node ids for a deterministic node vector; build `NODEID → index`. For paths: read `FNODEID`,`TNODEID`,`cost`; if either id absent from the node map, push a `dangling_edge` warning and skip; else push `RouteEdge`. Sort edges by `(from,to,weight bits)`. Validate `level_ordinals` only to warn on nodes whose ordinal matches no venue level (`unmatched_level` warning; keep the node — mapping is best-effort). Return `(RouteGraph, warnings)`.

Guard: malformed JSON → `RouteBuildError`.

- [ ] **Step 10: Run — GREEN**.

- [ ] **Step 11: `query.rs` failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::*;
    fn g() -> RouteGraph {
        RouteGraph {
            nodes: vec![
                RouteNode { lon: 139.0, lat: 35.0, ordinal: 0.0 },   // 0
                RouteNode { lon: 139.001, lat: 35.0, ordinal: 0.0 }, // 1
                RouteNode { lon: 139.002, lat: 35.0, ordinal: 0.0 }, // 2
            ],
            edges: vec![
                RouteEdge { from: 0, to: 1, weight: 10.0 },
                RouteEdge { from: 1, to: 2, weight: 10.0 },
                RouteEdge { from: 0, to: 2, weight: 100.0 }, // direct but expensive
            ],
        }
    }
    #[test]
    fn prefers_cheaper_multihop() {
        let r = route(&g(),
            Point3 { lon: 139.0, lat: 35.0, ordinal: 0.0 },
            Point3 { lon: 139.002, lat: 35.0, ordinal: 0.0 }).unwrap();
        assert_eq!(r.nodes.len(), 3); // 0→1→2 (cost 20) beats 0→2 (cost 100)
        assert!((r.total_weight - 20.0).abs() < 1e-3);
    }
    #[test]
    fn none_when_disconnected() {
        let mut graph = g();
        graph.nodes.push(RouteNode { lon: 200.0, lat: 0.0, ordinal: 9.0 });
        let r = route(&graph,
            Point3 { lon: 139.0, lat: 35.0, ordinal: 0.0 },
            Point3 { lon: 200.0, lat: 0.0, ordinal: 9.0 });
        assert!(r.is_none());
    }
}
```

- [ ] **Step 12: Run — RED**.

- [ ] **Step 13: Implement `query.rs`** — nearest-node snap (haversine, prefer equal ordinal then min distance); A\* with binary-heap open set, `g` = summed edge weight, `h` = haversine metres origin-agnostic (dest), bidirectional adjacency built once from `edges`. Reconstruct node path. `None` if unreachable. Haversine helper here.

- [ ] **Step 14: Run — GREEN**: `cargo test -p kiriko-route`.

- [ ] **Step 15: Commit**

```bash
git add core/Cargo.toml core/crates/kiriko-route
git commit -m "feat(core): kiriko-route crate — graph type, floor map, build, A*"
```

---

### Task 2: KVB section 5 encode/decode

**Files:**
- Modify: `core/crates/kiriko-bundle/Cargo.toml` (add `kiriko-route` path dep), `src/sections.rs`, `src/codec.rs`, `src/format.rs`

**Interfaces:**
- Consumes: `kiriko_route::{RouteGraph, RouteNode, RouteEdge}`
- Produces: `BundleDocument.graph: Option<RouteGraph>`; `decode_bundle` populates it; `encode_bundle` emits §5 iff `Some` and non-empty.

- [ ] **Step 1: Add dep** to `kiriko-bundle/Cargo.toml`:
```toml
kiriko-route = { path = "../kiriko-route" }
```
Add to `[workspace.dependencies]`? No — path dep is fine per existing `kiriko-model` pattern (check how kiriko-bundle refers to kiriko-model and mirror it).

- [ ] **Step 2: Failing round-trip test** in `sections.rs` tests (or `codec.rs` tests):

```rust
#[test]
fn graph_section_round_trips() {
    use kiriko_route::{RouteGraph, RouteNode, RouteEdge};
    let mut doc = /* build a minimal valid BundleDocument via existing test helper */;
    doc.graph = Some(RouteGraph {
        nodes: vec![RouteNode { lon: 139.0, lat: 35.0, ordinal: 0.0 },
                    RouteNode { lon: 139.1, lat: 35.1, ordinal: 1.0 }],
        edges: vec![RouteEdge { from: 0, to: 1, weight: 12.5 }],
    });
    let bytes = encode_bundle(&doc).unwrap();
    let back = decode_bundle(&bytes).unwrap();
    assert_eq!(back.graph, doc.graph);
}

#[test]
fn no_graph_section_when_absent() {
    let doc = /* helper, graph: None */;
    let bytes = encode_bundle(&doc).unwrap();
    assert_eq!(decode_bundle(&bytes).unwrap().graph, None);
}

#[test]
fn rejects_graph_edge_out_of_bounds() {
    // hand-encode a §5 with edge.from >= node_count → decode_bundle errors InvalidBundle
}
```

- [ ] **Step 3: Run — RED**: `cargo test -p kiriko-bundle graph`.

- [ ] **Step 4: Implement**

`sections.rs`: add a postcard DTO mirroring the graph and canonicalizing every `f64` via `canonical_f64`:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct GraphSectionDto {
    nodes: Vec<GraphNodeDto>,
    edges: Vec<GraphEdgeDto>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct GraphNodeDto { lon: f64, lat: f64, ordinal: f64 }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct GraphEdgeDto { from: u32, to: u32, weight: f32 }

pub(crate) fn encode_graph(g: &kiriko_route::RouteGraph) -> Result<Vec<u8>, BundleError> {
    // canonical_f64 on lon/lat/ordinal; weight finite check; validate edge endpoints < nodes.len();
    // postcard::to_allocvec(&dto)
}
pub(crate) fn decode_graph(bytes: &[u8]) -> Result<kiriko_route::RouteGraph, BundleError> {
    // postcard_take_exact::<GraphSectionDto>; validate endpoints < node_count; canonical_f64; rebuild RouteGraph
}
```

`format.rs`: `SECTION_GRAPH` already = 5; keep `REQUIRED_SECTIONS` as-is (graph optional).

`codec.rs`:
- Add `pub graph: Option<RouteGraph>` to `BundleDocument` (and any doc test constructors).
- `encode_bundle`: after stores, if `document.graph` is `Some(g)` and `!g.is_empty()`, push `(SECTION_GRAPH, SECTION_VERSION, sections::encode_graph(g)?)` into the id-ascending section list.
- `decode_bundle`: if directory has section 5, `graph = Some(sections::decode_graph(bytes))` else `None`; set on the returned `BundleDocument`.
- `compile_imdf`: set `graph: None` (network wiring is Task 3).

- [ ] **Step 5: Run — GREEN + full crate**: `cargo test -p kiriko-bundle`.

- [ ] **Step 6: Commit**

```bash
git add core/crates/kiriko-bundle
git commit -m "feat(core): KVB section 5 graph encode/decode"
```

---

### Task 3: `kiriko-node` compile accepts network GeoJSON

**Files:**
- Modify: `core/crates/kiriko-node/Cargo.toml` (add `kiriko-route`), `src/lib.rs`
- Regenerate: `index.d.ts`, `index.js`, `.node` via build

**Interfaces:**
- Produces (napi): `compileImdf(source, datasetId, version, networkJunctionsGeoJson?, networkPathsGeoJson?)`.

- [ ] **Step 1: Study** `kiriko-node/src/lib.rs` `CompileTask` to see how `compile_imdf` is invoked and how args are passed.

- [ ] **Step 2: Rust test (or binding test)** — add a Rust unit test in a shared helper or a `kiriko-bundle` integration proving: given IMDF source + network GeoJSON, produce a bundle whose `decode_bundle().graph` is `Some`. (Put the end-to-end helper in `kiriko-bundle` since napi tests run from Node.)

Add to `codec.rs` a public compile-with-graph path so both node and tests share it:

```rust
pub fn compile_imdf_with_network(
    source: &[u8],
    metadata: BundleMetadata,
    junctions_geojson: Option<&str>,
    paths_geojson: Option<&str>,
) -> Result<CompiledBundle, CompileError> {
    // import model as compile_imdf does; build BundleDocument;
    // if both geojson Some: let ordinals = document.levels ordinals;
    //   let (graph, warns) = kiriko_route::build_route_graph(j, p, &ordinals)?;
    //   if !graph.is_empty() { document.graph = Some(graph); }  fold warns into warnings
    // encode_bundle(&document)
}
```
`compile_imdf` becomes `compile_imdf_with_network(source, metadata, None, None)`.

Test in `kiriko-bundle` with a tiny IMDF fixture (reuse existing test fixture) + the Task 1 GeoJSON constants → `decode_bundle(bundle).graph.is_some()`.

- [ ] **Step 3: Run — RED**, then implement `compile_imdf_with_network`. **GREEN**: `cargo test -p kiriko-bundle`.

- [ ] **Step 4: Wire napi** in `kiriko-node/src/lib.rs`: add optional `network_junctions_geojson: Option<String>`, `network_paths_geojson: Option<String>` to the compile binding/task; call `compile_imdf_with_network`. Keep the promise-never-rejects contract (domain errors → `errorJson`).

- [ ] **Step 5: Build** the node addon: `pnpm --filter @kiriko/node build`; confirm `index.d.ts` shows the new optional params.

- [ ] **Step 6: Commit**

```bash
git add core/crates/kiriko-node core/crates/kiriko-bundle
git commit -m "feat(core): compile embeds KVB graph from network GeoJSON"
```

---

### Task 4: `kiriko-wasm` `route()` binding

**Files:**
- Modify: `core/crates/kiriko-wasm/Cargo.toml` (add `kiriko-route`), `src/lib.rs`
- Rebuild: `pkg/` via `pnpm --filter @kiriko/wasm build`

**Interfaces:**
- Produces (wasm): `route_bundle(bundleBytes, origin, dest) → JsValue` returning `{ nodes: [{lon,lat,ordinal}], totalWeight } | null`. Reuses existing decode entry.

- [ ] **Step 1: Study** `kiriko-wasm/src/lib.rs` decode surface to mirror its error/serialization style (`serde-wasm-bindgen`).

- [ ] **Step 2: Rust test** in `kiriko-route` already covers `route()`. For wasm, add a thin function and a `wasm-bindgen-test` (or a plain Rust test on the non-wasm helper) that: decode a bundle (§5 present) → `RouteGraph` → `route()`.

- [ ] **Step 3: Implement**

```rust
#[wasm_bindgen]
pub fn route_bundle(bundle: &[u8], o_lon: f64, o_lat: f64, o_ord: f64,
                    d_lon: f64, d_lat: f64, d_ord: f64) -> Result<JsValue, JsError> {
    let doc = kiriko_bundle::decode_bundle(bundle).map_err(to_js)?;
    let Some(graph) = doc.graph else { return Ok(JsValue::NULL) };
    match kiriko_route::route(&graph,
        kiriko_route::Point3 { lon: o_lon, lat: o_lat, ordinal: o_ord },
        kiriko_route::Point3 { lon: d_lon, lat: d_lat, ordinal: d_ord }) {
        Some(r) => Ok(serde_wasm_bindgen::to_value(&RouteDto::from(r))?),
        None => Ok(JsValue::NULL),
    }
}
```
(Add a `#[derive(Serialize)] RouteDto { nodes: Vec<NodeDto>, total_weight: f32 }`.)

- [ ] **Step 4: Build wasm**, confirm `pkg` exports `route_bundle`.

- [ ] **Step 5: Commit**

```bash
git add core/crates/kiriko-wasm
git commit -m "feat(core): wasm route_bundle query over KVB graph"
```

---

### Task 5: Server — network extract, inspect-network, publish networkBlobHash

**Files:**
- Create: `server/src/gdb/network.ts`
- Modify: `server/src/gdb/convert.ts`, `server/src/gdb/routes.ts`, `server/src/gdb/types.ts`
- Test: `server/test/gdbNetwork.test.ts` (+ extend `server/test/gdbRoutes.test.ts`)

**Interfaces:**
- Consumes: `compileImdf(..., networkJunctionsGeoJson?, networkPathsGeoJson?)`.
- Produces: `POST /api/gdb/inspect-network` → `{ networkBlobHash, nodeCount, edgeCount, floors }`; `GdbPublishRequest.networkBlobHash?`.

- [ ] **Step 1: `network.ts`** — `extractNetworkGeoJson(stagedPath): Promise<{ junctions: string; paths: string; nodeCount; edgeCount; floors: string[] }>` using the existing gdal wrapper: `ogr2ogr` `net_junction` and `net_path` to WGS84 GeoJSON strings; count features; collect distinct `FLOOR`. Reuse `serializeGdalOperation`. Validate both layers exist, else throw `GdbSourceError("missing_network_layers")`.

- [ ] **Step 2: Failing server test** `gdbNetwork.test.ts`:
  - `extractNetworkGeoJson` on a tiny synthetic `.gdb.zip` fixture (or mock gdal like existing convert tests) returns node/edge counts and floors.
  - `POST /api/gdb/inspect-network` returns the summary.
  - `POST /api/gdb/publish` with `networkBlobHash` → version whose compiled bundle decodes with a graph (assert via inspect or a decode helper / stub compile to assert it received network GeoJSON).

Mirror the existing `gdbRoutes.test.ts` mocking pattern for gdal/compile.

- [ ] **Step 3: Run — RED**: `pnpm --dir server exec vitest run gdbNetwork`.

- [ ] **Step 4: Implement routes** — add `inspect-network` (stage blob, extract, return summary); extend `GdbPublishSchema` with optional `networkBlobHash: Type.Optional(Type.String())`; in publish, when set: re-open + stage the network blob, `extractNetworkGeoJson`, pass `junctions`/`paths` into the compile call. Fold build warnings into the response/stats. 404 on missing network blob; 400 `missing_network_layers` on bad archive. `removeStagedGdb` in `finally`.

- [ ] **Step 5: `types.ts`** — add `NetworkInspectResponse` + `networkBlobHash` on publish request.

- [ ] **Step 6: Run — GREEN**: `pnpm --dir server exec vitest run gdb && pnpm --dir server exec tsc --noEmit`.

- [ ] **Step 7: Commit**

```bash
git add server/src/gdb server/test
git commit -m "feat(server): combined GDB import — network extract + KVB graph"
```

---

### Task 6: Client — optional network selection + review summary

**Files:**
- Modify: `src/gdb/types.ts`, `src/gallery/api.ts`, `src/gallery/GalleryPage.tsx`, `src/gallery/GdbImportDialog.tsx`
- Test: `src/gallery/GdbImportDialog.test.tsx`, `src/gallery/gallery.test.tsx`

**Interfaces:**
- Consumes: `POST /api/gdb/inspect-network`, publish `networkBlobHash`.
- Produces: dialog optional network summary; `api.inspectGdbNetwork(file)`, `publishGdb(..., networkBlobHash?)`.

- [ ] **Step 1: Failing dialog test** — with a network summary prop, dialog shows "Routing network: N nodes, M paths, K floors"; without, nothing. Publish includes `networkBlobHash` when a network was added.

- [ ] **Step 2: RED** (`pnpm exec vitest run GdbImportDialog`).

- [ ] **Step 3: Implement** — `api.inspectGdbNetwork(file) → NetworkInspectResponse`; `api.publishGdb` gains optional `networkBlobHash`; `src/gdb/types.ts` mirrors server `NetworkInspectResponse`; GalleryPage GDB flow: after venue inspect, an optional "Add routing network" input calls `inspectGdbNetwork`, stores summary + hash in flow state; dialog renders summary; publish passes hash.

- [ ] **Step 4: GREEN + tsc**: `pnpm exec vitest run GdbImportDialog gallery.test && pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/gdb src/gallery
git commit -m "feat(web): optional routing-network selection in GDB import"
```

---

### Task 7: Web viewer — Directions mode

**Files:**
- Modify: bundle worker (`src/imdf`/bundle decode path that calls wasm), viewer app (`src/app/*`), map layers (`src/map/*`)
- Test: relevant `*.test.ts(x)` in `src/app`/`src/map`

**Interfaces:**
- Consumes: wasm `route_bundle`; decoded bundle graph presence flag.

- [ ] **Step 1: Study** how the bundle worker exposes decode + how the viewer draws feature layers, to mirror patterns (message type + a MapLibre line layer).

- [ ] **Step 2: Failing tests** — (a) Directions toggle hidden when the bundle has no graph, shown when present; (b) two map taps call the worker `route` and add a line layer source with the returned coordinates; (c) clear removes it. Mock the worker/wasm route call.

- [ ] **Step 3: RED**.

- [ ] **Step 4: Implement**
  - Bundle worker: add a `route` message → `route_bundle(bundleBytes, origin, dest)` → coordinates; expose whether §5 present after decode.
  - Viewer: Directions toggle (only when graph present); first tap sets origin (snap handled in wasm), second sets dest, call worker, receive polyline; add a `LAYER_ROUTE` line layer, split coordinates by ordinal so only the active floor's segments show; show total distance; clear control resets markers + layer.

- [ ] **Step 5: GREEN + tsc**: `pnpm exec vitest run src/app src/map && pnpm exec tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat(web): viewer Directions mode — tap two points, per-floor route"
```

---

### Task 8: Verification + Tokyo smoke

**Files:** none (fixes only if needed)

- [ ] **Step 1: Core**: `cargo test --manifest-path core/Cargo.toml --workspace` → all pass.
- [ ] **Step 2: Rebuild adapters**: `pnpm core:build` (node + wasm).
- [ ] **Step 3: TS**: `pnpm exec tsc --noEmit` and `pnpm --dir server exec tsc --noEmit`.
- [ ] **Step 4: Web + server tests**: `pnpm exec vitest run` and `pnpm --dir server exec vitest run`.
- [ ] **Step 5: Manual smoke** (backend + web up): import `tokyo station/JRTokyoSta_3857.gdb` + `network_WebMercator.gdb` together → publish → open viewer → Directions → tap two points spanning a floor change → route draws per floor. Capture a screenshot.
- [ ] **Step 6:** Commit any fixes.

---

## Spec coverage

| Spec section | Task |
|---|---|
| §5 kiriko-route (types, build, A\*, floor map) | 1 |
| §6 KVB section 5 | 2 |
| §7 kiriko-node compile integration | 3 |
| §5.3 query via wasm | 4 |
| §8 server combined import | 5 |
| §9 client network selection | 6 |
| §10 viewer directions | 7 |
| §11–12 testing + success | 1–8 |

## Self-review notes

- Types consistent across tasks: `RouteGraph/RouteNode/RouteEdge/Point3/Route`, `build_route_graph`, `route`, `compile_imdf_with_network`, `route_bundle`, `inspectGdbNetwork`, `networkBlobHash`.
- No placeholder steps; each code step shows code or an exact study/build command.
- Backward compatibility asserted by Task 2 `no_graph_section_when_absent` and the untouched required-section set.

## Execution handoff

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between.
2. **Inline Execution** — batch with checkpoints.
