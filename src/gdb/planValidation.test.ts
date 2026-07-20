import { describe, expect, it } from "vitest";
import {
  collectBlockingIssues,
  gdbTargetTypesForGeometry,
  isGdbTargetGeometryCompatible,
  layerNameFloorOrdinal,
} from "./planValidation";
import { gdbLayerKeyString, type GdbLayerDescriptor, type GdbMappingPlan } from "./types";

function descriptor(name: string, family: GdbLayerDescriptor["geometryFamily"], fields: string[]): GdbLayerDescriptor {
  return {
    key: { databaseId: "gdb-1", layerName: name },
    databaseName: "db",
    featureCount: 1,
    geometryFamily: family,
    fields: fields.map((f) => ({ name: f, type: "String" })),
  };
}

describe("geometry compatibility", () => {
  it("matches target types to geometry families", () => {
    expect(isGdbTargetGeometryCompatible("level", "polygon")).toBe(true);
    expect(isGdbTargetGeometryCompatible("level", "point")).toBe(false);
    expect(gdbTargetTypesForGeometry("point")).toEqual(["amenity", "occupant"]);
    expect(gdbTargetTypesForGeometry("mixed")).toEqual([]);
  });
});

describe("floor ordinal", () => {
  it("reads the structured floor token", () => {
    expect(layerNameFloorOrdinal("Station_B1_Floor")).toBe(-1);
    expect(layerNameFloorOrdinal("Station_5_Space")).toBe(5);
    expect(layerNameFloorOrdinal("Station_R_Floor")).toBeNull();
  });
});

describe("collectBlockingIssues", () => {
  const d = descriptor("Station_1_Floor", "polygon", ["id"]);
  const map = new Map([[gdbLayerKeyString(d.key), d]]);
  const basePlan: GdbMappingPlan = {
    venueName: "Station",
    buildings: [{ id: "b1", name: "Station" }],
    layers: [
      {
        key: d.key, included: true, targetType: "level", buildingId: "b1",
        levelRule: { kind: "layer-name" }, idField: "id",
        ordinalField: null, shortNameField: null, nameField: null, categoryField: null,
      },
    ],
  };

  it("returns no issues for a resolvable level", () => {
    expect(collectBlockingIssues(basePlan, map, "en")).toEqual([]);
  });

  it("flags a level with no assigned building", () => {
    const plan = { ...basePlan, layers: [{ ...basePlan.layers[0]!, buildingId: null }] };
    expect(collectBlockingIssues(plan, map, "en").length).toBe(1);
  });

  it("flags a target type incompatible with the geometry", () => {
    const plan = { ...basePlan, layers: [{ ...basePlan.layers[0]!, targetType: "amenity" as const }] };
    expect(collectBlockingIssues(plan, map, "en")[0]).toContain("incompatible");
  });
});
