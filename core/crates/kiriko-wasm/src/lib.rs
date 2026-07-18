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

use kiriko_bundle::{decode_bundle, BundleDocument, BundleError};
use kiriko_model::canonical::{Object as CanonicalObject, Value as CanonicalValue};
use kiriko_model::model::{Bounds, ImdfManifest, VenueFeature, ViewerLevel, ViewerWarning};
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
/// `BoundsTuple`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DecodedVenueDto {
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
        CanonicalValue::Number(n) => serde_json::Number::from_f64(*n).map_or(JsonValue::Null, JsonValue::Number),
        CanonicalValue::String(s) => JsonValue::String(s.clone()),
        CanonicalValue::Array(items) => JsonValue::Array(items.iter().map(canonical_to_json).collect()),
        CanonicalValue::Object(obj) => JsonValue::Object(canonical_object_to_json(obj)),
    }
}

fn canonical_object_to_json(obj: &CanonicalObject) -> serde_json::Map<String, JsonValue> {
    obj.iter().map(|(k, v)| (k.clone(), canonical_to_json(v))).collect()
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
