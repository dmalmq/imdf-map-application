use std::cmp::Ordering;
use std::collections::BinaryHeap;

use crate::graph::{RouteGraph, RouteNode};

/// A query endpoint: position plus venue level ordinal.
#[derive(Debug, Clone, Copy)]
pub struct Point3 {
    pub lon: f64,
    pub lat: f64,
    pub ordinal: f64,
}

/// A computed route: ordered nodes from origin snap to destination snap.
#[derive(Debug, Clone, PartialEq)]
pub struct Route {
    pub nodes: Vec<RouteNode>,
    pub total_weight: f32,
}

const EARTH_RADIUS_M: f64 = 6_371_000.0;

/// Great-circle distance in metres.
fn haversine_m(lon1: f64, lat1: f64, lon2: f64, lat2: f64) -> f64 {
    let (lat1, lat2) = (lat1.to_radians(), lat2.to_radians());
    let dlat = lat2 - lat1;
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (dlon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_M * a.sqrt().asin()
}

/// Snap a query point to the nearest graph node; nodes on the same floor
/// ordinal are preferred over closer nodes on other floors.
fn snap(graph: &RouteGraph, p: &Point3) -> Option<usize> {
    graph
        .nodes
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
            (a.ordinal != p.ordinal)
                .cmp(&(b.ordinal != p.ordinal))
                .then_with(|| {
                    haversine_m(p.lon, p.lat, a.lon, a.lat)
                        .total_cmp(&haversine_m(p.lon, p.lat, b.lon, b.lat))
                })
        })
        .map(|(i, _)| i)
}

#[derive(Clone, Copy, PartialEq)]
struct Open {
    f: f64,
    g: f64,
    node: usize,
}

impl Eq for Open {}

impl Ord for Open {
    fn cmp(&self, other: &Self) -> Ordering {
        // Min-heap by f, ties broken by node index for determinism.
        other
            .f
            .total_cmp(&self.f)
            .then_with(|| self.node.cmp(&other.node))
    }
}

impl PartialOrd for Open {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Route from `origin` to `dest` over the graph: snap both endpoints to the
/// nearest node, then A* (edges traversed in both directions). Returns `None`
/// when the snapped endpoints are disconnected.
pub fn route(graph: &RouteGraph, origin: Point3, dest: Point3) -> Option<Route> {
    let start = snap(graph, &origin)?;
    let goal = snap(graph, &dest)?;
    let n = graph.nodes.len();

    // Bidirectional adjacency. Edge weights are abstract costs, so the
    // haversine heuristic is scaled by the cheapest cost-per-metre edge to
    // stay admissible (any path costs at least k × its straight-line metres).
    let mut adj: Vec<Vec<(usize, f32)>> = vec![Vec::new(); n];
    let mut k = f64::INFINITY;
    for e in &graph.edges {
        let (from, to) = (e.from as usize, e.to as usize);
        if from >= n || to >= n {
            continue;
        }
        adj[from].push((to, e.weight));
        adj[to].push((from, e.weight));
        let (a, b) = (&graph.nodes[from], &graph.nodes[to]);
        let metres = haversine_m(a.lon, a.lat, b.lon, b.lat);
        if metres > 0.0 {
            k = k.min(f64::from(e.weight) / metres);
        }
    }
    if !k.is_finite() {
        k = 0.0;
    }
    let goal_node = &graph.nodes[goal];
    let h = |i: usize| {
        let node = &graph.nodes[i];
        k * haversine_m(node.lon, node.lat, goal_node.lon, goal_node.lat)
    };

    let mut dist = vec![f64::INFINITY; n];
    let mut parent: Vec<Option<usize>> = vec![None; n];
    dist[start] = 0.0;
    let mut heap = BinaryHeap::new();
    heap.push(Open { f: h(start), g: 0.0, node: start });
    while let Some(Open { g, node, .. }) = heap.pop() {
        if node == goal {
            break;
        }
        if g > dist[node] {
            continue;
        }
        for &(next, w) in &adj[node] {
            let ng = g + f64::from(w);
            if ng < dist[next] {
                dist[next] = ng;
                parent[next] = Some(node);
                heap.push(Open { f: ng + h(next), g: ng, node: next });
            }
        }
    }
    if dist[goal].is_infinite() {
        return None;
    }

    let mut nodes = Vec::new();
    let mut cur = goal;
    loop {
        nodes.push(graph.nodes[cur].clone());
        match parent[cur] {
            Some(prev) => cur = prev,
            None => break,
        }
    }
    nodes.reverse();
    Some(Route {
        nodes,
        total_weight: dist[goal] as f32,
    })
}

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
                RouteEdge { from: 0, to: 1, weight: 10.0, ordinal: 0.0, interior: vec![] },
                RouteEdge { from: 1, to: 2, weight: 10.0, ordinal: 0.0, interior: vec![] },
                RouteEdge { from: 0, to: 2, weight: 100.0, ordinal: 0.0, interior: vec![] }, // direct but expensive
            ],
        }
    }

    #[test]
    fn prefers_cheaper_multihop() {
        let r = route(
            &g(),
            Point3 { lon: 139.0, lat: 35.0, ordinal: 0.0 },
            Point3 { lon: 139.002, lat: 35.0, ordinal: 0.0 },
        )
        .unwrap();
        assert_eq!(r.nodes.len(), 3); // 0→1→2 (cost 20) beats 0→2 (cost 100)
        assert!((r.total_weight - 20.0).abs() < 1e-3);
    }

    #[test]
    fn none_when_disconnected() {
        let mut graph = g();
        graph.nodes.push(RouteNode { lon: 200.0, lat: 0.0, ordinal: 9.0 });
        let r = route(
            &graph,
            Point3 { lon: 139.0, lat: 35.0, ordinal: 0.0 },
            Point3 { lon: 200.0, lat: 0.0, ordinal: 9.0 },
        );
        assert!(r.is_none());
    }
}
