import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { FeatureType, LoadedVenue, ViewerFeature } from "../imdf/types";

/** Renderer-owned property keys flattened onto derived GeoJSON features. */
export interface RenderFeatureProperties {
  __feature_id: string;
  __feature_type: FeatureType;
  __level_id: string | null;
  __category: string | null;
  __restricted: boolean;
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

  const levelCollection = venue.renderFeaturesByLevel.get(levelId);
  if (levelCollection != null) {
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
