import type { ArchiveError } from "../errors/ArchiveError";
import type { LoadedVenue, LocaleCode, ViewerLevel } from "../imdf/types";
import type { SearchCategory } from "../search/searchVenue";
import type { ThemeId } from "../theme/types";

export interface ReadyVenueState {
  fileName: string;
  loadedVenue: LoadedVenue;
  selectedLevelId: string;
  selectedFeatureId: string | null;
  searchText: string;
  searchCategory: SearchCategory;
}

export type ViewerState =
  | { status: "empty"; themeId: ThemeId; locale: LocaleCode }
  | {
      status: "loading";
      fileName: string;
      themeId: ThemeId;
      locale: LocaleCode;
      previous?: ReadyVenueState;
    }
  | ({ status: "ready"; themeId: ThemeId; locale: LocaleCode } & ReadyVenueState)
  | {
      status: "error";
      error: ArchiveError;
      themeId: ThemeId;
      locale: LocaleCode;
      previous?: ReadyVenueState;
    };

export type ViewerAction =
  | { type: "load_started"; fileName: string }
  | { type: "load_succeeded"; fileName: string; venue: LoadedVenue }
  | { type: "load_failed"; fileName: string; error: ArchiveError }
  | { type: "select_level"; levelId: string }
  | { type: "select_feature"; featureId: string | null; levelId?: string }
  | { type: "set_search_text"; text: string }
  | { type: "set_search_category"; category: SearchCategory }
  | { type: "set_theme"; themeId: ThemeId }
  | { type: "set_locale"; locale: LocaleCode };

export const initialViewerState: ViewerState = {
  status: "empty",
  themeId: "tokyo-green",
  locale: "ja",
};

/**
 * Initial level selection: ordinal 0 when present, otherwise the level whose
 * ordinal is closest to zero, with the higher ordinal winning a tie.
 * `levels` is already sorted by descending ordinal, so the first minimal
 * |ordinal| encountered is the tie winner.
 */
export function pickInitialLevelId(levels: ViewerLevel[]): string {
  let best: ViewerLevel | null = null;
  for (const level of levels) {
    if (best === null || Math.abs(level.ordinal) < Math.abs(best.ordinal)) {
      best = level;
    }
  }
  if (best === null) {
    throw new Error("Venue has no levels");
  }
  return best.id;
}

function currentReadyState(state: ViewerState): ReadyVenueState | undefined {
  switch (state.status) {
    case "ready": {
      const { fileName, loadedVenue, selectedLevelId, selectedFeatureId, searchText, searchCategory } =
        state;
      return { fileName, loadedVenue, selectedLevelId, selectedFeatureId, searchText, searchCategory };
    }
    case "loading":
    case "error":
      return state.previous;
    case "empty":
      return undefined;
  }
}

export function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case "load_started": {
      const previous = currentReadyState(state);
      return previous
        ? {
            status: "loading",
            fileName: action.fileName,
            themeId: state.themeId,
            locale: state.locale,
            previous,
          }
        : {
            status: "loading",
            fileName: action.fileName,
            themeId: state.themeId,
            locale: state.locale,
          };
    }
    case "load_succeeded": {
      // Stale-attempt suppression: only the load currently in flight may
      // transition to ready. App additionally gates dispatch by attempt token.
      if (state.status !== "loading" || state.fileName !== action.fileName) {
        return state;
      }
      return {
        status: "ready",
        themeId: state.themeId,
        locale: state.locale,
        fileName: action.fileName,
        loadedVenue: action.venue,
        selectedLevelId: pickInitialLevelId(action.venue.levels),
        selectedFeatureId: null,
        searchText: "",
        searchCategory: "all",
      };
    }
    case "load_failed": {
      if (state.status !== "loading" || state.fileName !== action.fileName) {
        return state;
      }
      // A failed replacement keeps the previously rendered venue.
      return state.previous
        ? {
            status: "error",
            error: action.error,
            themeId: state.themeId,
            locale: state.locale,
            previous: state.previous,
          }
        : { status: "error", error: action.error, themeId: state.themeId, locale: state.locale };
    }
    case "select_level":
      return state.status === "ready" && state.loadedVenue.levels.some((l) => l.id === action.levelId)
        ? { ...state, selectedLevelId: action.levelId, selectedFeatureId: null }
        : state;
    case "select_feature": {
      if (state.status !== "ready") {
        return state;
      }
      // Search-result selection changes level and feature atomically; a null
      // levelId retains the current level per the selection contract.
      const levelId =
        action.levelId !== undefined && state.loadedVenue.levels.some((l) => l.id === action.levelId)
          ? action.levelId
          : state.selectedLevelId;
      return { ...state, selectedFeatureId: action.featureId, selectedLevelId: levelId };
    }
    case "set_search_text":
      return state.status === "ready" ? { ...state, searchText: action.text } : state;
    case "set_search_category":
      return state.status === "ready" ? { ...state, searchCategory: action.category } : state;
    case "set_theme":
      return { ...state, themeId: action.themeId };
    case "set_locale":
      return { ...state, locale: action.locale };
  }
}
