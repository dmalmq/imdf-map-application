/** Maximum compressed size of the input ZIP file (100 MiB). */
export const MAX_COMPRESSED_BYTES = 100 * 1024 * 1024;

/** Maximum number of entries (files + directories) in the archive. */
export const MAX_ARCHIVE_ENTRIES = 64;

/** Maximum actual or declared uncompressed size of a single entry (100 MiB). */
export const MAX_ENTRY_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

/** Maximum total actual or declared uncompressed size across all entries (300 MiB). */
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 300 * 1024 * 1024;
