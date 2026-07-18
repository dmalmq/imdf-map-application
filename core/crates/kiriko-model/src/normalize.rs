//! Port of `src/imdf/normalizeVenue.ts` to the canonical model.
//!
//! Behavioral invariants preserved:
//!   - level resolution order: own `level_id` -> `unit_id` -> `anchor_id` ->
//!     anchor's `unit_id` -> amenity `unit_ids`;
//!   - center resolution order: `display_point` -> own geometry ->
//!     anchor geometry -> unit geometry -> amenity `unit_ids`;
//!   - `missing_locale` (English then Japanese) per labeled feature,
//!     `missing_level_geometry` per level, `missing_display_point` for the
//!     DISPLAY_POINT feature types;
//!   - levels sorted by descending ordinal (stable for ties);
//!   - per-level bounds computed from the render collection (anchors excluded,
//!     null-geometry occupants rendered at their resolved center).
//!
//! The TS `Map`/insertion-order iteration is replaced by the canonical
//! `FEATURE_TYPE_ORDER` vector + source-array order within each collection,
//! which is exactly what the TS path iterates once ZIP entries are sorted.

use std::collections::BTreeMap;

use crate::archive::ParsedArchive;
use crate::canonical::{Object, Value};
use crate::error::{ImportError, ImportErrorCode};
use crate::geometry::{
    BoundsAccum, display_point_center, geometry_center, usable_geometry, visit_geometry,
};
use crate::model::{
    FEATURE_TYPE_ORDER, FeatureType, ImdfManifest, VenueFeature, VenueModel, ViewerLevel,
    ViewerWarning, WarningCode,
};

/// Feature types whose missing `display_point` raises a warning. Matches
/// `DISPLAY_POINT_FEATURE_TYPES` in `normalizeVenue.ts`.
const DISPLAY_POINT_FEATURE_TYPES: &[FeatureType] = &[
    FeatureType::Unit,
    FeatureType::Opening,
    FeatureType::Amenity,
    FeatureType::Kiosk,
    FeatureType::Occupant,
];

pub(crate) fn normalize(archive: ParsedArchive) -> Result<VenueModel, ImportError> {
    // Unknown-archive-entry warnings are prepended, matching the TS worker's
    // pre-normalize warning ordering.
    let mut warnings: Vec<ViewerWarning> = Vec::new();
    for name in &archive.unknown_entries {
        warnings.push(ViewerWarning {
            code: WarningCode::UnknownArchiveEntry,
            message: format!("Ignored unknown archive entry {name}."),
            feature_id: None,
            archive_entry: Some(name.clone()),
        });
    }

    // First pass: build the canonical feature vector and index by id.
    let mut entries: Vec<Entry> = Vec::new();
    let mut id_to_index: BTreeMap<String, usize> = BTreeMap::new();
    for feature_type in FEATURE_TYPE_ORDER {
        let collection = match archive.collections.get(feature_type) {
            Some(c) => c,
            None => continue,
        };
        for raw in collection {
            let id = raw.id.clone();
            let props = &raw.properties;

            let geometry = raw.geometry.as_ref().and_then(usable_geometry).cloned();
            let labels = localized_record(props.get("name"));
            let alt_labels = localized_record(props.get("alt_name"));
            let category = string_prop(props, "category");
            let restriction = string_prop(props, "restriction");
            let own_level_id = string_prop(props, "level_id");
            let unit_id = string_prop(props, "unit_id");
            let anchor_id = string_prop(props, "anchor_id");
            let unit_ids = string_id_list(props.get("unit_ids"));
            let accessibility = normalize_accessibility(props.get("accessibility"));

            let feature = VenueFeature {
                id: id.clone(),
                feature_type: *feature_type,
                level_id: own_level_id.clone(),
                geometry,
                center: None,
                labels: labels.clone(),
                alt_labels: alt_labels.clone(),
                category: category.clone(),
                accessibility,
                restriction: restriction.clone(),
                source_properties: props.clone(),
            };

            id_to_index.insert(id.clone(), entries.len());
            entries.push(Entry {
                feature,
                own_level_id,
                unit_id,
                anchor_id,
                unit_ids,
            });
        }
    }

    // Second pass: resolve level_id and center, then emit per-feature warnings.
    // Indices (not references) avoid borrow checker fights while mutating.
    for index in 0..entries.len() {
        let id = entries[index].feature.id.clone();
        let level_id = resolve_level_id(&entries, &id_to_index, index, &id, &mut warnings);
        entries[index].feature.level_id = level_id;
        let center = resolve_center(&entries, &id_to_index, index);
        entries[index].feature.center = center;
        emit_feature_warnings(&entries[index], &mut warnings);
    }

    // Venue id is enforced to be exactly one feature by archive validation.
    let venue_id = entries
        .iter()
        .find(|e| e.feature.feature_type == FeatureType::Venue)
        .map(|e| e.feature.id.clone())
        .ok_or_else(|| {
            ImportError::new(
                ImportErrorCode::InvalidFeatureCollection,
                "normalizeVenue requires exactly one venue feature",
            )
        })?;

    // Levels sorted by descending ordinal; `sort_by` is stable so ties retain
    // canonical insertion order.
    let mut levels: Vec<ViewerLevel> = Vec::new();
    for entry in &entries {
        if entry.feature.feature_type != FeatureType::Level {
            continue;
        }
        let ordinal = extract_ordinal(&entry.feature.source_properties);
        levels.push(ViewerLevel {
            id: entry.feature.id.clone(),
            ordinal,
            label: entry.feature.labels.clone(),
            short_name: localized_record(entry.feature.source_properties.get("short_name")),
        });
    }
    levels.sort_by(|a, b| b.ordinal.total_cmp(&a.ordinal));

    // Per-level bounds computed from the render collection (anchors excluded,
    // null-geometry occupants contribute their resolved center point).
    let mut bounds_by_level: BTreeMap<String, crate::model::Bounds> = BTreeMap::new();
    for level in &levels {
        let mut accum = BoundsAccum::new();
        for entry in &entries {
            if entry.feature.feature_type == FeatureType::Anchor {
                continue;
            }
            let on_level = entry.feature.id == level.id
                || entry.feature.level_id.as_deref() == Some(level.id.as_str());
            if !on_level {
                continue;
            }
            if entry.feature.feature_type == FeatureType::Occupant
                && entry.feature.geometry.is_none()
            {
                if let Some((lon, lat)) = entry.feature.center {
                    accum.add_point(lon, lat);
                }
                continue;
            }
            if let Some(geom) = entry.feature.geometry.as_ref() {
                visit_geometry(geom, &mut accum);
            }
        }
        if let Some(b) = accum.finish() {
            bounds_by_level.insert(level.id.clone(), b);
        }
    }

    let features: Vec<VenueFeature> = entries.into_iter().map(|e| e.feature).collect();
    let manifest = build_manifest(archive.manifest, archive.manifest_language);

    Ok(VenueModel {
        manifest,
        venue_id,
        levels,
        features,
        bounds_by_level,
        warnings,
    })
}

struct Entry {
    feature: VenueFeature,
    own_level_id: Option<String>,
    unit_id: Option<String>,
    anchor_id: Option<String>,
    unit_ids: Vec<String>,
}

fn resolve_level_id(
    entries: &[Entry],
    id_to_index: &BTreeMap<String, usize>,
    index: usize,
    feature_id: &str,
    warnings: &mut Vec<ViewerWarning>,
) -> Option<String> {
    let current = &entries[index];
    let mut level_id = current.own_level_id.clone();
    if level_id.is_none()
        && let Some(unit_id) = current.unit_id.as_deref()
    {
        match id_to_index.get(unit_id) {
            None => push_unresolved(warnings, feature_id, "unit_id", unit_id),
            Some(&idx) => {
                level_id = string_prop(&entries[idx].feature.source_properties, "level_id");
            }
        }
    }
    if level_id.is_none()
        && let Some(anchor_id) = current.anchor_id.as_deref()
    {
        match id_to_index.get(anchor_id) {
            None => push_unresolved(warnings, feature_id, "anchor_id", anchor_id),
            Some(&anchor_idx) => {
                let anchor_unit_id =
                    string_prop(&entries[anchor_idx].feature.source_properties, "unit_id");
                match anchor_unit_id {
                    None => {
                        push_unresolved(warnings, feature_id, "anchor unit_id", anchor_id);
                    }
                    Some(auid) => match id_to_index.get(&auid) {
                        None => push_unresolved(warnings, feature_id, "unit_id", &auid),
                        Some(&unit_idx) => {
                            level_id = string_prop(
                                &entries[unit_idx].feature.source_properties,
                                "level_id",
                            );
                        }
                    },
                }
            }
        }
    }
    if level_id.is_none() && !current.unit_ids.is_empty() {
        for candidate in &current.unit_ids {
            match id_to_index.get(candidate) {
                None => push_unresolved(warnings, feature_id, "unit_ids", candidate),
                Some(&idx) => {
                    if let Some(resolved) =
                        string_prop(&entries[idx].feature.source_properties, "level_id")
                    {
                        level_id = Some(resolved);
                        break;
                    }
                }
            }
        }
    }
    level_id
}

fn resolve_center(
    entries: &[Entry],
    id_to_index: &BTreeMap<String, usize>,
    index: usize,
) -> Option<(f64, f64)> {
    let current = &entries[index];
    let props = &current.feature.source_properties;

    if let Some(value) = props.get("display_point")
        && let Some(center) = display_point_center(value)
    {
        return Some(center);
    }
    if let Some(geom) = current.feature.geometry.as_ref()
        && let Some(center) = geometry_center(geom)
    {
        return Some(center);
    }
    if let Some(anchor_id) = current.anchor_id.as_deref()
        && let Some(&idx) = id_to_index.get(anchor_id)
        && let Some(geom) = entries[idx].feature.geometry.as_ref()
        && let Some(center) = geometry_center(geom)
    {
        return Some(center);
    }
    if let Some(unit_id) = current.unit_id.as_deref()
        && let Some(&idx) = id_to_index.get(unit_id)
        && let Some(geom) = entries[idx].feature.geometry.as_ref()
        && let Some(center) = geometry_center(geom)
    {
        return Some(center);
    }
    for candidate in &current.unit_ids {
        if let Some(&idx) = id_to_index.get(candidate)
            && let Some(geom) = entries[idx].feature.geometry.as_ref()
            && let Some(center) = geometry_center(geom)
        {
            return Some(center);
        }
    }
    None
}

fn emit_feature_warnings(entry: &Entry, warnings: &mut Vec<ViewerWarning>) {
    let id = &entry.feature.id;

    if !entry.feature.labels.is_empty() {
        for language in ["en", "ja"] {
            if !has_language_label(&entry.feature.labels, language) {
                let label = if language == "en" {
                    "English"
                } else {
                    "Japanese"
                };
                warnings.push(ViewerWarning {
                    code: WarningCode::MissingLocale,
                    message: format!("Feature {id} has no {label} label."),
                    feature_id: Some(id.clone()),
                    archive_entry: None,
                });
            }
        }
    }

    if entry.feature.feature_type == FeatureType::Level && entry.feature.geometry.is_none() {
        warnings.push(ViewerWarning {
            code: WarningCode::MissingLevelGeometry,
            message: format!("Level {id} has no geometry."),
            feature_id: Some(id.clone()),
            archive_entry: None,
        });
    }

    if DISPLAY_POINT_FEATURE_TYPES.contains(&entry.feature.feature_type) {
        let has_display_point = entry
            .feature
            .source_properties
            .get("display_point")
            .and_then(display_point_center)
            .is_some();
        if !has_display_point {
            warnings.push(ViewerWarning {
                code: WarningCode::MissingDisplayPoint,
                message: format!("Feature {id} has no display_point."),
                feature_id: Some(id.clone()),
                archive_entry: None,
            });
        }
    }
}

fn push_unresolved(
    warnings: &mut Vec<ViewerWarning>,
    feature_id: &str,
    reference: &str,
    target: &str,
) {
    warnings.push(ViewerWarning {
        code: WarningCode::UnresolvedReference,
        message: format!("Feature {feature_id} references missing {reference} {target}."),
        feature_id: Some(feature_id.to_string()),
        archive_entry: None,
    });
}

fn build_manifest(mut object: Object, language: String) -> ImdfManifest {
    // Version was canonicalized to "1.0.0" by archive validation; rewrite the
    // canonical copy so the manifest round-trips deterministically.
    object.insert("version".to_string(), Value::String("1.0.0".to_string()));
    object.insert("language".to_string(), Value::String(language.clone()));
    ImdfManifest {
        version: "1.0.0".to_string(),
        language,
        rest: object,
    }
}

/// Extract the `ordinal` property as `f64`, matching the TS contract exactly:
/// `typeof ordinalRaw === "number" && Number.isFinite(ordinalRaw) ? ordinalRaw : 0`.
/// Every finite value — fractional, negative, or beyond `i32` range — is
/// preserved as-is; only a missing/non-numeric/non-finite property defaults
/// to `0.0`. `canonical::canonicalize` already rejects non-finite numbers
/// during archive parsing, so the `is_finite` check here is unreachable in
/// practice but kept as an explicit contract guard.
fn extract_ordinal(properties: &Object) -> f64 {
    match properties.get("ordinal").and_then(Value::as_f64) {
        Some(value) if value.is_finite() => value,
        _ => 0.0,
    }
}

fn has_language_label(labels: &BTreeMap<String, String>, language: &str) -> bool {
    let target = language.to_ascii_lowercase();
    for key in labels.keys() {
        let lower = key.to_ascii_lowercase();
        if lower == target || lower.starts_with(&format!("{target}-")) {
            return true;
        }
    }
    false
}

fn localized_record(value: Option<&Value>) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let obj = match value.and_then(Value::as_object) {
        Some(o) => o,
        None => return out,
    };
    for (key, val) in obj {
        if let Value::String(s) = val
            && !s.is_empty()
        {
            out.insert(key.clone(), s.clone());
        }
    }
    out
}

fn string_prop(props: &Object, key: &str) -> Option<String> {
    match props.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

fn string_id_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| match v {
                Value::String(s) if !s.is_empty() => Some(s.clone()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn normalize_accessibility(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::String(s)) if !s.is_empty() => vec![s.clone()],
        Some(Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| match v {
                Value::String(s) if !s.is_empty() => Some(s.clone()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}
