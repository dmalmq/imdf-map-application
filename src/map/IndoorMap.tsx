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
import type { ViewerTheme } from "../theme/types";
import { buildIndoorStyle, INDOOR_SOURCE_ID } from "./buildIndoorStyle";
import { buildRenderFeatures } from "./buildRenderFeatures";
import {
  applyThemePaintProperties,
  CLICKABLE_LAYER_IDS,
} from "./featureLayers";
import { LAYER_GROUP_IDS, type LayerVisibility } from "./layerGroups";
import { useFeatureMarkers } from "./useFeatureMarkers";

/** Imperative camera controls exposed to the Kiriko zoom cluster. */
export interface IndoorMapControls {
  zoomIn: () => void;
  zoomOut: () => void;
  fitLevel: () => void;
}

export interface IndoorMapProps {
  venue: LoadedVenue;
  levelId: string;
  selectedFeatureId: string | null;
  locale: LocaleCode;
  theme: ViewerTheme;
  layerVisibility: LayerVisibility;
  /** null = background click */
  onSelectFeature: (featureId: string | null) => void;
  /** Receives camera controls once the map exists; null on teardown. */
  onControls?: (controls: IndoorMapControls | null) => void;
}

const FIT_PADDING = 48;
const FIT_MAX_ZOOM = 20;
const EASE_DURATION_MS = 450;
const FIT_DURATION_MS = 500;

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

function applyLayerVisibility(map: MapLibreMap, visibility: LayerVisibility): void {
  for (const [group, layerIds] of Object.entries(LAYER_GROUP_IDS)) {
    const visible = visibility[group as keyof LayerVisibility];
    for (const layerId of layerIds) {
      if (map.getLayer(layerId) != null) {
        map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
      }
    }
  }
}

export function IndoorMap({
  venue,
  levelId,
  selectedFeatureId,
  locale,
  theme,
  layerVisibility,
  onSelectFeature,
  onControls,
}: IndoorMapProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRef = useRef(onSelectFeature);
  const venueRef = useRef(venue);
  const levelIdRef = useRef(levelId);
  const selectedIdRef = useRef(selectedFeatureId);
  const hoverIdRef = useRef<string | null>(null);
  const appliedSelectedRef = useRef<string | null>(null);
  const themeIdRef = useRef(theme.id);
  const cancelReadyRef = useRef<(() => void) | null>(null);
  const visibilityRef = useRef(layerVisibility);
  const onControlsRef = useRef(onControls);
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);

  onSelectRef.current = onSelectFeature;
  venueRef.current = venue;
  levelIdRef.current = levelId;
  selectedIdRef.current = selectedFeatureId;
  visibilityRef.current = layerVisibility;
  onControlsRef.current = onControls;

  const onMarkerSelect = useCallback((featureId: string) => {
    onSelectRef.current(featureId);
  }, []);

  useFeatureMarkers({
    map: mapInstance,
    venue,
    levelId,
    locale,
    selectedFeatureId,
    enabled: layerVisibility.labels,
    onSelect: onMarkerSelect,
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

    mapRef.current = map;

    // Kiriko chrome owns zoom/fit and attribution; no MapLibre controls.
    onControlsRef.current?.({
      zoomIn: () => {
        map.zoomIn({ duration: prefersReducedMotion() ? 0 : 200 });
      },
      zoomOut: () => {
        map.zoomOut({ duration: prefersReducedMotion() ? 0 : 200 });
      },
      fitLevel: () => {
        fitLevelBounds(map, venueRef.current, levelIdRef.current);
      },
    });

    const onClick = (event: MapMouseEvent): void => {
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
      setSourceData(map, venueRef.current, levelIdRef.current);
      applyLayerVisibility(map, visibilityRef.current);
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
      onControlsRef.current?.(null);
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

    setSourceData(map, venue, levelId);
    fitLevelBounds(map, venue, levelId);

    const selected = selectedIdRef.current;
    if (selected != null) {
      cancelReadyRef.current = whenSourceReady(map, () => {
        const feature = venueRef.current.featuresById.get(selected);
        if (feature == null || feature.center == null) {
          return;
        }
        applyFeatureState(map, selected, { selected: true });
        appliedSelectedRef.current = selected;

        const reduced = prefersReducedMotion();
        if (reduced) {
          map.jumpTo({ center: feature.center });
        } else {
          map.easeTo({
            center: feature.center,
            duration: EASE_DURATION_MS,
          });
        }
      });
    }
  }, [venue, levelId]);

  // Selection change (same level): update feature-state + camera.
  useEffect(() => {
    const map = mapRef.current;
    if (map == null || !map.isStyleLoaded()) {
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

      const reduced = prefersReducedMotion();
      if (reduced) {
        map.jumpTo({ center: feature.center });
      } else {
        map.easeTo({
          center: feature.center,
          duration: EASE_DURATION_MS,
        });
      }
    };

    // If the feature is on another level, the level effect owns reapplication
    // after source replacement. When already on the feature's level (or null
    // levelId keeps current), apply immediately once the source is ready.
    if (feature.levelId != null && feature.levelId !== levelId) {
      return;
    }

    cancelReadyRef.current?.();
    cancelReadyRef.current = whenSourceReady(map, applySelection);
  }, [selectedFeatureId, venue, levelId]);

  // Layer-group visibility toggles (Layers panel).
  useEffect(() => {
    const map = mapRef.current;
    if (map == null || !map.isStyleLoaded()) {
      return;
    }
    applyLayerVisibility(map, layerVisibility);
  }, [layerVisibility]);

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
