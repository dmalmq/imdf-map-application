//! Public codec surface: compile IMDF source into a `kvb1` bundle, and
//! encode/decode a [`BundleDocument`] to/from bundle bytes.

use std::collections::BTreeMap;

use kiriko_model::import_imdf;
use kiriko_model::model::{Bounds, ImdfManifest, VenueFeature, ViewerLevel, ViewerWarning};

use crate::error::{BundleError, BundleErrorCode, CompileError};
use crate::format;
use crate::sections;

/// Caller-supplied identity for a compiled bundle. `dataset_id` is
/// `"<tenant>/<venue>"`; `version` is the immutable venue publish sequence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleMetadata {
    pub dataset_id: String,
    pub version: u32,
}

/// Bundle statistics, kept API-compatible with the Phase One gallery's
/// `stats_json` shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BundleStats {
    pub levels: u32,
    pub features: u32,
}

/// The fully decoded contents of a `kvb1` bundle: bundle metadata, the
/// source IMDF manifest, and the canonical venue model, with `features` in
/// the single canonical feature-type order (the geometry/stores section
/// split is invisible here).
#[derive(Debug, Clone, PartialEq)]
pub struct BundleDocument {
    pub metadata: BundleMetadata,
    pub manifest: ImdfManifest,
    pub venue_id: String,
    pub levels: Vec<ViewerLevel>,
    pub features: Vec<VenueFeature>,
    pub bounds_by_level: BTreeMap<String, Bounds>,
    pub warnings: Vec<ViewerWarning>,
    pub stats: BundleStats,
}

/// The result of compiling raw IMDF source bytes into a bundle.
#[derive(Debug, Clone, PartialEq)]
pub struct CompiledBundle {
    pub bytes: Vec<u8>,
    pub stats: BundleStats,
    pub warnings: Vec<ViewerWarning>,
}

/// Import `source` (a raw IMDF `.zip`) with `kiriko-model`, then encode the
/// canonical venue model as a `kvb1` bundle.
pub fn compile_imdf(source: &[u8], metadata: BundleMetadata) -> Result<CompiledBundle, CompileError> {
    let venue = import_imdf(source)?;
    let stats = BundleStats {
        levels: venue.levels.len() as u32,
        features: venue.features.len() as u32,
    };
    let document = BundleDocument {
        metadata,
        manifest: venue.manifest,
        venue_id: venue.venue_id,
        levels: venue.levels,
        features: venue.features,
        bounds_by_level: venue.bounds_by_level,
        warnings: venue.warnings,
        stats,
    };

    let bytes = encode_bundle(&document)?;
    Ok(CompiledBundle {
        bytes,
        stats: document.stats,
        warnings: document.warnings,
    })
}

fn postcard_err(context: &str) -> impl Fn(postcard::Error) -> BundleError + '_ {
    move |e| BundleError::new(BundleErrorCode::InvalidBundle, format!("{context}: {e}"))
}

/// Encode a [`BundleDocument`] as `kvb1` bundle bytes. `document.features`
/// is split into the geometry (non-occupant) and stores (occupant) sections;
/// no section is duplicated and no empty style/graph/beacon section is
/// emitted.
pub fn encode_bundle(document: &BundleDocument) -> Result<Vec<u8>, BundleError> {
    let manifest_dto = sections::manifest_to_dto(document);
    let (geometry, stores) = sections::split_features(&document.features);

    let manifest_bytes = postcard::to_allocvec(&manifest_dto).map_err(postcard_err("encode manifest section"))?;
    let geometry_bytes =
        postcard::to_allocvec(&sections::feature_dtos(&geometry)).map_err(postcard_err("encode geometry section"))?;
    let stores_bytes =
        postcard::to_allocvec(&sections::feature_dtos(&stores)).map_err(postcard_err("encode stores section"))?;

    let payload = format::build_payload(&[
        (format::SECTION_MANIFEST, format::SECTION_VERSION, manifest_bytes),
        (format::SECTION_GEOMETRY, format::SECTION_VERSION, geometry_bytes),
        (format::SECTION_STORES, format::SECTION_VERSION, stores_bytes),
    ]);

    format::encode_payload(&payload)
}

/// Decode `kvb1` bundle bytes into a [`BundleDocument`]. Verifies the
/// envelope, decompresses and integrity-checks the payload, validates the
/// section directory, and reassembles the geometry/stores split back into
/// the single canonical feature order.
pub fn decode_bundle(bytes: &[u8]) -> Result<BundleDocument, BundleError> {
    let payload = format::decode_payload(bytes)?;
    let directory = format::parse_directory(&payload)?;

    let manifest_bytes = directory
        .section(&payload, format::SECTION_MANIFEST)
        .expect("presence checked by parse_directory");
    let geometry_bytes = directory
        .section(&payload, format::SECTION_GEOMETRY)
        .expect("presence checked by parse_directory");
    let stores_bytes = directory
        .section(&payload, format::SECTION_STORES)
        .expect("presence checked by parse_directory");

    let manifest_dto = postcard::from_bytes(manifest_bytes).map_err(postcard_err("decode manifest section"))?;
    let geometry_dtos: Vec<sections::FeatureDto> =
        postcard::from_bytes(geometry_bytes).map_err(postcard_err("decode geometry section"))?;
    let stores_dtos: Vec<sections::FeatureDto> =
        postcard::from_bytes(stores_bytes).map_err(postcard_err("decode stores section"))?;

    let features = sections::reassemble_features(
        sections::features_from_dtos(&geometry_dtos),
        sections::features_from_dtos(&stores_dtos),
    );

    Ok(sections::manifest_into_document(manifest_dto, features))
}
