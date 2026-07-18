//! Deterministic IMDF ZIP builders for the kiriko-model integration tests.
//!
//! Mirrors `tests/fixtures/buildMinimalImdfZip.ts`: enumerate the fixture
//! directory, sort root filenames bytewise, write each entry once with a fixed
//! ZIP timestamp and deflate level 6. Unsafe-path and declared-size variants
//! are produced by patching raw header bytes in place so the `zip` writer never
//! gets a chance to reject the malformed name.

#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Cursor, Write};
use std::path::PathBuf;

use zip::write::SimpleFileOptions;
use zip::{DateTime, ZipWriter, CompressionMethod};

/// Path to `tests/fixtures/minimal-imdf/` from this crate's manifest dir.
pub fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/fixtures/minimal-imdf")
}

/// A deterministic ZIP builder. Entries are written sorted bytewise by name
/// with deflate level 6 and a fixed last-modified timestamp.
pub struct ZipBuilder {
    omit: BTreeSet<String>,
    replace: BTreeMap<String, Vec<u8>>,
    extra: BTreeMap<String, Vec<u8>>,
}

impl ZipBuilder {
    pub fn new() -> Self {
        ZipBuilder {
            omit: BTreeSet::new(),
            replace: BTreeMap::new(),
            extra: BTreeMap::new(),
        }
    }

    /// Skip a base fixture entry by name.
    pub fn omit(mut self, name: &str) -> Self {
        self.omit.insert(name.to_string());
        self
    }

    /// Replace a base fixture entry's content (matched by exact name).
    pub fn replace(mut self, name: &str, content: Vec<u8>) -> Self {
        self.replace.insert(name.to_string(), content);
        self
    }

    /// Add an extra root entry. To inject an unsafe name (`../evil.json`) the
    /// writer would refuse, add a same-length safe placeholder and then call
    /// [`patch_entry_name`].
    pub fn extra(mut self, name: &str, content: Vec<u8>) -> Self {
        self.extra.insert(name.to_string(), content);
        self
    }

    /// Build the ZIP bytes.
    pub fn build(&self) -> Vec<u8> {
        let mut entries: BTreeMap<String, Vec<u8>> = BTreeMap::new();
        let dir = fixtures_dir();
        let mut base_names: Vec<String> = fs::read_dir(&dir)
            .unwrap_or_else(|e| panic!("read fixtures dir {:?}: {e}", dir))
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let p = e.path();
                let name = p.file_name()?.to_string_lossy().into_owned();
                if name.contains('/') || name.contains('\\') || name.starts_with('.') {
                    None
                } else {
                    Some(name)
                }
            })
            .collect();
        // Bytewise sort of the root filenames.
        base_names.sort();

        for name in &base_names {
            if self.omit.contains(name) {
                continue;
            }
            let data = if let Some(replacement) = self.replace.get(name) {
                replacement.clone()
            } else {
                fs::read(dir.join(name)).unwrap_or_else(|e| panic!("read {:?}: {e}", name))
            };
            entries.insert(name.clone(), data);
        }

        for (name, data) in &self.extra {
            entries.insert(name.clone(), data.clone());
        }

        write_zip(entries.iter().map(|(n, d)| (n.as_str(), d.as_slice())))
    }
}

impl Default for ZipBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Build the unmodified minimal fixture ZIP.
pub fn build_minimal_imdf_zip() -> Vec<u8> {
    ZipBuilder::new().build()
}

/// Build a fresh ZIP from the given entries (sorted bytewise, deflate 6,
/// fixed timestamp 2026-01-01T00:00:00Z).
pub fn write_zip<'a, I>(entries: I) -> Vec<u8>
where
    I: IntoIterator<Item = (&'a str, &'a [u8])>,
{
    let mut sorted: Vec<(&'a str, &'a [u8])> = entries.into_iter().collect();
    sorted.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));

    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(6))
        .last_modified_time(
            DateTime::from_date_and_time(2026, 1, 1, 0, 0, 0)
                .expect("2026-01-01T00:00:00 is a valid MSDOS date"),
        );

    for (name, data) in &sorted {
        writer
            .start_file(*name, options)
            .unwrap_or_else(|e| panic!("start_file {name}: {e}"));
        writer.write_all(data).unwrap_or_else(|e| panic!("write {name}: {e}"));
    }

    let cursor = writer.finish().expect("finish zip");
    cursor.into_inner()
}

/// Patch the local-file and central-directory uncompressed-size fields for the
/// named entry so the declared size exceeds archive limits while the actual
/// content stays tiny.
pub fn patch_uncompressed_size(mut zip: Vec<u8>, name: &str, new_size: u32) -> Vec<u8> {
    let name_bytes = name.as_bytes();
    let mut patched = 0usize;
    let mut i = 0usize;
    while i + 4 <= zip.len() {
        let sig = u32::from_le_bytes([zip[i], zip[i + 1], zip[i + 2], zip[i + 3]]);
        let (size_offset, name_offset) = match sig {
            0x0403_4b50 => (i + 22, i + 30), // local file header
            0x0201_4b50 => (i + 24, i + 46), // central directory header
            _ => {
                i += 1;
                continue;
            }
        };
        if name_offset + name_bytes.len() > zip.len() {
            i += 1;
            continue;
        }
        if &zip[name_offset..name_offset + name_bytes.len()] != name_bytes {
            i += 1;
            continue;
        }
        let bytes = new_size.to_le_bytes();
        zip[size_offset..size_offset + 4].copy_from_slice(&bytes);
        patched += 1;
        i = size_offset + 4;
    }
    assert!(
        patched >= 2,
        "patch_uncompressed_size: expected ≥2 headers for {name:?}, found {patched}"
    );
    zip
}

/// Rewrite a ZIP entry name in local + central headers in place. `from_name`
/// and `to_name` MUST be the same byte length.
pub fn patch_entry_name(mut zip: Vec<u8>, from_name: &str, to_name: &str) -> Vec<u8> {
    let from = from_name.as_bytes();
    let to = to_name.as_bytes();
    assert_eq!(
        from.len(),
        to.len(),
        "patch_entry_name requires equal-length names"
    );

    let mut found = 0usize;
    let mut i = 0usize;
    while i + 4 <= zip.len() {
        let sig = u32::from_le_bytes([zip[i], zip[i + 1], zip[i + 2], zip[i + 3]]);
        let name_offset = match sig {
            0x0403_4b50 => i + 30, // local file header
            0x0201_4b50 => i + 46, // central directory header
            _ => {
                i += 1;
                continue;
            }
        };
        if name_offset + from.len() > zip.len() {
            i += 1;
            continue;
        }
        if &zip[name_offset..name_offset + from.len()] != from {
            i += 1;
            continue;
        }
        zip[name_offset..name_offset + to.len()].copy_from_slice(to);
        found += 1;
        i = name_offset + to.len();
    }
    assert!(
        found >= 2,
        "patch_entry_name: expected ≥2 occurrences of {from_name:?}, found {found}"
    );
    zip
}

/// Set the encryption flag bit (general purpose bit 0) for every local + central
/// header whose name matches `name`. The content stays unencrypted, but the
/// importer rejects the archive on the encrypted flag alone.
pub fn patch_encrypted_flag(mut zip: Vec<u8>, name: &str) -> Vec<u8> {
    let name_bytes = name.as_bytes();
    let mut patched = 0usize;
    let mut i = 0usize;
    while i + 4 <= zip.len() {
        let sig = u32::from_le_bytes([zip[i], zip[i + 1], zip[i + 2], zip[i + 3]]);
        let (flags_offset, name_offset) = match sig {
            0x0403_4b50 => (i + 6, i + 30),
            0x0201_4b50 => (i + 8, i + 46),
            _ => {
                i += 1;
                continue;
            }
        };
        if name_offset + name_bytes.len() > zip.len() {
            i += 1;
            continue;
        }
        if &zip[name_offset..name_offset + name_bytes.len()] != name_bytes {
            i += 1;
            continue;
        }
        let mut flags = u16::from_le_bytes([zip[flags_offset], zip[flags_offset + 1]]);
        flags |= 0x0001;
        zip[flags_offset..flags_offset + 2].copy_from_slice(&flags.to_le_bytes());
        patched += 1;
        i = name_offset + name_bytes.len();
    }
    assert!(
        patched >= 2,
        "patch_encrypted_flag: expected ≥2 headers for {name:?}, found {patched}"
    );
    zip
}

/// Find the byte offset of the local-file header for `name`. Used together
/// with [`patch_central_directory_offset`] to construct archives with
/// overlapping compressed-data ranges.
pub fn find_local_header_offset(zip: &[u8], name: &str) -> u32 {
    let name_bytes = name.as_bytes();
    let mut i = 0usize;
    while i + 4 <= zip.len() {
        let sig = u32::from_le_bytes([zip[i], zip[i + 1], zip[i + 2], zip[i + 3]]);
        if sig == 0x0403_4b50 {
            let name_offset = i + 30;
            if name_offset + name_bytes.len() <= zip.len()
                && &zip[name_offset..name_offset + name_bytes.len()] == name_bytes
            {
                return i as u32;
            }
        }
        i += 1;
    }
    panic!("find_local_header_offset: local header for {name:?} not found");
}

/// Patch the central-directory "relative offset of local header" field for
/// `name` to `new_offset`. Pointing two entries' central-directory records at
/// the same local-header offset makes their compressed-data ranges coincide,
/// which `zip::ZipArchive::has_overlapping_files` must detect.
pub fn patch_central_directory_offset(mut zip: Vec<u8>, name: &str, new_offset: u32) -> Vec<u8> {
    let name_bytes = name.as_bytes();
    let mut patched = 0usize;
    let mut i = 0usize;
    while i + 4 <= zip.len() {
        let sig = u32::from_le_bytes([zip[i], zip[i + 1], zip[i + 2], zip[i + 3]]);
        if sig != 0x0201_4b50 {
            i += 1;
            continue;
        }
        let offset_field = i + 42;
        let name_offset = i + 46;
        if name_offset + name_bytes.len() > zip.len() {
            i += 1;
            continue;
        }
        if &zip[name_offset..name_offset + name_bytes.len()] != name_bytes {
            i += 1;
            continue;
        }
        zip[offset_field..offset_field + 4].copy_from_slice(&new_offset.to_le_bytes());
        patched += 1;
        i = name_offset + name_bytes.len();
    }
    assert!(
        patched >= 1,
        "patch_central_directory_offset: expected a central directory header for {name:?}, found {patched}"
    );
    zip
}
