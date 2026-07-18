//! The `kvb1` binary envelope, section directory, and deterministic zstd
//! framing.
//!
//! ```text
//! 0..4   magic = 4b 56 42 00 ("KVB\0")
//! 4..6   major = little-endian u16 = 1
//! 6..8   minor = little-endian u16 = 0
//! 8..12  flags = little-endian u32; bit 0 means zstd
//! 12..20 uncompressed payload length = little-endian u64
//! 20..52 SHA-256 of the uncompressed payload
//! 52..   one zstd frame
//! ```
//!
//! The uncompressed payload begins with a fixed-width section directory: a
//! little-endian `u16` row count followed by that many 20-byte rows
//! `(id: u16, version: u16, offset: u64, length: u64)`, sorted by strictly
//! ascending `id`. Section bytes follow immediately after the directory,
//! packed back-to-back in directory order. Section IDs are `1 manifest`,
//! `2 geometry`, `3 stores`, `4 style`, `5 graph`, `6 beacons`; Phase Two
//! requires 1-3 and never emits 4-6.
//!
//! This module is an internal implementation detail of [`crate::codec`]; the
//! public codec surface is `compile_imdf`, `encode_bundle`, and
//! `decode_bundle`.

use std::io::{Read, Write};

use sha2::{Digest, Sha256};

use crate::error::{BundleError, BundleErrorCode};

pub(crate) const MAGIC: [u8; 4] = *b"KVB\0";
pub(crate) const MAJOR: u16 = 1;
pub(crate) const MINOR: u16 = 0;
pub(crate) const FLAG_ZSTD: u32 = 1 << 0;
pub(crate) const ENVELOPE_LEN: usize = 52;
pub(crate) const HASH_LEN: usize = 32;

/// Declared/encoded uncompressed payload length above which a bundle is
/// rejected before any decompression allocation is made.
pub(crate) const MAX_DECLARED_PAYLOAD_LEN: u64 = 512 * 1024 * 1024;

const ZSTD_LEVEL: i32 = 9;

pub(crate) const SECTION_MANIFEST: u16 = 1;
pub(crate) const SECTION_GEOMETRY: u16 = 2;
pub(crate) const SECTION_STORES: u16 = 3;
#[allow(dead_code)] // reserved id; documented, never emitted in Phase Two
pub(crate) const SECTION_STYLE: u16 = 4;
#[allow(dead_code)] // reserved id; documented, never emitted in Phase Two
pub(crate) const SECTION_GRAPH: u16 = 5;
#[allow(dead_code)] // reserved id; documented, never emitted in Phase Two
pub(crate) const SECTION_BEACONS: u16 = 6;

pub(crate) const REQUIRED_SECTIONS: [u16; 3] = [SECTION_MANIFEST, SECTION_GEOMETRY, SECTION_STORES];

/// The only section payload version this decoder understands. A required
/// section whose directory row declares a different version is rejected as
/// `unsupported_bundle_version`.
pub(crate) const SECTION_VERSION: u16 = 1;

const DIRECTORY_COUNT_LEN: usize = 2;
const DIRECTORY_ROW_LEN: usize = 20; // id:u16 + version:u16 + offset:u64 + length:u64

/// A single parsed section-directory row.
#[derive(Debug, Clone, Copy)]
struct SectionRow {
    id: u16,
    offset: u64,
    length: u64,
}

/// A validated section directory: non-overlapping, in-bounds, sorted by
/// strictly ascending id, with every required section present and
/// understood.
#[derive(Debug)]
pub(crate) struct Directory {
    rows: Vec<SectionRow>,
}

impl Directory {
    /// The bytes of section `id`, if present.
    pub(crate) fn section<'a>(&self, payload: &'a [u8], id: u16) -> Option<&'a [u8]> {
        self.rows
            .iter()
            .find(|row| row.id == id)
            .map(|row| &payload[row.offset as usize..(row.offset + row.length) as usize])
    }
}

fn invalid(message: impl Into<String>) -> BundleError {
    BundleError::new(BundleErrorCode::InvalidBundle, message)
}

/// Assemble the uncompressed payload: a fixed-width directory followed by
/// each section's bytes packed contiguously, in the given (id-ascending)
/// order.
pub(crate) fn build_payload(sections: &[(u16, u16, Vec<u8>)]) -> Vec<u8> {
    let count = sections.len();
    let dir_len = DIRECTORY_COUNT_LEN + count * DIRECTORY_ROW_LEN;
    let total_len: usize = dir_len + sections.iter().map(|(_, _, bytes)| bytes.len()).sum::<usize>();

    let mut payload = Vec::with_capacity(total_len);
    payload.extend_from_slice(&(count as u16).to_le_bytes());

    let mut cursor = dir_len as u64;
    for (id, version, bytes) in sections {
        payload.extend_from_slice(&id.to_le_bytes());
        payload.extend_from_slice(&version.to_le_bytes());
        payload.extend_from_slice(&cursor.to_le_bytes());
        payload.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
        cursor += bytes.len() as u64;
    }
    for (_, _, bytes) in sections {
        payload.extend_from_slice(bytes);
    }
    payload
}

/// Parse and validate the section directory at the start of `payload`.
///
/// Rejects a directory that is too short, has rows out of strictly-ascending
/// (and therefore non-duplicate) id order, has an out-of-bounds or
/// overflowing row, has overlapping sections, declares an unsupported
/// version for a required section, or is missing a required section.
pub(crate) fn parse_directory(payload: &[u8]) -> Result<Directory, BundleError> {
    if payload.len() < DIRECTORY_COUNT_LEN {
        return Err(invalid("payload is too short to contain a section directory"));
    }
    let count = u16::from_le_bytes([payload[0], payload[1]]) as usize;
    let dir_len = DIRECTORY_COUNT_LEN + count * DIRECTORY_ROW_LEN;
    if payload.len() < dir_len {
        return Err(invalid(
            "payload is too short to contain the declared section directory rows",
        ));
    }

    let mut rows: Vec<SectionRow> = Vec::with_capacity(count);
    for i in 0..count {
        let base = DIRECTORY_COUNT_LEN + i * DIRECTORY_ROW_LEN;
        let id = u16::from_le_bytes([payload[base], payload[base + 1]]);
        let version = u16::from_le_bytes([payload[base + 2], payload[base + 3]]);
        let offset = u64::from_le_bytes(payload[base + 4..base + 12].try_into().unwrap());
        let length = u64::from_le_bytes(payload[base + 12..base + 20].try_into().unwrap());

        if let Some(last) = rows.last() {
            if id <= last.id {
                return Err(invalid(
                    "section directory rows must be sorted by strictly ascending id",
                ));
            }
        }

        let end = offset
            .checked_add(length)
            .ok_or_else(|| invalid("section row offset/length overflows"))?;
        if offset < dir_len as u64 || end > payload.len() as u64 {
            return Err(invalid("section row is out of bounds"));
        }
        for other in &rows {
            let other_end = other.offset + other.length;
            if offset < other_end && other.offset < end {
                return Err(invalid("section rows overlap"));
            }
        }

        if REQUIRED_SECTIONS.contains(&id) && version != SECTION_VERSION {
            return Err(BundleError::new(
                BundleErrorCode::UnsupportedBundleVersion,
                format!("required section {id} has version {version}, which this decoder does not understand"),
            ));
        }

        rows.push(SectionRow { id, offset, length });
    }

    for required in REQUIRED_SECTIONS {
        if !rows.iter().any(|row| row.id == required) {
            return Err(invalid(format!("bundle is missing required section {required}")));
        }
    }

    Ok(Directory { rows })
}

/// Compress `payload` and wrap it in the `kvb1` envelope: magic, major=1,
/// minor=0, the zstd flag, the uncompressed length, its SHA-256, and one
/// deterministic zstd frame (level 9, checksum, pledged size, single
/// threaded).
pub(crate) fn encode_payload(payload: &[u8]) -> Result<Vec<u8>, BundleError> {
    if payload.len() as u64 > MAX_DECLARED_PAYLOAD_LEN {
        return Err(BundleError::new(
            BundleErrorCode::BundleTooLarge,
            "encoded section payload exceeds the 512 MiB bundle limit",
        ));
    }

    let mut hash = [0u8; HASH_LEN];
    hash.copy_from_slice(&Sha256::digest(payload));
    let compressed = zstd_compress(payload);

    let mut out = Vec::with_capacity(ENVELOPE_LEN + compressed.len());
    out.extend_from_slice(&MAGIC);
    out.extend_from_slice(&MAJOR.to_le_bytes());
    out.extend_from_slice(&MINOR.to_le_bytes());
    out.extend_from_slice(&FLAG_ZSTD.to_le_bytes());
    out.extend_from_slice(&(payload.len() as u64).to_le_bytes());
    out.extend_from_slice(&hash);
    out.extend_from_slice(&compressed);
    Ok(out)
}

/// Parse the envelope, verify it, and decompress+verify the payload.
/// Rejects an unknown major version before any section interpretation, and
/// rejects a declared payload above the 512 MiB limit before allocating a
/// decompression buffer.
pub(crate) fn decode_payload(bytes: &[u8]) -> Result<Vec<u8>, BundleError> {
    if bytes.len() < ENVELOPE_LEN {
        return Err(invalid("bundle is shorter than the 52-byte envelope"));
    }
    if bytes[0..4] != MAGIC {
        return Err(invalid("bundle magic does not match KVB\\0"));
    }

    let major = u16::from_le_bytes([bytes[4], bytes[5]]);
    if major != MAJOR {
        return Err(BundleError::new(
            BundleErrorCode::UnsupportedBundleVersion,
            format!("bundle major version {major} is not supported (expected {MAJOR})"),
        ));
    }

    let flags = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
    if flags & FLAG_ZSTD == 0 {
        return Err(invalid("bundle envelope is missing the zstd flag"));
    }

    let declared_len = u64::from_le_bytes(bytes[12..20].try_into().unwrap());
    let mut hash = [0u8; HASH_LEN];
    hash.copy_from_slice(&bytes[20..ENVELOPE_LEN]);

    if declared_len > MAX_DECLARED_PAYLOAD_LEN {
        return Err(BundleError::new(
            BundleErrorCode::BundleTooLarge,
            "declared uncompressed payload exceeds the 512 MiB bundle limit",
        ));
    }

    let frame = &bytes[ENVELOPE_LEN..];
    let payload = zstd_decompress(frame, declared_len)?;

    let mut actual_hash = [0u8; HASH_LEN];
    actual_hash.copy_from_slice(&Sha256::digest(&payload));
    if actual_hash != hash {
        return Err(BundleError::new(
            BundleErrorCode::BundleIntegrityFailed,
            "sha-256 of the decompressed payload does not match the envelope hash",
        ));
    }

    Ok(payload)
}

fn zstd_compress(payload: &[u8]) -> Vec<u8> {
    use zstd::stream::raw::{CParameter, Encoder as RawEncoder};

    let mut raw = RawEncoder::new(ZSTD_LEVEL).expect("zstd encoder init never fails for a valid compression level");
    raw.set_parameter(CParameter::ChecksumFlag(true))
        .expect("checksum flag is always a supported compression parameter");
    raw.set_parameter(CParameter::ContentSizeFlag(true))
        .expect("content-size flag is always a supported compression parameter");
    raw.set_parameter(CParameter::NbWorkers(0))
        .expect("single-threaded compression is always supported");
    raw.set_pledged_src_size(Some(payload.len() as u64))
        .expect("the pledged size matches the payload about to be written");

    let mut encoder = zstd::stream::write::Encoder::with_encoder(Vec::new(), raw);
    encoder
        .write_all(payload)
        .expect("writing to an in-memory Vec<u8> never fails");
    encoder.finish().expect("finishing an in-memory zstd stream never fails")
}

fn zstd_decompress(frame: &[u8], declared_len: u64) -> Result<Vec<u8>, BundleError> {
    let decoder = zstd::stream::read::Decoder::new(frame).map_err(|e| {
        BundleError::new(BundleErrorCode::BundleIntegrityFailed, format!("open zstd frame: {e}"))
    })?;
    // Bound the reader to one byte past the declared length so a frame that
    // decompresses to more than declared is detected without ever growing
    // `out` unbounded; the allocation itself is capped by the declared-length
    // check the caller performs before this function is reached.
    let mut limited = decoder.take(declared_len.saturating_add(1));
    let mut out = Vec::with_capacity(declared_len as usize);
    limited
        .read_to_end(&mut out)
        .map_err(|e| BundleError::new(BundleErrorCode::BundleIntegrityFailed, format!("decompress zstd frame: {e}")))?;
    if out.len() as u64 != declared_len {
        return Err(BundleError::new(
            BundleErrorCode::BundleIntegrityFailed,
            "decompressed payload length does not match the envelope's declared length",
        ));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row_bytes(id: u16, version: u16, offset: u64, length: u64) -> [u8; DIRECTORY_ROW_LEN] {
        let mut row = [0u8; DIRECTORY_ROW_LEN];
        row[0..2].copy_from_slice(&id.to_le_bytes());
        row[2..4].copy_from_slice(&version.to_le_bytes());
        row[4..12].copy_from_slice(&offset.to_le_bytes());
        row[12..20].copy_from_slice(&length.to_le_bytes());
        row
    }

    fn payload_with_rows(rows: &[[u8; DIRECTORY_ROW_LEN]], section_bytes: &[u8]) -> Vec<u8> {
        let mut payload = Vec::new();
        payload.extend_from_slice(&(rows.len() as u16).to_le_bytes());
        for row in rows {
            payload.extend_from_slice(row);
        }
        payload.extend_from_slice(section_bytes);
        payload
    }

    #[test]
    fn round_trips_a_well_formed_directory() {
        let sections: &[(u16, u16, Vec<u8>)] = &[
            (SECTION_MANIFEST, SECTION_VERSION, vec![1, 2, 3]),
            (SECTION_GEOMETRY, SECTION_VERSION, vec![4, 5]),
            (SECTION_STORES, SECTION_VERSION, vec![]),
        ];
        let payload = build_payload(sections);
        let directory = parse_directory(&payload).expect("well-formed directory must parse");
        assert_eq!(directory.section(&payload, SECTION_MANIFEST), Some(&[1u8, 2, 3][..]));
        assert_eq!(directory.section(&payload, SECTION_GEOMETRY), Some(&[4u8, 5][..]));
        assert_eq!(directory.section(&payload, SECTION_STORES), Some(&[][..]));
    }

    #[test]
    fn rejects_out_of_order_ids() {
        let dir_len = (DIRECTORY_COUNT_LEN + 2 * DIRECTORY_ROW_LEN) as u64;
        let rows = [
            row_bytes(SECTION_GEOMETRY, SECTION_VERSION, dir_len, 0),
            row_bytes(SECTION_MANIFEST, SECTION_VERSION, dir_len, 0),
        ];
        let payload = payload_with_rows(&rows, &[]);
        let err = parse_directory(&payload).expect_err("out-of-order ids must be rejected");
        assert_eq!(err.code, BundleErrorCode::InvalidBundle);
    }

    #[test]
    fn rejects_duplicate_ids() {
        let dir_len = (DIRECTORY_COUNT_LEN + 2 * DIRECTORY_ROW_LEN) as u64;
        let rows = [
            row_bytes(SECTION_MANIFEST, SECTION_VERSION, dir_len, 0),
            row_bytes(SECTION_MANIFEST, SECTION_VERSION, dir_len, 0),
        ];
        let payload = payload_with_rows(&rows, &[]);
        let err = parse_directory(&payload).expect_err("duplicate ids must be rejected");
        assert_eq!(err.code, BundleErrorCode::InvalidBundle);
    }

    #[test]
    fn rejects_missing_required_sections() {
        let dir_len = (DIRECTORY_COUNT_LEN + DIRECTORY_ROW_LEN) as u64;
        let rows = [row_bytes(SECTION_MANIFEST, SECTION_VERSION, dir_len, 0)];
        let payload = payload_with_rows(&rows, &[]);
        let err = parse_directory(&payload).expect_err("missing geometry/stores must be rejected");
        assert_eq!(err.code, BundleErrorCode::InvalidBundle);
    }

    #[test]
    fn rejects_overlapping_sections() {
        let dir_len = (DIRECTORY_COUNT_LEN + 3 * DIRECTORY_ROW_LEN) as u64;
        let rows = [
            row_bytes(SECTION_MANIFEST, SECTION_VERSION, dir_len, 4),
            row_bytes(SECTION_GEOMETRY, SECTION_VERSION, dir_len + 2, 4),
            row_bytes(SECTION_STORES, SECTION_VERSION, dir_len + 6, 0),
        ];
        let payload = payload_with_rows(&rows, &vec![0u8; 10]);
        let err = parse_directory(&payload).expect_err("overlapping sections must be rejected");
        assert_eq!(err.code, BundleErrorCode::InvalidBundle);
    }

    #[test]
    fn rejects_out_of_bounds_offsets() {
        let dir_len = (DIRECTORY_COUNT_LEN + 3 * DIRECTORY_ROW_LEN) as u64;
        let rows = [
            row_bytes(SECTION_MANIFEST, SECTION_VERSION, dir_len, 4),
            row_bytes(SECTION_GEOMETRY, SECTION_VERSION, dir_len + 4, 4),
            row_bytes(SECTION_STORES, SECTION_VERSION, dir_len + 8, 1_000),
        ];
        let payload = payload_with_rows(&rows, &vec![0u8; 8]);
        let err = parse_directory(&payload).expect_err("an out-of-bounds section must be rejected");
        assert_eq!(err.code, BundleErrorCode::InvalidBundle);
    }

    #[test]
    fn rejects_unsupported_required_section_version() {
        let dir_len = (DIRECTORY_COUNT_LEN + 3 * DIRECTORY_ROW_LEN) as u64;
        let rows = [
            row_bytes(SECTION_MANIFEST, 2, dir_len, 0),
            row_bytes(SECTION_GEOMETRY, SECTION_VERSION, dir_len, 0),
            row_bytes(SECTION_STORES, SECTION_VERSION, dir_len, 0),
        ];
        let payload = payload_with_rows(&rows, &[]);
        let err = parse_directory(&payload).expect_err("an unsupported section version must be rejected");
        assert_eq!(err.code, BundleErrorCode::UnsupportedBundleVersion);
    }

    #[test]
    fn encode_payload_then_decode_payload_round_trips() {
        let payload = build_payload(&[
            (SECTION_MANIFEST, SECTION_VERSION, vec![9, 9, 9]),
            (SECTION_GEOMETRY, SECTION_VERSION, vec![1]),
            (SECTION_STORES, SECTION_VERSION, vec![]),
        ]);
        let bundle = encode_payload(&payload).expect("payload encodes");
        let decoded = decode_payload(&bundle).expect("bundle decodes");
        assert_eq!(decoded, payload);
    }
}
