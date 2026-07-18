//! Compiles `tests/fixtures/minimal-imdf/` into the committed golden bundle
//! `tests/fixtures/minimal.kvb` and prints its lowercase SHA-256 hex digest.
//!
//! Run once per Task 3 Step 5:
//!
//! ```bash
//! cargo run --manifest-path core/Cargo.toml -p kiriko-bundle --example compile_fixture
//! ```
//!
//! then write `<printed hash>  tests/fixtures/minimal.kvb\n` to
//! `tests/fixtures/minimal.kvb.sha256` and commit both files. Any later
//! byte change to the golden bundle requires rerunning this example and
//! reviewing the diff.

use std::fs;
use std::io::{Cursor, Write};
use std::path::PathBuf;

use kiriko_bundle::{compile_imdf, BundleMetadata};
use sha2::{Digest, Sha256};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../tests/fixtures/minimal-imdf")
}

/// Bytewise-ascending root filename order, matching `kiriko-model`'s own
/// deterministic fixture builder. Order does not affect the compiled bytes
/// (`kiriko-model` sorts entries before import), but the golden bundle is
/// still generated deterministically for reviewability.
fn build_minimal_imdf_zip() -> Vec<u8> {
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

    let mut cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(&mut cursor);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(6));
    for name in &names {
        let data = fs::read(dir.join(name)).unwrap_or_else(|e| panic!("read {name}: {e}"));
        writer.start_file(name, options).expect("start zip entry");
        writer.write_all(&data).expect("write zip entry");
    }
    writer.finish().expect("finish zip");
    cursor.into_inner()
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn main() {
    let source = build_minimal_imdf_zip();
    let metadata = BundleMetadata {
        dataset_id: "minimal".to_string(),
        version: 1,
    };
    let compiled = compile_imdf(&source, metadata).expect("minimal fixture must compile");

    let out_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../tests/fixtures/minimal.kvb");
    fs::write(&out_path, &compiled.bytes).unwrap_or_else(|e| panic!("write {out_path:?}: {e}"));

    let mut digest = [0u8; 32];
    digest.copy_from_slice(&Sha256::digest(&compiled.bytes));
    println!("{}", hex_lower(&digest));
    eprintln!(
        "wrote {} bytes to {} (levels={}, features={})",
        compiled.bytes.len(),
        out_path.display(),
        compiled.stats.levels,
        compiled.stats.features
    );
}
