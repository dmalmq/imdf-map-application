//! Stable importer error codes and error type.
//!
//! [`ImportErrorCode::as_str`] returns the exact string values the TypeScript
//! local-ZIP viewer uses (see `src/errors/VenueLoadError.ts`), so browser and
//! server publish failures can be compared directly.

use std::fmt;

/// Stable error code for [`ImportError`]. String values mirror
/// `VenueLoadErrorCode` in `src/errors/VenueLoadError.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportErrorCode {
    UnsupportedFile,
    ArchiveTooLarge,
    UnsafeArchivePath,
    InvalidArchive,
    MissingRequiredFile,
    InvalidJson,
    InvalidManifestVersion,
    InvalidFeatureCollection,
    DuplicateFeatureId,
}

impl ImportErrorCode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::UnsupportedFile => "unsupported_file",
            Self::ArchiveTooLarge => "archive_too_large",
            Self::UnsafeArchivePath => "unsafe_archive_path",
            Self::InvalidArchive => "invalid_archive",
            Self::MissingRequiredFile => "missing_required_file",
            Self::InvalidJson => "invalid_json",
            Self::InvalidManifestVersion => "invalid_manifest_version",
            Self::InvalidFeatureCollection => "invalid_feature_collection",
            Self::DuplicateFeatureId => "duplicate_feature_id",
        }
    }
}

impl fmt::Display for ImportErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A structured importer failure carrying a stable code and a short diagnostic
/// message. `details` records the offending entry/reason for server logs; it is
/// never shown to end users verbatim.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportError {
    pub code: ImportErrorCode,
    pub message: String,
    pub details: Vec<(String, String)>,
}

impl ImportError {
    pub(crate) fn new(code: ImportErrorCode, message: impl Into<String>) -> Self {
        ImportError {
            code,
            message: message.into(),
            details: Vec::new(),
        }
    }

    pub(crate) fn with_detail(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.details.push((key.into(), value.into()));
        self
    }

    /// Corrective user-facing copy. Matches `venueLoadErrorCopy` in
    /// `src/errors/VenueLoadError.ts` for importer codes so local viewer and
    /// publish failures can present the same safe guidance.
    #[must_use]
    pub fn corrective_copy(&self) -> &'static str {
        match self.code {
            ImportErrorCode::UnsupportedFile => "Choose an Apple IMDF .zip archive.",
            ImportErrorCode::ArchiveTooLarge => {
                "This archive exceeds the prototype\u{2019}s 100 MiB compressed or 300 MiB uncompressed limit."
            }
            ImportErrorCode::UnsafeArchivePath => {
                "This archive contains an unsafe file path and was not opened."
            }
            ImportErrorCode::InvalidArchive => {
                "This ZIP is encrypted, damaged, or has conflicting archive records."
            }
            ImportErrorCode::MissingRequiredFile => "This archive is missing a required IMDF file.",
            ImportErrorCode::InvalidJson => "One of the IMDF files is not valid JSON.",
            ImportErrorCode::InvalidManifestVersion => {
                "This viewer supports IMDF manifest version 1.0.0."
            }
            ImportErrorCode::InvalidFeatureCollection => {
                "One of the IMDF GeoJSON files has an invalid feature collection."
            }
            ImportErrorCode::DuplicateFeatureId => {
                "The archive contains the same IMDF feature ID more than once."
            }
        }
    }
}

impl fmt::Display for ImportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ImportError {}
