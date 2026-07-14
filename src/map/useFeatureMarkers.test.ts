import { act, render } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FeatureType, LoadedVenue, ViewerFeature } from "../imdf/types";
import {
  collectMarkerFeatures,
  focusFeatureMarker,
  markerIconFor,
  markerLabelFor,
  markerTransformAtPoint,
  showFullMarkerLabelsAtZoom,
  useFeatureMarkers,
} from "./useFeatureMarkers";

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
    enrichmentByFeatureId: new Map(),
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
    const ids = collectMarkerFeatures(venue, LEVEL, null, "all").map((f) => f.id);
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
    const ids = collectMarkerFeatures(venue, LEVEL, null, "all").map((f) => f.id);
    expect(ids).toEqual(["a-unlinked", "u-elevator", "a-nonbubble"]);
  });

  it("includes unnamed rooms but skips centerless units", () => {
    const venue = venueWith([
      feature("u-room-unnamed", "unit", "room", { labels: {} }),
      feature("u-stairs-nocenter", "unit", "stairs", { center: null }),
      feature("u-room-named", "unit", "room"),
      feature("u-nonpublic-unnamed", "unit", "nonpublic", { labels: {} }),
      feature("u-walkway-unnamed", "unit", "walkway", { labels: {} }),
    ]);
    const ids = collectMarkerFeatures(venue, LEVEL, null, "all").map((f) => f.id);
    expect(ids).toEqual(["u-room-named", "u-nonpublic-unnamed", "u-room-unnamed"]);
  });

  it("keeps conveyance bubbles when a crowded level hits the cap", () => {
    const crowd: ViewerFeature[] = [];
    for (let i = 0; i < 250; i += 1) {
      crowd.push(feature(`occ-${String(i).padStart(3, "0")}`, "occupant", null));
    }
    const venue = venueWith([...crowd, feature("u-elevator", "unit", "elevator")]);
    const result = collectMarkerFeatures(venue, LEVEL, null, "all");
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
    const ids = collectMarkerFeatures(venue, LEVEL, null, "all").map((f) => f.id);
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
    const ids = collectMarkerFeatures(venue, LEVEL, "u-room-z", "all").map((f) => f.id);
    expect(ids).toHaveLength(200);
    expect(ids[0]).toBe("u-room-z");
  });

  it("keeps named unit pills ahead of compact unnamed category fallbacks at the cap", () => {
    const features: ViewerFeature[] = [];
    for (let i = 0; i < 250; i += 1) {
      features.push(
        feature(`a-unnamed-${String(i).padStart(3, "0")}`, "unit", "nonpublic", {
          labels: {},
        }),
      );
    }
    features.push(feature("z-named-room", "unit", "room"));
    const ids = collectMarkerFeatures(venueWith(features), LEVEL, null, "all").map((f) => f.id);
    expect(ids).toHaveLength(200);
    expect(ids).toContain("z-named-room");
  });

  it("excludes features on other levels", () => {
    const venue = venueWith([
      feature("u-stairs-here", "unit", "stairs"),
      feature("u-stairs-there", "unit", "stairs", { levelId: "level-2" }),
    ]);
    const ids = collectMarkerFeatures(venue, LEVEL, null, "all").map((f) => f.id);
    expect(ids).toEqual(["u-stairs-here"]);
  });

  it("filters markers by search category and only promotes pedestrian openings in gates", () => {
    const venue = venueWith([
      feature("shop", "occupant", "shopping"),
      feature("amenity", "amenity", "information"),
      feature("kiosk", "kiosk", null),
      feature("elevator", "unit", "elevator"),
      feature("walkway", "unit", "walkway"),
      feature("pedestrian-opening", "opening", "pedestrian"),
      feature("service-opening", "opening", "service"),
    ]);

    expect(collectMarkerFeatures(venue, LEVEL, null, "shops").map((entry) => entry.id)).toEqual([
      "shop",
    ]);
    expect(collectMarkerFeatures(venue, LEVEL, null, "facilities").map((entry) => entry.id)).toEqual([
      "elevator",
      "amenity",
      "kiosk",
    ]);
    expect(collectMarkerFeatures(venue, LEVEL, null, "gates").map((entry) => entry.id)).toEqual([
      "pedestrian-opening",
    ]);
    expect(collectMarkerFeatures(venue, LEVEL, null, "all").map((entry) => entry.id)).not.toContain(
      "pedestrian-opening",
    );
  });
});

describe("markerLabelFor", () => {
  it("uses a name when present and category when an eligible unit is unnamed", () => {
    expect(markerLabelFor(feature("named", "unit", "room"), "en", "ja")).toBe("named");
    expect(
      markerLabelFor(feature("unnamed-room", "unit", "room", { labels: {} }), "en", "ja"),
    ).toBe("Room");
    expect(
      markerLabelFor(feature("unnamed-stairs", "unit", "stairs", { labels: {} }), "ja", "en"),
    ).toBe("階段");
    expect(
      markerLabelFor(
        feature("unnamed-nonpublic", "unit", "nonpublic", { labels: {} }),
        "en",
        "ja",
      ),
    ).toBe("nonpublic");
    expect(
      markerLabelFor(
        feature("unnamed-restroom", "unit", "restroom.female", { labels: {} }),
        "en",
        "ja",
      ),
    ).toBe("Women's Restroom");
  });

  it("labels unnamed pedestrian openings as Entrance or 入口", () => {
    expect(markerLabelFor(feature("gate", "opening", "pedestrian", { labels: {} }), "en", "ja")).toBe(
      "Entrance",
    );
    expect(markerLabelFor(feature("gate", "opening", "pedestrian", { labels: {} }), "ja", "en")).toBe(
      "入口",
    );
  });
});

describe("compact marker zoom state", () => {
  it("expands every text marker at zoom 17.4", () => {
    expect(showFullMarkerLabelsAtZoom(17)).toBe(false);
    expect(showFullMarkerLabelsAtZoom(17.39)).toBe(false);
    expect(showFullMarkerLabelsAtZoom(17.4)).toBe(true);
  });

  it("centers compact dots using their rendered size", () => {
    expect(markerTransformAtPoint({ x: 100, y: 100 }, 80, 24, true, true)).toBe(
      "translate(95px, 95px)",
    );
    expect(markerTransformAtPoint({ x: 100, y: 100 }, 80, 24, true, false)).toBe(
      "translate(60px, 76px)",
    );
    expect(markerTransformAtPoint({ x: 100, y: 100 }, 24, 24, false, false)).toBe(
      "translate(88px, 88px)",
    );
  });
});

describe("useFeatureMarkers", () => {
  it("measures full pills when the map moves before fonts are ready", async () => {
    let resolveFonts!: () => void;
    const fontsReady = new Promise<void>((resolve) => {
      resolveFonts = resolve;
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: fontsReady },
    });

    const canvasContainer = document.createElement("div");
    const listeners = new Map<string, Set<() => void>>();
    let zoom = 16;
    const map = {
      getCanvasContainer: () => canvasContainer,
      getZoom: () => zoom,
      project: () => ({ x: 100, y: 100 }),
      on: (event: string, listener: () => void) => {
        const eventListeners = listeners.get(event) ?? new Set();
        eventListeners.add(listener);
        listeners.set(event, eventListeners);
      },
      off: (event: string, listener: () => void) => {
        listeners.get(event)?.delete(listener);
      },
    } as unknown as MapLibreMap;

    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const expanded = this.parentElement?.classList.contains("indoor-marker-overlay--expanded");
        return {
          width: expanded ? 80 : 10,
          height: expanded ? 24 : 10,
        } as DOMRect;
      });

    function Harness() {
      useFeatureMarkers({
        map,
        venue: venueWith([feature("room", "unit", "room")]),
        levelId: LEVEL,
        locale: "en",
        selectedFeatureId: null,
        searchCategory: "all",
        onSelect: vi.fn(),
      });
      return null;
    }

    render(createElement(Harness));
    listeners.get("move")?.forEach((listener) => {
      listener();
    });

    await act(async () => {
      resolveFonts();
      await fontsReady;
    });

    zoom = 17.4;
    listeners.get("move")?.forEach((listener) => {
      listener();
    });
    expect(canvasContainer.querySelector<HTMLButtonElement>(".indoor-marker")?.style.transform).toBe(
      "translate(60px, 76px)",
    );

    rectSpy.mockRestore();
  });

  it("keeps focus on the matching marker through selection recreation", async () => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    const canvasContainer = document.createElement("div");
    document.body.append(canvasContainer);
    const map = {
      getCanvasContainer: () => canvasContainer,
      getZoom: () => 17.4,
      project: () => ({ x: 100, y: 100 }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as MapLibreMap;

    function Harness({ selectedFeatureId }: { selectedFeatureId: string | null }) {
      useFeatureMarkers({
        map,
        venue: venueWith([feature("room", "unit", "room")]),
        levelId: LEVEL,
        locale: "en",
        selectedFeatureId,
        searchCategory: "all",
        onSelect: vi.fn(),
      });
      return null;
    }

    const { rerender } = render(createElement(Harness, { selectedFeatureId: null }));
    await act(async () => {});

    const marker = canvasContainer.querySelector<HTMLButtonElement>('[data-feature-id="room"]');
    expect(marker).not.toBeNull();
    marker!.focus();
    expect(document.activeElement).toBe(marker);

    rerender(createElement(Harness, { selectedFeatureId: "room" }));
    await act(async () => {});
    expect(document.activeElement).toBe(
      canvasContainer.querySelector('[data-feature-id="room"]'),
    );
    expect(
      canvasContainer
        .querySelector('[data-feature-id="room"]')
        ?.classList.contains("indoor-marker--selected"),
    ).toBe(true);

    rerender(createElement(Harness, { selectedFeatureId: null }));
    await act(async () => {});
    expect(document.activeElement).toBe(
      canvasContainer.querySelector('[data-feature-id="room"]'),
    );

    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    expect(focusFeatureMarker("room", canvasContainer)).toBe(true);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(focusFeatureMarker("missing", canvasContainer)).toBe(false);
    focusSpy.mockRestore();
    canvasContainer.remove();
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
