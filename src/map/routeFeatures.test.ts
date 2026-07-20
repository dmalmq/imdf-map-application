import { describe, expect, it } from "vitest";
import { buildRouteFeatures } from "./routeFeatures";

const ORIGIN_F0 = { longitude: 139.0, latitude: 35.0, ordinal: 0 };
const DESTINATION_F1 = { longitude: 139.002, latitude: 35.002, ordinal: 1 };

/** A route that walks two nodes on floor 0, hops, then walks two on floor 1. */
const CROSS_FLOOR_ROUTE = {
  nodes: [
    { lon: 139.0, lat: 35.0, ordinal: 0 },
    { lon: 139.001, lat: 35.0, ordinal: 0 },
    { lon: 139.001, lat: 35.001, ordinal: 1 },
    { lon: 139.002, lat: 35.002, ordinal: 1 },
  ],
  totalWeight: 240,
};

describe("buildRouteFeatures", () => {
  it("returns an empty collection when there is nothing to draw", () => {
    expect(buildRouteFeatures(null, 0)).toEqual({ type: "FeatureCollection", features: [] });
    expect(
      buildRouteFeatures({ origin: null, destination: null, route: null }, 0),
    ).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("renders only the active floor's segments as line features", () => {
    const floor0 = buildRouteFeatures(
      { origin: ORIGIN_F0, destination: DESTINATION_F1, route: CROSS_FLOOR_ROUTE },
      0,
    );
    const segments = floor0.features.filter((f) => f.properties?.["kind"] === "segment");
    expect(segments).toHaveLength(1);
    expect(segments[0]!.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [139.0, 35.0],
        [139.001, 35.0],
      ],
    });

    const floor1 = buildRouteFeatures(
      { origin: ORIGIN_F0, destination: DESTINATION_F1, route: CROSS_FLOOR_ROUTE },
      1,
    );
    const segments1 = floor1.features.filter((f) => f.properties?.["kind"] === "segment");
    expect(segments1).toHaveLength(1);
    expect(segments1[0]!.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [139.001, 35.001],
        [139.002, 35.002],
      ],
    });
  });

  it("splits disjoint same-floor runs into separate line features", () => {
    const route = {
      nodes: [
        { lon: 0, lat: 0, ordinal: 0 },
        { lon: 1, lat: 0, ordinal: 0 },
        { lon: 1, lat: 1, ordinal: 1 },
        { lon: 2, lat: 1, ordinal: 1 },
        { lon: 2, lat: 2, ordinal: 0 },
        { lon: 3, lat: 2, ordinal: 0 },
      ],
      totalWeight: 3,
    };
    const fc = buildRouteFeatures({ origin: null, destination: null, route }, 0);
    const segments = fc.features.filter((f) => f.properties?.["kind"] === "segment");
    expect(segments).toHaveLength(2);
    expect(segments[0]!.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 0],
      ],
    });
    expect(segments[1]!.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [2, 2],
        [3, 2],
      ],
    });
  });

  it("drops a run with a single node on the active floor (no drawable segment)", () => {
    const route = {
      nodes: [
        { lon: 0, lat: 0, ordinal: 1 },
        { lon: 1, lat: 1, ordinal: 0 },
        { lon: 2, lat: 2, ordinal: 1 },
      ],
      totalWeight: 2,
    };
    const fc = buildRouteFeatures({ origin: null, destination: null, route }, 0);
    expect(fc.features.filter((f) => f.properties?.["kind"] === "segment")).toHaveLength(0);
  });

  it("marks origin and destination points, each only on its own floor", () => {
    const floor0 = buildRouteFeatures(
      { origin: ORIGIN_F0, destination: DESTINATION_F1, route: null },
      0,
    );
    expect(floor0.features).toHaveLength(1);
    expect(floor0.features[0]).toEqual({
      type: "Feature",
      properties: { kind: "origin" },
      geometry: { type: "Point", coordinates: [139.0, 35.0] },
    });

    const floor1 = buildRouteFeatures(
      { origin: ORIGIN_F0, destination: DESTINATION_F1, route: null },
      1,
    );
    expect(floor1.features).toHaveLength(1);
    expect(floor1.features[0]).toEqual({
      type: "Feature",
      properties: { kind: "destination" },
      geometry: { type: "Point", coordinates: [139.002, 35.002] },
    });
  });
});
