import { describe, expect, it } from "vitest";
import type { LoadedVenue, ViewerFeature } from "../imdf/types";
import { buildRenderFeatures, renderFeatureFromViewer } from "./buildRenderFeatures";

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
    buildingId: null,
    sourceProperties: {},
  };
}

describe("buildRenderFeatures", () => {
  it("includes venue/building/footprint context even without level_id", () => {
    const venueFeature = feature("venue", "venue");
    const building = feature("building", "building");
    const footprint = feature("footprint", "footprint");
    const venue = {
      manifest: { version: "1.0.0", language: "en" },
      venue: venueFeature,
      levels: [],
      buildings: [],
      featuresById: new Map([
        [venueFeature.id, venueFeature],
        [building.id, building],
        [footprint.id, footprint],
      ]),
      // Footprint has no level_id, so it is absent from level collections and must
      // still appear as always-on context via CONTEXT_FEATURE_TYPES.
      renderFeaturesByLevel: new Map(),
      searchEntries: [],
      boundsByLevel: new Map(),
      enrichmentByFeatureId: new Map(),
      warnings: [],
    } satisfies LoadedVenue;

    const renderedTypes = buildRenderFeatures(venue, "ordinal:0").features.map(
      (rendered) => rendered.properties?.["__feature_type"],
    );
    expect(renderedTypes).toEqual(["venue", "building", "footprint"]);
  });
});

describe("buildRenderFeatures visibility", () => {
  it("excludes hidden types but keeps the venue outline", () => {
    const venueFeature = feature("venue", "venue");
    const unit = feature("u1", "unit");
    unit.levelId = "ordinal:0";
    const venue = {
      manifest: { version: "1.0.0", language: "en" },
      venue: venueFeature,
      levels: [],
      buildings: [],
      featuresById: new Map([
        [venueFeature.id, venueFeature],
        [unit.id, unit],
      ]),
      renderFeaturesByLevel: new Map([
        ["ordinal:0", { type: "FeatureCollection", features: [renderFeatureFromViewer(unit)!] }],
      ]),
      searchEntries: [],
      boundsByLevel: new Map(),
      enrichmentByFeatureId: new Map(),
      warnings: [],
    } satisfies LoadedVenue;

    expect(
      buildRenderFeatures(venue, "ordinal:0").features.map((f) => f.properties?.["__feature_type"]),
    ).toContain("unit");

    const hidden = buildRenderFeatures(venue, "ordinal:0", {
      hiddenTypes: new Set(["unit"]),
      hiddenBuildings: new Set(),
    });
    const types = hidden.features.map((f) => f.properties?.["__feature_type"]);
    expect(types).not.toContain("unit");
    expect(types).toContain("venue");
  });
});

describe("renderFeatureFromViewer marker icon", () => {
  const withImage = (image: unknown): ViewerFeature => {
    const base = feature("f-icon", "amenity");
    return { ...base, sourceProperties: { image } };
  };

  it("derives __marker_icon from an allowlisted source image", () => {
    const rendered = renderFeatureFromViewer(withImage("/marker/ticket.png"));
    expect(rendered?.properties?.["__marker_icon"]).toBe("gdb-icon:ticket.png");
  });

  it("omits __marker_icon for unknown or absent images", () => {
    expect(
      renderFeatureFromViewer(withImage("unknown.png"))?.properties,
    ).not.toHaveProperty("__marker_icon");
    expect(renderFeatureFromViewer(feature("f-plain", "amenity"))?.properties).not.toHaveProperty(
      "__marker_icon",
    );
  });

  it("leaves the raw source image untouched", () => {
    const source = withImage("/marker/ticket.png");
    renderFeatureFromViewer(source);
    expect(source.sourceProperties["image"]).toBe("/marker/ticket.png");
  });
});

describe("renderFeatureFromViewer building and unit color", () => {
  it("stamps __building_id and __unit_color for a unit with color2", () => {
    const feature = {
      id: "u1",
      featureType: "unit" as const,
      levelId: "ordinal:0",
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } as GeoJSON.Geometry,
      center: [0.5, 0.5] as [number, number],
      labels: {},
      altLabels: {},
      category: "room",
      accessibility: [],
      restriction: null,
      buildingId: "bldg-A",
      sourceProperties: { color2: "緑" },
    };
    const rendered = renderFeatureFromViewer(feature);
    expect(rendered?.properties?.["__building_id"]).toBe("bldg-A");
    expect(rendered?.properties?.["__unit_color"]).toBe("#DDF5D9");
  });

  it("omits __unit_color for non-units and units without color2", () => {
    const base = {
      id: "x",
      levelId: "ordinal:0",
      geometry: { type: "Point", coordinates: [0, 0] } as GeoJSON.Geometry,
      center: [0, 0] as [number, number],
      labels: {},
      altLabels: {},
      category: null,
      accessibility: [],
      restriction: null,
      buildingId: null,
      sourceProperties: { color2: "緑" },
    };
    const amenity = renderFeatureFromViewer({ ...base, featureType: "amenity" as const });
    expect(amenity?.properties?.["__unit_color"]).toBeUndefined();
    const unitNoColor = renderFeatureFromViewer({
      ...base,
      featureType: "unit" as const,
      sourceProperties: {},
    });
    expect(unitNoColor?.properties?.["__unit_color"]).toBeUndefined();
  });
});
