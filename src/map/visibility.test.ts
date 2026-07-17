import { describe, expect, it } from "vitest";
import { isTypeAndBuildingVisible, visibleSearchEntries, type VisibilitySelection } from "./visibility";
import type { SearchEntry } from "../imdf/types";

const none: VisibilitySelection = { hiddenTypes: new Set(), hiddenBuildings: new Set() };

describe("isTypeAndBuildingVisible", () => {
  it("shows everything when nothing is hidden", () => {
    expect(isTypeAndBuildingVisible("unit", "b1", none)).toBe(true);
  });
  it("hides a hidden type", () => {
    const v: VisibilitySelection = { hiddenTypes: new Set(["unit"]), hiddenBuildings: new Set() };
    expect(isTypeAndBuildingVisible("unit", "b1", v)).toBe(false);
    expect(isTypeAndBuildingVisible("opening", "b1", v)).toBe(true);
  });
  it("hides a feature in a hidden building but keeps null-building features", () => {
    const v: VisibilitySelection = { hiddenTypes: new Set(), hiddenBuildings: new Set(["b1"]) };
    expect(isTypeAndBuildingVisible("unit", "b1", v)).toBe(false);
    expect(isTypeAndBuildingVisible("unit", "b2", v)).toBe(true);
    expect(isTypeAndBuildingVisible("unit", null, v)).toBe(true);
  });
  it("always shows the venue outline", () => {
    const v: VisibilitySelection = { hiddenTypes: new Set(["venue"]), hiddenBuildings: new Set(["b1"]) };
    expect(isTypeAndBuildingVisible("venue", "b1", v)).toBe(true);
  });
});

describe("visibleSearchEntries", () => {
  it("drops entries whose type or building is hidden", () => {
    const entries: SearchEntry[] = [
      { featureId: "u1", featureType: "unit", levelId: "l", buildingId: "b1", category: null, labels: {}, altLabels: {}, normalizedLabels: [], normalizedAltLabels: [], normalizedCategory: "" },
      { featureId: "o1", featureType: "opening", levelId: "l", buildingId: "b2", category: null, labels: {}, altLabels: {}, normalizedLabels: [], normalizedAltLabels: [], normalizedCategory: "" },
    ];
    const v: VisibilitySelection = { hiddenTypes: new Set(["unit"]), hiddenBuildings: new Set() };
    expect(visibleSearchEntries(entries, v).map((e) => e.featureId)).toEqual(["o1"]);
  });
});
