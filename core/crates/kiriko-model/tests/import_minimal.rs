//! Golden import test: `import_imdf` against `tests/fixtures/minimal-imdf/`.
//!
//! Phase Two Task 2 — RED stage: this test fails until `import_imdf` and the
//! canonical venue model exist.

mod support;

use kiriko_model::import_imdf;
use kiriko_model::model::{FeatureType, VenueFeature};

const VENUE_ID: &str = "a1000001-0000-4000-8000-000000000001";
const RESTRICTED_UNIT: &str = "c1000003-0000-4000-8000-0000000000b3";
const OCCUPANT_ID: &str = "a1000008-0000-4000-8000-0000000000c1";
const ANCHOR_ID: &str = "a1000007-0000-4000-8000-0000000000a1";
const LEVEL_1F: &str = "b1000002-0000-4000-8000-00000000001f";
const AMENITY_ID: &str = "e1000001-0000-4000-8000-0000000000a1";
const JA_ONLY_ROOM: &str = "c1000002-0000-4000-8000-0000000000b2";
const DANGLING_OCCUPANT_ID: &str = "a1000009-0000-4000-8000-0000000000c2";

#[test]
fn imports_minimal_fixture_into_canonical_model() {
    let bytes = support::build_minimal_imdf_zip();
    let venue = import_imdf(&bytes).expect("minimal fixture must import");

    assert_eq!(venue.manifest.version, "1.0.0");
    assert_eq!(venue.manifest.language, "ja-JP");
    assert_eq!(venue.venue_id, VENUE_ID);

    assert_eq!(
        venue
            .levels
            .iter()
            .map(|level| level.ordinal)
            .collect::<Vec<_>>(),
        vec![1.0, 0.0, -1.0],
        "levels are sorted by descending ordinal"
    );
    assert_eq!(venue.levels.len(), 3);

    assert_eq!(venue.features.len(), 27, "fixture defines 27 features");
    assert_eq!(venue.warnings.len(), 5, "fixture produces exactly five warnings");

    // The canonical feature ordering: amenity precedes occupant precedes unit.
    let amenity_idx = feature_index(&venue.features, AMENITY_ID);
    let occupant_idx = feature_index(&venue.features, OCCUPANT_ID);
    let first_unit_idx = venue
        .features
        .iter()
        .position(|f| f.feature_type == FeatureType::Unit)
        .expect("a unit feature exists");
    assert!(amenity_idx < occupant_idx, "amenity precedes occupant");
    assert!(
        occupant_idx < first_unit_idx,
        "occupant precedes the first unit"
    );

    // The restricted unit uses its display_point, not the bounds center.
    let restricted = find_feature(&venue.features, RESTRICTED_UNIT);
    assert_eq!(restricted.center, Some((139.76765, 35.68055)));
    assert_ne!(restricted.center, Some((139.7675, 35.6804)));

    // Null-geometry occupant resolves via anchor -> unit -> level.
    let occupant = find_feature(&venue.features, OCCUPANT_ID);
    assert_eq!(occupant.level_id.as_deref(), Some(LEVEL_1F));
    assert_eq!(occupant.center, Some((139.7666, 35.6816)));

    // The dangling occupant resolves nothing.
    let dangling = find_feature(&venue.features, DANGLING_OCCUPANT_ID);
    assert!(dangling.level_id.is_none());
    assert!(dangling.center.is_none());

    // amenity level derives from unit_ids.
    let amenity = find_feature(&venue.features, AMENITY_ID);
    assert_eq!(amenity.level_id.as_deref(), Some(LEVEL_1F));
}

#[test]
fn warnings_match_exact_codes_and_messages() {
    let bytes = support::build_minimal_imdf_zip();
    let venue = import_imdf(&bytes).expect("minimal fixture must import");

    use kiriko_model::model::WarningCode;
    let expected = [
        warn(WarningCode::MissingDisplayPoint, AMENITY_ID),
        warn(WarningCode::MissingDisplayPoint, OCCUPANT_ID),
        warn(WarningCode::UnresolvedReference, DANGLING_OCCUPANT_ID),
        warn(WarningCode::MissingDisplayPoint, DANGLING_OCCUPANT_ID),
        warn(WarningCode::MissingLocale, JA_ONLY_ROOM),
    ];

    let mut actual: Vec<(WarningCode, &str)> = venue
        .warnings
        .iter()
        .map(|w| (w.code, w.feature_id.as_deref().unwrap_or("")))
        .collect();
    let mut wanted: Vec<(WarningCode, &str)> = expected
        .iter()
        .map(|(c, f)| (*c, *f))
        .collect();
    actual.sort();
    wanted.sort();
    assert_eq!(actual, wanted, "warning codes and feature ids must match");

    // Exact current messages.
    let messages: Vec<&str> = venue.warnings.iter().map(|w| w.message.as_str()).collect();
    assert!(messages.contains(&format!("Feature {AMENITY_ID} has no display_point.").as_str()));
    assert!(messages.contains(&format!("Feature {OCCUPANT_ID} has no display_point.").as_str()));
    assert!(messages.contains(
        &format!(
            "Feature {DANGLING_OCCUPANT_ID} references missing anchor_id deadbeef-0000-4000-8000-00000000dead."
        )
        .as_str()
    ));
    assert!(messages.contains(&format!("Feature {JA_ONLY_ROOM} has no English label.").as_str()));
}

#[test]
fn source_properties_preserves_known_and_unknown_keys() {
    let bytes = support::build_minimal_imdf_zip();
    let venue = import_imdf(&bytes).expect("minimal fixture must import");

    let occupant = find_feature(&venue.features, OCCUPANT_ID);
    let props = &occupant.source_properties;

    // Known IMDF keys retained.
    assert_eq!(props.get("category").and_then(|v| v.as_str()), Some("shopping"));
    assert_eq!(props.get("anchor_id").and_then(|v| v.as_str()), Some(ANCHOR_ID));
    assert_eq!(props.get("hours").and_then(|v| v.as_str()), Some("Mo-Fr 10:00-20:00"));

    // Nulls preserved as Null, not stripped.
    assert!(props.get("phone").map(|v| v.is_null()).unwrap_or(false));
    assert!(props.get("website").map(|v| v.is_null()).unwrap_or(false));
    assert!(props.get("validity").map(|v| v.is_null()).unwrap_or(false));
    assert!(props.get("correlation_id").map(|v| v.is_null()).unwrap_or(false));

    // Unknown keys (e.g. feature_type foreign member) preserved.
    assert_eq!(
        find_feature(&venue.features, VENUE_ID)
            .source_properties
            .get("address_id")
            .and_then(|v| v.as_str()),
        Some("a1000002-0000-4000-8000-000000000002")
    );
}

#[test]
fn bounds_by_level_covers_each_level() {
    let bytes = support::build_minimal_imdf_zip();
    let venue = import_imdf(&bytes).expect("minimal fixture must import");

    for level in &venue.levels {
        let bounds = venue
            .bounds_by_level
            .get(&level.id)
            .unwrap_or_else(|| panic!("level {} must have bounds", level.id));
        // The fixture polygon spans 139.7660..=139.7680 and 35.6800..=35.6820.
        assert!(bounds.west <= 139.7660);
        assert!(bounds.east >= 139.7680);
        assert!(bounds.south <= 35.6800);
        assert!(bounds.north >= 35.6820);
    }
}

fn warn(code: kiriko_model::model::WarningCode, feature_id: &str) -> (kiriko_model::model::WarningCode, &str) {
    (code, feature_id)
}

fn feature_index(features: &[VenueFeature], id: &str) -> usize {
    features
        .iter()
        .position(|f| f.id == id)
        .unwrap_or_else(|| panic!("feature {id} must be present"))
}

fn find_feature<'a>(features: &'a [VenueFeature], id: &str) -> &'a VenueFeature {
    features
        .iter()
        .find(|f| f.id == id)
        .unwrap_or_else(|| panic!("feature {id} must be present"))
}

#[test]
fn preserves_full_finite_ordinal_domain_and_orders_by_it() {
    // Fractional, beyond-i32-range, and negative-beyond-i32-range ordinals
    // must all be preserved exactly (never coerced to 0) and used verbatim
    // for descending sort, matching the browser's
    // `Number.isFinite(ordinalRaw) ? ordinalRaw : 0` contract.
    const FRACTIONAL_ID: &str = "9a000001-0000-4000-8000-000000000f01";
    const HIGH_ID: &str = "9a000002-0000-4000-8000-000000000f02";
    const LOW_ID: &str = "9a000003-0000-4000-8000-000000000f03";

    let levels = format!(
        r#"{{"type":"FeatureCollection","features":[
            {{"id":"{FRACTIONAL_ID}","type":"Feature","feature_type":"level","geometry":null,"properties":{{"ordinal":2.5}}}},
            {{"id":"{HIGH_ID}","type":"Feature","feature_type":"level","geometry":null,"properties":{{"ordinal":3000000000}}}},
            {{"id":"{LOW_ID}","type":"Feature","feature_type":"level","geometry":null,"properties":{{"ordinal":-3000000000}}}}
        ]}}"#
    );
    let bytes = support::ZipBuilder::new()
        .replace("level.geojson", levels.into_bytes())
        .build();
    let venue = import_imdf(&bytes).expect("replaced levels must still import");

    assert_eq!(venue.levels.len(), 3);
    let by_id = |id: &str| {
        venue
            .levels
            .iter()
            .find(|l| l.id == id)
            .unwrap_or_else(|| panic!("level {id} must be present"))
    };
    assert_eq!(by_id(FRACTIONAL_ID).ordinal, 2.5, "fractional ordinal preserved exactly");
    assert_eq!(
        by_id(HIGH_ID).ordinal,
        3_000_000_000.0,
        "ordinal beyond i32::MAX preserved exactly, not coerced to 0"
    );
    assert_eq!(
        by_id(LOW_ID).ordinal,
        -3_000_000_000.0,
        "ordinal below i32::MIN preserved exactly, not coerced to 0"
    );

    // Descending sort uses the real values, not any truncated/coerced form.
    assert_eq!(
        venue.levels.iter().map(|l| l.id.as_str()).collect::<Vec<_>>(),
        vec![HIGH_ID, FRACTIONAL_ID, LOW_ID],
        "levels sorted descending by the full-precision ordinal"
    );
}
