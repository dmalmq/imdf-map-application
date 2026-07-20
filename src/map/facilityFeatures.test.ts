import { describe, expect, it } from "vitest";
import type { FacilityDto } from "../bundle/wasm";
import { buildFacilityFeatures } from "./facilityFeatures";
import { FACILITY_PIN_IMAGE, MARKER_ICON_URLS, facilityIconImage } from "./facilityIcons";

const facilities: FacilityDto[] = [
  { lon: 139.0, lat: 35.0, ordinal: 0, name: "Gate", icon: "ticket", anchor: { lon: 139.0, lat: 35.0, ordinal: 0 } },
  { lon: 139.1, lat: 35.1, ordinal: 0, name: "Store", icon: "", anchor: null },
  { lon: 139.2, lat: 35.2, ordinal: -1, name: "Basement shop", icon: "elevator", anchor: null },
];

describe("facilityIconImage", () => {
  it("resolves a staged icon basename to itself", () => {
    // "ticket" is one of the staged icons.
    expect(MARKER_ICON_URLS).toHaveProperty("ticket");
    expect(facilityIconImage("ticket")).toBe("ticket");
  });

  it("falls back to the pin for empty or unknown icons", () => {
    expect(facilityIconImage("")).toBe(FACILITY_PIN_IMAGE);
    expect(facilityIconImage("marunouchi_bldg")).toBe(FACILITY_PIN_IMAGE);
  });
});

describe("buildFacilityFeatures", () => {
  it("emits only facilities on the active ordinal", () => {
    const fc = buildFacilityFeatures(facilities, 0);
    expect(fc.features).toHaveLength(2);
    const names = fc.features.map((f) => f.properties?.["name"]);
    expect(names).toEqual(["Gate", "Store"]);
  });

  it("switches markers when the active ordinal changes", () => {
    const fc = buildFacilityFeatures(facilities, -1);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.properties?.["name"]).toBe("Basement shop");
  });

  it("carries resolved icon, index, and anchor flag", () => {
    const fc = buildFacilityFeatures(facilities, 0);
    const gate = fc.features[0]!;
    expect(gate.properties?.["icon"]).toBe("ticket");
    expect(gate.properties?.["index"]).toBe(0);
    expect(gate.properties?.["hasAnchor"]).toBe(true);
    const store = fc.features[1]!;
    expect(store.properties?.["icon"]).toBe(FACILITY_PIN_IMAGE);
    expect(store.properties?.["hasAnchor"]).toBe(false);
    expect(store.properties?.["index"]).toBe(1);
  });
});
