export type ArchiveErrorCode =
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
  | "invalid_geodatabase"
  | "gdb_too_large"
  | "gdb_conversion_failed"
  | "snapshot_version_mismatch";

export class ArchiveError extends Error {
  constructor(
    readonly code: ArchiveErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ArchiveError";
  }
}

/** Fixed corrective copy shown to the user; never a raw stack trace. */
export const archiveErrorCopy: Record<ArchiveErrorCode, string> = {
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
  invalid_geodatabase:
    "The selected files do not contain a readable Esri File Geodatabase.",
  gdb_too_large:
    "The selected GDB data exceeds the 10,000-file, 100 MiB archive, 200 MiB per-file, or 500 MiB processing limit.",
  gdb_conversion_failed:
    "The selected GDB layers could not be converted. Review the layer choices and source coordinate systems.",
  snapshot_version_mismatch:
    "This dataset was published with an unsupported format version. Ask the publisher to republish it.",
};
