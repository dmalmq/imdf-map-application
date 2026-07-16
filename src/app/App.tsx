import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type RefObject,
} from "react";
import { FloatingSearch } from "../components/FloatingSearch";
import { SelectedFeatureSheet } from "../components/SelectedFeatureSheet";
import { resolveSelectedFeatureContent } from "../components/resolveSelectedFeatureContent";
import { ImdfDropzone } from "../components/ImdfDropzone";
import { GdbImportDialog } from "../components/GdbImportDialog";
import { LevelSwitcher } from "../components/LevelSwitcher";
import { ViewerMenu } from "../components/ViewerMenu";
import { ViewerErrorNotice } from "../components/ViewerNotice";
import { ArchiveError } from "../errors/ArchiveError";
import { fetchImdfFile, fileNameFromSrc } from "../imdf/fetchImdfArchive";
import { loadImdfArchive } from "../imdf/loadImdfArchive";
import { readVenueSnapshot } from "../imdf/venueSnapshot";
import { datasetBlobUrl, fetchCatalog } from "../platform/catalogClient";
import { buildGdbVenue, suggestGdbMapping } from "../gdb/gdbMapping";
import {
  createGdbImportSession,
  gdbSelectionName,
  type GdbImportSession,
} from "../gdb/loadGdb";
import type { GdbInspection, GdbMappingPlan } from "../gdb/types";
import { localizedLabel } from "../imdf/localize";
import type { LoadedVenue, SearchResult } from "../imdf/types";
import { IndoorMap } from "../map/IndoorMap";
import { countFloorMarkerMatches } from "../map/useFeatureMarkers";
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
  reviewing: { ja: "GDB レイヤーマッピングを確認", en: "Review GDB layer mappings" },
  openGdbArchive: { ja: "GDB アーカイブを開く", en: "Open GDB archive(s)" },
  openGdbFolder: { ja: "GDB フォルダを開く", en: "Open GDB folder" },
} as const;

/** Compact sheet floats above the bottom search bar (CSS `bottom: 72px`). */
const SHEET_BOTTOM_CLEARANCE = 72;


function useCompactLayout(rootRef: RefObject<HTMLDivElement | null>): boolean {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setCompact(width < 900);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [rootRef]);

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
  if (
    (state.status === "loading" || state.status === "reviewing" || state.status === "error") &&
    state.previous
  ) {
    return state.previous;
  }
  return null;
}

function liveMessage(state: ViewerState): string {
  const locale = state.locale;
  switch (state.status) {
    case "loading":
      return `${ui.loading[locale]}: ${state.fileName}`;
    case "reviewing":
      return `${ui.reviewing[locale]}: ${state.fileName}`;
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
  const lastAttemptKindRef = useRef<"src" | "dataset" | "imdf" | "gdb-archive" | "gdb-folder">(
    params.dataset !== null ? "dataset" : params.src !== null ? "src" : "imdf",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gdbArchiveInputRef = useRef<HTMLInputElement>(null);
  const gdbFolderInputRef = useRef<HTMLInputElement>(null);
  const gdbSessionRef = useRef<GdbImportSession | null>(null);
  /**
   * Post-review focus once the dialog unmounts:
   * - `"map"` → `.maplibregl-canvas`
   * - `"auto"` → map when a venue is visible, else the matching GDB open control
   */
  const postGdbFocusRef = useRef<"map" | "auto" | null>(null);
  const appRootRef = useRef<HTMLDivElement>(null);
  const compact = useCompactLayout(appRootRef);
  const [mapDragActive, setMapDragActive] = useState(false);
  const [searchKey, setSearchKey] = useState(0);
  const [menuKey, setMenuKey] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [gdbReview, setGdbReview] = useState<{
    inspection: GdbInspection;
    initialPlan: GdbMappingPlan;
    fileName: string;
  } | null>(null);
  const [gdbError, setGdbError] = useState<ArchiveError | null>(null);
  const [gdbBusy, setGdbBusy] = useState(false);
  const gdbFolderSupported = useMemo(
    () => typeof document !== "undefined" && "webkitdirectory" in document.createElement("input"),
    [],
  );

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

  const currentFloorMatchCount = useMemo(() => {
    if (!venueState) return 0;
    return countFloorMarkerMatches(
      venueState.loadedVenue,
      venueState.selectedLevelId,
      venueState.searchCategory,
    );
  }, [venueState]);

  const selectedContent = useMemo(() => {
    if (!venueState || venueState.selectedFeatureId === null) return null;
    const feature = venueState.loadedVenue.featuresById.get(venueState.selectedFeatureId);
    return feature === undefined
      ? null
      : resolveSelectedFeatureContent(venueState.loadedVenue, feature, locale);
  }, [locale, venueState]);


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

  const disposeGdbSession = useCallback(() => {
    gdbSessionRef.current?.dispose();
    gdbSessionRef.current = null;
  }, []);

  const runVenueLoad = useCallback(
    (
      fileName: string,
      load: (signal: AbortSignal) => Promise<LoadedVenue>,
      requestedLevel?: string,
    ) => {
      abortRef.current?.abort();
      disposeGdbSession();
      setGdbReview(null);
      setGdbError(null);
      setGdbBusy(false);
      const controller = new AbortController();
      abortRef.current = controller;
      const token = attemptTokenRef.current + 1;
      attemptTokenRef.current = token;

      dispatch({ type: "load_started", fileName });

      void load(controller.signal)
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
    [disposeGdbSession],
  );

  const handleFile = useCallback(
    (file: File) => {
      lastAttemptKindRef.current = "imdf";
      runVenueLoad(file.name, (signal) => loadImdfArchive(file, signal));
    },
    [runVenueLoad],
  );

  const runGdbImport = useCallback(
    (mode: "directory" | "archive", files: readonly File[]) => {
      lastAttemptKindRef.current = mode === "directory" ? "gdb-folder" : "gdb-archive";
      abortRef.current?.abort();
      abortRef.current = null;
      disposeGdbSession();
      setGdbReview(null);
      setGdbError(null);
      setGdbBusy(false);
      const token = attemptTokenRef.current + 1;
      attemptTokenRef.current = token;
      const fileName = gdbSelectionName(files);

      // Announce the attempt before constructing the worker so a synchronous
      // factory/Worker failure lands on a matching in-flight load and preserves
      // the previous venue via load_failed.
      dispatch({ type: "load_started", fileName });
      let session: GdbImportSession;
      try {
        session = createGdbImportSession(mode, files);
      } catch (error) {
        postGdbFocusRef.current = "auto";
        dispatch({ type: "load_failed", fileName, error: toArchiveError(error) });
        return;
      }
      gdbSessionRef.current = session;

      void session
        .inspect()
        .then((inspection) => {
          if (token !== attemptTokenRef.current) {
            return;
          }
          setGdbReview({ inspection, initialPlan: suggestGdbMapping(inspection), fileName });
          dispatch({ type: "load_review_started", fileName });
        })
        .catch((error: unknown) => {
          if (token !== attemptTokenRef.current) {
            return;
          }
          if (isAbortError(error)) {
            return;
          }
          disposeGdbSession();
          postGdbFocusRef.current = "auto";
          dispatch({ type: "load_failed", fileName, error: toArchiveError(error) });
        });
    },
    [disposeGdbSession],
  );

  // Route a file selection or accepted drop: a single non-`.gdb.zip` archive is
  // the existing IMDF path; one-or-more `.gdb.zip` files are a GDB archive
  // import. Any other mixture is ignored.
  const handleFiles = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) {
        return;
      }
      const [only] = files;
      if (
        files.length === 1 &&
        only!.name.toLowerCase().endsWith(".zip") &&
        !only!.name.toLowerCase().endsWith(".gdb.zip")
      ) {
        handleFile(only!);
        return;
      }
      if (files.every((file) => file.name.toLowerCase().endsWith(".gdb.zip"))) {
        runGdbImport("archive", files);
      }
    },
    [handleFile, runGdbImport],
  );

  const onGdbImport = useCallback(
    (plan: GdbMappingPlan) => {
      const session = gdbSessionRef.current;
      const review = gdbReview;
      if (session === null || review === null) {
        return;
      }
      const token = attemptTokenRef.current;
      const fileName = review.fileName;
      setGdbBusy(true);
      setGdbError(null);

      void session
        .convert(plan)
        .then((conversion) => {
          if (token !== attemptTokenRef.current) {
            return;
          }
          const venue = buildGdbVenue(conversion, plan);
          setGdbBusy(false);
          setGdbReview(null);
          // Successful conversion: park keyboard focus on the live map canvas.
          postGdbFocusRef.current = "map";
          disposeGdbSession();
          dispatch({ type: "load_succeeded", fileName, venue });
        })
        .catch((error: unknown) => {
          if (token !== attemptTokenRef.current) {
            return;
          }
          if (isAbortError(error)) {
            return;
          }
          const archiveError = toArchiveError(error);
          setGdbBusy(false);
          // A genuine worker fault is fatal; a recoverable conversion/build
          // failure keeps the dialog mounted so manual choices survive a retry.
          if (archiveError.code === "worker_failed") {
            setGdbReview(null);
            disposeGdbSession();
            postGdbFocusRef.current = "auto";
            dispatch({ type: "load_failed", fileName, error: archiveError });
          } else {
            setGdbError(archiveError);
          }
        });
    },
    [gdbReview, disposeGdbSession],
  );

  const onGdbCancel = useCallback(() => {
    const fileName = gdbReview?.fileName ?? "";
    // Invalidate any in-flight convert so a late response cannot revive review.
    attemptTokenRef.current += 1;
    disposeGdbSession();
    setGdbReview(null);
    setGdbError(null);
    setGdbBusy(false);
    // Cancel: map when a previous venue reappears, else the remounted GDB open control.
    postGdbFocusRef.current = "auto";
    dispatch({ type: "load_cancelled", fileName });
  }, [gdbReview, disposeGdbSession]);

  const loadFromSrc = useCallback(() => {
    if (params.src === null || params.dataset !== null) {
      return;
    }
    const src = params.src;
    lastAttemptKindRef.current = "src";
    runVenueLoad(
      fileNameFromSrc(src),
      (signal) => fetchImdfFile(src, signal).then((file) => loadImdfArchive(file, signal)),
      params.level ?? undefined,
    );
  }, [runVenueLoad, params]);

  const loadDatasetById = useCallback(
    (datasetId: string) => {
      lastAttemptKindRef.current = "dataset";
      runVenueLoad(
        `${datasetId}.zip`,
        async (signal) => {
          const entries = await fetchCatalog(signal);
          const entry = entries.find((candidate) => candidate.id === datasetId);
          if (entry === undefined) {
            throw new ArchiveError("fetch_failed", "Dataset not found on the server.", {
              dataset: datasetId,
            });
          }
          const file = await fetchImdfFile(datasetBlobUrl(datasetId), signal);
          return entry.kind === "imdf" ? loadImdfArchive(file, signal) : readVenueSnapshot(file);
        },
        params.level ?? undefined,
      );
    },
    [params.level, runVenueLoad],
  );

  useEffect(() => {
    loadFromSrc();
  }, [loadFromSrc]);

  useEffect(() => {
    if (params.dataset !== null) {
      loadDatasetById(params.dataset);
    }
  }, [params.dataset, loadDatasetById]);

  // The folder input needs the non-standard `webkitdirectory` attribute set
  // imperatively so a parent containing several `.gdb` folders can be chosen.
  useEffect(() => {
    const input = gdbFolderInputRef.current;
    if (input !== null && gdbFolderSupported) {
      input.setAttribute("webkitdirectory", "");
    }
  }, [gdbFolderSupported]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      gdbSessionRef.current?.dispose();
      gdbSessionRef.current = null;
    };
  }, []);

  // After review ends, restore keyboard focus to an intentional live control.
  // Cancel/fatal use "auto" (map if a venue is visible, else the matching GDB
  // open button). Successful conversion always targets the map canvas.
  useLayoutEffect(() => {
    const intent = postGdbFocusRef.current;
    if (intent === null) {
      return;
    }
    if (state.status === "reviewing" || gdbReview !== null) {
      return;
    }
    postGdbFocusRef.current = null;

    const focusCanvas = (target: HTMLCanvasElement) => {
      if (!target.hasAttribute("tabindex")) {
        target.tabIndex = 0;
      }
      target.focus({ preventScroll: true });
    };
    const retryMapFocus = () => {
      postGdbFocusRef.current = "map";
      const focusAfterPaint = (retryWhenMissing: boolean) => {
        if (
          postGdbFocusRef.current !== "map" ||
          document.querySelector("dialog[open]") !== null
        ) {
          return;
        }
        const late = document.querySelector<HTMLCanvasElement>(".maplibregl-canvas");
        if (late === null && retryWhenMissing) {
          requestAnimationFrame(() => focusAfterPaint(false));
          return;
        }
        postGdbFocusRef.current = null;
        if (late !== null) {
          focusCanvas(late);
        }
      };
      requestAnimationFrame(() => focusAfterPaint(true));
    };

    const canvas = document.querySelector<HTMLCanvasElement>(".maplibregl-canvas");
    const preferMap = intent === "map" || venueState !== null;
    if (preferMap && canvas !== null) {
      focusCanvas(canvas);
      // Native modal teardown can restore the old focus after this layout pass.
      retryMapFocus();
      return;
    }
    if (intent === "map") {
      // Map not mounted on this commit yet; retry once after paint.
      retryMapFocus();
      return;
    }

    const kind = lastAttemptKindRef.current;
    const name =
      kind === "gdb-folder"
        ? ui.openGdbFolder[locale]
        : kind === "gdb-archive"
          ? ui.openGdbArchive[locale]
          : null;
    if (name !== null) {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (el) => el.textContent?.trim() === name,
      );
      if (button !== undefined) {
        button.focus();
        return;
      }
    }
    document
      .querySelector<HTMLButtonElement>(".viewer-notice--error .viewer-notice__retry")
      ?.focus();
  }, [state.status, gdbReview, locale, venueState]);

  const openPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const openGdbArchives = useCallback(() => {
    gdbArchiveInputRef.current?.click();
  }, []);

  const openGdbFolder = useCallback(() => {
    gdbFolderInputRef.current?.click();
  }, []);

  const onRetry = useCallback(() => {
    switch (lastAttemptKindRef.current) {
      case "dataset":
        if (params.dataset !== null) {
          loadDatasetById(params.dataset);
        }
        break;
      case "src":
        loadFromSrc();
        break;
      case "gdb-archive":
        gdbArchiveInputRef.current?.click();
        break;
      case "gdb-folder":
        gdbFolderInputRef.current?.click();
        break;
      default:
        fileInputRef.current?.click();
        break;
    }
  }, [loadFromSrc, loadDatasetById, params.dataset]);

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
      const files = Array.from(event.dataTransfer.files);
      const [only] = files;
      if (files.length === 1 && only!.name.toLowerCase().endsWith(".zip")) {
        handleFiles(files);
      } else if (files.length > 0 && files.every((f) => f.name.toLowerCase().endsWith(".gdb.zip"))) {
        handleFiles(files);
      }
    },
    [handleFiles],
  );

  const onSearchOpenChange = useCallback((open: boolean) => {
    if (open) setMenuKey((key) => key + 1);
  }, []);

  const onMenuOpenChange = useCallback((open: boolean) => {
    if (open) setSearchKey((key) => key + 1);
  }, []);


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

  return (
    <div ref={appRootRef} className={compact ? "app app--compact" : "app"} style={themeStyle(state.themeId)}>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveMessage(state)}
      </div>

      <input
        ref={fileInputRef}
        className="imdf-dropzone__input"
        type="file"
        accept=".zip,application/zip"
        tabIndex={-1}
        aria-hidden="true"
        aria-label={ui.openZip[locale]}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            handleFile(file);
          }
          event.target.value = "";
        }}
      />

      <input
        ref={gdbArchiveInputRef}
        className="imdf-dropzone__input"
        type="file"
        accept=".zip,.gdb.zip,application/zip"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        aria-label={ui.openGdbArchive[locale]}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) {
            runGdbImport("archive", files);
          }
          event.target.value = "";
        }}
      />

      {gdbFolderSupported ? (
        <input
          ref={gdbFolderInputRef}
          className="imdf-dropzone__input"
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          aria-label={ui.openGdbFolder[locale]}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length > 0) {
              runGdbImport("directory", files);
            }
            event.target.value = "";
          }}
        />
      ) : null}


      <div className="app__body">

        <main
          className="map-stage"
          onDragOver={dragEnabled ? onMapDragOver : undefined}
          onDragLeave={dragEnabled ? onMapDragLeave : undefined}
          onDrop={dragEnabled ? onMapDrop : undefined}
        >
          {showMap ? (
            <>
              <FloatingSearch
                key={`search-${searchKey}`}
                locale={locale}
                value={venueState.searchText}
                category={venueState.searchCategory}
                results={searchResults}
                selectedFeatureId={venueState.selectedFeatureId}
                currentFloorMatchCount={currentFloorMatchCount}
                onValueChange={(text) => {
                  dispatch({ type: "set_search_text", text });
                }}
                onCategoryChange={(category) => {
                  dispatch({ type: "set_search_category", category });
                }}
                onSelectResult={onSelectResult}
                onOpenChange={onSearchOpenChange}
              />
              <ViewerMenu
                key={`menu-${menuKey}`}
                venueName={venueName ?? venueState.loadedVenue.venue.id}
                floorName={levelName}
                locale={locale}
                themeId={state.themeId}
                showFileControls={!embed || params.allowOpen}
                onLocaleChange={(nextLocale) => {
                  dispatch({ type: "set_locale", locale: nextLocale });
                }}
                onThemeChange={(themeId) => {
                  dispatch({ type: "set_theme", themeId });
                }}
                onOpenFile={openPicker}
                onOpenGdbArchives={openGdbArchives}
                onOpenGdbFolder={openGdbFolder}
                gdbFolderSupported={gdbFolderSupported}
                onOpenChange={onMenuOpenChange}
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
              <IndoorMap
                venue={venueState.loadedVenue}
                levelId={venueState.selectedLevelId}
                selectedFeatureId={venueState.selectedFeatureId}
                locale={locale}
                theme={theme}
                searchCategory={venueState.searchCategory}
                compact={compact}
                bottomPadding={
                  compact && sheetHeight > 0 ? sheetHeight + SHEET_BOTTOM_CLEARANCE : 0
                }
                onSelectFeature={onMapSelectFeature}
              />
              {compact && selectedContent !== null && venueState.selectedFeatureId !== null ? (
                <SelectedFeatureSheet
                  content={selectedContent}
                  selectedFeatureId={venueState.selectedFeatureId}
                  {...(appRootRef.current !== null ? { markerRoot: appRootRef.current } : {})}
                  locale={locale}
                  onClose={() => {
                    dispatch({ type: "select_feature", featureId: null });
                  }}
                  onHeightChange={setSheetHeight}
                />
              ) : null}
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
                  onFiles={handleFiles}
                  onOpenPicker={openPicker}
                  onOpenGdbArchives={openGdbArchives}
                  onOpenGdbFolder={openGdbFolder}
                  gdbFolderSupported={gdbFolderSupported}
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
              onFiles={handleFiles}
              onOpenPicker={openPicker}
              onOpenGdbArchives={openGdbArchives}
              onOpenGdbFolder={openGdbFolder}
              gdbFolderSupported={gdbFolderSupported}
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

          {gdbReview !== null && state.status === "reviewing" ? (
            <GdbImportDialog
              inspection={gdbReview.inspection}
              initialPlan={gdbReview.initialPlan}
              locale={locale}
              busy={gdbBusy}
              error={gdbError}
              onImport={onGdbImport}
              onCancel={onGdbCancel}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
