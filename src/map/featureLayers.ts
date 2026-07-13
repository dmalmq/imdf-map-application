import type {
  CircleLayerSpecification,
  FillLayerSpecification,
  FilterSpecification,
  LineLayerSpecification,
} from "maplibre-gl";
import type { ViewerTheme } from "../theme/types";

/** Single GeoJSON source for the selected level + venue context. */
export const INDOOR_SOURCE_ID = "indoor-features";

export const BACKGROUND_LAYER_ID = "indoor-background";

export const LAYER_CONTEXT_FILL = "indoor-context-fill";
export const LAYER_CONTEXT_OUTLINE = "indoor-context-outline";
export const LAYER_WALKWAY_FILL = "indoor-walkway-fill";
export const LAYER_WALKWAY_OUTLINE = "indoor-walkway-outline";
export const LAYER_ROOM_FILL = "indoor-room-fill";
export const LAYER_ROOM_OUTLINE = "indoor-room-outline";
export const LAYER_STRUCTURE_FILL = "indoor-structure-fill";
export const LAYER_STRUCTURE_OUTLINE = "indoor-structure-outline";
export const LAYER_RESTRICTED_FILL = "indoor-restricted-fill";
export const LAYER_RESTRICTED_OUTLINE = "indoor-restricted-outline";
export const LAYER_FIXTURE_FILL = "indoor-fixture-fill";
export const LAYER_FIXTURE_OUTLINE = "indoor-fixture-outline";
export const LAYER_KIOSK_FILL = "indoor-kiosk-fill";
export const LAYER_KIOSK_OUTLINE = "indoor-kiosk-outline";
export const LAYER_DETAIL_LINE = "indoor-detail-line";
export const LAYER_OPENING_LINE = "indoor-opening-line";
export const LAYER_OPENING_CIRCLE = "indoor-opening-circle";
export const LAYER_AMENITY_CIRCLE = "indoor-amenity-circle";
export const LAYER_OCCUPANT_CIRCLE = "indoor-occupant-circle";
export const LAYER_HOVER_OUTLINE = "indoor-hover-outline";
export const LAYER_SELECTED_OUTLINE = "indoor-selected-outline";

/** Layers that participate in click / hover hit-testing. */
export const CLICKABLE_LAYER_IDS: readonly string[] = [
  LAYER_CONTEXT_FILL,
  LAYER_WALKWAY_FILL,
  LAYER_ROOM_FILL,
  LAYER_STRUCTURE_FILL,
  LAYER_RESTRICTED_FILL,
  LAYER_FIXTURE_FILL,
  LAYER_KIOSK_FILL,
  LAYER_DETAIL_LINE,
  LAYER_OPENING_LINE,
  LAYER_OPENING_CIRCLE,
  LAYER_AMENITY_CIRCLE,
  LAYER_OCCUPANT_CIRCLE,
];

const WALKWAY_CATEGORIES = [
  "walkway",
  "corridor",
  "opentowalkway",
  "ramp",
  "sidewalk",
  "movingwalkway",
] as const;

const ROOM_CATEGORIES = ["room"] as const;

type AnyLayer =
  | FillLayerSpecification
  | LineLayerSpecification
  | CircleLayerSpecification;

/**
 * Fixed layer order (plan §3):
 * 1. venue/footprint context fill+outline
 * 2. walkable units and rooms (+ level floor)
 * 3. structures, restricted units, fixtures, polygonal kiosks, details
 * 4. openings and entrances
 * 5. amenity and derived occupant points
 * 6. hover and selected-feature outlines
 */
export function buildFeatureLayers(theme: ViewerTheme): AnyLayer[] {
  const c = theme.colors;

  const matchFeatureType = (...types: string[]): FilterSpecification => {
    if (types.length === 1) {
      return ["==", ["get", "__feature_type"], types[0]!];
    }
    return ["in", ["get", "__feature_type"], ["literal", types]];
  };

  const matchWalkwayUnit: FilterSpecification = [
    "all",
    ["==", ["get", "__feature_type"], "unit"],
    ["!=", ["get", "__restricted"], true],
    ["in", ["get", "__category"], ["literal", [...WALKWAY_CATEGORIES]]],
  ];

  const matchRoomUnit: FilterSpecification = [
    "all",
    ["==", ["get", "__feature_type"], "unit"],
    ["!=", ["get", "__restricted"], true],
    ["in", ["get", "__category"], ["literal", [...ROOM_CATEGORIES]]],
  ];

  const matchStructureUnit: FilterSpecification = [
    "all",
    ["==", ["get", "__feature_type"], "unit"],
    ["!=", ["get", "__restricted"], true],
    ["!", ["in", ["get", "__category"], ["literal", [...WALKWAY_CATEGORIES]]]],
    ["!", ["in", ["get", "__category"], ["literal", [...ROOM_CATEGORIES]]]],
  ];

  const matchRestrictedUnit: FilterSpecification = [
    "all",
    ["==", ["get", "__feature_type"], "unit"],
    ["==", ["get", "__restricted"], true],
  ];

  const matchLevelFloor: FilterSpecification = [
    "==",
    ["get", "__feature_type"],
    "level",
  ];

  const layers: AnyLayer[] = [
    // 1. Context
    {
      id: LAYER_CONTEXT_FILL,
      type: "fill",
      source: INDOOR_SOURCE_ID,
      filter: matchFeatureType("venue", "building", "footprint"),
      paint: {
        "fill-color": c.unit,
        "fill-opacity": 0.55,
      },
    },
    {
      id: LAYER_CONTEXT_OUTLINE,
      type: "line",
      source: INDOOR_SOURCE_ID,
      filter: matchFeatureType("venue", "building", "footprint"),
      paint: {
        "line-color": c.unitOutline,
        "line-width": 1.5,
      },
    },

    // 2. Walkable units / level floor / rooms
    {
      id: LAYER_WALKWAY_FILL,
      type: "fill",
      source: INDOOR_SOURCE_ID,
      filter: ["any", matchLevelFloor, matchWalkwayUnit],
      paint: {
        "fill-color": c.walkway,
        "fill-opacity": 1,
      },
    },
    {
      id: LAYER_WALKWAY_OUTLINE,
      type: "line",
      source: INDOOR_SOURCE_ID,
      filter: ["any", matchLevelFloor, matchWalkwayUnit],
      paint: {
        "line-color": c.unitOutline,
        "line-width": 0.75,
      },
    },
    {
      id: LAYER_ROOM_FILL,
      type: "fill",
      source: INDOOR_SOURCE_ID,
      filter: matchRoomUnit,
      paint: {
        "fill-color": c.unit,
        "fill-opacity": 1,
      },
    },
    {
      id: LAYER_ROOM_OUTLINE,
      type: "line",
      source: INDOOR_SOURCE_ID,
      filter: matchRoomUnit,
      paint: {
        "line-color": c.unitOutline,
        "line-width": 1,
      },
    },

    // 3. Structures, restricted, fixtures, kiosks, details
    {
      id: LAYER_STRUCTURE_FILL,
      type: "fill",
      source: INDOOR_SOURCE_ID,
      filter: matchStructureUnit,
      paint: {
        "fill-color": c.unit,
        "fill-opacity": 0.92,
      },
    },
    {
      id: LAYER_STRUCTURE_OUTLINE,
      type: "line",
      source: INDOOR_SOURCE_ID,
      filter: matchStructureUnit,
      paint: {
        "line-color": c.unitOutline,
        "line-width": 1,
      },
    },
    {
      id: LAYER_RESTRICTED_FILL,
      type: "fill",
      source: INDOOR_SOURCE_ID,
      filter: matchRestrictedUnit,
      paint: {
        "fill-color": c.restricted,
        "fill-opacity": 1,
      },
    },
    {
      id: LAYER_RESTRICTED_OUTLINE,
      type: "line",
      source: INDOOR_SOURCE_ID,
      filter: matchRestrictedUnit,
      paint: {
        "line-color": c.unitOutline,
        "line-width": 1,
      },
    },
    {
      id: LAYER_FIXTURE_FILL,
      type: "fill",
      source: INDOOR_SOURCE_ID,
      filter: matchFeatureType("fixture"),
      paint: {
        "fill-color": c.unitOutline,
        "fill-opacity": 0.85,
      },
    },
    {
      id: LAYER_FIXTURE_OUTLINE,
      type: "line",
      source: INDOOR_SOURCE_ID,
      filter: matchFeatureType("fixture"),
      paint: {
        "line-color": c.muted,
        "line-width": 0.75,
      },
    },
    {
      id: LAYER_KIOSK_FILL,
      type: "fill",
      source: INDOOR_SOURCE_ID,
      filter: matchFeatureType("kiosk"),
      paint: {
        "fill-color": c.accentSoft,
        "fill-opacity": 1,
      },
    },
    {
      id: LAYER_KIOSK_OUTLINE,
      type: "line",
      source: INDOOR_SOURCE_ID,
      filter: matchFeatureType("kiosk"),
      paint: {
        "line-color": c.accent,
        "line-width": 1,
      },
    },
    {
      id: LAYER_DETAIL_LINE,
      type: "line",
      source: INDOOR_SOURCE_ID,
      filter: matchFeatureType("detail"),
      paint: {
        "line-color": c.muted,
        "line-width": 0.8,
        "line-opacity": 0.8,
      },
    },

    // 4. Openings
    {
      id: LAYER_OPENING_LINE,
      type: "line",
      source: INDOOR_SOURCE_ID,
      filter: matchFeatureType("opening"),
      paint: {
        "line-color": c.opening,
        "line-width": 2.5,
      },
    },
    {
      id: LAYER_OPENING_CIRCLE,
      type: "circle",
      source: INDOOR_SOURCE_ID,
      filter: matchFeatureType("opening"),
      paint: {
        "circle-radius": 3.5,
        "circle-color": c.opening,
        "circle-stroke-width": 1,
        "circle-stroke-color": c.panel,
      },
    },

    // 5. Amenity + occupant points
    {
      id: LAYER_AMENITY_CIRCLE,
      type: "circle",
      source: INDOOR_SOURCE_ID,
      filter: matchFeatureType("amenity"),
      paint: {
        "circle-radius": 4.5,
        "circle-color": c.accent,
        "circle-stroke-width": 1.25,
        "circle-stroke-color": c.panel,
      },
    },
    {
      id: LAYER_OCCUPANT_CIRCLE,
      type: "circle",
      source: INDOOR_SOURCE_ID,
      filter: matchFeatureType("occupant"),
      paint: {
        "circle-radius": 4.5,
        "circle-color": c.accent,
        "circle-stroke-width": 1.25,
        "circle-stroke-color": c.panel,
      },
    },

    // 6. Hover / selected outlines. Feature-state expressions are not
    // allowed in filters, so both layers cover all features and gate
    // visibility through state-driven line-opacity.
    {
      id: LAYER_HOVER_OUTLINE,
      type: "line",
      source: INDOOR_SOURCE_ID,
      paint: {
        "line-color": c.accent,
        "line-width": 2,
        "line-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          0.85,
          0,
        ],
      },
    },
    {
      id: LAYER_SELECTED_OUTLINE,
      type: "line",
      source: INDOOR_SOURCE_ID,
      paint: {
        "line-color": c.selected,
        "line-width": 3.5,
        "line-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          1,
          0,
        ],
      },
    },
  ];

  return layers;
}

/** Paint property updates applied on theme switch without rebuilding the style. */
export function applyThemePaintProperties(
  setPaintProperty: (layerId: string, name: string, value: unknown) => void,
  theme: ViewerTheme,
): void {
  const c = theme.colors;

  setPaintProperty(LAYER_CONTEXT_FILL, "fill-color", c.unit);
  setPaintProperty(LAYER_CONTEXT_OUTLINE, "line-color", c.unitOutline);

  setPaintProperty(LAYER_WALKWAY_FILL, "fill-color", c.walkway);
  setPaintProperty(LAYER_WALKWAY_OUTLINE, "line-color", c.unitOutline);
  setPaintProperty(LAYER_ROOM_FILL, "fill-color", c.unit);
  setPaintProperty(LAYER_ROOM_OUTLINE, "line-color", c.unitOutline);

  setPaintProperty(LAYER_STRUCTURE_FILL, "fill-color", c.unit);
  setPaintProperty(LAYER_STRUCTURE_OUTLINE, "line-color", c.unitOutline);
  setPaintProperty(LAYER_RESTRICTED_FILL, "fill-color", c.restricted);
  setPaintProperty(LAYER_RESTRICTED_OUTLINE, "line-color", c.unitOutline);
  setPaintProperty(LAYER_FIXTURE_FILL, "fill-color", c.unitOutline);
  setPaintProperty(LAYER_FIXTURE_OUTLINE, "line-color", c.muted);
  setPaintProperty(LAYER_KIOSK_FILL, "fill-color", c.accentSoft);
  setPaintProperty(LAYER_KIOSK_OUTLINE, "line-color", c.accent);
  setPaintProperty(LAYER_DETAIL_LINE, "line-color", c.muted);

  setPaintProperty(LAYER_OPENING_LINE, "line-color", c.opening);
  setPaintProperty(LAYER_OPENING_CIRCLE, "circle-color", c.opening);
  setPaintProperty(LAYER_OPENING_CIRCLE, "circle-stroke-color", c.panel);

  setPaintProperty(LAYER_AMENITY_CIRCLE, "circle-color", c.accent);
  setPaintProperty(LAYER_AMENITY_CIRCLE, "circle-stroke-color", c.panel);
  setPaintProperty(LAYER_OCCUPANT_CIRCLE, "circle-color", c.accent);
  setPaintProperty(LAYER_OCCUPANT_CIRCLE, "circle-stroke-color", c.panel);

  setPaintProperty(LAYER_HOVER_OUTLINE, "line-color", c.accent);
  setPaintProperty(LAYER_SELECTED_OUTLINE, "line-color", c.selected);

  setPaintProperty(BACKGROUND_LAYER_ID, "background-color", c.canvas);
}
