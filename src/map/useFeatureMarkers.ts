import { useEffect } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { localizedLabel } from "../imdf/localize";
import type { FeatureType, LoadedVenue, LocaleCode, ViewerFeature } from "../imdf/types";
import { isRestroomCategory, markerIconFor } from "./markerIcons";

export { markerIconFor };

/** Overlay container class hosting all feature markers. */
export const MARKER_OVERLAY_CLASS = "indoor-marker-overlay";

/** Base class for DOM feature markers (styled by App CSS). */
export const MARKER_CLASS = "indoor-marker";
/** Circular icon-bubble variant, combined with MARKER_CLASS. */
export const MARKER_BUBBLE_CLASS = "indoor-marker--bubble";
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

const ROOM_CATEGORY = "room";

/** Accessible-name fallback for unnamed bubble units, per locale. */
const CATEGORY_LABELS: Record<string, Record<LocaleCode, string>> = {
  elevator: { ja: "エレベーター", en: "Elevator" },
  escalator: { ja: "エスカレーター", en: "Escalator" },
  stairs: { ja: "階段", en: "Stairs" },
  steps: { ja: "階段", en: "Stairs" },
  information: { ja: "案内所", en: "Information" },
  atm: { ja: "ATM", en: "ATM" },
  vendingmachine: { ja: "自動販売機", en: "Vending machine" },
};

/** Locale fallback name for an unnamed bubble unit. */
function categoryLabelFor(category: string, locale: LocaleCode): string | undefined {
  const fixed = CATEGORY_LABELS[category]?.[locale];
  if (fixed !== undefined) {
    return fixed;
  }
  if (!isRestroomCategory(category)) {
    return undefined;
  }
  if (category.includes("wheelchair")) {
    return locale === "ja" ? "多目的トイレ" : "Accessible Restroom";
  }
  if (category.includes("female")) {
    return locale === "ja" ? "女子トイレ" : "Women's Restroom";
  }
  if (category.includes("male")) {
    return locale === "ja" ? "男子トイレ" : "Men's Restroom";
  }
  return locale === "ja" ? "トイレ" : "Restroom";
}

const MAX_MARKERS = 200;

export interface UseFeatureMarkersArgs {
  map: MapLibreMap | null;
  venue: LoadedVenue;
  levelId: string;
  locale: LocaleCode;
  selectedFeatureId: string | null;
  /** Labels layer-group toggle; false renders no markers. */
  enabled: boolean;
  /** Stable callback; marker click selects the feature (or places an issue). */
  onSelect: (featureId: string, center: [number, number]) => void;
}

function hasOwnName(feature: ViewerFeature): boolean {
  return Object.keys(feature.labels).length > 0;
}

/** True for unit features that get a marker: bubble categories and named rooms. */
function isMarkerUnit(feature: ViewerFeature): boolean {
  if (feature.featureType !== "unit" || feature.category == null) {
    return false;
  }
  if (markerIconFor(feature.category) !== undefined) {
    return true;
  }
  return feature.category === ROOM_CATEGORY && hasOwnName(feature);
}

/**
 * Visible-level marker features, capped at MAX_MARKERS with priority:
 * selected feature first, then icon bubbles (conveyance/restroom units and
 * standalone icon amenities), then occupant/kiosk/plain-amenity pills, then
 * room pills; each group id-sorted for determinism. Rooms are last because
 * they are the most numerous and least critical, so a crowded level never
 * silently drops an elevator bubble. An amenity that duplicates an on-level
 * bubble unit through `unit_ids` (Apple exports pair e.g. every escalator
 * unit with an escalator amenity) is dropped; unlinked ones keep their own
 * bubble.
 */
export function collectMarkerFeatures(
  venue: LoadedVenue,
  levelId: string,
  selectedFeatureId: string | null,
): ViewerFeature[] {
  const unitBubbles: ViewerFeature[] = [];
  const amenityBubbles: ViewerFeature[] = [];
  const pills: ViewerFeature[] = [];
  const rooms: ViewerFeature[] = [];
  const bubbleUnitIds = new Set<string>();
  let selected: ViewerFeature | null = null;

  for (const feature of venue.featuresById.values()) {
    const markerUnit = isMarkerUnit(feature);
    if (MARKER_FEATURE_TYPES[feature.featureType] !== true && !markerUnit) {
      continue;
    }
    if (feature.center == null) {
      continue;
    }
    if (feature.id === selectedFeatureId) {
      selected = feature;
    }
    if (feature.levelId !== levelId) {
      continue;
    }
    if (markerUnit) {
      if (feature.category === ROOM_CATEGORY) {
        rooms.push(feature);
      } else {
        unitBubbles.push(feature);
        bubbleUnitIds.add(feature.id);
      }
    } else if (
      feature.featureType === "amenity" &&
      feature.category != null &&
      markerIconFor(feature.category) !== undefined
    ) {
      amenityBubbles.push(feature);
    } else {
      pills.push(feature);
    }
  }

  const unlinkedAmenityBubbles = amenityBubbles.filter((feature) => {
    const unitIds = feature.sourceProperties["unit_ids"];
    return !(
      Array.isArray(unitIds) &&
      unitIds.some((id) => typeof id === "string" && bubbleUnitIds.has(id))
    );
  });

  const byId = (a: ViewerFeature, b: ViewerFeature): number =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const bubbles = [...unitBubbles, ...unlinkedAmenityBubbles].sort(byId);
  pills.sort(byId);
  rooms.sort(byId);

  const ordered = [...bubbles, ...pills, ...rooms];

  // Always include the selected feature when it has a center and is on this level.
  if (selected != null && selected.levelId === levelId) {
    const withoutSelected = ordered.filter((f) => f.id !== selected.id);
    return [selected, ...withoutSelected.slice(0, MAX_MARKERS - 1)];
  }

  return ordered.slice(0, MAX_MARKERS);
}

/**
 * DOM feature markers on the visible level: text pills for amenity /
 * occupant / kiosk and named rooms, circular icon bubbles for elevator /
 * escalator / stairs / steps units. Every marker is a button that selects
 * its feature, mirroring a click on the geometry. Cap 200 with conveyances
 * prioritized; always includes the selected feature when it has a center
 * and is on the current level. Locale changes update marker text without
 * touching the GeoJSON source. Raw anchors are never rendered.
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
  enabled,
  onSelect,
}: UseFeatureMarkersArgs): void {
  useEffect(() => {
    if (map == null || !enabled) {
      return;
    }
    let cancelled = false;
    const overlay = document.createElement("div");
    overlay.className = MARKER_OVERLAY_CLASS;
    map.getContainer().appendChild(overlay);

    interface PositionedMarker {
      el: HTMLButtonElement;
      lngLat: [number, number];
      width: number;
      height: number;
      /** Text pills sit on the point; icon bubbles center on it. */
      anchorBottom: boolean;
    }
    const positioned: PositionedMarker[] = [];

    const reposition = (): void => {
      for (const item of positioned) {
        const point = map.project(item.lngLat);
        // Whole pixels keep composited text rasterization stable.
        const x = Math.round(point.x - item.width / 2);
        const y = Math.round(
          point.y - (item.anchorBottom ? item.height : item.height / 2),
        );
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

        const icon =
          (feature.featureType === "unit" || feature.featureType === "amenity") &&
          feature.category != null
            ? markerIconFor(feature.category)
            : undefined;

        // Real archives routinely ship unnamed conveyance/restroom units;
        // announce the category instead of a raw feature UUID.
        const categoryFallback =
          icon !== undefined && Object.keys(feature.labels).length === 0
            ? categoryLabelFor(feature.category!, locale)
            : undefined;
        const label =
          categoryFallback ??
          localizedLabel(feature.labels, locale, feature.id, manifestLanguage);

        const el = document.createElement("button");
        el.type = "button";
        const classes = [MARKER_CLASS];
        if (icon !== undefined) {
          classes.push(MARKER_BUBBLE_CLASS);
        }
        if (feature.id === selectedFeatureId) {
          classes.push(MARKER_SELECTED_CLASS);
        }
        el.className = classes.join(" ");
        if (icon !== undefined) {
          el.innerHTML = icon;
          // Icon-only bubble: expose the name as a hover tooltip too.
          el.title = label;
        } else {
          el.textContent = label;
        }
        el.setAttribute("aria-label", label);
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          onSelect(feature.id, center);
        });

        overlay.appendChild(el);

        const rect = el.getBoundingClientRect();
        positioned.push({
          el,
          lngLat: center,
          width: rect.width,
          height: rect.height,
          anchorBottom: icon === undefined,
        });
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
  }, [map, venue, levelId, locale, selectedFeatureId, enabled, onSelect]);
}
