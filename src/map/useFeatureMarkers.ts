import { useEffect } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { localizedLabel } from "../imdf/localize";
import type { FeatureType, LoadedVenue, LocaleCode, ViewerFeature } from "../imdf/types";

/** Overlay container class hosting all feature markers. */
export const MARKER_OVERLAY_CLASS = "indoor-marker-overlay";

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
 *
 * Markers are absolutely-positioned children of a plain overlay div, placed
 * with an integral 2D translate from `map.project`. MapLibre's own Marker
 * applies a 3D transform (`rotateX/rotateZ`) that promotes each label into a
 * 3D rendering context, whose composited text rasterization is not stable
 * across browser processes; integral 2D positioning is, and it avoids
 * per-frame reflow during camera moves.
 */
export function useFeatureMarkers({
  map,
  venue,
  levelId,
  locale,
  selectedFeatureId,
}: UseFeatureMarkersArgs): void {
  useEffect(() => {
    if (map == null) {
      return;
    }
    let cancelled = false;
    const overlay = document.createElement("div");
    overlay.className = MARKER_OVERLAY_CLASS;
    map.getContainer().appendChild(overlay);

    interface PositionedMarker {
      el: HTMLDivElement;
      lngLat: [number, number];
      width: number;
      height: number;
    }
    const positioned: PositionedMarker[] = [];

    const reposition = (): void => {
      for (const item of positioned) {
        const point = map.project(item.lngLat);
        // Pill bottom-center sits on the feature point, on whole pixels.
        const x = Math.round(point.x - item.width / 2);
        const y = Math.round(point.y - item.height);
        item.el.style.transform = `translate(${x}px, ${y}px)`;
      }
    };

    // Create markers only after fonts settle so measured pill metrics are
    // final. Fonts are local-only, so this resolves immediately after first
    // load. jsdom has no document.fonts.
    const fontsReady: Promise<unknown> =
      typeof document.fonts === "object" ? document.fonts.ready : Promise.resolve();

    void fontsReady.then(() => {
      if (cancelled) {
        return;
      }

      const features = collectMarkerFeatures(venue, levelId, selectedFeatureId);
      const manifestLanguage = venue.manifest.language;
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

        overlay.appendChild(el);

        const rect = el.getBoundingClientRect();
        positioned.push({ el, lngLat: center, width: rect.width, height: rect.height });
      }

      reposition();
    });

    map.on("move", reposition);
    map.on("moveend", reposition);
    map.on("resize", reposition);

    return () => {
      cancelled = true;
      map.off("move", reposition);
      map.off("moveend", reposition);
      map.off("resize", reposition);
      overlay.remove();
    };
  }, [map, venue, levelId, locale, selectedFeatureId]);
}
