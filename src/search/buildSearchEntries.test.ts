import { describe, expect, it } from "vitest";
import type { FeatureType, ViewerFeature } from "../imdf/types";
import { buildSearchEntries } from "./buildSearchEntries";
import { normalizeSearchText } from "./normalizeSearchText";
import { searchVenue } from "./searchVenue";

function feature(partial: {
  id: string;
  featureType: FeatureType;
  levelId?: string | null;
  labels?: Record<string, string>;
  altLabels?: Record<string, string>;
  category?: string | null;
  sourceProperties?: Record<string, unknown>;
}): ViewerFeature {
  return {
    id: partial.id,
    featureType: partial.featureType,
    levelId: partial.levelId === undefined ? "level-1" : partial.levelId,
    geometry: null,
    center: null,
    labels: partial.labels ?? { en: partial.id },
    altLabels: partial.altLabels ?? {},
    category: partial.category === undefined ? null : partial.category,
    accessibility: [],
    restriction: null,
    sourceProperties: partial.sourceProperties ?? {},
  };
}

describe("buildSearchEntries", () => {
  it("indexes occupant, amenity, unit, opening, kiosk, and building only", () => {
    const features = [
      feature({ id: "occ", featureType: "occupant", labels: { en: "Shop" } }),
      feature({ id: "ame", featureType: "amenity", labels: { en: "Restroom" } }),
      feature({ id: "unit", featureType: "unit", labels: { en: "Room" } }),
      feature({ id: "open", featureType: "opening", labels: { en: "Door" }, category: "pedestrian" }),
      feature({ id: "kiosk", featureType: "kiosk", labels: { en: "Info" } }),
      feature({ id: "anchor", featureType: "anchor", labels: { en: "Anchor Label" } }),
      feature({ id: "venue", featureType: "venue", labels: { en: "Venue" } }),
      feature({ id: "level", featureType: "level", labels: { en: "1F" } }),
      feature({ id: "building", featureType: "building", labels: { en: "Bldg" } }),
    ];

    const entries = buildSearchEntries(features);
    const ids = entries.map((e) => e.featureId).sort();
    expect(ids).toEqual(["ame", "building", "kiosk", "occ", "open", "unit"]);
    expect(entries.some((e) => e.featureType === "anchor")).toBe(false);
  });

  it("never indexes raw anchors even when mixed into the feature list", () => {
    const features = [
      feature({
        id: "a1000007-0000-4000-8000-0000000000a1",
        featureType: "anchor",
        labels: { en: "Station Shop Anchor", ja: "駅ナカ" },
        category: "shopping",
      }),
      feature({
        id: "occ-1",
        featureType: "occupant",
        labels: { en: "Station Shop", ja: "駅ナカショップ" },
      }),
    ];
    const entries = buildSearchEntries(features);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.featureId).toBe("occ-1");
  });

  it("folds short_name values into normalizedAltLabels", () => {
    const features = [
      feature({
        id: "short-1",
        featureType: "occupant",
        labels: { en: "Long Official Name", ja: "正式名称" },
        altLabels: { en: "Alt Name" },
        sourceProperties: {
          short_name: { en: "ShortEN", ja: "短縮" },
        },
      }),
    ];
    const entries = buildSearchEntries(features);
    expect(entries).toHaveLength(1);
    const alts = new Set(entries[0]?.normalizedAltLabels);
    expect(alts.has(normalizeSearchText("Alt Name"))).toBe(true);
    expect(alts.has(normalizeSearchText("ShortEN"))).toBe(true);
    expect(alts.has(normalizeSearchText("短縮"))).toBe(true);
    // Primary labels stay on normalizedLabels, not alt.
    expect(entries[0]?.normalizedLabels).toContain(normalizeSearchText("Long Official Name"));
  });

  it("makes short_name matchable at alt-label score tiers", () => {
    const features = [
      feature({
        id: "s1",
        featureType: "occupant",
        labels: { en: "Long Official Name" },
        sourceProperties: { short_name: { en: "Sg" } },
      }),
      feature({
        id: "s2",
        featureType: "occupant",
        labels: { en: "Long Official Name" },
        sourceProperties: { short_name: { en: "Sgwest" } },
      }),
      feature({
        id: "s3",
        featureType: "occupant",
        labels: { en: "Long Official Name" },
        sourceProperties: { short_name: { en: "The Sg Store" } },
      }),
    ];
    const entries = buildSearchEntries(features);
    const byId = Object.fromEntries(
      searchVenue(entries, {
        text: "sg",
        category: "all",
        locale: "en",
        levelId: null,
      }).map((r) => [r.featureId, r.score]),
    );
    expect(byId["s1"]).toBe(450);
    expect(byId["s2"]).toBe(350);
    expect(byId["s3"]).toBe(250);
  });

  it("normalizes labels and category with NFKC / lowercase / collapsed whitespace", () => {
    const features = [
      feature({
        id: "norm",
        featureType: "unit",
        labels: { en: "  ＡＢＣ  Shop " },
        altLabels: { en: "ｶﾀｶﾅ" },
        category: "Room  Type",
      }),
    ];
    const [built] = buildSearchEntries(features);
    expect(built?.normalizedLabels).toContain("abc shop");
    expect(built?.normalizedAltLabels).toContain("カタカナ");
    expect(built?.normalizedCategory).toBe("room type");
  });

  it("skips empty short_name / non-object short_name", () => {
    const features = [
      feature({
        id: "no-short",
        featureType: "occupant",
        labels: { en: "A" },
        sourceProperties: { short_name: "not-an-object" },
      }),
      feature({
        id: "null-short",
        featureType: "occupant",
        labels: { en: "B" },
        sourceProperties: { short_name: null },
      }),
      feature({
        id: "empty-short",
        featureType: "occupant",
        labels: { en: "C" },
        sourceProperties: { short_name: { en: "" } },
      }),
    ];
    const entries = buildSearchEntries(features);
    for (const e of entries) {
      expect(e.normalizedAltLabels).toEqual([]);
    }
  });
});
