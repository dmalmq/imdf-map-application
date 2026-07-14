import { describe, expect, it } from "vitest";
import type { LoadedVenue, ViewerFeature } from "../imdf/types";
import { buildRenderFeatures } from "./buildRenderFeatures";

function feature(id: string, featureType: ViewerFeature["featureType"]): ViewerFeature {
  return {
    id,
    featureType,
    levelId: null,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [139.7, 35.6],
          [139.8, 35.6],
          [139.8, 35.7],
          [139.7, 35.7],
          [139.7, 35.6],
        ],
      ],
    },
    center: [139.75, 35.65],
    labels: {},
    altLabels: {},
    category: null,
    accessibility: [],
    restriction: null,
    sourceProperties: {},
  };
}

describe("buildRenderFeatures", () => {
  it("keeps venue/building context but omits footprint geometry", () => {
    const venueFeature = feature("venue", "venue");
    const building = feature("building", "building");
    const footprint = feature("footprint", "footprint");
    const venue = {
      manifest: { version: "1.0.0", language: "en" },
      venue: venueFeature,
      levels: [],
      featuresById: new Map([
        [venueFeature.id, venueFeature],
        [building.id, building],
        [footprint.id, footprint],
      ]),
      renderFeaturesByLevel: new Map(),
      searchEntries: [],
      boundsByLevel: new Map(),
      enrichmentByFeatureId: new Map(),
      warnings: [],
    } satisfies LoadedVenue;

    const renderedTypes = buildRenderFeatures(venue, "ordinal:0").features.map(
      (rendered) => rendered.properties?.["__feature_type"],
    );
    expect(renderedTypes).toEqual(["venue", "building"]);
  });
});
