import { BlobReader, ZipReader, type Entry } from "@zip.js/zip.js";
import { ArchiveError, archiveErrorCopy } from "../errors/ArchiveError";
import type { GdbSourceFile } from "./types";

/**
 * Browser-only File Geodatabase source limits. These are deliberately looser
 * than the Apple IMDF ZIP constants (64 entries / 100 MiB per entry / 300 MiB
 * total), which cannot admit the supplied multi-hundred-layer GDB corpora.
 */
const MIB = 1024 * 1024;
export const GDB_MAX_SELECTED_FILES = 10_000;
export const GDB_MAX_COMPRESSED_BYTES = 100 * MIB;
export const GDB_MAX_FILE_BYTES = 200 * MIB;
export const GDB_MAX_TOTAL_BYTES = 500 * MIB;
export const GDB_MAX_GENERATED_BYTES = 500 * MIB;

/** One `.gdb` database resolved from the selection, ready for staging. */
export interface GdbSourceGroup {
  /** Stable, order-independent id: `gdb-1`, `gdb-2`, ... */
  databaseId: string;
  /** The `.gdb` folder or in-archive root name. */
  name: string;
  /** Normalized sort key that fixes review/staging ordering. */
  relativePath: string;
  /** Directory mode: every file under the root. Archive mode: the archive. */
  files: GdbSourceFile[];
}

export interface GdbValidationResult {
  mode: "directory" | "archive";
  groups: GdbSourceGroup[];
}

function tooLarge(details?: Record<string, unknown>): never {
  throw new ArchiveError("gdb_too_large", archiveErrorCopy.gdb_too_large, details);
}

function invalid(details?: Record<string, unknown>): never {
  throw new ArchiveError(
    "invalid_geodatabase",
    archiveErrorCopy.invalid_geodatabase,
    details,
  );
}

export function normalizePath(path: string): string {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");
}

export function pathSegments(path: string): string[] {
  return normalizePath(path)
    .split("/")
    .filter((segment) => segment.length > 0);
}

export function pathJoin(...parts: string[]): string {
  return normalizePath(parts.join("/"));
}

export function sanitizeSegment(value: string, fallback = "item"): string {
  const sanitized = String(value || "")
    .replace(/[\\/:*?"<>|\0]/g, "_")
    .trim();
  return sanitized || fallback;
}

/** Virtual `.gdb.zip` name for a staged archive, retaining the suffix. */
export function toVirtualGdbZipName(name: string): string {
  const base = sanitizeSegment(
    String(name || "geodatabase")
      .replace(/\.gdb\.zip$/i, "")
      .replace(/\.zip$/i, ""),
    "geodatabase",
  );
  return `${base}.gdb.zip`;
}

/**
 * Deterministic per-database staging root. The `databaseId` prefix guarantees
 * that two databases (or archives) sharing a `.gdb`/`.zip` basename stage into
 * distinct directories instead of merging or overwriting, while the `.gdb` /
 * `.gdb.zip` suffix is retained so GDAL's FileGDB driver still recognizes it.
 */
export function stagedGroupRoot(
  importRoot: string,
  mode: "directory" | "archive",
  group: GdbSourceGroup,
): string {
  if (mode === "archive") {
    const archiveName = group.files[0]?.name ?? group.name;
    return pathJoin(importRoot, group.databaseId, toVirtualGdbZipName(archiveName));
  }
  return pathJoin(
    importRoot,
    group.databaseId,
    sanitizeSegment(group.name, "geodatabase.gdb"),
  );
}

/** Reject traversal, absolute, drive-qualified, null-byte, and empty-segment paths. */
function isUnsafePath(path: string): boolean {
  const normalized = normalizePath(path);
  if (normalized.length === 0) return true;
  if (normalized.includes("\0")) return true;
  if (normalized.startsWith("/")) return true;
  // Windows drive-absolute after slash normalization (C:/…, d:/…).
  if (/^[A-Za-z]:\//.test(normalized)) return true;
  for (const segment of normalized.split("/")) {
    if (segment === "." || segment === "..") return true;
  }
  return false;
}

/** Index of the first path segment ending in `.gdb`, or -1. */
function gdbSegmentIndex(segments: string[]): number {
  return segments.findIndex((segment) => /\.gdb$/i.test(segment));
}

/** Shared comparator that fixes review/staging order by normalized path. */
const byRelativePath = (
  a: { relativePath: string },
  b: { relativePath: string },
): number => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);

function validateDirectory(files: readonly GdbSourceFile[]): GdbValidationResult {
  if (files.length > GDB_MAX_SELECTED_FILES) {
    tooLarge({ fileCount: files.length, limit: GDB_MAX_SELECTED_FILES });
  }

  const roots = new Map<
    string,
    { key: string; name: string; segmentCount: number; files: GdbSourceFile[] }
  >();
  let stagedBytes = 0;

  for (const descriptor of files) {
    const relativePath = descriptor.relativePath || descriptor.name;
    if (isUnsafePath(relativePath)) {
      invalid({ path: relativePath, reason: "unsafe_path" });
    }
    const segments = pathSegments(relativePath);
    const gdbIndex = gdbSegmentIndex(segments);
    if (gdbIndex === -1) {
      // Files outside any `.gdb` root (including .mxd) are ignored, not staged.
      continue;
    }

    const rootSegments = segments.slice(0, gdbIndex + 1);
    const rootKey = rootSegments.join("/");
    const size = descriptor.file.size;
    if (size > GDB_MAX_FILE_BYTES) {
      tooLarge({ path: relativePath, size, limit: GDB_MAX_FILE_BYTES });
    }
    stagedBytes += size;
    if (stagedBytes > GDB_MAX_TOTAL_BYTES) {
      tooLarge({ stagedBytes, limit: GDB_MAX_TOTAL_BYTES });
    }

    let root = roots.get(rootKey);
    if (!root) {
      root = {
        key: rootKey,
        name: segments[gdbIndex] ?? "geodatabase.gdb",
        segmentCount: gdbIndex + 1,
        files: [],
      };
      roots.set(rootKey, root);
    }
    root.files.push({
      file: descriptor.file,
      name: descriptor.name,
      relativePath: normalizePath(relativePath),
    });
  }

  if (roots.size === 0) {
    invalid({ reason: "no_gdb_root" });
  }

  const ordered = Array.from(roots.values())
    .map((root) => ({ name: root.name, relativePath: root.key, files: root.files }))
    .sort(byRelativePath);

  return {
    mode: "directory",
    groups: ordered.map((group, index) => ({
      databaseId: `gdb-${index + 1}`,
      name: group.name,
      relativePath: group.relativePath,
      files: group.files,
    })),
  };
}

/**
 * Iterate central-directory entries via zip.js' async generator and stop as
 * soon as the caller rejects (e.g. entry count overflow). Always closes the
 * reader; rethrows ArchiveError so limit/path failures stay typed.
 */
async function forEachArchiveEntry(
  file: File,
  onEntry: (entry: Entry) => void,
): Promise<void> {
  const reader = new ZipReader(new BlobReader(file), {
    checkSignature: true,
    checkOverlappingEntry: true,
    useWebWorkers: false,
  });
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      onEntry(entry);
    }
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    return invalid({ archive: file.name, reason: "unreadable_archive" });
  } finally {
    try {
      await reader.close();
    } catch {
      // Best-effort close.
    }
  }
}

async function validateArchive(
  files: readonly GdbSourceFile[],
): Promise<GdbValidationResult> {
  if (files.length > GDB_MAX_SELECTED_FILES) {
    tooLarge({ fileCount: files.length, limit: GDB_MAX_SELECTED_FILES });
  }

  let compressedTotal = 0;
  for (const descriptor of files) {
    if (!/\.zip$/i.test(descriptor.name)) {
      invalid({ archive: descriptor.name, reason: "not_zip" });
    }
    compressedTotal += descriptor.file.size;
  }
  if (compressedTotal > GDB_MAX_COMPRESSED_BYTES) {
    tooLarge({ compressedTotal, limit: GDB_MAX_COMPRESSED_BYTES });
  }

  let entryTotal = 0;
  let uncompressedTotal = 0;
  const staged: GdbSourceGroup[] = [];

  for (const descriptor of files) {
    const gdbRoots = new Set<string>();
    let rootName: string | null = null;

    await forEachArchiveEntry(descriptor.file, (entry) => {
      entryTotal += 1;
      if (entryTotal > GDB_MAX_SELECTED_FILES) {
        tooLarge({ entryCount: entryTotal, limit: GDB_MAX_SELECTED_FILES });
      }
      if (entry.encrypted) {
        invalid({ archive: descriptor.name, entry: entry.filename, reason: "encrypted" });
      }
      if (isUnsafePath(entry.filename)) {
        invalid({ archive: descriptor.name, entry: entry.filename, reason: "unsafe_path" });
      }
      if (entry.uncompressedSize > GDB_MAX_FILE_BYTES) {
        tooLarge({
          archive: descriptor.name,
          entry: entry.filename,
          size: entry.uncompressedSize,
          limit: GDB_MAX_FILE_BYTES,
        });
      }
      uncompressedTotal += entry.uncompressedSize;
      if (uncompressedTotal > GDB_MAX_TOTAL_BYTES) {
        tooLarge({ uncompressedTotal, limit: GDB_MAX_TOTAL_BYTES });
      }

      const segments = pathSegments(entry.filename);
      const gdbIndex = gdbSegmentIndex(segments);
      if (gdbIndex !== -1) {
        // Root identity is the full case-folded prefix through the .gdb
        // segment, so two .gdb roots sharing a basename under different
        // parents are distinct roots (and rejected as multiple).
        gdbRoots.add(segments.slice(0, gdbIndex + 1).join("/").toLowerCase());
        if (rootName === null) {
          rootName = segments[gdbIndex] ?? null;
        }
      }
    });

    if (gdbRoots.size === 0) {
      invalid({ archive: descriptor.name, reason: "no_gdb_root" });
    }
    if (gdbRoots.size > 1) {
      invalid({
        archive: descriptor.name,
        reason: "multiple_gdb_roots",
        roots: Array.from(gdbRoots),
      });
    }

    staged.push({
      databaseId: "",
      name: rootName ?? descriptor.name,
      relativePath: normalizePath(descriptor.relativePath || descriptor.name),
      files: [descriptor],
    });
  }

  const ordered = [...staged].sort(byRelativePath);
  return {
    mode: "archive",
    groups: ordered.map((group, index) => ({
      ...group,
      databaseId: `gdb-${index + 1}`,
    })),
  };
}

/**
 * Validate and normalize a browser GDB selection into deterministic source
 * groups. Directory mode sanitizes/relativizes selected files and groups them
 * under `.gdb` roots. Archive mode reads each zip's central directory (without
 * extracting) and requires exactly one `.gdb` root per archive. Throws a typed
 * {@link ArchiveError} (`invalid_geodatabase` or `gdb_too_large`) on failure.
 */
export async function validateGdbSources(
  mode: "directory" | "archive",
  files: readonly GdbSourceFile[],
): Promise<GdbValidationResult> {
  if (files.length === 0) {
    invalid({ reason: "empty_selection" });
  }
  return mode === "archive" ? validateArchive(files) : validateDirectory(files);
}
