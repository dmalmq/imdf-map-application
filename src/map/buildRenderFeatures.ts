import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { FeatureType, LoadedVenue, ViewerFeature } from "../imdf/types";
import { gdbMarkerIconId } from "./gdbMarkerIcons";
import { color2Fill } from "./color2";
import { isTypeAndBuildingVisible, type VisibilitySelection } from "./visibility";

/** Renderer-owned property keys flattened onto derived GeoJSON features. */
export interface RenderFeatureProperties {
  __feature_id: string;
  __feature_type: FeatureType;
  __level_id: string | null;
  __category: string | null;
  __restricted: boolean;
  __building_id: string | null;
  /** Per-unit fill from the source `color2` value; absent when not applicable. */
  __unit_color?: string;
  /** Local symbol-layer icon id derived from `sourceProperties.image`, when allowlisted. */
  __marker_icon?: string;
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
    __building_id: feature.buildingId,
  };

  if (feature.featureType === "unit") {
    const unitColor = color2Fill(feature.sourceProperties["color2"]);
    if (unitColor !== null) {
      properties.__unit_color = unitColor;
    }
  }

  const markerIcon = gdbMarkerIconId(feature.sourceProperties["image"]);
  if (markerIcon !== null) {
    properties.__marker_icon = markerIcon;
  }

  return {
    type: "Feature",
    id: feature.id,
    geometry,
    properties,
  };
}

/** Whether a precomputed level feature survives the current visibility selection. */
function levelFeatureVisible(
  properties: unknown,
  visibility: VisibilitySelection | undefined,
): boolean {
  if (visibility === undefined) {
    return true;
  }
  if (properties === null || typeof properties !== "object") {
    return true;
  }
  const props = properties as Record<string, unknown>;
  const featureType = props["__feature_type"];
  if (typeof featureType !== "string") {
    return true;
  }
  const buildingId = props["__building_id"];
  return isTypeAndBuildingVisible(
    featureType as FeatureType,
    typeof buildingId === "string" ? buildingId : null,
    visibility,
  );
}

/**
 * Selected-level features plus venue/building/footprint context.
 * Does not mutate the venue model.
 */
export function buildRenderFeatures(
  venue: LoadedVenue,
  levelId: string,
  visibility?: VisibilitySelection,
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
    if (visibility !== undefined && !isTypeAndBuildingVisible(feature.featureType, feature.buildingId, visibility)) {
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
      if (!levelFeatureVisible(feature.properties, visibility)) {
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
