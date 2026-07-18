//! Builds raw IMDF ZIP bytes from `tests/fixtures/minimal-imdf/` for the
//! kiriko-bundle integration tests, in either the default (bytewise
//! ascending) root-filename order or reversed order. `kiriko-model` sorts
//! entries before validation/import, so both orders must produce an
//! identical canonical model -- and therefore an identical bundle.

#![allow(dead_code)]

use std::fs;
use std::io::{Cursor, Write};
use std::path::PathBuf;

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

/// Path to the shared cross-language IMDF fixture directory.
pub fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../tests/fixtures/minimal-imdf")
}

fn root_entry_names() -> Vec<String> {
    let dir = fixtures_dir();
    let mut names: Vec<String> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("read fixtures dir {dir:?}: {e}"))
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            let name = path.file_name()?.to_string_lossy().into_owned();
            if name.starts_with('.') {
                None
            } else {
                Some(name)
            }
        })
        .collect();
    names.sort();
    names
}

fn write_zip_in_order(order: &[String]) -> Vec<u8> {
    let dir = fixtures_dir();
    let mut cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(&mut cursor);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(6));
    for name in order {
        let data = fs::read(dir.join(name)).unwrap_or_else(|e| panic!("read {name}: {e}"));
        writer.start_file(name, options).expect("start zip entry");
        writer.write_all(&data).expect("write zip entry");
    }
    writer.finish().expect("finish zip");
    cursor.into_inner()
}

/// The minimal fixture ZIP with root entries in bytewise-ascending filename
/// order (the same canonical order `kiriko-model`'s own tests use).
pub fn build_minimal_imdf_zip() -> Vec<u8> {
    write_zip_in_order(&root_entry_names())
}

/// The same fixture files written in reverse bytewise filename order.
pub fn build_minimal_imdf_zip_reversed() -> Vec<u8> {
    let mut order = root_entry_names();
    order.reverse();
    write_zip_in_order(&order)
}
