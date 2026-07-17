import type { ArchiveError } from "../errors/ArchiveError";
import type { FeatureType, LoadedVenue, LocaleCode, ViewerLevel } from "../imdf/types";
import { matchesSearchCategory, type SearchCategory } from "../search/searchCategories";
import type { ThemeId } from "../theme/types";

export interface ReadyVenueState {
  fileName: string;
  loadedVenue: LoadedVenue;
  selectedLevelId: string;
  selectedFeatureId: string | null;
  hiddenTypes: ReadonlySet<FeatureType>;
  hiddenBuildings: ReadonlySet<string>;
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
  | {
      status: "reviewing";
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
  | { type: "load_review_started"; fileName: string }
  | { type: "load_cancelled"; fileName: string }
  | { type: "load_succeeded"; fileName: string; venue: LoadedVenue; requestedLevel?: string }
  | { type: "load_failed"; fileName: string; error: ArchiveError }
  | { type: "select_level"; levelId: string }
  | { type: "select_feature"; featureId: string | null; levelId?: string }
  | { type: "set_search_text"; text: string }
  | { type: "set_search_category"; category: SearchCategory }
  | { type: "set_theme"; themeId: ThemeId }
  | { type: "set_locale"; locale: LocaleCode }
  | { type: "toggle_type"; featureType: FeatureType }
  | { type: "toggle_building"; buildingId: string }
  | { type: "set_types_hidden"; hidden: FeatureType[] }
  | { type: "set_buildings_hidden"; hidden: string[] };

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
    if (level.sourceLevelIds.some((id) => normalize(id) === wanted)) {
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
      const {
        fileName,
        loadedVenue,
        selectedLevelId,
        selectedFeatureId,
        hiddenTypes,
        hiddenBuildings,
        searchText,
        searchCategory,
      } = state;
      return {
        fileName,
        loadedVenue,
        selectedLevelId,
        selectedFeatureId,
        hiddenTypes,
        hiddenBuildings,
        searchText,
        searchCategory,
      };
    }
    case "loading":
    case "reviewing":
    case "error":
      return state.previous;
    case "empty":
      return undefined;
  }
}

/** The selected feature id, or null if it is newly hidden by the visibility sets. */
function clearedSelectionIfHidden(
  state: ViewerState & { status: "ready" },
  hiddenTypes: ReadonlySet<FeatureType>,
  hiddenBuildings: ReadonlySet<string>,
): string | null {
  const id = state.selectedFeatureId;
  if (id === null) {
    return null;
  }
  const feature = state.loadedVenue.featuresById.get(id);
  if (feature === undefined) {
    return id;
  }
  const visible =
    !hiddenTypes.has(feature.featureType) &&
    (feature.buildingId === null || !hiddenBuildings.has(feature.buildingId));
  return visible ? id : null;
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
    case "load_review_started": {
      // Only the matching in-flight load may enter review.
      if (state.status !== "loading" || state.fileName !== action.fileName) {
        return state;
      }
      return state.previous
        ? {
            status: "reviewing",
            fileName: action.fileName,
            themeId: state.themeId,
            locale: state.locale,
            previous: state.previous,
          }
        : {
            status: "reviewing",
            fileName: action.fileName,
            themeId: state.themeId,
            locale: state.locale,
          };
    }
    case "load_cancelled": {
      // Cancelling a matching review restores the prior venue (retaining the
      // current theme/locale) or returns to empty when there was none.
      if (state.status !== "reviewing" || state.fileName !== action.fileName) {
        return state;
      }
      return state.previous
        ? {
            status: "ready",
            themeId: state.themeId,
            locale: state.locale,
            ...state.previous,
          }
        : { status: "empty", themeId: state.themeId, locale: state.locale };
    }
    case "load_succeeded": {
      // Stale-attempt suppression: only the matching load or review in flight
      // may transition to ready. App additionally gates dispatch by token.
      if (
        (state.status !== "loading" && state.status !== "reviewing") ||
        state.fileName !== action.fileName
      ) {
        return state;
      }
      return {
        status: "ready",
        themeId: state.themeId,
        locale: state.locale,
        fileName: action.fileName,
        loadedVenue: action.venue,
        selectedLevelId:
          (action.requestedLevel !== undefined
            ? matchLevelId(action.venue.levels, action.requestedLevel)
            : null) ?? pickInitialLevelId(action.venue.levels),
        selectedFeatureId: null,
        hiddenTypes: new Set(),
        hiddenBuildings: new Set(),
        searchText: "",
        searchCategory: "all",
      };
    }
    case "load_failed": {
      if (
        (state.status !== "loading" && state.status !== "reviewing") ||
        state.fileName !== action.fileName
      ) {
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
    case "set_search_category": {
      if (state.status !== "ready") {
        return state;
      }
      const selected =
        state.selectedFeatureId === null
          ? undefined
          : state.loadedVenue.featuresById.get(state.selectedFeatureId);
      return {
        ...state,
        searchCategory: action.category,
        selectedFeatureId:
          selected !== undefined && !matchesSearchCategory(selected, action.category)
            ? null
            : state.selectedFeatureId,
      };
    }
    case "toggle_type": {
      if (state.status !== "ready") return state;
      const hiddenTypes = new Set(state.hiddenTypes);
      if (hiddenTypes.has(action.featureType)) hiddenTypes.delete(action.featureType);
      else hiddenTypes.add(action.featureType);
      return {
        ...state,
        hiddenTypes,
        selectedFeatureId: clearedSelectionIfHidden(state, hiddenTypes, state.hiddenBuildings),
      };
    }
    case "toggle_building": {
      if (state.status !== "ready") return state;
      const hiddenBuildings = new Set(state.hiddenBuildings);
      if (hiddenBuildings.has(action.buildingId)) hiddenBuildings.delete(action.buildingId);
      else hiddenBuildings.add(action.buildingId);
      return {
        ...state,
        hiddenBuildings,
        selectedFeatureId: clearedSelectionIfHidden(state, state.hiddenTypes, hiddenBuildings),
      };
    }
    case "set_types_hidden": {
      if (state.status !== "ready") return state;
      const hiddenTypes = new Set(action.hidden);
      return {
        ...state,
        hiddenTypes,
        selectedFeatureId: clearedSelectionIfHidden(state, hiddenTypes, state.hiddenBuildings),
      };
    }
    case "set_buildings_hidden": {
      if (state.status !== "ready") return state;
      const hiddenBuildings = new Set(action.hidden);
      return {
        ...state,
        hiddenBuildings,
        selectedFeatureId: clearedSelectionIfHidden(state, state.hiddenTypes, hiddenBuildings),
      };
    }
    case "set_theme":
      return { ...state, themeId: action.themeId };
    case "set_locale":
      return { ...state, locale: action.locale };
  }
}
