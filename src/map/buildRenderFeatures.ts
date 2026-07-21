import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { FeatureType, LoadedVenue, ViewerFeature } from "../imdf/types";
import { levelIdsForOrdinal, ordinalOfLevel } from "../state/floorGroups";
import { color2Fill } from "./color2";

/** Renderer-owned property keys flattened onto derived GeoJSON features. */
export interface RenderFeatureProperties {
  __feature_id: string;
  __feature_type: FeatureType;
  __level_id: string | null;
  __category: string | null;
  __restricted: boolean;
  /** Per-unit fill resolved from the source `color2` value; absent when not applicable. */
  __unit_color?: string;
  [key: string]: unknown;
}

const CONTEXT_FEATURE_TYPES: Record<string, true> = {
  venue: true,
  building: true,
  footprint: true,
};

/**
 * Null when the feature has no usable geometry (after derived-occupant substitution).
 */
export function renderFeatureFromViewer(
  feature: ViewerFeature,
  geometryOverride?: Geometry,
): Feature | null {
  const geometry = geometryOverride ?? feature.geometry;
  if (geometry == null) {
    return null;
  }

  const properties: RenderFeatureProperties = {
    __feature_id: feature.id,
    __feature_type: feature.featureType,
    __level_id: feature.levelId,
    __category: feature.category,
    __restricted: feature.restriction !== null,
  };

  if (feature.featureType === "unit") {
    const unitColor = color2Fill(feature.sourceProperties["color2"]);
    if (unitColor !== null) {
      properties.__unit_color = unitColor;
    }
  }

  return {
    type: "Feature",
    id: feature.id,
    geometry,
    properties,
  };
}

/**
 * Selected-level features plus venue/building/footprint context.
 * Does not mutate the venue model.
 */
export function buildRenderFeatures(
  venue: LoadedVenue,
  levelId: string,
): FeatureCollection {
  const features: Feature[] = [];
  const seen = new Map<string, true>();

  const pushFeature = (feature: ViewerFeature): void => {
    if (seen.has(feature.id)) {
      return;
    }
    const rendered = renderFeatureFromViewer(feature);
    if (rendered == null) {
      return;
    }
    seen.set(feature.id, true);
    features.push(rendered);
  };

  // Context features are level-independent and always included when present.
  pushFeature(venue.venue);
  for (const feature of venue.featuresById.values()) {
    if (CONTEXT_FEATURE_TYPES[feature.featureType] === true) {
      pushFeature(feature);
    }
  }

  // Render every level sharing the selected level's ordinal, so a multi-building
  // floor shows all buildings at once. Falls back to the single level when the
  // ordinal can't be resolved.
  const ordinal = ordinalOfLevel(venue.levels, levelId);
  const groupLevelIds = ordinal === null ? [levelId] : levelIdsForOrdinal(venue.levels, ordinal);
  for (const groupLevelId of groupLevelIds) {
    const levelCollection = venue.renderFeaturesByLevel.get(groupLevelId);
    if (levelCollection == null) {
      continue;
    }
    for (const feature of levelCollection.features) {
      const id = feature.id;
      const featureId =
        typeof id === "string" || typeof id === "number"
          ? String(id)
          : typeof feature.properties?.["__feature_id"] === "string"
            ? (feature.properties["__feature_id"] as string)
            : null;
      if (featureId != null && seen.has(featureId)) {
        continue;
      }
      if (featureId != null) {
        seen.set(featureId, true);
      }
      features.push(feature);
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}
