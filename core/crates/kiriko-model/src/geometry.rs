//! Geometry helpers ported from `src/imdf/geometryCenter.ts` and
//! `src/imdf/normalizeVenue.ts::expandBounds`. They walk the canonical
//! geometry tree (point/multi/geometry-collection) and never panic on
//! malformed shapes: a non-position yields no contribution.

use crate::canonical::{Value, normalize_zero};
use crate::model::Bounds;

/// Running axis-aligned bounding box of every finite position seen so far.
pub(crate) struct BoundsAccum {
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
    pub found: bool,
}

impl BoundsAccum {
    pub fn new() -> Self {
        BoundsAccum {
            west: f64::INFINITY,
            south: f64::INFINITY,
            east: f64::NEG_INFINITY,
            north: f64::NEG_INFINITY,
            found: false,
        }
    }

    pub fn add_point(&mut self, lon: f64, lat: f64) {
        self.west = self.west.min(lon);
        self.south = self.south.min(lat);
        self.east = self.east.max(lon);
        self.north = self.north.max(lat);
        self.found = true;
    }

    pub fn finish(self) -> Option<Bounds> {
        if self.found {
            Some(Bounds {
                west: self.west,
                south: self.south,
                east: self.east,
                north: self.north,
            })
        } else {
            None
        }
    }
}

impl Default for BoundsAccum {
    fn default() -> Self {
        Self::new()
    }
}

/// Center of a GeoJSON geometry, matching `geometryCenter` in
/// `src/imdf/geometryCenter.ts`. A `Point` returns its own finite position; any
/// other geometry returns the center of its longitude/latitude bounding box;
/// `GeometryCollection` visits every sub-geometry. Empty or non-finite
/// geometries return `None`.
#[must_use]
pub fn geometry_center(geometry: &Value) -> Option<(f64, f64)> {
    let obj = geometry.as_object()?;
    let kind = obj.get("type").and_then(|v| v.as_str())?;
    if kind == "Point" {
        let coords = obj.get("coordinates")?.as_array()?;
        if coords.len() < 2 {
            return None;
        }
        let lon = coords[0].as_f64()?;
        let lat = coords[1].as_f64()?;
        if !lon.is_finite() || !lat.is_finite() {
            return None;
        }
        return Some((normalize_zero(lon), normalize_zero(lat)));
    }

    let mut bounds = BoundsAccum::new();
    visit_geometry(geometry, &mut bounds);
    if bounds.found {
        Some((
            (bounds.west + bounds.east) / 2.0,
            (bounds.south + bounds.north) / 2.0,
        ))
    } else {
        None
    }
}

/// Accumulate every finite position reachable from `geometry`.
pub(crate) fn visit_geometry(geometry: &Value, bounds: &mut BoundsAccum) {
    let obj = match geometry.as_object() {
        Some(o) => o,
        None => return,
    };
    let kind = obj.get("type").and_then(|v| v.as_str());
    if kind == Some("GeometryCollection") {
        if let Some(geoms) = obj.get("geometries").and_then(|v| v.as_array()) {
            for g in geoms {
                visit_geometry(g, bounds);
            }
        }
        return;
    }
    if let Some(coords) = obj.get("coordinates") {
        visit_positions(coords, bounds);
    }
}

fn visit_positions(value: &Value, bounds: &mut BoundsAccum) {
    let arr = match value {
        Value::Array(a) => a.as_slice(),
        _ => return,
    };
    if let Some(Value::Number(lon)) = arr.first() {
        if arr.len() >= 2
            && let Some(lat) = arr[1].as_f64()
        {
            if lon.is_finite() && lat.is_finite() {
                bounds.add_point(normalize_zero(*lon), normalize_zero(lat));
            }
            return;
        }
        return;
    }
    for nested in arr {
        visit_positions(nested, bounds);
    }
}

/// Returns `Some(geometry)` only when its center is computable. Matches
/// `usableGeometry` in `src/imdf/normalizeVenue.ts`.
#[must_use]
pub fn usable_geometry(geometry: &Value) -> Option<&Value> {
    if geometry_center(geometry).is_some() {
        Some(geometry)
    } else {
        None
    }
}

/// Center of a `display_point` value, validating it is a `Point` with finite
/// coordinates. Mirrors `displayPointGeometry(props["display_point"])` then
/// `geometryCenter` in `normalizeVenue.ts`.
#[must_use]
pub fn display_point_center(value: &Value) -> Option<(f64, f64)> {
    let obj = value.as_object()?;
    if obj.get("type").and_then(|v| v.as_str()) != Some("Point") {
        return None;
    }
    let coords = obj.get("coordinates")?.as_array()?;
    if coords.len() < 2 {
        return None;
    }
    let lon = coords[0].as_f64()?;
    let lat = coords[1].as_f64()?;
    if !lon.is_finite() || !lat.is_finite() {
        return None;
    }
    Some((normalize_zero(lon), normalize_zero(lat)))
}
