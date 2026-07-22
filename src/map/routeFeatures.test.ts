import { describe, expect, it } from "vitest";
import { buildRouteFeatures } from "./routeFeatures";
import type { RouteResultDto } from "../bundle/wasm";

const route: RouteResultDto = {
  segments: [
    { ordinal: 0, coordinates: [[139.0, 35.0], [139.001, 35.001], [139.002, 35.0]] },
    { ordinal: 1, coordinates: [[139.002, 35.0], [139.003, 35.0]] },
  ],
  totalWeight: 42,
  originProjected: [139.0, 35.0, 0],
  destProjected: [139.003, 35.0, 1],
};

const input = {
  origin: { longitude: 138.9, latitude: 34.9, ordinal: 0 },
  destination: { longitude: 139.1, latitude: 35.1, ordinal: 1 },
  route,
};

describe("buildRouteFeatures corridor rendering", () => {
  it("draws the real corridor polyline for the active floor", () => {
    const fc = buildRouteFeatures(input, 0);
    const seg = fc.features.find((f) => f.properties?.["kind"] === "segment");
    expect(seg).toBeDefined();
    expect((seg!.geometry as GeoJSON.LineString).coordinates).toEqual([
      [139.0, 35.0],
      [139.001, 35.001],
      [139.002, 35.0],
    ]);
  });

  it("draws a connector from the click to the projected origin on its floor", () => {
    const fc = buildRouteFeatures(input, 0);
    const connector = fc.features.find((f) => f.properties?.["kind"] === "connector");
    expect((connector!.geometry as GeoJSON.LineString).coordinates).toEqual([
      [138.9, 34.9],
      [139.0, 35.0],
    ]);
  });

  it("hides other floors' segments and connectors", () => {
    const fc = buildRouteFeatures(input, 1);
    const kinds = fc.features.map((f) => f.properties?.["kind"]).sort();
    // Only the ordinal-1 segment + the dest connector + the dest point.
    expect(kinds).toEqual(["connector", "destination", "segment"]);
  });
});
