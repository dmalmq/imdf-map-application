import { describe, expect, it } from "vitest";
import type { ViewerFeature } from "../imdf/types";
import { isUnitMarkerEligible, matchesSearchCategory } from "./searchCategories";

function feature(featureType: ViewerFeature["featureType"], category: string | null): ViewerFeature {
  return {
    id: `${featureType}-${category ?? "none"}`,
    featureType,
    levelId: "level-1",
    geometry: null,
    center: [139.7, 35.6],
    labels: { en: "Place" },
    altLabels: {},
    category,
    accessibility: [],
    restriction: null,
    buildingId: null,
    sourceProperties: {},
  };
}

describe("matchesSearchCategory", () => {
  it("uses one deterministic category contract", () => {
    expect(matchesSearchCategory(feature("occupant", "shopping"), "shops")).toBe(true);
    expect(matchesSearchCategory(feature("opening", "pedestrian.primary"), "gates")).toBe(true);
    expect(matchesSearchCategory(feature("opening", "service"), "gates")).toBe(false);
    expect(matchesSearchCategory(feature("amenity", "information"), "facilities")).toBe(true);
    expect(matchesSearchCategory(feature("kiosk", null), "facilities")).toBe(true);
    expect(matchesSearchCategory(feature("unit", "elevator"), "facilities")).toBe(true);
    expect(matchesSearchCategory(feature("unit", "walkway"), "facilities")).toBe(false);
    expect(matchesSearchCategory(feature("occupant", "shopping"), "facilities")).toBe(false);
  });

  it("keeps default unit marker eligibility separate and exact", () => {
    expect(isUnitMarkerEligible(feature("unit", "room"))).toBe(true);
    expect(isUnitMarkerEligible(feature("unit", "restroom.female"))).toBe(true);
    expect(isUnitMarkerEligible(feature("unit", "platform"))).toBe(false);
    expect(isUnitMarkerEligible(feature("amenity", "restroom"))).toBe(false);
  });
});
