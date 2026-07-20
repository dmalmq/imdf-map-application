# Kiriko: `kiriko-route` — Explicit-Network Routing Slice

**Date:** 2026-07-20
**Status:** Draft for review
**Depends on:** kiriko-core (`kiriko-model`, `kiriko-bundle`, `kiriko-node`, `kiriko-wasm`), server GDB import pipeline (`server/src/gdb/*`), KVB1 bundle format.
**Roadmap:** Architecture spec §8 Phase 4 (`kiriko-route` + `@kiriko/web`), routing half.

## 1. Context

The platform roadmap's Phase 4 adds on-device routing: publish-time graph building in the core, on-device A\* querying on clients, directions in web + embeds. The `kiriko-route` crate and KVB section `5 graph` are reserved but unbuilt; KVB currently emits only sections 1–3 (manifest, geometry, stores).

The customer's Tokyo Station dataset ships a **dedicated, professional routing network** in a separate File Geodatabase, `network_WebMercator.gdb` (EPSG:3857):

- **`net_junction`** — 10,118 Point nodes. Fields: `NODEID` (unique), `FLOOR` (`F1`/`B1`/`F36`/`M2`…), `altitude`, `BARRIER`, `GATE`, `STARTTIME`/`ENDTIME`, `NAME`.
- **`net_path`** — 25,625 MultiLineString edges. Fields: `FNODEID`→`TNODEID`, `cost` (integer; already encodes passage penalty — a floor change costs ~32k vs ~2k for a 2 m walk), `passage_type`, `direction`, `BARRIER`, `FLOOR`, `PATHID`/`RPATHID`, time windows.
- Per-floor / inter-floor `*_link` layers are floor-organized slices of the same graph and are **not** the canonical source.

This is authoritative and strictly better than deriving a graph from IMDF units + openings, so the derived approach is dropped for this slice (kept as a possible universal fallback in a later phase).

A sibling `point_facility_WebMercator_202006.gdb` holds WiFi access points and facility POIs with icon metadata (`symbol_id`, `image`, `color`, `pict_scale`, zoom levels, `floor`). **Out of scope here**; it is future fuel for destination selection, marker icons, and `kiriko-position`.

## 2. Goal

A thin but complete vertical slice: a user imports the venue GDB **and** the network GDB together, the server builds a routing graph and embeds it in the published KVB, and the web viewer draws a walking route (across floors) between two tapped points.

## 3. Scope decisions (locked in brainstorming)

- **Graph source:** explicit `net_junction` + `net_path` (no units/openings derivation this slice).
- **Ingest:** combined GDB import — venue + network selected together, one publish, one bundle.
- **Endpoints UX:** tap two points on the map; snap each to the nearest node; draw the route.
- **Edge cost:** use `net_path.cost` directly (it already models stairs/elevator penalties).
- **Directionality:** treat edges as bidirectional for this slice (ignore `direction`).
- **Vertical:** inter-floor edges come from the network itself (edges whose endpoints are on different floors); no synthetic vertical modeling.

### Deferred (explicit non-goals)
`passage_type` semantics · `direction`/one-way · `BARRIER`/`GATE` · time windows (`STARTTIME`/`ENDTIME`) · accessibility profiles (avoid stairs) · units+openings fallback · point-facility icons & destination-by-place · WiFi/positioning · turn-by-turn text · embeds-specific directions polish · mobile SDKs · directed-edge storage optimizations.

## 4. Architecture and boundaries

```
Combined GDB import (client)
  venue.gdb.zip  ─┐
  network.gdb.zip ┴─▶ server: gdal3.js
                        convert venue layers → IMDF (existing)
                        convert net_junction + net_path → WGS84 GeoJSON (new)
                          │
                          ▼  (IMDF source + network GeoJSON) → kiriko-node compile
                        kiriko-route (Rust): parse GeoJSON → RouteGraph
                          (NODEID index · FLOOR→ordinal · cost weights)
                        kiriko-bundle: encode KVB §5 graph
                          │
                          ▼
                    published .kvb  (sections 1–3 + 5)
                          │  fetched by web viewer
                          ▼
                    kiriko-wasm: decode §5, A* query
                    web viewer: tap two points → route polyline per floor
```

**Boundary rule (unchanged):** GDAL stays in TypeScript (gdal3.js already converts GDB layers). All *graph interpretation* — parsing GeoJSON into nodes/edges, floor mapping, A\* — lives in Rust `kiriko-route`. The server never interprets the network; it only extracts GeoJSON and moves bytes.

## 5. `kiriko-route` crate

New workspace crate `core/crates/kiriko-route`, no binding deps (pure, like `kiriko-model`/`kiriko-bundle`).

### 5.1 Types

```rust
pub struct RouteGraph {
    pub nodes: Vec<RouteNode>,   // node index = position in vec
    pub edges: Vec<RouteEdge>,   // sorted canonically for determinism
}

pub struct RouteNode {
    pub lon: f64,
    pub lat: f64,
    pub ordinal: f64,            // venue level ordinal (matches bundle levels)
}

pub struct RouteEdge {
    pub from: u32,               // node index
    pub to: u32,                 // node index
    pub weight: f32,             // net_path.cost
}
```

`NODEID` is remapped to a dense 0-based node index during build; the wire format stores indices, not source `NODEID`s.

### 5.2 Build (server/publish time, called from `kiriko-node`)

`build_route_graph(junctions_geojson: &str, paths_geojson: &str, levels: &[ViewerLevel]) -> (RouteGraph, Vec<RouteBuildWarning>)`

1. Parse `net_junction` FeatureCollection: each feature → `NODEID`, Point `(lon,lat)`, `FLOOR`.
2. Map `FLOOR` → venue level ordinal: parse rule `F<n>`→`n-1`, `B<n>`→`-n`, `M<n>`→mezzanine handling (documented, deterministic), then match against `levels` ordinals; unmappable floor → node dropped with a warning.
3. Build `NODEID → index` map (skip dropped nodes).
4. Parse `net_path`: each feature → `FNODEID`,`TNODEID`,`cost`. Drop an edge if either endpoint is missing/dropped (warning-counted, not fatal). Weight = `cost` as `f32`.
5. Sort nodes by `(ordinal, lon, lat)`, edges by `(from, to, weight)` for deterministic output; remap indices after node sort.

Determinism is required (golden tests). Empty network (no valid nodes/edges) → empty graph → §5 not emitted.

### 5.3 Query (client/WASM time)

`route(graph: &RouteGraph, origin: Point3, dest: Point3) -> Option<Route>`

- `Point3 { lon, lat, ordinal }`.
- Snap origin/dest to nearest node by great-circle distance, preferring same ordinal.
- A\* over the (bidirectional) edge set; heuristic = horizontal great-circle distance to dest (admissible — floor changes only add cost).
- `Route { nodes: Vec<RouteNode>, total_weight: f32 }` — ordered polyline with per-node ordinal so the client can segment by floor. `None` if disconnected.

### 5.4 Spatial helpers (crate-owned)

Great-circle (haversine) distance; nearest-node scan. No point-in-polygon needed (explicit network).

## 6. KVB section 5 (`graph`)

`kiriko-bundle`: add encode/decode for section id 5, version 1.

Payload (little-endian, deterministic):

```
u32 node_count
node_count × ( f64 lon, f64 lat, f64 ordinal )
u32 edge_count
edge_count × ( u32 from, u32 to, f32 weight )
```

- Emitted only when the graph is non-empty; sections stay id-ascending (…,3,5).
- Decoder: bounds/consistency checks (every edge endpoint `< node_count`), reject malformed §5 with existing `InvalidBundle`.
- Backward compatible: `parse_directory` already tolerates extra non-required section IDs; older decoders read 1–3 and ignore 5. No major/minor bump. `decode_bundle` gains an accessor returning the graph when §5 is present, `None` otherwise.
- Golden round-trip test with a tiny fixed graph; determinism test (same input → byte-identical §5).

## 7. `kiriko-node` (compile integration)

The existing async compile path gains optional network inputs.

- New optional parameters on the compile entry: `networkJunctionsGeoJson?: string`, `networkPathsGeoJson?: string`.
- When both present: after IMDF import produces the `VenueModel`, call `kiriko-route::build_route_graph(...)`, then `kiriko-bundle` embeds §5. Build warnings fold into the existing warning channel / stats.
- When absent: unchanged (no §5) — plain IMDF and network-less GDB imports keep working.

## 8. Server (`server/src/gdb`) — combined import

### 8.1 Inspect

- The client uploads the venue GDB (existing `POST /api/gdb/inspect`) and, when present, the network GDB.
- Add `POST /api/gdb/inspect-network` (or a second multipart field) that validates the archive and confirms it contains `net_junction` + `net_path`, stages it as a content-addressed blob, and returns `{ networkBlobHash, nodeCount, edgeCount, floors: string[] }` for the review dialog to display ("Routing network: 10,118 nodes, 25,625 paths, 12 floors").

### 8.2 Publish

- `GdbPublishRequest` gains optional `networkBlobHash?: string`.
- When set: server re-opens the network blob, `convertGdbLayers`-style extracts `net_junction` + `net_path` to WGS84 GeoJSON, and passes both to the compile step alongside the synthesized IMDF. Version still `source_kind='gdb'`; one bundle with §5.
- Missing/invalid network blob when referenced → 404/400 with a clear code, no partial publish.

### 8.3 Types drift

`net_junction`/`net_path` schema recognition and the inspect summary shape live in `server/src/gdb/types.ts`, mirrored by the client `src/gdb/types.ts` (existing mirroring pattern).

## 9. Client — combined import UX

- The GDB import flow (card **Import GDB** and header) gains an **optional** network GDB selection: after the venue GDB is chosen/inspected, a secondary "Add routing network (optional)" file input.
- If a network GDB is added, the review dialog shows the routing summary (node/path/floor counts) and any floor-mapping warnings.
- Publish sends `networkBlobHash` when present; otherwise the flow is exactly as today.

## 10. Web viewer — directions

- A **Directions** toggle in the viewer (only shown when the loaded bundle has §5).
- Tap once → origin marker (snapped node); tap again → destination marker; the WASM `route()` runs; the polyline draws as a MapLibre line layer, segmented per floor so it follows the active floor; total distance/cost shown; a clear/reset control.
- Bundle worker exposes a `route()` call over the decoded §5 via `kiriko-wasm`.
- Embeds inherit the viewer; no embed-specific work this slice.

## 11. Testing

- **kiriko-route (Rust):** floor-label→ordinal mapping (incl. `B`/`M`/unmappable), build from a small fixture (nodes+paths → expected graph), dropped-edge on missing endpoint, A\* shortest path on a hand-checked graph (incl. a cheaper multi-hop vs expensive floor-change), disconnected → `None`, determinism.
- **kiriko-bundle (Rust):** §5 golden round-trip, determinism, malformed-§5 rejection, decode of a §5-less bundle → `None`.
- **kiriko-node:** compile with network GeoJSON embeds §5; compile without leaves it absent (binding-level test or via server).
- **Server (Vitest):** inspect-network returns counts; publish with `networkBlobHash` produces a version whose bundle carries §5; publish without is unchanged; invalid network blob → error.
- **Web (Vitest):** Directions toggle hidden without §5; two taps produce a `route()` call and draw a line; clear resets. WASM decode/query unit test with a fixture bundle.
- **Manual smoke:** import Tokyo venue + network, open viewer, route between two tapped points across a floor change.

## 12. Success criteria

- Combined import of Tokyo venue + `network_WebMercator.gdb` publishes one version whose `.kvb` contains a non-empty §5.
- The viewer routes between two tapped points, correctly crossing at least one floor change, drawn per floor.
- Plain IMDF and network-less GDB imports are byte-for-byte unaffected (no §5).
- `cargo test` (core), `tsc`, and web/server Vitest green.

## 13. Implementation order (for the plan)

1. `kiriko-route` crate: types + floor mapping + build + A\* + tests.
2. `kiriko-bundle` §5 encode/decode + golden/determinism tests.
3. `kiriko-node` compile integration (optional network GeoJSON → §5).
4. `kiriko-wasm` `route()` binding + decode-§5 test.
5. Server: inspect-network + publish `networkBlobHash` + network→GeoJSON extraction.
6. Client: optional network selection in the GDB flow + review summary.
7. Web viewer: Directions mode (tap two points, draw per-floor route).
8. Verification + Tokyo smoke.

## 14. Open risks

- **Floor-label mapping** (`net FLOOR` → venue level ordinal) is the fragile seam; if labels don't line up with the venue's converted levels, nodes drop. Mitigation: warnings surfaced in the review dialog; explicit mapping rule with tests; a follow-up could add a manual floor-match UI.
- **Graph size** (~10k nodes / ~25k edges) in §5 and A\*: fine at this scale; if far larger venues appear, revisit adjacency encoding and A\* structures.
- **WASM route ergonomics:** returning a polyline across the boundary; keep the shape minimal (flat arrays) to avoid churn.
