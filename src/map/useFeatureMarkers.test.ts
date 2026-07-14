import { describe, expect, it } from "vitest";
import type { FeatureType, LoadedVenue, ViewerFeature } from "../imdf/types";
import { collectMarkerFeatures, markerIconFor } from "./useFeatureMarkers";

const LEVEL = "level-1";

function feature(
  id: string,
  featureType: FeatureType,
  category: string | null,
  overrides: Partial<ViewerFeature> = {},
): ViewerFeature {
  return {
    id,
    featureType,
    levelId: LEVEL,
    geometry: null,
    center: [139.7, 35.6],
    labels: { en: id },
    altLabels: {},
    category,
    accessibility: [],
    restriction: null,
    sourceProperties: {},
    ...overrides,
  };
}

function venueWith(features: ViewerFeature[]): LoadedVenue {
  return {
    manifest: { version: "1.0.0", language: "en" },
    venue: feature("venue", "venue", null),
    levels: [],
    featuresById: new Map(features.map((f) => [f.id, f])),
    renderFeaturesByLevel: new Map(),
    searchEntries: [],
    boundsByLevel: new Map(),
    warnings: [],
  };
}

describe("collectMarkerFeatures", () => {
  it("includes bubble units, icon amenities, and named rooms alongside pills", () => {
    const venue = venueWith([
      feature("a-amenity", "amenity", "restroom"),
      feature("k-kiosk", "kiosk", null),
      feature("u-elevator", "unit", "elevator"),
      feature("u-escalator", "unit", "escalator"),
      feature("u-stairs", "unit", "stairs"),
      feature("u-steps", "unit", "steps"),
      feature("u-room", "unit", "room"),
      feature("u-walkway", "unit", "walkway"),
      feature("u-restroom", "unit", "restroom.female"),
      feature("o-opening", "opening", null),
    ]);
    const ids = collectMarkerFeatures(venue, LEVEL, null).map((f) => f.id);
    expect(ids).toEqual([
      "a-amenity",
      "u-elevator",
      "u-escalator",
      "u-restroom",
      "u-stairs",
      "u-steps",
      "k-kiosk",
      "u-room",
    ]);
  });

  it("drops an amenity that duplicates an on-level bubble unit via unit_ids", () => {
    const venue = venueWith([
      feature("u-elevator", "unit", "elevator"),
      feature("a-linked", "amenity", "elevator", {
        sourceProperties: { unit_ids: ["u-elevator"] },
      }),
      feature("a-unlinked", "amenity", "elevator", {
        sourceProperties: { unit_ids: ["u-elsewhere"] },
      }),
      feature("a-nonbubble", "amenity", "information", {
        sourceProperties: { unit_ids: ["u-elevator"] },
      }),
    ]);
    const ids = collectMarkerFeatures(venue, LEVEL, null).map((f) => f.id);
    expect(ids).toEqual(["a-unlinked", "u-elevator", "a-nonbubble"]);
  });

  it("skips unnamed rooms and centerless units", () => {
    const venue = venueWith([
      feature("u-room-unnamed", "unit", "room", { labels: {} }),
      feature("u-stairs-nocenter", "unit", "stairs", { center: null }),
      feature("u-room-named", "unit", "room"),
    ]);
    const ids = collectMarkerFeatures(venue, LEVEL, null).map((f) => f.id);
    expect(ids).toEqual(["u-room-named"]);
  });

  it("keeps conveyance bubbles when a crowded level hits the cap", () => {
    const crowd: ViewerFeature[] = [];
    for (let i = 0; i < 250; i += 1) {
      crowd.push(feature(`occ-${String(i).padStart(3, "0")}`, "occupant", null));
    }
    const venue = venueWith([...crowd, feature("u-elevator", "unit", "elevator")]);
    const result = collectMarkerFeatures(venue, LEVEL, null);
    expect(result).toHaveLength(200);
    expect(result[0]!.id).toBe("u-elevator");
  });

  it("drops rooms before pills under the cap", () => {
    const features: ViewerFeature[] = [];
    for (let i = 0; i < 199; i += 1) {
      features.push(feature(`occ-${String(i).padStart(3, "0")}`, "occupant", null));
    }
    features.push(feature("u-room-a", "unit", "room"));
    features.push(feature("u-room-b", "unit", "room"));
    const venue = venueWith(features);
    const ids = collectMarkerFeatures(venue, LEVEL, null).map((f) => f.id);
    expect(ids).toHaveLength(200);
    expect(ids).toContain("u-room-a");
    expect(ids).not.toContain("u-room-b");
  });

  it("puts the selected feature first even when it would be capped out", () => {
    const features: ViewerFeature[] = [];
    for (let i = 0; i < 200; i += 1) {
      features.push(feature(`occ-${String(i).padStart(3, "0")}`, "occupant", null));
    }
    features.push(feature("u-room-z", "unit", "room"));
    const venue = venueWith(features);
    const ids = collectMarkerFeatures(venue, LEVEL, "u-room-z").map((f) => f.id);
    expect(ids).toHaveLength(200);
    expect(ids[0]).toBe("u-room-z");
  });

  it("excludes features on other levels", () => {
    const venue = venueWith([
      feature("u-stairs-here", "unit", "stairs"),
      feature("u-stairs-there", "unit", "stairs", { levelId: "level-2" }),
    ]);
    const ids = collectMarkerFeatures(venue, LEVEL, null).map((f) => f.id);
    expect(ids).toEqual(["u-stairs-here"]);
  });
});

describe("markerIconFor", () => {
  it("maps conveyances, sharing the stairs icon with steps", () => {
    expect(markerIconFor("elevator")).toBeDefined();
    expect(markerIconFor("escalator")).toBeDefined();
    expect(markerIconFor("stairs")).toBeDefined();
    expect(markerIconFor("steps")).toBe(markerIconFor("stairs"));
  });

  it("distinguishes restroom variants with wheelchair over gender", () => {
    const female = markerIconFor("restroom.female");
    const male = markerIconFor("restroom.male");
    const wheelchair = markerIconFor("restroom.wheelchair");
    const generic = markerIconFor("restroom");
    expect(new Set([female, male, wheelchair, generic]).size).toBe(4);
    expect(markerIconFor("restroom.female.wheelchair")).toBe(wheelchair);
    expect(markerIconFor("restroom.male.wheelchair")).toBe(wheelchair);
    expect(markerIconFor("restroom.unisex")).toBe(generic);
    expect(markerIconFor("restroom.family")).toBe(generic);
  });

  it("covers amenity toilet categories and rejects everything else", () => {
    expect(markerIconFor("toilet")).toBe(markerIconFor("restroom"));
    expect(markerIconFor("toilets")).toBe(markerIconFor("restroom"));
    expect(markerIconFor("walkway")).toBeUndefined();
    expect(markerIconFor("room")).toBeUndefined();
    expect(markerIconFor("information")).toBeUndefined();
  });
});
