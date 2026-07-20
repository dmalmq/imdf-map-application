use std::collections::BTreeMap;
use std::fmt;

use geojson::{FeatureCollection, GeoJson, Value};

use crate::types::{Facilities, Facility, FacilityAnchor};

/// Non-fatal problem encountered while building facilities.
#[derive(Debug, Clone, PartialEq)]
pub struct FacilityBuildWarning {
    pub code: String,
    pub detail: String,
}

/// Fatal error: the input GeoJSON could not be parsed at all.
#[derive(Debug, Clone, PartialEq)]
pub struct FacilityBuildError {
    pub message: String,
}

impl fmt::Display for FacilityBuildError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for FacilityBuildError {}

/// Build a deterministic facility list from point-facility network GeoJSON.
///
/// Features carry `name`/`floor`/`image`/`nodeid1` properties and a Point
/// geometry. `floor` maps via [`kiriko_route::floor_to_ordinal`]; facilities on
/// unmappable floors are dropped with an `unmapped_floor` warning. `icon` is the
/// basename of `image` without extension. `nodeid1` (i64, >= 0) resolves through
/// `node_ids` (NODEID→index, parallel to `graph.nodes`) to a [`FacilityAnchor`];
/// otherwise the anchor is `None` with an `unresolved_anchor` warning.
pub fn build_facilities(
    facilities_geojson: &str,
    graph: &kiriko_route::RouteGraph,
    node_ids: &[u64],
) -> Result<(Facilities, Vec<FacilityBuildWarning>), FacilityBuildError> {
    let collection = parse_collection(facilities_geojson)?;
    let mut warnings = Vec::new();

    let index: BTreeMap<u64, u32> = node_ids
        .iter()
        .enumerate()
        .map(|(i, &id)| (id, i as u32))
        .collect();

    let mut items = Vec::new();
    for feature in &collection.features {
        let Some(Value::Point(coords)) = feature.geometry.as_ref().map(|g| &g.value) else {
            continue;
        };
        let (Some(&lon), Some(&lat)) = (coords.first(), coords.get(1)) else {
            continue;
        };
        let name = prop(&feature.properties, "name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let floor = prop(&feature.properties, "floor")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let Some(ordinal) = kiriko_route::floor_to_ordinal(floor) else {
            warnings.push(FacilityBuildWarning {
                code: "unmapped_floor".into(),
                detail: format!("facility {name:?} floor {floor:?} has no ordinal mapping"),
            });
            continue;
        };
        let icon = prop(&feature.properties, "image")
            .and_then(|v| v.as_str())
            .map(icon_of)
            .unwrap_or_default();
        // `nodeid1` absent or -1 is the expected "no routing anchor" case
        // (most named stores) and is silent. A non-negative id that fails to
        // resolve to a graph node is a genuine mismatch and warns.
        let nodeid1 = prop(&feature.properties, "nodeid1").and_then(|v| v.as_i64());
        let anchor = match nodeid1 {
            Some(id) if id >= 0 => {
                let resolved = index.get(&(id as u64)).and_then(|&i| {
                    graph.nodes.get(i as usize).map(|n| FacilityAnchor {
                        lon: n.lon,
                        lat: n.lat,
                        ordinal: n.ordinal,
                    })
                });
                if resolved.is_none() {
                    warnings.push(FacilityBuildWarning {
                        code: "unresolved_anchor".into(),
                        detail: format!("facility {name:?} nodeid1 {id} not in route graph"),
                    });
                }
                resolved
            }
            _ => None,
        };
        items.push(Facility {
            lon,
            lat,
            ordinal,
            name,
            icon,
            anchor,
        });
    }

    items.sort_by(|a, b| {
        (a.ordinal.to_bits(), a.lon.to_bits(), a.lat.to_bits(), &a.name)
            .cmp(&(b.ordinal.to_bits(), b.lon.to_bits(), b.lat.to_bits(), &b.name))
    });

    Ok((Facilities { items }, warnings))
}

/// Basename
fn icon_of(image: &str) -> String {
    let base = image.rsplit(['/', '\\']).next().unwrap_or("");
    match base.rfind('.') {
        Some(i) if i > 0 => base[..i].to_string(),
        _ => base.to_string(),
    }
}

fn parse_collection(src: &str) -> Result<FeatureCollection, FacilityBuildError> {
    let geojson: GeoJson = src.parse().map_err(|e| FacilityBuildError {
        message: format!("invalid facilities GeoJSON: {e}"),
    })?;
    FeatureCollection::try_from(geojson).map_err(|e| FacilityBuildError {
        message: format!("facilities GeoJSON is not a FeatureCollection: {e}"),
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

    const FAC: &str = r#"{"type":"FeatureCollection","features":[
 {"type":"Feature","properties":{"name":"Store A","floor":"F1","image":"/marker/ticket.png","nodeid1":10},"geometry":{"type":"Point","coordinates":[139.0,35.0]}},
 {"type":"Feature","properties":{"name":"Store B","floor":"F1","image":"","nodeid1":-1},"geometry":{"type":"Point","coordinates":[139.001,35.0]}},
 {"type":"Feature","properties":{"name":"Bad","floor":"garbage","image":"","nodeid1":10},"geometry":{"type":"Point","coordinates":[139.0,35.0]}}]}"#;

    fn graph() -> (kiriko_route::RouteGraph, Vec<u64>) {
        (
            kiriko_route::RouteGraph {
                nodes: vec![kiriko_route::RouteNode {
                    lon: 139.5,
                    lat: 35.5,
                    ordinal: 0.0,
                }],
                edges: vec![],
            },
            vec![10],
        )
    }

    #[test]
    fn builds_with_icon_and_anchor() {
        let (g, ids) = graph();
        let (f, warns) = build_facilities(FAC, &g, &ids).unwrap();
        assert_eq!(f.items.len(), 2); // "Bad" dropped (unmapped floor)
        let a = f.items.iter().find(|x| x.name == "Store A").unwrap();
        assert_eq!(a.icon, "ticket");
        assert_eq!(
            a.anchor,
            Some(FacilityAnchor {
                lon: 139.5,
                lat: 35.5,
                ordinal: 0.0
            })
        );
        let b = f.items.iter().find(|x| x.name == "Store B").unwrap();
        assert_eq!(b.icon, "");
        assert_eq!(b.anchor, None); // nodeid1 = -1
        assert!(warns.iter().any(|w| w.code == "unmapped_floor"));
        // nodeid1 = -1 is the expected "no anchor" case and must stay silent.
        assert!(!warns.iter().any(|w| w.code == "unresolved_anchor"));
    }

    #[test]
    fn warns_when_nonnegative_nodeid_missing_from_graph() {
        let (g, ids) = graph(); // graph only knows NODEID 10
        const MISS: &str = r#"{"type":"FeatureCollection","features":[
 {"type":"Feature","properties":{"name":"Orphan","floor":"F1","image":"","nodeid1":999},"geometry":{"type":"Point","coordinates":[139.0,35.0]}}]}"#;
        let (f, warns) = build_facilities(MISS, &g, &ids).unwrap();
        assert_eq!(f.items[0].anchor, None);
        assert!(warns.iter().any(|w| w.code == "unresolved_anchor"));
    }

    #[test]
    fn deterministic() {
        let (g, ids) = graph();
        assert_eq!(
            build_facilities(FAC, &g, &ids).unwrap().0,
            build_facilities(FAC, &g, &ids).unwrap().0
        );
    }
}
