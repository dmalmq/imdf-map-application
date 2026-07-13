import { useEffect, useRef } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import { localizedLabel } from "../imdf/localize";
import type { FeatureType, LoadedVenue, LocaleCode, ViewerFeature } from "../imdf/types";

/** Base class for DOM feature markers (styled by App CSS). */
export const MARKER_CLASS = "indoor-marker";
/** Selected variant, combined with MARKER_CLASS. */
export const MARKER_SELECTED_CLASS = "indoor-marker--selected";

const MARKER_FEATURE_TYPES: Record<FeatureType, true | undefined> = {
  amenity: true,
  occupant: true,
  kiosk: true,
  address: undefined,
  anchor: undefined,
  building: undefined,
  detail: undefined,
  fixture: undefined,
  footprint: undefined,
  geofence: undefined,
  level: undefined,
  opening: undefined,
  relationship: undefined,
  section: undefined,
  unit: undefined,
  venue: undefined,
};

const MAX_MARKERS = 200;

export interface UseFeatureMarkersArgs {
  map: MapLibreMap | null;
  venue: LoadedVenue;
  levelId: string;
  locale: LocaleCode;
  selectedFeatureId: string | null;
}

/**
 * Visible-level amenity/occupant/kiosk features with a center, capped at 200,
 * always including the selected feature when it qualifies.
 */
function collectMarkerFeatures(
  venue: LoadedVenue,
  levelId: string,
  selectedFeatureId: string | null,
): ViewerFeature[] {
  const onLevel: ViewerFeature[] = [];
  let selected: ViewerFeature | null = null;

  for (const feature of venue.featuresById.values()) {
    if (MARKER_FEATURE_TYPES[feature.featureType] !== true) {
      continue;
    }
    if (feature.center == null) {
      continue;
    }
    if (feature.id === selectedFeatureId) {
      selected = feature;
    }
    if (feature.levelId === levelId) {
      onLevel.push(feature);
    }
  }

  onLevel.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Always include the selected feature when it has a center and is on this level.
  if (selected != null && selected.levelId === levelId) {
    const withoutSelected = onLevel.filter((f) => f.id !== selected.id);
    const capped = withoutSelected.slice(0, MAX_MARKERS - 1);
    return [selected, ...capped];
  }

  return onLevel.slice(0, MAX_MARKERS);
}

/**
 * DOM label markers for amenity / occupant / kiosk on the visible level.
 * Cap 200; always includes the selected feature when it has a center and is
 * on the current level. Locale changes update marker text without touching
 * the GeoJSON source. Raw anchors are never rendered.
 */
export function useFeatureMarkers({
  map,
  venue,
  levelId,
  locale,
  selectedFeatureId,
}: UseFeatureMarkersArgs): void {
  const markersRef = useRef<Marker[]>([]);

  useEffect(() => {
    if (map == null) {
      return;
    }

    for (const marker of markersRef.current) {
      marker.remove();
    }
    markersRef.current = [];

    const features = collectMarkerFeatures(venue, levelId, selectedFeatureId);
    const manifestLanguage = venue.manifest.language;
    const nextMarkers: Marker[] = [];

    for (const feature of features) {
      const center = feature.center;
      if (center == null) {
        continue;
      }

      const label = localizedLabel(
        feature.labels,
        locale,
        feature.id,
        manifestLanguage,
      );

      const el = document.createElement("div");
      el.className =
        feature.id === selectedFeatureId
          ? `${MARKER_CLASS} ${MARKER_SELECTED_CLASS}`
          : MARKER_CLASS;
      el.textContent = label;
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", label);

      const marker = new maplibregl.Marker({
        element: el,
        anchor: "bottom",
      })
        .setLngLat(center)
        .addTo(map);

      nextMarkers.push(marker);
    }

    markersRef.current = nextMarkers;

    return () => {
      for (const marker of markersRef.current) {
        marker.remove();
      }
      markersRef.current = [];
    };
  }, [map, venue, levelId, locale, selectedFeatureId]);
}
