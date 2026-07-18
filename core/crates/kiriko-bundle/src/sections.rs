//! Postcard-serializable DTOs for each bundle section, plus conversions
//! to/from the `kiriko-model` canonical venue types.
//!
//! `Serialize`/`Deserialize` live only here so the shared `kiriko-model`
//! crate stays free of a bundle-format dependency. Every DTO here mirrors a
//! `kiriko-model` type field-for-field; enums use their own serde-derived
//! discriminant type (rather than a string) so a corrupted bundle fails
//! postcard decoding instead of ever reaching a panicking string match.
//!
//! The manifest section (id 1) carries bundle metadata, the source IMDF
//! manifest, venue id, levels, bounds, warnings, and stats. The geometry
//! section (id 2) carries every non-occupant feature; the stores section
//! (id 3) carries every occupant feature. [`split_features`] and
//! [`reassemble_features`] move features between the single canonical
//! ordering `kiriko-model` produces and the two-section split, so callers
//! never see the split or a duplicated feature.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use kiriko_model::canonical::{self, Value as CanonicalValue};
use kiriko_model::model::{Bounds, FeatureType, ImdfManifest, ViewerLevel, ViewerWarning, VenueFeature, WarningCode};

use crate::codec::{BundleDocument, BundleMetadata, BundleStats};

pub(crate) type JsonObjectDto = BTreeMap<String, JsonValueDto>;

/// Serializable mirror of `kiriko_model::canonical::Value`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) enum JsonValueDto {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<JsonValueDto>),
    Object(JsonObjectDto),
}

fn value_to_dto(value: &CanonicalValue) -> JsonValueDto {
    match value {
        CanonicalValue::Null => JsonValueDto::Null,
        CanonicalValue::Bool(b) => JsonValueDto::Bool(*b),
        CanonicalValue::Number(n) => JsonValueDto::Number(*n),
        CanonicalValue::String(s) => JsonValueDto::String(s.clone()),
        CanonicalValue::Array(items) => JsonValueDto::Array(items.iter().map(value_to_dto).collect()),
        CanonicalValue::Object(map) => JsonValueDto::Object(object_to_dto(map)),
    }
}

fn dto_to_value(dto: &JsonValueDto) -> CanonicalValue {
    match dto {
        JsonValueDto::Null => CanonicalValue::Null,
        JsonValueDto::Bool(b) => CanonicalValue::Bool(*b),
        JsonValueDto::Number(n) => CanonicalValue::Number(*n),
        JsonValueDto::String(s) => CanonicalValue::String(s.clone()),
        JsonValueDto::Array(items) => CanonicalValue::Array(items.iter().map(dto_to_value).collect()),
        JsonValueDto::Object(map) => CanonicalValue::Object(dto_to_object(map)),
    }
}

fn object_to_dto(object: &canonical::Object) -> JsonObjectDto {
    object.iter().map(|(k, v)| (k.clone(), value_to_dto(v))).collect()
}

fn dto_to_object(dto: &JsonObjectDto) -> canonical::Object {
    dto.iter().map(|(k, v)| (k.clone(), dto_to_value(v))).collect()
}

/// Serializable mirror of `kiriko_model::model::FeatureType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum FeatureTypeDto {
    Address,
    Amenity,
    Anchor,
    Building,
    Detail,
    Fixture,
    Footprint,
    Geofence,
    Kiosk,
    Level,
    Occupant,
    Opening,
    Relationship,
    Section,
    Unit,
    Venue,
}

impl From<FeatureType> for FeatureTypeDto {
    fn from(value: FeatureType) -> Self {
        match value {
            FeatureType::Address => Self::Address,
            FeatureType::Amenity => Self::Amenity,
            FeatureType::Anchor => Self::Anchor,
            FeatureType::Building => Self::Building,
            FeatureType::Detail => Self::Detail,
            FeatureType::Fixture => Self::Fixture,
            FeatureType::Footprint => Self::Footprint,
            FeatureType::Geofence => Self::Geofence,
            FeatureType::Kiosk => Self::Kiosk,
            FeatureType::Level => Self::Level,
            FeatureType::Occupant => Self::Occupant,
            FeatureType::Opening => Self::Opening,
            FeatureType::Relationship => Self::Relationship,
            FeatureType::Section => Self::Section,
            FeatureType::Unit => Self::Unit,
            FeatureType::Venue => Self::Venue,
        }
    }
}

impl From<FeatureTypeDto> for FeatureType {
    fn from(value: FeatureTypeDto) -> Self {
        match value {
            FeatureTypeDto::Address => Self::Address,
            FeatureTypeDto::Amenity => Self::Amenity,
            FeatureTypeDto::Anchor => Self::Anchor,
            FeatureTypeDto::Building => Self::Building,
            FeatureTypeDto::Detail => Self::Detail,
            FeatureTypeDto::Fixture => Self::Fixture,
            FeatureTypeDto::Footprint => Self::Footprint,
            FeatureTypeDto::Geofence => Self::Geofence,
            FeatureTypeDto::Kiosk => Self::Kiosk,
            FeatureTypeDto::Level => Self::Level,
            FeatureTypeDto::Occupant => Self::Occupant,
            FeatureTypeDto::Opening => Self::Opening,
            FeatureTypeDto::Relationship => Self::Relationship,
            FeatureTypeDto::Section => Self::Section,
            FeatureTypeDto::Unit => Self::Unit,
            FeatureTypeDto::Venue => Self::Venue,
        }
    }
}

/// Serializable mirror of `kiriko_model::model::WarningCode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum WarningCodeDto {
    MissingLocale,
    UnresolvedReference,
    MissingLevelGeometry,
    MissingDisplayPoint,
    UnknownArchiveEntry,
}

impl From<WarningCode> for WarningCodeDto {
    fn from(value: WarningCode) -> Self {
        match value {
            WarningCode::MissingLocale => Self::MissingLocale,
            WarningCode::UnresolvedReference => Self::UnresolvedReference,
            WarningCode::MissingLevelGeometry => Self::MissingLevelGeometry,
            WarningCode::MissingDisplayPoint => Self::MissingDisplayPoint,
            WarningCode::UnknownArchiveEntry => Self::UnknownArchiveEntry,
        }
    }
}

impl From<WarningCodeDto> for WarningCode {
    fn from(value: WarningCodeDto) -> Self {
        match value {
            WarningCodeDto::MissingLocale => Self::MissingLocale,
            WarningCodeDto::UnresolvedReference => Self::UnresolvedReference,
            WarningCodeDto::MissingLevelGeometry => Self::MissingLevelGeometry,
            WarningCodeDto::MissingDisplayPoint => Self::MissingDisplayPoint,
            WarningCodeDto::UnknownArchiveEntry => Self::UnknownArchiveEntry,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct FeatureDto {
    pub id: String,
    pub feature_type: FeatureTypeDto,
    pub level_id: Option<String>,
    pub geometry: Option<JsonValueDto>,
    pub center: Option<(f64, f64)>,
    pub labels: BTreeMap<String, String>,
    pub alt_labels: BTreeMap<String, String>,
    pub category: Option<String>,
    pub accessibility: Vec<String>,
    pub restriction: Option<String>,
    pub source_properties: JsonObjectDto,
}

fn feature_to_dto(feature: &VenueFeature) -> FeatureDto {
    FeatureDto {
        id: feature.id.clone(),
        feature_type: feature.feature_type.into(),
        level_id: feature.level_id.clone(),
        geometry: feature.geometry.as_ref().map(value_to_dto),
        center: feature.center,
        labels: feature.labels.clone(),
        alt_labels: feature.alt_labels.clone(),
        category: feature.category.clone(),
        accessibility: feature.accessibility.clone(),
        restriction: feature.restriction.clone(),
        source_properties: object_to_dto(&feature.source_properties),
    }
}

fn dto_to_feature(dto: &FeatureDto) -> VenueFeature {
    VenueFeature {
        id: dto.id.clone(),
        feature_type: dto.feature_type.into(),
        level_id: dto.level_id.clone(),
        geometry: dto.geometry.as_ref().map(dto_to_value),
        center: dto.center,
        labels: dto.labels.clone(),
        alt_labels: dto.alt_labels.clone(),
        category: dto.category.clone(),
        accessibility: dto.accessibility.clone(),
        restriction: dto.restriction.clone(),
        source_properties: dto_to_object(&dto.source_properties),
    }
}

/// Split canonically-ordered features into (geometry, stores): every
/// occupant goes to `stores`, everything else to `geometry`. Relative order
/// within each output is preserved.
pub(crate) fn split_features(features: &[VenueFeature]) -> (Vec<VenueFeature>, Vec<VenueFeature>) {
    let mut geometry = Vec::new();
    let mut stores = Vec::new();
    for feature in features {
        if feature.feature_type == FeatureType::Occupant {
            stores.push(feature.clone());
        } else {
            geometry.push(feature.clone());
        }
    }
    (geometry, stores)
}

/// Reassemble the geometry and stores sections back into the single
/// canonical feature-type order `kiriko-model` produces. Both inputs are
/// already individually ordered by `FeatureType::order()`, so a merge on
/// that order reproduces the exact original sequence.
pub(crate) fn reassemble_features(geometry: Vec<VenueFeature>, stores: Vec<VenueFeature>) -> Vec<VenueFeature> {
    let mut g = geometry.into_iter().peekable();
    let mut s = stores.into_iter().peekable();
    let mut out = Vec::new();
    loop {
        match (g.peek(), s.peek()) {
            (None, None) => break,
            (Some(_), None) => out.push(g.next().expect("peeked Some")),
            (None, Some(_)) => out.push(s.next().expect("peeked Some")),
            (Some(gf), Some(sf)) => {
                if gf.feature_type.order() <= sf.feature_type.order() {
                    out.push(g.next().expect("peeked Some"));
                } else {
                    out.push(s.next().expect("peeked Some"));
                }
            }
        }
    }
    out
}

pub(crate) fn feature_dtos(features: &[VenueFeature]) -> Vec<FeatureDto> {
    features.iter().map(feature_to_dto).collect()
}

pub(crate) fn features_from_dtos(dtos: &[FeatureDto]) -> Vec<VenueFeature> {
    dtos.iter().map(dto_to_feature).collect()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct BundleMetadataDto {
    dataset_id: String,
    version: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct ImdfManifestDto {
    version: String,
    language: String,
    rest: JsonObjectDto,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
struct BoundsDto {
    west: f64,
    south: f64,
    east: f64,
    north: f64,
}

impl From<Bounds> for BoundsDto {
    fn from(b: Bounds) -> Self {
        BoundsDto {
            west: b.west,
            south: b.south,
            east: b.east,
            north: b.north,
        }
    }
}

impl From<BoundsDto> for Bounds {
    fn from(b: BoundsDto) -> Self {
        Bounds {
            west: b.west,
            south: b.south,
            east: b.east,
            north: b.north,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct ViewerLevelDto {
    id: String,
    ordinal: f64,
    label: BTreeMap<String, String>,
    short_name: BTreeMap<String, String>,
}

fn level_to_dto(level: &ViewerLevel) -> ViewerLevelDto {
    ViewerLevelDto {
        id: level.id.clone(),
        ordinal: level.ordinal,
        label: level.label.clone(),
        short_name: level.short_name.clone(),
    }
}

fn level_from_dto(dto: ViewerLevelDto) -> ViewerLevel {
    ViewerLevel {
        id: dto.id,
        ordinal: dto.ordinal,
        label: dto.label,
        short_name: dto.short_name,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct ViewerWarningDto {
    code: WarningCodeDto,
    message: String,
    feature_id: Option<String>,
    archive_entry: Option<String>,
}

fn warning_to_dto(warning: &ViewerWarning) -> ViewerWarningDto {
    ViewerWarningDto {
        code: warning.code.into(),
        message: warning.message.clone(),
        feature_id: warning.feature_id.clone(),
        archive_entry: warning.archive_entry.clone(),
    }
}

fn warning_from_dto(dto: ViewerWarningDto) -> ViewerWarning {
    ViewerWarning {
        code: dto.code.into(),
        message: dto.message,
        feature_id: dto.feature_id,
        archive_entry: dto.archive_entry,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
struct BundleStatsDto {
    levels: u32,
    features: u32,
}

/// Section 1 (manifest): bundle metadata, source IMDF manifest, venue id,
/// levels, bounds, warnings, and stats. Everything a `BundleDocument` needs
/// except the reassembled feature vector.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct ManifestSection {
    bundle: BundleMetadataDto,
    source_manifest: ImdfManifestDto,
    venue_id: String,
    levels: Vec<ViewerLevelDto>,
    bounds_by_level: BTreeMap<String, BoundsDto>,
    warnings: Vec<ViewerWarningDto>,
    stats: BundleStatsDto,
}

pub(crate) fn manifest_to_dto(document: &BundleDocument) -> ManifestSection {
    ManifestSection {
        bundle: BundleMetadataDto {
            dataset_id: document.metadata.dataset_id.clone(),
            version: document.metadata.version,
        },
        source_manifest: ImdfManifestDto {
            version: document.manifest.version.clone(),
            language: document.manifest.language.clone(),
            rest: object_to_dto(&document.manifest.rest),
        },
        venue_id: document.venue_id.clone(),
        levels: document.levels.iter().map(level_to_dto).collect(),
        bounds_by_level: document
            .bounds_by_level
            .iter()
            .map(|(id, bounds)| (id.clone(), (*bounds).into()))
            .collect(),
        warnings: document.warnings.iter().map(warning_to_dto).collect(),
        stats: BundleStatsDto {
            levels: document.stats.levels,
            features: document.stats.features,
        },
    }
}

pub(crate) fn manifest_into_document(dto: ManifestSection, features: Vec<VenueFeature>) -> BundleDocument {
    BundleDocument {
        metadata: BundleMetadata {
            dataset_id: dto.bundle.dataset_id,
            version: dto.bundle.version,
        },
        manifest: ImdfManifest {
            version: dto.source_manifest.version,
            language: dto.source_manifest.language,
            rest: dto_to_object(&dto.source_manifest.rest),
        },
        venue_id: dto.venue_id,
        levels: dto.levels.into_iter().map(level_from_dto).collect(),
        bounds_by_level: dto
            .bounds_by_level
            .into_iter()
            .map(|(id, bounds)| (id, bounds.into()))
            .collect(),
        warnings: dto.warnings.into_iter().map(warning_from_dto).collect(),
        features,
        stats: BundleStats {
            levels: dto.stats.levels,
            features: dto.stats.features,
        },
    }
}
