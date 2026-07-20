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

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RouteEdge {
    pub from: u32,
    pub to: u32,
    pub weight: f32,
}

impl RouteGraph {
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }
}
