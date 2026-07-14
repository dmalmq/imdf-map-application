/// <reference lib="webworker" />

import {
  BlobReader,
  configure,
  ZipReader,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js";
import {
  ArchiveError,
  archiveErrorCopy,
  type ArchiveErrorCode,
} from "../errors/ArchiveError";
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_COMPRESSED_BYTES,
  MAX_ENTRY_UNCOMPRESSED_BYTES,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
} from "./archiveLimits";
import type { ImdfWorkerRequest, ImdfWorkerResponse } from "./loadImdfArchive";
import { normalizeVenue } from "./normalizeVenue";
import type {
  FeatureType,
  ImdfManifest,
  ParsedImdfArchive,
  ViewerEnrichmentEntry,
  ViewerWarning,
} from "./types";
import { parseViewerEnrichment } from "./viewerEnrichment";

configure({ useWebWorkers: false });

const FEATURE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STANDARD_FEATURE_FILES: Record<string, FeatureType> = {
  "address.geojson": "address",
  "amenity.geojson": "amenity",
  "anchor.geojson": "anchor",
  "building.geojson": "building",
  "detail.geojson": "detail",
  "fixture.geojson": "fixture",
  "footprint.geojson": "footprint",
  "geofence.geojson": "geofence",
  "kiosk.geojson": "kiosk",
  "level.geojson": "level",
  "occupant.geojson": "occupant",
  "opening.geojson": "opening",
  "relationship.geojson": "relationship",
  "section.geojson": "section",
  "unit.geojson": "unit",
  "venue.geojson": "venue",
};

const REQUIRED_FILES: Record<string, true> = {
  "manifest.json": true,
  "venue.geojson": true,
  "address.geojson": true,
};

const VIEWER_ENRICHMENT_NAME = "viewer-enrichment.json";

declare const self: DedicatedWorkerGlobalScope;

function fail(
  code: ArchiveErrorCode,
  message?: string,
  details?: Record<string, unknown>,
): never {
  throw details !== undefined
    ? new ArchiveError(code, message ?? archiveErrorCopy[code], details)
    : new ArchiveError(code, message ?? archiveErrorCopy[code]);
}

function isUnsafePath(filename: string): boolean {
  if (filename.length === 0) {
    return true;
  }
  if (filename.includes("\0") || filename.includes("\\")) {
    return true;
  }
  if (filename.startsWith("/") || filename.startsWith("./") || filename.includes("..")) {
    return true;
  }
  // Must be a single root-level name (no nested directories).
  if (filename.includes("/")) {
    return true;
  }
  return false;
}

function isZipMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4) {
    return false;
  }
  // PK\x03\x04 (local file) or PK\x05\x06 (empty archive end-of-central-dir)
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06))
  );
}

/**
 * Writer that counts actual decompressed bytes and aborts when per-entry or
 * cumulative uncompressed limits are exceeded.
 */
class BoundedByteWriter {
  private readonly chunks: Uint8Array[] = [];
  private entryBytes = 0;
  writable: WritableStream<Uint8Array>;

  constructor(private readonly totalTracker: { bytes: number }) {
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        const size = chunk.byteLength;
        this.entryBytes += size;
        this.totalTracker.bytes += size;
        if (
          this.entryBytes > MAX_ENTRY_UNCOMPRESSED_BYTES ||
          this.totalTracker.bytes > MAX_TOTAL_UNCOMPRESSED_BYTES
        ) {
          fail("archive_too_large");
        }
        this.chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
      },
    });
  }

  getBytes(): Uint8Array {
    if (this.chunks.length === 0) {
      return new Uint8Array(0);
    }
    if (this.chunks.length === 1) {
      return this.chunks[0] ?? new Uint8Array(0);
    }
    const out = new Uint8Array(this.entryBytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}

function mapZipJsError(error: unknown): never {
  if (error instanceof ArchiveError) {
    throw error;
  }
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const lower = message.toLowerCase();
  if (
    lower.includes("encrypt") ||
    lower.includes("password") ||
    lower.includes("overlap") ||
    lower.includes("signature") ||
    lower.includes("crc") ||
    lower.includes("invalid") ||
    lower.includes("corrupted") ||
    lower.includes("end of central directory") ||
    lower.includes("zip")
  ) {
    fail("invalid_archive");
  }
  fail("invalid_archive");
}

async function extractEntryText(
  entry: FileEntry,
  totalTracker: { bytes: number },
): Promise<string> {
  const writer = new BoundedByteWriter(totalTracker);
  try {
    await entry.getData(writer.writable, {
      checkSignature: true,
      // zip.js: `checkOverlappingEntryOnly` verifies overlap WITHOUT reading
      // content; `checkOverlappingEntry` runs the same overlap detection while
      // extracting, which is what the archive boundary requires.
      checkOverlappingEntry: true,
      useWebWorkers: false,
    });
  } catch (error) {
    if (error instanceof ArchiveError) {
      throw error;
    }
    mapZipJsError(error);
  }
  const bytes = writer.getBytes();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("invalid_json", archiveErrorCopy.invalid_json, {
      entry: entry.filename,
      reason: "utf8_decode",
    });
  }
}

function parseJson(text: string, entryName: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    fail("invalid_json", archiveErrorCopy.invalid_json, { entry: entryName });
  }
}

function assertFeatureCollection(
  value: unknown,
  featureType: FeatureType,
  entryName: string,
): GeoJSON.FeatureCollection {
  if (value === null || typeof value !== "object") {
    fail("invalid_feature_collection", archiveErrorCopy.invalid_feature_collection, {
      entry: entryName,
    });
  }
  if (!("type" in value) || value.type !== "FeatureCollection") {
    fail("invalid_feature_collection", archiveErrorCopy.invalid_feature_collection, {
      entry: entryName,
    });
  }
  if (!("features" in value) || !Array.isArray(value.features)) {
    fail("invalid_feature_collection", archiveErrorCopy.invalid_feature_collection, {
      entry: entryName,
    });
  }

  const features: Array<GeoJSON.Feature<GeoJSON.Geometry | null>> = [];
  for (const feature of value.features) {
    if (feature === null || typeof feature !== "object") {
      fail("invalid_feature_collection", archiveErrorCopy.invalid_feature_collection, {
        entry: entryName,
      });
    }
    if (!("type" in feature) || feature.type !== "Feature") {
      fail("invalid_feature_collection", archiveErrorCopy.invalid_feature_collection, {
        entry: entryName,
      });
    }

    let featureId: string | undefined;
    if ("id" in feature && typeof feature.id === "string") {
      featureId = feature.id;
    } else if (
      "properties" in feature &&
      feature.properties !== null &&
      typeof feature.properties === "object" &&
      "id" in feature.properties &&
      typeof feature.properties.id === "string"
    ) {
      featureId = feature.properties.id;
    }
    if (featureId === undefined || !FEATURE_ID_RE.test(featureId)) {
      fail("invalid_feature_collection", archiveErrorCopy.invalid_feature_collection, {
        entry: entryName,
        reason: "feature_id",
        featureId,
      });
    }

    // IMDF declares `feature_type` as a top-level foreign member on the
    // feature; accept a properties-level declaration defensively.
    let declaredType: string | undefined;
    if ("feature_type" in feature && typeof feature.feature_type === "string") {
      declaredType = feature.feature_type;
    } else if (
      "properties" in feature &&
      feature.properties !== null &&
      typeof feature.properties === "object" &&
      "feature_type" in feature.properties &&
      typeof feature.properties.feature_type === "string"
    ) {
      declaredType = feature.properties.feature_type;
    }
    if (declaredType !== featureType) {
      fail("invalid_feature_collection", archiveErrorCopy.invalid_feature_collection, {
        entry: entryName,
        reason: "feature_type_mismatch",
        expected: featureType,
        actual: declaredType,
      });
    }

    let geometry: GeoJSON.Geometry | null = null;
    if ("geometry" in feature && feature.geometry !== undefined && feature.geometry !== null) {
      // Geometry shape is validated later by geometryCenter; accept any object here.
      geometry = feature.geometry as GeoJSON.Geometry;
    }
    let properties: GeoJSON.GeoJsonProperties = {};
    if (
      "properties" in feature &&
      feature.properties !== null &&
      typeof feature.properties === "object"
    ) {
      properties = feature.properties as GeoJSON.GeoJsonProperties;
    }

    features.push({
      type: "Feature",
      id: featureId,
      geometry,
      properties,
    });
  }

  return { type: "FeatureCollection", features: features as GeoJSON.Feature[] };
}

export async function loadArchive(file: File): Promise<ImdfWorkerResponse> {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    fail("unsupported_file");
  }
  if (file.size > MAX_COMPRESSED_BYTES) {
    fail("archive_too_large");
  }

  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!isZipMagic(header)) {
    fail("unsupported_file");
  }

  let entries: Entry[];
  const reader = new ZipReader(new BlobReader(file), {
    checkSignature: true,
    checkOverlappingEntry: true,
    useWebWorkers: false,
  });
  try {
    entries = await reader.getEntries();
  } catch (error) {
    try {
      await reader.close();
    } catch {
      // ignore close errors after a failed open
    }
    mapZipJsError(error);
  }

  try {
    if (entries.length > MAX_ARCHIVE_ENTRIES) {
      fail("archive_too_large", archiveErrorCopy.archive_too_large, {
        entryCount: entries.length,
      });
    }

    let declaredTotal = 0;
    const seenNames = new Map<string, true>();
    const fileEntries: FileEntry[] = [];
    const warnings: ViewerWarning[] = [];

    for (const entry of entries) {
      if (entry.directory) {
        // Root-only archives should not contain directory entries; treat as unsafe.
        fail("unsafe_archive_path", archiveErrorCopy.unsafe_archive_path, {
          entry: entry.filename,
          reason: "directory",
        });
      }
      if (isUnsafePath(entry.filename)) {
        fail("unsafe_archive_path", archiveErrorCopy.unsafe_archive_path, {
          entry: entry.filename,
        });
      }
      if (entry.encrypted) {
        fail("invalid_archive", archiveErrorCopy.invalid_archive, {
          entry: entry.filename,
          reason: "encrypted",
        });
      }
      if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
        fail("archive_too_large");
      }
      declaredTotal += entry.uncompressedSize;
      if (declaredTotal > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        fail("archive_too_large");
      }

      const folded = entry.filename.toLowerCase();
      if (seenNames.has(folded)) {
        // Enrichment duplicates are nonfatal and handled after the scan; every
        // other case-folded collision remains a hard archive error.
        if (folded !== VIEWER_ENRICHMENT_NAME) {
          fail("invalid_archive", archiveErrorCopy.invalid_archive, {
            entry: entry.filename,
            reason: "duplicate_name",
          });
        }
      } else {
        seenNames.set(folded, true);
      }
      fileEntries.push(entry);
    }

    const byName = new Map<string, FileEntry>();
    for (const entry of fileEntries) {
      byName.set(entry.filename.toLowerCase(), entry);
    }

    for (const required of Object.keys(REQUIRED_FILES)) {
      if (!byName.has(required)) {
        fail("missing_required_file", archiveErrorCopy.missing_required_file, {
          missing: required,
        });
      }
    }

    const totalTracker = { bytes: 0 };
    const collections: ParsedImdfArchive["collections"] = {};
    let manifest: ImdfManifest | undefined;
    let enrichment: Record<string, ViewerEnrichmentEntry> | undefined;

    const enrichmentMatches = fileEntries.filter(
      (entry) => entry.filename.toLowerCase() === VIEWER_ENRICHMENT_NAME,
    );
    if (enrichmentMatches.length > 1) {
      warnings.push({
        code: "duplicate_viewer_enrichment",
        message:
          "Multiple viewer-enrichment.json entries found; enrichment was ignored.",
        archiveEntry: VIEWER_ENRICHMENT_NAME,
      });
    } else if (enrichmentMatches.length === 1) {
      const enrichmentEntry = enrichmentMatches[0]!;
      try {
        const text = await extractEntryText(enrichmentEntry, totalTracker);
        let parsed: unknown;
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          warnings.push({
            code: "invalid_viewer_enrichment",
            message: `Malformed viewer enrichment JSON in ${enrichmentEntry.filename}.`,
            archiveEntry: enrichmentEntry.filename,
          });
          parsed = undefined;
        }
        if (parsed !== undefined) {
          const parsedEnrichment = parseViewerEnrichment(parsed);
          if (parsedEnrichment.warnings.length > 0) {
            warnings.push(
              ...parsedEnrichment.warnings.map((warning) => ({
                ...warning,
                archiveEntry: warning.archiveEntry ?? enrichmentEntry.filename,
              })),
            );
          }
          if (Object.keys(parsedEnrichment.entries).length > 0) {
            enrichment = parsedEnrichment.entries;
          }
        }
      } catch (error) {
        // Size / path failures remain fatal ArchiveErrors; rethrow those.
        if (error instanceof ArchiveError) {
          throw error;
        }
        warnings.push({
          code: "invalid_viewer_enrichment",
          message: `Failed to read viewer enrichment from ${enrichmentEntry.filename}.`,
          archiveEntry: enrichmentEntry.filename,
        });
      }
    }

    for (const entry of fileEntries) {
      const lower = entry.filename.toLowerCase();
      if (lower === VIEWER_ENRICHMENT_NAME) {
        // Already handled above; never emit unknown_archive_entry for it.
        continue;
      }
      if (lower === "manifest.json") {
        const text = await extractEntryText(entry, totalTracker);
        const parsed = parseJson(text, entry.filename);
        if (parsed === null || typeof parsed !== "object") {
          fail("invalid_json", archiveErrorCopy.invalid_json, { entry: entry.filename });
        }
        let version: unknown;
        let language: unknown;
        if ("version" in parsed) {
          version = parsed.version;
        }
        if ("language" in parsed) {
          language = parsed.language;
        }
        // Real-world exporters stamp dotted or hyphenated pre-release
        // suffixes on the 1.0.0 data model (e.g. "1.0.0.rc.1", "1.0.0-rc.1").
        const supportedVersion =
          typeof version === "string" &&
          /^1\.0\.0([.-][0-9a-z]+(\.[0-9a-z]+)*)?$/i.test(version);
        if (!supportedVersion) {
          fail("invalid_manifest_version");
        }
        if (typeof language !== "string" || language === "") {
          fail("invalid_manifest_version", archiveErrorCopy.invalid_manifest_version, {
            reason: "language",
          });
        }
        manifest = { ...(parsed as Record<string, unknown>), version: "1.0.0", language };
        continue;
      }

      const featureType = STANDARD_FEATURE_FILES[lower];
      if (featureType !== undefined) {
        const text = await extractEntryText(entry, totalTracker);
        const parsed = parseJson(text, entry.filename);
        collections[featureType] = assertFeatureCollection(
          parsed,
          featureType,
          entry.filename,
        );
        continue;
      }

      // Safe unknown root entry: skip with a warning, never parse as IMDF.
      warnings.push({
        code: "unknown_archive_entry",
        message: `Ignored unknown archive entry ${entry.filename}.`,
        archiveEntry: entry.filename,
      });
    }

    if (manifest === undefined) {
      fail("missing_required_file", archiveErrorCopy.missing_required_file, {
        missing: "manifest.json",
      });
    }

    const venueFeatures = collections.venue?.features ?? [];
    if (venueFeatures.length !== 1) {
      fail("invalid_feature_collection", archiveErrorCopy.invalid_feature_collection, {
        reason: "venue_count",
        count: venueFeatures.length,
      });
    }
    const levelFeatures = collections.level?.features ?? [];
    if (levelFeatures.length < 1) {
      fail("invalid_feature_collection", archiveErrorCopy.invalid_feature_collection, {
        reason: "level_count",
        count: levelFeatures.length,
      });
    }

    const seenIds = new Map<string, true>();
    for (const [featureType, collection] of Object.entries(collections) as Array<
      [FeatureType, GeoJSON.FeatureCollection | undefined]
    >) {
      if (collection === undefined) {
        continue;
      }
      for (const feature of collection.features) {
        const id = feature.id;
        if (typeof id !== "string") {
          fail("invalid_feature_collection", archiveErrorCopy.invalid_feature_collection, {
            featureType,
            reason: "missing_id",
          });
        }
        if (seenIds.has(id)) {
          fail("duplicate_feature_id", archiveErrorCopy.duplicate_feature_id, {
            featureId: id,
          });
        }
        seenIds.set(id, true);
      }
    }

    const archive: ParsedImdfArchive = { manifest, collections, enrichment };
    const venue = normalizeVenue(archive);
    if (warnings.length > 0) {
      venue.warnings = [...warnings, ...venue.warnings];
    }
    return { type: "loaded", venue };
  } finally {
    try {
      await reader.close();
    } catch {
      // ignore close errors
    }
  }
}

function serializeFailure(error: unknown): ImdfWorkerResponse {
  if (error instanceof ArchiveError) {
    if (error.details !== undefined) {
      return {
        type: "failed",
        error: { code: error.code, message: error.message, details: error.details },
      };
    }
    return {
      type: "failed",
      error: { code: error.code, message: error.message },
    };
  }
  return {
    type: "failed",
    error: {
      code: "worker_failed",
      message: archiveErrorCopy.worker_failed,
    },
  };
}

// Register the worker message handler only inside a real worker scope.
// Importing this module under vitest/jsdom must not throw or register.
// `WorkerGlobalScope` is defined in every worker scope (including module
// workers) and undefined in window/jsdom.
declare const WorkerGlobalScope: (new () => unknown) | undefined;
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  self.onmessage = (event: MessageEvent<ImdfWorkerRequest>): void => {
    const data = event.data;
    if (data === null || typeof data !== "object" || data.type !== "load") {
      const response: ImdfWorkerResponse = {
        type: "failed",
        error: {
          code: "worker_failed",
          message: archiveErrorCopy.worker_failed,
        },
      };
      self.postMessage(response);
      return;
    }

    void loadArchive(data.file)
      .then((response) => {
        self.postMessage(response);
      })
      .catch((error: unknown) => {
        self.postMessage(serializeFailure(error));
      });
  };
}
