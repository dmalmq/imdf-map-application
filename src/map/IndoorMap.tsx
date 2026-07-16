import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LocaleCode, LoadedVenue } from "../imdf/types";
import type { SearchCategory } from "../search/searchCategories";
import type { ViewerTheme } from "../theme/types";
import { buildIndoorStyle, INDOOR_SOURCE_ID } from "./buildIndoorStyle";
import { buildRenderFeatures } from "./buildRenderFeatures";
import {
  applyThemePaintProperties,
  CLICKABLE_LAYER_IDS,
} from "./featureLayers";
import { registerGdbMarkerIcons } from "./gdbMarkerIcons";
import { useFeatureMarkers } from "./useFeatureMarkers";
import { useSelectedFeaturePopup } from "./useSelectedFeaturePopup";

export interface IndoorMapProps {
  venue: LoadedVenue;
  levelId: string;
  selectedFeatureId: string | null;
  locale: LocaleCode;
  theme: ViewerTheme;
  searchCategory: SearchCategory;
  compact: boolean;
  bottomPadding: number;
  /** null = background click */
  onSelectFeature: (featureId: string | null) => void;
  /** When set, the next map click reports its lngLat instead of selecting features. */
  onMapClick?: ((lngLat: [number, number]) => void) | undefined;
  /** Imperative camera target; applied when token changes. */
  flyTo?: { lngLat: [number, number]; token: number } | null | undefined;
}

const FIT_PADDING = 48;
const FIT_MAX_ZOOM = 20;
const EASE_DURATION_MS = 450;
const FIT_DURATION_MS = 500;

interface ViewportSize {
  width: number;
  height: number;
}

interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function revealOffset(
  point: { x: number; y: number },
  viewport: ViewportSize,
  padding: MapPadding,
  margin: number,
): [number, number] | null {
  const left = padding.left + margin;
  const right = viewport.width - padding.right - margin;
  const top = padding.top + margin;
  const bottom = viewport.height - padding.bottom - margin;
  const dx = point.x < left ? point.x - left : point.x > right ? point.x - right : 0;
  const dy = point.y < top ? point.y - top : point.y > bottom ? point.y - bottom : 0;
  return dx === 0 && dy === 0 ? null : [dx, dy];
}

export function selectionRevealOffset(
  compact: boolean,
  point: { x: number; y: number },
  viewport: ViewportSize,
  padding: MapPadding,
  margin: number,
): [number, number] | null {
  return compact ? null : revealOffset(point, viewport, padding, margin);
}

function revealSelection(
  map: MapLibreMap,
  center: [number, number],
  compact: boolean,
): void {
  const canvas = map.getCanvas();
  const padding = map.getPadding();
  const offset = selectionRevealOffset(
    compact,
    map.project(center),
    { width: canvas.clientWidth, height: canvas.clientHeight },
    {
      top: padding.top ?? 0,
      right: padding.right ?? 0,
      bottom: padding.bottom ?? 0,
      left: padding.left ?? 0,
    },
    16,
  );
  if (offset !== null) {
    map.panBy(offset, { duration: prefersReducedMotion() ? 0 : EASE_DURATION_MS });
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readFeatureId(
  properties: GeoJSON.GeoJsonProperties | null | undefined,
): string | null {
  if (properties == null) {
    return null;
  }
  const raw = properties["__feature_id"];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function getIndoorSource(map: MapLibreMap): GeoJSONSource | null {
  const source = map.getSource(INDOOR_SOURCE_ID);
  if (source == null || source.type !== "geojson") {
    return null;
  }
  return source as GeoJSONSource;
}

function fitLevelBounds(
  map: MapLibreMap,
  venue: LoadedVenue,
  levelId: string,
): void {
  const bounds = venue.boundsByLevel.get(levelId);
  if (bounds == null) {
    return;
  }
  const [west, south, east, north] = bounds;
  if (
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north)
  ) {
    return;
  }
  const reduced = prefersReducedMotion();
  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    {
      padding: FIT_PADDING,
      maxZoom: FIT_MAX_ZOOM,
      duration: reduced ? 0 : FIT_DURATION_MS,
    },
  );
}

function setSourceData(
  map: MapLibreMap,
  venue: LoadedVenue,
  levelId: string,
): void {
  const source = getIndoorSource(map);
  if (source == null) {
    return;
  }
  source.setData(buildRenderFeatures(venue, levelId));
}

function clearFeatureState(
  map: MapLibreMap,
  featureId: string | null,
  key: "hover" | "selected",
): void {
  if (featureId == null) {
    return;
  }
  try {
    map.removeFeatureState({ source: INDOOR_SOURCE_ID, id: featureId }, key);
  } catch {
    // Source may not be ready yet; ignore.
  }
}

function applyFeatureState(
  map: MapLibreMap,
  featureId: string,
  state: { hover?: boolean; selected?: boolean },
): void {
  try {
    map.setFeatureState({ source: INDOOR_SOURCE_ID, id: featureId }, state);
  } catch {
    // Source may not be ready yet; ignore.
  }
}

/**
 * Wait until the indoor GeoJSON source has finished loading after setData,
 * then run `fn`. Falls back to map idle if sourcedata never reports loaded.
 */
function whenSourceReady(map: MapLibreMap, fn: () => void): () => void {
  let settled = false;
  const run = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    map.off("sourcedata", onSourceData);
    map.off("idle", onIdle);
    fn();
  };

  const onSourceData = (event: {
    sourceId?: string;
    isSourceLoaded?: boolean;
    dataType?: string;
  }): void => {
    if (
      event.sourceId === INDOOR_SOURCE_ID &&
      event.isSourceLoaded === true &&
      (event.dataType === "source" || event.dataType === undefined)
    ) {
      run();
    }
  };

  const onIdle = (): void => {
    run();
  };

  map.on("sourcedata", onSourceData);
  map.once("idle", onIdle);

  // If the source is already loaded (sync setData path), fire on next frame.
  if (map.isSourceLoaded(INDOOR_SOURCE_ID)) {
    queueMicrotask(run);
  }

  return () => {
    settled = true;
    map.off("sourcedata", onSourceData);
    map.off("idle", onIdle);
  };
}

/**
 * Register marker icons, then commit the first source data — but only if the
 * signal has not aborted (i.e. the map has not been removed). Guarantees icons
 * exist before the symbol layer's first data and blocks any post-teardown map
 * mutation from a late-resolving registration.
 */
export async function registerIconsThenLoad(
  map: MapLibreMap,
  register: (map: MapLibreMap, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
  commit: (map: MapLibreMap) => void,
): Promise<void> {
  await register(map, signal);
  if (signal.aborted) {
    return;
  }
  commit(map);
}

/** True when any level's render features carry a `__marker_icon` (GDB POI icon). */
export function venueNeedsMarkerIcons(venue: LoadedVenue): boolean {
  for (const collection of venue.renderFeaturesByLevel.values()) {
    for (const feature of collection.features) {
      if (feature.properties?.["__marker_icon"] != null) {
        return true;
      }
    }
  }
  return false;
}

export function IndoorMap({
  venue,
  levelId,
  selectedFeatureId,
  locale,
  theme,
  searchCategory,
  compact,
  bottomPadding,
  onSelectFeature,
  onMapClick,
  flyTo,
}: IndoorMapProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRef = useRef(onSelectFeature);
  const onMapClickRef = useRef(onMapClick);
  const lastFlyTokenRef = useRef(0);
  const venueRef = useRef(venue);
  const levelIdRef = useRef(levelId);
  const selectedIdRef = useRef(selectedFeatureId);
  const hoverIdRef = useRef<string | null>(null);
  const appliedSelectedRef = useRef<string | null>(null);
  const themeIdRef = useRef(theme.id);
  const cancelReadyRef = useRef<(() => void) | null>(null);
  // Marker-icon registration is lazy (only when a venue actually has GDB POI
  // icons) and happens at most once per map. `pendingRegistrationRef` gates the
  // venue/level and selection effects while a registration commit is in flight;
  // the token guards against a superseded commit or a removed map.
  const iconAbortRef = useRef<AbortController | null>(null);
  const iconsRegisteredRef = useRef(false);
  const pendingRegistrationRef = useRef(false);
  const registrationTokenRef = useRef(0);
  const previousBottomPaddingRef = useRef(0);
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);

  onSelectRef.current = onSelectFeature;
  onMapClickRef.current = onMapClick;
  venueRef.current = venue;
  levelIdRef.current = levelId;
  selectedIdRef.current = selectedFeatureId;

  const onMarkerSelect = useCallback((featureId: string) => {
    onSelectRef.current(featureId);
  }, []);

  const onPopupClose = useCallback(() => {
    onSelectRef.current(null);
  }, []);

  // Commit source data now when the venue needs no GDB icons or they are already
  // registered; otherwise register once (async) then commit the LATEST refs a
  // single time, guarded against a superseded commit or a removed/torn-down map.
  const ensureIconsThenCommit = useCallback(
    (map: MapLibreMap, commit: () => void): void => {
      const controller = iconAbortRef.current;
      if (
        iconsRegisteredRef.current ||
        controller == null ||
        !venueNeedsMarkerIcons(venueRef.current)
      ) {
        commit();
        return;
      }
      const token = ++registrationTokenRef.current;
      pendingRegistrationRef.current = true;
      void registerIconsThenLoad(map, registerGdbMarkerIcons, controller.signal, () => {
        pendingRegistrationRef.current = false;
        if (registrationTokenRef.current !== token || mapRef.current !== map) {
          return;
        }
        iconsRegisteredRef.current = true;
        commit();
      });
    },
    [],
  );

  useFeatureMarkers({
    map: mapInstance,
    venue,
    levelId,
    locale,
    selectedFeatureId,
    searchCategory,
    onSelect: onMarkerSelect,
  });

  useSelectedFeaturePopup({
    map: mapInstance,
    venue,
    selectedFeatureId,
    locale,
    compact,
    onClose: onPopupClose,
  });

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (container == null || mapRef.current != null) {
      return;
    }

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container,
        style: buildIndoorStyle(theme),
        attributionControl: false,
        pitchWithRotate: false,
        dragRotate: false,
        maxPitch: 0,
        center: [0, 0],
        zoom: 1,
      });
    } catch {
      // WebGL unavailable (e.g. jsdom) — leave the empty container.
      return;
    }

    map.touchZoomRotate.disableRotation();
    map.addControl(
      new maplibregl.AttributionControl({
        compact: false,
        customAttribution: "IMDF venue data © Company",
      }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right",
    );

    mapRef.current = map;

    // Aborts a pending icon registration on teardown so a late resolve cannot
    // mutate a removed map. Reset per-map registration state.
    const iconAbort = new AbortController();
    iconAbortRef.current = iconAbort;
    iconsRegisteredRef.current = false;
    pendingRegistrationRef.current = false;

    const onClick = (event: MapMouseEvent): void => {
      const customClick = onMapClickRef.current;
      if (customClick !== undefined) {
        customClick([event.lngLat.lng, event.lngLat.lat]);
        return;
      }
      const features = map.queryRenderedFeatures(event.point, {
        layers: [...CLICKABLE_LAYER_IDS],
      });
      const first = features[0];
      const featureId = readFeatureId(first?.properties);
      onSelectRef.current(featureId);
    };

    const onMouseMove = (event: MapMouseEvent): void => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: [...CLICKABLE_LAYER_IDS],
      });
      const nextId = readFeatureId(features[0]?.properties);
      const prevId = hoverIdRef.current;
      if (prevId === nextId) {
        map.getCanvas().style.cursor = nextId != null ? "pointer" : "";
        return;
      }
      if (prevId != null) {
        clearFeatureState(map, prevId, "hover");
      }
      if (nextId != null) {
        applyFeatureState(map, nextId, { hover: true });
        map.getCanvas().style.cursor = "pointer";
      } else {
        map.getCanvas().style.cursor = "";
      }
      hoverIdRef.current = nextId;
    };

    const onMouseLeave = (): void => {
      if (hoverIdRef.current != null) {
        clearFeatureState(map, hoverIdRef.current, "hover");
        hoverIdRef.current = null;
      }
      map.getCanvas().style.cursor = "";
    };

    const onLoad = (): void => {
      // Lazy: only register icons if the initial venue actually needs them, then
      // commit the latest refs once; a pure IMDF venue commits immediately with
      // zero icon fetches.
      ensureIconsThenCommit(map, () => {
        setSourceData(map, venueRef.current, levelIdRef.current);
        fitLevelBounds(map, venueRef.current, levelIdRef.current);
        setMapInstance(map);

        const selected = selectedIdRef.current;
        if (selected != null) {
          cancelReadyRef.current?.();
          cancelReadyRef.current = whenSourceReady(map, () => {
            applyFeatureState(map, selected, { selected: true });
            appliedSelectedRef.current = selected;
          });
        }
      });
    };

    map.on("load", onLoad);
    map.on("click", onClick);
    map.on("mousemove", onMouseMove);
    map.on("mouseout", onMouseLeave);

    const markIdle = (): void => {
      container.dataset.mapIdle = "true";
    };
    const clearIdle = (): void => {
      delete container.dataset.mapIdle;
    };
    map.on("idle", markIdle);
    map.on("dataloading", clearIdle);
    map.on("movestart", clearIdle);
    map.on("move", clearIdle);

    return () => {
      cancelReadyRef.current?.();
      cancelReadyRef.current = null;
      map.off("load", onLoad);
      map.off("click", onClick);
      map.off("mousemove", onMouseMove);
      map.off("mouseout", onMouseLeave);
      map.off("idle", markIdle);
      map.off("dataloading", clearIdle);
      map.off("movestart", clearIdle);
      map.off("move", clearIdle);
      pendingRegistrationRef.current = false;
      iconAbort.abort();
      iconAbortRef.current = null;
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
      hoverIdRef.current = null;
      appliedSelectedRef.current = null;
    };
    // Map is created once; theme/venue/level are applied via later effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Level or venue change: replace source data and fit bounds.
  useEffect(() => {
    const map = mapRef.current;
    if (map == null || !map.isStyleLoaded()) {
      return;
    }
    // A pending registration commit will apply the latest venue/level refs.
    if (pendingRegistrationRef.current) {
      return;
    }

    cancelReadyRef.current?.();
    cancelReadyRef.current = null;

    // Clear prior selection state before data swap.
    if (appliedSelectedRef.current != null) {
      clearFeatureState(map, appliedSelectedRef.current, "selected");
      appliedSelectedRef.current = null;
    }
    if (hoverIdRef.current != null) {
      clearFeatureState(map, hoverIdRef.current, "hover");
      hoverIdRef.current = null;
    }

    // A later GDB venue arriving after an IMDF venue registers icons first;
    // the commit reads the latest refs so a newer swap cannot double-commit.
    ensureIconsThenCommit(map, () => {
      setSourceData(map, venueRef.current, levelIdRef.current);
      fitLevelBounds(map, venueRef.current, levelIdRef.current);

      const selected = selectedIdRef.current;
      if (selected != null) {
        cancelReadyRef.current?.();
        cancelReadyRef.current = whenSourceReady(map, () => {
          const feature = venueRef.current.featuresById.get(selected);
          if (feature == null || feature.center == null) {
            return;
          }
          applyFeatureState(map, selected, { selected: true });
          appliedSelectedRef.current = selected;

          revealSelection(map, feature.center, compact);
        });
      }
    });
  }, [venue, levelId, compact, ensureIconsThenCommit]);

  // Selection change (same level): update feature-state + camera.
  useEffect(() => {
    const map = mapRef.current;
    if (map == null || !map.isStyleLoaded() || pendingRegistrationRef.current) {
      return;
    }

    const prev = appliedSelectedRef.current;
    if (prev === selectedFeatureId) {
      return;
    }

    if (prev != null) {
      clearFeatureState(map, prev, "selected");
      appliedSelectedRef.current = null;
    }

    if (selectedFeatureId == null) {
      return;
    }

    const feature = venue.featuresById.get(selectedFeatureId);
    if (feature == null) {
      return;
    }

    const applySelection = (): void => {
      // null center → retain camera and render no highlight
      if (feature.center == null) {
        return;
      }
      applyFeatureState(map, selectedFeatureId, { selected: true });
      appliedSelectedRef.current = selectedFeatureId;

      revealSelection(map, feature.center, compact);
    };

    // If the feature is on another level, the level effect owns reapplication
    // after source replacement. When already on the feature's level (or null
    // levelId keeps current), apply immediately once the source is ready.
    if (feature.levelId != null && feature.levelId !== levelId) {
      return;
    }

    cancelReadyRef.current?.();
    cancelReadyRef.current = whenSourceReady(map, applySelection);
  }, [selectedFeatureId, venue, levelId, compact]);

  useEffect(() => {
    const map = mapRef.current;
    if (map == null || !map.isStyleLoaded()) return;
    const previous = previousBottomPaddingRef.current;
    previousBottomPaddingRef.current = bottomPadding;
    map.setPadding({ top: 0, right: 0, bottom: bottomPadding, left: 0 });
    if (!compact || bottomPadding <= previous || selectedFeatureId === null) return;
    const feature = venue.featuresById.get(selectedFeatureId);
    if (feature?.center == null) return;
    const point = map.project(feature.center);
    const visibleBottom = map.getCanvas().clientHeight - bottomPadding;
    if (point.y > visibleBottom - 16) {
      map.panBy([0, point.y - visibleBottom + 16], {
        duration: prefersReducedMotion() ? 0 : EASE_DURATION_MS,
      });
    }
  }, [bottomPadding, compact, selectedFeatureId, venue]);

  // Theme switch: paint properties only — never rebuild style/map.
  useEffect(() => {
    const map = mapRef.current;
    if (map == null || !map.isStyleLoaded()) {
      return;
    }
    if (themeIdRef.current === theme.id) {
      // Still apply paints so token-level edits refresh even if id is reused.
    }
    themeIdRef.current = theme.id;
    applyThemePaintProperties((layerId, name, value) => {
      if (map.getLayer(layerId) != null) {
        map.setPaintProperty(layerId, name, value);
      }
    }, theme);
  }, [theme]);

  // Imperative camera fly: eases only when a new flyTo token arrives, so a
  // repeated token (e.g. a re-render with the same target) never re-flies.
  useEffect(() => {
    if (
      mapInstance === null ||
      flyTo === null ||
      flyTo === undefined ||
      flyTo.token === lastFlyTokenRef.current
    ) {
      return;
    }
    lastFlyTokenRef.current = flyTo.token;
    mapInstance.easeTo({ center: flyTo.lngLat, duration: EASE_DURATION_MS });
  }, [flyTo, mapInstance]);

  return (
    <div
      ref={containerRef}
      className="indoor-map"
      role="application"
      aria-label="Indoor map"
      style={{ width: "100%", height: "100%" }}
    />
  );
}
