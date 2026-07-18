import {
  LAYER_AMENITY_CIRCLE,
  LAYER_DETAIL_LINE,
  LAYER_FIXTURE_FILL,
  LAYER_FIXTURE_OUTLINE,
  LAYER_KIOSK_FILL,
  LAYER_KIOSK_OUTLINE,
  LAYER_NONPUBLIC_FILL,
  LAYER_NONPUBLIC_OUTLINE,
  LAYER_OCCUPANT_CIRCLE,
  LAYER_OPENING_LINE,
  LAYER_RESTRICTED_FILL,
  LAYER_RESTRICTED_OUTLINE,
  LAYER_RESTROOM_FILL,
  LAYER_RESTROOM_OUTLINE,
  LAYER_ROOM_FILL,
  LAYER_ROOM_OUTLINE,
  LAYER_STRUCTURE_FILL,
  LAYER_STRUCTURE_OUTLINE,
  LAYER_TRANSIT_FILL,
  LAYER_TRANSIT_OUTLINE,
  LAYER_UNENCLOSED_FILL,
  LAYER_UNENCLOSED_OUTLINE,
} from "./featureLayers";

/**
 * Toggleable layer groups for the Layers panel. The venue footprint and
 * walkways always render — they are the floor the rest sits on. "labels"
 * covers the DOM feature markers rather than MapLibre layers.
 */
export type MapLayerGroup = "units" | "openings" | "fixtures" | "amenities" | "labels";

export type LayerVisibility = Record<MapLayerGroup, boolean>;

export const defaultLayerVisibility: LayerVisibility = {
  units: true,
  openings: true,
  fixtures: true,
  amenities: true,
  labels: true,
};

/** MapLibre layer ids per toggleable group ("labels" has none). */
export const LAYER_GROUP_IDS: Record<MapLayerGroup, readonly string[]> = {
  units: [
    LAYER_ROOM_FILL,
    LAYER_ROOM_OUTLINE,
    LAYER_UNENCLOSED_FILL,
    LAYER_UNENCLOSED_OUTLINE,
    LAYER_TRANSIT_FILL,
    LAYER_TRANSIT_OUTLINE,
    LAYER_RESTROOM_FILL,
    LAYER_RESTROOM_OUTLINE,
    LAYER_NONPUBLIC_FILL,
    LAYER_NONPUBLIC_OUTLINE,
    LAYER_STRUCTURE_FILL,
    LAYER_STRUCTURE_OUTLINE,
    LAYER_RESTRICTED_FILL,
    LAYER_RESTRICTED_OUTLINE,
  ],
  openings: [LAYER_OPENING_LINE],
  fixtures: [
    LAYER_FIXTURE_FILL,
    LAYER_FIXTURE_OUTLINE,
    LAYER_KIOSK_FILL,
    LAYER_KIOSK_OUTLINE,
    LAYER_DETAIL_LINE,
  ],
  amenities: [LAYER_AMENITY_CIRCLE, LAYER_OCCUPANT_CIRCLE],
  labels: [],
};
