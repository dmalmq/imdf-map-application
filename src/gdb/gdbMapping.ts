/**
 * Pure, cross-version mapping suggestions for the browser-only File Geodatabase
 * import path. Given a {@link GdbInspection}, {@link suggestGdbMapping} produces
 * an editable {@link GdbMappingPlan}: target-type guesses driven by layer-name
 * suffix/token aliases and geometry, structured building groups, and field
 * aliases. All logic is alias/geometry/field driven and never station-specific.
 *
 * `buildGdbVenue` converts the reviewed, WGS84 GeoJSON layers into the existing
 * {@link LoadedVenue} model by constructing a trusted {@link ParsedImdfArchive}
 * and delegating to the unchanged {@link normalizeVenue}. GDB data never passes
 * through the strict Apple IMDF archive validation.
 */
import { ArchiveError, archiveErrorCopy } from "../errors/ArchiveError";
import { normalizeVenue } from "../imdf/normalizeVenue";
import type {
  FeatureType,
  LoadedVenue,
  ParsedImdfArchive,
  ViewerWarning,
} from "../imdf/types";
import type {
  GdbBuildingPlan,
  GdbConversionResult,
  GdbConvertedLayer,
  GdbFieldDescriptor,
  GdbGeometryFamily,
  GdbInspection,
  GdbLayerDescriptor,
  GdbLayerPlan,
  GdbLevelRule,
  GdbMappingPlan,
  GdbTargetType,
} from "./types";
import { gdbLayerKeyString } from "./types";

/** All target types, in a stable order for dropdown rendering. */
export const GDB_TARGET_TYPES: readonly GdbTargetType[] = [
  "level",
  "unit",
  "opening",
  "detail",
  "fixture",
  "kiosk",
  "amenity",
  "occupant",
];

/** Geometry family each target type requires. */
const GEOMETRY_REQUIREMENT: Record<GdbTargetType, GdbGeometryFamily> = {
  level: "polygon",
  unit: "polygon",
  fixture: "polygon",
  kiosk: "polygon",
  opening: "line",
  detail: "line",
  amenity: "point",
  occupant: "point",
};

/**
 * True when a target type may be assigned to a layer of the given geometry
 * family. `mixed`/`none` never satisfy any target type.
 */
export function isGdbTargetGeometryCompatible(
  type: GdbTargetType,
  family: GdbGeometryFamily,
): boolean {
  return GEOMETRY_REQUIREMENT[type] === family;
}

/** Target types selectable for a layer with the given geometry family. */
export function gdbTargetTypesForGeometry(
  family: GdbGeometryFamily,
): GdbTargetType[] {
  return GDB_TARGET_TYPES.filter((type) => isGdbTargetGeometryCompatible(type, family));
}

// ---------------------------------------------------------------------------
// Floor ordinal parsing (extends C:/Repositories/cesium/src/floorSplit.js)
// ---------------------------------------------------------------------------

/** floor number -> textual forms, mirroring the proven Cesium parser. */
function buildFloorSynonyms(): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (let n = 1; n <= 60; n++) {
    const variants = [`${n}f`, `f${n}`, `${n}\u968e`, `${n}fl`, `${n}floor`, `floor${n}`, `${n}`];
    if (n === 1) variants.push("gf", `g\u968e`, "ground");
    map.set(n, variants);
  }
  for (let n = 1; n <= 10; n++) {
    map.set(-n, [
      `b${n}`, `b${n}f`, `b${n}fl`, `b${n}floor`,
      `${n}b`, `bf${n}`,
      `\u5730\u4e0b${n}\u968e`, `\u5730\u4e0b${n}f`, `\u5730\u4e0b${n}fl`,
      `basement${n}`,
    ]);
  }
  // Structured ground/zero tokens: "0", "F0", "0F".
  map.set(0, ["0", "f0", "0f", "0fl", "0floor", "floor0"]);
  return map;
}

const SYNONYM_LOOKUP: Map<string, number> = (() => {
  const lookup = new Map<string, number>();
  for (const [num, variants] of buildFloorSynonyms()) {
    for (const v of variants) lookup.set(v.toLowerCase(), num);
  }
  return lookup;
})();

/**
 * Map a single separator-free token to a source floor ordinal, extending the
 * base synonym table with the observed `KB3`/`SB4` basement aliases and the
 * `M2` mezzanine-as-positive-ordinal convention. `R`/`RF` deliberately return
 * null: a roof ordinal must come from a source level feature or a user-entered
 * fixed ordinal, never be invented.
 */
function parseFloorToken(token: string): number | null {
  const direct = SYNONYM_LOOKUP.get(token);
  if (direct !== undefined) return direct;
  // Mezzanine: M2 -> 2 (matches the observed source level ordinal).
  const mezz = /^m(\d+)$/.exec(token);
  if (mezz) return Number(mezz[1]);
  // Alphabetic prefix immediately before B<number> is a basement alias:
  // KB3 / SB3 -> -3, SB4F -> -4.
  const basement = /^[a-z]+b(\d+)f?$/.exec(token);
  if (basement) return -Number(basement[1]);
  return null;
}

/**
 * Parse a source floor value or floor-bearing layer name into a source floor
 * ordinal. Accepts a finite number directly.
 *
 * Ported safeguard from cesium `shortLevelName`/`levelNameToNumber`: the real
 * floor designation lives in the LEADING token, so it is parsed first and wins
 * outright. This prevents appended metadata such as `"(TP-5.11)"` from letting
 * its bare digits win — `"B2FL(1FL)_…(TP-5.11)"` resolves to `-2`, never `5`.
 * The leading token is split on underscore, whitespace, half/full-width open
 * parens, and the full-width (U+3000) space. When it does not resolve, the
 * parser falls back to the longest resolving token across `_-\s.`.
 */
export function extractGdbFloorOrdinal(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const leading = text.split(/[_\s（(\u3000]+/, 1)[0];
  if (leading) {
    const leadingOrdinal = parseFloorToken(leading.toLowerCase());
    if (leadingOrdinal !== null) return leadingOrdinal;
  }
  const tokens = text
    .toLowerCase()
    .split(/[_\-\s.]+/)
    .filter(Boolean);
  if (!tokens.length) return null;
  const ordered = [...tokens].sort((a, b) => b.length - a.length);
  for (const token of ordered) {
    const parsed = parseFloorToken(token);
    if (parsed !== null) return parsed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// UUID normalization
// ---------------------------------------------------------------------------

const HYPHENATED_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX32_UUID = /^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/i;

/**
 * Normalize a raw source id to canonical UUIDv4 form. A valid hyphenated
 * UUIDv4 (version nibble 4, RFC variant [89ab]) is preserved (lowercased); a
 * 32-hex UUIDv4 is hyphenated; any other value (UUIDv1, wrong variant, or
 * non-UUID) returns null so the caller can allocate a fresh UUIDv4.
 */
export function normalizeGdbUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (HYPHENATED_UUID.test(trimmed)) return trimmed.toLowerCase();
  if (HEX32_UUID.test(trimmed)) {
    const h = trimmed.toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Target-type inference
// ---------------------------------------------------------------------------

interface TargetGuess {
  type: GdbTargetType | null;
  /** Cross-floor `_to_` edge: keep the guess but default excluded. */
  crossFloor: boolean;
}

/**
 * Infer a target type from the complete layer-name suffix/token, honoring both
 * the Tokyo (`_Floor`/`_Space`/`_Drawing`) and Shinjuku
 * (`_level`/`_unit`/`_detail`) conventions, case-insensitively.
 */
function inferTargetType(layerName: string): TargetGuess {
  const lower = layerName.toLowerCase();
  const ends = (suffix: string) => lower.endsWith(suffix);
  const crossFloor = lower.includes("_to_");

  let type: GdbTargetType | null = null;
  if (ends("_floor") || ends("_level")) type = "level";
  else if (ends("_space") || ends("_unit")) type = "unit";
  else if (ends("_opening")) type = "opening";
  else if (ends("_drawing") || ends("_detail") || ends("_nw")) type = "detail";
  else if (ends("_fixture")) type = "fixture";
  else if (
    ends("_facility") ||
    ends("_amenity") ||
    lower === "facility_merge" ||
    lower.startsWith("point_facility") ||
    lower === "wifi" ||
    lower === "beacon" ||
    lower === "net_junction"
  ) {
    type = "amenity";
  } else if (ends("_occupant")) type = "occupant";
  else if (lower === "net_path" || /_link$/.test(lower)) type = "detail";

  // A cross-floor edge retains the suggested `detail` type but is excluded.
  if (crossFloor) type = "detail";

  return { type, crossFloor };
}

// ---------------------------------------------------------------------------
// Structured building inference
// ---------------------------------------------------------------------------

const STRUCTURED_NAME =
  /^(.*)_(B\d+|M\d+|F?\d+|R|RF|0)_(Drawing|Fixture|Floor|Space|Opening|Facility|Occupant|detail|fixture|level|unit|opening|amenity|occupant)$/i;

// The building-name prefix is capture group 1 of STRUCTURED_NAME; the floor
// token is capture group 2.

/**
 * Resolve a layer-name floor ordinal from ONLY the structured floor token
 * (STRUCTURED_NAME capture group 2), never arbitrary digits elsewhere in the
 * name. `Station_2_R_level` -> null (token `R`); `Station_2_0_level` -> 0.
 * Shared by suggestion, dialog validation, and Step 3 conversion.
 */
export function structuredFloorOrdinal(layerName: string): number | null {
  const match = STRUCTURED_NAME.exec(layerName);
  if (!match) return null;
  return extractGdbFloorOrdinal(match[2]);
}

/**
 * Resolve a floor ordinal from a layer name for conversion/validation parity.
 * Structured names use ONLY the structured floor token (so `Station_2_R_level`
 * stays null — never fall back to prefix digits). Non-structured names use the
 * loose cesium token parse (`ShinjukuYodobashi_Camera_1_nw` → 1,
 * `ShinjukuSt_B1_link` → -1). Shared by dialog validation and buildGdbVenue.
 */
export function layerNameFloorOrdinal(layerName: string): number | null {
  if (STRUCTURED_NAME.test(layerName)) return structuredFloorOrdinal(layerName);
  return extractGdbFloorOrdinal(layerName);
}


// ---------------------------------------------------------------------------
// Field alias detection
// ---------------------------------------------------------------------------

/** First descriptor field (case-insensitively) matching any candidate name. */
function findField(
  fields: readonly GdbFieldDescriptor[],
  candidates: readonly string[],
): string | null {
  for (const candidate of candidates) {
    const found = fields.find((field) => field.name.toLowerCase() === candidate.toLowerCase());
    if (found) return found.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// suggestGdbMapping
// ---------------------------------------------------------------------------

function suggestLayerPlan(
  layer: GdbLayerDescriptor,
  buildingIdByPrefix: ReadonlyMap<string, string>,
): GdbLayerPlan {
  const name = layer.key.layerName;
  const fields = layer.fields;
  const family = layer.geometryFamily;
  const { type: guessed, crossFloor } = inferTargetType(name);

  const idField = findField(fields, ["id", "uuid"]);
  const nameField = findField(fields, ["name", "\u540d\u79f0"]);
  const categoryField = findField(fields, ["category"]);
  const ordinalField = findField(fields, ["ordinal"]);
  const shortNameField = findField(fields, ["short_name"]);

  const levelIdField = findField(fields, ["level_id"]);
  const floorIdField = findField(fields, ["floor_id"]);
  const floorField = findField(fields, ["floor"]);
  const layerToken = structuredFloorOrdinal(name) !== null;

  // Geometry gating: null out a guessed type that the geometry cannot support.
  let targetType: GdbTargetType | null = guessed;
  let included = false;
  if (family === "mixed" || family === "none") {
    targetType = null;
  } else if (targetType !== null) {
    if (!isGdbTargetGeometryCompatible(targetType, family)) {
      targetType = null;
    } else {
      included = layer.featureCount > 0 && !crossFloor;
    }
  }

  // Level rule precedence.
  let levelRule: GdbLevelRule | null = null;
  if (targetType === "level") {
    // A level layer defines levels; it does not reference another level.
    if (floorField) levelRule = { kind: "property", field: floorField };
    else if (layerToken) levelRule = { kind: "layer-name" };
  } else if (targetType !== null) {
    if (levelIdField) levelRule = { kind: "source-reference", field: levelIdField };
    else if (floorIdField) levelRule = { kind: "source-reference", field: floorIdField };
    else if (floorField) levelRule = { kind: "property", field: floorField };
    else if (layerToken) levelRule = { kind: "layer-name" };
  }

  // Building assignment. Every row keeps its structured-prefix building when
  // one was detected — including source-reference rows, so a later building
  // rename does not break a blank/dangling floor fallback. A flat POI layer
  // (no structured prefix, e.g. Facility_Merge) stays null and inherits its
  // building from the resolved level.
  const prefix = STRUCTURED_NAME.exec(name)?.[1] ?? null;
  const structuredBuildingId = prefix ? (buildingIdByPrefix.get(prefix.toLowerCase()) ?? null) : null;
  const buildingId: string | null = targetType === null ? null : structuredBuildingId;

  return {
    key: layer.key,
    included,
    targetType,
    buildingId,
    levelRule,
    idField,
    ordinalField,
    shortNameField,
    nameField,
    categoryField,
  };
}

/**
 * Build an editable {@link GdbMappingPlan} from an inspection: an editable
 * venue name, sorted structured building groups, and one suggested layer plan
 * per inspected layer.
 */
export function suggestGdbMapping(inspection: GdbInspection): GdbMappingPlan {
  // Collect unique structured building prefixes (case-insensitive), keeping the
  // first-seen original spelling for display.
  const prefixDisplay = new Map<string, string>();
  for (const layer of inspection.layers) {
    const prefix = STRUCTURED_NAME.exec(layer.key.layerName)?.[1] ?? null;
    if (prefix === null) continue;
    const key = prefix.toLowerCase();
    if (!prefixDisplay.has(key)) prefixDisplay.set(key, prefix);
  }

  const sortedKeys = [...prefixDisplay.keys()].sort();
  const buildings: GdbBuildingPlan[] = sortedKeys.map((key, index) => ({
    id: `building-${index + 1}`,
    name: prefixDisplay.get(key) as string,
  }));

  const buildingIdByPrefix = new Map<string, string>();
  sortedKeys.forEach((key, index) => buildingIdByPrefix.set(key, `building-${index + 1}`));

  const layers = inspection.layers.map((layer) => suggestLayerPlan(layer, buildingIdByPrefix));

  return {
    venueName: inspection.sourceName
      .replace(/\.gdb\.zip$/i, "")
      .replace(/\.gdb$/i, "")
      .replace(/\.zip$/i, ""),
    buildings,
    layers,
  };
}

// ---------------------------------------------------------------------------
// buildGdbVenue: reviewed GeoJSON -> LoadedVenue
// ---------------------------------------------------------------------------

/** Padding for a zero-width/zero-height synthesized rectangle side (degrees). */
const SYNTHETIC_PADDING = 0.000001;

/** The three metadata keys appended to every converted feature's properties. */
const GDB_META_DATABASE = "__gdb_database";
const GDB_META_LAYER = "__gdb_layer";
const GDB_META_RESOLVED_LEVEL = "__gdb_resolved_level_id";

type SpatialFamily = "point" | "line" | "polygon";

interface MutableBounds {
  west: number;
  south: number;
  east: number;
  north: number;
  found: boolean;
}

interface LevelRecord {
  id: string;
  ordinal: number;
  buildingUuid: string;
  geometry: GeoJSON.Geometry | null;
  transient: Record<string, unknown>;
  original: Record<string, unknown> | null;
  databaseId: string;
  layerName: string;
  synthetic: boolean;
}

interface NonLevelRecord {
  id: string;
  featureType: FeatureType;
  geometry: GeoJSON.Geometry;
  transient: Record<string, unknown>;
  original: Record<string, unknown>;
  databaseId: string;
  layerName: string;
  levelUuid: string;
  buildingUuid: string;
}

/** Fail conversion with the fixed corrective copy plus diagnostic details. */
function conversionFailed(reason: string, details?: Record<string, unknown>): never {
  throw new ArchiveError("gdb_conversion_failed", archiveErrorCopy.gdb_conversion_failed, {
    reason,
    ...details,
  });
}

/**
 * A UUIDv4 guaranteed absent from `used`, retrying on the (astronomically
 * rare, but test-mockable) event of a `crypto.randomUUID` collision. The
 * returned id is recorded in `used` so every generated venue/building/level/
 * feature id stays globally unique.
 */
function freshUuid(used: Set<string>): string {
  let id = crypto.randomUUID();
  while (used.has(id)) id = crypto.randomUUID();
  used.add(id);
  return id;
}

/** Non-empty string form of a source value; numbers stringify, else null. */
function coerceString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Spatial family of a geometry, or null for empty/unsupported geometry. */
function geometryFamily(geometry: GeoJSON.Geometry): SpatialFamily | null {
  switch (geometry.type) {
    case "Point":
    case "MultiPoint":
      return "point";
    case "LineString":
    case "MultiLineString":
      return "line";
    case "Polygon":
    case "MultiPolygon":
      return "polygon";
    default:
      return null;
  }
}

/**
 * Coerce a feature geometry to the layer's required spatial family. A plain
 * (non-collection) geometry passes through unchanged so a genuine family
 * mismatch is still caught by the caller. A `GeometryCollection` is shallow-
 * flattened to its finite members of the required family (nested collections
 * are non-matching): a single match is returned as-is, several matches merge
 * into one `Multi*`. Any finite spatial member of another family is
 * incompatible and fails conversion rather than being silently dropped.
 * Empty/nonfinite members are geometry-less and ignored. No matching finite
 * member yields `null` (geometry-less), so a `GeometryCollection` never
 * reaches MapLibre/geojson-vt.
 */
/**
 * Diagnostic context identifying the selected source feature whose
 * {@link normalizeGeometryForFamily} coercion fails, so a strict
 * `gdb_conversion_failed` names the exact layer/feature instead of only the
 * geometry family mismatch. `featureId` is the stable GeoJSON feature id when
 * present; otherwise `featureIndex` locates it by position in the layer.
 */
interface GeometryFailureContext {
  databaseId: string;
  layerName: string;
  targetType: GdbTargetType;
  featureId: string | number | null;
  featureIndex: number;
}

function normalizeGeometryForFamily(
  geometry: GeoJSON.Geometry,
  family: SpatialFamily,
  context: GeometryFailureContext,
): GeoJSON.Geometry | null {
  if (geometry.type !== "GeometryCollection") return geometry;
  const members: GeoJSON.Geometry[] = [];
  for (const member of geometry.geometries) {
    // Null/empty/nonfinite members contribute no spatial data and may skip.
    if (!geometryIsSpatiallyFinite(member)) continue;
    // Any finite spatial member outside the required family is a hard
    // conversion failure for the selected feature (no partial truncation).
    if (geometryFamily(member) !== family) {
      conversionFailed("incompatible GeometryCollection member family", {
        requiredFamily: family,
        memberType: member.type,
        databaseId: context.databaseId,
        layerName: context.layerName,
        targetType: context.targetType,
        ...(context.featureId !== null
          ? { featureId: context.featureId }
          : { featureIndex: context.featureIndex }),
      });
    }
    members.push(member);
  }
  if (members.length === 0) return null;
  if (members.length === 1) return members[0] ?? null;
  if (family === "polygon") {
    const coordinates: GeoJSON.Position[][][] = [];
    for (const member of members) {
      if (member.type === "Polygon") coordinates.push(member.coordinates);
      else if (member.type === "MultiPolygon") coordinates.push(...member.coordinates);
    }
    return { type: "MultiPolygon", coordinates };
  }
  if (family === "line") {
    const coordinates: GeoJSON.Position[][] = [];
    for (const member of members) {
      if (member.type === "LineString") coordinates.push(member.coordinates);
      else if (member.type === "MultiLineString") coordinates.push(...member.coordinates);
    }
    return { type: "MultiLineString", coordinates };
  }
  const coordinates: GeoJSON.Position[] = [];
  for (const member of members) {
    if (member.type === "Point") coordinates.push(member.coordinates);
    else if (member.type === "MultiPoint") coordinates.push(...member.coordinates);
  }
  return { type: "MultiPoint", coordinates };
}

/** True when the geometry recursively contains ≥1 finite lon/lat pair. */
function geometryIsSpatiallyFinite(geometry: GeoJSON.Geometry): boolean {
  if (geometry.type === "GeometryCollection") {
    for (const nested of geometry.geometries) {
      if (geometryIsSpatiallyFinite(nested)) return true;
    }
    return false;
  }
  return boundsOf([geometry]) !== null;
}

/** Extend the running bounds with every finite position in the geometry. */
function extendBounds(bounds: MutableBounds, geometry: GeoJSON.Geometry): void {
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") {
      const lon = value[0];
      const lat = value[1];
      if (typeof lat === "number" && Number.isFinite(lon) && Number.isFinite(lat)) {
        bounds.west = Math.min(bounds.west, lon);
        bounds.south = Math.min(bounds.south, lat);
        bounds.east = Math.max(bounds.east, lon);
        bounds.north = Math.max(bounds.north, lat);
        bounds.found = true;
      }
      return;
    }
    for (const nested of value) visit(nested);
  };
  if (geometry.type === "GeometryCollection") {
    for (const nested of geometry.geometries ?? []) extendBounds(bounds, nested);
    return;
  }
  visit(geometry.coordinates);
}

/** Bounding box of every finite coordinate across the geometries, or null. */
function boundsOf(geometries: readonly (GeoJSON.Geometry | null)[]): MutableBounds | null {
  const bounds: MutableBounds = {
    west: Infinity,
    south: Infinity,
    east: -Infinity,
    north: -Infinity,
    found: false,
  };
  for (const geometry of geometries) {
    if (geometry !== null) extendBounds(bounds, geometry);
  }
  return bounds.found ? bounds : null;
}

/** Rectangle polygon from bounds, padding any zero-width/height side. */
function rectanglePolygon(bounds: MutableBounds): GeoJSON.Polygon {
  let { west, south, east, north } = bounds;
  if (east <= west) east = west + SYNTHETIC_PADDING;
  if (north <= south) north = south + SYNTHETIC_PADDING;
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

/** True when (px,py) lies on the segment a-b (with a small tolerance). */
function onSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const lengthSq = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
  // A zero-length (degenerate) segment — e.g. a ring's duplicated closing
  // vertex — only contains the point when they coincide.
  if (lengthSq === 0) return px === ax && py === ay;
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (Math.abs(cross) > 1e-12) return false;
  const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
  if (dot < 0) return false;
  return dot <= lengthSq;
}

/** Ray-cast strictly-interior test for a single ring (boundary excluded). */
function rayCastInside(px: number, py: number, ring: GeoJSON.Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    if (xi === undefined || yi === undefined || xj === undefined || yj === undefined) continue;
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when (px,py) is on any edge of the ring. */
function onRingEdge(px: number, py: number, ring: GeoJSON.Position[]): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) continue;
    const [ax, ay] = a;
    const [bx, by] = b;
    if (ax === undefined || ay === undefined || bx === undefined || by === undefined) continue;
    if (onSegment(px, py, ax, ay, bx, by)) return true;
  }
  return false;
}

/**
 * Point-in-polygon with holes respected and the boundary treated as inside:
 * inside the outer ring (or on its edge) and not strictly inside any hole (a
 * point on a hole edge stays inside).
 */
function pointInPolygon(px: number, py: number, rings: GeoJSON.Position[][]): boolean {
  const outer = rings[0];
  if (outer === undefined || outer.length === 0) return false;
  if (!onRingEdge(px, py, outer) && !rayCastInside(px, py, outer)) return false;
  for (let h = 1; h < rings.length; h++) {
    const hole = rings[h];
    if (hole === undefined) continue;
    if (!onRingEdge(px, py, hole) && rayCastInside(px, py, hole)) return false;
  }
  return true;
}

/** True when the point lies within a Polygon or MultiPolygon geometry. */
function pointInGeometry(px: number, py: number, geometry: GeoJSON.Geometry): boolean {
  if (geometry.type === "Polygon") return pointInPolygon(px, py, geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((rings) => pointInPolygon(px, py, rings));
  }
  return false;
}

/**
 * Coordinate of a single GeoJSON `Point`, else null. The spatial containment
 * fallback is deliberately Point-only: a `MultiPoint` has no single defensible
 * location, so it must not be placed spatially and defers/hard-fails instead.
 */
function pointCoordinate(geometry: GeoJSON.Geometry): [number, number] | null {
  if (geometry.type !== "Point") return null;
  const [x, y] = geometry.coordinates;
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)
    ? [x, y]
    : null;
}

/**
 * Resolve a level feature's ordinal: an explicit ordinal field, then a
 * property/fixed level rule, then the short-name, name, or layer-name token.
 * `R`/`RF` without any of these stays null so no roof ordinal is invented.
 */
function resolveLevelOrdinal(
  plan: GdbLayerPlan,
  props: Record<string, unknown>,
): number | null {
  if (plan.ordinalField) {
    const raw = props[plan.ordinalField];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const parsed = extractGdbFloorOrdinal(raw);
    if (parsed !== null) return parsed;
  }
  const rule = plan.levelRule;
  if (rule?.kind === "property") {
    const parsed = extractGdbFloorOrdinal(props[rule.field]);
    if (parsed !== null) return parsed;
  }
  if (rule?.kind === "fixed") return Number.isFinite(rule.ordinal) ? rule.ordinal : null;
  if (plan.shortNameField) {
    const parsed = extractGdbFloorOrdinal(props[plan.shortNameField]);
    if (parsed !== null) return parsed;
  }
  if (plan.nameField) {
    const parsed = extractGdbFloorOrdinal(props[plan.nameField]);
    if (parsed !== null) return parsed;
  }
  return layerNameFloorOrdinal(plan.key.layerName);
}

/**
 * Convert the reviewed WGS84 GeoJSON layers into a {@link LoadedVenue}. All
 * selected layers are processed together so references cross GDB boundaries
 * (POI `floor_id` values resolve to architecture-database level ids). Every
 * failure surfaces as {@link ArchiveError}`("gdb_conversion_failed", ...)`.
 */
export function buildGdbVenue(
  conversion: GdbConversionResult,
  plan: GdbMappingPlan,
): LoadedVenue {
  const convertedByKey = new Map<string, GdbConvertedLayer>();
  for (const layer of conversion.layers) {
    convertedByKey.set(gdbLayerKeyString(layer.key), layer);
  }

  const included = plan.layers.filter((layer) => layer.included);
  if (included.length === 0) {
    conversionFailed("no included layers");
  }

  // Validate every included layer resolves to a converted layer and a target.
  for (const layer of included) {
    if (!convertedByKey.has(gdbLayerKeyString(layer.key))) {
      conversionFailed("missing converted layer", { layer: layer.key.layerName });
    }
    if (layer.targetType === null) {
      conversionFailed("included layer without target type", { layer: layer.key.layerName });
    }
  }

  // Pre-count normalized valid source UUIDs across EVERY selected feature
  // (level and non-level). A UUID appearing more than once anywhere is not
  // globally unique, so every occurrence is reassigned a fresh id; only a
  // count-one UUID may be preserved. Count-one UUIDs are reserved up front so
  // generated venue/building/synthetic ids cannot consume them first.
  const sourceUuidCounts = new Map<string, number>();
  for (const layer of included) {
    if (layer.targetType === null || layer.idField === null) continue;
    const converted = convertedByKey.get(gdbLayerKeyString(layer.key))!;
    for (const feature of converted.featureCollection.features) {
      const rawId = coerceString((feature.properties ?? {})[layer.idField]);
      const normalized = rawId !== null ? normalizeGdbUuid(rawId) : null;
      if (normalized !== null) {
        sourceUuidCounts.set(normalized, (sourceUuidCounts.get(normalized) ?? 0) + 1);
      }
    }
  }
  const reservedSourceUuids = new Set<string>();
  for (const [uuid, count] of sourceUuidCounts) {
    if (count === 1) reservedSourceUuids.add(uuid);
  }

  // usedIds seeds with the reserved source UUIDs so freshUuid never generates
  // an id that a count-one source feature will later preserve.
  const usedIds = new Set<string>(reservedSourceUuids);
  const buildingUuidById = new Map<string, string>();
  for (const building of plan.buildings) {
    buildingUuidById.set(building.id, freshUuid(usedIds));
  }
  const venueUuid = freshUuid(usedIds);

  const rawLevelMap = new Map<string, string>();
  const importedLevelByBuildingOrdinal = new Map<string, string>();
  const syntheticLevelByKey = new Map<string, string>();
  const levelBuildingByUuid = new Map<string, string>();
  const levelRecords: LevelRecord[] = [];
  const nonLevelRecords: NonLevelRecord[] = [];
  const conversionWarnings: ViewerWarning[] = [];

  const requiredBuildingUuid = (layer: GdbLayerPlan): string => {
    if (layer.buildingId === null) {
      conversionFailed("row without building", { layer: layer.key.layerName });
    }
    const uuid = buildingUuidById.get(layer.buildingId);
    if (uuid === undefined) {
      conversionFailed("unknown building id", {
        layer: layer.key.layerName,
        buildingId: layer.buildingId,
      });
    }
    return uuid;
  };

  // Ambiguity pre-scan: canonical duplicate raw level ids must fail across
  // EVERY selected level feature, before geometry filtering, so a finite level
  // and a coordinate-empty level sharing one raw id are rejected even though
  // the empty one is later skipped spatially.
  const seenLevelCanonical = new Set<string>();
  for (const layer of included) {
    if (layer.targetType !== "level") continue;
    const converted = convertedByKey.get(gdbLayerKeyString(layer.key))!;
    for (const feature of converted.featureCollection.features) {
      const rawId = coerceString(
        layer.idField ? (feature.properties ?? {})[layer.idField] : undefined,
      );
      if (rawId === null) continue;
      const canonicalKey = normalizeGdbUuid(rawId) ?? rawId;
      if (seenLevelCanonical.has(canonicalKey)) {
        conversionFailed("ambiguous duplicate raw level id", {
          layer: layer.key.layerName,
          rawLevelId: rawId,
        });
      }
      seenLevelCanonical.add(canonicalKey);
    }
  }

  // ---- Phase 1: levels + the global raw-level-id map ----------------------
  for (const layer of included) {
    if (layer.targetType !== "level") continue;
    const converted = convertedByKey.get(gdbLayerKeyString(layer.key))!;
    const features = converted.featureCollection.features;
    const buildingUuid = requiredBuildingUuid(layer);
    let spatial = 0;
    for (const [featureIndex, feature] of features.entries()) {
      const rawGeometry = feature.geometry;
      if (rawGeometry === null) continue;
      // Flatten a GeometryCollection to the polygon family; a plain geometry
      // passes through so a real family mismatch still fails below.
      const geometry = normalizeGeometryForFamily(rawGeometry, "polygon", {
        databaseId: layer.key.databaseId,
        layerName: layer.key.layerName,
        targetType: "level",
        featureId: feature.id ?? null,
        featureIndex,
      });
      const fam = geometry === null ? null : geometryFamily(geometry);
      // No polygon member, unknown type, or no finite coordinate pair is
      // geometry-less and skipped before the spatial count.
      if (geometry === null || fam === null || boundsOf([geometry]) === null) continue;
      if (fam !== "polygon") {
        conversionFailed("incompatible level geometry", { layer: layer.key.layerName });
      }
      spatial += 1;
      const props = feature.properties ?? {};
      const ordinal = resolveLevelOrdinal(layer, props);
      if (ordinal === null) {
        conversionFailed("unresolved level ordinal", { layer: layer.key.layerName });
      }
      const rawId = coerceString(layer.idField ? props[layer.idField] : undefined);
      const normalized = rawId !== null ? normalizeGdbUuid(rawId) : null;
      // Canonical key collapses equivalent UUIDv4 forms (32-hex/hyphenated/
      // case) so a POI reference in either form resolves to this level. The
      // pre-scan above already rejected canonical duplicates, so rawLevelMap
      // is populated only for spatial (kept) level records.
      const canonicalKey = rawId !== null ? (normalized ?? rawId) : null;
      let id: string;
      if (normalized !== null && reservedSourceUuids.has(normalized)) {
        id = normalized;
        usedIds.add(id);
      } else {
        id = freshUuid(usedIds);
      }
      if (canonicalKey !== null) rawLevelMap.set(canonicalKey, id);
      const boKey = `${buildingUuid}\u0000${ordinal}`;
      if (!importedLevelByBuildingOrdinal.has(boKey)) {
        importedLevelByBuildingOrdinal.set(boKey, id);
      }
      levelBuildingByUuid.set(id, buildingUuid);

      const name = coerceString(layer.nameField ? props[layer.nameField] : undefined);
      const shortName = coerceString(
        layer.shortNameField ? props[layer.shortNameField] : undefined,
      );
      // Imported levels with no mapped name/short name display the fixed,
      // property, or structured floor label (B1/F1/RF) rather than the numeric
      // ordinal, so a layer-derived B1 never renders as "-1".
      let floorLabel: string | null;
      if (layer.levelRule?.kind === "fixed") floorLabel = layer.levelRule.label;
      else if (layer.levelRule?.kind === "property") {
        floorLabel = coerceString(props[layer.levelRule.field]);
      } else {
        floorLabel = STRUCTURED_NAME.exec(layer.key.layerName)?.[2] ?? null;
      }
      const original = { ...props };
      const label = name ?? shortName ?? floorLabel ?? String(ordinal);
      const transient: Record<string, unknown> = {
        ...original,
        name: { ja: label },
        short_name: { ja: shortName ?? label },
        ordinal,
        building_ids: [buildingUuid],
      };
      // Unmapped GDB restriction/accessibility codes stay in sourceProperties
      // (restored below) but must not drive IMDF restriction/render semantics.
      delete transient.restriction;
      delete transient.accessibility;
      levelRecords.push({
        id,
        ordinal,
        buildingUuid,
        geometry,
        transient,
        original,
        databaseId: layer.key.databaseId,
        layerName: layer.key.layerName,
        synthetic: false,
      });
    }
    if (features.length === 0 || spatial === 0) {
      conversionFailed("empty or geometry-less level layer", { layer: layer.key.layerName });
    }
  }

  // Resolve a (building, ordinal) to an imported level (reused regardless of
  // label) or a synthetic level keyed by building + ordinal + normalized label,
  // so co-ordinal labels stay distinct. Shared by the property/fixed/layer-name
  // rules and the empty-source-reference fallback.
  const resolveOrCreateLevel = (
    buildingUuid: string,
    ordinal: number,
    label: string | null,
  ): string => {
    const imported = importedLevelByBuildingOrdinal.get(`${buildingUuid}\u0000${ordinal}`);
    if (imported !== undefined) return imported;
    const synthLabel = label ?? String(ordinal);
    const synthKey = `${buildingUuid}\u0000${ordinal}\u0000${synthLabel.trim().toLowerCase()}`;
    const existing = syntheticLevelByKey.get(synthKey);
    if (existing !== undefined) return existing;
    const synthId = freshUuid(usedIds);
    syntheticLevelByKey.set(synthKey, synthId);
    levelBuildingByUuid.set(synthId, buildingUuid);
    levelRecords.push({
      id: synthId,
      ordinal,
      buildingUuid,
      geometry: null,
      transient: {
        name: { ja: synthLabel },
        short_name: { ja: synthLabel },
        ordinal,
        building_ids: [buildingUuid],
      },
      original: null,
      databaseId: "",
      layerName: "",
      synthetic: true,
    });
    return synthId;
  };

  // Building for a row: the reviewed assignment (a non-null id missing from the
  // plan is a hard error), else the building whose name matches the layer's
  // structured-name prefix case-insensitively — accepted only on EXACTLY one
  // match, so an ambiguous or absent prefix stays undefined (defers/hard-fails).
  const rowOrPrefixBuilding = (layer: GdbLayerPlan): string | undefined => {
    if (layer.buildingId !== null) {
      const uuid = buildingUuidById.get(layer.buildingId);
      if (uuid === undefined) {
        conversionFailed("unknown building id", {
          layer: layer.key.layerName,
          buildingId: layer.buildingId,
        });
      }
      return uuid;
    }
    const prefix = STRUCTURED_NAME.exec(layer.key.layerName)?.[1] ?? null;
    if (prefix === null) return undefined;
    const matches = plan.buildings.filter((b) => b.name.toLowerCase() === prefix.toLowerCase());
    return matches.length === 1 ? buildingUuidById.get(matches[0]!.id) : undefined;
  };

  // ---- Phase 2: non-level features + synthetic levels ---------------------
  for (const layer of included) {
    const targetType = layer.targetType;
    if (targetType === null || targetType === "level") continue;
    const converted = convertedByKey.get(gdbLayerKeyString(layer.key))!;
    const features = converted.featureCollection.features;
    const requiredFamily = GEOMETRY_REQUIREMENT[targetType] as SpatialFamily;
    let spatial = 0;
    let fallbackCount = 0;
    for (const [featureIndex, feature] of features.entries()) {
      const rawGeometry = feature.geometry;
      if (rawGeometry === null) continue;
      // Flatten a GeometryCollection to the target family; a plain geometry
      // passes through so a real family mismatch still fails below.
      const geometry = normalizeGeometryForFamily(rawGeometry, requiredFamily, {
        databaseId: layer.key.databaseId,
        layerName: layer.key.layerName,
        targetType,
        featureId: feature.id ?? null,
        featureIndex,
      });
      const fam = geometry === null ? null : geometryFamily(geometry);
      // No matching member, unknown type, or no finite coordinate pair is
      // geometry-less and skipped before the spatial count.
      if (geometry === null || fam === null || boundsOf([geometry]) === null) continue;
      if (fam !== requiredFamily) {
        conversionFailed("incompatible feature geometry", {
          layer: layer.key.layerName,
          targetType,
        });
      }
      const props = feature.properties ?? {};
      const rule = layer.levelRule;
      if (rule === null) {
        conversionFailed("row without level rule", { layer: layer.key.layerName });
      }

      let levelUuid: string;
      let featureBuilding: string;

      // Step 1 (plan line 101): a raw level_id/floor_id reference resolves
      // against the global raw-level map first — in either UUID form — for every
      // non-level rule kind. A source-reference rule tries its own field first.
      let referenced: string | undefined;
      const referenceFields =
        rule.kind === "source-reference"
          ? [rule.field, "level_id", "floor_id"]
          : ["level_id", "floor_id"];
      for (const field of referenceFields) {
        const value = coerceString(props[field]);
        if (value === null) continue;
        const hit = rawLevelMap.get(normalizeGdbUuid(value) ?? value);
        if (hit !== undefined) {
          referenced = hit;
          break;
        }
      }

      if (referenced !== undefined) {
        levelUuid = referenced;
        featureBuilding = levelBuildingByUuid.get(referenced)!;
      } else if (rule.kind === "fixed") {
        if (!Number.isFinite(rule.ordinal)) {
          conversionFailed("non-finite fixed ordinal", { layer: layer.key.layerName });
        }
        featureBuilding = requiredBuildingUuid(layer);
        levelUuid = resolveOrCreateLevel(featureBuilding, rule.ordinal, rule.label);
      } else if (rule.kind === "layer-name") {
        const ordinal = layerNameFloorOrdinal(layer.key.layerName);
        if (ordinal === null) {
          conversionFailed("unresolved feature floor", { layer: layer.key.layerName });
        }
        featureBuilding = requiredBuildingUuid(layer);
        levelUuid = resolveOrCreateLevel(
          featureBuilding,
          ordinal,
          STRUCTURED_NAME.exec(layer.key.layerName)?.[2] ?? null,
        );
      } else if (rule.kind === "property") {
        // Step 2: the chosen floor property; Step 3: the layer token when that
        // value is unresolvable. Both need a row/prefix building.
        let ordinal = extractGdbFloorOrdinal(props[rule.field]);
        let label = coerceString(props[rule.field]);
        if (ordinal === null) {
          ordinal = layerNameFloorOrdinal(layer.key.layerName);
          label = STRUCTURED_NAME.exec(layer.key.layerName)?.[2] ?? label;
        }
        const bUuid = rowOrPrefixBuilding(layer);
        if (ordinal === null || bUuid === undefined) {
          // Strict contract: a selected spatial feature whose level cannot be
          // resolved by the full chain is a hard conversion failure.
          conversionFailed("unresolved feature floor", {
            layer: layer.key.layerName,
            feature: coerceString(layer.idField ? props[layer.idField] : undefined),
            reference: coerceString(props[rule.field]),
          });
        }
        featureBuilding = bUuid;
        levelUuid = resolveOrCreateLevel(bUuid, ordinal, label);
      } else {
        // Unresolved source reference. Plan-line-101 fallback, but a POI must
        // NOT be placed by a bare floor ordinal unless its building is
        // independently identified — a shared POI layer (buildingId null, no
        // structured prefix) spans many buildings, so an ordinal alone is
        // ambiguous and hard-fails.
        const bUuid = rowOrPrefixBuilding(layer);
        const floorKey = Object.keys(props).find((key) => key.toLowerCase() === "floor");
        const floorValue = floorKey !== undefined ? coerceString(props[floorKey]) : null;
        // (b) The floor property may itself be a globally unique raw level
        // reference (either UUID form); it carries its own building.
        const floorRef =
          floorValue !== null
            ? rawLevelMap.get(normalizeGdbUuid(floorValue) ?? floorValue)
            : undefined;
        const tokenOrdinal = layerNameFloorOrdinal(layer.key.layerName);
        const floorOrdinal = floorValue !== null ? extractGdbFloorOrdinal(floorValue) : null;
        // Point-only spatial fallback, tried ONLY when no reviewed/prefix
        // building resolves: place the POI on the one imported building whose
        // polygon of that ordinal contains the point. Zero or many containing
        // buildings is ambiguous and hard-fails.
        let spatialLevel: string | undefined;
        let spatialBuilding: string | undefined;
        const point =
          floorOrdinal !== null && requiredFamily === "point"
            ? pointCoordinate(geometry)
            : null;
        if (point !== null) {
          const containing = new Set<string>();
          for (const candidate of levelRecords) {
            if (
              candidate.synthetic ||
              candidate.ordinal !== floorOrdinal ||
              candidate.geometry === null
            ) {
              continue;
            }
            if (pointInGeometry(point[0], point[1], candidate.geometry)) {
              containing.add(candidate.buildingUuid);
            }
          }
          if (containing.size === 1) {
            const [only] = [...containing];
            if (only !== undefined) {
              spatialLevel = importedLevelByBuildingOrdinal.get(`${only}\u0000${floorOrdinal}`);
              spatialBuilding = only;
            }
          }
        }
        if (floorRef !== undefined) {
          levelUuid = floorRef;
          featureBuilding = levelBuildingByUuid.get(floorRef)!;
        } else if (bUuid !== undefined && floorOrdinal !== null) {
          // (a) An explicit/prefix building wins: resolve by the floor ordinal.
          featureBuilding = bUuid;
          levelUuid = resolveOrCreateLevel(bUuid, floorOrdinal, floorValue);
          fallbackCount += 1;
        } else if (bUuid !== undefined && tokenOrdinal !== null) {
          // (a) An explicit/prefix building: resolve by the layer token.
          featureBuilding = bUuid;
          levelUuid = resolveOrCreateLevel(
            bUuid,
            tokenOrdinal,
            STRUCTURED_NAME.exec(layer.key.layerName)?.[2] ?? null,
          );
          fallbackCount += 1;
        } else if (spatialLevel !== undefined && spatialBuilding !== undefined) {
          // No reviewed building — a unique containing building places the point.
          levelUuid = spatialLevel;
          featureBuilding = spatialBuilding;
          fallbackCount += 1;
        } else {
          conversionFailed("unresolved source-reference level", {
            layer: layer.key.layerName,
            feature: coerceString(layer.idField ? props[layer.idField] : undefined),
            reference: coerceString(props[rule.field]),
          });
        }
      }

      const rawId = coerceString(layer.idField ? props[layer.idField] : undefined);
      const normalized = rawId !== null ? normalizeGdbUuid(rawId) : null;
      // A source UUID is preserved only when it is a count-one reserved v4;
      // any duplicate (including a level/non-level collision) is reassigned.
      let id: string;
      if (normalized !== null && reservedSourceUuids.has(normalized)) {
        id = normalized;
        usedIds.add(id);
      } else {
        id = freshUuid(usedIds);
      }

      const name = coerceString(layer.nameField ? props[layer.nameField] : undefined);
      let category = coerceString(layer.categoryField ? props[layer.categoryField] : undefined);
      if (targetType === "unit" && category === null) category = "room";

      const original = { ...props };
      const transient: Record<string, unknown> = { ...original, level_id: levelUuid };
      if (name !== null) transient.name = { ja: name };
      if (category !== null) transient.category = category;
      else delete transient.category;
      // Preserve raw restriction/accessibility only in sourceProperties.
      delete transient.restriction;
      delete transient.accessibility;

      spatial += 1;
      nonLevelRecords.push({
        id,
        featureType: targetType,
        geometry,
        transient,
        original,
        databaseId: layer.key.databaseId,
        layerName: layer.key.layerName,
        levelUuid,
        buildingUuid: featureBuilding,
      });
    }
    if (features.length === 0 || spatial === 0) {
      conversionFailed("empty or geometry-less layer", { layer: layer.key.layerName });
    }
    if (fallbackCount > 0) {
      conversionWarnings.push({
        code: "unresolved_reference",
        message: `${layer.key.layerName}: ${fallbackCount} feature(s) fell back to a resolved floor for unresolved floor references`,
      });
    }
  }

  if (levelRecords.length === 0) {
    conversionFailed("no levels produced");
  }

  // ---- Phase 3: synthesize geometry for synthetic levels ------------------
  for (const level of levelRecords) {
    if (!level.synthetic) continue;
    const assigned = nonLevelRecords
      .filter((record) => record.levelUuid === level.id)
      .map((record) => record.geometry);
    const bounds = boundsOf(assigned);
    if (bounds === null) {
      conversionFailed("synthetic level without finite geometry");
    }
    level.geometry = rectanglePolygon(bounds);
  }

  // ---- Phase 4: synthesize building and venue polygons --------------------
  // Every declared building becomes a feature; one with no assigned level/unit
  // geometry (e.g. an added-but-unused group) fails rather than vanishing.
  const buildingGeometries: GeoJSON.Geometry[] = [];
  const buildingFeatures: GeoJSON.Feature[] = [];
  for (const building of plan.buildings) {
    const buildingUuid = buildingUuidById.get(building.id)!;
    const geometries: (GeoJSON.Geometry | null)[] = [];
    for (const level of levelRecords) {
      if (level.buildingUuid === buildingUuid) geometries.push(level.geometry);
    }
    for (const record of nonLevelRecords) {
      if (record.featureType === "unit" && record.buildingUuid === buildingUuid) {
        geometries.push(record.geometry);
      }
    }
    const bounds = boundsOf(geometries);
    if (bounds === null) {
      conversionFailed("building without finite geometry", { buildingId: building.id });
    }
    const polygon = rectanglePolygon(bounds);
    buildingGeometries.push(polygon);
    buildingFeatures.push({
      type: "Feature",
      id: buildingUuid,
      geometry: polygon,
      properties: {
        name: { ja: building.name },
        venue_id: venueUuid,
      },
    });
  }

  const venueBounds = boundsOf(buildingGeometries);
  if (venueBounds === null) {
    conversionFailed("venue without finite geometry");
  }
  const venueFeature: GeoJSON.Feature = {
    type: "Feature",
    id: venueUuid,
    geometry: rectanglePolygon(venueBounds),
    properties: { name: { ja: plan.venueName } },
  };

  // ---- Phase 5: assemble collections and normalize ------------------------
  const collections: Partial<Record<FeatureType, GeoJSON.FeatureCollection>> = {
    venue: { type: "FeatureCollection", features: [venueFeature] },
    building: { type: "FeatureCollection", features: buildingFeatures },
  };

  const pushFeature = (type: FeatureType, feature: GeoJSON.Feature): void => {
    let collection = collections[type];
    if (collection === undefined) {
      collection = { type: "FeatureCollection", features: [] };
      collections[type] = collection;
    }
    collection.features.push(feature);
  };

  for (const level of levelRecords) {
    if (level.geometry === null) {
      conversionFailed("level without geometry", { levelId: level.id });
    }
    pushFeature("level", {
      type: "Feature",
      id: level.id,
      geometry: level.geometry,
      properties: level.transient,
    });
  }
  for (const record of nonLevelRecords) {
    pushFeature(record.featureType, {
      type: "Feature",
      id: record.id,
      geometry: record.geometry,
      properties: record.transient,
    });
  }

  const archive: ParsedImdfArchive = {
    manifest: { version: "1.0.0", language: "ja" },
    collections,
  };
  const venue = normalizeVenue(archive);

  // ---- Phase 6: restore complete source properties + metadata -------------
  for (const level of levelRecords) {
    if (level.synthetic || level.original === null) continue;
    const feature = venue.featuresById.get(level.id);
    if (feature !== undefined) {
      feature.sourceProperties = {
        ...level.original,
        [GDB_META_DATABASE]: level.databaseId,
        [GDB_META_LAYER]: level.layerName,
        [GDB_META_RESOLVED_LEVEL]: level.id,
      };
    }
  }
  for (const record of nonLevelRecords) {
    const feature = venue.featuresById.get(record.id);
    if (feature !== undefined) {
      feature.sourceProperties = {
        ...record.original,
        [GDB_META_DATABASE]: record.databaseId,
        [GDB_META_LAYER]: record.layerName,
        [GDB_META_RESOLVED_LEVEL]: record.levelUuid,
      };
    }
  }

  // Surface data-rot fallbacks (empty/dangling floor references) as nonfatal
  // warnings alongside normalizeVenue's own warnings.
  venue.warnings.push(...conversionWarnings);

  // One aggregated warning per included layer whose worker export dropped
  // geometry-less features, carrying database/layer identity and the count. The
  // worker's own raw skip string for that layer is recorded so it is filtered
  // from the verbatim propagation below (the structured warning is the single
  // source for that event).
  const workerSkipStrings = new Set<string>();
  for (const layer of included) {
    const converted = convertedByKey.get(gdbLayerKeyString(layer.key));
    if (converted === undefined || converted.skippedGeometryCount <= 0) continue;
    venue.warnings.push({
      code: "gdb_geometry_skipped",
      message: `${layer.key.databaseId}/${layer.key.layerName}: ${converted.skippedGeometryCount} feature(s) skipped for missing geometry`,
    });
    workerSkipStrings.add(
      `Layer "${layer.key.layerName}" skipped ${converted.skippedGeometryCount} feature(s) without geometry.`,
    );
  }

  // Propagate the worker's own warnings verbatim, exact-deduplicated, minus the
  // raw skip strings the structured warning already represents.
  const seenWorkerWarnings = new Set<string>();
  for (const message of conversion.warnings) {
    if (workerSkipStrings.has(message)) continue;
    if (seenWorkerWarnings.has(message)) continue;
    seenWorkerWarnings.add(message);
    venue.warnings.push({ code: "gdb_worker_warning", message });
  }

  return venue;
}
