import { renderFeatureFromViewer } from "../map/buildRenderFeatures";
import { buildSearchEntries } from "../search/buildSearchEntries";
import { geometryCenter } from "./geometryCenter";
import type {
  BoundsTuple,
  FeatureType,
  LoadedVenue,
  ParsedImdfArchive,
  ViewerFeature,
  ViewerLevel,
  ViewerWarning,
} from "./types";

const DISPLAY_POINT_FEATURE_TYPES: Partial<Record<FeatureType, true>> = {
  unit: true,
  opening: true,
  amenity: true,
  kiosk: true,
  occupant: true,
};

function asProperties(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function localizedRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const labels: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry !== "") {
      labels[key] = entry;
    }
  }
  return labels;
}

function normalizeAccessibility(value: unknown): string[] {
  if (typeof value === "string" && value !== "") {
    return [value];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry !== "") {
      out.push(entry);
    }
  }
  return out;
}

function stringProp(props: Record<string, unknown>, key: string): string | null {
  const value = props[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function hasLanguageLabel(labels: Record<string, string>, language: string): boolean {
  const target = language.toLowerCase();
  for (const key of Object.keys(labels)) {
    const lower = key.toLowerCase();
    if (lower === target || lower.startsWith(`${target}-`)) {
      return true;
    }
  }
  return false;
}

function isValidDisplayPoint(value: unknown): value is GeoJSON.Point {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (!("type" in value) || value.type !== "Point") {
    return false;
  }
  if (!("coordinates" in value) || !Array.isArray(value.coordinates)) {
    return false;
  }
  const point: GeoJSON.Point = {
    type: "Point",
    coordinates: value.coordinates as GeoJSON.Position,
  };
  return geometryCenter(point) !== null;
}

function displayPointGeometry(value: unknown): GeoJSON.Point | null {
  if (!isValidDisplayPoint(value)) {
    return null;
  }
  return {
    type: "Point",
    coordinates: value.coordinates,
  };
}

function usableGeometry(geometry: GeoJSON.Geometry | null): GeoJSON.Geometry | null {
  if (geometry === null) {
    return null;
  }
  return geometryCenter(geometry) !== null ? geometry : null;
}

function expandBounds(
  bounds: { west: number; south: number; east: number; north: number; found: boolean },
  geometry: GeoJSON.Geometry | null | undefined,
): void {
  if (geometry == null) {
    return;
  }

  const visitPositions = (value: unknown): void => {
    if (!Array.isArray(value)) {
      return;
    }
    if (typeof value[0] === "number") {
      const lon = value[0];
      const lat = value[1];
      if (typeof lat === "number" && Number.isFinite(lon) && Number.isFinite(lat)) {
        bounds.west = Math.min(bounds.west, lon);
        bounds.south = Math.min(bounds.south, lat);
        bounds.east = Math.max(bounds.east, lon);
        bounds.north = Math.max(bounds.north, lat);
        bounds.found = true;
      }
      return;
    }
    for (const nested of value) {
      visitPositions(nested);
    }
  };

  const visitGeometry = (candidate: GeoJSON.Geometry): void => {
    if (candidate.type === "GeometryCollection") {
      for (const nested of candidate.geometries ?? []) {
        visitGeometry(nested);
      }
      return;
    }
    visitPositions(candidate.coordinates);
  };

  visitGeometry(geometry);
}

function boundsFromFeatures(features: GeoJSON.Feature[]): BoundsTuple | null {
  const bounds = {
    west: Infinity,
    south: Infinity,
    east: -Infinity,
    north: -Infinity,
    found: false,
  };
  for (const feature of features) {
    expandBounds(bounds, feature.geometry);
  }
  if (!bounds.found) {
    return null;
  }
  return [bounds.west, bounds.south, bounds.east, bounds.north];
}

function pushUnresolved(
  warnings: ViewerWarning[],
  featureId: string,
  reference: string,
  targetId: string,
): void {
  warnings.push({
    code: "unresolved_reference",
    message: `Feature ${featureId} references missing ${reference} ${targetId}.`,
    featureId,
  });
}

interface RawFeature {
  feature: ViewerFeature;
  props: Record<string, unknown>;
  ownLevelId: string | null;
  unitId: string | null;
  anchorId: string | null;
  unitIds: string[];
}

/**
 * Convert a parsed IMDF archive into the in-memory viewer model: features,
 * level grouping, centers, search entries, render collections, and warnings.
 */
export function normalizeVenue(archive: ParsedImdfArchive): LoadedVenue {
  const warnings: ViewerWarning[] = [];
  const featuresById = new Map<string, ViewerFeature>();
  const rawById = new Map<string, RawFeature>();

  for (const featureType of Object.keys(archive.collections) as FeatureType[]) {
    const collection = archive.collections[featureType];
    if (collection === undefined) {
      continue;
    }
    for (const feature of collection.features) {
      const id = feature.id;
      if (typeof id !== "string") {
        continue;
      }
      const props = asProperties(feature.properties);
      const geometry = usableGeometry(feature.geometry);
      const labels = localizedRecord(props["name"]);
      const altLabels = localizedRecord(props["alt_name"]);
      const category = stringProp(props, "category");
      const restriction = stringProp(props, "restriction");
      const ownLevelId = stringProp(props, "level_id");
      const unitId = stringProp(props, "unit_id");
      const anchorId = stringProp(props, "anchor_id");
      const unitIds: string[] = [];
      const unitIdsRaw = props["unit_ids"];
      if (Array.isArray(unitIdsRaw)) {
        for (const entry of unitIdsRaw) {
          if (typeof entry === "string" && entry !== "") {
            unitIds.push(entry);
          }
        }
      }

      const viewerFeature: ViewerFeature = {
        id,
        featureType,
        levelId: ownLevelId,
        geometry,
        center: null,
        labels,
        altLabels,
        category,
        accessibility: normalizeAccessibility(props["accessibility"]),
        restriction,
        sourceProperties: props,
      };
      featuresById.set(id, viewerFeature);
      rawById.set(id, {
        feature: viewerFeature,
        props,
        ownLevelId,
        unitId,
        anchorId,
        unitIds,
      });
    }
  }

  for (const raw of rawById.values()) {
    const { feature, props, ownLevelId, unitId, anchorId, unitIds } = raw;

    // levelId: own level_id → unit_id → anchor_id→unit → amenity unit_ids
    let levelId: string | null = ownLevelId;
    if (levelId === null && unitId !== null) {
      const unit = featuresById.get(unitId);
      if (unit === undefined) {
        pushUnresolved(warnings, feature.id, "unit_id", unitId);
      } else {
        levelId = stringProp(unit.sourceProperties, "level_id");
      }
    }
    if (levelId === null && anchorId !== null) {
      const anchor = featuresById.get(anchorId);
      if (anchor === undefined) {
        pushUnresolved(warnings, feature.id, "anchor_id", anchorId);
      } else {
        const anchorUnitId = stringProp(anchor.sourceProperties, "unit_id");
        if (anchorUnitId === null) {
          pushUnresolved(warnings, feature.id, "anchor unit_id", anchorId);
        } else {
          const unit = featuresById.get(anchorUnitId);
          if (unit === undefined) {
            pushUnresolved(warnings, feature.id, "unit_id", anchorUnitId);
          } else {
            levelId = stringProp(unit.sourceProperties, "level_id");
          }
        }
      }
    }
    if (levelId === null && unitIds.length > 0) {
      for (const candidateUnitId of unitIds) {
        const unit = featuresById.get(candidateUnitId);
        if (unit === undefined) {
          pushUnresolved(warnings, feature.id, "unit_ids", candidateUnitId);
          continue;
        }
        const resolved = stringProp(unit.sourceProperties, "level_id");
        if (resolved !== null) {
          levelId = resolved;
          break;
        }
      }
    }
    feature.levelId = levelId;

    // center: display_point → own geometry → anchor geometry → unit geometry
    let center: [number, number] | null = null;
    const displayPoint = displayPointGeometry(props["display_point"]);
    if (displayPoint !== null) {
      center = geometryCenter(displayPoint);
    }
    if (center === null && feature.geometry !== null) {
      center = geometryCenter(feature.geometry);
    }
    if (center === null && anchorId !== null) {
      const anchor = featuresById.get(anchorId);
      if (anchor !== undefined && anchor.geometry !== null) {
        center = geometryCenter(anchor.geometry);
      }
    }
    if (center === null && unitId !== null) {
      const unit = featuresById.get(unitId);
      if (unit !== undefined && unit.geometry !== null) {
        center = geometryCenter(unit.geometry);
      }
    }
    if (center === null && unitIds.length > 0) {
      for (const candidateUnitId of unitIds) {
        const unit = featuresById.get(candidateUnitId);
        if (unit !== undefined && unit.geometry !== null) {
          center = geometryCenter(unit.geometry);
          if (center !== null) {
            break;
          }
        }
      }
    }
    feature.center = center;

    // The viewer serves ja/en; a labeled feature missing either language
    // gets one warning naming the absent language.
    if (Object.keys(feature.labels).length > 0) {
      for (const language of ["en", "ja"] as const) {
        if (!hasLanguageLabel(feature.labels, language)) {
          warnings.push({
            code: "missing_locale",
            message: `Feature ${feature.id} has no ${language === "en" ? "English" : "Japanese"} label.`,
            featureId: feature.id,
          });
        }
      }
    }

    if (feature.featureType === "level" && feature.geometry === null) {
      warnings.push({
        code: "missing_level_geometry",
        message: `Level ${feature.id} has no geometry.`,
        featureId: feature.id,
      });
    }

    if (
      DISPLAY_POINT_FEATURE_TYPES[feature.featureType] === true &&
      displayPointGeometry(props["display_point"]) === null
    ) {
      warnings.push({
        code: "missing_display_point",
        message: `Feature ${feature.id} has no display_point.`,
        featureId: feature.id,
      });
    }
  }

  const venueCollection = archive.collections.venue;
  const venueFeatureId = venueCollection?.features[0]?.id;
  const venue =
    typeof venueFeatureId === "string" ? featuresById.get(venueFeatureId) : undefined;
  if (venue === undefined) {
    throw new Error("normalizeVenue requires exactly one venue feature");
  }

  const sourceLevelsByOrdinal = new Map<number, ViewerFeature[]>();
  for (const feature of featuresById.values()) {
    if (feature.featureType !== "level") {
      continue;
    }
    const ordinalRaw = feature.sourceProperties["ordinal"];
    const ordinal =
      typeof ordinalRaw === "number" && Number.isFinite(ordinalRaw) ? ordinalRaw : 0;
    const grouped = sourceLevelsByOrdinal.get(ordinal);
    if (grouped === undefined) {
      sourceLevelsByOrdinal.set(ordinal, [feature]);
    } else {
      grouped.push(feature);
    }
  }

  const mergeLocalized = (
    sourceLevels: ViewerFeature[],
    select: (feature: ViewerFeature) => Record<string, string>,
  ): Record<string, string> => {
    const merged: Record<string, string> = {};
    for (const sourceLevel of sourceLevels) {
      for (const [locale, value] of Object.entries(select(sourceLevel))) {
        merged[locale] ??= value;
      }
    }
    return merged;
  };

  const sourceLevelToGroup = new Map<string, string>();
  const levels: ViewerLevel[] = [];
  for (const [ordinal, sourceLevels] of sourceLevelsByOrdinal) {
    sourceLevels.sort((a, b) => a.id.localeCompare(b.id));
    const id = `ordinal:${ordinal}`;
    const sourceLevelIds = sourceLevels.map((feature) => feature.id);
    const shortName = mergeLocalized(sourceLevels, (feature) =>
      localizedRecord(feature.sourceProperties["short_name"]),
    );
    const sourceLabels = mergeLocalized(sourceLevels, (feature) => feature.labels);
    const label =
      sourceLevels.length > 1 && Object.keys(shortName).length > 0 ? shortName : sourceLabels;
    levels.push({ id, sourceLevelIds, ordinal, label, shortName });
    for (const sourceLevel of sourceLevels) {
      sourceLevelToGroup.set(sourceLevel.id, id);
      sourceLevel.levelId = id;
    }
  }
  levels.sort((a, b) => b.ordinal - a.ordinal);

  // Viewer-facing relationships use the ordinal group. Original level_id
  // values remain untouched in sourceProperties for diagnostics/details.
  for (const feature of featuresById.values()) {
    if (feature.featureType === "level" || feature.levelId === null) {
      continue;
    }
    feature.levelId = sourceLevelToGroup.get(feature.levelId) ?? feature.levelId;
  }

  const renderFeaturesByLevel = new Map<string, GeoJSON.FeatureCollection>();
  const boundsByLevel = new Map<string, BoundsTuple>();

  for (const level of levels) {
    const rendered: GeoJSON.Feature[] = [];
    for (const feature of featuresById.values()) {
      if (feature.featureType === "anchor" || feature.levelId !== level.id) {
        continue;
      }

      let renderFeature: GeoJSON.Feature | null;
      if (
        feature.featureType === "occupant" &&
        feature.geometry === null &&
        feature.center !== null
      ) {
        renderFeature = renderFeatureFromViewer(feature, {
          type: "Point",
          coordinates: feature.center,
        });
      } else {
        renderFeature = renderFeatureFromViewer(feature);
      }
      if (renderFeature !== null) {
        rendered.push(renderFeature);
      }
    }

    renderFeaturesByLevel.set(level.id, {
      type: "FeatureCollection",
      features: rendered,
    });

    const bounds = boundsFromFeatures(rendered);
    if (bounds !== null) {
      boundsByLevel.set(level.id, bounds);
    }
  }

  const enrichmentByFeatureId = new Map(Object.entries(archive.enrichment ?? {}));

  return {
    manifest: archive.manifest,
    venue,
    levels,
    featuresById,
    renderFeaturesByLevel,
    searchEntries: buildSearchEntries(featuresById.values()),
    boundsByLevel,
    enrichmentByFeatureId,
    warnings,
  };
}
