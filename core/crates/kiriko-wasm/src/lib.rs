//! Browser WASM bindings for Kiriko venue bundle decoding.
//!
//! Phase Two Task 1: bridge scaffold. The synchronous `decodeBundle`
//! adapter lands in a later task. A trivial exported function proves the
//! wasm-bindgen toolchain produces a loadable module today.

#![deny(rust_2018_idioms)]

use wasm_bindgen::prelude::*;

/// Returns the Kiriko WASM adapter crate version. Exists only to keep the
/// binding non-empty while decoding behavior lands in a later task.
#[wasm_bindgen]
pub fn kiriko_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
