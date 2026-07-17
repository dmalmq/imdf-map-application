import type { FeatureType, SearchEntry } from "../imdf/types";

/** Session visibility: the sets of hidden feature types and building ids. */
export interface VisibilitySelection {
  hiddenTypes: ReadonlySet<FeatureType>;
  hiddenBuildings: ReadonlySet<string>;
}

/**
 * Whether a feature of `featureType` belonging to `buildingId` is visible under
 * the current selection. The venue outline is always visible; a null building
 * is unaffected by building filters.
 */
export function isTypeAndBuildingVisible(
  featureType: FeatureType,
  buildingId: string | null,
  v: VisibilitySelection,
): boolean {
  if (featureType === "venue") {
    return true;
  }
  if (v.hiddenTypes.has(featureType)) {
    return false;
  }
  return buildingId === null || !v.hiddenBuildings.has(buildingId);
}

/** Search entries that survive the current visibility selection. */
export function visibleSearchEntries(
  entries: SearchEntry[],
  v: VisibilitySelection,
): SearchEntry[] {
  return entries.filter((entry) => isTypeAndBuildingVisible(entry.featureType, entry.buildingId, v));
}
