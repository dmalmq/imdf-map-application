# Route Follows the Network — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make computed routes trace the real `net_path` corridors and let clicks anywhere snap to the nearest point on the nearest corridor, with a connector line bridging the click to the network.

**Architecture:** Carry each `net_path` edge's interior bend points + floor ordinal through `kiriko-route` → KVB §5 → `kiriko-wasm` → the viewer. `route()` projects both endpoints onto the nearest same-floor edge (virtual endpoints), runs A\* on the node graph with length-proportioned partial-edge costs, and returns floor-grouped polyline **segments** plus the two projected endpoints. The viewer renders the real segment polylines and a dashed connector from each raw click to its projection.

**Tech Stack:** Rust (`kiriko-route`, `kiriko-bundle`, `kiriko-wasm` via wasm-bindgen + postcard), TypeScript/React viewer (MapLibre GL), Vitest, `cargo test`.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-22-route-follows-network-design.md`. Scope B.
- Floor→ordinal is `kiriko_route::floor_to_ordinal` (already handles `F/B/M/<letters>B`); reuse it, do not reimplement.
- KVB §5 layout changes → **existing published bundles must be republished**; no persisted back-compat path.
- No new dependencies. No spatial index (linear scans are acceptable at ~10k nodes / ~25k edges).
- Strict TS (no `any`); bilingual UI strings unaffected (no new user copy here).
- Rust edges are traversed bidirectionally; cost stays `net_path.cost` (do not re-penalize).
- `edge.interior` holds ONLY the vertices strictly between the two endpoint nodes, in `from → to` order. Full polyline = `[node[from], …interior…, node[to]]`.
- Deterministic output (stable ordering / tie-breaks) — the codebase asserts byte-identical recompiles.

---

### Task 1: Edge geometry + ordinal in the route graph

**Files:**
- Modify: `core/crates/kiriko-route/src/graph.rs`
- Modify: `core/crates/kiriko-route/src/build.rs`
- Modify (compile fixups — RouteEdge literals): `core/crates/kiriko-route/src/query.rs` (tests), `core/crates/kiriko-bundle/src/sections.rs` (decode + tests)
- Test: `core/crates/kiriko-route/src/build.rs` (`#[cfg(test)]`)

**Interfaces:**
- Produces:
  - `RouteEdge { from: u32, to: u32, weight: f32, ordinal: f64, interior: Vec<[f64; 2]> }`
  - `RouteGraph::edge_polyline(&self, edge: &RouteEdge) -> Vec<[f64; 2]>` → `[node[from], …interior…, node[to]]`

- [ ] **Step 1: Write the failing test** — append to `build.rs` `mod tests`:

```rust
    #[test]
    fn keeps_edge_interior_vertices_and_ordinal() {
        const J: &str = r#"{"type":"FeatureCollection","features":[
          {"type":"Feature","properties":{"NODEID":1,"FLOOR":"F1"},"geometry":{"type":"Point","coordinates":[139.0,35.0]}},
          {"type":"Feature","properties":{"NODEID":2,"FLOOR":"F1"},"geometry":{"type":"Point","coordinates":[139.002,35.0]}}]}"#;
        // A curved edge: endpoints match the nodes, one interior bend point.
        const P: &str = r#"{"type":"FeatureCollection","features":[
          {"type":"Feature","properties":{"FNODEID":1,"TNODEID":2,"cost":200,"FLOOR":"F1"},
           "geometry":{"type":"MultiLineString","coordinates":[[[139.0,35.0],[139.001,35.0005],[139.002,35.0]]]}}]}"#;
        let b = build_route_graph(J, P, &[0.0]).unwrap();
        assert_eq!(b.graph.edges.len(), 1);
        let e = &b.graph.edges[0];
        assert_eq!(e.ordinal, 0.0);
        assert_eq!(e.interior, vec![[139.001, 35.0005]]); // endpoints stripped
        assert_eq!(
            b.graph.edge_polyline(e),
            vec![[139.0, 35.0], [139.001, 35.0005], [139.002, 35.0]]
        );
    }

    #[test]
    fn straight_edge_has_empty_interior() {
        let b = build_route_graph(JUNCTIONS, PATHS, &[0.0, 1.0]).unwrap();
        assert!(b.graph.edges.iter().all(|e| e.interior.is_empty()));
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p kiriko-route keeps_edge_interior 2>&1 | tail -20`
Expected: compile error — `RouteEdge` has no field `ordinal`/`interior`, no method `edge_polyline`.

- [ ] **Step 3: Add fields + helper in `graph.rs`** — replace the `RouteEdge` struct and `impl RouteGraph`:

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct RouteEdge {
    pub from: u32,
    pub to: u32,
    pub weight: f32,
    /// Venue level ordinal of this edge (its `net_path.FLOOR`), used for
    /// floor-aware snapping and per-floor rendering.
    pub ordinal: f64,
    /// Bend points strictly between `from` and `to`, in `from → to` order;
    /// empty when the edge is a straight chord between its endpoints.
    pub interior: Vec<[f64; 2]>,
}

impl RouteGraph {
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Full polyline of `edge`: `[from node, …interior…, to node]`.
    pub fn edge_polyline(&self, edge: &RouteEdge) -> Vec<[f64; 2]> {
        let from = &self.nodes[edge.from as usize];
        let to = &self.nodes[edge.to as usize];
        let mut out = Vec::with_capacity(edge.interior.len() + 2);
        out.push([from.lon, from.lat]);
        out.extend_from_slice(&edge.interior);
        out.push([to.lon, to.lat]);
        out
    }
}
```

- [ ] **Step 4: Parse interior + ordinal in `build.rs`** — replace the `net_path` edge loop body (the block starting `for feature in &paths.features {`, lines ~84-104). New body:

```rust
    for feature in &paths.features {
        let (Some(from), Some(to), Some(cost)) = (
            prop(&feature.properties, "FNODEID").and_then(|v| v.as_u64()),
            prop(&feature.properties, "TNODEID").and_then(|v| v.as_u64()),
            prop(&feature.properties, "cost").and_then(|v| v.as_f64()),
        ) else {
            continue;
        };
        let (Some(&from_idx), Some(&to_idx)) = (index.get(&from), index.get(&to)) else {
            warnings.push(RouteBuildWarning {
                code: "dangling_edge".into(),
                detail: format!("edge {from}->{to} references an unknown or dropped node"),
            });
            continue;
        };
        // Edge ordinal: its own FLOOR, else the `from` node's ordinal.
        let ordinal = prop(&feature.properties, "FLOOR")
            .and_then(|v| v.as_str())
            .and_then(floor_to_ordinal)
            .unwrap_or(nodes_by_idx[from_idx as usize].ordinal);
        // Interior = the polyline vertices with the two endpoints stripped.
        let interior = interior_vertices(feature.geometry.as_ref().map(|g| &g.value));
        edges.push(RouteEdge {
            from: from_idx,
            to: to_idx,
            weight: cost as f32,
            ordinal,
            interior,
        });
    }
```

Then, so `nodes_by_idx` exists, add just after the `index` map is built (after line ~81):

```rust
    // Nodes in index order, for edge-ordinal fallback while edges are built.
    let nodes_by_idx: Vec<RouteNode> = by_id.values().cloned().collect();
```

Add this helper below `build_route_graph` (before `parse_collection`):

```rust
/// Flatten a `MultiLineString`/`LineString` to its vertex list, then drop the
/// first and last vertices (they equal the endpoint node coordinates). Returns
/// the interior bend points, or empty for missing/degenerate geometry.
fn interior_vertices(value: Option<&Value>) -> Vec<[f64; 2]> {
    let verts: Vec<[f64; 2]> = match value {
        Some(Value::MultiLineString(lines)) => lines
            .iter()
            .flatten()
            .filter_map(|c| Some([*c.first()?, *c.get(1)?]))
            .collect(),
        Some(Value::LineString(line)) => line
            .iter()
            .filter_map(|c| Some([*c.first()?, *c.get(1)?]))
            .collect(),
        _ => Vec::new(),
    };
    if verts.len() <= 2 {
        return Vec::new();
    }
    verts[1..verts.len() - 1].to_vec()
}
```

Ensure `use geojson::Value;` (or `geojson::{..., Value}`) is imported at the top of `build.rs` (the crate already depends on `geojson`).

- [ ] **Step 5: Fix RouteEdge literals so the workspace compiles.** Add `ordinal: 0.0, interior: vec![]` to every `RouteEdge { … }` literal:
  - `core/crates/kiriko-route/src/query.rs` — the `#[cfg(test)]` graph fixtures.
  - `core/crates/kiriko-bundle/src/sections.rs` — `decode_graph` (set `ordinal: canonical_f64(edge.ordinal)?`, `interior: <decoded>` — see Task 4; for now, to compile this task, add `ordinal: 0.0, interior: vec![]` and let Task 4 wire the real values) and its `#[cfg(test)]` `RouteEdge` literals.

  Search first:
```bash
grep -rn "RouteEdge {" core/crates
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test -p kiriko-route 2>&1 | tail -20`
Expected: PASS (incl. the two new tests). Then `cargo build -p kiriko-bundle 2>&1 | tail -5` compiles.

- [ ] **Step 7: Commit**

```bash
git add core/crates/kiriko-route/src/graph.rs core/crates/kiriko-route/src/build.rs core/crates/kiriko-route/src/query.rs core/crates/kiriko-bundle/src/sections.rs
git commit -m "feat(route): carry net_path interior geometry + edge ordinal in the graph"
```

---

### Task 2: Project a point onto the nearest same-floor edge

**Files:**
- Modify: `core/crates/kiriko-route/src/query.rs`
- Test: `core/crates/kiriko-route/src/query.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes: `RouteGraph::edge_polyline`, `RouteEdge.ordinal`, `haversine_m`.
- Produces (crate-internal):
  - `struct EdgeSnap { edge_index: usize, projected: [f64; 2], along: f64, total: f64, ordinal: f64 }`
  - `fn snap_to_edge(graph: &RouteGraph, p: &Point3) -> Option<EdgeSnap>` — nearest projection; edges whose `ordinal == p.ordinal` are preferred over closer off-floor edges (mirrors `snap`).
  - `fn project_point_on_polyline(poly: &[[f64; 2]], px: f64, py: f64) -> ([f64; 2], f64, f64)` → `(projected, along, total)` arc-lengths in metres.

- [ ] **Step 1: Write the failing test** — append to `query.rs` `mod tests`:

```rust
    fn geom_graph() -> RouteGraph {
        // One curved edge on ordinal 0 from (139.0,35.0) to (139.002,35.0)
        // via a bend at (139.001, 35.001).
        RouteGraph {
            nodes: vec![
                RouteNode { lon: 139.0, lat: 35.0, ordinal: 0.0 },
                RouteNode { lon: 139.002, lat: 35.0, ordinal: 0.0 },
            ],
            edges: vec![RouteEdge {
                from: 0,
                to: 1,
                weight: 100.0,
                ordinal: 0.0,
                interior: vec![[139.001, 35.001]],
            }],
        }
    }

    #[test]
    fn snaps_click_onto_nearest_edge() {
        let g = geom_graph();
        // Click near the bend, slightly off it.
        let s = snap_to_edge(&g, &Point3 { lon: 139.001, lat: 35.0009, ordinal: 0.0 })
            .expect("snaps to the only edge");
        assert_eq!(s.edge_index, 0);
        // Projection lands at/near the bend vertex.
        assert!((s.projected[0] - 139.001).abs() < 1e-4);
        assert!(s.along > 0.0 && s.along < s.total);
    }

    #[test]
    fn snap_prefers_same_ordinal_edge() {
        let mut g = geom_graph();
        g.nodes.push(RouteNode { lon: 139.001, lat: 35.0, ordinal: -1.0 });
        g.nodes.push(RouteNode { lon: 139.0011, lat: 35.0, ordinal: -1.0 });
        g.edges.push(RouteEdge { from: 2, to: 3, weight: 10.0, ordinal: -1.0, interior: vec![] });
        // Click on ordinal 0 sitting right over the B1 edge still snaps to the F1 edge.
        let s = snap_to_edge(&g, &Point3 { lon: 139.001, lat: 35.0, ordinal: 0.0 }).unwrap();
        assert_eq!(g.edges[s.edge_index].ordinal, 0.0);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p kiriko-route snap 2>&1 | tail -20`
Expected: compile error — `snap_to_edge`/`EdgeSnap` not found.

- [ ] **Step 3: Implement in `query.rs`** — add above `route`:

```rust
/// A click projected onto one edge's polyline.
#[derive(Debug, Clone, Copy)]
struct EdgeSnap {
    edge_index: usize,
    projected: [f64; 2],
    /// Arc length (metres) from the edge's `from` endpoint to the projection.
    along: f64,
    /// Total arc length (metres) of the edge polyline.
    total: f64,
    ordinal: f64,
}

/// Project `(px,py)` onto a polyline. Returns `(projected, along, total)` where
/// `along`/`total` are cumulative great-circle arc lengths in metres.
fn project_point_on_polyline(poly: &[[f64; 2]], px: f64, py: f64) -> ([f64; 2], f64, f64) {
    let mut best = ([px, py], 0.0, f64::INFINITY); // (proj, along, dist)
    let mut acc = 0.0;
    let mut total = 0.0;
    for w in poly.windows(2) {
        let (a, b) = (w[0], w[1]);
        let seg = haversine_m(a[0], a[1], b[0], b[1]);
        // Parameterize on the lon/lat plane (small spans → adequate), clamp t.
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let len2 = dx * dx + dy * dy;
        let t = if len2 <= f64::EPSILON {
            0.0
        } else {
            (((px - a[0]) * dx + (py - a[1]) * dy) / len2).clamp(0.0, 1.0)
        };
        let proj = [a[0] + t * dx, a[1] + t * dy];
        let dist = haversine_m(px, py, proj[0], proj[1]);
        if dist < best.2 {
            best = (proj, acc + t * seg, dist);
        }
        acc += seg;
        total = acc;
    }
    (best.0, best.1, total)
}

/// Nearest edge projection to `p`; same-ordinal edges beat closer off-floor
/// edges (same rule as [`snap`]). `None` only when the graph has no edges.
fn snap_to_edge(graph: &RouteGraph, p: &Point3) -> Option<EdgeSnap> {
    let mut best: Option<(EdgeSnap, bool, f64)> = None; // (snap, same_floor, dist)
    for (i, e) in graph.edges.iter().enumerate() {
        let poly = graph.edge_polyline(e);
        let (proj, along, total) = project_point_on_polyline(&poly, p.lon, p.lat);
        let dist = haversine_m(p.lon, p.lat, proj[0], proj[1]);
        let same = e.ordinal == p.ordinal;
        let better = match &best {
            None => true,
            Some((_, bsame, bdist)) => {
                // Prefer same-floor; within the same class, prefer nearer.
                (same, -dist).partial_cmp(&(*bsame, -*bdist)).unwrap()
                    == std::cmp::Ordering::Greater
            }
        };
        if better {
            best = Some((
                EdgeSnap { edge_index: i, projected: proj, along, total, ordinal: e.ordinal },
                same,
                dist,
            ));
        }
    }
    best.map(|(s, _, _)| s)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p kiriko-route snap 2>&1 | tail -20`
Expected: PASS. (`snap_to_edge`/`project_point_on_polyline`/`EdgeSnap` are `dead_code` until Task 3 — that is expected this task; do not add `#[allow]`, Task 3 consumes them.)

- [ ] **Step 5: Commit**

```bash
git add core/crates/kiriko-route/src/query.rs
git commit -m "feat(route): project a click onto the nearest same-floor edge"
```

---

### Task 3: Virtual-endpoint A\* → floor-grouped polyline segments

**Files:**
- Modify: `core/crates/kiriko-route/src/query.rs` (rewrite `Route`, `route`)
- Test: `core/crates/kiriko-route/src/query.rs`

**Interfaces:**
- Consumes: `snap_to_edge`, `EdgeSnap`, `RouteGraph::edge_polyline`, `RouteEdge.ordinal`.
- Produces:
  - `pub struct RouteSegment { pub ordinal: f64, pub coordinates: Vec<[f64; 2]> }`
  - `pub struct Route { pub segments: Vec<RouteSegment>, pub total_weight: f32, pub origin_projected: [f64; 3], pub dest_projected: [f64; 3] }`
  - `pub fn route(graph: &RouteGraph, origin: Point3, dest: Point3) -> Option<Route>`

- [ ] **Step 1: Write the failing tests** — replace the existing `route`-related tests in `query.rs` `mod tests` with:

```rust
    #[test]
    fn route_traces_the_corridor_polyline() {
        // from(139.0) --bend(139.001,35.001)--> mid(139.002) --> to(139.003)
        let graph = RouteGraph {
            nodes: vec![
                RouteNode { lon: 139.0, lat: 35.0, ordinal: 0.0 },
                RouteNode { lon: 139.002, lat: 35.0, ordinal: 0.0 },
                RouteNode { lon: 139.003, lat: 35.0, ordinal: 0.0 },
            ],
            edges: vec![
                RouteEdge { from: 0, to: 1, weight: 100.0, ordinal: 0.0, interior: vec![[139.001, 35.001]] },
                RouteEdge { from: 1, to: 2, weight: 100.0, ordinal: 0.0, interior: vec![] },
            ],
        };
        let r = route(
            &graph,
            Point3 { lon: 139.0, lat: 35.0, ordinal: 0.0 },
            Point3 { lon: 139.003, lat: 35.0, ordinal: 0.0 },
        )
        .expect("endpoints route");
        assert_eq!(r.segments.len(), 1);
        assert_eq!(r.segments[0].ordinal, 0.0);
        // The bend vertex is present → the line hugs the corridor.
        assert!(r.segments[0].coordinates.contains(&[139.001, 35.001]));
        assert_eq!(r.segments[0].coordinates.first(), Some(&[139.0, 35.0]));
        assert_eq!(r.segments[0].coordinates.last(), Some(&[139.003, 35.0]));
    }

    #[test]
    fn route_from_mid_corridor_click_starts_at_projection() {
        let graph = RouteGraph {
            nodes: vec![
                RouteNode { lon: 139.0, lat: 35.0, ordinal: 0.0 },
                RouteNode { lon: 139.002, lat: 35.0, ordinal: 0.0 },
            ],
            edges: vec![RouteEdge { from: 0, to: 1, weight: 100.0, ordinal: 0.0, interior: vec![] }],
        };
        // Both clicks land mid-edge (same edge) → straight slice between them.
        let r = route(
            &graph,
            Point3 { lon: 139.0005, lat: 35.0002, ordinal: 0.0 },
            Point3 { lon: 139.0015, lat: 35.0002, ordinal: 0.0 },
        )
        .expect("same-edge route");
        let first = r.origin_projected;
        assert!((first[0] - 139.0005).abs() < 1e-3);
        assert_eq!(r.segments[0].coordinates.first().map(|c| c[0]), Some(r.origin_projected[0]));
        assert_eq!(r.segments[0].coordinates.last().map(|c| c[0]), Some(r.dest_projected[0]));
    }

    #[test]
    fn route_splits_segments_at_floor_change() {
        let graph = RouteGraph {
            nodes: vec![
                RouteNode { lon: 139.0, lat: 35.0, ordinal: 0.0 },
                RouteNode { lon: 139.001, lat: 35.0, ordinal: 0.0 },
                RouteNode { lon: 139.001, lat: 35.0, ordinal: 1.0 },
            ],
            edges: vec![
                RouteEdge { from: 0, to: 1, weight: 100.0, ordinal: 0.0, interior: vec![] },
                RouteEdge { from: 1, to: 2, weight: 5000.0, ordinal: 1.0, interior: vec![] },
            ],
        };
        let r = route(
            &graph,
            Point3 { lon: 139.0, lat: 35.0, ordinal: 0.0 },
            Point3 { lon: 139.001, lat: 35.0, ordinal: 1.0 },
        )
        .expect("cross-floor route");
        let ords: Vec<f64> = r.segments.iter().map(|s| s.ordinal).collect();
        assert_eq!(ords, vec![0.0, 1.0]);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p kiriko-route route_ 2>&1 | tail -20`
Expected: FAIL/compile error — `Route` has no `segments`; old `route` returned `nodes`.

- [ ] **Step 3: Rewrite `Route`/`route` in `query.rs`.** Replace the `Route` struct and the whole `route` fn with:

```rust
/// One maximal run of the route on a single floor ordinal.
#[derive(Debug, Clone, PartialEq)]
pub struct RouteSegment {
    pub ordinal: f64,
    pub coordinates: Vec<[f64; 2]>,
}

/// A computed route: floor-grouped corridor polylines plus the two endpoints
/// projected onto the network (`[lon, lat, ordinal]`) and the total edge cost.
#[derive(Debug, Clone, PartialEq)]
pub struct Route {
    pub segments: Vec<RouteSegment>,
    pub total_weight: f32,
    pub origin_projected: [f64; 3],
    pub dest_projected: [f64; 3],
}

/// A route vertex tagged with the ordinal of the edge it belongs to; grouped
/// into `RouteSegment`s at the end.
struct TaggedVertex {
    coord: [f64; 2],
    ordinal: f64,
}

pub fn route(graph: &RouteGraph, origin: Point3, dest: Point3) -> Option<Route> {
    let o = snap_to_edge(graph, &origin)?;
    let d = snap_to_edge(graph, &dest)?;
    let origin_projected = [o.projected[0], o.projected[1], o.ordinal];
    let dest_projected = [d.projected[0], d.projected[1], d.ordinal];

    // Same-edge shortcut: walk straight along the one edge between projections.
    if o.edge_index == d.edge_index {
        let e = &graph.edges[o.edge_index];
        let poly = graph.edge_polyline(e);
        let (lo, hi) = (o.along.min(d.along), o.along.max(d.along));
        let mut coords = vec![[origin_projected[0], origin_projected[1]]];
        // Interior polyline vertices whose arc-length falls strictly between.
        let mut acc = 0.0;
        for w in poly.windows(2) {
            acc += haversine_m(w[0][0], w[0][1], w[1][0], w[1][1]);
            if acc > lo && acc < hi {
                coords.push(w[1]);
            }
        }
        coords.push([dest_projected[0], dest_projected[1]]);
        if o.along > d.along {
            coords.reverse();
        }
        let weight = (e.weight as f64 * (hi - lo) / o.total.max(f64::EPSILON)) as f32;
        return Some(Route {
            segments: group_segments(coords.into_iter().map(|c| TaggedVertex { coord: c, ordinal: e.ordinal }).collect()),
            total_weight: weight,
            origin_projected,
            dest_projected,
        });
    }

    let n = graph.nodes.len();
    let mut adj: Vec<Vec<(usize, usize, f32)>> = vec![Vec::new(); n]; // (next, edge_index, weight)
    let mut k = f64::INFINITY;
    for (ei, e) in graph.edges.iter().enumerate() {
        let (from, to) = (e.from as usize, e.to as usize);
        if from >= n || to >= n {
            continue;
        }
        adj[from].push((to, ei, e.weight));
        adj[to].push((from, ei, e.weight));
        let m = haversine_m(graph.nodes[from].lon, graph.nodes[from].lat, graph.nodes[to].lon, graph.nodes[to].lat);
        if m > 0.0 {
            k = k.min(f64::from(e.weight) / m);
        }
    }
    if !k.is_finite() {
        k = 0.0;
    }
    // Partial-edge costs from each projection to that edge's endpoints.
    let oe = &graph.edges[o.edge_index];
    let de = &graph.edges[d.edge_index];
    let o_from_cost = f64::from(oe.weight) * o.along / o.total.max(f64::EPSILON);
    let o_to_cost = f64::from(oe.weight) * (o.total - o.along) / o.total.max(f64::EPSILON);
    let d_from_cost = f64::from(de.weight) * d.along / d.total.max(f64::EPSILON);
    let d_to_cost = f64::from(de.weight) * (d.total - d.along) / d.total.max(f64::EPSILON);

    // Heuristic toward the destination projection point.
    let h = |i: usize| {
        let node = &graph.nodes[i];
        k * haversine_m(node.lon, node.lat, dest_projected[0], dest_projected[1])
    };

    let mut dist = vec![f64::INFINITY; n];
    let mut parent: Vec<Option<(usize, usize)>> = vec![None; n]; // (prev_node, edge_index)
    let seed = [(oe.from as usize, o_from_cost), (oe.to as usize, o_to_cost)];
    let mut heap = BinaryHeap::new();
    for (node, g0) in seed {
        if g0 < dist[node] {
            dist[node] = g0;
            heap.push(Open { f: g0 + h(node), g: g0, node });
        }
    }
    let (dp, dq) = (de.from as usize, de.to as usize);
    // Run until both destination endpoints are finalized or the heap empties.
    let mut settled_p = false;
    let mut settled_q = false;
    while let Some(Open { g, node, .. }) = heap.pop() {
        if g > dist[node] {
            continue;
        }
        if node == dp {
            settled_p = true;
        }
        if node == dq {
            settled_q = true;
        }
        if settled_p && settled_q {
            break;
        }
        for &(next, ei, w) in &adj[node] {
            let ng = g + f64::from(w);
            if ng < dist[next] {
                dist[next] = ng;
                parent[next] = Some((node, ei));
                heap.push(Open { f: ng + h(next), g: ng, node: next });
            }
        }
    }

    // Pick the destination endpoint minimizing (dist + partial-to-dest).
    let cand_p = if dist[dp].is_finite() { Some((dp, dist[dp] + d_from_cost)) } else { None };
    let cand_q = if dist[dq].is_finite() { Some((dq, dist[dq] + d_to_cost)) } else { None };
    let (goal, total) = [cand_p, cand_q]
        .into_iter()
        .flatten()
        .min_by(|a, b| a.1.total_cmp(&b.1))?;

    // Reconstruct the node path goal → origin endpoint.
    let mut node_path = vec![goal];
    let mut edge_path = Vec::new(); // edge_index used to STEP INTO each node from its parent
    let mut cur = goal;
    while let Some((prev, ei)) = parent[cur] {
        edge_path.push(ei);
        node_path.push(prev);
        cur = prev;
    }
    node_path.reverse();
    edge_path.reverse();
    // `node_path[i] -> node_path[i+1]` traverses `edge_path[i]`.

    // Assemble tagged vertices: origin projection → first node partial → edge
    // polylines (oriented) → last node → dest projection partial.
    let mut verts: Vec<TaggedVertex> = Vec::new();
    verts.push(TaggedVertex { coord: [origin_projected[0], origin_projected[1]], ordinal: oe.ordinal });
    // Partial from origin projection to the first node along the origin edge.
    let first_node = node_path[0];
    for c in partial_polyline(graph, oe, o.along, first_node == oe.from as usize) {
        verts.push(TaggedVertex { coord: c, ordinal: oe.ordinal });
    }
    // Node-to-node edge polylines (skip the shared leading vertex each time).
    for w in 0..edge_path.len() {
        let e = &graph.edges[edge_path[w]];
        let forward = node_path[w] == e.from as usize;
        let mut poly = graph.edge_polyline(e);
        if !forward {
            poly.reverse();
        }
        for c in poly.into_iter().skip(1) {
            verts.push(TaggedVertex { coord: c, ordinal: e.ordinal });
        }
    }
    // Partial from the last node to the dest projection along the dest edge.
    let last_node = *node_path.last().unwrap();
    for c in partial_polyline(graph, de, d.along, last_node == de.from as usize).into_iter().rev() {
        // partial_polyline returns projection→endpoint; we need endpoint→projection.
        verts.push(TaggedVertex { coord: c, ordinal: de.ordinal });
    }
    verts.push(TaggedVertex { coord: [dest_projected[0], dest_projected[1]], ordinal: de.ordinal });

    Some(Route {
        segments: group_segments(verts),
        total_weight: total as f32,
        origin_projected,
        dest_projected,
    })
}

/// Vertices of `edge`'s polyline from the projection (at arc-length `along`) to
/// the endpoint indicated by `to_from` (`true` = the edge's `from` endpoint),
/// EXCLUDING the projection point itself (the caller already emitted it) and
/// INCLUDING the endpoint node.
fn partial_polyline(graph: &RouteGraph, edge: &RouteEdge, along: f64, to_from: bool) -> Vec<[f64; 2]> {
    let poly = graph.edge_polyline(edge);
    let mut acc = 0.0;
    let mut out: Vec<[f64; 2]> = Vec::new();
    // Collect vertices on the side of `along` toward the chosen endpoint.
    let mut cum = vec![0.0];
    for w in poly.windows(2) {
        acc += haversine_m(w[0][0], w[0][1], w[1][0], w[1][1]);
        cum.push(acc);
    }
    if to_from {
        // toward `from` (arc-length 0): vertices with cum < along, descending.
        for i in (0..poly.len()).rev() {
            if cum[i] < along {
                out.push(poly[i]);
            }
        }
    } else {
        // toward `to` (arc-length total): vertices with cum > along, ascending.
        for i in 0..poly.len() {
            if cum[i] > along {
                out.push(poly[i]);
            }
        }
    }
    out
}

/// Collapse consecutive same-ordinal vertices into `RouteSegment` runs,
/// dropping exact-duplicate adjacent coordinates.
fn group_segments(verts: Vec<TaggedVertex>) -> Vec<RouteSegment> {
    let mut segments: Vec<RouteSegment> = Vec::new();
    for v in verts {
        match segments.last_mut() {
            Some(seg) if seg.ordinal == v.ordinal => {
                if seg.coordinates.last() != Some(&v.coord) {
                    seg.coordinates.push(v.coord);
                }
            }
            _ => segments.push(RouteSegment { ordinal: v.ordinal, coordinates: vec![v.coord] }),
        }
    }
    // A single-vertex trailing run (e.g. a bare floor-transition point) is not
    // drawable; keep only runs with >= 2 points.
    segments.retain(|s| s.coordinates.len() >= 2);
    segments
}
```

Note for the implementer: the `partial_polyline` for the DEST side is consumed with `.rev()` at the call site so it reads endpoint→projection; verify the two tests `route_traces_the_corridor_polyline` and `route_splits_segments_at_floor_change` pin the orientation.

- [ ] **Step 4: Run the route tests**

Run: `cargo test -p kiriko-route route_ 2>&1 | tail -30`
Expected: PASS for the three new tests. Fix orientation/off-by-one against the assertions if red.

- [ ] **Step 5: Run the whole crate**

Run: `cargo test -p kiriko-route 2>&1 | tail -20`
Expected: PASS. (`snap`/the old node-based helper may now be unused — if `snap` is dead, delete it and its test; `route` fully replaces node snapping.)

- [ ] **Step 6: Commit**

```bash
git add core/crates/kiriko-route/src/query.rs
git commit -m "feat(route): edge-projection A* returning floor-grouped corridor segments"
```

---

### Task 4: Encode edge geometry + ordinal in KVB §5

**Files:**
- Modify: `core/crates/kiriko-bundle/src/sections.rs`
- Test: `core/crates/kiriko-bundle/src/sections.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes: `RouteEdge { …, ordinal, interior }` (Task 1).
- Produces: §5 round-trips `interior` + `ordinal`.

- [ ] **Step 1: Write the failing test** — in `sections.rs` `mod tests`, extend `graph_section_round_trips` (or add a sibling) to include a curved edge and assert it survives:

```rust
    #[test]
    fn graph_section_round_trips_edge_geometry() {
        use kiriko_route::{RouteEdge, RouteGraph, RouteNode};
        let mut doc = minimal_document();
        doc.graph = Some(RouteGraph {
            nodes: vec![
                RouteNode { lon: 139.0, lat: 35.0, ordinal: 0.0 },
                RouteNode { lon: 139.002, lat: 35.0, ordinal: 0.0 },
            ],
            edges: vec![RouteEdge {
                from: 0,
                to: 1,
                weight: 12.5,
                ordinal: 0.0,
                interior: vec![[139.001, 35.001]],
            }],
        });
        let bytes = crate::encode_bundle(&doc).expect("encodes");
        let back = crate::decode_bundle(&bytes).expect("decodes");
        assert_eq!(back.graph, doc.graph);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p kiriko-bundle graph_section_round_trips_edge_geometry 2>&1 | tail -20`
Expected: FAIL — decoded edge loses `interior`/`ordinal` (fields not encoded).

- [ ] **Step 3: Extend the DTO + encode/decode/validate.** In `sections.rs`:

Replace `GraphEdgeDto`:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct GraphEdgeDto {
    from: u32,
    to: u32,
    weight: f32,
    ordinal: f64,
    interior: Vec<[f64; 2]>,
}
```

In `encode_graph`, replace the edge push:

```rust
    for edge in &graph.edges {
        validate_graph_edge(edge.from, edge.to, edge.weight, edge.ordinal, &edge.interior, node_count)?;
        let mut interior = Vec::with_capacity(edge.interior.len());
        for c in &edge.interior {
            interior.push([canonical_f64(c[0])?, canonical_f64(c[1])?]);
        }
        edges.push(GraphEdgeDto {
            from: edge.from,
            to: edge.to,
            weight: edge.weight,
            ordinal: canonical_f64(edge.ordinal)?,
            interior,
        });
    }
```

In `decode_graph`, replace the edge push (this also finishes the Task 1 stub):

```rust
    for edge in &dto.edges {
        validate_graph_edge(edge.from, edge.to, edge.weight, edge.ordinal, &edge.interior, node_count)?;
        let mut interior = Vec::with_capacity(edge.interior.len());
        for c in &edge.interior {
            interior.push([canonical_f64(c[0])?, canonical_f64(c[1])?]);
        }
        edges.push(kiriko_route::RouteEdge {
            from: edge.from,
            to: edge.to,
            weight: edge.weight,
            ordinal: canonical_f64(edge.ordinal)?,
            interior,
        });
    }
```

Replace `validate_graph_edge` signature + body:

```rust
fn validate_graph_edge(
    from: u32,
    to: u32,
    weight: f32,
    ordinal: f64,
    interior: &[[f64; 2]],
    node_count: usize,
) -> Result<(), BundleError> {
    if from as usize >= node_count || to as usize >= node_count {
        return Err(BundleError::new(
            BundleErrorCode::InvalidBundle,
            format!("graph edge endpoint ({from}, {to}) is out of bounds for {node_count} node(s)"),
        ));
    }
    if !weight.is_finite() || !ordinal.is_finite() {
        return Err(BundleError::new(
            BundleErrorCode::InvalidBundle,
            "graph edge weight and ordinal must be finite",
        ));
    }
    if interior.iter().any(|c| !c[0].is_finite() || !c[1].is_finite()) {
        return Err(BundleError::new(
            BundleErrorCode::InvalidBundle,
            "graph edge interior coordinate must be finite",
        ));
    }
    Ok(())
}
```

Update the existing `rejects_graph_edge_out_of_bounds` test's `GraphEdgeDto` literal to include `ordinal: 0.0, interior: vec![]`.

- [ ] **Step 4: Run tests**

Run: `cargo test -p kiriko-bundle 2>&1 | tail -25`
Expected: PASS except the pre-existing `golden_fixture_matches_committed_bytes_and_checksum` (a Windows CRLF artifact in `minimal.kvb.sha256`, unrelated — leave it). The graph round-trip tests pass.

- [ ] **Step 5: Commit**

```bash
git add core/crates/kiriko-bundle/src/sections.rs
git commit -m "feat(bundle): encode edge interior geometry + ordinal in KVB section 5"
```

---

### Task 5: Surface segments + projected endpoints from wasm

**Files:**
- Modify: `core/crates/kiriko-wasm/src/lib.rs`
- Test: `core/crates/kiriko-wasm/src/lib.rs` (`#[cfg(test)]`)

**Interfaces:**
- Consumes: `kiriko_route::{Route, RouteSegment}` (Task 3).
- Produces: `routeBundle` returns `{ segments:[{ordinal, coordinates:[[lon,lat]…]}], totalWeight, originProjected:[lon,lat,ordinal], destProjected:[lon,lat,ordinal] }`.

- [ ] **Step 1: Write the failing test** — in `lib.rs` `mod tests`, replace the body of the existing route test (`route_between_two_node_points_returns_some`) to assert the new shape. The `NETWORK_PATHS` fixture already carries `MultiLineString` geometry:

```rust
    #[test]
    fn route_returns_floor_grouped_segments() {
        let bundle = compile_with_graph();
        let document = decode_bundle(&bundle).expect("bundle decodes");
        let route = route_in_document(
            &document,
            Point3 { lon: 139.0, lat: 35.0, ordinal: 0.0 },
            Point3 { lon: 139.001, lat: 35.0, ordinal: 0.0 },
        )
        .expect("node 1 to node 2 must route");
        assert!(!route.segments.is_empty());
        assert_eq!(route.segments[0].ordinal, 0.0);
        assert!(route.segments[0].coordinates.len() >= 2);
        assert_eq!(route.origin_projected.len(), 3);
        assert_eq!(route.total_weight, 100.0);
    }
```

(Field names above are on the internal `RouteDto`; keep it mirroring the wasm JSON keys. If a helper `route_in_document` returns `RouteDto`, expose the fields as `pub(crate)` or assert via the mirrored names you choose.)

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p kiriko-wasm route_ 2>&1 | tail -20`
Expected: FAIL — `RouteDto` has `nodes`, not `segments`.

- [ ] **Step 3: Rewrite the route DTO** in `lib.rs` — replace `NodeDto`/`RouteDto`/`From<Route>`:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RouteSegmentDto {
    ordinal: f64,
    coordinates: Vec<[f64; 2]>,
}

/// Computed route serialized as
/// `{ segments:[{ordinal,coordinates}], totalWeight, originProjected, destProjected }`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RouteDto {
    pub(crate) segments: Vec<RouteSegmentDto>,
    pub(crate) total_weight: f32,
    pub(crate) origin_projected: [f64; 3],
    pub(crate) dest_projected: [f64; 3],
}

impl From<Route> for RouteDto {
    fn from(route: Route) -> Self {
        RouteDto {
            segments: route
                .segments
                .into_iter()
                .map(|s| RouteSegmentDto { ordinal: s.ordinal, coordinates: s.coordinates })
                .collect(),
            total_weight: route.total_weight,
            origin_projected: route.origin_projected,
            dest_projected: route.dest_projected,
        }
    }
}
```

Update the doc comment on `route_bundle` to describe the new shape. No change to the `route_bundle` fn body (still `route_in_document(...).map(RouteDto::from)` → serialize).

- [ ] **Step 4: Run tests**

Run: `cargo test -p kiriko-wasm 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/crates/kiriko-wasm/src/lib.rs
git commit -m "feat(wasm): routeBundle returns floor-grouped segments + projected endpoints"
```

---

### Task 6: Client route types + result validation

**Files:**
- Modify: `src/bundle/wasm.ts`
- Modify: `src/bundle/routeKirikoBundle.ts`
- Test: existing `src/bundle/routeKirikoBundle.test.ts` (update)

**Interfaces:**
- Consumes: wasm `routeBundle` JSON (Task 5).
- Produces:
  - `RouteSegmentDto { ordinal: number; coordinates: [number, number][] }`
  - `RouteResultDto { segments: RouteSegmentDto[]; totalWeight: number; originProjected: [number, number, number]; destProjected: [number, number, number] }`

- [ ] **Step 1: Update types** in `src/bundle/wasm.ts` — replace `RouteNodeDto` and `RouteResultDto`:

```ts
/** One floor-grouped run of the route polyline. */
export interface RouteSegmentDto {
  ordinal: number;
  coordinates: [number, number][];
}

/** Computed route: corridor polyline segments, total edge weight, and the
 *  origin/destination projected onto the network ([lon, lat, ordinal]). */
export interface RouteResultDto {
  segments: RouteSegmentDto[];
  totalWeight: number;
  originProjected: [number, number, number];
  destProjected: [number, number, number];
}
```

- [ ] **Step 2: Update the validator test first** — in `src/bundle/routeKirikoBundle.test.ts`, change the sample route object(s) from `{ nodes: [...], totalWeight }` to the new shape, e.g.:

```ts
const routeResult = {
  segments: [{ ordinal: 0, coordinates: [[139, 35], [139.001, 35]] }],
  totalWeight: 100,
  originProjected: [139, 35, 0],
  destProjected: [139.001, 35, 0],
};
```

Run: `pnpm exec vitest run routeKirikoBundle 2>&1 | tail -20`
Expected: FAIL — `isRouteResult` still checks `nodes`.

- [ ] **Step 3: Update the validator** in `src/bundle/routeKirikoBundle.ts` — replace `isRouteNode`/`isRouteResult`:

```ts
function isLonLat(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber);
}

function isTriple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function isSegment(value: unknown): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const seg = value as Record<string, unknown>;
  return (
    isFiniteNumber(seg["ordinal"]) &&
    Array.isArray(seg["coordinates"]) &&
    seg["coordinates"].every(isLonLat)
  );
}

function isRouteResult(value: unknown): value is RouteResultDto {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const route = value as Record<string, unknown>;
  return (
    Array.isArray(route["segments"]) &&
    route["segments"].every(isSegment) &&
    isFiniteNumber(route["totalWeight"]) &&
    isTriple(route["originProjected"]) &&
    isTriple(route["destProjected"])
  );
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm exec vitest run routeKirikoBundle && pnpm exec tsc --noEmit 2>&1 | tail -20`
Expected: PASS; tsc surfaces the `buildRouteFeatures` consumer breakage (fixed in Task 7) — if tsc is red only inside `routeFeatures.ts`, that is expected now.

- [ ] **Step 5: Commit**

```bash
git add src/bundle/wasm.ts src/bundle/routeKirikoBundle.ts src/bundle/routeKirikoBundle.test.ts
git commit -m "feat(viewer): route result carries corridor segments + projected endpoints"
```

---

### Task 7: Render corridor segments + click connectors

**Files:**
- Modify: `src/map/routeFeatures.ts`
- Modify: `src/map/featureLayers.ts` (connector layer + constant + theme paint)
- Modify: `src/map/buildIndoorStyle.ts` if route layers are assembled there (verify)
- Test: `src/map/routeFeatures.test.ts` (create or extend), `src/map/featureLayers.test.ts`

**Interfaces:**
- Consumes: `RouteFeaturesInput { origin, destination, route: RouteResultDto | null }`, `RouteResultDto` (Task 6).
- Produces: GeoJSON with `kind:"segment"` (corridor polylines, floor-filtered), `kind:"connector"` (click→projection, floor-filtered), plus existing `kind:"origin"`/`"destination"` points. New layer id `LAYER_ROUTE_CONNECTOR`.

- [ ] **Step 1: Write the failing test** — in `src/map/routeFeatures.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRouteFeatures } from "./routeFeatures";
import type { RouteResultDto } from "../bundle/wasm";

const route: RouteResultDto = {
  segments: [
    { ordinal: 0, coordinates: [[139.0, 35.0], [139.001, 35.001], [139.002, 35.0]] },
    { ordinal: 1, coordinates: [[139.002, 35.0], [139.003, 35.0]] },
  ],
  totalWeight: 42,
  originProjected: [139.0, 35.0, 0],
  destProjected: [139.003, 35.0, 1],
};

describe("buildRouteFeatures corridor rendering", () => {
  it("draws the real corridor polyline for the active floor", () => {
    const fc = buildRouteFeatures(
      { origin: { longitude: 138.9, latitude: 34.9, ordinal: 0 }, destination: { longitude: 139.1, latitude: 35.1, ordinal: 1 }, route },
      0,
    );
    const seg = fc.features.find((f) => f.properties?.["kind"] === "segment");
    expect(seg).toBeDefined();
    expect((seg!.geometry as GeoJSON.LineString).coordinates).toEqual([
      [139.0, 35.0], [139.001, 35.001], [139.002, 35.0],
    ]);
  });

  it("draws a connector from the click to the projected origin on its floor", () => {
    const fc = buildRouteFeatures(
      { origin: { longitude: 138.9, latitude: 34.9, ordinal: 0 }, destination: { longitude: 139.1, latitude: 35.1, ordinal: 1 }, route },
      0,
    );
    const connector = fc.features.find((f) => f.properties?.["kind"] === "connector");
    expect((connector!.geometry as GeoJSON.LineString).coordinates).toEqual([[138.9, 34.9], [139.0, 35.0]]);
  });

  it("hides other floors' segments and connectors", () => {
    const fc = buildRouteFeatures(
      { origin: { longitude: 138.9, latitude: 34.9, ordinal: 0 }, destination: { longitude: 139.1, latitude: 35.1, ordinal: 1 }, route },
      1,
    );
    const kinds = fc.features.map((f) => f.properties?.["kind"]).sort();
    // Only the ordinal-1 segment + the dest connector + dest point.
    expect(kinds).toEqual(["connector", "destination", "segment"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run routeFeatures 2>&1 | tail -20`
Expected: FAIL — old `buildRouteFeatures` reads `route.nodes`.

- [ ] **Step 3: Rewrite `buildRouteFeatures`** in `src/map/routeFeatures.ts`:

```ts
export function buildRouteFeatures(
  input: RouteFeaturesInput | null,
  activeOrdinal: number,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (input === null) {
    return { type: "FeatureCollection", features };
  }
  const { origin, destination, route } = input;

  if (route !== null) {
    for (const segment of route.segments) {
      if (segment.ordinal === activeOrdinal && segment.coordinates.length >= 2) {
        features.push({
          type: "Feature",
          properties: { kind: "segment" },
          geometry: { type: "LineString", coordinates: segment.coordinates },
        });
      }
    }
    // Connectors: raw click → projected point, on the projection's floor.
    const [oLon, oLat, oOrd] = route.originProjected;
    if (origin !== null && oOrd === activeOrdinal) {
      features.push({
        type: "Feature",
        properties: { kind: "connector" },
        geometry: { type: "LineString", coordinates: [[origin.longitude, origin.latitude], [oLon, oLat]] },
      });
    }
    const [dLon, dLat, dOrd] = route.destProjected;
    if (destination !== null && dOrd === activeOrdinal) {
      features.push({
        type: "Feature",
        properties: { kind: "connector" },
        geometry: { type: "LineString", coordinates: [[destination.longitude, destination.latitude], [dLon, dLat]] },
      });
    }
  }

  if (origin !== null && origin.ordinal === activeOrdinal) {
    features.push({
      type: "Feature",
      properties: { kind: "origin" },
      geometry: { type: "Point", coordinates: [origin.longitude, origin.latitude] },
    });
  }
  if (destination !== null && destination.ordinal === activeOrdinal) {
    features.push({
      type: "Feature",
      properties: { kind: "destination" },
      geometry: { type: "Point", coordinates: [destination.longitude, destination.latitude] },
    });
  }

  return { type: "FeatureCollection", features };
}
```

- [ ] **Step 4: Add the connector layer** in `src/map/featureLayers.ts`. Add a constant beside `LAYER_ROUTE`:

```ts
export const LAYER_ROUTE_CONNECTOR = "indoor-route-connector";
```

In `buildRouteLayers(theme)`, add a dashed connector line BELOW the main route line (so the route draws on top), filtered to `kind:"connector"`:

```ts
    {
      id: LAYER_ROUTE_CONNECTOR,
      type: "line",
      source: ROUTE_SOURCE_ID,
      filter: ["==", ["get", "kind"], "connector"],
      paint: {
        "line-color": c.accent,
        "line-width": 2,
        "line-opacity": 0.7,
        "line-dasharray": [1.5, 1.5],
      },
    },
```

(The main route line's filter is `["==", ["get","kind"], "segment"]` — confirm it already matches `"segment"`; it does per `featureLayers.test.ts`.) Add the theme repaint in `applyThemePaintProperties`:

```ts
  setPaintProperty(LAYER_ROUTE_CONNECTOR, "line-color", c.accent);
```

- [ ] **Step 5: Add a featureLayers test** in `src/map/featureLayers.test.ts` (route describe block):

```ts
  it("adds a dashed connector line filtered to connector features, kept out of hit-testing", () => {
    const layers = buildRouteLayers(theme);
    const connector = layers.find((l) => l.id === LAYER_ROUTE_CONNECTOR) as LineLayerSpecification;
    expect(connector.filter).toEqual(["==", ["get", "kind"], "connector"]);
    expect(connector.paint?.["line-dasharray"]).toEqual([1.5, 1.5]);
    expect(CLICKABLE_LAYER_IDS).not.toContain(LAYER_ROUTE_CONNECTOR);
  });
```

Add `LAYER_ROUTE_CONNECTOR` to the imports in that test.

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm exec vitest run routeFeatures featureLayers && pnpm exec tsc --noEmit 2>&1 | tail -20`
Expected: PASS; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/map/routeFeatures.ts src/map/featureLayers.ts src/map/routeFeatures.test.ts src/map/featureLayers.test.ts
git commit -m "feat(viewer): render corridor polylines + dashed click connectors"
```

---

### Task 8: Rebuild, full suite, end-to-end verification

**Files:** none (verification + any fallout fixes).

- [ ] **Step 1: Rebuild the native addon + wasm**

Run:
```bash
pnpm core:build:node 2>&1 | tail -3 || true
cp -f core/target/x86_64-pc-windows-msvc/release/kiriko_node.dll core/crates/kiriko-node/kiriko-node.win32-x64-msvc.node
pnpm core:build:wasm 2>&1 | tail -5
```
Expected: fresh `.node` copied (napi's own copy step is flaky on Windows — the manual copy is authoritative); wasm rebuilt.

- [ ] **Step 2: Rust workspace**

Run: `cargo test --manifest-path core/Cargo.toml --workspace --no-fail-fast 2>&1 | grep -iE "test result:|FAILED"`
Expected: all pass EXCEPT the pre-existing `golden_fixture_matches_committed_bytes_and_checksum` (CRLF artifact). If any bundle graph test regenerated golden bytes, that is a real failure — investigate.

- [ ] **Step 3: Client + server suites + typecheck**

Run:
```bash
pnpm exec vitest run 2>&1 | grep -iE "Test Files|Tests |FAIL"
pnpm exec tsc --noEmit && pnpm --dir server exec tsc --noEmit
pnpm --dir server exec vitest run coreNative gdbRoutes 2>&1 | grep -iE "Test Files|Tests |FAIL"
```
Expected: all green.

- [ ] **Step 4: End-to-end on the real Tokyo network.** Compile a bundle from the staged blobs and route across (a) a curved corridor and (b) a floor change; confirm segments hug the corridor and projected endpoints differ from the raw click. Use a throwaway `server/tmp-routecheck.ts` (delete after) modeled on the decode scripts in this session: `compileImdf(source, "tokyo", 1, junctions, paths, undefined)` then `wasm.routeBundle(bundle, oLon,oLat,oOrd, dLon,dLat,dOrd)`; assert the result has `segments` with `coordinates.length > 2` on at least one segment and `originProjected !== [oLon,oLat,oOrd]` for an off-node click.

Run: `cd server && pnpm exec tsx tmp-routecheck.ts && rm -f tmp-routecheck.ts`
Expected: prints multi-vertex segments and distinct projected endpoints.

- [ ] **Step 5: Browser smoke (optional but recommended).** Compile the bundle to `public/fixed.kvb`, `pnpm exec vite --port 519x`, open `/?dataset=…` is server-gated — instead reuse the `?src` IMDF path only for buildings; for routing, verify via Step 4 (decode) which is authoritative. If a live view is wanted, republish through the GDB flow.

- [ ] **Step 6: Update docs + final commit.** In `docs/gdb-data-reference.md`, update the Routing section: `route()` now returns corridor `segments` + projected endpoints; the viewer draws real `net_path` polylines + a click connector; §5 carries per-edge `interior` + `ordinal`. Remove the "straight node-to-node" characterization.

```bash
git add docs/gdb-data-reference.md
git commit -m "docs: routing now traces net_path corridors with edge-projection snapping"
```

---

## Self-Review

**Spec coverage:** §4.1 edge storage → Task 1 (+Task 4 encode); §4.2 snapping → Task 2; §4.3 virtual-endpoint A\* → Task 3; §4.4 output shape → Tasks 3/5/6; §4.5 rendering + connector → Task 7; §4.6 floor handling → Tasks 1/3/7 (per-edge ordinal + `group_segments`); §6 testing → per-task tests + Task 8. Format bump/republish → Task 4 + Task 8 Step 5.

**Type consistency:** `RouteEdge { from, to, weight, ordinal, interior }` used identically in Tasks 1/4. `Route { segments, total_weight, origin_projected, dest_projected }` (Rust) → `RouteDto { segments, totalWeight, originProjected, destProjected }` (wasm camelCase, Task 5) → `RouteResultDto` (TS, Task 6) → consumed in Task 7. `RouteSegment{ordinal,coordinates}` ↔ `RouteSegmentDto`. `LAYER_ROUTE_CONNECTOR` defined Task 7, tested same task.

**Placeholder scan:** no TBD/TODO; every code step carries full code. The one judgment call (dest-side `partial_polyline` `.rev()` orientation) is pinned by the Task 3 tests.
