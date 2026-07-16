import { describe, expect, it } from "vitest";
import type {
  LoadedVenue,
  ViewerEnrichmentEntry,
  ViewerFeature,
  ViewerLevel,
} from "../imdf/types";
import { resolveSelectedFeatureContent } from "./resolveSelectedFeatureContent";

const level: ViewerLevel = {
  id: "level-1",
  sourceLevelIds: ["source-level-1"],
  ordinal: 0,
  label: { en: "First Floor", ja: "1階" },
  shortName: { en: "1F", ja: "1F" },
};

function feature(id: string, overrides: Partial<ViewerFeature> = {}): ViewerFeature {
  return {
    id,
    featureType: "occupant",
    levelId: level.id,
    geometry: null,
    center: null,
    labels: { en: id, ja: id },
    altLabels: {},
    category: "shop",
    accessibility: ["wheelchair"],
    restriction: null,
    sourceProperties: {},
    ...overrides,
  };
}

function venue(
  occupant: ViewerFeature,
  anchor: ViewerFeature,
  enrichment: Record<string, ViewerEnrichmentEntry>,
): LoadedVenue {
  const venueFeature = feature("venue", { featureType: "venue", levelId: null });
  return {
    manifest: { version: "1.0.0", language: "en" },
    venue: venueFeature,
    levels: [level],
    featuresById: new Map([
      [venueFeature.id, venueFeature],
      [occupant.id, occupant],
      [anchor.id, anchor],
    ]),
    renderFeaturesByLevel: new Map(),
    searchEntries: [],
    boundsByLevel: new Map(),
    enrichmentByFeatureId: new Map(Object.entries(enrichment)),
    warnings: [],
  };
}

describe("resolveSelectedFeatureContent", () => {
  it("resolves selected fields before anchor fields", () => {
    const anchor = feature("anchor");
    const occupant = feature("occupant", {
      labels: { en: "Station Shop" },
      sourceProperties: { anchor_id: anchor.id },
    });
    const loaded = venue(occupant, anchor, {
      [anchor.id]: {
        description: { en: "Anchor description" },
        hours: "Anchor hours",
        phone: "+81 3 0000 0000",
        website: "https://anchor.example.com",
      },
      [occupant.id]: {
        description: { en: "Occupant description" },
        hours: "Daily 09:00-21:00",
        phone: "+81 3 1234 5678",
        website: "https://example.com",
      },
    });

    expect(resolveSelectedFeatureContent(loaded, occupant, "en")).toMatchObject({
      name: "Station Shop",
      description: "Occupant description",
      hours: "Daily 09:00-21:00",
      phone: "+81 3 1234 5678",
      website: "https://example.com",
    });
  });

  it("falls back field-by-field to anchor enrichment and merges description locales", () => {
    const anchor = feature("anchor");
    const occupant = feature("occupant", { sourceProperties: { anchor_id: anchor.id } });
    const loaded = venue(occupant, anchor, {
      [anchor.id]: {
        description: { en: "Anchor English", ja: "アンカー" },
        hours: "Anchor hours",
        website: "https://anchor.example.com",
      },
      [occupant.id]: { description: { en: "Selected English" }, phone: "+81 3 1234 5678" },
    });

    expect(resolveSelectedFeatureContent(loaded, occupant, "ja")).toMatchObject({
      description: "アンカー",
      hours: "Anchor hours",
      phone: "+81 3 1234 5678",
      website: "https://anchor.example.com",
    });
    expect(resolveSelectedFeatureContent(loaded, occupant, "en").description).toBe(
      "Selected English",
    );
  });

  it("falls back to validated core contact fields", () => {
    const anchor = feature("anchor");
    const occupant = feature("occupant", {
      sourceProperties: {
        hours: "Mo-Fr 10:00-20:00",
        phone: "+81 (3) 1234-5678",
        website: "https://core.example.com",
      },
    });
    expect(resolveSelectedFeatureContent(venue(occupant, anchor, {}), occupant, "en")).toMatchObject({
      hours: "Mo-Fr 10:00-20:00",
      phone: "+81 (3) 1234-5678",
      website: "https://core.example.com",
    });

    const invalid = feature("invalid", {
      sourceProperties: { phone: "call-me", website: "http://insecure.example.com" },
    });
    expect(resolveSelectedFeatureContent(venue(invalid, anchor, {}), invalid, "en")).toMatchObject({
      phone: null,
      website: null,
    });
  });

  it("treats images atomically and honors explicit selected suppression", () => {
    const anchor = feature("anchor");
    const occupant = feature("occupant", { sourceProperties: { anchor_id: anchor.id } });
    const anchorImage: ViewerEnrichmentEntry = {
      images: [{ src: "/anchor.jpg", alt: { en: "Anchor alt" } }],
    };

    const selectedImage = venue(occupant, anchor, {
      [anchor.id]: anchorImage,
      [occupant.id]: { images: [{ src: "/selected.jpg", alt: { ja: "選択画像" } }] },
    });
    expect(resolveSelectedFeatureContent(selectedImage, occupant, "en").image).toEqual({
      src: "/selected.jpg",
      alt: "選択画像",
    });

    const suppressed = venue(occupant, anchor, {
      [anchor.id]: anchorImage,
      [occupant.id]: { images: [] },
    });
    expect(resolveSelectedFeatureContent(suppressed, occupant, "en").image).toBeNull();
  });

  it("chooses the selected feature entry when selected id collides with anchor id", () => {
    const occupant = feature("occupant", { sourceProperties: { anchor_id: "occupant" } });
    const loaded = venue(occupant, feature("anchor"), {
      occupant: { description: { en: "Selected wins" } },
    });
    expect(resolveSelectedFeatureContent(loaded, occupant, "en").description).toBe("Selected wins");
  });

  it("exposes original GDB columns in original order with provenance, excluding __gdb_ keys", () => {
    const anchor = feature("anchor");
    const gdb = feature("unit", {
      sourceProperties: {
        OBJECTID: 7,
        名称: "コンコース",
        FLOOR: "B1F",
        width: null,
        tags: ["a", "b"],
        opaque: 1n,
        __gdb_database: "gdb-1",
        __gdb_layer: "TokyoSta_B1_Space",
        __gdb_resolved_level_id: "xyz",
      },
    });
    const resolved = resolveSelectedFeatureContent(venue(gdb, anchor, {}), gdb, "en");
    expect(resolved.provenance).toBe("TokyoSta_B1_Space (gdb-1)");
    expect(resolved.sourceAttributes).toEqual([
      { field: "OBJECTID", value: "7" },
      { field: "名称", value: "コンコース" },
      { field: "FLOOR", value: "B1F" },
      { field: "width", value: "null" },
      { field: "tags", value: '["a","b"]' },
      { field: "opaque", value: "1" },
    ]);
  });

  it("keeps sourceAttributes null for IMDF features", () => {
    const anchor = feature("anchor");
    const occupant = feature("occupant", {
      sourceProperties: { hours: "Mo-Fr 10:00-20:00" },
    });
    const resolved = resolveSelectedFeatureContent(venue(occupant, anchor, {}), occupant, "en");
    expect(resolved.sourceAttributes).toBeNull();
    expect(resolved.provenance).toBeNull();
  });

  it("does not treat an IMDF feature with an incidental __gdb_layer property as GDB", () => {
    const anchor = feature("anchor");
    const occupant = feature("occupant", {
      sourceProperties: {
        __gdb_layer: "partner-layer",
        hours: "Mo-Fr 10:00-20:00",
      },
    });
    const resolved = resolveSelectedFeatureContent(venue(occupant, anchor, {}), occupant, "en");
    expect(resolved.sourceAttributes).toBeNull();
    expect(resolved.provenance).toBeNull();
  });
});
