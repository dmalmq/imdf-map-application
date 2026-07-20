/**
 * Client mirror of the server GDB import API contract
 * (`server/src/gdb/types.ts`). Kept in sync by hand, exactly as
 * `src/gallery/api.ts` mirrors the venue/version response shapes.
 */
export type GdbGeometryFamily = "point" | "line" | "polygon" | "mixed" | "none";

export type GdbTargetType =
  | "level" | "unit" | "opening" | "detail" | "fixture" | "kiosk" | "amenity" | "occupant";

export interface GdbLayerKey {
  databaseId: string;
  layerName: string;
}

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

export interface GdbInspectResponse {
  blobHash: string;
  inspection: GdbInspection;
  suggestedPlan: GdbMappingPlan;
}
