import type { SymbolLayerSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { themes } from "../theme/presets";
import {
  applyThemePaintProperties,
  buildFeatureLayers,
  CLICKABLE_LAYER_IDS,
  LAYER_AMENITY_CIRCLE,
  LAYER_CONTEXT_FILL,
  LAYER_CONTEXT_OUTLINE,
  LAYER_GDB_MARKER_ICON,
  LAYER_HOVER_OUTLINE,
  LAYER_NONPUBLIC_FILL,
  LAYER_NONPUBLIC_OUTLINE,
  LAYER_OCCUPANT_CIRCLE,
  LAYER_OPENING_LINE,
  LAYER_RESTROOM_FILL,
  LAYER_RESTROOM_OUTLINE,
  LAYER_ROOM_FILL,
  LAYER_TRANSIT_FILL,
  LAYER_TRANSIT_OUTLINE,
  LAYER_UNENCLOSED_FILL,
  LAYER_UNENCLOSED_OUTLINE,
  LAYER_WALKWAY_FILL,
  NONPUBLIC_CATEGORIES,
  TRANSIT_CATEGORIES,
  UNENCLOSED_CATEGORIES,
  WALKWAY_CATEGORIES,
} from "./featureLayers";

const theme = themes["tokyo-green"];

describe("gdb marker icon symbol layer", () => {
  const layers = buildFeatureLayers(theme);
  const iconLayer = layers.find((layer) => layer.id === LAYER_GDB_MARKER_ICON) as
    | SymbolLayerSpecification
    | undefined;

  it("is a symbol layer with the icon-image data expression and overlap config", () => {
    expect(iconLayer).toBeDefined();
    expect(iconLayer!.type).toBe("symbol");
    expect(iconLayer!.layout?.["icon-image"]).toEqual(["get", "__marker_icon"]);
    expect(iconLayer!.layout?.["icon-size"]).toBe(1);
    expect(iconLayer!.layout?.["icon-anchor"]).toBe("bottom");
    expect(iconLayer!.layout?.["icon-allow-overlap"]).toBe(false);
    expect(iconLayer!.filter).toEqual(["has", "__marker_icon"]);
  });

  it("renders after the point circles and before hover/selection outlines", () => {
    const ids = layers.map((layer) => layer.id);
    const iconIndex = ids.indexOf(LAYER_GDB_MARKER_ICON);
    expect(iconIndex).toBeGreaterThan(ids.indexOf(LAYER_OCCUPANT_CIRCLE));
    expect(iconIndex).toBeLessThan(ids.indexOf(LAYER_HOVER_OUTLINE));
  });

  it("is included in clickable hit-testing", () => {
    expect(CLICKABLE_LAYER_IDS).toContain(LAYER_GDB_MARKER_ICON);
  });

  it("keeps the amenity circle layer below the icon symbol as the WebGL fallback", () => {
    // Allowlisted POIs are excluded from DOM markers; their circle must still
    // render (beneath the icon) so they stay visible if an icon fails to load.
    const ids = layers.map((layer) => layer.id);
    expect(ids.indexOf(LAYER_AMENITY_CIRCLE)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(LAYER_AMENITY_CIRCLE)).toBeLessThan(ids.indexOf(LAYER_GDB_MARKER_ICON));
  });
});

function findLayer(id: string) {
  const layer = buildFeatureLayers(theme).find((candidate) => candidate.id === id);
  expect(layer, `layer ${id} exists`).toBeDefined();
  return layer!;
}

function fillColor(id: string): unknown {
  const layer = findLayer(id);
  expect(layer.type).toBe("fill");
  return (layer as import("maplibre-gl").FillLayerSpecification).paint?.["fill-color"];
}

describe("category sets", () => {
  it("assigns conveyances to transit, not walkway", () => {
    expect([...TRANSIT_CATEGORIES]).toEqual([
      "elevator",
      "escalator",
      "stairs",
      "steps",
      "movingwalkway",
    ]);
    expect(WALKWAY_CATEGORIES).not.toContain("movingwalkway");
  });

  it("covers both dark-area categories", () => {
    expect([...UNENCLOSED_CATEGORIES]).toEqual(["unenclosedarea", "opentobelow"]);
  });

  it("keeps nonpublic in its own beige bucket", () => {
    expect([...NONPUBLIC_CATEGORIES]).toEqual(["nonpublic"]);
  });
});

describe("buildFeatureLayers category coloring", () => {
  it("paints each bucket with its theme token", () => {
    const c = theme.colors;
    expect(fillColor(LAYER_TRANSIT_FILL)).toBe(c.unitTransit);
    expect(fillColor(LAYER_RESTROOM_FILL)).toBe(c.unitRestroom);
    expect(fillColor(LAYER_UNENCLOSED_FILL)).toBe(c.unitUnenclosed);
    expect(fillColor(LAYER_NONPUBLIC_FILL)).toBe(c.unitNonPublic);
    expect(fillColor(LAYER_ROOM_FILL)).toBe(c.unit);
    expect(fillColor(LAYER_WALKWAY_FILL)).toBe(c.walkway);
  });

  it("filters transit units by category and non-restricted state", () => {
    expect(findLayer(LAYER_TRANSIT_FILL).filter).toEqual([
      "all",
      ["==", ["get", "__feature_type"], "unit"],
      ["!=", ["get", "__restricted"], true],
      ["in", ["get", "__category"], ["literal", [...TRANSIT_CATEGORIES]]],
    ]);
  });

  it("gives restricted nonpublic units the beige category layer", () => {
    expect(findLayer(LAYER_NONPUBLIC_FILL).filter).toEqual([
      "all",
      ["==", ["get", "__feature_type"], "unit"],
      ["in", ["get", "__category"], ["literal", ["nonpublic"]]],
    ]);
    expect(findLayer("indoor-restricted-fill").filter).toEqual([
      "all",
      ["==", ["get", "__feature_type"], "unit"],
      ["==", ["get", "__restricted"], true],
      ["!", ["in", ["get", "__category"], ["literal", ["nonpublic", "parking"]]]],
    ]);
  });

  it("renders parking units in a clickable light-blue category layer", () => {
    const parkingFill = "indoor-parking-fill";
    expect(fillColor(parkingFill)).toBe("#c8ddea");
    expect(findLayer(parkingFill).filter).toEqual([
      "all",
      ["==", ["get", "__feature_type"], "unit"],
      ["in", ["get", "__category"], ["literal", ["parking"]]],
    ]);
    expect(CLICKABLE_LAYER_IDS).toContain(parkingFill);
    expect(JSON.stringify(findLayer("indoor-structure-fill").filter)).toContain("parking");
  });

  it("matches restrooms by 8-char category prefix", () => {
    expect(findLayer(LAYER_RESTROOM_FILL).filter).toEqual([
      "all",
      ["==", ["get", "__feature_type"], "unit"],
      ["!=", ["get", "__restricted"], true],
      ["==", ["slice", ["to-string", ["get", "__category"]], 0, 8], "restroom"],
    ]);
  });

  it("excludes the new buckets from the structure fallback", () => {
    const filter = JSON.stringify(findLayer("indoor-structure-fill").filter);
    expect(filter).toContain("movingwalkway");
    expect(filter).toContain("unenclosedarea");
    expect(filter).toContain("restroom");
    expect(filter).toContain("nonpublic");
  });

  it("registers the new fills as clickable", () => {
    expect(CLICKABLE_LAYER_IDS).toContain(LAYER_UNENCLOSED_FILL);
    expect(CLICKABLE_LAYER_IDS).toContain(LAYER_TRANSIT_FILL);
    expect(CLICKABLE_LAYER_IDS).toContain(LAYER_RESTROOM_FILL);
    expect(CLICKABLE_LAYER_IDS).toContain(LAYER_NONPUBLIC_FILL);
  });

  it("shows venue/building/footprint context without context hit-testing", () => {
    const contextFilter = [
      "in",
      ["get", "__feature_type"],
      ["literal", ["venue", "building", "footprint"]],
    ];
    expect(findLayer(LAYER_CONTEXT_FILL).filter).toEqual(contextFilter);
    expect(findLayer(LAYER_CONTEXT_OUTLINE).filter).toEqual(contextFilter);
    expect(CLICKABLE_LAYER_IDS).not.toContain(LAYER_CONTEXT_FILL);
    expect(CLICKABLE_LAYER_IDS).not.toContain(LAYER_CONTEXT_OUTLINE);
  });

  it("renders platform units in a dedicated clickable grey layer", () => {
    const platformFill = "indoor-platform-fill";
    expect(fillColor(platformFill)).toBe("#b8bdc2");
    expect(findLayer(platformFill).filter).toEqual([
      "all",
      ["==", ["get", "__feature_type"], "unit"],
      ["!=", ["get", "__restricted"], true],
      ["in", ["get", "__category"], ["literal", ["platform"]]],
    ]);
    expect(CLICKABLE_LAYER_IDS).toContain(platformFill);
    expect(JSON.stringify(findLayer("indoor-structure-fill").filter)).toContain("platform");
  });

  it("renders openings as a single clickable line layer, no endpoint circles", () => {
    const openingLayers = buildFeatureLayers(theme).filter(
      (layer) => JSON.stringify(layer.filter ?? null).includes('"opening"'),
    );
    expect(openingLayers.map((layer) => layer.type)).toEqual(["line"]);
    expect(openingLayers[0]!.id).toBe(LAYER_OPENING_LINE);
    expect(CLICKABLE_LAYER_IDS).toContain(LAYER_OPENING_LINE);
  });
});

describe("applyThemePaintProperties", () => {
  it("repaints the category layers on theme switch", () => {
    const c = themes["customer-blue"].colors;
    const calls: [string, string, unknown][] = [];
    applyThemePaintProperties((layerId, name, value) => {
      calls.push([layerId, name, value]);
    }, themes["customer-blue"]);

    for (const expected of [
      [LAYER_UNENCLOSED_FILL, "fill-color", c.unitUnenclosed],
      [LAYER_UNENCLOSED_OUTLINE, "line-color", c.unitOutline],
      [LAYER_TRANSIT_FILL, "fill-color", c.unitTransit],
      [LAYER_TRANSIT_OUTLINE, "line-color", c.unitOutline],
      [LAYER_RESTROOM_FILL, "fill-color", c.unitRestroom],
      [LAYER_RESTROOM_OUTLINE, "line-color", c.unitOutline],
      [LAYER_NONPUBLIC_FILL, "fill-color", c.unitNonPublic],
      [LAYER_NONPUBLIC_OUTLINE, "line-color", c.unitOutline],
      ["indoor-parking-fill", "fill-color", "#c8ddea"],
      ["indoor-parking-outline", "line-color", c.unitOutline],
      ["indoor-platform-fill", "fill-color", c.unitPlatform],
      ["indoor-platform-outline", "line-color", c.unitOutline],
    ]) {
      expect(calls).toContainEqual(expected);
    }
  });
});
