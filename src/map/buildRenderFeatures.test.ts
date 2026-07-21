import type { Feature, FeatureCollection } from "geojson";
import { describe, expect, it } from "vitest";
import type { LoadedVenue, ViewerFeature, ViewerLevel } from "../imdf/types";
import { buildRenderFeatures, renderFeatureFromViewer } from "./buildRenderFeatures";

function renderFeature(id: string): Feature {
  return {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: { __feature_id: id },
  };
}

function collection(ids: string[]): FeatureCollection {
  return { type: "FeatureCollection", features: ids.map(renderFeature) };
}

function venueFeature(id: string): ViewerFeature {
  return {
    id,
    featureType: "venue",
    levelId: null,
    geometry: { type: "Point", coordinates: [0, 0] },
    center: [0, 0],
    labels: {},
    altLabels: {},
    category: null,
    accessibility: [],
    restriction: null,
    sourceProperties: {},
  };
}

function makeVenue(): LoadedVenue {
  const levels: ViewerLevel[] = [
    { id: "c2", ordinal: 1, label: { en: "2F" }, shortName: { en: "2F" } },
    { id: "a1", ordinal: 0, label: { en: "1F" }, shortName: { en: "1F" } },
    { id: "b1", ordinal: 0, label: { en: "1F" }, shortName: { en: "1F" } },
  ];
  return {
    manifest: { version: "1.0.0", language: "en" },
    venue: venueFeature("venue"),
    levels,
    featuresById: new Map(),
    renderFeaturesByLevel: new Map([
      ["c2", collection(["feat-c2"])],
      ["a1", collection(["feat-a1"])],
      ["b1", collection(["feat-b1", "feat-a1"])], // shared id to prove dedupe
    ]),
    searchEntries: [],
    boundsByLevel: new Map(),
    warnings: [],
  };
}

describe("buildRenderFeatures floor-merge", () => {
  it("unions render features across same-ordinal levels", () => {
    const fc = buildRenderFeatures(makeVenue(), "a1");
    const ids = fc.features.map((f) => f.properties?.["__feature_id"]);
    expect(ids).toContain("feat-a1");
    expect(ids).toContain("feat-b1"); // sibling same-ordinal level included
    expect(ids).not.toContain("feat-c2"); // other ordinal excluded
  });

  it("dedupes a feature id shared across same-ordinal levels", () => {
    const fc = buildRenderFeatures(makeVenue(), "b1");
    const a1Count = fc.features.filter((f) => f.properties?.["__feature_id"] === "feat-a1").length;
    expect(a1Count).toBe(1);
  });

  it("renders only the selected ordinal's levels", () => {
    const fc = buildRenderFeatures(makeVenue(), "c2");
    const ids = fc.features.map((f) => f.properties?.["__feature_id"]);
    expect(ids).toContain("feat-c2");
    expect(ids).not.toContain("feat-a1");
  });
});

function unitFeature(sourceProperties: Record<string, unknown>): ViewerFeature {
  return {
    id: "u1",
    featureType: "unit",
    levelId: "a1",
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    center: [0, 0],
    labels: {},
    altLabels: {},
    category: "room",
    accessibility: [],
    restriction: null,
    sourceProperties,
  };
}

describe("renderFeatureFromViewer unit color2 fill", () => {
  it("stamps __unit_color from a mapped color2 name", () => {
    const rendered = renderFeatureFromViewer(unitFeature({ color2: "緑" }));
    expect(rendered?.properties?.["__unit_color"]).toBe("#DDF5D9");
  });
  it("passes a literal hex color2 through", () => {
    const rendered = renderFeatureFromViewer(unitFeature({ color2: "#123456" }));
    expect(rendered?.properties?.["__unit_color"]).toBe("#123456");
  });
  it("omits __unit_color for a unit without color2", () => {
    const rendered = renderFeatureFromViewer(unitFeature({}));
    expect(rendered?.properties?.["__unit_color"]).toBeUndefined();
  });
  it("omits __unit_color for a non-unit even with color2", () => {
    const amenity: ViewerFeature = { ...unitFeature({ color2: "緑" }), featureType: "amenity" };
    const rendered = renderFeatureFromViewer(amenity);
    expect(rendered?.properties?.["__unit_color"]).toBeUndefined();
  });
});
