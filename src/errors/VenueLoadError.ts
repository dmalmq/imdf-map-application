export type VenueLoadErrorCode =
  | "unsupported_file"
  | "archive_too_large"
  | "unsafe_archive_path"
  | "invalid_archive"
  | "missing_required_file"
  | "invalid_json"
  | "invalid_manifest_version"
  | "invalid_feature_collection"
  | "duplicate_feature_id"
  | "worker_failed"
  | "fetch_failed"
  | "invalid_bundle"
  | "unsupported_bundle_version"
  | "bundle_integrity_failed"
  | "bundle_too_large";

export class VenueLoadError extends Error {
  constructor(
    readonly code: VenueLoadErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "VenueLoadError";
  }
}

/** Fixed corrective copy shown to the user; never a raw stack trace. */
export const venueLoadErrorCopy: Record<VenueLoadErrorCode, string> = {
  unsupported_file: "Choose an Apple IMDF .zip archive.",
  archive_too_large:
    "This archive exceeds the prototype\u2019s 100 MiB compressed or 300 MiB uncompressed limit.",
  unsafe_archive_path: "This archive contains an unsafe file path and was not opened.",
  invalid_archive: "This ZIP is encrypted, damaged, or has conflicting archive records.",
  missing_required_file: "This archive is missing a required IMDF file.",
  invalid_json: "One of the IMDF files is not valid JSON.",
  invalid_manifest_version: "This viewer supports IMDF manifest version 1.0.0.",
  invalid_feature_collection: "One of the IMDF GeoJSON files has an invalid feature collection.",
  duplicate_feature_id: "The archive contains the same IMDF feature ID more than once.",
  worker_failed: "The venue could not be processed. Try the archive again.",
  fetch_failed:
    "The IMDF archive could not be downloaded. Check the link and the host\u2019s CORS settings.",
  invalid_bundle: "This venue bundle is corrupted and could not be read.",
  unsupported_bundle_version:
    "This venue bundle was published for a newer viewer. Refresh the page to update.",
  bundle_integrity_failed: "This venue bundle failed an integrity check and could not be trusted.",
  bundle_too_large: "This venue bundle exceeds the viewer\u2019s size limit.",
};
