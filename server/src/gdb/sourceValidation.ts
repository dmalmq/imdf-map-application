/**
 * Server-side GDB source limits and zip validation. The browser branch also
 * accepts a picked `.gdb` *directory*; the server only accepts a single
 * uploaded `.gdb.zip` archive, so the surface here is a strict subset.
 *
 * Limits are looser than the Apple-IMDF importer's (64 entries / 100 MiB per
 * entry / 300 MiB total) because real File Geodatabases ship hundreds of
 * internal files per database — exactly the case that trips the IMDF importer.
 */
import { ZipReader, BlobReader } from "@zip.js/zip.js";

const MIB = 1024 * 1024;

/** Maximum raw uploaded bytes accepted by the inspect endpoint. */
export const GDB_MAX_UPLOAD_BYTES = 200 * MIB;
/** Maximum number of central-directory entries in the uploaded zip. */
export const GDB_MAX_ARCHIVE_ENTRIES = 50_000;
/** Maximum cumulative uncompressed bytes across all zip entries. */
export const GDB_MAX_TOTAL_UNCOMPRESSED_BYTES = 1_000 * MIB;
/** Cap on the total WGS84 GeoJSON bytes generated across all selected layers. */
export const GDB_MAX_GENERATED_BYTES = 1_000 * MIB;

export class GdbSourceError extends Error {
  constructor(
    readonly code:
      | "invalid_geodatabase"
      | "gdb_too_large"
      | "missing_network_layers"
      | "missing_facility_layer",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "GdbSourceError";
  }
}

function normalizePath(path: string): string {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");
}

function pathSegments(path: string): string[] {
  return normalizePath(path)
    .split("/")
    .filter((segment) => segment.length > 0);
}

/** Reject traversal, absolute, drive-qualified, null-byte, and empty paths. */
function isUnsafePath(path: string): boolean {
  const normalized = normalizePath(path);
  if (normalized.length === 0 || normalized.includes("\0") || normalized.startsWith("/")) {
    return true;
  }
  if (/^[A-Za-z]:\//.test(normalized)) return true;
  for (const segment of normalized.split("/")) {
    if (segment === "." || segment === "..") return true;
  }
  return false;
}

export interface ValidatedGdbArchive {
  /** Archive entry filename of the discovered `.gdb` root, e.g. `Venue.gdb`. */
  rootName: string;
}

function validateSystemCatalogHeader(bytes: Uint8Array, entrySize: number): void {
  if (bytes.byteLength < 40) {
    throw new GdbSourceError(
      "invalid_geodatabase",
      "The FileGDB system catalog is truncated.",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0, true);
  const declaredSize = Number(view.getBigUint64(24, true));
  const fieldDescriptionOffset = Number(view.getBigUint64(32, true));
  if (
    (version !== 3 && version !== 4) ||
    declaredSize !== entrySize ||
    fieldDescriptionOffset < 40 ||
    fieldDescriptionOffset >= entrySize
  ) {
    throw new GdbSourceError(
      "invalid_geodatabase",
      "The FileGDB system catalog header is invalid.",
      { version, declaredSize, entrySize, fieldDescriptionOffset },
    );
  }
}

/**
 * Stream the central directory of the uploaded `.gdb.zip` and require exactly
 * one `.gdb` root. Central-directory metadata provides the archive-wide
 * limits; only the small system catalog is decompressed to check its FileGDB
 * header before the archive reaches GDAL.
 */
export async function validateGdbArchive(bytes: Uint8Array): Promise<ValidatedGdbArchive> {
  if (bytes.byteLength > GDB_MAX_UPLOAD_BYTES) {
    throw new GdbSourceError("gdb_too_large", "Uploaded GDB archive exceeds the size limit.", {
      size: bytes.byteLength,
      limit: GDB_MAX_UPLOAD_BYTES,
    });
  }

  const reader = new ZipReader(new BlobReader(new Blob([bytes])), {
    checkSignature: true,
    checkOverlappingEntry: true,
    useWebWorkers: false,
  });

  let entryTotal = 0;
  let uncompressedTotal = 0;
  const gdbRoots = new Set<string>();
  let rootName: string | null = null;
  const systemCatalogs = new Map<string, { bytes: Uint8Array; entrySize: number }>();
  const systemCatalogIndexes = new Set<string>();

  try {
    for await (const entry of reader.getEntriesGenerator()) {
      entryTotal += 1;
      if (entryTotal > GDB_MAX_ARCHIVE_ENTRIES) {
        throw new GdbSourceError("gdb_too_large", "GDB archive has too many entries.", {
          entryCount: entryTotal,
          limit: GDB_MAX_ARCHIVE_ENTRIES,
        });
      }
      if (entry.encrypted) {
        throw new GdbSourceError("invalid_geodatabase", "Archive contains an encrypted entry.", {
          entry: entry.filename,
        });
      }
      if (isUnsafePath(entry.filename)) {
        throw new GdbSourceError("invalid_geodatabase", "Archive contains an unsafe entry path.", {
          entry: entry.filename,
        });
      }
      if (entry.uncompressedSize > GDB_MAX_UPLOAD_BYTES) {
        throw new GdbSourceError("gdb_too_large", "A single archive entry exceeds the size limit.", {
          entry: entry.filename,
          size: entry.uncompressedSize,
        });
      }
      uncompressedTotal += entry.uncompressedSize;
      if (uncompressedTotal > GDB_MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new GdbSourceError("gdb_too_large", "Uncompressed archive exceeds the size limit.", {
          uncompressedTotal,
        });
      }

      const segments = pathSegments(entry.filename);
      const gdbIndex = segments.findIndex((segment) => /\.gdb$/i.test(segment));
      if (gdbIndex !== -1) {
        const rootKey = segments.slice(0, gdbIndex + 1).join("/").toLowerCase();
        gdbRoots.add(rootKey);
        if (rootName === null) rootName = segments[gdbIndex] ?? null;
        const childPath = segments.slice(gdbIndex + 1).join("/").toLowerCase();
        if (!entry.directory && childPath === "a00000001.gdbtable") {
          let catalogBytes: Uint8Array;
          try {
            catalogBytes = new Uint8Array(
              await entry.arrayBuffer({ checkSignature: true, useWebWorkers: false }),
            );
          } catch (error) {
            throw new GdbSourceError(
              "invalid_geodatabase",
              "The FileGDB system catalog could not be read.",
              { reason: error instanceof Error ? error.message : String(error) },
            );
          }
          systemCatalogs.set(rootKey, {
            bytes: catalogBytes,
            entrySize: entry.uncompressedSize,
          });
        } else if (!entry.directory && childPath === "a00000001.gdbtablx") {
          systemCatalogIndexes.add(rootKey);
        }
      }
    }
  } catch (error) {
    if (error instanceof GdbSourceError) throw error;
    throw new GdbSourceError("invalid_geodatabase", "Archive could not be read.", {
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    try {
      await reader.close();
    } catch {
      /* Best-effort close. */
    }
  }

  if (gdbRoots.size === 0) {
    throw new GdbSourceError("invalid_geodatabase", "Archive contains no .gdb root.");
  }
  if (gdbRoots.size > 1) {
    throw new GdbSourceError(
      "invalid_geodatabase",
      "Archive contains multiple .gdb roots.",
      { roots: Array.from(gdbRoots) },
    );
  }

  const rootKey = gdbRoots.values().next().value;
  const systemCatalog = rootKey === undefined ? undefined : systemCatalogs.get(rootKey);
  if (
    rootKey === undefined ||
    systemCatalog === undefined ||
    !systemCatalogIndexes.has(rootKey)
  ) {
    throw new GdbSourceError(
      "invalid_geodatabase",
      "Archive is missing the FileGDB system catalog.",
    );
  }
  validateSystemCatalogHeader(systemCatalog.bytes, systemCatalog.entrySize);

  return { rootName: rootName ?? "geodatabase.gdb" };
}

