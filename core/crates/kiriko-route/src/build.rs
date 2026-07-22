use std::collections::{BTreeMap, HashMap};
use std::fmt;

use geojson::{FeatureCollection, GeoJson, Value};

use crate::floor::floor_to_ordinal;
use crate::graph::{RouteEdge, RouteGraph, RouteNode};

/// Non-fatal problem encountered while building a route graph.
#[derive(Debug, Clone, PartialEq)]
pub struct RouteBuildWarning {
    pub code: String,
    pub detail: String,
}

/// Fatal error: the input GeoJSON could not be parsed at all.
#[derive(Debug, Clone, PartialEq)]
pub struct RouteBuildError {
    pub message: String,
}

impl fmt::Display for RouteBuildError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for RouteBuildError {}

/// Result of [`build_route_graph`]: the graph, non-fatal warnings, and the
/// NODEID→index mapping (`node_ids[i]` is the source NODEID of `graph.nodes[i]`).
pub struct RouteGraphBuild {
    pub graph: RouteGraph,
    pub warnings: Vec<RouteBuildWarning>,
    pub node_ids: Vec<u64>,
}

/// Build a deterministic route graph from network junction and path GeoJSON.
///
/// Junctions carry `NODEID`/`FLOOR` properties and a Point geometry; paths carry
/// `FNODEID`/`TNODEID`/`cost`. Nodes on unmappable floors are dropped with an
/// `unmapped_floor` warning; edges referencing a missing node are dropped with a
/// `dangling_edge` warning. Nodes whose ordinal matches no venue level produce an
/// `unmatched_level` warning but are kept.
pub fn build_route_graph(
    junctions_geojson: &str,
    paths_geojson: &str,
    level_ordinals: &[f64],
) -> Result<RouteGraphBuild, RouteBuildError> {
    let junctions = parse_collection(junctions_geojson, "junctions")?;
    let paths = parse_collection(paths_geojson, "paths")?;
    let mut warnings = Vec::new();

    // Nodes keyed by NODEID; BTreeMap keeps iteration sorted → deterministic output.
    let mut by_id: BTreeMap<u64, RouteNode> = BTreeMap::new();
    for feature in &junctions.features {
        let (Some(id), Some(floor), Some(Value::Point(coords))) = (
            prop(&feature.properties, "NODEID").and_then(|v| v.as_u64()),
            prop(&feature.properties, "FLOOR").and_then(|v| v.as_str()),
            feature.geometry.as_ref().map(|g| &g.value),
        ) else {
            continue;
        };
        let (Some(&lon), Some(&lat)) = (coords.first(), coords.get(1)) else {
            continue;
        };
        let Some(ordinal) = floor_to_ordinal(floor) else {
            warnings.push(RouteBuildWarning {
                code: "unmapped_floor".into(),
                detail: format!("node {id} floor {floor:?} has no ordinal mapping"),
            });
            continue;
        };
        by_id.insert(id, RouteNode { lon, lat, ordinal });
    }

    let index: HashMap<u64, u32> = by_id
        .keys()
        .enumerate()
        .map(|(i, &id)| (id, i as u32))
        .collect();

    // Nodes in index order, for edge-ordinal fallback while edges are built.
    let nodes_by_idx: Vec<RouteNode> = by_id.values().cloned().collect();

    let mut edges = Vec::new();
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
    edges.sort_by(|a, b| {
        (a.from, a.to, a.weight.to_bits()).cmp(&(b.from, b.to, b.weight.to_bits()))
    });

    // NODEID order matches `by_id.into_values()` (BTreeMap) → parallel to `nodes`.
    let node_ids: Vec<u64> = by_id.keys().copied().collect();
    let nodes: Vec<RouteNode> = by_id.into_values().collect();
    for node in &nodes {
        if !level_ordinals.contains(&node.ordinal) {
            warnings.push(RouteBuildWarning {
                code: "unmatched_level".into(),
                detail: format!("node ordinal {} matches no venue level", node.ordinal),
            });
        }
    }

    Ok(RouteGraphBuild {
        graph: RouteGraph { nodes, edges },
        warnings,
        node_ids,
    })
}

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

fn parse_collection(src: &str, what: &str) -> Result<FeatureCollection, RouteBuildError> {
    let geojson: GeoJson = src.parse().map_err(|e| RouteBuildError {
        message: format!("invalid {what} GeoJSON: {e}"),
    })?;
    FeatureCollection::try_from(geojson).map_err(|e| RouteBuildError {
        message: format!("{what} GeoJSON is not a FeatureCollection: {e}"),
    })
}

fn prop<'a>(
    properties: &'a Option<serde_json::Map<String, serde_json::Value>>,
    key: &str,
) -> Option<&'a serde_json::Value> {
    properties.as_ref()?.get(key)
}

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
        let b = build_route_graph(JUNCTIONS, PATHS, &[0.0, 1.0]).unwrap();
        assert_eq!(b.graph.nodes.len(), 3);
        assert_eq!(b.graph.edges.len(), 2); // edge to NODEID 99 dropped
        assert!(b.warnings.iter().any(|w| w.code == "dangling_edge"));
    }

    #[test]
    fn drops_unmappable_floor_nodes() {
        let j = JUNCTIONS.replace("\"F2\"", "\"garbage\"");
        let b = build_route_graph(&j, PATHS, &[0.0, 1.0]).unwrap();
        assert_eq!(b.graph.nodes.len(), 2);
        assert!(b.warnings.iter().any(|w| w.code == "unmapped_floor"));
    }

    #[test]
    fn deterministic_output() {
        let a = build_route_graph(JUNCTIONS, PATHS, &[0.0, 1.0]).unwrap().graph;
        let b = build_route_graph(JUNCTIONS, PATHS, &[0.0, 1.0]).unwrap().graph;
        assert_eq!(a, b);
    }

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

    #[test]
    fn returns_node_ids_parallel_to_nodes() {
        let b = build_route_graph(JUNCTIONS, PATHS, &[0.0, 1.0]).unwrap();
        assert_eq!(b.node_ids.len(), b.graph.nodes.len());
        // NODEID 1 maps to the node at its index
        let idx = b.node_ids.iter().position(|&id| id == 1).unwrap();
        assert!((b.graph.nodes[idx].lon - 139.0).abs() < 1e-9);
    }
}
