import { useEffect } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { localizedLabel } from "../imdf/localize";
import type { FeatureType, LoadedVenue, LocaleCode, ViewerFeature } from "../imdf/types";
import { isUnitMarkerEligible } from "../search/searchCategories";

/** Overlay container class hosting all feature markers. */
export const MARKER_OVERLAY_CLASS = "indoor-marker-overlay";

/** Base class for DOM feature markers (styled by App CSS). */
export const MARKER_CLASS = "indoor-marker";
/** Circular icon-bubble variant, combined with MARKER_CLASS. */
export const MARKER_BUBBLE_CLASS = "indoor-marker--bubble";
/** Selected variant, combined with MARKER_CLASS. */
export const MARKER_SELECTED_CLASS = "indoor-marker--selected";
const MARKER_OVERLAY_EXPANDED_CLASS = "indoor-marker-overlay--expanded";
const COMPACT_MARKER_SIZE = 10;

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

const SVG_OPEN =
  '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

/**
 * Icon bubbles for conveyance units, keyed by IMDF unit category.
 * `steps` shares the stairs icon. 14x14 viewBox, stroked in currentColor.
 */
const TRANSIT_ICONS: Record<string, string> = {
  elevator: `${SVG_OPEN}<rect x="2" y="1.5" width="10" height="11" rx="1"/><path d="M7 1.5v11"/><path d="M4.5 6.8 5.5 5.6l1 1.2"/><path d="M8.5 7.2l1 1.2 1-1.2"/></svg>`,
  escalator: `${SVG_OPEN}<path d="M1.5 11.5h2.4l6-7h2.6"/><path d="M1.5 9v2.5"/><circle cx="4.6" cy="6.1" r="0.9"/><path d="M4.6 7.2v2"/></svg>`,
  stairs: `${SVG_OPEN}<path d="M1.5 12.5h3v-3h3v-3h3v-3h2"/></svg>`,
};
TRANSIT_ICONS["steps"] = TRANSIT_ICONS["stairs"]!;

/** Restroom pictograms: standing figure, dress figure, wheelchair user. */
const ICON_RESTROOM_MALE = `${SVG_OPEN}<circle cx="7" cy="2.6" r="1.4"/><path d="M7 4.7v4"/><path d="M4.8 5.6h4.4"/><path d="M7 8.7l-1.6 3.8"/><path d="M7 8.7l1.6 3.8"/></svg>`;
const ICON_RESTROOM_FEMALE = `${SVG_OPEN}<circle cx="7" cy="2.6" r="1.4"/><path d="M7 4.7 5 9.5h4L7 4.7z"/><path d="M6 9.5v3"/><path d="M8 9.5v3"/></svg>`;
const ICON_RESTROOM_WHEELCHAIR = `${SVG_OPEN}<circle cx="6.2" cy="2.4" r="1.3"/><path d="M6.2 4.2v3.4h3.2l1.4 3.4"/><circle cx="5.8" cy="10" r="2.6"/></svg>`;
/** Generic restroom (family / unisex / transgender / plain): both figures. */
const ICON_RESTROOM = `${SVG_OPEN}<circle cx="4" cy="2.5" r="1.1"/><path d="M4 4.1v3.2"/><path d="M2.6 4.8h2.8"/><path d="M4 7.3l-1.1 3"/><path d="M4 7.3l1.1 3"/><circle cx="10" cy="2.5" r="1.1"/><path d="M10 4.1 8.6 7.6h2.8L10 4.1z"/><path d="M9.3 7.6v2.7"/><path d="M10.7 7.6v2.7"/></svg>`;

const RESTROOM_PREFIX = "restroom";

/** Restroom-family category: unit `restroom*` or amenity `toilet*`. */
function isRestroomCategory(category: string): boolean {
  return category.startsWith(RESTROOM_PREFIX) || category.startsWith("toilet");
}

/** Icon for a unit/amenity category, or undefined when it gets no bubble. */
export function markerIconFor(category: string): string | undefined {
  const transit = TRANSIT_ICONS[category];
  if (transit !== undefined) {
    return transit;
  }
  if (!isRestroomCategory(category)) {
    return undefined;
  }
  if (category.includes("wheelchair")) {
    return ICON_RESTROOM_WHEELCHAIR;
  }
  // Check "female" before "male" — "female".includes("male") is true.
  if (category.includes("female")) {
    return ICON_RESTROOM_FEMALE;
  }
  if (category.includes("male")) {
    return ICON_RESTROOM_MALE;
  }
  return ICON_RESTROOM;
}


/** Accessible-name fallback for unnamed bubble units, per locale. */
const CATEGORY_LABELS: Record<string, Record<LocaleCode, string>> = {
  elevator: { ja: "エレベーター", en: "Elevator" },
  escalator: { ja: "エスカレーター", en: "Escalator" },
  stairs: { ja: "階段", en: "Stairs" },
  steps: { ja: "階段", en: "Stairs" },
  room: { ja: "部屋", en: "Room" },
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

/** Name when present; localized category instead of a UUID when unnamed. */
export function markerLabelFor(
  feature: ViewerFeature,
  locale: LocaleCode,
  manifestLanguage: string,
): string {
  if (
    Object.keys(feature.labels).length === 0 &&
    (feature.featureType === "unit" || feature.featureType === "amenity") &&
    feature.category !== null
  ) {
    return categoryLabelFor(feature.category, locale) ?? feature.category;
  }
  return localizedLabel(feature.labels, locale, feature.id, manifestLanguage);
}

/** Text markers expand at close zoom; icon bubbles stay at their fixed size. */
export function showFullMarkerLabelsAtZoom(zoom: number): boolean {
  return zoom >= 17;
}

export function markerTransformAtPoint(
  point: { x: number; y: number },
  width: number,
  height: number,
  textMarker: boolean,
  compact: boolean,
): string {
  const renderedWidth = compact ? COMPACT_MARKER_SIZE : width;
  const renderedHeight = compact ? COMPACT_MARKER_SIZE : height;
  const anchorBottom = textMarker && !compact;
  const x = Math.round(point.x - renderedWidth / 2);
  const y = Math.round(point.y - (anchorBottom ? renderedHeight : renderedHeight / 2));
  return `translate(${x}px, ${y}px)`;
}

const MAX_MARKERS = 200;

export interface UseFeatureMarkersArgs {
  map: MapLibreMap | null;
  venue: LoadedVenue;
  levelId: string;
  locale: LocaleCode;
  selectedFeatureId: string | null;
  /** Stable callback; marker click selects the feature. */
  onSelect: (featureId: string) => void;
}

/**
 * Visible-level marker features, capped at MAX_MARKERS with priority:
 * selected feature first, then icon bubbles (conveyance/restroom units and
 * standalone icon amenities), occupant/kiosk/plain-amenity pills, named unit
 * pills, then unnamed category fallback pills. Named units come first because
 * their labels carry more location-specific information when markers expand.
 * An amenity that duplicates an on-level bubble unit through `unit_ids` (Apple
 * exports pair e.g. every escalator unit with an escalator amenity) is dropped;
 * unlinked ones keep their own bubble.
 */
export function collectMarkerFeatures(
  venue: LoadedVenue,
  levelId: string,
  selectedFeatureId: string | null,
): ViewerFeature[] {
  const unitBubbles: ViewerFeature[] = [];
  const amenityBubbles: ViewerFeature[] = [];
  const pills: ViewerFeature[] = [];
  const namedUnits: ViewerFeature[] = [];
  const unnamedUnits: ViewerFeature[] = [];
  const bubbleUnitIds = new Set<string>();
  let selected: ViewerFeature | null = null;

  for (const feature of venue.featuresById.values()) {
    const markerUnit = isUnitMarkerEligible(feature);
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
      if (markerIconFor(feature.category!) === undefined) {
        (Object.keys(feature.labels).length > 0 ? namedUnits : unnamedUnits).push(feature);
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
  namedUnits.sort(byId);
  unnamedUnits.sort(byId);

  const ordered = [...bubbles, ...pills, ...namedUnits, ...unnamedUnits];

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
  onSelect,
}: UseFeatureMarkersArgs): void {
  useEffect(() => {
    if (map == null) {
      return;
    }
    let cancelled = false;
    const overlay = document.createElement("div");
    // Start expanded so every text pill is measured at its full dimensions.
    overlay.className = `${MARKER_OVERLAY_CLASS} ${MARKER_OVERLAY_EXPANDED_CLASS}`;
    map.getCanvasContainer().appendChild(overlay);

    interface PositionedMarker {
      el: HTMLButtonElement;
      lngLat: [number, number];
      width: number;
      height: number;
      textMarker: boolean;
      selected: boolean;
    }
    const positioned: PositionedMarker[] = [];

    const reposition = (): void => {
      const expanded = showFullMarkerLabelsAtZoom(map.getZoom());
      overlay.classList.toggle(MARKER_OVERLAY_EXPANDED_CLASS, expanded);
      for (const item of positioned) {
        const compact = item.textMarker && !item.selected && !expanded;
        item.el.style.transform = markerTransformAtPoint(
          map.project(item.lngLat),
          item.width,
          item.height,
          item.textMarker,
          compact,
        );
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

        const label = markerLabelFor(feature, locale, manifestLanguage);

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
        } else {
          el.textContent = label;
        }
        // Compact dots and icon-only bubbles retain a discoverable tooltip.
        el.title = label;
        el.setAttribute("aria-label", label);
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          onSelect(feature.id);
        });

        overlay.appendChild(el);

        const rect = el.getBoundingClientRect();
        positioned.push({
          el,
          lngLat: center,
          width: rect.width,
          height: rect.height,
          textMarker: icon === undefined,
          selected: feature.id === selectedFeatureId,
        });
      }

      reposition();
      map.on("move", reposition);
      map.on("moveend", reposition);
      map.on("resize", reposition);
    });


    return () => {
      cancelled = true;
      map.off("move", reposition);
      map.off("moveend", reposition);
      map.off("resize", reposition);
      overlay.remove();
    };
  }, [map, venue, levelId, locale, selectedFeatureId, onSelect]);
}
