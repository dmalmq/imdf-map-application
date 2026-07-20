/// A point facility (store, restroom, ticket gate, …) with its position,
/// venue level ordinal, display metadata, and optional route-graph anchor.
#[derive(Debug, Clone, PartialEq)]
pub struct Facility {
    pub lon: f64,
    pub lat: f64,
    pub ordinal: f64,
    pub name: String,
    pub icon: String,
    pub anchor: Option<FacilityAnchor>,
}

/// Route-graph node a facility anchors to (its nearest access point).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FacilityAnchor {
    pub lon: f64,
    pub lat: f64,
    pub ordinal: f64,
}

/// Parsed facilities, sorted deterministically by `(ordinal, lon, lat, name)`.
#[derive(Debug, Clone, PartialEq)]
pub struct Facilities {
    pub items: Vec<Facility>,
}
