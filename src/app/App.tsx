import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import { ContextBar } from "../components/ContextBar";
import { FloatingPanel } from "../components/FloatingPanel";
import { FloorStack } from "../components/FloorStack";
import { IconRail, type RailPanelId } from "../components/IconRail";
import { KirikoMark } from "../components/icons";
import { ImdfDropzone } from "../components/ImdfDropzone";
import { InspectorPanel, resolveSelectedFeature } from "../components/InspectorPanel";
import { LayersPanel } from "../components/LayersPanel";
import { SearchPanel } from "../components/SearchPanel";
import { ViewerErrorNotice } from "../components/ViewerNotice";
import { WarningsPanel } from "../components/WarningsPanel";
import { ZoomCluster } from "../components/ZoomCluster";
import { VenueLoadError } from "../errors/VenueLoadError";
import { fetchImdfFile, fileNameFromSrc } from "../imdf/fetchImdfArchive";
import { loadImdfArchive } from "../imdf/loadImdfArchive";
import { localizedLabel } from "../imdf/localize";
import type { SearchResult } from "../imdf/types";
import { IndoorMap, type IndoorMapControls } from "../map/IndoorMap";
import { defaultLayerVisibility, type MapLayerGroup } from "../map/layerGroups";
import { searchVenue } from "../search/searchVenue";
import {
  initialViewerState,
  viewerReducer,
  type ReadyVenueState,
  type ViewerState,
} from "../state/viewerReducer";
import { kirikoTheme } from "../theme/presets";
import { datasetArchiveUrl } from "../gallery/api";
import { parseViewerParams } from "./viewerParams";

const ui = {
  product: { ja: "Kiriko", en: "Kiriko" },
  localeGroup: { ja: "言語", en: "Language" },
  openZip: { ja: "IMDF ZIP を開く", en: "Open IMDF ZIP" },
  loading: { ja: "読み込み中", en: "Loading" },
  ready: { ja: "会場を読み込みました", en: "Venue loaded" },
  error: { ja: "読み込みエラー", en: "Load error" },
  empty: { ja: "会場が未読み込みです", en: "No venue loaded" },
  searchPanel: { ja: "検索", en: "Search" },
  layersPanel: { ja: "レイヤー", en: "Layers" },
  warningsPanel: { ja: "警告", en: "Warnings" },
  closePanel: { ja: "パネルを閉じる", en: "Close panel" },
  closeInspector: { ja: "詳細を閉じる", en: "Close details" },
  attribution: { ja: "IMDF venue data © Company", en: "IMDF venue data © Company" },
  openInKiriko: { ja: "Kiriko で開く", en: "Open in Kiriko" },
} as const;

const COMPACT_MQ = "(max-width: 899px)";

function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(COMPACT_MQ).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(COMPACT_MQ);
    const onChange = () => {
      setCompact(mql.matches);
    };
    onChange();
    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  }, []);

  return compact;
}

function themeStyle(): CSSProperties {
  return { fontFamily: kirikoTheme.fontFamily };
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  return false;
}

function toVenueLoadError(error: unknown): VenueLoadError {
  if (error instanceof VenueLoadError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Unknown worker failure";
  return new VenueLoadError("worker_failed", message);
}

function activeVenue(state: ViewerState): ReadyVenueState | null {
  if (state.status === "ready") {
    return {
      fileName: state.fileName,
      loadedVenue: state.loadedVenue,
      selectedLevelId: state.selectedLevelId,
      selectedFeatureId: state.selectedFeatureId,
      searchText: state.searchText,
      searchCategory: state.searchCategory,
    };
  }
  if ((state.status === "loading" || state.status === "error") && state.previous) {
    return state.previous;
  }
  return null;
}

function liveMessage(state: ViewerState): string {
  const locale = state.locale;
  switch (state.status) {
    case "loading":
      return `${ui.loading[locale]}: ${state.fileName}`;
    case "ready":
      return `${ui.ready[locale]}: ${state.fileName}`;
    case "error":
      return ui.error[locale];
    case "empty":
      return ui.empty[locale];
  }
}

export function App() {
  const params = useMemo(() => parseViewerParams(window.location.search), []);
  const embed = params.embed;
  const effectiveSrc = params.src ?? (params.dataset !== null ? datasetArchiveUrl(params.dataset) : null);
  const [state, dispatch] = useReducer(viewerReducer, params, (p) => ({
    ...initialViewerState,
    ...(p.locale !== null ? { locale: p.locale } : {}),
  }));
  const attemptTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const compact = useCompactLayout();
  const [mapDragActive, setMapDragActive] = useState(false);
  const [activePanel, setActivePanel] = useState<RailPanelId | null>(() =>
    embed ||
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(COMPACT_MQ).matches)
      ? null
      : "search",
  );
  const [layerVisibility, setLayerVisibility] = useState(defaultLayerVisibility);
  const [mapControls, setMapControls] = useState<IndoorMapControls | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const locale = state.locale;
  const venueState = activeVenue(state);

  const searchResults = useMemo(() => {
    if (!venueState) {
      return [] as SearchResult[];
    }
    return searchVenue(venueState.loadedVenue.searchEntries, {
      text: venueState.searchText,
      category: venueState.searchCategory,
      locale,
      levelId: venueState.selectedLevelId,
    });
  }, [venueState, locale]);

  const selectedFeature = useMemo(() => {
    if (!venueState) {
      return null;
    }
    return resolveSelectedFeature(venueState.loadedVenue, venueState.selectedFeatureId);
  }, [venueState]);

  const venueName = useMemo(() => {
    if (!venueState) {
      return null;
    }
    return localizedLabel(
      venueState.loadedVenue.venue.labels,
      locale,
      venueState.loadedVenue.venue.id,
      venueState.loadedVenue.manifest.language,
    );
  }, [venueState, locale]);

  const levelName = useMemo(() => {
    if (!venueState) {
      return null;
    }
    const level = venueState.loadedVenue.levels.find(
      (entry) => entry.id === venueState.selectedLevelId,
    );
    if (!level) {
      return null;
    }
    return localizedLabel(level.label, locale, level.id, venueState.loadedVenue.manifest.language);
  }, [venueState, locale]);

  const selectedFeatureName = useMemo(() => {
    if (!venueState || !selectedFeature) {
      return null;
    }
    return localizedLabel(
      selectedFeature.labels,
      locale,
      selectedFeature.id,
      venueState.loadedVenue.manifest.language,
    );
  }, [venueState, selectedFeature, locale]);

  const runLoad = useCallback(
    (fileName: string, getFile: (signal: AbortSignal) => Promise<File>, requestedLevel?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const token = attemptTokenRef.current + 1;
      attemptTokenRef.current = token;

      dispatch({ type: "load_started", fileName });

      void getFile(controller.signal)
        .then((file) => loadImdfArchive(file, controller.signal))
        .then((venue) => {
          if (token !== attemptTokenRef.current) {
            return;
          }
          dispatch({
            type: "load_succeeded",
            fileName,
            venue,
            ...(requestedLevel !== undefined ? { requestedLevel } : {}),
          });
        })
        .catch((error: unknown) => {
          if (token !== attemptTokenRef.current) {
            return;
          }
          if (isAbortError(error)) {
            return;
          }
          dispatch({ type: "load_failed", fileName, error: toVenueLoadError(error) });
        })
        .finally(() => {
          if (token === attemptTokenRef.current) {
            abortRef.current = null;
          }
        });
    },
    [],
  );

  const handleFile = useCallback(
    (file: File) => {
      runLoad(file.name, () => Promise.resolve(file));
    },
    [runLoad],
  );

  const loadFromSrc = useCallback(() => {
    if (effectiveSrc === null) {
      return;
    }
    const src = effectiveSrc;
    runLoad(fileNameFromSrc(src), (signal) => fetchImdfFile(src, signal), params.level ?? undefined);
  }, [runLoad, params, effectiveSrc]);

  useEffect(() => {
    loadFromSrc();
  }, [loadFromSrc]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const openPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onSelectResult = useCallback(
    (result: SearchResult) => {
      if (result.levelId === null) {
        dispatch({ type: "select_feature", featureId: result.featureId });
      } else {
        dispatch({ type: "select_feature", featureId: result.featureId, levelId: result.levelId });
      }
      // On compact, the sheet covers the map; close it so the selection shows.
      if (compact) {
        setActivePanel(null);
      }
    },
    [compact],
  );

  const onMapSelectFeature = useCallback((featureId: string | null) => {
    dispatch({ type: "select_feature", featureId });
  }, []);

  const onToggleRail = useCallback((panel: RailPanelId) => {
    setActivePanel((current) => (current === panel ? null : panel));
  }, []);

  const onToggleLayer = useCallback((group: MapLayerGroup) => {
    setLayerVisibility((current) => ({ ...current, [group]: !current[group] }));
  }, []);

  const onControls = useCallback((controls: IndoorMapControls | null) => {
    setMapControls(controls);
  }, []);

  const copyViewLink = useCallback(() => {
    const url = new URL(window.location.href);
    if (venueState) {
      url.searchParams.set("level", venueState.selectedLevelId);
    }
    url.searchParams.set("lang", locale);
    void navigator.clipboard
      .writeText(url.toString())
      .then(() => {
        setLinkCopied(true);
        if (copiedTimerRef.current !== null) {
          clearTimeout(copiedTimerRef.current);
        }
        copiedTimerRef.current = setTimeout(() => {
          setLinkCopied(false);
        }, 2000);
      })
      .catch(() => {
        // Clipboard unavailable (permissions, insecure context) — no feedback.
      });
  }, [venueState, locale]);

  const onMapDragOver = useCallback((event: DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    setMapDragActive(true);
  }, []);

  const onMapDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    setMapDragActive(false);
  }, []);

  const onMapDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setMapDragActive(false);
      const file = event.dataTransfer.files[0];
      if (file && file.name.toLowerCase().endsWith(".zip")) {
        handleFile(file);
      }
    },
    [handleFile],
  );

  const localeSwitcher = (
    <div className="locale-chips" role="group" aria-label={ui.localeGroup[locale]}>
      <button
        type="button"
        className={locale === "ja" ? "chip chip--selected" : "chip"}
        aria-pressed={locale === "ja"}
        onClick={() => {
          dispatch({ type: "set_locale", locale: "ja" });
        }}
      >
        日本語
      </button>
      <button
        type="button"
        className={locale === "en" ? "chip chip--selected" : "chip"}
        aria-pressed={locale === "en"}
        onClick={() => {
          dispatch({ type: "set_locale", locale: "en" });
        }}
      >
        EN
      </button>
    </div>
  );

  const warnings = venueState?.loadedVenue.warnings ?? [];
  const showMap = venueState !== null;
  const dragEnabled = showMap && !embed;
  const showEmptyDropzone =
    !embed && (state.status === "empty" || (state.status === "loading" && !state.previous));
  const showEmbedLoading = embed && state.status === "loading" && !state.previous;
  const showErrorBanner = state.status === "error";
  const showReplaceOverlay =
    mapDragActive &&
    !embed &&
    (state.status === "ready" || (state.status === "loading" && Boolean(state.previous)));
  const onRetry = effectiveSrc !== null ? loadFromSrc : openPicker;

  const viewerUrl = useMemo(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("embed");
    return url.toString();
  }, []);

  // Compact: sheets are exclusive — an open rail panel hides the inspector
  // sheet (selection and its map highlight persist underneath).
  const inspectorOpen =
    showMap && selectedFeature !== null && !embed && (!compact || activePanel === null);
  const embedInfoOpen = showMap && selectedFeature !== null && embed;

  return (
    <div className={compact ? "app app--compact" : "app"} style={themeStyle()}>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveMessage(state)}
      </div>

      <input
        ref={fileInputRef}
        className="imdf-dropzone__input"
        type="file"
        accept=".zip,application/zip"
        aria-label={ui.openZip[locale]}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            handleFile(file);
          }
          event.target.value = "";
        }}
      />

      <main
        className="map-stage"
        onDragOver={dragEnabled ? onMapDragOver : undefined}
        onDragLeave={dragEnabled ? onMapDragLeave : undefined}
        onDrop={dragEnabled ? onMapDrop : undefined}
      >
        {showMap ? (
          <IndoorMap
            venue={venueState.loadedVenue}
            levelId={venueState.selectedLevelId}
            selectedFeatureId={venueState.selectedFeatureId}
            locale={locale}
            theme={kirikoTheme}
            layerVisibility={layerVisibility}
            onSelectFeature={onMapSelectFeature}
            onControls={onControls}
          />
        ) : null}

        {!embed ? (
          <>
            <ContextBar venueName={venueName ?? ui.product[locale]} levelName={levelName} />

            <div className="top-actions">
              <button type="button" className="btn-ghost top-actions__open" onClick={openPicker}>
                {ui.openZip[locale]}
              </button>
              {localeSwitcher}
            </div>

            {showMap ? (
              <IconRail
                locale={locale}
                activePanel={activePanel}
                warningCount={warnings.length}
                onToggle={onToggleRail}
                variant={compact ? "bar" : "rail"}
              />
            ) : null}

            {showMap && activePanel === "search" ? (
              <FloatingPanel
                title={ui.searchPanel[locale]}
                closeLabel={ui.closePanel[locale]}
                onClose={() => {
                  setActivePanel(null);
                }}
                className="floating-panel--left"
              >
                <SearchPanel
                  locale={locale}
                  searchText={venueState.searchText}
                  searchCategory={venueState.searchCategory}
                  results={searchResults}
                  selectedFeatureId={venueState.selectedFeatureId}
                  onSearchText={(text) => {
                    dispatch({ type: "set_search_text", text });
                  }}
                  onSearchCategory={(category) => {
                    dispatch({ type: "set_search_category", category });
                  }}
                  onSelectResult={onSelectResult}
                />
              </FloatingPanel>
            ) : null}

            {showMap && activePanel === "layers" ? (
              <FloatingPanel
                title={ui.layersPanel[locale]}
                closeLabel={ui.closePanel[locale]}
                onClose={() => {
                  setActivePanel(null);
                }}
                className="floating-panel--left"
              >
                <LayersPanel locale={locale} visibility={layerVisibility} onToggle={onToggleLayer} />
              </FloatingPanel>
            ) : null}

            {showMap && activePanel === "warnings" ? (
              <FloatingPanel
                title={ui.warningsPanel[locale]}
                closeLabel={ui.closePanel[locale]}
                onClose={() => {
                  setActivePanel(null);
                }}
                className="floating-panel--left"
              >
                <WarningsPanel warnings={warnings} locale={locale} />
              </FloatingPanel>
            ) : null}

            {inspectorOpen && selectedFeature !== null ? (
              <FloatingPanel
                title={selectedFeatureName ?? selectedFeature.id}
                closeLabel={ui.closeInspector[locale]}
                onClose={() => {
                  onMapSelectFeature(null);
                }}
                className="floating-panel--inspector"
              >
                <InspectorPanel
                  feature={selectedFeature}
                  levels={venueState.loadedVenue.levels}
                  locale={locale}
                  manifestLanguage={venueState.loadedVenue.manifest.language}
                  {...(params.src !== null
                    ? { onCopyLink: copyViewLink, copied: linkCopied }
                    : {})}
                />
              </FloatingPanel>
            ) : null}
          </>
        ) : null}

        {embed && embedInfoOpen && selectedFeature !== null ? (
          <div className="embed-info">
            <p className="embed-info__title">{selectedFeatureName ?? selectedFeature.id}</p>
            <p className="embed-info__meta">
              {[selectedFeature.featureType, levelName]
                .filter((part): part is string => part !== null && part !== "")
                .join(" · ")}
            </p>
          </div>
        ) : null}

        {showMap ? (
          <>
            <FloorStack
              levels={venueState.loadedVenue.levels}
              selectedLevelId={venueState.selectedLevelId}
              locale={locale}
              manifestLanguage={venueState.loadedVenue.manifest.language}
              onSelect={(levelId) => {
                dispatch({ type: "select_level", levelId });
              }}
            />
            {mapControls !== null ? (
              <ZoomCluster
                locale={locale}
                onZoomIn={mapControls.zoomIn}
                onZoomOut={mapControls.zoomOut}
                onRecenter={mapControls.fitLevel}
              />
            ) : null}
            <p className="map-attribution">{ui.attribution[locale]}</p>
          </>
        ) : null}

        {embed ? (
          <a className="kiriko-badge" href={viewerUrl} target="_blank" rel="noreferrer">
            <KirikoMark size={14} />
            <span>
              Kiriko <span aria-hidden="true">↗</span>
            </span>
            <span className="sr-only">{ui.openInKiriko[locale]}</span>
          </a>
        ) : null}

        {showMap && state.status === "loading" && state.previous ? (
          <div className="map-stage__loading" role="status">
            <span className="imdf-dropzone__spinner" aria-hidden="true" />
            <span>
              {ui.loading[locale]}: {state.fileName}
            </span>
          </div>
        ) : null}

        {showReplaceOverlay ? (
          <ImdfDropzone
            locale={locale}
            status={state.status === "loading" ? "loading" : "ready"}
            {...(state.status === "loading" ? { fileName: state.fileName } : {})}
            variant="overlay"
            onFile={handleFile}
            onOpenPicker={openPicker}
          />
        ) : null}

        {showEmptyDropzone ? (
          <ImdfDropzone
            locale={locale}
            status={state.status === "loading" ? "loading" : "empty"}
            {...(state.status === "loading" ? { fileName: state.fileName } : {})}
            variant="empty"
            onFile={handleFile}
            onOpenPicker={openPicker}
          />
        ) : null}

        {showEmbedLoading ? (
          <div className="map-stage__loading" role="status">
            <span className="imdf-dropzone__spinner" aria-hidden="true" />
            <span>
              {ui.loading[locale]}: {state.status === "loading" ? state.fileName : ""}
            </span>
          </div>
        ) : null}

        {showErrorBanner ? (
          <div className="map-stage__error">
            <ViewerErrorNotice error={state.error} locale={locale} onRetry={onRetry} />
          </div>
        ) : null}
      </main>
    </div>
  );
}
