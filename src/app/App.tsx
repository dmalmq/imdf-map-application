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
import { ExplorerSidebar } from "../components/ExplorerSidebar";
import { resolveSelectedFeature } from "../components/FeatureDetails";
import { ImdfDropzone } from "../components/ImdfDropzone";
import { LevelSwitcher } from "../components/LevelSwitcher";
import { ThemeSwitcher } from "../components/ThemeSwitcher";
import { ViewerErrorNotice } from "../components/ViewerNotice";
import { ArchiveError } from "../errors/ArchiveError";
import { fetchImdfFile, fileNameFromSrc } from "../imdf/fetchImdfArchive";
import { loadImdfArchive } from "../imdf/loadImdfArchive";
import { localizedLabel } from "../imdf/localize";
import type { SearchResult } from "../imdf/types";
import { IndoorMap } from "../map/IndoorMap";
import { searchVenue } from "../search/searchVenue";
import {
  initialViewerState,
  viewerReducer,
  type ReadyVenueState,
  type ViewerState,
} from "../state/viewerReducer";
import { themes } from "../theme/presets";
import type { ThemeId } from "../theme/types";
import { parseViewerParams } from "./viewerParams";

const ui = {
  product: { ja: "IMDF Indoor Viewer", en: "IMDF Indoor Viewer" },
  localeGroup: { ja: "言語", en: "Language" },
  localeJa: { ja: "日本語", en: "日本語" },
  localeEn: { ja: "English", en: "English" },
  openZip: { ja: "IMDF ZIP を開く", en: "Open IMDF ZIP" },
  loading: { ja: "読み込み中", en: "Loading" },
  ready: { ja: "会場を読み込みました", en: "Venue loaded" },
  error: { ja: "読み込みエラー", en: "Load error" },
  empty: { ja: "会場が未読み込みです", en: "No venue loaded" },
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

function themeStyle(themeId: ThemeId): CSSProperties {
  const theme = themes[themeId];
  const c = theme.colors;
  return {
    ["--color-canvas" as string]: c.canvas,
    ["--color-panel" as string]: c.panel,
    ["--color-text" as string]: c.text,
    ["--color-muted" as string]: c.muted,
    ["--color-border" as string]: c.border,
    ["--color-accent" as string]: c.accent,
    ["--color-accent-soft" as string]: c.accentSoft,
    ["--color-unit" as string]: c.unit,
    ["--color-unit-outline" as string]: c.unitOutline,
    ["--color-walkway" as string]: c.walkway,
    ["--color-restricted" as string]: c.restricted,
    ["--color-opening" as string]: c.opening,
    ["--color-selected" as string]: c.selected,
    ["--color-error" as string]: c.error,
    ["--color-warning" as string]: c.warning,
    ["--color-focus" as string]: c.focus,
    fontFamily: theme.fontFamily,
  };
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

function toArchiveError(error: unknown): ArchiveError {
  if (error instanceof ArchiveError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Unknown worker failure";
  return new ArchiveError("worker_failed", message);
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
  const [state, dispatch] = useReducer(viewerReducer, params, (p) => ({
    ...initialViewerState,
    ...(p.locale !== null ? { locale: p.locale } : {}),
    ...(p.themeId !== null ? { themeId: p.themeId } : {}),
  }));
  const attemptTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const compact = useCompactLayout();
  const [mapDragActive, setMapDragActive] = useState(false);

  const theme = themes[state.themeId];
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
    const level = venueState.loadedVenue.levels.find((entry) => entry.id === venueState.selectedLevelId);
    if (!level) {
      return null;
    }
    return localizedLabel(level.label, locale, level.id, venueState.loadedVenue.manifest.language);
  }, [venueState, locale]);

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
          dispatch({ type: "load_failed", fileName, error: toArchiveError(error) });
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
    if (params.src === null) {
      return;
    }
    const src = params.src;
    runLoad(fileNameFromSrc(src), (signal) => fetchImdfFile(src, signal), params.level ?? undefined);
  }, [runLoad, params]);

  useEffect(() => {
    loadFromSrc();
  }, [loadFromSrc]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const openPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onSelectResult = useCallback((result: SearchResult) => {
    if (result.levelId === null) {
      dispatch({ type: "select_feature", featureId: result.featureId });
    } else {
      dispatch({ type: "select_feature", featureId: result.featureId, levelId: result.levelId });
    }
  }, []);

  const onMapSelectFeature = useCallback((featureId: string | null) => {
    dispatch({ type: "select_feature", featureId });
  }, []);

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
    <div className="locale-switcher" role="group" aria-label={ui.localeGroup[locale]}>
      <button
        type="button"
        className={locale === "ja" ? "locale-switcher__btn locale-switcher__btn--active" : "locale-switcher__btn"}
        aria-pressed={locale === "ja"}
        onClick={() => {
          dispatch({ type: "set_locale", locale: "ja" });
        }}
      >
        {ui.localeJa[locale]}
      </button>
      <button
        type="button"
        className={locale === "en" ? "locale-switcher__btn locale-switcher__btn--active" : "locale-switcher__btn"}
        aria-pressed={locale === "en"}
        onClick={() => {
          dispatch({ type: "set_locale", locale: "en" });
        }}
      >
        {ui.localeEn[locale]}
      </button>
    </div>
  );

  const themeSwitcher = (
    <ThemeSwitcher
      themeId={state.themeId}
      locale={locale}
      onChange={(themeId) => {
        dispatch({ type: "set_theme", themeId });
      }}
    />
  );

  const openButton = (
    <button type="button" className="top-bar__open" onClick={openPicker}>
      {ui.openZip[locale]}
    </button>
  );

  const venueMeta =
    venueName !== null ? (
      <div className="top-bar__meta">
        <span className="top-bar__venue">{venueName}</span>
        {levelName !== null ? <span className="top-bar__level">{levelName}</span> : null}
      </div>
    ) : null;

  const compactHeader =
    compact && venueState ? (
      <div className="explorer-sidebar__compact-header">
        <div className="explorer-sidebar__compact-row explorer-sidebar__compact-row--meta">{venueMeta}</div>
        <div className="explorer-sidebar__compact-row explorer-sidebar__compact-row--controls">
          {localeSwitcher}
          {themeSwitcher}
        </div>
      </div>
    ) : null;

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
  const onRetry = params.src !== null ? loadFromSrc : openPicker;

  return (
    <div className={compact ? "app app--compact" : "app"} style={themeStyle(state.themeId)}>
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

      {!embed ? (
        <header className="top-bar">
          <div className="top-bar__brand">
            <span className="top-bar__product">{ui.product[locale]}</span>
            {!compact ? venueMeta : null}
          </div>
          <div className="top-bar__actions">
            {!compact ? (
              <>
                {localeSwitcher}
                {themeSwitcher}
              </>
            ) : null}
            {openButton}
          </div>
        </header>
      ) : null}

      <div className="app__body">
        {showMap && !embed ? (
          <ExplorerSidebar
            locale={locale}
            searchText={venueState.searchText}
            searchCategory={venueState.searchCategory}
            results={searchResults}
            selectedFeature={selectedFeature}
            venue={venueState.loadedVenue}
            onSearchText={(text) => {
              dispatch({ type: "set_search_text", text });
            }}
            onSearchCategory={(category) => {
              dispatch({ type: "set_search_category", category });
            }}
            onSelectResult={onSelectResult}
            compactHeader={compactHeader}
          />
        ) : null}

        <main
          className="map-stage"
          onDragOver={dragEnabled ? onMapDragOver : undefined}
          onDragLeave={dragEnabled ? onMapDragLeave : undefined}
          onDrop={dragEnabled ? onMapDrop : undefined}
        >
          {showMap ? (
            <>
              <IndoorMap
                venue={venueState.loadedVenue}
                levelId={venueState.selectedLevelId}
                selectedFeatureId={venueState.selectedFeatureId}
                locale={locale}
                theme={theme}
                onSelectFeature={onMapSelectFeature}
              />
              <div className="map-stage__levels">
                <LevelSwitcher
                  levels={venueState.loadedVenue.levels}
                  selectedLevelId={venueState.selectedLevelId}
                  locale={locale}
                  manifestLanguage={venueState.loadedVenue.manifest.language}
                  onSelect={(levelId) => {
                    dispatch({ type: "select_level", levelId });
                  }}
                />
              </div>
              {state.status === "loading" && state.previous ? (
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
            </>
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
    </div>
  );
}
