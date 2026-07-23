import { describe, expect, it } from "vitest";
import { buildNetworkFeatures, floorLabelToOrdinal, parseNetworkOverlay } from "./networkFeatures";

describe("floorLabelToOrdinal", () => {
  it("inverts the exported floor labels", () => {
    expect(floorLabelToOrdinal("F1")).toBe(0);
    expect(floorLabelToOrdinal("F9")).toBe(8);
    expect(floorLabelToOrdinal("B1")).toBe(-1);
    expect(floorLabelToOrdinal("B3")).toBe(-3);
    expect(floorLabelToOrdinal("M2")).toBe(2);
    expect(floorLabelToOrdinal("garbage")).toBeNull();
    expect(floorLabelToOrdinal("")).toBeNull();
  });
});

const DTO = {
  junctions: JSON.stringify({
    type: "FeatureCollection",
    name: "net_junction",
    features: [
      { type: "Feature", properties: { NODEID: 0, FLOOR: "F1" }, geometry: { type: "Point", coordinates: [139.7, 35.69] } },
      { type: "Feature", properties: { NODEID: 1, FLOOR: "B1" }, geometry: { type: "Point", coordinates: [139.7, 35.69] } },
    ],
  }),
  paths: JSON.stringify({
    type: "FeatureCollection",
    name: "net_path",
    features: [
      { type: "Feature", properties: { FNODEID: 0, TNODEID: 1, FLOOR: "F1" }, geometry: { type: "LineString", coordinates: [[139.7, 35.69], [139.701, 35.69]] } },
      { type: "Feature", properties: { FNODEID: 2, TNODEID: 3, FLOOR: "B1" }, geometry: { type: "LineString", coordinates: [[139.7, 35.69], [139.701, 35.69]] } },
    ],
  }),
};

describe("parseNetworkOverlay + buildNetworkFeatures", () => {
  it("filters junctions and paths to the active floor ordinal", () => {
    const parsed = parseNetworkOverlay(DTO);
    expect(parsed.junctions).toHaveLength(2);
    expect(parsed.paths).toHaveLength(2);

    const f1 = buildNetworkFeatures(parsed, 0);
    // one path + one junction on F1 (ordinal 0)
    expect(f1.features).toHaveLength(2);
    expect(f1.features.filter((f) => f.properties?.kind === "path")).toHaveLength(1);
    expect(f1.features.filter((f) => f.properties?.kind === "junction")).toHaveLength(1);

    const b1 = buildNetworkFeatures(parsed, -1);
    expect(b1.features).toHaveLength(2);

    // A floor with no network features yields an empty collection.
    expect(buildNetworkFeatures(parsed, 5).features).toHaveLength(0);
  });

  it("returns an empty collection for a null network", () => {
    expect(buildNetworkFeatures(null, 0).features).toHaveLength(0);
  });
});
