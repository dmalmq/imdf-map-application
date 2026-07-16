/**
 * Shared worker/UI contract for the browser-only File Geodatabase import path.
 *
 * A layer is always identified by its {@link GdbLayerKey} (database id + layer
 * name), never by display name alone, because layer names repeat across the
 * multiple `.gdb` databases that make up one venue.
 */

export type GdbGeometryFamily = "point" | "line" | "polygon" | "mixed" | "none";

export type GdbTargetType =
  | "level"
  | "unit"
  | "opening"
  | "detail"
  | "fixture"
  | "kiosk"
  | "amenity"
  | "occupant";

/** A single selected browser file plus its normalized selection path. */
export interface GdbSourceFile {
  file: File;
  name: string;
  relativePath: string;
}

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

export interface GdbConvertedLayer {
  key: GdbLayerKey;
  featureCollection: GeoJSON.FeatureCollection;
  skippedGeometryCount: number;
}

export interface GdbConversionResult {
  layers: GdbConvertedLayer[];
  warnings: string[];
}

export type GdbWorkerRequest =
  | {
      id: number;
      type: "inspect";
      mode: "directory" | "archive";
      files: GdbSourceFile[];
    }
  | { id: number; type: "convert"; plan: GdbMappingPlan };

export type GdbWorkerErrorCode =
  | "invalid_geodatabase"
  | "gdb_too_large"
  | "gdb_conversion_failed";

export interface GdbWorkerError {
  code: GdbWorkerErrorCode;
  name: string;
  message: string;
  /**
   * Inspection/staging failures and actual worker events are fatal
   * (`recoverable: false`); a selected-layer export/mapping failure is
   * retryable within the same review session (`recoverable: true`).
   */
  recoverable: boolean;
  details?: Record<string, unknown>;
}

export type GdbWorkerResponse =
  | { id: number; ok: true; result: GdbInspection | GdbConversionResult }
  | { id: number; ok: false; error: GdbWorkerError };
