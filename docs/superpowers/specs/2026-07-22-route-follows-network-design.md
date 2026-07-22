# Route Follows the Network — Design

**Date:** 2026-07-22
**Status:** Approved (design); implementation pending
**Scope:** B — corridor geometry + click→network connector + edge-projection snapping

## 1. Problem

Routing does not visually or functionally follow the network:

1. **Straight chords, not corridors.** `build_route_graph` reads `net_path` but keeps only `FNODEID`/`TNODEID`/`cost` — the `MultiLineString` geometry is discarded. `RouteEdge` is `{from, to, weight}`. `route()` returns a node sequence, and `buildRouteFeatures` draws straight `LineString`s between consecutive same-floor nodes. The route cuts across corners instead of tracing passages.
2. **Route ignores where you clicked.** `route()` snaps origin/destination to the nearest *node*; the drawn origin/destination markers sit at the raw click, but the route line starts at the snapped node — a visible gap. It "only looks right when you click exactly on a node."

## 2. Grounding facts (measured from the JR Tokyo `net_path`)

- 25,625 edges, 52,188 total vertices, **avg 2.04 vertices/edge**.
- **24,983 edges (97%) are 2-vertex straight lines** — their only vertices are the two endpoint nodes, already stored as `RouteNode`s.
- **642 edges** carry interior bend points (592 with 3–4, 44 with 5–8, 6 with 9–16; max 13).

Implication: storing only *interior* vertices (the middle of each polyline, endpoints excluded) makes the geometry addition a few KB — effectively free — and reconstructs the full polyline as `[node[from], …interior…, node[to]]`.

## 3. Goals / non-goals

**Goals**
- The rendered route traces the real `net_path` corridors.
- A click anywhere snaps to the nearest point on the nearest corridor (edge), on the same floor, and the route starts/ends there.
- A connector line links each raw click to its snapped-on-corridor point.

**Non-goals**
- No change to the cost model / passage semantics (still `net_path.cost`; deferred one-way/barriers/time-windows stay deferred).
- No spatial index (linear scan is adequate at this scale).
- No backward-compatibility path for already-published bundles (republish required, as the floor fix already requires).

## 4. Design

### 4.1 Edge geometry storage
- `kiriko_route::RouteEdge` gains `interior: Vec<[f64; 2]>` — the bend points strictly between the endpoints, ordered `from → to`; empty for the 97% straight edges.
- `build_route_graph` parses each `net_path` `MultiLineString`, concatenates its lines into one vertex list, and drops the first/last vertices (which equal the endpoint node coordinates); the remainder is `interior`. A degenerate/empty geometry yields `interior = []` (straight chord).
- The reconstructed full polyline of edge `e` is `[node[e.from], …e.interior…, node[e.to]]`. A helper `edge_polyline(&graph, e) -> Vec<[f64;2]>` centralizes this.
- **§5 encoding extended.** `GraphEdgeDto` gains `interior: Vec<[f64;2]>` (canonicalized f64s, same as node coords) **and** `ordinal: f64` (§4.2), so the edge's floor survives decode. Postcard is positional, so this changes the §5 byte layout → **republish required**. `validate_graph_edge` additionally checks each interior coordinate and the ordinal are finite.

### 4.2 Edge-projection snapping
- New `snap_to_edge(graph, point) -> Option<EdgeSnap>` where `EdgeSnap { edge_index, projected: [f64;2], seg_index, t, dist_m }`.
  - Candidate edges are those whose ordinal matches `point.ordinal`; prefer same-ordinal, fall back to any (mirroring `snap`'s same-floor preference) so a floor with no edges still routes.
  - Projection = nearest point across all segments of the edge's reconstructed polyline (standard point-to-segment projection, in lon/lat with latitude-scaled longitude to keep distances sane, or plain haversine per segment). Ties broken deterministically (lowest edge index, then segment, then t).
- Each edge carries an ordinal: `floor_to_ordinal(net_path.FLOOR)`, falling back to the `from` node's ordinal when the edge floor is unmappable. Stored alongside the edge (new `RouteEdge.ordinal: f64`) so snapping and rendering are floor-aware without re-deriving.

### 4.3 A\* with virtual endpoints
- `route(graph, origin, dest)` snaps each end with `snap_to_edge`.
- Partial-edge cost is proportioned by polyline length: for origin edge `(u,v)` with projection at arc-length `s` of total length `L`, seed the A\* open set with `u` at `g = weight·s/L` and `v` at `g = weight·(L−s)/L`. Symmetrically, terminate when settling either endpoint of the dest edge, adding that endpoint's partial cost to the goal projection.
- **Same-edge case:** origin and dest project onto the same edge → the route is the slice of that edge's polyline between the two projections; cost = `weight·|s_dest − s_origin|/L`. No graph search.
- Reconstruction produces the ordered vertex path:
  `[origin.projected] + (origin.projected → chosen origin endpoint partial polyline) + (node-to-node edge polylines along the A\* path, reversed when traversed to→from) + (last endpoint → dest.projected partial polyline) + [dest.projected]`.
- Each vertex is tagged with its edge's ordinal (endpoints/among-node vertices take the edge ordinal they belong to); the origin/dest projected points take their edge ordinal.

### 4.4 Route output shape
```
Route {
  segments: Vec<RouteSegment>,   // ordered, maximal same-ordinal runs
  total_weight: f32,
  origin_projected: [f64; 3],    // lon, lat, ordinal
  dest_projected:   [f64; 3],
}
RouteSegment { ordinal: f64, coordinates: Vec<[f64; 2]> }
```
- Segments are the reconstructed polyline split into maximal same-ordinal runs (an edge contributes its full polyline to its ordinal; a run breaks at a floor change, exactly as node runs break today).
- `kiriko-wasm routeBundle` serializes the same shape (camelCase: `segments`, `totalWeight`, `originProjected`, `destProjected`).
- Client `RouteResultDto` mirrors it; `RouteNodeDto` is replaced by `RouteSegmentDto { ordinal, coordinates }`.

### 4.5 Rendering + connector
- `buildRouteFeatures` emits one `kind:"segment"` `LineString` per `RouteSegment` whose `ordinal === activeOrdinal`, using the segment's real `coordinates` (corridor-hugging) — replacing the node-chord grouping.
- Adds `kind:"connector"` `LineString`s: `origin.click → originProjected` and `destination.click → destProjected`, each emitted only on its projected point's floor. Styled thin/dashed (a new paint in `featureLayers.ts`, e.g. `LAYER_ROUTE_CONNECTOR`, gated to `kind:"connector"`, dashed via `line-dasharray`).
- Origin/destination `kind:"origin"`/`kind:"destination"` point markers stay at the raw click (unchanged).

### 4.6 Floor handling
- Per-edge ordinal (4.2) drives both snapping candidates and segment grouping. Inter-floor edges are assigned their `net_path.FLOOR` ordinal; floor transitions surface as adjacent segments with different ordinals, so only active-floor geometry ever renders and no cross-floor chord is drawn.

## 5. Data flow / affected files
- `core/crates/kiriko-route/src/graph.rs` — `RouteEdge { from, to, weight, ordinal, interior }`; `edge_polyline` helper.
- `core/crates/kiriko-route/src/build.rs` — parse interior vertices + edge ordinal.
- `core/crates/kiriko-route/src/query.rs` — `snap_to_edge`, `EdgeSnap`, virtual-endpoint A\*, `Route`/`RouteSegment`.
- `core/crates/kiriko-bundle/src/sections.rs` — `GraphEdgeDto.interior` (+ ordinal), encode/decode/validate.
- `core/crates/kiriko-wasm/src/lib.rs` — `routeBundle` output DTO (`segments`, projected endpoints).
- `src/bundle/wasm.ts` — `RouteResultDto` / `RouteSegmentDto`.
- `src/map/routeFeatures.ts` — segment + connector features.
- `src/map/featureLayers.ts` — connector layer/paint.
- `src/app/App.tsx` — thread projected endpoints if needed (connector is derived from route + clicks).

## 6. Testing
- **kiriko-route:** interior parsing (straight vs curved edge); edge ordinal derivation; `snap_to_edge` (nearest same-ordinal edge, projection point, same-edge detection, fallback); virtual-endpoint A\* cost proportioning and reconstructed polyline (curved edge + a floor transition + same-edge shortcut).
- **kiriko-bundle:** §5 round-trip with interior vertices; reject non-finite interior coordinate.
- **kiriko-wasm:** `routeBundle` returns floor-grouped segments + projected endpoints for a curved fixture.
- **client:** `buildRouteFeatures` emits corridor segment polylines filtered by floor and connector features on the right floors; update `RouteResultDto` consumers and the directions flow.
- Verify end-to-end on the real Tokyo network (recompile + route across a curved corridor and a floor change; confirm the drawn line hugs the corridor and connectors bridge off-node clicks).

## 7. Risks / notes
- Cost proportioning by geometric length is an approximation (`net_path.cost` also encodes passage penalty). Acceptable and standard for mid-edge starts.
- Linear O(edges) projection per snap (×2 per route) is fine at 25k edges; revisit with a grid index only if routing feels slow.
- Weight is still reported in `cost` units though labeled `m` (pre-existing follow-up, unchanged here).

## 8. References
- `docs/gdb-data-reference.md` — network schema, `net_path` fields, floor→ordinal.
- `docs/superpowers/specs/2026-07-20-kiriko-route-slice-design.md` — original routing slice.
