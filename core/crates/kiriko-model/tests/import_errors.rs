//! Archive-security tests for `import_imdf`.
//!
//! Each case asserts a malicious archive is rejected with the exact stable
//! `ImportErrorCode`. Cases mirror `src/imdf/imdfArchive.test.ts` so the Rust
//! importer and the retained TypeScript worker share one security contract.

mod support;

use kiriko_model::import_imdf;
use kiriko_model::ImportErrorCode;

const VENUE_ID: &str = "a1000001-0000-4000-8000-000000000001";

fn fixture_zip() -> Vec<u8> {
    support::build_minimal_imdf_zip()
}

fn reject(bytes: &[u8]) -> ImportErrorCode {
    match import_imdf(bytes) {
        Ok(_) => panic!("expected import to fail, but it succeeded"),
        Err(err) => err.code,
    }
}

#[test]
fn rejects_non_zip_bytes() {
    let bytes = b"this is not a zip archive";
    assert_eq!(reject(bytes), ImportErrorCode::UnsupportedFile);
}

#[test]
fn rejects_truncated_zip() {
    let mut bytes = fixture_zip();
    bytes.truncate(32);
    assert_eq!(reject(&bytes), ImportErrorCode::InvalidArchive);
}

#[test]
fn rejects_too_many_entries() {
    // 65 trivial entries (MAX_ARCHIVE_ENTRIES + 1).
    let entries: Vec<(String, Vec<u8>)> = (0..65)
        .map(|i| (format!("e{:03}.txt", i), b"x".to_vec()))
        .collect();
    let refs: Vec<(&str, &[u8])> = entries
        .iter()
        .map(|(n, d)| (n.as_str(), d.as_slice()))
        .collect();
    let bytes = support::write_zip(refs);
    assert_eq!(reject(&bytes), ImportErrorCode::ArchiveTooLarge);
}

#[test]
fn rejects_per_entry_overflow() {
    let base = fixture_zip();
    // Patch one small entry's declared uncompressed size past the per-entry
    // limit while keeping the actual content tiny.
    let patched = support::patch_uncompressed_size(base, "unit.geojson", 101 * 1024 * 1024);
    assert_eq!(reject(&patched), ImportErrorCode::ArchiveTooLarge);
}

#[test]
fn rejects_total_uncompressed_overflow() {
    // Four entries each declaring just under the per-entry limit so the sum
    // exceeds MAX_TOTAL_UNCOMPRESSED_BYTES while content stays tiny.
    let per_entry: u32 = (100 * 1024 * 1024) - 1;
    let entries: Vec<(&str, &[u8])> = vec![
        ("a.json", b"{}"),
        ("b.json", b"{}"),
        ("c.json", b"{}"),
        ("d.json", b"{}"),
    ];
    let mut bytes = support::write_zip(entries);
    for name in ["a.json", "b.json", "c.json", "d.json"] {
        bytes = support::patch_uncompressed_size(bytes, name, per_entry);
    }
    assert_eq!(reject(&bytes), ImportErrorCode::ArchiveTooLarge);
}

#[test]
fn rejects_unsafe_path_absolute() {
    let base = support::ZipBuilder::new()
        .extra("abs_.json", b"{}".to_vec())
        .build();
    let evil = support::patch_entry_name(base, "abs_.json", "/abs.json");
    assert_eq!(reject(&evil), ImportErrorCode::UnsafeArchivePath);
}

#[test]
fn rejects_unsafe_path_parent_traversal() {
    let base = support::ZipBuilder::new()
        .extra("evil_path.js", b"{}".to_vec())
        .build();
    let evil = support::patch_entry_name(base, "evil_path.js", "../evil.json");
    assert_eq!(reject(&evil), ImportErrorCode::UnsafeArchivePath);
}

#[test]
fn rejects_unsafe_path_backslash() {
    let base = support::ZipBuilder::new()
        .extra("a.b.json", b"{}".to_vec())
        .build();
    let evil = support::patch_entry_name(base, "a.b.json", "a\\b.json");
    assert_eq!(reject(&evil), ImportErrorCode::UnsafeArchivePath);
}

#[test]
fn rejects_unsafe_path_embedded_nul() {
    let base = support::ZipBuilder::new()
        .extra("a.b.json", b"{}".to_vec())
        .build();
    let evil = support::patch_entry_name(base, "a.b.json", "a\0b.json");
    assert_eq!(reject(&evil), ImportErrorCode::UnsafeArchivePath);
}

#[test]
fn rejects_directory_entry() {
    // Build a fresh tiny ZIP that includes a directory entry.
    use zip::write::SimpleFileOptions;
    use zip::{DateTime, ZipWriter};
    use std::io::{Cursor, Write};

    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default()
        .last_modified_time(DateTime::from_date_and_time(2026, 1, 1, 0, 0, 0).unwrap());
    writer
        .add_directory("subdir/", options)
        .expect("add directory");
    writer
        .start_file("manifest.json", options)
        .expect("start manifest");
    writer.write_all(b"{}").unwrap();
    let bytes = writer.finish().unwrap().into_inner();
    assert_eq!(reject(&bytes), ImportErrorCode::UnsafeArchivePath);
}

#[test]
fn rejects_duplicate_case_folded_filename() {
    let bytes = support::ZipBuilder::new()
        .extra(
            "Manifest.json",
            br#"{"version":"1.0.0","language":"ja"}"#.to_vec(),
        )
        .build();
    assert_eq!(reject(&bytes), ImportErrorCode::InvalidArchive);
}

#[test]
fn rejects_encrypted_entry() {
    let base = fixture_zip();
    let encrypted = support::patch_encrypted_flag(base, "manifest.json");
    assert_eq!(reject(&encrypted), ImportErrorCode::InvalidArchive);
}

#[test]
fn rejects_invalid_utf8_content() {
    let invalid_utf8 = vec![b'{', b'"', b'x', b'"', b':', 0xff, b'}'];
    let bytes = support::ZipBuilder::new()
        .replace("manifest.json", invalid_utf8)
        .build();
    assert_eq!(reject(&bytes), ImportErrorCode::InvalidJson);
}

#[test]
fn rejects_invalid_json() {
    let bytes = support::ZipBuilder::new()
        .replace("manifest.json", b"{not-json".to_vec())
        .build();
    assert_eq!(reject(&bytes), ImportErrorCode::InvalidJson);
}

#[test]
fn rejects_unsupported_manifest_version() {
    let bytes = support::ZipBuilder::new()
        .replace(
            "manifest.json",
            br#"{"version":"2.0.0","language":"ja-JP"}"#.to_vec(),
        )
        .build();
    assert_eq!(reject(&bytes), ImportErrorCode::InvalidManifestVersion);
}

#[test]
fn rejects_missing_manifest_language() {
    let bytes = support::ZipBuilder::new()
        .replace(
            "manifest.json",
            br#"{"version":"1.0.0"}"#.to_vec(),
        )
        .build();
    assert_eq!(reject(&bytes), ImportErrorCode::InvalidManifestVersion);
}

#[test]
fn rejects_malformed_manifest_version_lookalikes() {
    for version in ["1.0.00", "1.0.0evil", "1.0.0.", "1.0.0-", "1.0.0-", "1.0.0-rc-1"] {
        let body = format!(r#"{{"version":"{version}","language":"ja-JP"}}"#);
        let bytes = support::ZipBuilder::new()
            .replace("manifest.json", body.into_bytes())
            .build();
        assert_eq!(
            reject(&bytes),
            ImportErrorCode::InvalidManifestVersion,
            "version = {version:?}"
        );
    }
}

#[test]
fn accepts_pre_release_manifest_versions() {
    for version in ["1.0.0-rc.1", "1.0.0.rc.1", "1.0.0-1"] {
        let body = format!(r#"{{"version":"{version}","language":"ja-JP"}}"#);
        let bytes = support::ZipBuilder::new()
            .replace("manifest.json", body.into_bytes())
            .build();
        let venue = import_imdf(&bytes).expect("pre-release version should import");
        assert_eq!(venue.manifest.version, "1.0.0", "version = {version:?}");
    }
}

#[test]
fn rejects_missing_required_files() {
    let missing_manifest = support::ZipBuilder::new().omit("manifest.json").build();
    assert_eq!(reject(&missing_manifest), ImportErrorCode::MissingRequiredFile);

    let missing_venue = support::ZipBuilder::new().omit("venue.geojson").build();
    assert_eq!(reject(&missing_venue), ImportErrorCode::MissingRequiredFile);

    let missing_address = support::ZipBuilder::new().omit("address.geojson").build();
    assert_eq!(reject(&missing_address), ImportErrorCode::MissingRequiredFile);
}

#[test]
fn rejects_duplicate_feature_ids_across_files() {
    let duplicate_address = format!(
        r#"{{"type":"FeatureCollection","features":[{{"id":"{VENUE_ID}","type":"Feature","feature_type":"address","geometry":null,"properties":{{"address":"1 Marunouchi"}}}}]}}"#
    );
    let bytes = support::ZipBuilder::new()
        .replace("address.geojson", duplicate_address.into_bytes())
        .build();
    assert_eq!(reject(&bytes), ImportErrorCode::DuplicateFeatureId);
}

#[test]
fn rejects_feature_type_mismatch() {
    let mismatched = r#"{
        "type": "FeatureCollection",
        "features": [{
            "id": "e1000001-0000-4000-8000-0000000000a1",
            "type": "Feature",
            "feature_type": "unit",
            "geometry": {"type": "Point", "coordinates": [139.7674, 35.6811]},
            "properties": {"category": "toilet"}
        }]
    }"#;
    let bytes = support::ZipBuilder::new()
        .replace("amenity.geojson", mismatched.to_string().into_bytes())
        .build();
    assert_eq!(reject(&bytes), ImportErrorCode::InvalidFeatureCollection);
}

#[test]
fn rejects_feature_with_invalid_id() {
    let bad_id = r#"{
        "type": "FeatureCollection",
        "features": [{
            "id": "not-a-uuid",
            "type": "Feature",
            "feature_type": "address",
            "geometry": null,
            "properties": {"address": "1 Marunouchi"}
        }]
    }"#;
    let bytes = support::ZipBuilder::new()
        .replace("address.geojson", bad_id.to_string().into_bytes())
        .build();
    assert_eq!(reject(&bytes), ImportErrorCode::InvalidFeatureCollection);
}

#[test]
fn rejects_feature_collection_missing_features_array() {
    let bad_collection = r#"{"type":"FeatureCollection"}"#;
    let bytes = support::ZipBuilder::new()
        .replace("address.geojson", bad_collection.to_string().into_bytes())
        .build();
    assert_eq!(reject(&bytes), ImportErrorCode::InvalidFeatureCollection);
}

#[test]
fn rejects_archive_with_zero_venue_features() {
    let bytes = support::ZipBuilder::new()
        .replace(
            "venue.geojson",
            br#"{"type":"FeatureCollection","features":[]}"#.to_vec(),
        )
        .build();
    assert_eq!(reject(&bytes), ImportErrorCode::InvalidFeatureCollection);
}

#[test]
fn rejects_unknown_safe_entry_with_warning_not_error() {
    let bytes = support::ZipBuilder::new()
        .extra("extra.txt", b"not imdf".to_vec())
        .build();
    let venue = import_imdf(&bytes).expect("unknown safe entry should warn, not fail");
    let unknown = venue
        .warnings
        .iter()
        .find(|w| {
            w.code == kiriko_model::model::WarningCode::UnknownArchiveEntry
                && w.archive_entry.as_deref() == Some("extra.txt")
        })
        .expect("an unknown_archive_entry warning should be emitted");
    assert_eq!(
        unknown.message,
        "Ignored unknown archive entry extra.txt."
    );
}
