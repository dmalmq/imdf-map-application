/**
 * One selected layer converted to a WGS84 RFC7946 GeoJSON FeatureCollection.
 */
export interface GdbConvertedLayer {
  key: GdbLayerKey;
  featureCollection: GeoJSON.FeatureCollection;
  skippedGeometryCount: number;
}

/** Output of converting every included layer in a plan. */
export interface GdbConversionResult {
  layers: GdbConvertedLayer[];
  warnings: string[];
}

/**
 * Server-side File Geodatabase import contract. Shared shape between the
 * inspect endpoint (returns {@link GdbInspection}), the review UI (edits a
 * {@link GdbMappingPlan}), and the publish endpoint (consumes both).
 *
 * A layer is always identified by its {@link GdbLayerKey} (database id + layer
 * name), never by display name alone, because layer names repeat across the
 * multiple `.gdb` databases that can live inside one archive.
 *
 * Mirrors `src/gdb/types.ts` on the legacy branch, minus the browser-only
 * worker protocol and the `File`-bearing source descriptor.
 */

export type GdbGeometryFamily = "point" | "line" | "polygon" | "mixed" | "none";

/**
 * IMDF feature type a reviewed GDB layer is converted into. The same set the
 * IMDF importer accepts (see `FeatureType` in kiriko-model), restricted to the
 * kinds a GDB source can produce. `building` and `venue` are always
 * synthesized by the server, never selected here.
 */
export type GdbTargetType =
  | "level"
  | "unit"
  | "opening"
  | "detail"
  | "fixture"
  | "kiosk"
  | "amenity"
  | "occupant";

/** Stable identity for one inspected layer within one database. */
export interface GdbLayerKey {
  databaseId: string;
  layerName: string;
}

/** Canonical string form of a {@link GdbLayerKey} for use as a map key. */
export function gdbLayerKeyString(key: GdbLayerKey): string {
  return `${key.databaseId}\u0000${key.layerName}`;
}

export interface GdbFieldDescriptor {
  name: string;
  type: string;
}

export interface GdbLayerDescriptor {
  key: GdbLayerKey;
  databaseName: string;
  featureCount: number;
  geometryFamily: GdbGeometryFamily;
  fields: GdbFieldDescriptor[];
}

export interface GdbInspection {
  sourceName: string;
  databases: Array<{ id: string; name: string }>;
  layers: GdbLayerDescriptor[];
  warnings: string[];
}

export interface GdbBuildingPlan {
  id: string;
  name: string;
}

export type GdbLevelRule =
  | { kind: "source-reference"; field: string }
  | { kind: "property"; field: string }
  | { kind: "layer-name" }
  | { kind: "fixed"; label: string; ordinal: number };

export interface GdbLayerPlan {
  key: GdbLayerKey;
  included: boolean;
  targetType: GdbTargetType | null;
  buildingId: string | null;
  levelRule: GdbLevelRule | null;
  idField: string | null;
  ordinalField: string | null;
  shortNameField: string | null;
  nameField: string | null;
  categoryField: string | null;
}

export interface GdbMappingPlan {
  venueName: string;
  buildings: GdbBuildingPlan[];
  layers: GdbLayerPlan[];
}

/**
 * Response envelope for `POST /api/gdb/inspect`. `blobHash` references the
 * staged raw `.gdb.zip` in the blob store; the subsequent publish request
 * must echo it back so the server can re-open the archive for conversion
 * without holding per-session GDAL state.
 */
export interface GdbInspectResponse {
  blobHash: string;
  inspection: GdbInspection;
}

/** Payload for `POST /api/gdb/publish`. */
export interface GdbPublishRequest {
  venueId: number;
  blobHash: string;
  plan: GdbMappingPlan;
}
