#[derive(Debug, Clone, PartialEq)]
pub struct RouteGraph {
    pub nodes: Vec<RouteNode>,
    pub edges: Vec<RouteEdge>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RouteNode {
    pub lon: f64,
    pub lat: f64,
    pub ordinal: f64,
}

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
