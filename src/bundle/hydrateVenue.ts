import { VenueLoadError } from "../errors/VenueLoadError";
import { renderFeatureFromViewer } from "../map/buildRenderFeatures";
import { buildSearchEntries } from "../search/buildSearchEntries";
import type {
  BoundsTuple,
  FeatureType,
  ImdfManifest,
  LoadedVenue,
  ViewerFeature,
  ViewerLevel,
  ViewerWarning,
  ViewerWarningCode,
} from "../imdf/types";
import type { DecodedVenueDto } from "./wasm";

const KNOWN_FEATURE_TYPES: Record<string, true> = {
  address: true,
  amenity: true,
  anchor: true,
  building: true,
  detail: true,
  fixture: true,
  footprint: true,
  geofence: true,
  kiosk: true,
  level: true,
  occupant: true,
  opening: true,
  relationship: true,
  section: true,
  unit: true,
  venue: true,
};

function isFeatureType(value: string): value is FeatureType {
  return KNOWN_FEATURE_TYPES[value] === true;
}

function invalidBundle(message: string, details?: Record<string, unknown>): VenueLoadError {
  return new VenueLoadError("invalid_bundle", message, details, "bundle");
}

function toViewerFeature(dto: DecodedVenueDto["features"][number]): ViewerFeature {
  if (!isFeatureType(dto.featureType)) {
    throw invalidBundle(`Decoded bundle contains an unrecognized feature type.`, {
      featureId: dto.id,
      featureType: dto.featureType,
    });
  }
  return {
    id: dto.id,
    featureType: dto.featureType,
    levelId: dto.levelId,
    geometry: dto.geometry,
    center: dto.center,
    labels: dto.labels,
    altLabels: dto.altLabels,
    category: dto.category,
    accessibility: dto.accessibility,
    restriction: dto.restriction,
    sourceProperties: dto.sourceProperties,
  };
}

/**
 * Hydrates a decoded `kvb1` DTO into the exact `LoadedVenue` shape produced
 * by the direct-ZIP path (`normalizeVenue`): rebuilds `Map` indexes,
 * per-level render collections (via `renderFeatureFromViewer`), and the
 * search index (via `buildSearchEntries`) rather than trusting any of those
 * as serialized bundle data. Structural/reference validity (venue lookup,
 * level references) is checked before any map is constructed.
 */
export function hydrateVenue(dto: DecodedVenueDto): LoadedVenue {
  const featuresById = new Map<string, ViewerFeature>();
  const levelFeatureIds = new Set<string>();
  let venueFeatureCount = 0;
  for (const featureDto of dto.features) {
    const feature = toViewerFeature(featureDto);
    if (featuresById.has(feature.id)) {
      throw invalidBundle("Decoded bundle contains a duplicate feature ID.", {
        featureId: feature.id,
      });
    }
    featuresById.set(feature.id, feature);
    if (feature.featureType === "venue") {
      venueFeatureCount += 1;
    }
    if (feature.featureType === "level") {
      levelFeatureIds.add(feature.id);
    }
  }

  if (venueFeatureCount !== 1) {
    throw invalidBundle("Decoded bundle must contain exactly one venue feature.", {
      count: venueFeatureCount,
    });
  }
  const venue = featuresById.get(dto.venueId);
  if (venue === undefined || venue.featureType !== "venue") {
    throw invalidBundle("Decoded bundle venueId does not name the venue feature.", {
      venueId: dto.venueId,
    });
  }

  const levelIds = new Set<string>();
  const levels: ViewerLevel[] = [];
  for (const level of dto.levels) {
    if (levelIds.has(level.id)) {
      throw invalidBundle("Decoded bundle contains a duplicate level ID.", {
        levelId: level.id,
      });
    }
    if (!levelFeatureIds.has(level.id)) {
      throw invalidBundle("Decoded bundle level does not resolve to a level feature.", {
        levelId: level.id,
      });
    }
    levelIds.add(level.id);
    levels.push({ id: level.id, ordinal: level.ordinal, label: level.label, shortName: level.shortName });
  }
  for (const levelFeatureId of levelFeatureIds) {
    if (!levelIds.has(levelFeatureId)) {
      throw invalidBundle("Decoded bundle level feature is missing from the levels list.", {
        featureId: levelFeatureId,
      });
    }
  }

  for (const feature of featuresById.values()) {
    if (feature.levelId !== null && !levelIds.has(feature.levelId)) {
      throw invalidBundle("Decoded bundle feature references an unknown level.", {
        featureId: feature.id,
        levelId: feature.levelId,
      });
    }
  }

  const renderFeaturesByLevel = new Map<string, GeoJSON.FeatureCollection>();
  for (const level of levels) {
    const rendered: GeoJSON.Feature[] = [];
    for (const feature of featuresById.values()) {
      if (feature.featureType === "anchor") {
        continue;
      }
      if (feature.id !== level.id && feature.levelId !== level.id) {
        continue;
      }

      const renderFeature =
        feature.featureType === "occupant" && feature.geometry === null && feature.center !== null
          ? renderFeatureFromViewer(feature, { type: "Point", coordinates: feature.center })
          : renderFeatureFromViewer(feature);
      if (renderFeature !== null) {
        rendered.push(renderFeature);
      }
    }
    renderFeaturesByLevel.set(level.id, { type: "FeatureCollection", features: rendered });
  }

  const boundsByLevel = new Map<string, BoundsTuple>();
  for (const [levelId, bounds] of dto.boundsByLevel) {
    if (!levelIds.has(levelId)) {
      throw invalidBundle("Decoded bundle bounds reference an unknown level.", { levelId });
    }
    boundsByLevel.set(levelId, bounds);
  }

  const warnings: ViewerWarning[] = dto.warnings.map((warning) => ({
    code: warning.code as ViewerWarningCode,
    message: warning.message,
    ...(warning.featureId !== null ? { featureId: warning.featureId } : {}),
    ...(warning.archiveEntry !== null ? { archiveEntry: warning.archiveEntry } : {}),
  }));

  const manifest: ImdfManifest = {
    ...dto.manifest.rest,
    version: "1.0.0",
    language: dto.manifest.language,
  };

  return {
    manifest,
    venue,
    levels,
    featuresById,
    renderFeaturesByLevel,
    searchEntries: buildSearchEntries(featuresById.values()),
    boundsByLevel,
    warnings,
  };
}
