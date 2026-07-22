import { describe, expect, it } from "vitest";
import { VenueLoadError } from "../errors/VenueLoadError";
import { hydrateVenue } from "./hydrateVenue";
import type { DecodedVenueDto } from "./wasm";

const VENUE_ID = "a1000001-0000-4000-8000-000000000001";
const LEVEL_1F = "b1000001-0000-4000-8000-000000000001";
const LEVEL_2F = "b1000002-0000-4000-8000-000000000002";
const UNIT_ID = "c1000001-0000-4000-8000-000000000001";
const OCCUPANT_ID = "c1000002-0000-4000-8000-000000000002";

type DtoFeature = DecodedVenueDto["features"][number];

function feature(overrides: Partial<DtoFeature> & Pick<DtoFeature, "id" | "featureType">): DtoFeature {
  return {
    levelId: null,
    geometry: null,
    center: null,
    labels: {},
    altLabels: {},
    category: null,
    accessibility: [],
    restriction: null,
    sourceProperties: {},
    ...overrides,
  };
}

function baseDto(overrides: Partial<DecodedVenueDto> = {}): DecodedVenueDto {
  const venueFeature = feature({
    id: VENUE_ID,
    featureType: "venue",
    labels: { en: "Test Venue" },
    sourceProperties: { name: { en: "Test Venue" } },
  });
  const level1Feature = feature({
    id: LEVEL_1F,
    featureType: "level",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [139.766, 35.68],
          [139.768, 35.68],
          [139.768, 35.682],
          [139.766, 35.682],
          [139.766, 35.68],
        ],
      ],
    },
    labels: { en: "1F" },
    sourceProperties: { ordinal: 0 },
  });
  const level2Feature = feature({
    id: LEVEL_2F,
    featureType: "level",
    geometry: { type: "Point", coordinates: [139.767, 35.681] },
    labels: { en: "2F" },
    sourceProperties: { ordinal: 1 },
  });
  const unitFeature = feature({
    id: UNIT_ID,
    featureType: "unit",
    levelId: LEVEL_1F,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [139.7661, 35.6801],
          [139.7671, 35.6801],
          [139.7671, 35.6811],
          [139.7661, 35.6811],
          [139.7661, 35.6801],
        ],
      ],
    },
    center: [139.7666, 35.6806],
    labels: { en: "Unit" },
    category: "retail",
    sourceProperties: { category: "retail" },
  });
  const occupantFeature = feature({
    id: OCCUPANT_ID,
    featureType: "occupant",
    levelId: LEVEL_1F,
    center: [139.7666, 35.6806],
    labels: { en: "Shop" },
    category: "shopping",
    sourceProperties: { hours: "Mo-Fr 10:00-20:00", phone: null, anchor_id: "a1000009" },
  });

  return {
    datasetId: "default/minimal",
    version: 1,
    venueId: VENUE_ID,
    manifest: {
      version: "1.0.0",
      language: "en",
      rest: { version: "1.0.0", language: "en", generated_by: "fixture" },
    },
    levels: [
      { id: LEVEL_2F, ordinal: 1, label: { en: "2F" }, shortName: {} },
      { id: LEVEL_1F, ordinal: 0, label: { en: "1F" }, shortName: {} },
    ],
    features: [venueFeature, level1Feature, level2Feature, unitFeature, occupantFeature],
    boundsByLevel: [[LEVEL_1F, [139.766, 35.68, 139.768, 35.682]]],
    warnings: [
      {
        code: "missing_locale",
        message: `Feature ${OCCUPANT_ID} has no Japanese label.`,
        featureId: OCCUPANT_ID,
        archiveEntry: null,
      },
    ],
    stats: { levels: 2, features: 5 },
    ...overrides,
  };
}

describe("hydrateVenue", () => {
  it("reconstructs featuresById, level ordering, render collections, search entries, bounds, warnings, and venue lookup", () => {
    const venue = hydrateVenue(baseDto());

    // venue lookup
    expect(venue.venue.id).toBe(VENUE_ID);
    expect(venue.venue.labels).toEqual({ en: "Test Venue" });

    // level ordering preserved exactly as decoded (canonical descending-ordinal order)
    expect(venue.levels.map((l) => l.id)).toEqual([LEVEL_2F, LEVEL_1F]);
    expect(venue.levels.map((l) => l.ordinal)).toEqual([1, 0]);

    // featuresById index
    expect(venue.featuresById.size).toBe(5);
    expect(venue.featuresById.get(OCCUPANT_ID)?.sourceProperties).toEqual({
      hours: "Mo-Fr 10:00-20:00",
      phone: null,
      anchor_id: "a1000009",
    });

    // renderFeaturesByLevel: level's own polygon + unit + occupant (substituted to its center point)
    const level1Render = venue.renderFeaturesByLevel.get(LEVEL_1F);
    expect(level1Render).toBeDefined();
    const renderedIds = level1Render!.features.map((f) => f.properties?.["__feature_id"]);
    expect(renderedIds).toEqual(expect.arrayContaining([LEVEL_1F, UNIT_ID, OCCUPANT_ID]));
    const occupantRender = level1Render!.features.find(
      (f) => f.properties?.["__feature_id"] === OCCUPANT_ID,
    );
    expect(occupantRender?.geometry).toEqual({ type: "Point", coordinates: [139.7666, 35.6806] });

    // level 2 has only its own feature (a Point, no occupants reference it)
    const level2Render = venue.renderFeaturesByLevel.get(LEVEL_2F);
    expect(level2Render?.features.map((f) => f.properties?.["__feature_id"])).toEqual([LEVEL_2F]);

    // searchEntries: reused buildSearchEntries, now indexes venue, level, unit, occupant
    expect(venue.searchEntries.map((e) => e.featureId).sort()).toEqual(
      [VENUE_ID, LEVEL_1F, LEVEL_2F, UNIT_ID, OCCUPANT_ID].sort(),
    );

    // boundsByLevel converted from DTO tuples into a Map
    expect(venue.boundsByLevel).toBeInstanceOf(Map);
    expect(venue.boundsByLevel.get(LEVEL_1F)).toEqual([139.766, 35.68, 139.768, 35.682]);
    expect(venue.boundsByLevel.has(LEVEL_2F)).toBe(false);

    // warnings: null -> undefined normalization for optional fields
    expect(venue.warnings).toEqual([
      {
        code: "missing_locale",
        message: `Feature ${OCCUPANT_ID} has no Japanese label.`,
        featureId: OCCUPANT_ID,
      },
    ]);

    // manifest reconstructed from the decoded rest object
    expect(venue.manifest).toEqual({ version: "1.0.0", language: "en", generated_by: "fixture" });
  });

  it("rejects a bundle whose venueId does not resolve to a decoded feature", () => {
    const dto = baseDto({ venueId: "not-a-real-feature-id" });
    expect(() => hydrateVenue(dto)).toThrow(VenueLoadError);
    try {
      hydrateVenue(dto);
      throw new Error("expected hydrateVenue to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(VenueLoadError);
      expect((error as VenueLoadError).code).toBe("invalid_bundle");
    }
  });

  it("rejects a feature that references a level absent from the decoded levels list", () => {
    const dto = baseDto();
    dto.features = dto.features.map((f) =>
      f.id === UNIT_ID ? { ...f, levelId: "unknown-level-id" } : f,
    );
    expect(() => hydrateVenue(dto)).toThrow(VenueLoadError);
  });

  it("rejects bounds that reference a level absent from the decoded levels list", () => {
    const dto = baseDto({ boundsByLevel: [["unknown-level-id", [0, 0, 1, 1]]] });
    expect(() => hydrateVenue(dto)).toThrow(VenueLoadError);
  });

  it("rejects a decoded feature with an unrecognized feature type", () => {
    const dto = baseDto();
    dto.features = dto.features.map((f) => (f.id === UNIT_ID ? { ...f, featureType: "mystery" } : f));
    expect(() => hydrateVenue(dto)).toThrow(VenueLoadError);
  });

  it("rejects a decoded bundle containing a duplicate feature ID", () => {
    const dto = baseDto();
    dto.features = [...dto.features, { ...dto.features[dto.features.length - 1]! }];
    expect(() => hydrateVenue(dto)).toThrow(VenueLoadError);
  });

  it("rejects a decoded bundle whose venueId resolves to a non-venue feature", () => {
    const dto = baseDto({ venueId: UNIT_ID });
    expect(() => hydrateVenue(dto)).toThrow(VenueLoadError);
  });

  it("rejects a decoded bundle containing more than one venue feature", () => {
    const dto = baseDto();
    const secondVenue = feature({
      id: "a1000009-0000-4000-8000-000000000009",
      featureType: "venue",
      labels: { en: "Second Venue" },
    });
    dto.features = [...dto.features, secondVenue];
    expect(() => hydrateVenue(dto)).toThrow(VenueLoadError);
  });

  it("rejects a decoded bundle with duplicate level IDs in the levels list", () => {
    const dto = baseDto();
    dto.levels = [...dto.levels, { ...dto.levels[0]! }];
    expect(() => hydrateVenue(dto)).toThrow(VenueLoadError);
  });

  it("rejects a decoded bundle whose level id does not resolve to a level feature", () => {
    const dto = baseDto();
    dto.levels = dto.levels.map((l) => (l.id === LEVEL_1F ? { ...l, id: UNIT_ID } : l));
    expect(() => hydrateVenue(dto)).toThrow(VenueLoadError);
  });

  it("rejects a decoded bundle that omits a level feature from the levels list", () => {
    const dto = baseDto();
    const level3Id = "b1000003-0000-4000-8000-000000000003";
    const level3Feature = feature({
      id: level3Id,
      featureType: "level",
      geometry: { type: "Point", coordinates: [139.767, 35.682] },
      labels: { en: "3F" },
      sourceProperties: { ordinal: 2 },
    });
    dto.features = [...dto.features, level3Feature];
    // dto.levels intentionally left without an entry for level3Id.
    expect(() => hydrateVenue(dto)).toThrow(VenueLoadError);
  });
  it("throws every structure/reference failure with bundle provenance", () => {
    const withUnknownFeatureType = baseDto();
    withUnknownFeatureType.features = withUnknownFeatureType.features.map((f) =>
      f.id === UNIT_ID ? { ...f, featureType: "mystery" } : f,
    );
    const withDuplicateFeature = baseDto();
    withDuplicateFeature.features = [
      ...withDuplicateFeature.features,
      { ...withDuplicateFeature.features[withDuplicateFeature.features.length - 1]! },
    ];
    const withDuplicateLevel = baseDto();
    withDuplicateLevel.levels = [...withDuplicateLevel.levels, { ...withDuplicateLevel.levels[0]! }];
    const withNonLevelLevel = baseDto();
    withNonLevelLevel.levels = withNonLevelLevel.levels.map((l) =>
      l.id === LEVEL_1F ? { ...l, id: UNIT_ID } : l,
    );

    const invalidDtos: DecodedVenueDto[] = [
      baseDto({ venueId: "not-a-real-feature-id" }),
      baseDto({ venueId: UNIT_ID }),
      baseDto({ boundsByLevel: [["unknown-level-id", [0, 0, 1, 1]]] }),
      withUnknownFeatureType,
      withDuplicateFeature,
      withDuplicateLevel,
      withNonLevelLevel,
    ];
    for (const dto of invalidDtos) {
      try {
        hydrateVenue(dto);
        throw new Error("expected hydrateVenue to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(VenueLoadError);
        expect((error as VenueLoadError).code).toBe("invalid_bundle");
        expect((error as VenueLoadError).source).toBe("bundle");
      }
    }
  });
});
