import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localizedLabel, pickLocalizedValue } from "./localize";
import { normalizeVenue } from "./normalizeVenue";
import type {
  FeatureType,
  ImdfManifest,
  ParsedImdfArchive,
  ViewerWarning,
} from "./types";

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures/minimal-imdf",
);

const LEVEL_B1 = "b1000001-0000-4000-8000-0000000000b1";
const LEVEL_1F = "b1000002-0000-4000-8000-00000000001f";
const LEVEL_2F = "b1000003-0000-4000-8000-00000000002f";
const RESTRICTED_UNIT = "c1000003-0000-4000-8000-0000000000b3";
const JA_ONLY_ROOM = "c1000002-0000-4000-8000-0000000000b2";
const ANCHOR_ID = "a1000007-0000-4000-8000-0000000000a1";
const OCCUPANT_ID = "a1000008-0000-4000-8000-0000000000c1";
const DANGLING_OCCUPANT_ID = "a1000009-0000-4000-8000-0000000000c2";
const AMENITY_ID = "e1000001-0000-4000-8000-0000000000a1";

const FEATURE_FILES: Record<string, FeatureType> = {
  "address.geojson": "address",
  "amenity.geojson": "amenity",
  "anchor.geojson": "anchor",
  "building.geojson": "building",
  "footprint.geojson": "footprint",
  "kiosk.geojson": "kiosk",
  "level.geojson": "level",
  "occupant.geojson": "occupant",
  "opening.geojson": "opening",
  "unit.geojson": "unit",
  "venue.geojson": "venue",
};

async function loadMinimalArchive(): Promise<ParsedImdfArchive> {
  const manifestText = await readFile(path.join(FIXTURE_DIR, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) as ImdfManifest;
  const collections: ParsedImdfArchive["collections"] = {};
  for (const [filename, featureType] of Object.entries(FEATURE_FILES)) {
    const text = await readFile(path.join(FIXTURE_DIR, filename), "utf8");
    collections[featureType] = JSON.parse(text) as GeoJSON.FeatureCollection;
  }
  return { manifest, collections };
}

function warningKey(warning: ViewerWarning): string {
  return [
    warning.code,
    warning.featureId ?? "",
    warning.archiveEntry ?? "",
    warning.message,
  ].join("|");
}

describe("normalizeVenue", () => {
  it("sorts levels by descending ordinal [2F, 1F, B1]", async () => {
    const venue = normalizeVenue(await loadMinimalArchive());
    expect(venue.levels.map((level) => level.id)).toEqual([LEVEL_2F, LEVEL_1F, LEVEL_B1]);
    expect(venue.levels.map((level) => level.ordinal)).toEqual([1, 0, -1]);
    expect(venue.levels.map((level) => level.shortName["en"])).toEqual(["2F", "1F", "B1"]);
  });

  it("uses the restricted unit display_point rather than its bounds center", async () => {
    const venue = normalizeVenue(await loadMinimalArchive());
    const restricted = venue.featuresById.get(RESTRICTED_UNIT);
    expect(restricted).toBeDefined();
    expect(restricted!.center).toEqual([139.76765, 35.68055]);
    // Bounds center of the restricted polygon would be [139.7675, 35.6804].
    expect(restricted!.center).not.toEqual([139.7675, 35.6804]);
  });

  it("resolves null-geometry occupant level and center via anchor→unit→level", async () => {
    const venue = normalizeVenue(await loadMinimalArchive());
    const occupant = venue.featuresById.get(OCCUPANT_ID);
    const anchor = venue.featuresById.get(ANCHOR_ID);
    expect(occupant).toBeDefined();
    expect(anchor).toBeDefined();
    expect(occupant!.levelId).toBe(LEVEL_1F);
    expect(occupant!.center).toEqual(anchor!.geometry && "coordinates" in anchor!.geometry
      ? (anchor!.geometry as GeoJSON.Point).coordinates
      : null);
    expect(occupant!.center).toEqual([139.7666, 35.6816]);
  });

  it("derives amenity levelId from unit_ids", async () => {
    const venue = normalizeVenue(await loadMinimalArchive());
    const amenity = venue.featuresById.get(AMENITY_ID);
    expect(amenity).toBeDefined();
    expect(amenity!.levelId).toBe(LEVEL_1F);
  });

  it("retains complete sourceProperties including hours and nulls", async () => {
    const venue = normalizeVenue(await loadMinimalArchive());
    const occupant = venue.featuresById.get(OCCUPANT_ID);
    expect(occupant).toBeDefined();
    expect(occupant!.sourceProperties["hours"]).toBe("Mo-Fr 10:00-20:00");
    expect(occupant!.sourceProperties["phone"]).toBeNull();
    expect(occupant!.sourceProperties["website"]).toBeNull();
    expect(occupant!.sourceProperties["validity"]).toBeNull();
    expect(occupant!.sourceProperties["correlation_id"]).toBeNull();
    expect(occupant!.sourceProperties["anchor_id"]).toBe(ANCHOR_ID);
    expect(occupant!.sourceProperties["category"]).toBe("shopping");
  });

  it("keeps raw anchors in featuresById but excludes them from render and search", async () => {
    const venue = normalizeVenue(await loadMinimalArchive());
    expect(venue.featuresById.has(ANCHOR_ID)).toBe(true);
    expect(venue.featuresById.get(ANCHOR_ID)?.featureType).toBe("anchor");

    for (const collection of venue.renderFeaturesByLevel.values()) {
      for (const feature of collection.features) {
        const props = feature.properties;
        if (props !== null && typeof props === "object" && "__feature_id" in props) {
          expect(props["__feature_id"]).not.toBe(ANCHOR_ID);
        }
      }
    }

    expect(venue.searchEntries.some((entry) => entry.featureId === ANCHOR_ID)).toBe(false);
  });

  it("adds a derived occupant Point into the 1F render collection", async () => {
    const venue = normalizeVenue(await loadMinimalArchive());
    const levelFeatures = venue.renderFeaturesByLevel.get(LEVEL_1F);
    expect(levelFeatures).toBeDefined();
    const derived = levelFeatures!.features.find((feature) => {
      const props = feature.properties;
      return (
        props !== null &&
        typeof props === "object" &&
        "__feature_id" in props &&
        props["__feature_id"] === OCCUPANT_ID
      );
    });
    expect(derived).toBeDefined();
    expect(derived!.geometry).toEqual({
      type: "Point",
      coordinates: [139.7666, 35.6816],
    });
  });

  it("emits exactly the five fixture warnings", async () => {
    const venue = normalizeVenue(await loadMinimalArchive());
    const expected: ViewerWarning[] = [
      {
        code: "missing_display_point",
        message: `Feature ${AMENITY_ID} has no display_point.`,
        featureId: AMENITY_ID,
      },
      {
        code: "missing_display_point",
        message: `Feature ${OCCUPANT_ID} has no display_point.`,
        featureId: OCCUPANT_ID,
      },
      {
        code: "missing_display_point",
        message: `Feature ${DANGLING_OCCUPANT_ID} has no display_point.`,
        featureId: DANGLING_OCCUPANT_ID,
      },
      {
        code: "unresolved_reference",
        message: `Feature ${DANGLING_OCCUPANT_ID} references missing anchor_id deadbeef-0000-4000-8000-00000000dead.`,
        featureId: DANGLING_OCCUPANT_ID,
      },
      {
        code: "missing_locale",
        message: `Feature ${JA_ONLY_ROOM} has no English label.`,
        featureId: JA_ONLY_ROOM,
      },
    ];

    expect(venue.warnings).toHaveLength(5);
    expect(venue.warnings.map(warningKey).sort()).toEqual(expected.map(warningKey).sort());
  });

  it("leaves the dangling occupant with null levelId and null center", async () => {
    const venue = normalizeVenue(await loadMinimalArchive());
    const dangling = venue.featuresById.get(DANGLING_OCCUPANT_ID);
    expect(dangling).toBeDefined();
    expect(dangling!.levelId).toBeNull();
    expect(dangling!.center).toBeNull();
  });

  it("flattens the new B1 unit categories onto render features", async () => {
    const venue = normalizeVenue(await loadMinimalArchive());
    const levelFeatures = venue.renderFeaturesByLevel.get(LEVEL_B1);
    expect(levelFeatures).toBeDefined();
    const categories = new Set(
      levelFeatures!.features
        .map((feature) => feature.properties?.["__category"])
        .filter((category): category is string => typeof category === "string"),
    );
    expect(categories.has("stairs")).toBe(true);
    expect(categories.has("restroom.female")).toBe(true);
    expect(categories.has("unenclosedarea")).toBe(true);
  });
});

describe("locale fallback chain (localize)", () => {
  it("prefers an exact requested key", () => {
    expect(
      pickLocalizedValue({ en: "English", "en-US": "US English", ja: "日本語" }, "en"),
    ).toBe("English");
  });

  it("matches a case-insensitive BCP 47 primary subtag for the requested locale", () => {
    expect(pickLocalizedValue({ "EN-us": "US English", ja: "日本語" }, "en")).toBe(
      "US English",
    );
  });

  it("falls back to the exact manifest language key", () => {
    expect(
      pickLocalizedValue({ "ja-JP": "日本語", fr: "Français" }, "en", "ja-JP"),
    ).toBe("日本語");
  });

  it("falls back to a Japanese primary-subtag prefix when exact ja is absent", () => {
    expect(pickLocalizedValue({ "ja-JP": "日本語", fr: "Français" }, "en")).toBe("日本語");
  });

  it("falls back to an English primary-subtag prefix after Japanese is absent", () => {
    expect(pickLocalizedValue({ "en-GB": "British", fr: "Français" }, "ja")).toBe(
      "British",
    );
  });

  it("uses the first remaining locale key in lexical order", () => {
    expect(pickLocalizedValue({ zh: "中文", fr: "Français", de: "Deutsch" }, "en")).toBe(
      "Deutsch",
    );
  });

  it("falls back to the stable feature id when no labels remain", () => {
    const featureId = "a1000001-0000-4000-8000-000000000001";
    expect(localizedLabel({}, "en", featureId, "ja-JP")).toBe(featureId);
    expect(localizedLabel({ en: "" }, "en", featureId)).toBe(featureId);
  });
});
