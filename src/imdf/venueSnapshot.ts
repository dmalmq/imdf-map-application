import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
  configure,
} from "@zip.js/zip.js";
import { deriveVenueBuildings } from "./normalizeVenue";
import type { Entry } from "@zip.js/zip.js";
import { ArchiveError } from "../errors/ArchiveError";
import type {
  BoundsTuple,
  ImdfManifest,
  LoadedVenue,
  SearchEntry,
  ViewerEnrichmentEntry,
  ViewerFeature,
  ViewerLevel,
  ViewerWarning,
} from "./types";

// Deflate on the calling thread: deterministic in jsdom/node tests, and the
// only writer is the publish flow, where a short main-thread stall is acceptable.
configure({ useWebWorkers: false });

export const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_ENTRY = "snapshot.json";
const MAX_SNAPSHOT_BYTES = 600 * 1024 * 1024;
const MAX_SNAPSHOT_ENTRIES = 100;
const FEATURE_TYPES = new Set([
  "address",
  "amenity",
  "anchor",
  "building",
  "detail",
  "fixture",
  "footprint",
  "geofence",
  "kiosk",
  "level",
  "occupant",
  "opening",
  "relationship",
  "section",
  "unit",
  "venue",
]);
const WARNING_CODES = new Set([
  "missing_locale",
  "unresolved_reference",
  "missing_level_geometry",
  "missing_display_point",
  "unknown_archive_entry",
  "invalid_viewer_enrichment",
  "duplicate_viewer_enrichment",
  "gdb_geometry_skipped",
  "gdb_worker_warning",
]);

interface SerializedVenue {
  manifest: ImdfManifest;
  venue: ViewerFeature;
  levels: ViewerLevel[];
  featuresById: [string, ViewerFeature][];
  renderFeaturesByLevel: [string, GeoJSON.FeatureCollection][];
  searchEntries: SearchEntry[];
  boundsByLevel: [string, BoundsTuple][];
  enrichmentByFeatureId: [string, ViewerEnrichmentEntry][];
  warnings: ViewerWarning[];
}

interface SnapshotFile {
  schemaVersion: number;
  kind: "venue-snapshot";
  generatedAt: string;
  sourceName: string;
  venue: SerializedVenue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringTuple(value: unknown): value is [string, unknown] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isPosition(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
  );
}

function isGeometry(value: unknown): value is GeoJSON.Geometry | null {
  if (value === null) return true;
  if (!isRecord(value) || typeof value.type !== "string") return false;
  const coordinates = value.coordinates;
  switch (value.type) {
    case "Point":
      return isPosition(coordinates);
    case "MultiPoint":
    case "LineString":
      return Array.isArray(coordinates) && coordinates.every(isPosition);
    case "MultiLineString":
    case "Polygon":
      return (
        Array.isArray(coordinates) &&
        coordinates.every(
          (line) => Array.isArray(line) && line.every(isPosition),
        )
      );
    case "MultiPolygon":
      return (
        Array.isArray(coordinates) &&
        coordinates.every(
          (polygon) =>
            Array.isArray(polygon) &&
            polygon.every(
              (line) => Array.isArray(line) && line.every(isPosition),
            ),
        )
      );
    case "GeometryCollection":
      return Array.isArray(value.geometries) && value.geometries.every(isGeometry);
    default:
      return false;
  }
}

function isViewerFeature(value: unknown): value is ViewerFeature {
  if (!isRecord(value)) return false;
  const center = value.center;
  return (
    typeof value.id === "string" &&
    value.id !== "" &&
    typeof value.featureType === "string" &&
    FEATURE_TYPES.has(value.featureType) &&
    isNullableString(value.levelId) &&
    isGeometry(value.geometry) &&
    (center === null || (isPosition(center) && center.length === 2)) &&
    isStringRecord(value.labels) &&
    isStringRecord(value.altLabels) &&
    isNullableString(value.category) &&
    isStringArray(value.accessibility) &&
    isNullableString(value.restriction) &&
    (value.buildingId === undefined || isNullableString(value.buildingId)) &&
    isRecord(value.sourceProperties)
  );
}

function isViewerLevel(value: unknown): value is ViewerLevel {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id !== "" &&
    isStringArray(value.sourceLevelIds) &&
    typeof value.ordinal === "number" &&
    Number.isFinite(value.ordinal) &&
    isStringRecord(value.label) &&
    isStringRecord(value.shortName)
  );
}

function isSearchEntry(value: unknown): value is SearchEntry {
  return (
    isRecord(value) &&
    typeof value.featureId === "string" &&
    typeof value.featureType === "string" &&
    FEATURE_TYPES.has(value.featureType) &&
    isNullableString(value.levelId) &&
    (value.buildingId === undefined || isNullableString(value.buildingId)) &&
    isNullableString(value.category) &&
    isStringRecord(value.labels) &&
    isStringRecord(value.altLabels) &&
    isStringArray(value.normalizedLabels) &&
    isStringArray(value.normalizedAltLabels) &&
    typeof value.normalizedCategory === "string"
  );
}

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  return (
    isRecord(value) &&
    value.type === "FeatureCollection" &&
    Array.isArray(value.features) &&
    value.features.every(
      (feature) =>
        isRecord(feature) &&
        feature.type === "Feature" &&
        isGeometry(feature.geometry) &&
        (feature.properties === null || isRecord(feature.properties)) &&
        (feature.id === undefined ||
          typeof feature.id === "string" ||
          typeof feature.id === "number"),
    )
  );
}

function isEnrichment(value: unknown): value is ViewerEnrichmentEntry {
  if (!isRecord(value)) return false;
  if (value.description !== undefined && !isStringRecord(value.description)) return false;
  for (const field of ["hours", "phone", "website"]) {
    if (value[field] !== undefined && typeof value[field] !== "string") return false;
  }
  if (value.images === undefined) return true;
  return (
    Array.isArray(value.images) &&
    value.images.length <= 1 &&
    value.images.every(
      (image) =>
        isRecord(image) &&
        typeof image.src === "string" &&
        isStringRecord(image.alt),
    )
  );
}

function isWarning(value: unknown): value is ViewerWarning {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    WARNING_CODES.has(value.code) &&
    typeof value.message === "string" &&
    (value.featureId === undefined || typeof value.featureId === "string") &&
    (value.archiveEntry === undefined || typeof value.archiveEntry === "string")
  );
}

function hasUniqueTupleKeys(entries: [string, unknown][]): boolean {
  return new Set(entries.map(([key]) => key)).size === entries.length;
}

export async function writeVenueSnapshot(
  venue: LoadedVenue,
  sourceName: string,
): Promise<Blob> {
  if (sourceName.trim() === "" || sourceName.length > 200) {
    throw new ArchiveError("invalid_archive", "Snapshot sourceName must be 1-200 characters.");
  }
  const payload: SnapshotFile = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: "venue-snapshot",
    generatedAt: new Date().toISOString(),
    sourceName,
    venue: {
      manifest: venue.manifest,
      venue: venue.venue,
      levels: venue.levels,
      featuresById: [...venue.featuresById.entries()],
      renderFeaturesByLevel: [...venue.renderFeaturesByLevel.entries()],
      searchEntries: venue.searchEntries,
      boundsByLevel: [...venue.boundsByLevel.entries()],
      enrichmentByFeatureId: [...venue.enrichmentByFeatureId.entries()],
      warnings: venue.warnings,
    },
  };
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add(SNAPSHOT_ENTRY, new TextReader(JSON.stringify(payload)));
  return writer.close();
}

export async function readVenueSnapshot(data: Blob): Promise<LoadedVenue> {
  if (data.size > MAX_SNAPSHOT_BYTES) {
    throw new ArchiveError("archive_too_large", "The dataset snapshot exceeds 600 MiB.");
  }
  const reader = new ZipReader(new BlobReader(data), {
    checkSignature: true,
    checkOverlappingEntry: true,
    useWebWorkers: false,
  });
  let text: string;
  try {
    const entries: Entry[] = [];
    for await (const entry of reader.getEntriesGenerator()) {
      entries.push(entry);
      if (entries.length > MAX_SNAPSHOT_ENTRIES) {
        throw new ArchiveError("archive_too_large", "The dataset bundle has too many entries.");
      }
    }
    const matches = entries.filter((entry) => entry.filename === SNAPSHOT_ENTRY);
    if (matches.length === 0) {
      throw new ArchiveError(
        "missing_required_file",
        "The dataset bundle has no snapshot.json entry.",
      );
    }
    const [entry] = matches;
    if (matches.length !== 1 || entry === undefined || entry.directory) {
      throw new ArchiveError(
        "invalid_archive",
        "The dataset bundle must contain exactly one snapshot.json file.",
      );
    }
    if (entry.encrypted) {
      throw new ArchiveError("invalid_archive", "Encrypted dataset snapshots are not supported.");
    }
    if (entry.uncompressedSize > MAX_SNAPSHOT_BYTES) {
      throw new ArchiveError("archive_too_large", "The dataset snapshot exceeds 600 MiB.");
    }
    text = await entry.getData(new TextWriter());
  } catch (error) {
    if (error instanceof ArchiveError) {
      throw error;
    }
    throw new ArchiveError("invalid_archive", "The dataset bundle is not a readable ZIP.");
  } finally {
    await reader.close().catch(() => undefined);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new ArchiveError("invalid_json", "snapshot.json is not valid JSON.");
  }
  if (!isRecord(parsed)) {
    throw new ArchiveError("invalid_archive", "snapshot.json must contain an object.");
  }
  if (parsed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || parsed.kind !== "venue-snapshot") {
    throw new ArchiveError(
      "snapshot_version_mismatch",
      "Unsupported dataset snapshot version.",
      { schemaVersion: parsed.schemaVersion },
    );
  }
  if (
    typeof parsed.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(parsed.generatedAt)) ||
    typeof parsed.sourceName !== "string" ||
    parsed.sourceName.trim() === "" ||
    parsed.sourceName.length > 200
  ) {
    throw new ArchiveError("invalid_archive", "snapshot.json is missing required metadata.");
  }

  const venue = parsed.venue;
  if (
    !isRecord(venue) ||
    !isRecord(venue.manifest) ||
    venue.manifest.version !== "1.0.0" ||
    typeof venue.manifest.language !== "string" ||
    venue.manifest.language === "" ||
    !isViewerFeature(venue.venue) ||
    !Array.isArray(venue.levels) ||
    !venue.levels.every(isViewerLevel) ||
    new Set(venue.levels.map((level) => level.id)).size !== venue.levels.length ||
    !Array.isArray(venue.featuresById) ||
    !venue.featuresById.every(
      (entry) =>
        isStringTuple(entry) &&
        isViewerFeature(entry[1]) &&
        entry[0] === entry[1].id,
    ) ||
    !hasUniqueTupleKeys(venue.featuresById as [string, unknown][]) ||
    !Array.isArray(venue.renderFeaturesByLevel) ||
    !venue.renderFeaturesByLevel.every(
      (entry) => isStringTuple(entry) && isFeatureCollection(entry[1]),
    ) ||
    !hasUniqueTupleKeys(venue.renderFeaturesByLevel as [string, unknown][]) ||
    !Array.isArray(venue.searchEntries) ||
    !venue.searchEntries.every(isSearchEntry) ||
    !Array.isArray(venue.boundsByLevel) ||
    !venue.boundsByLevel.every(
      (entry) =>
        isStringTuple(entry) &&
        Array.isArray(entry[1]) &&
        entry[1].length === 4 &&
        entry[1].every(
          (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate),
        ),
    ) ||
    !hasUniqueTupleKeys(venue.boundsByLevel as [string, unknown][]) ||
    !Array.isArray(venue.enrichmentByFeatureId) ||
    !venue.enrichmentByFeatureId.every(
      (entry) => isStringTuple(entry) && isEnrichment(entry[1]),
    ) ||
    !hasUniqueTupleKeys(venue.enrichmentByFeatureId as [string, unknown][]) ||
    !Array.isArray(venue.warnings) ||
    !venue.warnings.every(isWarning)
  ) {
    throw new ArchiveError("invalid_archive", "snapshot.json is missing required venue fields.");
  }
  const serialized = venue as unknown as SerializedVenue;
  const featuresById = new Map(
    serialized.featuresById.map(
      ([id, feature]): [string, ViewerFeature] => [
        id,
        { ...feature, buildingId: feature.buildingId ?? null },
      ],
    ),
  );
  return {
    manifest: serialized.manifest,
    venue: serialized.venue,
    levels: serialized.levels,
    buildings: deriveVenueBuildings(featuresById),
    featuresById,
    renderFeaturesByLevel: new Map(serialized.renderFeaturesByLevel),
    searchEntries: serialized.searchEntries.map((entry) => ({
      ...entry,
      buildingId: entry.buildingId ?? null,
    })),
    boundsByLevel: new Map(serialized.boundsByLevel),
    enrichmentByFeatureId: new Map(serialized.enrichmentByFeatureId),
    warnings: serialized.warnings,
  };
}
