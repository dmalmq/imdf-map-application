//! Stable bundle-codec error codes and the compile-time error union.
//!
//! [`BundleErrorCode::as_str`] returns the exact stable strings documented in
//! the Phase Two bundle format contract: `invalid_bundle`,
//! `unsupported_bundle_version`, `bundle_integrity_failed`, and
//! `bundle_too_large`.

use std::fmt;

use kiriko_model::ImportError;

/// Stable error code for [`BundleError`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BundleErrorCode {
    /// Structurally malformed envelope, directory, or section payload
    /// (bad magic, missing zstd flag, unsorted/duplicate/overlapping/
    /// out-of-bounds directory rows, missing required section, or a
    /// postcard decode failure).
    InvalidBundle,
    /// The envelope's major version is not `1`, or a required section's
    /// version is not understood by this decoder.
    UnsupportedBundleVersion,
    /// The decompressed payload's length or SHA-256 does not match the
    /// envelope, or the zstd frame failed to decompress/verify.
    BundleIntegrityFailed,
    /// A declared or encoded uncompressed payload exceeds the 512 MiB
    /// bundle limit.
    BundleTooLarge,
}

impl BundleErrorCode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidBundle => "invalid_bundle",
            Self::UnsupportedBundleVersion => "unsupported_bundle_version",
            Self::BundleIntegrityFailed => "bundle_integrity_failed",
            Self::BundleTooLarge => "bundle_too_large",
        }
    }
}

impl fmt::Display for BundleErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A structured bundle codec failure carrying a stable code and a short
/// diagnostic message.
#[derive(Debug, Clone, PartialEq)]
pub struct BundleError {
    pub code: BundleErrorCode,
    pub message: String,
}

impl BundleError {
    pub(crate) fn new(code: BundleErrorCode, message: impl Into<String>) -> Self {
        BundleError {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for BundleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for BundleError {}

/// Failure compiling raw IMDF source bytes into a bundle: either the
/// `kiriko-model` importer rejected the archive, or the codec failed to
/// encode the resulting model.
#[derive(Debug, Clone, PartialEq)]
pub enum CompileError {
    Import(ImportError),
    Bundle(BundleError),
}

impl CompileError {
    /// The stable error code string, taken from whichever underlying error
    /// occurred.
    #[must_use]
    pub fn code_str(&self) -> &'static str {
        match self {
            Self::Import(e) => e.code.as_str(),
            Self::Bundle(e) => e.code.as_str(),
        }
    }
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Import(e) => fmt::Display::fmt(e, f),
            Self::Bundle(e) => fmt::Display::fmt(e, f),
        }
    }
}

impl std::error::Error for CompileError {}

impl From<ImportError> for CompileError {
    fn from(e: ImportError) -> Self {
        Self::Import(e)
    }
}

impl From<BundleError> for CompileError {
    fn from(e: BundleError) -> Self {
        Self::Bundle(e)
    }
}
