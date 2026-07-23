import { describe, expect, it } from "vitest";
import { networkConnectivity, type ParsedNetwork } from "./networkFeatures";

function junction(id: number, ordinal: number): ParsedNetwork["junctions"][number] {
  return {
    ordinal,
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: { NODEID: id, FLOOR: "F1" },
  };
}
function path(from: number, to: number, ordinal: number): ParsedNetwork["paths"][number] {
  return {
    ordinal,
    geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
    properties: { FNODEID: from, TNODEID: to, FLOOR: "F1" },
  };
}

describe("networkConnectivity", () => {
  it("counts components, largest fraction, floors in largest, and isolated nodes", () => {
    // 0-1-2 connected (0/1 on floor 0, 2 on floor 1), 3 isolated, 4-5 an island.
    const net: ParsedNetwork = {
      junctions: [junction(0, 0), junction(1, 0), junction(2, 1), junction(3, 0), junction(4, 0), junction(5, 0)],
      paths: [path(0, 1, 0), path(1, 0, 0), path(1, 2, 0), path(4, 5, 0)],
    };
    const r = networkConnectivity(net);
    expect(r.nodes).toBe(6);
    expect(r.components).toBe(3); // {0,1,2}, {3}, {4,5}
    expect(r.largestFraction).toBeCloseTo(3 / 6, 5);
    expect(r.floorsInLargest).toBe(2); // ordinals 0 and 1
    expect(r.isolated).toBe(1); // node 3
  });

  it("returns a zeroed report for an empty network", () => {
    const r = networkConnectivity({ junctions: [], paths: [] });
    expect(r).toEqual({
      nodes: 0,
      edges: 0,
      components: 0,
      largestFraction: 0,
      floorsInLargest: 0,
      isolated: 0,
    });
  });
});
