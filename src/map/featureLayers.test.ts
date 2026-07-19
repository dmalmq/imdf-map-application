import { describe, expect, it } from "vitest";
import type { CircleLayerSpecification, LineLayerSpecification } from "maplibre-gl";
import { themes } from "../theme/presets";
import {
  applyThemePaintProperties,
  buildFeatureLayers,
  CLICKABLE_LAYER_IDS,
  LAYER_ISSUE_HIGHLIGHT_OUTLINE,
  LAYER_ISSUE_HIGHLIGHT_POINT,
  LAYER_SELECTED_OUTLINE,
  LAYER_NONPUBLIC_FILL,
  LAYER_NONPUBLIC_OUTLINE,
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

const theme = themes.kiriko;

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
  it("repaints the category layers", () => {
    const c = themes.kiriko.colors;
    const calls: [string, string, unknown][] = [];
    applyThemePaintProperties((layerId, name, value) => {
      calls.push([layerId, name, value]);
    }, themes.kiriko);

    for (const expected of [
      [LAYER_UNENCLOSED_FILL, "fill-color", c.unitUnenclosed],
      [LAYER_UNENCLOSED_OUTLINE, "line-color", c.unitOutline],
      [LAYER_TRANSIT_FILL, "fill-color", c.unitTransit],
      [LAYER_TRANSIT_OUTLINE, "line-color", c.unitOutline],
      [LAYER_RESTROOM_FILL, "fill-color", c.unitRestroom],
      [LAYER_RESTROOM_OUTLINE, "line-color", c.unitOutline],
      [LAYER_NONPUBLIC_FILL, "fill-color", c.unitNonPublic],
      [LAYER_NONPUBLIC_OUTLINE, "line-color", c.unitOutline],
    ]) {
      expect(calls).toContainEqual(expected);
    }
  });
});

describe("issue highlight outline", () => {
  it("gates a dedicated outline on the issueHighlight feature-state, distinct from selection", () => {
    const layer = findLayer(LAYER_ISSUE_HIGHLIGHT_OUTLINE) as LineLayerSpecification;
    expect(layer.type).toBe("line");
    expect(layer.paint?.["line-opacity"]).toEqual([
      "case",
      ["boolean", ["feature-state", "issueHighlight"], false],
      1,
      0,
    ]);
    expect(layer.paint?.["line-color"]).toBe(theme.colors.warning);

    const selected = findLayer(LAYER_SELECTED_OUTLINE) as LineLayerSpecification;
    expect(layer.paint?.["line-color"]).not.toBe(selected.paint?.["line-color"]);
    expect(JSON.stringify(selected.paint?.["line-opacity"])).not.toContain("issueHighlight");
  });

  it("gates a point-highlight circle on the issueHighlight feature-state for Point features", () => {
    const layer = findLayer(LAYER_ISSUE_HIGHLIGHT_POINT) as CircleLayerSpecification;
    expect(layer.type).toBe("circle");
    expect(layer.paint?.["circle-stroke-opacity"]).toEqual([
      "case",
      ["boolean", ["feature-state", "issueHighlight"], false],
      1,
      0,
    ]);
    expect(layer.paint?.["circle-stroke-color"]).toBe(theme.colors.warning);
    // Independent of map selection: the circle never keys off the selected state.
    expect(JSON.stringify(layer.paint?.["circle-stroke-opacity"])).not.toContain("selected");
  });

  it("repaints the point highlight color on theme switch", () => {
    const calls: [string, string, unknown][] = [];
    applyThemePaintProperties((layerId, name, value) => {
      calls.push([layerId, name, value]);
    }, theme);
    expect(calls).toContainEqual([LAYER_ISSUE_HIGHLIGHT_POINT, "circle-stroke-color", theme.colors.warning]);
  });

  it("repaints the issue highlight color on theme switch", () => {
    const calls: [string, string, unknown][] = [];
    applyThemePaintProperties((layerId, name, value) => {
      calls.push([layerId, name, value]);
    }, theme);
    expect(calls).toContainEqual([LAYER_ISSUE_HIGHLIGHT_OUTLINE, "line-color", theme.colors.warning]);
  });
});
