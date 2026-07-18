//! Strict ZIP parsing and structural validation, ported from
//! `src/imdf/imdf.worker.ts::loadArchive`.
//!
//! Enforces every contract that file's `loadArchive` enforces, using the
//! `zip` crate instead of zip.js. Boundaries: 100 MiB compressed, 64 entries,
//! 100 MiB per entry, 300 MiB cumulative uncompressed, root-only safe paths,
//! duplicate-name/ID rejection, manifest `1.0.0`, required IMDF collections.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read, Seek};

use zip::ZipArchive;
use zip::result::ZipError;

use crate::canonical::{self, Object, Value};
use crate::error::{ImportError, ImportErrorCode};
use crate::model::{FeatureType, feature_type_for_filename};

/// Maximum compressed size of the input ZIP (100 MiB).
pub const MAX_COMPRESSED_BYTES: usize = 100 * 1024 * 1024;
/// Maximum number of entries (files + directories) in the archive.
pub const MAX_ARCHIVE_ENTRIES: usize = 64;
/// Maximum declared or actual uncompressed size of a single entry (100 MiB).
pub const MAX_ENTRY_UNCOMPRESSED_BYTES: u64 = 100 * 1024 * 1024;
/// Maximum declared or actual cumulative uncompressed size (300 MiB).
pub const MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 300 * 1024 * 1024;

/// Files every IMDF archive must contain. Matches `REQUIRED_FILES` in
/// `src/imdf/imdf.worker.ts`.
pub const REQUIRED_FILES: &[&str] = &["manifest.json", "venue.geojson", "address.geojson"];

/// IMDF UUIDv4 feature id, case-insensitive. Matches `FEATURE_ID_RE` in
/// `src/imdf/imdf.worker.ts`.
pub(crate) fn is_valid_feature_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    if bytes[8] != b'-' || bytes[13] != b'-' || bytes[18] != b'-' || bytes[23] != b'-' {
        return false;
    }
    let groups: [&[u8]; 5] = [
        &bytes[0..8],
        &bytes[9..13],
        &bytes[14..18],
        &bytes[19..23],
        &bytes[24..36],
    ];
    if !groups
        .iter()
        .all(|g| g.iter().all(|&b| b.is_ascii_hexdigit()))
    {
        return false;
    }
    // version 4
    if !groups[2][0].eq_ignore_ascii_case(&b'4') {
        return false;
    }
    // variant: 8/9/a/b
    let variant = groups[3][0].to_ascii_lowercase();
    matches!(variant, b'8' | b'9' | b'a' | b'b')
}

/// Root-only safe path check. Matches `isUnsafePath` in
/// `src/imdf/imdf.worker.ts`.
pub(crate) fn is_unsafe_path(filename: &str) -> bool {
    if filename.is_empty() {
        return true;
    }
    if filename.contains('\0') || filename.contains('\\') {
        return true;
    }
    if filename.starts_with('/') || filename.starts_with("./") || filename.contains("..") {
        return true;
    }
    if filename.contains('/') {
        return true;
    }
    false
}

/// A raw feature extracted from a feature-collection file, before
/// normalization. `geometry` is `None` when missing or unusable.
#[derive(Debug, Clone)]
pub(crate) struct RawFeature {
    pub id: String,
    pub geometry: Option<Value>,
    pub properties: Object,
}

/// Parsed IMDF archive: validated manifest and per-collection feature vectors
/// in source order, plus the list of safe-but-unknown root entries (each
/// becomes an `unknown_archive_entry` warning).
#[derive(Debug)]
pub(crate) struct ParsedArchive {
    pub manifest: Object,
    pub collections: BTreeMap<FeatureType, Vec<RawFeature>>,
    pub unknown_entries: Vec<String>,
    pub manifest_language: String,
}

struct EntryMeta {
    name: String,
    encrypted: bool,
    is_dir: bool,
    uncompressed_size: u64,
    index: usize,
}

/// Parse and structurally validate the supplied ZIP bytes into a
/// [`ParsedArchive`].
pub(crate) fn parse(source: &[u8]) -> Result<ParsedArchive, ImportError> {
    if source.len() > MAX_COMPRESSED_BYTES {
        return Err(fail(ImportErrorCode::ArchiveTooLarge, "archive_too_large"));
    }
    if !is_zip_magic(source) {
        return Err(fail(ImportErrorCode::UnsupportedFile, "unsupported_file"));
    }

    let cursor = Cursor::new(source);
    let mut archive = ZipArchive::new(cursor).map_err(map_zip_open_error)?;

    // Bound entry count before the O(n^2) overlap scan below can run: a
    // crafted central directory with a huge entry count must be rejected on
    // cheap metadata (`archive.len()`) alone, not after pairwise range work.
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(fail(ImportErrorCode::ArchiveTooLarge, "archive_too_large")
            .with_detail("entryCount", archive.len().to_string()));
    }

    // Reject archives whose compressed entry data overlaps: not always
    // structurally invalid, but every real IMDF exporter produces
    // non-overlapping entries, and overlap is a classic archive-bomb /
    // confusion vector. Checked immediately after opening (and after the
    // entry-count cap above), before any other validation or content read.
    match archive.has_overlapping_files() {
        Ok(true) => {
            return Err(fail(ImportErrorCode::InvalidArchive, "invalid_archive")
                .with_detail("reason", "overlapping_entries"));
        }
        Ok(false) => {}
        Err(err) => return Err(map_zip_error(err)),
    }

    // Pass 1: collect metadata for every entry, then sort bytewise by name so
    // validation and import are independent of ZIP record order.
    let mut entries: Vec<EntryMeta> = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let file = archive.by_index_raw(index).map_err(map_zip_read_error)?;
        entries.push(EntryMeta {
            name: file.name().to_string(),
            encrypted: file.encrypted(),
            is_dir: file.is_dir(),
            uncompressed_size: file.size(),
            index,
        });
    }
    entries.sort_by(|a, b| a.name.as_bytes().cmp(b.name.as_bytes()));

    validate_entries(&entries)?;
    validate_required_files(&entries)?;

    // Pass 2: read content (bounded by both per-entry and cumulative actual
    // byte counts) and dispatch to manifest / collection / unknown buckets.
    let mut total_bytes: u64 = 0;
    let mut manifest_value: Option<Object> = None;
    let mut collections: BTreeMap<FeatureType, Vec<RawFeature>> = BTreeMap::new();
    let mut unknown_entries: Vec<String> = Vec::new();

    for entry in &entries {
        let lower = entry.name.to_lowercase();
        let bytes = read_entry(&mut archive, entry, &mut total_bytes)?;

        if lower == "manifest.json" {
            let json = parse_json(&bytes, &entry.name)?;
            let canonical = canonical::canonicalize(&json).map_err(|_| {
                fail(ImportErrorCode::InvalidJson, "invalid_json")
                    .with_detail("entry", entry.name.clone())
                    .with_detail("reason", "non_finite_number")
            })?;
            manifest_value = Some(validate_manifest(canonical, &entry.name)?);
            continue;
        }

        if let Some(feature_type) = feature_type_for_filename(&lower) {
            let json = parse_json(&bytes, &entry.name)?;
            let canonical = canonical::canonicalize(&json).map_err(|_| {
                fail(ImportErrorCode::InvalidJson, "invalid_json")
                    .with_detail("entry", entry.name.clone())
                    .with_detail("reason", "non_finite_number")
            })?;
            let features = assert_feature_collection(&canonical, feature_type, &entry.name)?;
            collections.insert(feature_type, features);
            continue;
        }

        // Safe unknown root entry: warn, never parse as IMDF.
        unknown_entries.push(entry.name.clone());
    }

    let manifest = manifest_value.ok_or_else(|| {
        fail(
            ImportErrorCode::MissingRequiredFile,
            "missing_required_file",
        )
        .with_detail("missing", "manifest.json")
    })?;

    validate_collection_shapes(&collections)?;
    let manifest_language = manifest
        .get("language")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_default();

    Ok(ParsedArchive {
        manifest,
        collections,
        unknown_entries,
        manifest_language,
    })
}

fn validate_entries(entries: &[EntryMeta]) -> Result<(), ImportError> {
    let mut seen = BTreeSet::new();
    let mut declared_total: u64 = 0;
    for entry in entries {
        if entry.is_dir {
            return Err(
                fail(ImportErrorCode::UnsafeArchivePath, "unsafe_archive_path")
                    .with_detail("entry", entry.name.clone())
                    .with_detail("reason", "directory"),
            );
        }
        if is_unsafe_path(&entry.name) {
            return Err(
                fail(ImportErrorCode::UnsafeArchivePath, "unsafe_archive_path")
                    .with_detail("entry", entry.name.clone()),
            );
        }
        if entry.encrypted {
            return Err(fail(ImportErrorCode::InvalidArchive, "invalid_archive")
                .with_detail("entry", entry.name.clone())
                .with_detail("reason", "encrypted"));
        }
        if entry.uncompressed_size > MAX_ENTRY_UNCOMPRESSED_BYTES {
            return Err(fail(ImportErrorCode::ArchiveTooLarge, "archive_too_large"));
        }
        declared_total = declared_total.saturating_add(entry.uncompressed_size);
        if declared_total > MAX_TOTAL_UNCOMPRESSED_BYTES {
            return Err(fail(ImportErrorCode::ArchiveTooLarge, "archive_too_large"));
        }
        if !seen.insert(entry.name.to_lowercase()) {
            return Err(fail(ImportErrorCode::InvalidArchive, "invalid_archive")
                .with_detail("entry", entry.name.clone())
                .with_detail("reason", "duplicate_name"));
        }
    }
    Ok(())
}

fn validate_required_files(entries: &[EntryMeta]) -> Result<(), ImportError> {
    let present: BTreeSet<String> = entries.iter().map(|e| e.name.to_lowercase()).collect();
    for required in REQUIRED_FILES {
        if !present.contains(*required) {
            return Err(fail(
                ImportErrorCode::MissingRequiredFile,
                "missing_required_file",
            )
            .with_detail("missing", (*required).to_string()));
        }
    }
    Ok(())
}

fn validate_collection_shapes(
    collections: &BTreeMap<FeatureType, Vec<RawFeature>>,
) -> Result<(), ImportError> {
    let venue = collections
        .get(&FeatureType::Venue)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    if venue.len() != 1 {
        return Err(fail(
            ImportErrorCode::InvalidFeatureCollection,
            "invalid_feature_collection",
        )
        .with_detail("reason", "venue_count")
        .with_detail("count", venue.len().to_string()));
    }
    let level = collections
        .get(&FeatureType::Level)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    if level.is_empty() {
        return Err(fail(
            ImportErrorCode::InvalidFeatureCollection,
            "invalid_feature_collection",
        )
        .with_detail("reason", "level_count")
        .with_detail("count", "0"));
    }

    // Duplicate feature IDs across the whole archive.
    let mut seen_ids: BTreeSet<String> = BTreeSet::new();
    for (feature_type, features) in collections {
        for feature in features {
            if !seen_ids.insert(feature.id.clone()) {
                return Err(
                    fail(ImportErrorCode::DuplicateFeatureId, "duplicate_feature_id")
                        .with_detail("featureId", feature.id.clone())
                        .with_detail("featureType", feature_type.as_str().to_string()),
                );
            }
        }
    }
    Ok(())
}

fn read_entry<R>(
    archive: &mut ZipArchive<R>,
    entry: &EntryMeta,
    total: &mut u64,
) -> Result<Vec<u8>, ImportError>
where
    R: Read + Seek,
{
    let mut file = archive.by_index(entry.index).map_err(map_zip_read_error)?;

    // Per-entry counter guards against decompression bombs even when the
    // declared size was patched small but the actual stream is huge.
    let mut entry_bytes: u64 = 0;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    loop {
        let read = file
            .read(&mut chunk)
            .map_err(|err| map_io_error(err, &entry.name))?;
        if read == 0 {
            break;
        }
        entry_bytes = entry_bytes.saturating_add(read as u64);
        if entry_bytes > MAX_ENTRY_UNCOMPRESSED_BYTES {
            return Err(fail(ImportErrorCode::ArchiveTooLarge, "archive_too_large"));
        }
        *total = total.saturating_add(read as u64);
        if *total > MAX_TOTAL_UNCOMPRESSED_BYTES {
            return Err(fail(ImportErrorCode::ArchiveTooLarge, "archive_too_large"));
        }
        buf.extend_from_slice(&chunk[..read]);
    }
    // Drop the file handle so the CRC32 footer (checked by the zip crate at end
    // of stream) is observed.
    drop(file);
    Ok(buf)
}

fn parse_json(bytes: &[u8], entry_name: &str) -> Result<serde_json::Value, ImportError> {
    let text = std::str::from_utf8(bytes).map_err(|_| {
        fail(ImportErrorCode::InvalidJson, "invalid_json")
            .with_detail("entry", entry_name.to_string())
            .with_detail("reason", "utf8_decode")
    })?;
    serde_json::from_str(text).map_err(|_| {
        fail(ImportErrorCode::InvalidJson, "invalid_json")
            .with_detail("entry", entry_name.to_string())
    })
}

fn validate_manifest(value: Value, entry_name: &str) -> Result<Object, ImportError> {
    let obj = match value {
        Value::Object(map) => map,
        _ => {
            return Err(fail(ImportErrorCode::InvalidJson, "invalid_json")
                .with_detail("entry", entry_name.to_string()));
        }
    };

    let version = obj.get("version").and_then(|v| v.as_str());
    let supported = version.map(is_supported_manifest_version).unwrap_or(false);
    if !supported {
        return Err(fail(
            ImportErrorCode::InvalidManifestVersion,
            "invalid_manifest_version",
        ));
    }

    let language = obj.get("language").and_then(|v| v.as_str()).unwrap_or("");
    if language.is_empty() {
        return Err(fail(
            ImportErrorCode::InvalidManifestVersion,
            "invalid_manifest_version",
        )
        .with_detail("reason", "language"));
    }

    // Normalize manifest: rewrite version to "1.0.0" (strip pre-release), keep
    // every other canonical key.
    let mut out = obj;
    out.insert("version".to_string(), Value::String("1.0.0".to_string()));
    Ok(out)
}

/// Matches `/^1\.0\.0([.-][0-9a-z]+(\.[0-9a-z]+)*)?$/i`. Real exporters stamp
/// dotted or hyphenated pre-release suffixes (e.g. "1.0.0.rc.1", "1.0.0-rc.1").
fn is_supported_manifest_version(version: &str) -> bool {
    let bytes = version.as_bytes();
    let prefix = b"1.0.0";
    if bytes.len() < prefix.len() || !bytes[..prefix.len()].eq_ignore_ascii_case(prefix) {
        return false;
    }
    let rest = &bytes[prefix.len()..];
    if rest.is_empty() {
        return true;
    }
    if rest[0] != b'.' && rest[0] != b'-' {
        return false;
    }
    let mut count = 0;
    for segment in rest[1..].split(|&b| b == b'.') {
        count += 1;
        if segment.is_empty() {
            return false;
        }
        if !segment
            .iter()
            .all(|&b| b.is_ascii_digit() || b.is_ascii_alphabetic())
        {
            return false;
        }
    }
    count >= 1
}

fn assert_feature_collection(
    value: &Value,
    feature_type: FeatureType,
    entry_name: &str,
) -> Result<Vec<RawFeature>, ImportError> {
    let obj = value
        .as_object()
        .ok_or_else(|| feature_collection_error(entry_name, None))?;
    if obj.get("type").and_then(|v| v.as_str()) != Some("FeatureCollection") {
        return Err(feature_collection_error(entry_name, None));
    }
    let features = obj
        .get("features")
        .and_then(|v| v.as_array())
        .ok_or_else(|| feature_collection_error(entry_name, None))?;

    let mut out = Vec::with_capacity(features.len());
    for feature in features {
        let f = feature
            .as_object()
            .ok_or_else(|| feature_collection_error(entry_name, None))?;
        if f.get("type").and_then(|v| v.as_str()) != Some("Feature") {
            return Err(feature_collection_error(entry_name, None));
        }

        let id = feature_id(feature)
            .ok_or_else(|| feature_collection_error(entry_name, Some("feature_id")))?;
        if !is_valid_feature_id(&id) {
            return Err(feature_collection_error_reason(entry_name, "feature_id"));
        }

        let declared_type = declared_feature_type(feature);
        if declared_type != Some(feature_type) {
            return Err(feature_collection_error_mismatch(
                entry_name,
                feature_type,
                declared_type,
            ));
        }

        let geometry = match f.get("geometry") {
            Some(Value::Null) | None => None,
            Some(Value::Object(_)) => Some(f.get("geometry").unwrap().clone()),
            _ => None,
        };

        let properties = match f.get("properties") {
            Some(Value::Object(map)) => map.clone(),
            _ => Object::new(),
        };

        out.push(RawFeature {
            id,
            geometry,
            properties,
        });
    }
    Ok(out)
}

fn feature_id(feature: &Value) -> Option<String> {
    let obj = feature.as_object()?;
    if let Some(Value::String(s)) = obj.get("id") {
        return Some(s.clone());
    }
    if let Some(Value::Object(props)) = obj.get("properties")
        && let Some(Value::String(s)) = props.get("id")
    {
        return Some(s.clone());
    }
    None
}

fn declared_feature_type(feature: &Value) -> Option<FeatureType> {
    let obj = feature.as_object()?;
    if let Some(Value::String(s)) = obj.get("feature_type") {
        return FeatureType::parse(s);
    }
    if let Some(Value::Object(props)) = obj.get("properties")
        && let Some(Value::String(s)) = props.get("feature_type")
    {
        return FeatureType::parse(s);
    }
    None
}

fn feature_collection_error(entry_name: &str, reason: Option<&str>) -> ImportError {
    let mut err = fail(
        ImportErrorCode::InvalidFeatureCollection,
        "invalid_feature_collection",
    )
    .with_detail("entry", entry_name.to_string());
    if let Some(r) = reason {
        err = err.with_detail("reason", r.to_string());
    }
    err
}

fn feature_collection_error_reason(entry_name: &str, reason: &str) -> ImportError {
    fail(
        ImportErrorCode::InvalidFeatureCollection,
        "invalid_feature_collection",
    )
    .with_detail("entry", entry_name.to_string())
    .with_detail("reason", reason.to_string())
}

fn feature_collection_error_mismatch(
    entry_name: &str,
    expected: FeatureType,
    actual: Option<FeatureType>,
) -> ImportError {
    fail(
        ImportErrorCode::InvalidFeatureCollection,
        "invalid_feature_collection",
    )
    .with_detail("entry", entry_name.to_string())
    .with_detail("reason", "feature_type_mismatch")
    .with_detail("expected", expected.as_str().to_string())
    .with_detail(
        "actual",
        actual.map(|t| t.as_str().to_string()).unwrap_or_default(),
    )
}

fn is_zip_magic(bytes: &[u8]) -> bool {
    if bytes.len() < 4 {
        return false;
    }
    // PK\x03\x04 (local file) or PK\x05\x06 (empty end-of-central-dir).
    (bytes[0] == 0x50 && bytes[1] == 0x4b)
        && ((bytes[2] == 0x03 && bytes[3] == 0x04) || (bytes[2] == 0x05 && bytes[3] == 0x06))
}

fn map_zip_open_error(err: ZipError) -> ImportError {
    map_zip_error(err)
}

fn map_zip_read_error(err: ZipError) -> ImportError {
    map_zip_error(err)
}

fn map_zip_error(err: ZipError) -> ImportError {
    let code = match &err {
        ZipError::Io(_)
        | ZipError::InvalidArchive(_)
        | ZipError::UnsupportedArchive(_)
        | ZipError::InvalidPassword
        | ZipError::CompressionMethodNotSupported(_) => ImportErrorCode::InvalidArchive,
        ZipError::FileNotFound => ImportErrorCode::MissingRequiredFile,
        _ => ImportErrorCode::InvalidArchive,
    };
    fail(code, "invalid_archive").with_detail("cause", err.to_string())
}

fn map_io_error(err: std::io::Error, entry_name: &str) -> ImportError {
    // CRC32 mismatches and corrupt streams surface as InvalidData io::Errors.
    fail(ImportErrorCode::InvalidArchive, "invalid_archive")
        .with_detail("entry", entry_name.to_string())
        .with_detail("cause", err.to_string())
}

fn fail(code: ImportErrorCode, message: &str) -> ImportError {
    ImportError::new(code, message)
}
