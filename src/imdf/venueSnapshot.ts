import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
  configure,
} from "@zip.js/zip.js";
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

export async function writeVenueSnapshot(
  venue: LoadedVenue,
  sourceName: string,
): Promise<Blob> {
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
  const reader = new ZipReader(new BlobReader(data), {
    checkSignature: true,
    checkOverlappingEntry: true,
    useWebWorkers: false,
  });
  let text: string;
  try {
    const entries = await reader.getEntries();
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
    parsed.sourceName.trim() === ""
  ) {
    throw new ArchiveError("invalid_archive", "snapshot.json is missing required metadata.");
  }

  const venue = parsed.venue;
  if (
    !isRecord(venue) ||
    !isRecord(venue.manifest) ||
    !isRecord(venue.venue) ||
    !Array.isArray(venue.levels) ||
    !Array.isArray(venue.featuresById) ||
    !Array.isArray(venue.renderFeaturesByLevel) ||
    !Array.isArray(venue.searchEntries) ||
    !Array.isArray(venue.boundsByLevel) ||
    !Array.isArray(venue.enrichmentByFeatureId) ||
    !Array.isArray(venue.warnings) ||
    !venue.levels.every(isRecord) ||
    !venue.featuresById.every(
      (entry) => isStringTuple(entry) && isRecord(entry[1]),
    ) ||
    !venue.renderFeaturesByLevel.every(
      (entry) => isStringTuple(entry) && isRecord(entry[1]),
    ) ||
    !venue.searchEntries.every(isRecord) ||
    !venue.boundsByLevel.every(
      (entry) =>
        isStringTuple(entry) &&
        Array.isArray(entry[1]) &&
        entry[1].length === 4 &&
        entry[1].every(
          (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate),
        ),
    ) ||
    !venue.enrichmentByFeatureId.every(
      (entry) => isStringTuple(entry) && isRecord(entry[1]),
    ) ||
    !venue.warnings.every(isRecord)
  ) {
    throw new ArchiveError("invalid_archive", "snapshot.json is missing required venue fields.");
  }
  const serialized = venue as unknown as SerializedVenue;
  return {
    manifest: serialized.manifest,
    venue: serialized.venue,
    levels: serialized.levels,
    featuresById: new Map(serialized.featuresById),
    renderFeaturesByLevel: new Map(serialized.renderFeaturesByLevel),
    searchEntries: serialized.searchEntries,
    boundsByLevel: new Map(serialized.boundsByLevel),
    enrichmentByFeatureId: new Map(serialized.enrichmentByFeatureId),
    warnings: serialized.warnings,
  };
}
