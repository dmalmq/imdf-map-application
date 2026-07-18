//! `kvb1` bundle codec: envelope/directory byte-layout tests, determinism,
//! the corruption matrix, and the committed golden fixture.

mod support;

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use sha2::{Digest, Sha256};

use kiriko_bundle::{compile_imdf, decode_bundle, BundleErrorCode, BundleMetadata};

fn metadata() -> BundleMetadata {
    BundleMetadata {
        dataset_id: "test-bundle".to_string(),
        version: 1,
    }
}

fn compile_minimal() -> Vec<u8> {
    let source = support::build_minimal_imdf_zip();
    compile_imdf(&source, metadata())
        .expect("minimal fixture must compile")
        .bytes
}

fn decompress_payload(bytes: &[u8]) -> Vec<u8> {
    let declared_len = u64::from_le_bytes(bytes[12..20].try_into().unwrap());
    let frame = &bytes[52..];
    let payload = zstd::decode_all(frame).expect("a valid frame must decompress with the crate's own decoder");
    assert_eq!(payload.len() as u64, declared_len, "declared length must match the frame's content");
    payload
}

// -- Step 1: format byte-layout tests -------------------------------------

#[test]
fn envelope_matches_documented_byte_layout() {
    let bytes = compile_minimal();
    assert!(bytes.len() > 52, "an envelope plus a zstd frame must be produced");
    assert_eq!(&bytes[0..4], b"KVB\0", "magic");
    assert_eq!(u16::from_le_bytes([bytes[4], bytes[5]]), 1, "major");
    assert_eq!(u16::from_le_bytes([bytes[6], bytes[7]]), 0, "minor");
    let flags = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
    assert_eq!(flags & 1, 1, "bit 0 must indicate zstd");
    let uncompressed_len = u64::from_le_bytes(bytes[12..20].try_into().unwrap());
    assert!(uncompressed_len > 0);
    assert_eq!(bytes[20..52].len(), 32, "sha-256 occupies exactly 32 bytes");
}

#[test]
fn directory_is_sorted_fixed_width_and_required_sections_only() {
    let bytes = compile_minimal();
    let payload = decompress_payload(&bytes);

    let count = u16::from_le_bytes([payload[0], payload[1]]) as usize;
    assert_eq!(count, 3, "Phase Two emits exactly manifest, geometry, and stores");

    let mut ids = Vec::new();
    let mut cursor = 2 + count * 20;
    for i in 0..count {
        let base = 2 + i * 20;
        let id = u16::from_le_bytes([payload[base], payload[base + 1]]);
        let version = u16::from_le_bytes([payload[base + 2], payload[base + 3]]);
        let offset = u64::from_le_bytes(payload[base + 4..base + 12].try_into().unwrap());
        let length = u64::from_le_bytes(payload[base + 12..base + 20].try_into().unwrap());

        assert_eq!(version, 1, "section {id} must declare version 1");
        assert_eq!(offset, cursor as u64, "sections must be packed contiguously in id order");
        cursor += length as usize;
        ids.push(id);
    }
    assert_eq!(ids, vec![1, 2, 3], "only manifest(1), geometry(2), and stores(3) are emitted");
    assert_eq!(cursor, payload.len(), "sections must fill the payload with no trailing bytes");
}

// -- Step 2/3: section round trip and determinism --------------------------

#[test]
fn decode_roundtrip_preserves_every_feature_field_and_warning() {
    let source = support::build_minimal_imdf_zip();
    let venue = kiriko_model::import_imdf(&source).expect("fixture imports");
    let compiled = compile_imdf(&source, metadata()).expect("fixture compiles");
    let document = decode_bundle(&compiled.bytes).expect("bundle decodes");

    assert_eq!(document.venue_id, venue.venue_id);
    assert_eq!(document.manifest, venue.manifest);
    assert_eq!(document.levels, venue.levels);
    assert_eq!(document.features, venue.features, "every normalized feature field must round-trip");
    assert_eq!(document.bounds_by_level, venue.bounds_by_level);
    assert_eq!(document.warnings, venue.warnings, "every warning must round-trip");
    assert_eq!(document.stats.levels as usize, venue.levels.len());
    assert_eq!(document.stats.features as usize, venue.features.len());
    assert_eq!(document.metadata, metadata());
}

#[test]
fn compiling_the_same_fixture_twice_is_byte_identical() {
    let source = support::build_minimal_imdf_zip();
    let first = compile_imdf(&source, metadata()).expect("first compile");
    let second = compile_imdf(&source, metadata()).expect("second compile");
    assert_eq!(first.bytes, second.bytes);
}

#[test]
fn reversed_zip_record_order_is_byte_identical() {
    let forward = support::build_minimal_imdf_zip();
    let reversed = support::build_minimal_imdf_zip_reversed();
    assert_ne!(forward, reversed, "the two archives must actually differ in ZIP record order");

    let a = compile_imdf(&forward, metadata()).expect("forward order compiles");
    let b = compile_imdf(&reversed, metadata()).expect("reversed order compiles");
    assert_eq!(a.bytes, b.bytes, "record order must not affect the compiled bundle bytes");
}

// -- Step 4: corruption matrix ---------------------------------------------

#[test]
fn corrupted_magic_is_invalid_bundle() {
    let mut bytes = compile_minimal();
    bytes[0] ^= 0xFF;
    let err = decode_bundle(&bytes).expect_err("corrupted magic must fail");
    assert_eq!(err.code, BundleErrorCode::InvalidBundle);
}

#[test]
fn unsupported_major_is_rejected_before_section_interpretation() {
    let mut bytes = compile_minimal();
    bytes[4..6].copy_from_slice(&2u16.to_le_bytes());
    // Also corrupt the last frame byte: if major were (incorrectly) checked
    // after section interpretation, this would instead surface
    // bundle_integrity_failed, proving major-version precedence.
    let last = bytes.len() - 1;
    bytes[last] ^= 0xFF;
    let err = decode_bundle(&bytes).expect_err("unsupported major must fail");
    assert_eq!(err.code, BundleErrorCode::UnsupportedBundleVersion);
}

#[test]
fn zero_major_is_rejected() {
    let mut bytes = compile_minimal();
    bytes[4..6].copy_from_slice(&0u16.to_le_bytes());
    let err = decode_bundle(&bytes).expect_err("major 0 must fail");
    assert_eq!(err.code, BundleErrorCode::UnsupportedBundleVersion);
}

#[test]
fn newer_minor_version_is_tolerated() {
    let mut bytes = compile_minimal();
    bytes[6..8].copy_from_slice(&9999u16.to_le_bytes());
    let document = decode_bundle(&bytes).expect("a newer minor with understood required sections must still decode");
    assert!(!document.venue_id.is_empty());
}

#[test]
fn cleared_zstd_flag_is_invalid_bundle() {
    let mut bytes = compile_minimal();
    bytes[8] &= 0xFE;
    let err = decode_bundle(&bytes).expect_err("clearing the zstd flag must fail");
    assert_eq!(err.code, BundleErrorCode::InvalidBundle);
}

#[test]
fn declared_length_mismatch_is_integrity_failure() {
    let mut bytes = compile_minimal();
    let original = u64::from_le_bytes(bytes[12..20].try_into().unwrap());
    bytes[12..20].copy_from_slice(&(original + 1).to_le_bytes());
    let err = decode_bundle(&bytes).expect_err("a lying declared length must fail");
    assert_eq!(err.code, BundleErrorCode::BundleIntegrityFailed);
}

#[test]
fn declared_length_above_512_mib_is_bundle_too_large() {
    let mut bytes = compile_minimal();
    bytes[12..20].copy_from_slice(&(512u64 * 1024 * 1024 + 1).to_le_bytes());
    let err = decode_bundle(&bytes).expect_err("a declared length above 512 MiB must fail before allocation");
    assert_eq!(err.code, BundleErrorCode::BundleTooLarge);
}

#[test]
fn corrupted_hash_is_integrity_failure() {
    let mut bytes = compile_minimal();
    bytes[20] ^= 0xFF;
    let err = decode_bundle(&bytes).expect_err("a corrupted hash must fail");
    assert_eq!(err.code, BundleErrorCode::BundleIntegrityFailed);
}

#[test]
fn truncated_envelope_is_invalid_bundle() {
    let bytes = compile_minimal();
    let err = decode_bundle(&bytes[..10]).expect_err("a truncated envelope must fail");
    assert_eq!(err.code, BundleErrorCode::InvalidBundle);
}

#[test]
fn envelope_with_no_frame_data_is_integrity_failure() {
    let bytes = compile_minimal();
    let err = decode_bundle(&bytes[..52]).expect_err("an envelope with no frame bytes must fail");
    assert_eq!(err.code, BundleErrorCode::BundleIntegrityFailed);
}

#[test]
fn corrupted_frame_byte_is_integrity_failure() {
    let mut bytes = compile_minimal();
    let last = bytes.len() - 1;
    bytes[last] ^= 0xFF;
    let err = decode_bundle(&bytes).expect_err("a corrupted zstd frame byte must fail");
    assert_eq!(err.code, BundleErrorCode::BundleIntegrityFailed);
}

/// Hand-wraps a raw uncompressed payload into a valid `kvb1` envelope so a
/// malformed section directory can be exercised through the public
/// `decode_bundle` API (payload-level directory corruption is covered
/// exhaustively by `format`'s own unit tests; this proves the end-to-end
/// wiring surfaces the same stable code through the public API).
fn wrap_payload_for_test(payload: &[u8]) -> Vec<u8> {
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&Sha256::digest(payload));

    let mut raw = zstd::stream::raw::Encoder::new(9).expect("zstd encoder init");
    raw.set_parameter(zstd::stream::raw::CParameter::ChecksumFlag(true))
        .expect("checksum flag");
    raw.set_parameter(zstd::stream::raw::CParameter::ContentSizeFlag(true))
        .expect("content-size flag");
    raw.set_pledged_src_size(Some(payload.len() as u64)).expect("pledged size");
    let mut encoder = zstd::stream::write::Encoder::with_encoder(Vec::new(), raw);
    encoder.write_all(payload).expect("write payload");
    let compressed = encoder.finish().expect("finish frame");

    let mut out = Vec::new();
    out.extend_from_slice(b"KVB\0");
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&1u32.to_le_bytes());
    out.extend_from_slice(&(payload.len() as u64).to_le_bytes());
    out.extend_from_slice(&hash);
    out.extend_from_slice(&compressed);
    out
}

fn directory_row(id: u16, version: u16, offset: u64, length: u64) -> Vec<u8> {
    let mut row = Vec::with_capacity(20);
    row.extend_from_slice(&id.to_le_bytes());
    row.extend_from_slice(&version.to_le_bytes());
    row.extend_from_slice(&offset.to_le_bytes());
    row.extend_from_slice(&length.to_le_bytes());
    row
}

#[test]
fn decode_bundle_rejects_a_missing_required_section_via_the_public_api() {
    // Only manifest + geometry; stores (id 3) is missing entirely.
    let dir_len: u64 = 2 + 2 * 20;
    let mut payload = Vec::new();
    payload.extend_from_slice(&2u16.to_le_bytes());
    payload.extend_from_slice(&directory_row(1, 1, dir_len, 0));
    payload.extend_from_slice(&directory_row(2, 1, dir_len, 0));

    let bundle = wrap_payload_for_test(&payload);
    let err = decode_bundle(&bundle).expect_err("a missing required section must fail");
    assert_eq!(err.code, BundleErrorCode::InvalidBundle);
}

// -- Step 5: golden fixture -------------------------------------------------

#[test]
fn golden_fixture_matches_committed_bytes_and_checksum() {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let committed = fs::read(repo_root.join("tests/fixtures/minimal.kvb")).expect(
        "tests/fixtures/minimal.kvb must be committed (run `cargo run -p kiriko-bundle --example compile_fixture`)",
    );
    let checksum_file = fs::read_to_string(repo_root.join("tests/fixtures/minimal.kvb.sha256"))
        .expect("tests/fixtures/minimal.kvb.sha256 must be committed");

    let source = support::build_minimal_imdf_zip();
    let compiled = compile_imdf(
        &source,
        BundleMetadata {
            dataset_id: "minimal".to_string(),
            version: 1,
        },
    )
    .expect("minimal fixture must compile");

    assert_eq!(
        compiled.bytes, committed,
        "compiling tests/fixtures/minimal-imdf/ must reproduce the committed golden bytes exactly"
    );

    let mut digest = [0u8; 32];
    digest.copy_from_slice(&Sha256::digest(&compiled.bytes));
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    let expected_line = format!("{hex}  tests/fixtures/minimal.kvb\n");
    assert_eq!(checksum_file, expected_line, "the committed sha256 file must match the golden bytes");
}
