//! Browser WASM bindings for Kiriko venue bundle decoding.
//!
//! `decodeBundle` is synchronous and callable any time after the module's
//! single asynchronous default-export/`init()` has resolved. Decoding never
//! throws for domain (bundle-format) failures: it always resolves to a
//! structured `DecodeResponseDto` JS object, discriminated by `ok`, built
//! with `serde-wasm-bindgen` (not stringified — the venue payload crosses
//! as a real JS object).
//!
//! Publication remains native (`kiriko-node`); this crate only decodes.
//!
//! Phase Two Task 4: WASM decode adapter.

#![deny(rust_2018_idioms)]

use std::collections::BTreeMap;

use kiriko_bundle::{BundleDocument, BundleError, decode_bundle};
use kiriko_model::canonical::{Object as CanonicalObject, Value as CanonicalValue};
use kiriko_model::model::{Bounds, ImdfManifest, VenueFeature, ViewerLevel, ViewerWarning};
use kiriko_route::{Point3, Route};
use serde::Serialize;
use serde_json::Value as JsonValue;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestDto {
    version: String,
    language: String,
    rest: JsonValue,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LevelDto {
    id: String,
    ordinal: f64,
    label: BTreeMap<String, String>,
    short_name: BTreeMap<String, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FeatureDto {
    id: String,
    feature_type: String,
    level_id: Option<String>,
    geometry: Option<JsonValue>,
    center: Option<(f64, f64)>,
    labels: BTreeMap<String, String>,
    alt_labels: BTreeMap<String, String>,
    category: Option<String>,
    accessibility: Vec<String>,
    restriction: Option<String>,
    source_properties: JsonValue,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WarningDto {
    code: String,
    message: String,
    feature_id: Option<String>,
    archive_entry: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatsDto {
    levels: u32,
    features: u32,
}

/// Decoded venue payload. `bounds_by_level` is `[levelId, bounds][]`, where
/// `bounds` is `[west, south, east, north]` (matches the browser's existing
/// `BoundsTuple`). `dataset_id`/`version` are the bundle's own publish
/// identity (`BundleMetadata`), not part of the IMDF content itself.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DecodedVenueDto {
    dataset_id: String,
    version: u32,
    venue_id: String,
    manifest: ManifestDto,
    levels: Vec<LevelDto>,
    features: Vec<FeatureDto>,
    bounds_by_level: Vec<(String, (f64, f64, f64, f64))>,
    warnings: Vec<WarningDto>,
    stats: StatsDto,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DecodeErrorDto {
    code: String,
    message: String,
}

/// Structured success/failure result of [`decode_bundle_js`].
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DecodeResponseDto {
    ok: bool,
    venue: Option<DecodedVenueDto>,
    error: Option<DecodeErrorDto>,
}

fn canonical_to_json(value: &CanonicalValue) -> JsonValue {
    match value {
        CanonicalValue::Null => JsonValue::Null,
        CanonicalValue::Bool(b) => JsonValue::Bool(*b),
        // Bundle decode already validates every reachable number is finite,
        // so `from_f64` never returns `None` here; `Null` is a defensive
        // fallback only.
        CanonicalValue::Number(n) => {
            serde_json::Number::from_f64(*n).map_or(JsonValue::Null, JsonValue::Number)
        }
        CanonicalValue::String(s) => JsonValue::String(s.clone()),
        CanonicalValue::Array(items) => {
            JsonValue::Array(items.iter().map(canonical_to_json).collect())
        }
        CanonicalValue::Object(obj) => JsonValue::Object(canonical_object_to_json(obj)),
    }
}

fn canonical_object_to_json(obj: &CanonicalObject) -> serde_json::Map<String, JsonValue> {
    obj.iter()
        .map(|(k, v)| (k.clone(), canonical_to_json(v)))
        .collect()
}

fn manifest_dto(manifest: &ImdfManifest) -> ManifestDto {
    ManifestDto {
        version: manifest.version.clone(),
        language: manifest.language.clone(),
        rest: JsonValue::Object(canonical_object_to_json(&manifest.rest)),
    }
}

fn level_dto(level: &ViewerLevel) -> LevelDto {
    LevelDto {
        id: level.id.clone(),
        ordinal: level.ordinal,
        label: level.label.clone(),
        short_name: level.short_name.clone(),
    }
}

fn feature_dto(feature: &VenueFeature) -> FeatureDto {
    FeatureDto {
        id: feature.id.clone(),
        feature_type: feature.feature_type.as_str().to_string(),
        level_id: feature.level_id.clone(),
        geometry: feature.geometry.as_ref().map(canonical_to_json),
        center: feature.center,
        labels: feature.labels.clone(),
        alt_labels: feature.alt_labels.clone(),
        category: feature.category.clone(),
        accessibility: feature.accessibility.clone(),
        restriction: feature.restriction.clone(),
        source_properties: JsonValue::Object(canonical_object_to_json(&feature.source_properties)),
    }
}

fn warning_dto(warning: &ViewerWarning) -> WarningDto {
    WarningDto {
        code: warning.code.as_str().to_string(),
        message: warning.message.clone(),
        feature_id: warning.feature_id.clone(),
        archive_entry: warning.archive_entry.clone(),
    }
}

fn bounds_tuple(bounds: &Bounds) -> (f64, f64, f64, f64) {
    (bounds.west, bounds.south, bounds.east, bounds.north)
}

fn document_dto(document: BundleDocument) -> DecodedVenueDto {
    DecodedVenueDto {
        dataset_id: document.metadata.dataset_id,
        version: document.metadata.version,
        venue_id: document.venue_id,
        manifest: manifest_dto(&document.manifest),
        levels: document.levels.iter().map(level_dto).collect(),
        features: document.features.iter().map(feature_dto).collect(),
        bounds_by_level: document
            .bounds_by_level
            .iter()
            .map(|(id, bounds)| (id.clone(), bounds_tuple(bounds)))
            .collect(),
        warnings: document.warnings.iter().map(warning_dto).collect(),
        stats: StatsDto {
            levels: document.stats.levels,
            features: document.stats.features,
        },
    }
}

fn error_dto(err: &BundleError) -> DecodeErrorDto {
    DecodeErrorDto {
        code: err.code.as_str().to_string(),
        message: err.message.clone(),
    }
}

/// Serialize `response` via `serde-wasm-bindgen`, using plain JS objects
/// (not ES `Map`s) and `null` (not `undefined`) for absent optional
/// fields, matching the browser's existing `Record<string, unknown>`
/// contracts (e.g. `sourceProperties`). Every field is a finite number,
/// string, bool, or nested combination thereof, so this cannot fail in
/// practice; the fallback keeps the same `DecodeResponseDto` shape rather
/// than panicking (a WASM panic traps the module instance).
fn to_js(response: &DecodeResponseDto) -> JsValue {
    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    response.serialize(&serializer).unwrap_or_else(|e| {
        let fallback = DecodeResponseDto {
            ok: false,
            venue: None,
            error: Some(DecodeErrorDto {
                code: "invalid_bundle".to_string(),
                message: format!("failed to serialize decoded venue: {e}"),
            }),
        };
        fallback
            .serialize(&serializer)
            .expect("fallback decode response must serialize")
    })
}

/// Decode `bytes` (a `kvb1` bundle) into a structured JS value shaped as
/// `{ ok, venue, error }`, where `venue`/`error` are `null` on the side
/// that does not apply. Domain failures (an unrecognized format, version,
/// or corrupted payload) never throw; only truly unexpected bridge
/// failures would (see [`to_js`]).
#[wasm_bindgen(js_name = "decodeBundle")]
pub fn decode_bundle_js(bytes: &[u8]) -> JsValue {
    let response = match decode_bundle(bytes) {
        Ok(document) => DecodeResponseDto {
            ok: true,
            venue: Some(document_dto(document)),
            error: None,
        },
        Err(err) => DecodeResponseDto {
            ok: false,
            venue: None,
            error: Some(error_dto(&err)),
        },
    };
    to_js(&response)
}

// -- Route query (kiriko-route-slice Task 4) --------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeDto {
    lon: f64,
    lat: f64,
    ordinal: f64,
}

/// Computed route payload: ordered `{lon, lat, ordinal}` nodes plus the
/// total edge weight, serialized as `{ nodes, totalWeight }`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RouteDto {
    nodes: Vec<NodeDto>,
    total_weight: f32,
}

impl From<Route> for RouteDto {
    fn from(route: Route) -> Self {
        RouteDto {
            nodes: route
                .nodes
                .iter()
                .map(|n| NodeDto {
                    lon: n.lon,
                    lat: n.lat,
                    ordinal: n.ordinal,
                })
                .collect(),
            total_weight: route.total_weight,
        }
    }
}

/// Non-wasm core of [`route_bundle`]: route over the document's embedded
/// graph section. `None` when the bundle has no graph (no network was
/// compiled in) or when the snapped endpoints are disconnected.
fn route_in_document(document: &BundleDocument, origin: Point3, dest: Point3) -> Option<RouteDto> {
    let graph = document.graph.as_ref()?;
    kiriko_route::route(graph, origin, dest).map(RouteDto::from)
}

/// Route over a `kvb1` bundle's embedded network graph. `o_*`/`d_*` are the
/// origin/destination as lon/lat plus level ordinal. Returns `null` when the
/// bundle carries no graph section or no path connects the snapped
/// endpoints; otherwise `{ nodes: [{lon, lat, ordinal}], totalWeight }`,
/// serialized with the same json-compatible `serde-wasm-bindgen` serializer
/// as [`to_js`]. Bundle-format failures throw (unlike [`decode_bundle_js`],
/// which reports them structurally).
#[wasm_bindgen]
pub fn route_bundle(
    bundle: &[u8],
    o_lon: f64,
    o_lat: f64,
    o_ord: f64,
    d_lon: f64,
    d_lat: f64,
    d_ord: f64,
) -> Result<JsValue, JsError> {
    let document = decode_bundle(bundle).map_err(|e| JsError::new(&e.message))?;
    let origin = Point3 {
        lon: o_lon,
        lat: o_lat,
        ordinal: o_ord,
    };
    let dest = Point3 {
        lon: d_lon,
        lat: d_lat,
        ordinal: d_ord,
    };
    let Some(route) = route_in_document(&document, origin, dest) else {
        return Ok(JsValue::NULL);
    };
    route
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| JsError::new(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::{Cursor, Write};
    use std::path::PathBuf;

    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    use kiriko_bundle::{BundleMetadata, compile_imdf, compile_imdf_with_network};

    use super::*;

    // Task 1 (kiriko-route) GeoJSON constants, mirrored from kiriko-bundle's
    // graph-embedding test: three junctions (two on F1/ordinal 0, one on
    // F2/ordinal 1) and three paths, one dangling to the missing NODEID 99.
    const NETWORK_JUNCTIONS: &str = r#"{"type":"FeatureCollection","features":[
      {"type":"Feature","properties":{"NODEID":1,"FLOOR":"F1"},"geometry":{"type":"Point","coordinates":[139.0,35.0]}},
      {"type":"Feature","properties":{"NODEID":2,"FLOOR":"F1"},"geometry":{"type":"Point","coordinates":[139.001,35.0]}},
      {"type":"Feature","properties":{"NODEID":3,"FLOOR":"F2"},"geometry":{"type":"Point","coordinates":[139.001,35.0]}}]}"#;
    const NETWORK_PATHS: &str = r#"{"type":"FeatureCollection","features":[
      {"type":"Feature","properties":{"FNODEID":1,"TNODEID":2,"cost":100},"geometry":{"type":"MultiLineString","coordinates":[[[139.0,35.0],[139.001,35.0]]]}},
      {"type":"Feature","properties":{"FNODEID":2,"TNODEID":3,"cost":5000},"geometry":{"type":"MultiLineString","coordinates":[[[139.001,35.0],[139.001,35.0]]]}},
      {"type":"Feature","properties":{"FNODEID":2,"TNODEID":99,"cost":10},"geometry":{"type":"MultiLineString","coordinates":[[[139.001,35.0],[139.002,35.0]]]}}]}"#;

    fn build_minimal_imdf_zip() -> Vec<u8> {
        let dir =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../tests/fixtures/minimal-imdf");
        let mut names: Vec<String> = fs::read_dir(&dir)
            .expect("read fixtures dir")
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                (!name.starts_with('.')).then_some(name)
            })
            .collect();
        names.sort();
        let mut cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .compression_level(Some(6));
        for name in names {
            let data = fs::read(dir.join(&name)).expect("read fixture");
            writer.start_file(name, options).expect("start zip entry");
            writer.write_all(&data).expect("write zip entry");
        }
        writer.finish().expect("finish zip");
        cursor.into_inner()
    }

    fn metadata() -> BundleMetadata {
        BundleMetadata {
            dataset_id: "test-bundle".to_string(),
            version: 1,
        }
    }

    fn compile_with_graph() -> Vec<u8> {
        let source = build_minimal_imdf_zip();
        compile_imdf_with_network(
            &source,
            metadata(),
            Some(NETWORK_JUNCTIONS),
            Some(NETWORK_PATHS),
        )
        .expect("fixture + network compiles")
        .bytes
    }

    #[test]
    fn route_between_two_node_points_returns_some() {
        let bundle = compile_with_graph();
        let document = decode_bundle(&bundle).expect("bundle decodes");
        let route = route_in_document(
            &document,
            Point3 {
                lon: 139.0,
                lat: 35.0,
                ordinal: 0.0,
            },
            Point3 {
                lon: 139.001,
                lat: 35.0,
                ordinal: 0.0,
            },
        )
        .expect("node 1 to node 2 must route");
        assert_eq!(route.nodes.len(), 2);
        assert_eq!(route.total_weight, 100.0);
    }

    #[test]
    fn bundle_without_graph_returns_none() {
        let source = build_minimal_imdf_zip();
        let compiled = compile_imdf(&source, metadata()).expect("fixture compiles");
        let document = decode_bundle(&compiled.bytes).expect("bundle decodes");
        assert!(
            route_in_document(
                &document,
                Point3 {
                    lon: 139.0,
                    lat: 35.0,
                    ordinal: 0.0,
                },
                Point3 {
                    lon: 139.001,
                    lat: 35.0,
                    ordinal: 0.0,
                },
            )
            .is_none(),
            "a bundle with no graph section must not route"
        );
    }
}
