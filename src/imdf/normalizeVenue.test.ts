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
const LEVEL_GROUP_B1 = "ordinal:-1";
const LEVEL_GROUP_1F = "ordinal:0";
const LEVEL_GROUP_2F = "ordinal:1";
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
  it("groups levels by ordinal and sorts them [2F, 1F, B1]", async () => {
    const venue = normalizeVenue(await loadMinimalArchive());
    expect(venue.levels.map((level) => level.id)).toEqual([
      LEVEL_GROUP_2F,
      LEVEL_GROUP_1F,
      LEVEL_GROUP_B1,
    ]);
    expect(venue.levels.map((level) => level.ordinal)).toEqual([1, 0, -1]);
    expect(venue.levels.map((level) => level.shortName["en"])).toEqual(["2F", "1F", "B1"]);
    expect(venue.levels.map((level) => level.label["ja-JP"])).toEqual([
      "2階",
      "1階",
      "地下1階",
    ]);
    expect(venue.levels.map((level) => level.sourceLevelIds)).toEqual([
      [LEVEL_2F],
      [LEVEL_1F],
      [LEVEL_B1],
    ]);
  });

  it("renders all source levels and features sharing one ordinal together", async () => {
    const archive = await loadMinimalArchive();
    const northLevelId = "b1000099-0000-4000-8000-00000000001f";
    const northUnitId = "c1000099-0000-4000-8000-00000000001f";
    archive.collections.level!.features.push({
      type: "Feature",
      id: northLevelId,
      feature_type: "level",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [139.768, 35.68],
            [139.769, 35.68],
            [139.769, 35.681],
            [139.768, 35.681],
            [139.768, 35.68],
          ],
        ],
      },
      properties: {
        ordinal: 0,
        name: { en: "1F North", ja: "1階北" },
        short_name: { en: "1F", ja: "1F" },
      },
    } as GeoJSON.Feature);
    archive.collections.unit!.features.push({
      type: "Feature",
      id: northUnitId,
      feature_type: "unit",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [139.7681, 35.6801],
            [139.7689, 35.6801],
            [139.7689, 35.6809],
            [139.7681, 35.6809],
            [139.7681, 35.6801],
          ],
        ],
      },
      properties: {
        category: "room",
        name: { en: "North Room", ja: "北室" },
        level_id: northLevelId,
      },
    } as GeoJSON.Feature);

    const venue = normalizeVenue(archive);
    const level = venue.levels.find((candidate) => candidate.id === LEVEL_GROUP_1F);
    expect(level?.sourceLevelIds).toEqual([LEVEL_1F, northLevelId].sort());
    expect(level?.label).toMatchObject({ en: "1F", ja: "1F" });
    expect(venue.featuresById.get(northUnitId)?.levelId).toBe(LEVEL_GROUP_1F);

    const renderedIds = venue.renderFeaturesByLevel
      .get(LEVEL_GROUP_1F)!
      .features.map((feature) => feature.id);
    expect(renderedIds).toContain(LEVEL_1F);
    expect(renderedIds).toContain(northLevelId);
    expect(renderedIds).toContain(northUnitId);
    expect(venue.boundsByLevel.get(LEVEL_GROUP_1F)?.[2]).toBeGreaterThan(139.7689);
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
    expect(occupant!.levelId).toBe(LEVEL_GROUP_1F);
    expect(occupant!.center).toEqual(anchor!.geometry && "coordinates" in anchor!.geometry
      ? (anchor!.geometry as GeoJSON.Point).coordinates
      : null);
    expect(occupant!.center).toEqual([139.7666, 35.6816]);
  });

  it("derives amenity levelId from unit_ids", async () => {
    const venue = normalizeVenue(await loadMinimalArchive());
    const amenity = venue.featuresById.get(AMENITY_ID);
    expect(amenity).toBeDefined();
    expect(amenity!.levelId).toBe(LEVEL_GROUP_1F);
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
    const levelFeatures = venue.renderFeaturesByLevel.get(LEVEL_GROUP_1F);
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
    const levelFeatures = venue.renderFeaturesByLevel.get(LEVEL_GROUP_B1);
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

  it("normalizes missing enrichment to an empty map", async () => {
    const venue = normalizeVenue(await loadMinimalArchive());
    expect(venue.enrichmentByFeatureId).toBeInstanceOf(Map);
    expect(venue.enrichmentByFeatureId.size).toBe(0);
  });

  it("copies archive enrichment into enrichmentByFeatureId by stable feature id", async () => {
    const archive = await loadMinimalArchive();
    archive.enrichment = {
      [OCCUPANT_ID]: { description: { en: "Concourse shop" } },
    };
    const venue = normalizeVenue(archive);
    expect(venue.enrichmentByFeatureId.get(OCCUPANT_ID)?.description?.en).toBe(
      "Concourse shop",
    );
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

describe("normalizeVenue building resolution", () => {
  it("resolves buildingId for levels, units, and building features, and lists buildings", () => {
    const archive: ParsedImdfArchive = {
      manifest: { version: "1.0.0", language: "ja" },
      collections: {
        venue: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: "venue-1",
              geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
              properties: { name: { en: "V", ja: "V" } },
            },
          ],
        },
        building: {
          type: "FeatureCollection",
          features: [
            { type: "Feature", id: "bldg-A", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }, properties: { name: { en: "A", ja: "A" } } },
          ],
        },
        level: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: "lvl-1",
              geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
              properties: { ordinal: 0, building_ids: ["bldg-A"], name: { en: "1", ja: "1" } },
            },
          ],
        },
        unit: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: "unit-1",
              geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
              properties: { level_id: "lvl-1", category: "room" },
            },
          ],
        },
      },
    };
    const venue = normalizeVenue(archive);
    expect(venue.featuresById.get("lvl-1")?.buildingId).toBe("bldg-A");
    expect(venue.featuresById.get("unit-1")?.buildingId).toBe("bldg-A");
    expect(venue.featuresById.get("bldg-A")?.buildingId).toBe("bldg-A");
    expect(venue.buildings).toEqual([{ id: "bldg-A", label: { en: "A", ja: "A" } }]);
  });

  it("leaves buildingId null when unresolved and omits the buildings list", () => {
    const archive: ParsedImdfArchive = {
      manifest: { version: "1.0.0", language: "ja" },
      collections: {
        venue: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: "venue-1",
              geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
              properties: { name: { en: "V", ja: "V" } },
            },
          ],
        },
        amenity: {
          type: "FeatureCollection",
          features: [
            { type: "Feature", id: "am-1", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} },
          ],
        },
      },
    };
    const venue = normalizeVenue(archive);
    expect(venue.featuresById.get("am-1")?.buildingId).toBeNull();
    expect(venue.buildings).toEqual([]);
  });
});
