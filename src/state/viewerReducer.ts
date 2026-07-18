import type { VenueLoadError } from "../errors/VenueLoadError";
import type { LoadedVenue, LocaleCode, ViewerLevel } from "../imdf/types";
import type { SearchCategory } from "../search/searchVenue";

export interface ReadyVenueState {
  fileName: string;
  loadedVenue: LoadedVenue;
  selectedLevelId: string;
  selectedFeatureId: string | null;
  searchText: string;
  searchCategory: SearchCategory;
}

export type ViewerState =
  | { status: "empty"; locale: LocaleCode }
  | {
      status: "loading";
      fileName: string;
      locale: LocaleCode;
      previous?: ReadyVenueState;
    }
  | ({ status: "ready"; locale: LocaleCode } & ReadyVenueState)
  | {
      status: "error";
      error: VenueLoadError;
      locale: LocaleCode;
      previous?: ReadyVenueState;
    };

export type ViewerAction =
  | { type: "load_started"; fileName: string }
  | { type: "load_succeeded"; fileName: string; venue: LoadedVenue; requestedLevel?: string }
  | { type: "load_failed"; fileName: string; error: VenueLoadError }
  | { type: "select_level"; levelId: string }
  | { type: "select_feature"; featureId: string | null; levelId?: string }
  | { type: "set_search_text"; text: string }
  | { type: "set_search_category"; category: SearchCategory }
  | { type: "set_locale"; locale: LocaleCode };

export const initialViewerState: ViewerState = {
  status: "empty",
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

/**
 * Case/width-insensitive match of a deep-link level query against id,
 * short_name, then name. Never interprets numbers as ordinals — IMDF ordinals
 * are offset from display floor numbers.
 */
export function matchLevelId(levels: ViewerLevel[], query: string): string | null {
  const normalize = (value: string): string => value.normalize("NFKC").trim().toLowerCase();
  const wanted = normalize(query);
  for (const level of levels) {
    if (normalize(level.id) === wanted) {
      return level.id;
    }
  }
  for (const level of levels) {
    if (Object.values(level.shortName).some((value) => normalize(value) === wanted)) {
      return level.id;
    }
  }
  for (const level of levels) {
    if (Object.values(level.label).some((value) => normalize(value) === wanted)) {
      return level.id;
    }
  }
  return null;
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
            locale: state.locale,
            previous,
          }
        : {
            status: "loading",
            fileName: action.fileName,
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
        locale: state.locale,
        fileName: action.fileName,
        loadedVenue: action.venue,
        selectedLevelId:
          (action.requestedLevel !== undefined
            ? matchLevelId(action.venue.levels, action.requestedLevel)
            : null) ?? pickInitialLevelId(action.venue.levels),
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
            locale: state.locale,
            previous: state.previous,
          }
        : { status: "error", error: action.error, locale: state.locale };
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
    case "set_locale":
      return { ...state, locale: action.locale };
  }
}
