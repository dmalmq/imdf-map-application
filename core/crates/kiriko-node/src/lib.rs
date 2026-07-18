//! Native Node.js bindings for Kiriko venue compilation.
//!
//! Phase Two Task 1: bridge scaffold. The async `compileImdf` task and
//! structured error mapping land in a later task. A trivial exported
//! function proves the napi-rs toolchain produces a loadable addon today.

#![deny(rust_2018_idioms)]

#[macro_use]
extern crate napi_derive;

/// Returns the Kiriko native adapter crate version. Exists only to keep
/// the binding non-empty while compilation behavior lands in a later task.
#[napi]
pub fn kiriko_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
