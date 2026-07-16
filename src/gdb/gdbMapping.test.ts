import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchiveError } from "../errors/ArchiveError";
import type { LoadedVenue, ViewerFeature } from "../imdf/types";
import {
  buildGdbVenue,
  extractGdbFloorOrdinal,
  gdbTargetTypesForGeometry,
  isGdbTargetGeometryCompatible,
  layerNameFloorOrdinal,
  normalizeGdbUuid,
  structuredFloorOrdinal,
  suggestGdbMapping,
} from "./gdbMapping";
import type {
  GdbConversionResult,
  GdbConvertedLayer,
  GdbGeometryFamily,
  GdbInspection,
  GdbLayerDescriptor,
  GdbLayerKey,
  GdbLayerPlan,
  GdbMappingPlan,
} from "./types";
import { gdbLayerKeyString } from "./types";

function layer(
  layerName: string,
  geometryFamily: GdbGeometryFamily,
  featureCount: number,
  fieldNames: readonly string[] = [],
  databaseId = "gdb-1",
): GdbLayerDescriptor {
  return {
    key: { databaseId, layerName },
    databaseName: `${databaseId}.gdb`,
    featureCount,
    geometryFamily,
    fields: fieldNames.map((name) => ({ name, type: "String" })),
  };
}

function inspect(
  layers: GdbLayerDescriptor[],
  sourceName = "Venue.gdb",
): GdbInspection {
  return {
    sourceName,
    databases: [{ id: "gdb-1", name: "gdb-1.gdb" }],
    layers,
    warnings: [],
  };
}

function planFor(inspection: GdbInspection, layerName: string): GdbLayerPlan {
  const target = gdbLayerKeyString(
    inspection.layers.find((l) => l.key.layerName === layerName)!.key,
  );
  const plan = suggestGdbMapping(inspection);
  const found = plan.layers.find((l) => gdbLayerKeyString(l.key) === target);
  if (!found) throw new Error(`no plan for ${layerName}`);
  return found;
}

describe("suggestGdbMapping target-type aliases", () => {
  it("maps Tokyo and Shinjuku suffixes to the same target types", () => {
    const tokyo = inspect([
      layer("Sta_F1_Floor", "polygon", 3),
      layer("Sta_F1_Space", "polygon", 5),
      layer("Sta_F1_Opening", "line", 2),
      layer("Sta_F1_Drawing", "line", 4),
      layer("Sta_F1_Fixture", "polygon", 1),
      layer("Sta_F1_Occupant", "point", 6),
    ]);
    const shinjuku = inspect([
      layer("Sta_F1_level", "polygon", 3),
      layer("Sta_F1_unit", "polygon", 5),
      layer("Sta_F1_opening", "line", 2),
      layer("Sta_F1_detail", "line", 4),
      layer("Sta_F1_fixture", "polygon", 1),
      layer("Sta_F1_occupant", "point", 6),
    ]);

    expect(planFor(tokyo, "Sta_F1_Floor").targetType).toBe("level");
    expect(planFor(shinjuku, "Sta_F1_level").targetType).toBe("level");
    expect(planFor(tokyo, "Sta_F1_Space").targetType).toBe("unit");
    expect(planFor(shinjuku, "Sta_F1_unit").targetType).toBe("unit");
    expect(planFor(tokyo, "Sta_F1_Opening").targetType).toBe("opening");
    expect(planFor(shinjuku, "Sta_F1_opening").targetType).toBe("opening");
    expect(planFor(tokyo, "Sta_F1_Drawing").targetType).toBe("detail");
    expect(planFor(shinjuku, "Sta_F1_detail").targetType).toBe("detail");
    expect(planFor(tokyo, "Sta_F1_Fixture").targetType).toBe("fixture");
    expect(planFor(shinjuku, "Sta_F1_fixture").targetType).toBe("fixture");
    expect(planFor(tokyo, "Sta_F1_Occupant").targetType).toBe("occupant");
    expect(planFor(shinjuku, "Sta_F1_occupant").targetType).toBe("occupant");
  });

  it("maps facility/network aliases to amenity or detail", () => {
    const insp = inspect([
      layer("point_facility_A", "point", 4),
      layer("Facility_Merge", "point", 4),
      layer("wifi", "point", 4),
      layer("net_junction", "point", 4),
      layer("net_path", "line", 4),
      layer("station_link", "line", 4),
    ]);
    expect(planFor(insp, "point_facility_A").targetType).toBe("amenity");
    expect(planFor(insp, "Facility_Merge").targetType).toBe("amenity");
    expect(planFor(insp, "wifi").targetType).toBe("amenity");
    expect(planFor(insp, "net_junction").targetType).toBe("amenity");
    expect(planFor(insp, "net_path").targetType).toBe("detail");
    expect(planFor(insp, "station_link").targetType).toBe("detail");
  });

  it("suggests detail but excludes cross-floor _to_ edges by default", () => {
    const insp = inspect([layer("F1_to_F2_link", "line", 8)]);
    const plan = planFor(insp, "F1_to_F2_link");
    expect(plan.targetType).toBe("detail");
    expect(plan.included).toBe(false);
  });

  it("leaves unrecognized names unmapped and excluded", () => {
    const insp = inspect([layer("random_layer", "polygon", 4)]);
    const plan = planFor(insp, "random_layer");
    expect(plan.targetType).toBeNull();
    expect(plan.included).toBe(false);
  });
});

describe("suggestGdbMapping inclusion and geometry gating", () => {
  it("includes a recognized, geometry-compatible, non-empty layer by default", () => {
    const insp = inspect([layer("Sta_F1_Space", "polygon", 5)]);
    expect(planFor(insp, "Sta_F1_Space").included).toBe(true);
  });

  it("excludes empty layers even when recognized", () => {
    const insp = inspect([layer("Sta_F1_Space", "polygon", 0)]);
    expect(planFor(insp, "Sta_F1_Space").included).toBe(false);
  });

  it("nulls a guessed type that the geometry cannot support", () => {
    // _Floor guesses level (needs polygon) but geometry is line.
    const insp = inspect([layer("Sta_F1_Floor", "line", 5)]);
    const plan = planFor(insp, "Sta_F1_Floor");
    expect(plan.targetType).toBeNull();
    expect(plan.included).toBe(false);
  });

  it("nulls type for mixed and none geometry families", () => {
    const insp = inspect([
      layer("Sta_F1_Space", "mixed", 5),
      layer("Sta_F2_Space", "none", 5),
    ]);
    expect(planFor(insp, "Sta_F1_Space").targetType).toBeNull();
    expect(planFor(insp, "Sta_F2_Space").targetType).toBeNull();
  });

  it("exposes geometry-compatible target types for the dropdown", () => {
    expect(gdbTargetTypesForGeometry("polygon")).toEqual([
      "level",
      "unit",
      "fixture",
      "kiosk",
    ]);
    expect(gdbTargetTypesForGeometry("line")).toEqual(["opening", "detail"]);
    expect(gdbTargetTypesForGeometry("point")).toEqual(["amenity", "occupant"]);
    expect(gdbTargetTypesForGeometry("mixed")).toEqual([]);
    expect(isGdbTargetGeometryCompatible("level", "line")).toBe(false);
    expect(isGdbTargetGeometryCompatible("opening", "line")).toBe(true);
  });
});

describe("suggestGdbMapping structured building grouping", () => {
  it("produces one sorted building per distinct structured prefix", () => {
    const insp = inspect([
      layer("StationB_F1_Floor", "polygon", 1),
      layer("StationA_F1_Floor", "polygon", 1),
      layer("StationA_F2_Space", "polygon", 1),
      layer("StationC_B1_Floor", "polygon", 1),
    ]);
    const plan = suggestGdbMapping(insp);
    expect(plan.buildings).toEqual([
      { id: "building-1", name: "StationA" },
      { id: "building-2", name: "StationB" },
      { id: "building-3", name: "StationC" },
    ]);
    // A level row is assigned to its structured building.
    const a = plan.layers.find((l) => l.key.layerName === "StationA_F1_Floor")!;
    expect(a.buildingId).toBe("building-1");
    const b = plan.layers.find((l) => l.key.layerName === "StationB_F1_Floor")!;
    expect(b.buildingId).toBe("building-2");
  });

  it("deduplicates prefixes case-insensitively", () => {
    const insp = inspect([
      layer("Tower_F1_Floor", "polygon", 1),
      layer("tower_F2_Floor", "polygon", 1),
    ]);
    expect(suggestGdbMapping(insp).buildings).toHaveLength(1);
  });

  it("scales to 15 and 26 distinct structured groups", () => {
    const fifteen = inspect(
      Array.from({ length: 15 }, (_, i) => layer(`Bldg${i}_F1_Floor`, "polygon", 1)),
    );
    expect(suggestGdbMapping(fifteen).buildings).toHaveLength(15);

    const twentySix = inspect(
      Array.from({ length: 26 }, (_, i) =>
        layer(`Zone${String.fromCharCode(65 + i)}_F1_level`, "polygon", 1),
      ),
    );
    expect(suggestGdbMapping(twentySix).buildings).toHaveLength(26);
  });
});

describe("suggestGdbMapping field aliases and level rules", () => {
  it("prefers a source-reference rule and leaves its building null", () => {
    const insp = inspect([
      layer("Sta_F1_Floor", "polygon", 1, ["id", "name"]),
      layer("point_facility_A", "point", 4, ["uuid", "level_id", "NAME", "CATEGORY"]),
    ]);
    const poi = planFor(insp, "point_facility_A");
    expect(poi.levelRule).toEqual({ kind: "source-reference", field: "level_id" });
    expect(poi.buildingId).toBeNull();
    expect(poi.idField).toBe("uuid");
    expect(poi.nameField).toBe("NAME");
    expect(poi.categoryField).toBe("CATEGORY");
  });

  it("falls back to floor_id, then a floor property, then the layer token", () => {
    const byFloorId = inspect([layer("A_F1_detail", "line", 2, ["floor_id"])]);
    expect(planFor(byFloorId, "A_F1_detail").levelRule).toEqual({
      kind: "source-reference",
      field: "floor_id",
    });

    const byFloor = inspect([layer("A_F1_detail", "line", 2, ["FLOOR"])]);
    expect(planFor(byFloor, "A_F1_detail").levelRule).toEqual({
      kind: "property",
      field: "FLOOR",
    });

    const byToken = inspect([layer("A_F1_detail", "line", 2, [])]);
    expect(planFor(byToken, "A_F1_detail").levelRule).toEqual({ kind: "layer-name" });
  });

  it("gives a floor-property rule a concrete building assignment", () => {
    const insp = inspect([layer("A_F1_detail", "line", 2, ["FLOOR"])]);
    expect(planFor(insp, "A_F1_detail").buildingId).toBe("building-1");
  });

  it("records id/uuid, name/名称, ordinal and short_name fields", () => {
    const insp = inspect([
      layer("A_F1_Floor", "polygon", 1, ["uuid", "\u540d\u79f0", "ordinal", "short_name"]),
    ]);
    const p = planFor(insp, "A_F1_Floor");
    expect(p.idField).toBe("uuid");
    expect(p.nameField).toBe("\u540d\u79f0");
    expect(p.ordinalField).toBe("ordinal");
    expect(p.shortNameField).toBe("short_name");
  });

  it("gives a level row a property rule and its structured building, never source-reference", () => {
    const insp = inspect([layer("A_F1_Floor", "polygon", 1, ["level_id", "FLOOR"])]);
    const p = planFor(insp, "A_F1_Floor");
    expect(p.levelRule).toEqual({ kind: "property", field: "FLOOR" });
    expect(p.buildingId).toBe("building-1");
  });

  it("assigns a layer-name rule to a structured zero-floor level", () => {
    const insp = inspect([layer("Station_0_level", "polygon", 2, [])]);
    const p = planFor(insp, "Station_0_level");
    expect(p.targetType).toBe("level");
    expect(p.levelRule).toEqual({ kind: "layer-name" });
    expect(p.buildingId).toBe("building-1");
  });
});

describe("extractGdbFloorOrdinal", () => {
  it("parses base, Japanese, basement, and mezzanine forms", () => {
    expect(extractGdbFloorOrdinal("1")).toBe(1);
    expect(extractGdbFloorOrdinal("1F")).toBe(1);
    expect(extractGdbFloorOrdinal("F1")).toBe(1);
    expect(extractGdbFloorOrdinal("1\u968e")).toBe(1);
    expect(extractGdbFloorOrdinal("GF")).toBe(1);
    expect(extractGdbFloorOrdinal("B1")).toBe(-1);
    expect(extractGdbFloorOrdinal("B1F")).toBe(-1);
    expect(extractGdbFloorOrdinal("KB3")).toBe(-3);
    expect(extractGdbFloorOrdinal("SB4")).toBe(-4);
    expect(extractGdbFloorOrdinal("M2")).toBe(2);
  });

  it("returns null for roof forms with no invented ordinal", () => {
    expect(extractGdbFloorOrdinal("R")).toBeNull();
    expect(extractGdbFloorOrdinal("RF")).toBeNull();
  });

  it("parses structured zero tokens 0, F0, and 0F as ground ordinal 0", () => {
    expect(extractGdbFloorOrdinal("0")).toBe(0);
    expect(extractGdbFloorOrdinal("F0")).toBe(0);
    expect(extractGdbFloorOrdinal("0F")).toBe(0);
    expect(extractGdbFloorOrdinal("Sta_0_level")).toBe(0);
  });

  it("accepts finite numbers and rejects unusable values", () => {
    expect(extractGdbFloorOrdinal(-3)).toBe(-3);
    expect(extractGdbFloorOrdinal(Number.NaN)).toBeNull();
    expect(extractGdbFloorOrdinal(null)).toBeNull();
    expect(extractGdbFloorOrdinal("")).toBeNull();
    expect(extractGdbFloorOrdinal("lobby")).toBeNull();
  });

  it("extracts the floor token from a structured layer name", () => {
    expect(extractGdbFloorOrdinal("Sta_B1_Floor")).toBe(-1);
    expect(extractGdbFloorOrdinal("Sta_M2_Space")).toBe(2);
  });

  it("parses the leading source-level token and ignores appended TP digits", () => {
    // Half-width paren: leading "B2FL" wins; the "5" in "(TP-5.11)" never does.
    expect(extractGdbFloorOrdinal("B2FL(1FL)_\u2026(TP-5.11)")).toBe(-2);
    // Full-width paren.
    expect(extractGdbFloorOrdinal("B2FL\uFF081FL\uFF09")).toBe(-2);
    // Full-width (U+3000) space before the metadata.
    expect(extractGdbFloorOrdinal("B2FL\u3000(1FL)")).toBe(-2);
  });
});

describe("structuredFloorOrdinal", () => {
  it("parses only the structured floor token, ignoring digits in the prefix", () => {
    // Prefix contains "2" but the floor token is R (unresolvable).
    expect(structuredFloorOrdinal("Station_2_R_level")).toBeNull();
    // Floor token 0 resolves even with a "2" in the prefix.
    expect(structuredFloorOrdinal("Station_2_0_level")).toBe(0);
    // Floor token F1 wins over the prefix "2".
    expect(structuredFloorOrdinal("Station_2_F1_Floor")).toBe(1);
  });

  it("returns null for non-structured names", () => {
    expect(structuredFloorOrdinal("F1_edge")).toBeNull();
    expect(structuredFloorOrdinal("random")).toBeNull();
  });

  it("keeps suggestion floor resolution structured", () => {
    // R token -> level rule unresolved even though prefix has a digit.
    const unresolved = inspect([layer("Station_2_R_level", "polygon", 2, [])]);
    expect(planFor(unresolved, "Station_2_R_level").levelRule).toBeNull();
    // 0 token -> layer-name rule.
    const resolved = inspect([layer("Station_2_0_level", "polygon", 2, [])]);
    expect(planFor(resolved, "Station_2_0_level").levelRule).toEqual({ kind: "layer-name" });
  });
});

describe("layerNameFloorOrdinal", () => {
  it("uses structured token only and never falls back to prefix digits", () => {
    expect(layerNameFloorOrdinal("Station_2_R_level")).toBeNull();
    expect(layerNameFloorOrdinal("Station_2_0_level")).toBe(0);
    expect(layerNameFloorOrdinal("Station_2_F1_Floor")).toBe(1);
    expect(layerNameFloorOrdinal("Sta_B1_unit")).toBe(-1);
  });

  it("falls back to loose cesium parse for non-structured layer names", () => {
    expect(layerNameFloorOrdinal("ShinjukuYodobashi_Camera_1_nw")).toBe(1);
    expect(layerNameFloorOrdinal("ShinjukuSt_B1_link")).toBe(-1);
    expect(layerNameFloorOrdinal("F1_edge")).toBe(1);
  });

  it("returns null when neither structured nor loose parse resolves", () => {
    expect(layerNameFloorOrdinal("random")).toBeNull();
    expect(layerNameFloorOrdinal("net_path")).toBeNull();
  });
});

describe("normalizeGdbUuid", () => {
  it("preserves a valid hyphenated UUID", () => {
    const uuid = "b1000002-0000-4000-8000-00000000001f";
    expect(normalizeGdbUuid(uuid)).toBe(uuid);
    expect(normalizeGdbUuid(uuid.toUpperCase())).toBe(uuid);
  });

  it("hyphenates a 32-hex UUID", () => {
    expect(normalizeGdbUuid("b1000002000040008000" + "00000000001f")).toBe(
      "b1000002-0000-4000-8000-00000000001f",
    );
  });

  it("returns null for non-UUID values so the caller allocates", () => {
    expect(normalizeGdbUuid("not-a-uuid")).toBeNull();
    expect(normalizeGdbUuid("12345")).toBeNull();
    expect(normalizeGdbUuid(42)).toBeNull();
    expect(normalizeGdbUuid(null)).toBeNull();
  });

  it("rejects non-v4 UUIDs and invalid variants in both forms", () => {
    // Version nibble 1 (UUIDv1), otherwise well-formed.
    expect(normalizeGdbUuid("b1000002-0000-1000-8000-00000000001f")).toBeNull();
    expect(normalizeGdbUuid("b1000002000010008000" + "00000000001f")).toBeNull();
    // Version 4 but a non-RFC variant nibble (c).
    expect(normalizeGdbUuid("b1000002-0000-4000-c000-00000000001f")).toBeNull();
    expect(normalizeGdbUuid("b100000200004000c000" + "00000000001f")).toBeNull();
    // A valid v4 (variant nibble b) is still normalized from 32-hex.
    expect(normalizeGdbUuid("b100000200004000b000" + "00000000001f")).toBe(
      "b1000002-0000-4000-b000-00000000001f",
    );
  });
});

describe("suggestGdbMapping venue name", () => {
  it("strips gdb/zip suffixes but leaves multi-archive names intact", () => {
    expect(suggestGdbMapping(inspect([], "JRShinjukuSta.gdb")).venueName).toBe("JRShinjukuSta");
    expect(suggestGdbMapping(inspect([], "Venue.gdb.zip")).venueName).toBe("Venue");
    expect(suggestGdbMapping(inspect([], "Venue.zip")).venueName).toBe("Venue");
    expect(suggestGdbMapping(inspect([], "3 GDB archives")).venueName).toBe("3 GDB archives");
  });
});

// ---------------------------------------------------------------------------
// buildGdbVenue
// ---------------------------------------------------------------------------

function square(x: number, y: number): GeoJSON.Polygon {
  return {
    type: "Polygon",
    coordinates: [
      [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
        [x, y],
      ],
    ],
  };
}

function pointGeom(x: number, y: number): GeoJSON.Point {
  return { type: "Point", coordinates: [x, y] };
}

function lineGeom(x: number, y: number): GeoJSON.LineString {
  return {
    type: "LineString",
    coordinates: [
      [x, y],
      [x + 1, y + 1],
    ],
  };
}

function feat(
  geometry: GeoJSON.Geometry,
  properties: Record<string, unknown>,
): GeoJSON.Feature {
  return { type: "Feature", geometry, properties };
}

function convLayer(
  databaseId: string,
  layerName: string,
  features: GeoJSON.Feature[],
): GdbConvertedLayer {
  return {
    key: { databaseId, layerName },
    featureCollection: { type: "FeatureCollection", features },
    skippedGeometryCount: 0,
  };
}

function conversion(layers: GdbConvertedLayer[]): GdbConversionResult {
  return { layers, warnings: [] };
}

function lp(over: Partial<GdbLayerPlan> & { key: GdbLayerKey }): GdbLayerPlan {
  return {
    included: true,
    targetType: null,
    buildingId: null,
    levelRule: null,
    idField: null,
    ordinalField: null,
    shortNameField: null,
    nameField: null,
    categoryField: null,
    ...over,
  };
}

function findByType(venue: LoadedVenue, type: string): ViewerFeature {
  const found = [...venue.featuresById.values()].find((f) => f.featureType === type);
  if (!found) throw new Error(`no feature of type ${type}`);
  return found;
}

const HEX32 = "b1000002000040008000" + "00000000001f";
const HEX32_AS_UUID = "b1000002-0000-4000-8000-00000000001f";
const HYPHEN_UUID = "c2000003-0000-4000-9000-00000000002a";

describe("buildGdbVenue happy path (Tokyo 32-hex, cross-database POI)", () => {
  const conv = conversion([
    convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: HEX32, name: "1F" })]),
    convLayer("gdb-1", "Sta_F1_Space", [
      feat(square(0, 0), {
        id: "u1",
        NAME: "Shop",
        CATEGORY: "",
        restriction: "2",
        accessibility: ["wheelchair"],
      }),
    ]),
    convLayer("gdb-2", "point_facility", [
      feat(pointGeom(0.5, 0.5), {
        uuid: "a1",
        floor_id: HEX32,
        NAME: "Locker",
        CATEGORY: "locker",
        image: "/marker/locker.png",
        symbol_id: "S1",
      }),
    ]),
  ]);
  const plan: GdbMappingPlan = {
    venueName: "Sta",
    buildings: [{ id: "building-1", name: "Sta" }],
    layers: [
      lp({
        key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
        targetType: "level",
        buildingId: "building-1",
        levelRule: { kind: "layer-name" },
        idField: "id",
        nameField: "name",
      }),
      lp({
        key: { databaseId: "gdb-1", layerName: "Sta_F1_Space" },
        targetType: "unit",
        buildingId: "building-1",
        levelRule: { kind: "layer-name" },
        idField: "id",
        nameField: "NAME",
        categoryField: "CATEGORY",
      }),
      lp({
        key: { databaseId: "gdb-2", layerName: "point_facility" },
        targetType: "amenity",
        levelRule: { kind: "source-reference", field: "floor_id" },
        idField: "uuid",
        nameField: "NAME",
        categoryField: "CATEGORY",
      }),
    ],
  };

  it("groups one ordinal level and normalizes the 32-hex level id", () => {
    const venue = buildGdbVenue(conv, plan);
    expect(venue.levels).toHaveLength(1);
    expect(venue.levels[0]?.ordinal).toBe(1);
    expect(venue.levels[0]?.id).toBe("ordinal:1");
    const level = venue.featuresById.get(HEX32_AS_UUID);
    expect(level?.featureType).toBe("level");
  });

  it("resolves a cross-database floor_id to the architecture level", () => {
    const venue = buildGdbVenue(conv, plan);
    const amenity = findByType(venue, "amenity");
    expect(amenity.levelId).toBe("ordinal:1");
    expect(amenity.sourceProperties["__gdb_resolved_level_id"]).toBe(HEX32_AS_UUID);
  });

  it("preserves source properties plus exactly the three metadata keys", () => {
    const venue = buildGdbVenue(conv, plan);
    const amenity = findByType(venue, "amenity");
    expect(amenity.sourceProperties["image"]).toBe("/marker/locker.png");
    expect(amenity.sourceProperties["symbol_id"]).toBe("S1");
    expect(amenity.sourceProperties["floor_id"]).toBe(HEX32);
    expect(amenity.sourceProperties["__gdb_database"]).toBe("gdb-2");
    expect(amenity.sourceProperties["__gdb_layer"]).toBe("point_facility");
    expect(amenity.sourceProperties["__gdb_resolved_level_id"]).toBe(HEX32_AS_UUID);
  });

  it("maps ja labels and categories and builds search entries", () => {
    const venue = buildGdbVenue(conv, plan);
    const amenity = findByType(venue, "amenity");
    expect(amenity.labels).toEqual({ ja: "Locker" });
    expect(amenity.category).toBe("locker");
    expect(venue.searchEntries.some((e) => e.labels["ja"] === "Locker")).toBe(true);
    expect(venue.searchEntries.some((e) => e.labels["ja"] === "Shop")).toBe(true);
  });

  it("falls back a blank unit category to room and preserves source codes", () => {
    const venue = buildGdbVenue(conv, plan);
    const unit = findByType(venue, "unit");
    expect(unit.category).toBe("room");
    expect(unit.restriction).toBeNull();
    expect(unit.accessibility).toEqual([]);
    expect(unit.sourceProperties["restriction"]).toBe("2");
    expect(unit.sourceProperties["accessibility"]).toEqual(["wheelchair"]);
  });

  it("emits venue and building features with linked ids and finite bounds", () => {
    const venue = buildGdbVenue(conv, plan);
    expect(venue.venue.featureType).toBe("venue");
    const building = findByType(venue, "building");
    expect(building.sourceProperties["venue_id"]).toBe(venue.venue.id);
    const bounds = venue.boundsByLevel.get("ordinal:1");
    expect(bounds).toBeDefined();
    const [w, s, e, n] = bounds!;
    expect(Number.isFinite(w) && Number.isFinite(s) && Number.isFinite(e) && Number.isFinite(n)).toBe(
      true,
    );
    expect(e).toBeGreaterThan(w);
    expect(n).toBeGreaterThan(s);
  });
});

describe("buildGdbVenue id normalization (Shinjuku hyphenated, fresh ids)", () => {
  it("preserves a hyphenated UUIDv4 level id and allocates for non-UUID ids", () => {
    const conv = conversion([
      convLayer("gdb-1", "Zone_F1_level", [feat(square(0, 0), { id: HYPHEN_UUID, name: "1F" })]),
      convLayer("gdb-1", "Zone_F1_unit", [feat(square(0, 0), { id: "plain-id", NAME: "Room" })]),
    ]);
    const plan: GdbMappingPlan = {
      venueName: "Zone",
      buildings: [{ id: "building-1", name: "Zone" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Zone_F1_level" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
        lp({
          key: { databaseId: "gdb-1", layerName: "Zone_F1_unit" },
          targetType: "unit",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "NAME",
        }),
      ],
    };
    const venue = buildGdbVenue(conv, plan);
    expect(venue.featuresById.get(HYPHEN_UUID)?.featureType).toBe("level");
    const unit = findByType(venue, "unit");
    expect(unit.id).not.toBe("plain-id");
    expect(unit.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("buildGdbVenue synthetic levels (property/fixed/layer rules)", () => {
  it("creates a synthetic level from a floor property with finite geometry", () => {
    const conv = conversion([
      convLayer("gdb-1", "net_path", [feat(lineGeom(2, 2), { FLOOR: "B1", NAME: "Path" })]),
    ]);
    const plan: GdbMappingPlan = {
      venueName: "V",
      buildings: [{ id: "building-1", name: "V" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "net_path" },
          targetType: "detail",
          buildingId: "building-1",
          levelRule: { kind: "property", field: "FLOOR" },
          nameField: "NAME",
        }),
      ],
    };
    const venue = buildGdbVenue(conv, plan);
    expect(venue.levels.map((l) => l.ordinal)).toEqual([-1]);
    const detail = findByType(venue, "detail");
    expect(detail.levelId).toBe("ordinal:-1");
    const bounds = venue.boundsByLevel.get("ordinal:-1");
    expect(bounds).toBeDefined();
    expect(bounds![2]).toBeGreaterThan(bounds![0]);
    expect(bounds![3]).toBeGreaterThan(bounds![1]);
  });

  it("creates a synthetic level from a fixed rule with its label and ordinal", () => {
    const conv = conversion([
      convLayer("gdb-1", "roof_beacon", [feat(pointGeom(3, 3), { NAME: "Beacon" })]),
    ]);
    const plan: GdbMappingPlan = {
      venueName: "V",
      buildings: [{ id: "building-1", name: "V" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "roof_beacon" },
          targetType: "amenity",
          buildingId: "building-1",
          levelRule: { kind: "fixed", label: "Roof", ordinal: 9 },
          nameField: "NAME",
        }),
      ],
    };
    const venue = buildGdbVenue(conv, plan);
    expect(venue.levels).toHaveLength(1);
    expect(venue.levels[0]?.ordinal).toBe(9);
    expect(venue.levels[0]?.label).toEqual({ ja: "Roof" });
  });

  it("resolves a level layer-name rule token to the level ordinal", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_B2_level", [feat(square(0, 0), { NAME: "B2F" })]),
    ]);
    const plan: GdbMappingPlan = {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_B2_level" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          nameField: "NAME",
        }),
      ],
    };
    const venue = buildGdbVenue(conv, plan);
    expect(venue.levels[0]?.ordinal).toBe(-2);
  });
});

describe("buildGdbVenue rejects invalid conversions", () => {
  const okLevel = () =>
    lp({
      key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
      targetType: "level",
      buildingId: "building-1",
      levelRule: { kind: "layer-name" },
      idField: "id",
      nameField: "name",
    });

  function expectFails(conv: GdbConversionResult, plan: GdbMappingPlan): void {
    let thrown: unknown;
    try {
      buildGdbVenue(conv, plan);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
  }

  it("rejects incompatible geometry for a target type", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [feat(pointGeom(0, 0), { id: "l1", name: "1F" })]),
    ]);
    expectFails(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [okLevel()],
    });
  });

  it("rejects ambiguous duplicate raw level ids", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [
        feat(square(0, 0), { id: HEX32, name: "1F" }),
        feat(square(1, 1), { id: HEX32, name: "1F" }),
      ]),
    ]);
    expectFails(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [okLevel()],
    });
  });

  it("rejects an unresolved source-reference floor", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: HEX32, name: "1F" })]),
      convLayer("gdb-2", "point_facility", [
        feat(pointGeom(0.5, 0.5), { uuid: "a1", floor_id: "missing", NAME: "X" }),
      ]),
    ]);
    expectFails(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        okLevel(),
        lp({
          key: { databaseId: "gdb-2", layerName: "point_facility" },
          targetType: "amenity",
          levelRule: { kind: "source-reference", field: "floor_id" },
          idField: "uuid",
          nameField: "NAME",
        }),
      ],
    });
  });

  it("rejects a level layer-name token with no resolvable ordinal (R)", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_R_level", [feat(square(0, 0), { id: "r1", name: "Roof" })]),
    ]);
    expectFails(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_R_level" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
      ],
    });
  });

  it("rejects an included layer missing from the conversion result", () => {
    const conv = conversion([]);
    expectFails(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [okLevel()],
    });
  });

  it("rejects an all-empty conversion with no included layers", () => {
    const conv = conversion([convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: "l1" })])]);
    expectFails(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [{ ...okLevel(), included: false }],
    });
  });

  it("rejects a selected layer whose features are all geometry-less", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [feat({ type: "GeometryCollection", geometries: [] }, { id: "l1", name: "1F" })]),
    ]);
    expectFails(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [okLevel()],
    });
  });

  it("rejects a building/venue with no finite geometry", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [
        feat({ type: "MultiPolygon", coordinates: [] }, { id: "l1", name: "1F" }),
      ]),
    ]);
    expectFails(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [okLevel()],
    });
  });
});

describe("buildGdbVenue global id uniqueness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps generated ids distinct despite a randomUUID collision", () => {
    const dup = "11111111-1111-4111-8111-111111111111";
    const unique = "22222222-2222-4222-8222-222222222222";
    const seq = [dup, dup, unique];
    let index = 0;
    vi.spyOn(crypto, "randomUUID").mockImplementation(
      () => (seq[Math.min(index++, seq.length - 1)] ?? unique) as `${string}-${string}-${string}-${string}-${string}`,
    );
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: HYPHEN_UUID, name: "1F" })]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
      ],
    });
    const building = findByType(venue, "building");
    expect(building.id).toBe(dup);
    expect(venue.venue.id).toBe(unique);
    expect(venue.venue.id).not.toBe(building.id);
  });

  it("reassigns every occurrence of a duplicated non-level source UUID", () => {
    const conv = conversion([
      convLayer("gdb-1", "dup_beacon", [
        feat(pointGeom(0, 0), { uuid: HYPHEN_UUID, NAME: "A" }),
        feat(pointGeom(1, 1), { uuid: HYPHEN_UUID, NAME: "B" }),
      ]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "V",
      buildings: [{ id: "building-1", name: "V" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "dup_beacon" },
          targetType: "amenity",
          buildingId: "building-1",
          levelRule: { kind: "fixed", label: "F1", ordinal: 1 },
          idField: "uuid",
          nameField: "NAME",
        }),
      ],
    });
    const amenities = [...venue.featuresById.values()].filter((f) => f.featureType === "amenity");
    expect(amenities).toHaveLength(2);
    expect(venue.featuresById.has(HYPHEN_UUID)).toBe(false);
    expect(amenities.every((a) => a.id !== HYPHEN_UUID)).toBe(true);
    expect(amenities[0]!.id).not.toBe(amenities[1]!.id);
  });
});

describe("buildGdbVenue canonical level references", () => {
  it("treats 32-hex and hyphenated forms of one UUID as a duplicate", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [
        feat(square(0, 0), { id: HEX32, name: "1F" }),
        feat(square(1, 1), { id: HEX32_AS_UUID, name: "1F" }),
      ]),
    ]);
    let thrown: unknown;
    try {
      buildGdbVenue(conv, {
        venueName: "Sta",
        buildings: [{ id: "building-1", name: "Sta" }],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
            targetType: "level",
            buildingId: "building-1",
            levelRule: { kind: "layer-name" },
            idField: "id",
            nameField: "name",
          }),
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
  });

  it("fails ambiguity when a finite and a coordinate-empty level share a raw id", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [
        feat(square(0, 0), { id: HEX32, name: "1F" }),
        feat({ type: "Polygon", coordinates: [] }, { id: HEX32_AS_UUID, name: "1F" }),
      ]),
    ]);
    let thrown: unknown;
    try {
      buildGdbVenue(conv, {
        venueName: "Sta",
        buildings: [{ id: "building-1", name: "Sta" }],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
            targetType: "level",
            buildingId: "building-1",
            levelRule: { kind: "layer-name" },
            idField: "id",
            nameField: "name",
          }),
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
  });

  it("resolves a POI reference given in the opposite UUID form", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: HEX32, name: "1F" })]),
      convLayer("gdb-2", "point_facility", [
        feat(pointGeom(0.5, 0.5), { uuid: "p1", floor_id: HEX32_AS_UUID.toUpperCase(), NAME: "X" }),
      ]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
        lp({
          key: { databaseId: "gdb-2", layerName: "point_facility" },
          targetType: "amenity",
          levelRule: { kind: "source-reference", field: "floor_id" },
          idField: "uuid",
          nameField: "NAME",
        }),
      ],
    });
    const amenity = findByType(venue, "amenity");
    expect(amenity.levelId).toBe("ordinal:1");
    expect(amenity.sourceProperties["__gdb_resolved_level_id"]).toBe(HEX32_AS_UUID);
  });
});

describe("buildGdbVenue co-ordinal synthetic levels stay distinct", () => {
  it("keeps two labels on one ordinal as separate source levels", () => {
    const conv = conversion([
      convLayer("gdb-1", "north_beacon", [feat(pointGeom(0, 0), { NAME: "N" })]),
      convLayer("gdb-1", "south_beacon", [feat(pointGeom(5, 5), { NAME: "S" })]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "V",
      buildings: [{ id: "building-1", name: "V" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "north_beacon" },
          targetType: "amenity",
          buildingId: "building-1",
          levelRule: { kind: "fixed", label: "North", ordinal: 1 },
          nameField: "NAME",
        }),
        lp({
          key: { databaseId: "gdb-1", layerName: "south_beacon" },
          targetType: "amenity",
          buildingId: "building-1",
          levelRule: { kind: "fixed", label: "South", ordinal: 1 },
          nameField: "NAME",
        }),
      ],
    });
    expect(venue.levels).toHaveLength(1);
    expect(venue.levels[0]?.ordinal).toBe(1);
    expect(venue.levels[0]?.sourceLevelIds).toHaveLength(2);
    const levelFeatures = [...venue.featuresById.values()].filter((f) => f.featureType === "level");
    expect(levelFeatures).toHaveLength(2);
  });
});

describe("buildGdbVenue additional rejections", () => {
  function expectFails(conv: GdbConversionResult, plan: GdbMappingPlan): void {
    let thrown: unknown;
    try {
      buildGdbVenue(conv, plan);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
  }

  it("rejects an added building with no assigned geometry", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: "l1", name: "1F" })]),
    ]);
    expectFails(conv, {
      venueName: "Sta",
      buildings: [
        { id: "building-1", name: "Sta" },
        { id: "building-2", name: "Unused" },
      ],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
      ],
    });
  });

  it("rejects a non-finite fixed ordinal", () => {
    const conv = conversion([
      convLayer("gdb-1", "roof_beacon", [feat(pointGeom(0, 0), { NAME: "X" })]),
    ]);
    expectFails(conv, {
      venueName: "V",
      buildings: [{ id: "building-1", name: "V" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "roof_beacon" },
          targetType: "amenity",
          buildingId: "building-1",
          levelRule: { kind: "fixed", label: "Roof", ordinal: Number.NaN },
          nameField: "NAME",
        }),
      ],
    });
  });
});

describe("buildGdbVenue imported roof level uses fixed label", () => {
  it("labels an R level from its fixed rule when no name is mapped", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_R_level", [feat(square(0, 0), { id: "r1" })]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_R_level" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "fixed", label: "Roof", ordinal: 11 },
          idField: "id",
        }),
      ],
    });
    expect(venue.levels[0]?.ordinal).toBe(11);
    expect(venue.levels[0]?.label).toEqual({ ja: "Roof" });
  });
});

describe("buildGdbVenue coordinate-empty geometry is geometry-less", () => {
  it("fails a coordinate-empty layer even when another layer supplies bounds", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [
        feat({ type: "Polygon", coordinates: [] }, { id: "empty1", name: "1F" }),
      ]),
      convLayer("gdb-1", "Sta_F2_Floor", [feat(square(0, 0), { id: "l2", name: "2F" })]),
    ]);
    let thrown: unknown;
    try {
      buildGdbVenue(conv, {
        venueName: "Sta",
        buildings: [{ id: "building-1", name: "Sta" }],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
            targetType: "level",
            buildingId: "building-1",
            levelRule: { kind: "layer-name" },
            idField: "id",
            nameField: "name",
          }),
          lp({
            key: { databaseId: "gdb-1", layerName: "Sta_F2_Floor" },
            targetType: "level",
            buildingId: "building-1",
            levelRule: { kind: "layer-name" },
            idField: "id",
            nameField: "name",
          }),
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
  });
});

describe("buildGdbVenue cross-set UUID collisions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reassigns a UUID shared by a level and a non-level feature", () => {
    const shared = HYPHEN_UUID;
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: shared, name: "1F" })]),
      convLayer("gdb-1", "beacon", [feat(pointGeom(0.5, 0.5), { uuid: shared, NAME: "B" })]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
        lp({
          key: { databaseId: "gdb-1", layerName: "beacon" },
          targetType: "amenity",
          buildingId: "building-1",
          levelRule: { kind: "fixed", label: "F1", ordinal: 1 },
          idField: "uuid",
          nameField: "NAME",
        }),
      ],
    });
    expect(venue.featuresById.has(shared)).toBe(false);
    const level = findByType(venue, "level");
    const amenity = findByType(venue, "amenity");
    expect(level.id).not.toBe(shared);
    expect(amenity.id).not.toBe(shared);
  });

  it("does not let a generated id consume a reserved count-one source UUID", () => {
    const reserved = "33333333-3333-4333-8333-333333333333";
    let index = 0;
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      index += 1;
      // First generated attempt collides with the reserved source UUID; every
      // later attempt is a distinct value so freshUuid always terminates.
      if (index === 1) return reserved as `${string}-${string}-${string}-${string}-${string}`;
      const suffix = String(index).padStart(12, "0");
      return `00000000-0000-4000-8000-${suffix}` as `${string}-${string}-${string}-${string}-${string}`;
    });
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: reserved, name: "1F" })]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
      ],
    });
    // The level preserves the reserved source UUID; the generated building
    // that tried to grab it (mocked first) was pushed to the next value.
    expect(venue.featuresById.get(reserved)?.featureType).toBe("level");
    const building = findByType(venue, "building");
    expect(building.id).not.toBe(reserved);
    expect(venue.venue.id).not.toBe(reserved);
  });
});

describe("buildGdbVenue layer-derived level label", () => {
  it("labels a layer-name B1 level as B1, not the numeric ordinal", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_B1_Floor", [feat(square(0, 0), { id: "b1" })]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_B1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
        }),
      ],
    });
    expect(venue.levels[0]?.ordinal).toBe(-1);
    expect(venue.levels[0]?.label).toEqual({ ja: "B1" });
  });
});

describe("buildGdbVenue multi-building and non-contiguous ordinals", () => {
  it("preserves distinct building context across levels and units", () => {
    const conv = conversion([
      convLayer("gdb-1", "North_F1_Floor", [
        feat(square(0, 0), { id: "lvl-n", name: "N1F" }),
      ]),
      convLayer("gdb-1", "North_F1_Space", [
        feat(square(0.1, 0.1), { id: "unit-n", NAME: "North Shop" }),
      ]),
      convLayer("gdb-1", "South_B1_Floor", [
        feat(square(10, 10), { id: "lvl-s", name: "SB1" }),
      ]),
      convLayer("gdb-1", "South_B1_Space", [
        feat(square(10.1, 10.1), { id: "unit-s", NAME: "South Shop" }),
      ]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Campus",
      buildings: [
        { id: "building-1", name: "North" },
        { id: "building-2", name: "South" },
      ],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "North_F1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
        lp({
          key: { databaseId: "gdb-1", layerName: "North_F1_Space" },
          targetType: "unit",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "NAME",
        }),
        lp({
          key: { databaseId: "gdb-1", layerName: "South_B1_Floor" },
          targetType: "level",
          buildingId: "building-2",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
        lp({
          key: { databaseId: "gdb-1", layerName: "South_B1_Space" },
          targetType: "unit",
          buildingId: "building-2",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "NAME",
        }),
      ],
    });

    const buildings = [...venue.featuresById.values()].filter((f) => f.featureType === "building");
    expect(buildings).toHaveLength(2);
    expect(buildings.map((b) => b.labels.ja).sort()).toEqual(["North", "South"]);
    expect(buildings.every((b) => b.sourceProperties["venue_id"] === venue.venue.id)).toBe(true);

    const levels = [...venue.featuresById.values()].filter((f) => f.featureType === "level");
    expect(levels).toHaveLength(2);
    const levelByLayer = Object.fromEntries(
      levels.map((level) => [String(level.sourceProperties["__gdb_layer"]), level]),
    );
    expect(levelByLayer["North_F1_Floor"]?.labels.ja).toBe("N1F");
    expect(levelByLayer["South_B1_Floor"]?.labels.ja).toBe("SB1");
    expect(levelByLayer["North_F1_Floor"]?.levelId).toBe("ordinal:1");
    expect(levelByLayer["South_B1_Floor"]?.levelId).toBe("ordinal:-1");

    const units = [...venue.featuresById.values()].filter((f) => f.featureType === "unit");
    expect(units).toHaveLength(2);
    const byName = Object.fromEntries(units.map((u) => [u.labels.ja, u]));
    expect(byName["North Shop"]?.levelId).toBe("ordinal:1");
    expect(byName["South Shop"]?.levelId).toBe("ordinal:-1");
    expect(byName["North Shop"]?.sourceProperties["__gdb_layer"]).toBe("North_F1_Space");
    expect(byName["South Shop"]?.sourceProperties["__gdb_layer"]).toBe("South_B1_Space");
    expect(venue.boundsByLevel.has("ordinal:1")).toBe(true);
    expect(venue.boundsByLevel.has("ordinal:-1")).toBe(true);
  });

  it("keeps non-contiguous ordinals without inventing intermediate floors", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_B3_Floor", [feat(square(0, 0), { id: "b3", name: "B3" })]),
      convLayer("gdb-1", "Sta_F1_Floor", [feat(square(1, 1), { id: "f1", name: "1F" })]),
      convLayer("gdb-1", "Sta_F3_Floor", [feat(square(2, 2), { id: "f3", name: "3F" })]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_B3_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_F3_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
      ],
    });

    // Descending ordinal order with the exact imported set — no B2/B1/F2 fillers.
    expect(venue.levels.map((level) => level.ordinal)).toEqual([3, 1, -3]);
    expect(venue.levels.map((level) => level.id)).toEqual([
      "ordinal:3",
      "ordinal:1",
      "ordinal:-3",
    ]);
    expect(venue.levels).toHaveLength(3);
  });

  it("preserves network fields such as passage_type in source properties", () => {
    const conv = conversion([
      convLayer("gdb-1", "net_path", [
        feat(lineGeom(2, 2), {
          FLOOR: "1F",
          NAME: "Corridor",
          passage_type: "walkway",
          symbol_id: "net-1",
        }),
      ]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "V",
      buildings: [{ id: "building-1", name: "V" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "net_path" },
          targetType: "detail",
          buildingId: "building-1",
          levelRule: { kind: "property", field: "FLOOR" },
          nameField: "NAME",
        }),
      ],
    });
    const detail = findByType(venue, "detail");
    expect(detail.sourceProperties["passage_type"]).toBe("walkway");
    expect(detail.sourceProperties["symbol_id"]).toBe("net-1");
    expect(detail.sourceProperties["FLOOR"]).toBe("1F");
    expect(detail.sourceProperties["__gdb_layer"]).toBe("net_path");
  });
});

describe("buildGdbVenue GeometryCollection normalization", () => {
  function multiPolygon(...squares: GeoJSON.Polygon[]): GeoJSON.MultiPolygon {
    return { type: "MultiPolygon", coordinates: squares.map((s) => s.coordinates) };
  }

  function expectFails(conv: GdbConversionResult, plan: GdbMappingPlan): void {
    let thrown: unknown;
    try {
      buildGdbVenue(conv, plan);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
  }

  const levelPlan = () =>
    lp({
      key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
      targetType: "level",
      buildingId: "building-1",
      levelRule: { kind: "layer-name" },
      idField: "id",
      nameField: "name",
    });

  it("rejects a level GeometryCollection that mixes polygon with line members", () => {
    const gc: GeoJSON.GeometryCollection = {
      type: "GeometryCollection",
      geometries: [square(0, 0), lineGeom(0, 0)],
    };
    expectFails(conversion([convLayer("gdb-1", "Sta_F1_Floor", [feat(gc, { id: "l1", name: "1F" })])]), {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [levelPlan()],
    });
  });

  it("merges two polygon members into one MultiPolygon", () => {
    const gc: GeoJSON.GeometryCollection = {
      type: "GeometryCollection",
      geometries: [square(0, 0), square(2, 2)],
    };
    const venue = buildGdbVenue(conversion([convLayer("gdb-1", "Sta_F1_Floor", [feat(gc, { id: "l1", name: "1F" })])]), {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [levelPlan()],
    });
    const level = findByType(venue, "level");
    expect(level.geometry?.type).toBe("MultiPolygon");
    expect((level.geometry as GeoJSON.MultiPolygon).coordinates).toHaveLength(2);
  });

  it("returns the single MultiPolygon member of a homogeneous unit GeometryCollection", () => {
    const gc: GeoJSON.GeometryCollection = {
      type: "GeometryCollection",
      geometries: [multiPolygon(square(0, 0), square(2, 2))],
    };
    const venue = buildGdbVenue(
      conversion([
        convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: "l1", name: "1F" })]),
        convLayer("gdb-1", "Sta_F1_unit", [feat(gc, { id: "u1", NAME: "Room" })]),
      ]),
      {
        venueName: "Sta",
        buildings: [{ id: "building-1", name: "Sta" }],
        layers: [
          levelPlan(),
          lp({
            key: { databaseId: "gdb-1", layerName: "Sta_F1_unit" },
            targetType: "unit",
            buildingId: "building-1",
            levelRule: { kind: "layer-name" },
            idField: "id",
            nameField: "NAME",
          }),
        ],
      },
    );
    const unit = findByType(venue, "unit");
    expect(unit.geometry?.type).toBe("MultiPolygon");
    expect((unit.geometry as GeoJSON.MultiPolygon).coordinates).toHaveLength(2);
  });

  it("rejects a unit GeometryCollection that mixes MultiPolygon with line members", () => {
    const gc: GeoJSON.GeometryCollection = {
      type: "GeometryCollection",
      geometries: [multiPolygon(square(0, 0), square(2, 2)), lineGeom(0, 0)],
    };
    expectFails(
      conversion([
        convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: "l1", name: "1F" })]),
        convLayer("gdb-1", "Sta_F1_unit", [feat(gc, { id: "u1", NAME: "Room" })]),
      ]),
      {
        venueName: "Sta",
        buildings: [{ id: "building-1", name: "Sta" }],
        layers: [
          levelPlan(),
          lp({
            key: { databaseId: "gdb-1", layerName: "Sta_F1_unit" },
            targetType: "unit",
            buildingId: "building-1",
            levelRule: { kind: "layer-name" },
            idField: "id",
            nameField: "NAME",
          }),
        ],
      },
    );
  });

  it("rejects a GeometryCollection whose only finite members are the wrong family", () => {
    const gc: GeoJSON.GeometryCollection = {
      type: "GeometryCollection",
      geometries: [lineGeom(0, 0)],
    };
    expectFails(conversion([convLayer("gdb-1", "Sta_F1_Floor", [feat(gc, { id: "l1", name: "1F" })])]), {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [levelPlan()],
    });
  });

  it("ignores empty or nonfinite members while normalizing matching polygons", () => {
    const emptyLine: GeoJSON.LineString = { type: "LineString", coordinates: [] };
    const nonfinitePoint: GeoJSON.Point = { type: "Point", coordinates: [Number.NaN, Number.NaN] };
    const gc: GeoJSON.GeometryCollection = {
      type: "GeometryCollection",
      geometries: [emptyLine, nonfinitePoint, square(0, 0), square(2, 2)],
    };
    const venue = buildGdbVenue(conversion([convLayer("gdb-1", "Sta_F1_Floor", [feat(gc, { id: "l1", name: "1F" })])]), {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [levelPlan()],
    });
    const level = findByType(venue, "level");
    expect(level.geometry?.type).toBe("MultiPolygon");
    expect((level.geometry as GeoJSON.MultiPolygon).coordinates).toHaveLength(2);
  });

  it("treats an empty GeometryCollection as geometry-less", () => {
    const gc: GeoJSON.GeometryCollection = { type: "GeometryCollection", geometries: [] };
    expectFails(conversion([convLayer("gdb-1", "Sta_F1_Floor", [feat(gc, { id: "l1", name: "1F" })])]), {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [levelPlan()],
    });
  });
});

describe("buildGdbVenue GeometryCollection failures identify the source feature", () => {
  function caught(fn: () => void): ArchiveError {
    let thrown: unknown;
    try {
      fn();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
    return thrown as ArchiveError;
  }

  it("names the layer and stable feature id for a level GeometryCollection wrong-family member", () => {
    const gc: GeoJSON.GeometryCollection = {
      type: "GeometryCollection",
      geometries: [square(0, 0), lineGeom(0, 0)],
    };
    const feature: GeoJSON.Feature = {
      type: "Feature",
      id: "level-feature-7",
      geometry: gc,
      properties: { id: "l1", name: "1F" },
    };
    const error = caught(() =>
      buildGdbVenue(conversion([convLayer("gdb-1", "Sta_F1_Floor", [feature])]), {
        venueName: "Sta",
        buildings: [{ id: "building-1", name: "Sta" }],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
            targetType: "level",
            buildingId: "building-1",
            levelRule: { kind: "layer-name" },
            idField: "id",
            nameField: "name",
          }),
        ],
      }),
    );
    expect(error.details).toMatchObject({
      reason: "incompatible GeometryCollection member family",
      requiredFamily: "polygon",
      memberType: "LineString",
      databaseId: "gdb-1",
      layerName: "Sta_F1_Floor",
      targetType: "level",
      featureId: "level-feature-7",
    });
    expect(error.details).not.toHaveProperty("featureIndex");
  });

  it("names the layer and feature index for a non-level GeometryCollection wrong-family member", () => {
    const gc: GeoJSON.GeometryCollection = {
      type: "GeometryCollection",
      geometries: [square(0, 0), lineGeom(0, 0)],
    };
    const skipped = feat({ type: "Polygon", coordinates: [] }, { NAME: "skip" });
    const badMember: GeoJSON.Feature = { type: "Feature", geometry: gc, properties: { NAME: "Room" } };
    const error = caught(() =>
      buildGdbVenue(
        conversion([
          convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: "l1", name: "1F" })]),
          convLayer("gdb-1", "Sta_F1_unit", [skipped, badMember]),
        ]),
        {
          venueName: "Sta",
          buildings: [{ id: "building-1", name: "Sta" }],
          layers: [
            lp({
              key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
              targetType: "level",
              buildingId: "building-1",
              levelRule: { kind: "layer-name" },
              idField: "id",
              nameField: "name",
            }),
            lp({
              key: { databaseId: "gdb-1", layerName: "Sta_F1_unit" },
              targetType: "unit",
              buildingId: "building-1",
              levelRule: { kind: "layer-name" },
              nameField: "NAME",
            }),
          ],
        },
      ),
    );
    expect(error.details).toMatchObject({
      reason: "incompatible GeometryCollection member family",
      requiredFamily: "polygon",
      memberType: "LineString",
      databaseId: "gdb-1",
      layerName: "Sta_F1_unit",
      targetType: "unit",
      featureIndex: 1,
    });
    expect(error.details).not.toHaveProperty("featureId");
  });
});

describe("buildGdbVenue empty source-reference fallback", () => {
  it("falls back a null floor_id to the layer's structured floor token", () => {
    const conv = conversion([
      convLayer("gdb-1", "SHINJUKU_LUMINE1_5_unit", [
        feat(square(0, 0), { id: "u1", floor_id: "", NAME: "Shop" }),
      ]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Shinjuku",
      buildings: [{ id: "building-1", name: "SHINJUKU_LUMINE1" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "SHINJUKU_LUMINE1_5_unit" },
          targetType: "unit",
          buildingId: "building-1",
          levelRule: { kind: "source-reference", field: "floor_id" },
          idField: "id",
          nameField: "NAME",
        }),
      ],
    });
    expect(venue.levels.map((l) => l.ordinal)).toEqual([5]);
    const unit = findByType(venue, "unit");
    expect(unit.levelId).toBe("ordinal:5");
  });

  it("fails a tokenless unresolvable source-reference feature", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: HEX32, name: "1F" })]),
      convLayer("gdb-2", "beacon_layer", [
        feat(pointGeom(0.5, 0.5), { id: "a1", floor_id: HEX32, NAME: "Resolved" }),
        feat(pointGeom(1.5, 1.5), { id: "a2", floor_id: "", NAME: "Unresolved" }),
      ]),
    ]);
    let thrown: unknown;
    try {
      buildGdbVenue(conv, {
        venueName: "V",
        buildings: [{ id: "building-1", name: "V" }],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
            targetType: "level",
            buildingId: "building-1",
            levelRule: { kind: "layer-name" },
            idField: "id",
            nameField: "name",
          }),
          lp({
            key: { databaseId: "gdb-2", layerName: "beacon_layer" },
            targetType: "amenity",
            buildingId: "building-1",
            levelRule: { kind: "source-reference", field: "floor_id" },
            idField: "id",
            nameField: "NAME",
          }),
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
    expect((thrown as ArchiveError).details?.["reason"]).toBe("unresolved source-reference level");
    expect((thrown as ArchiveError).details?.["feature"]).toBe("a2");
    expect((thrown as ArchiveError).details?.["reference"]).toBeNull();
  });

  it("still fails a non-null dangling reference when the layer name is tokenless", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: HEX32, name: "1F" })]),
      convLayer("gdb-2", "point_facility", [
        feat(pointGeom(0.5, 0.5), { uuid: "p1", floor_id: "not-a-level", NAME: "X" }),
      ]),
    ]);
    let thrown: unknown;
    try {
      buildGdbVenue(conv, {
        venueName: "Sta",
        buildings: [{ id: "building-1", name: "Sta" }],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
            targetType: "level",
            buildingId: "building-1",
            levelRule: { kind: "layer-name" },
            idField: "id",
            nameField: "name",
          }),
          lp({
            key: { databaseId: "gdb-2", layerName: "point_facility" },
            targetType: "amenity",
            levelRule: { kind: "source-reference", field: "floor_id" },
            idField: "uuid",
            nameField: "NAME",
          }),
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
    expect((thrown as ArchiveError).details?.["reason"]).toBe("unresolved source-reference level");
  });

  it("falls back a dangling non-null reference to the layer token and warns", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: HEX32, name: "1F" })]),
      convLayer("gdb-1", "Sta_2_amenity", [
        feat(pointGeom(0.5, 0.5), {
          uuid: "p1",
          floor_id: "d245627a-5c13-42be-98a6-e5228b70684f",
          NAME: "Kiosk",
        }),
      ]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_2_amenity" },
          targetType: "amenity",
          buildingId: null,
          levelRule: { kind: "source-reference", field: "floor_id" },
          idField: "uuid",
          nameField: "NAME",
        }),
      ],
    });
    expect(venue.levels.map((l) => l.ordinal).sort((a, b) => a - b)).toEqual([1, 2]);
    const amenity = findByType(venue, "amenity");
    expect(amenity.levelId).toBe("ordinal:2");
    expect(
      venue.warnings.some(
        (w) =>
          w.message ===
          "Sta_2_amenity: 1 feature(s) fell back to a resolved floor for unresolved floor references",
      ),
    ).toBe(true);
  });
});

describe("buildGdbVenue null-reference building from structured prefix", () => {
  it("derives the building from the layer prefix when buildingId is null", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_5_unit", [
        feat(square(0, 0), { id: "u1", floor_id: "", NAME: "Shop" }),
      ]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_5_unit" },
          targetType: "unit",
          buildingId: null,
          levelRule: { kind: "source-reference", field: "floor_id" },
          idField: "id",
          nameField: "NAME",
        }),
      ],
    });
    expect(venue.levels.map((l) => l.ordinal)).toEqual([5]);
    const unit = findByType(venue, "unit");
    expect(unit.levelId).toBe("ordinal:5");
  });

  it("still fails when the layer prefix matches no plan building", () => {
    const conv = conversion([
      convLayer("gdb-1", "Other_5_unit", [
        feat(square(0, 0), { id: "u1", floor_id: "", NAME: "X" }),
      ]),
    ]);
    let thrown: unknown;
    try {
      buildGdbVenue(conv, {
        venueName: "Sta",
        buildings: [{ id: "building-1", name: "Sta" }],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "Other_5_unit" },
            targetType: "unit",
            buildingId: null,
            levelRule: { kind: "source-reference", field: "floor_id" },
            idField: "id",
            nameField: "NAME",
          }),
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
    expect((thrown as ArchiveError).details?.["reason"]).toBe("unresolved source-reference level");
  });
});

describe("buildGdbVenue layer-name loose floor tokens", () => {
  it("converts a non-structured Camera_1_nw layer-name rule to ordinal 1", () => {
    const conv = conversion([
      convLayer("gdb-1", "ShinjukuYodobashi_Camera_1_nw", [
        feat(lineGeom(0, 0), { id: "d1" }),
      ]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Shinjuku",
      buildings: [{ id: "building-1", name: "ShinjukuYodobashi" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "ShinjukuYodobashi_Camera_1_nw" },
          targetType: "detail",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
        }),
      ],
    });
    expect(venue.levels.map((l) => l.ordinal)).toEqual([1]);
    expect(findByType(venue, "detail").levelId).toBe("ordinal:1");
  });

  it("converts a non-structured ShinjukuSt_B1_link layer-name rule to ordinal -1", () => {
    const conv = conversion([
      convLayer("gdb-1", "ShinjukuSt_B1_link", [feat(lineGeom(0, 0), { id: "d1" })]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Shinjuku",
      buildings: [{ id: "building-1", name: "ShinjukuSt" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "ShinjukuSt_B1_link" },
          targetType: "detail",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
        }),
      ],
    });
    expect(venue.levels.map((l) => l.ordinal)).toEqual([-1]);
    expect(findByType(venue, "detail").levelId).toBe("ordinal:-1");
  });

  it("keeps structured Station_2_R_level unresolved with no prefix-digit fallback", () => {
    const conv = conversion([
      convLayer("gdb-1", "Station_2_R_level", [
        feat(square(0, 0), { id: "r1", name: "Roof" }),
      ]),
    ]);
    let thrown: unknown;
    try {
      buildGdbVenue(conv, {
        venueName: "Station",
        buildings: [{ id: "building-1", name: "Station_2" }],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "Station_2_R_level" },
            targetType: "level",
            buildingId: "building-1",
            levelRule: { kind: "layer-name" },
            idField: "id",
            nameField: "name",
          }),
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
    expect((thrown as ArchiveError).details?.["reason"]).toBe("unresolved level ordinal");
  });

  it("keeps structured R unit layer-name unresolved despite digits in the prefix", () => {
    const conv = conversion([
      convLayer("gdb-1", "Station_2_R_unit", [feat(square(0, 0), { id: "u1", NAME: "Roof" })]),
    ]);
    let thrown: unknown;
    try {
      buildGdbVenue(conv, {
        venueName: "Station",
        buildings: [{ id: "building-1", name: "Station_2" }],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "Station_2_R_unit" },
            targetType: "unit",
            buildingId: "building-1",
            levelRule: { kind: "layer-name" },
            idField: "id",
            nameField: "NAME",
          }),
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
    expect((thrown as ArchiveError).details?.["reason"]).toBe("unresolved feature floor");
  });
});

describe("buildGdbVenue property-rule per-feature floor skip", () => {
  it("fails a property feature whose floor value and layer token are unresolvable", () => {
    const conv = conversion([
      convLayer("gdb-1", "net_junction", [
        feat(pointGeom(0, 0), { id: "a1", FLOOR: "1F", NAME: "J1" }),
        feat(pointGeom(1, 1), { id: "a2", FLOOR: "", NAME: "J2" }),
        feat(pointGeom(2, 2), { id: "a3", FLOOR: "lobby", NAME: "J3" }),
      ]),
    ]);
    let thrown: unknown;
    try {
      buildGdbVenue(conv, {
        venueName: "Sta",
        buildings: [{ id: "building-1", name: "Sta" }],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "net_junction" },
            targetType: "amenity",
            buildingId: "building-1",
            levelRule: { kind: "property", field: "FLOOR" },
            idField: "id",
            nameField: "NAME",
          }),
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
    expect((thrown as ArchiveError).details?.["reason"]).toBe("unresolved feature floor");
    expect((thrown as ArchiveError).details?.["feature"]).toBe("a2");
  });

  it("still fails an all-blank property layer as geometry-less", () => {
    const conv = conversion([
      convLayer("gdb-1", "net_junction", [
        feat(pointGeom(0, 0), { id: "a1", FLOOR: "", NAME: "J1" }),
        feat(pointGeom(1, 1), { id: "a2", FLOOR: "", NAME: "J2" }),
      ]),
    ]);
    let thrown: unknown;
    try {
      buildGdbVenue(conv, {
        venueName: "Sta",
        buildings: [{ id: "building-1", name: "Sta" }],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "net_junction" },
            targetType: "amenity",
            buildingId: "building-1",
            levelRule: { kind: "property", field: "FLOOR" },
            idField: "id",
            nameField: "NAME",
          }),
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
  });
});

describe("buildGdbVenue complete per-feature level resolution chain", () => {
  it("resolves a property-rule feature via a raw floor_id before the property", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: HEX32, name: "1F" })]),
      convLayer("gdb-1", "poi", [
        feat(pointGeom(0.5, 0.5), { id: "a1", FLOOR: "", floor_id: HEX32, NAME: "X" }),
      ]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
        lp({
          key: { databaseId: "gdb-1", layerName: "poi" },
          targetType: "amenity",
          buildingId: "building-1",
          levelRule: { kind: "property", field: "FLOOR" },
          idField: "id",
          nameField: "NAME",
        }),
      ],
    });
    const amenity = findByType(venue, "amenity");
    expect(amenity.levelId).toBe("ordinal:1");
    expect(amenity.sourceProperties["__gdb_resolved_level_id"]).toBe(HEX32_AS_UUID);
  });

  it("resolves a property-rule blank value via the layer token", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_2_amenity", [
        feat(pointGeom(0, 0), { id: "a1", FLOOR: "", NAME: "X" }),
      ]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_2_amenity" },
          targetType: "amenity",
          buildingId: "building-1",
          levelRule: { kind: "property", field: "FLOOR" },
          idField: "id",
          nameField: "NAME",
        }),
      ],
    });
    expect(venue.levels.map((l) => l.ordinal)).toEqual([2]);
    expect(findByType(venue, "amenity").levelId).toBe("ordinal:2");
  });

  it("fails a chain-exhausted property feature", () => {
    const conv = conversion([
      convLayer("gdb-1", "net_junction", [
        feat(pointGeom(0, 0), { id: "a1", FLOOR: "1F", NAME: "Keep" }),
        feat(pointGeom(1, 1), { id: "a2", FLOOR: "", NAME: "Drop" }),
      ]),
    ]);
    let thrown: unknown;
    try {
      buildGdbVenue(conv, {
        venueName: "V",
        buildings: [{ id: "building-1", name: "V" }],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "net_junction" },
            targetType: "amenity",
            buildingId: "building-1",
            levelRule: { kind: "property", field: "FLOOR" },
            idField: "id",
            nameField: "NAME",
          }),
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
    expect((thrown as ArchiveError).details?.["reason"]).toBe("unresolved feature floor");
  });
});

describe("buildGdbVenue source-reference floor-property fallback", () => {
  it("resolves a blank source reference by the floor property with an explicit building", () => {
    const conv = conversion([
      convLayer("gdb-1", "Facility_Merge", [
        feat(pointGeom(0, 0), { id: "f1", floor_id: "", floor: "B1", NAME: "Kiosk" }),
      ]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Facility_Merge" },
          targetType: "amenity",
          buildingId: "building-1",
          levelRule: { kind: "source-reference", field: "floor_id" },
          idField: "id",
          nameField: "NAME",
        }),
      ],
    });
    expect(venue.levels.map((l) => l.ordinal)).toEqual([-1]);
    expect(findByType(venue, "amenity").levelId).toBe("ordinal:-1");
  });

  it("hard-fails when reference, floor property, and layer token all fail", () => {
    const conv = conversion([
      convLayer("gdb-1", "Facility_Merge", [
        feat(pointGeom(0, 0), { id: "f1", floor_id: "", floor: "", NAME: "X" }),
      ]),
    ]);
    let thrown: unknown;
    try {
      buildGdbVenue(conv, {
        venueName: "Sta",
        buildings: [{ id: "building-1", name: "Sta" }],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "Facility_Merge" },
            targetType: "amenity",
            buildingId: "building-1",
            levelRule: { kind: "source-reference", field: "floor_id" },
            idField: "id",
            nameField: "NAME",
          }),
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
    expect((thrown as ArchiveError).details?.["reason"]).toBe("unresolved source-reference level");
    expect((thrown as ArchiveError).details?.["feature"]).toBe("f1");
    expect((thrown as ArchiveError).details?.["reference"]).toBeNull();
  });

  it("resolves a blank source reference when the floor property is a global level reference", () => {
    const conv = conversion([
      convLayer("gdb-1", "Sta_F1_Floor", [feat(square(0, 0), { id: HEX32, name: "1F" })]),
      convLayer("gdb-2", "Facility_Merge", [
        feat(pointGeom(0.5, 0.5), { id: "f1", floor_id: "", floor: HEX32, NAME: "Kiosk" }),
      ]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
        lp({
          key: { databaseId: "gdb-2", layerName: "Facility_Merge" },
          targetType: "amenity",
          buildingId: null,
          levelRule: { kind: "source-reference", field: "floor_id" },
          idField: "id",
          nameField: "NAME",
        }),
      ],
    });
    expect(findByType(venue, "amenity").levelId).toBe("ordinal:1");
  });

  it("hard-fails a blank ref + floor ordinal when no building is identifiable", () => {
    const conv = conversion([
      convLayer("gdb-1", "Facility_Merge", [
        feat(pointGeom(0, 0), { id: "f1", floor_id: "", floor: "B1", NAME: "Kiosk" }),
      ]),
    ]);
    let thrown: unknown;
    try {
      buildGdbVenue(conv, {
        venueName: "Sta",
        buildings: [{ id: "building-1", name: "Sta" }],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "Facility_Merge" },
            targetType: "amenity",
            buildingId: null,
            levelRule: { kind: "source-reference", field: "floor_id" },
            idField: "id",
            nameField: "NAME",
          }),
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
    expect((thrown as ArchiveError).details?.["reason"]).toBe("unresolved source-reference level");
    expect((thrown as ArchiveError).details?.["feature"]).toBe("f1");
  });
});

describe("buildGdbVenue source-reference spatial containment fallback", () => {
  function twoBuildingConv(poi: GeoJSON.Feature, bGeom: GeoJSON.Polygon): GdbConversionResult {
    return conversion([
      convLayer("gdb-1", "BldgA_F1_Floor", [feat(square(0, 0), { id: HEX32, name: "F1" })]),
      convLayer("gdb-1", "BldgB_F1_Floor", [feat(bGeom, { id: HYPHEN_UUID, name: "F1" })]),
      convLayer("gdb-2", "Facility_Merge", [poi]),
    ]);
  }
  const twoBuildingPlan: GdbMappingPlan = {
    venueName: "V",
    buildings: [
      { id: "building-1", name: "BldgA" },
      { id: "building-2", name: "BldgB" },
    ],
    layers: [
      lp({
        key: { databaseId: "gdb-1", layerName: "BldgA_F1_Floor" },
        targetType: "level",
        buildingId: "building-1",
        levelRule: { kind: "layer-name" },
        idField: "id",
        nameField: "name",
      }),
      lp({
        key: { databaseId: "gdb-1", layerName: "BldgB_F1_Floor" },
        targetType: "level",
        buildingId: "building-2",
        levelRule: { kind: "layer-name" },
        idField: "id",
        nameField: "name",
      }),
      lp({
        key: { databaseId: "gdb-2", layerName: "Facility_Merge" },
        targetType: "amenity",
        buildingId: null,
        levelRule: { kind: "source-reference", field: "floor_id" },
        idField: "id",
        nameField: "NAME",
      }),
    ],
  };

  function expectHardFail(conv: GdbConversionResult): void {
    let thrown: unknown;
    try {
      buildGdbVenue(conv, twoBuildingPlan);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
    expect((thrown as ArchiveError).details?.["reason"]).toBe("unresolved source-reference level");
  }

  it("resolves to the single building whose floor polygon contains the point", () => {
    const poi = feat(pointGeom(0.5, 0.5), { id: "f1", floor_id: "", floor: "F1", NAME: "Kiosk" });
    const venue = buildGdbVenue(twoBuildingConv(poi, square(10, 10)), twoBuildingPlan);
    const amenity = findByType(venue, "amenity");
    expect(amenity.levelId).toBe("ordinal:1");
    expect(amenity.sourceProperties["__gdb_resolved_level_id"]).toBe(HEX32_AS_UUID);
  });

  it("treats a point on the polygon boundary as inside", () => {
    const poi = feat({ type: "Point", coordinates: [1, 0.5] }, {
      id: "f1",
      floor_id: "",
      floor: "F1",
      NAME: "Kiosk",
    });
    const venue = buildGdbVenue(twoBuildingConv(poi, square(10, 10)), twoBuildingPlan);
    expect(findByType(venue, "amenity").sourceProperties["__gdb_resolved_level_id"]).toBe(
      HEX32_AS_UUID,
    );
  });

  it("hard-fails when two buildings' floor polygons both contain the point", () => {
    const poi = feat(pointGeom(0.5, 0.5), { id: "f1", floor_id: "", floor: "F1", NAME: "Kiosk" });
    // BldgB F1 overlaps BldgA F1, so the point falls in both buildings.
    expectHardFail(twoBuildingConv(poi, square(0, 0)));
  });

  it("hard-fails when the point is outside every floor polygon", () => {
    const poi = feat(pointGeom(100, 100), { id: "f1", floor_id: "", floor: "F1", NAME: "Kiosk" });
    expectHardFail(twoBuildingConv(poi, square(10, 10)));
  });

  it("hard-fails a MultiPoint feature (spatial fallback is Point-only)", () => {
    // Even though both sub-points fall inside BldgA, a MultiPoint has no single
    // defensible location, so it must not be placed spatially.
    const poi = feat({ type: "MultiPoint", coordinates: [[0.4, 0.4], [0.6, 0.6]] }, {
      id: "f1",
      floor_id: "",
      floor: "F1",
      NAME: "Kiosk",
    });
    expectHardFail(twoBuildingConv(poi, square(10, 10)));
  });
});

describe("buildGdbVenue reviewed building precedence and building resolution", () => {
  it("keeps the explicit reviewed building even when another building contains the point", () => {
    const conv = conversion([
      convLayer("gdb-1", "BldgA_F1_Floor", [feat(square(0, 0), { id: HEX32, name: "F1" })]),
      convLayer("gdb-1", "BldgB_F1_Floor", [feat(square(10, 10), { id: HYPHEN_UUID, name: "F1" })]),
      convLayer("gdb-2", "Facility_Merge", [
        feat(pointGeom(10.5, 10.5), { id: "f1", floor_id: "", floor: "F1", NAME: "Kiosk" }),
      ]),
    ]);
    const venue = buildGdbVenue(conv, {
      venueName: "V",
      buildings: [
        { id: "building-1", name: "BldgA" },
        { id: "building-2", name: "BldgB" },
      ],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "BldgA_F1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
        lp({
          key: { databaseId: "gdb-1", layerName: "BldgB_F1_Floor" },
          targetType: "level",
          buildingId: "building-2",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
        lp({
          key: { databaseId: "gdb-2", layerName: "Facility_Merge" },
          targetType: "amenity",
          buildingId: "building-1",
          levelRule: { kind: "source-reference", field: "floor_id" },
          idField: "id",
          nameField: "NAME",
        }),
      ],
    });
    // The point sits inside BldgB's F1, but the reviewed building (BldgA) wins.
    expect(findByType(venue, "amenity").sourceProperties["__gdb_resolved_level_id"]).toBe(
      HEX32_AS_UUID,
    );
  });

  it("throws unknown building id for a non-null buildingId absent from the plan", () => {
    const conv = conversion([
      convLayer("gdb-1", "Facility_Merge", [
        feat(pointGeom(0, 0), { id: "f1", floor_id: "", floor: "F1", NAME: "X" }),
      ]),
    ]);
    let thrown: unknown;
    try {
      buildGdbVenue(conv, {
        venueName: "V",
        buildings: [{ id: "building-1", name: "V" }],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "Facility_Merge" },
            targetType: "amenity",
            buildingId: "building-99",
            levelRule: { kind: "source-reference", field: "floor_id" },
            idField: "id",
            nameField: "NAME",
          }),
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
    expect((thrown as ArchiveError).details?.["reason"]).toBe("unknown building id");
  });

  it("hard-fails a null-building prefix that matches more than one plan building", () => {
    const conv = conversion([
      convLayer("gdb-1", "Dup_5_unit", [feat(square(0, 0), { id: "u1", floor_id: "", NAME: "Room" })]),
    ]);
    let thrown: unknown;
    try {
      buildGdbVenue(conv, {
        venueName: "V",
        buildings: [
          { id: "building-1", name: "Dup" },
          { id: "building-2", name: "dup" },
        ],
        layers: [
          lp({
            key: { databaseId: "gdb-1", layerName: "Dup_5_unit" },
            targetType: "unit",
            buildingId: null,
            levelRule: { kind: "source-reference", field: "floor_id" },
            idField: "id",
            nameField: "NAME",
          }),
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArchiveError);
    expect((thrown as ArchiveError).code).toBe("gdb_conversion_failed");
    expect((thrown as ArchiveError).details?.["reason"]).toBe("unresolved source-reference level");
  });
});

describe("buildGdbVenue warning propagation", () => {
  it("emits one skipped-geometry warning per layer and dedupes worker warnings", () => {
    const conv: GdbConversionResult = {
      layers: [
        {
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          featureCollection: {
            type: "FeatureCollection",
            features: [feat(square(0, 0), { id: HEX32, name: "1F" })],
          },
          skippedGeometryCount: 3,
        },
      ],
      warnings: ["GDAL: reprojected layer", "GDAL: reprojected layer"],
    };
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
      ],
    });
    const skipped = venue.warnings.filter((w) => w.code === "gdb_geometry_skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.message).toBe(
      "gdb-1/Sta_F1_Floor: 3 feature(s) skipped for missing geometry",
    );
    const worker = venue.warnings.filter((w) => w.code === "gdb_worker_warning");
    expect(worker).toHaveLength(1);
    expect(worker[0]!.message).toBe("GDAL: reprojected layer");
  });

  it("emits no skipped-geometry or worker warnings when there are none", () => {
    const conv: GdbConversionResult = {
      layers: [
        {
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          featureCollection: {
            type: "FeatureCollection",
            features: [feat(square(0, 0), { id: HEX32, name: "1F" })],
          },
          skippedGeometryCount: 0,
        },
      ],
      warnings: [],
    };
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
      ],
    });
    expect(venue.warnings.some((w) => w.code === "gdb_geometry_skipped")).toBe(false);
    expect(venue.warnings.some((w) => w.code === "gdb_worker_warning")).toBe(false);
  });

  it("filters the worker's raw skip string covered by a structured count", () => {
    const conv: GdbConversionResult = {
      layers: [
        {
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          featureCollection: {
            type: "FeatureCollection",
            features: [feat(square(0, 0), { id: HEX32, name: "1F" })],
          },
          skippedGeometryCount: 2,
        },
      ],
      warnings: ['Layer "Sta_F1_Floor" skipped 2 feature(s) without geometry.', "GDAL: reprojected"],
    };
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
      ],
    });
    expect(venue.warnings.filter((w) => w.code === "gdb_geometry_skipped")).toHaveLength(1);
    const worker = venue.warnings.filter((w) => w.code === "gdb_worker_warning");
    expect(worker.map((w) => w.message)).toEqual(["GDAL: reprojected"]);
  });

  it("emits no structured skip warning for an excluded layer with a converted count", () => {
    const conv: GdbConversionResult = {
      layers: [
        {
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          featureCollection: {
            type: "FeatureCollection",
            features: [feat(square(0, 0), { id: HEX32, name: "1F" })],
          },
          skippedGeometryCount: 0,
        },
        {
          key: { databaseId: "gdb-1", layerName: "Extra_F1_Space" },
          featureCollection: {
            type: "FeatureCollection",
            features: [feat(square(2, 2), { id: "u1", NAME: "Room" })],
          },
          skippedGeometryCount: 5,
        },
      ],
      warnings: [],
    };
    const venue = buildGdbVenue(conv, {
      venueName: "Sta",
      buildings: [{ id: "building-1", name: "Sta" }],
      layers: [
        lp({
          key: { databaseId: "gdb-1", layerName: "Sta_F1_Floor" },
          targetType: "level",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "name",
        }),
        lp({
          key: { databaseId: "gdb-1", layerName: "Extra_F1_Space" },
          included: false,
          targetType: "unit",
          buildingId: "building-1",
          levelRule: { kind: "layer-name" },
          idField: "id",
          nameField: "NAME",
        }),
      ],
    });
    expect(venue.warnings.some((w) => w.code === "gdb_geometry_skipped")).toBe(false);
  });
});

describe("suggestGdbMapping preserves structured source-reference building", () => {
  it("keeps a structured source-reference row's building so a rename survives", () => {
    const insp = inspect([layer("North_F1_amenity", "point", 4, ["floor_id", "FLOOR", "NAME"])]);
    const plan = suggestGdbMapping(insp);
    const poi = plan.layers.find((l) => l.key.layerName === "North_F1_amenity")!;
    expect(poi.levelRule).toEqual({ kind: "source-reference", field: "floor_id" });
    expect(poi.buildingId).toBe("building-1");

    // A flat POI layer (no structured prefix) still leaves the building null.
    const flat = suggestGdbMapping(inspect([layer("Facility_Merge", "point", 4, ["floor_id"])]));
    expect(flat.layers[0]!.buildingId).toBeNull();

    // Rename the building; the preserved building id keeps the blank-reference
    // FLOOR fallback resolving to the renamed building.
    const renamed: GdbMappingPlan = {
      ...plan,
      buildings: plan.buildings.map((b) => ({ ...b, name: "North Tower" })),
    };
    const conv = conversion([
      convLayer("gdb-1", "North_F1_amenity", [
        feat(pointGeom(0, 0), { floor_id: "", FLOOR: "F1", NAME: "Kiosk" }),
      ]),
    ]);
    const venue = buildGdbVenue(conv, renamed);
    expect(findByType(venue, "amenity").levelId).toBe("ordinal:1");
  });
});
