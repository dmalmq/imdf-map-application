import type { FeatureType, SearchEntry, ViewerFeature } from "../imdf/types";
import { normalizeSearchText } from "./normalizeSearchText";

const INDEXED_TYPES: Partial<Record<FeatureType, true>> = {
  occupant: true,
  amenity: true,
  unit: true,
  opening: true,
  kiosk: true,
  building: true,
};

function normalizedValues(labels: Record<string, string>): string[] {
  const seen = new Set<string>();
  for (const value of Object.values(labels)) {
    const normalized = normalizeSearchText(value);
    if (normalized !== "") {
      seen.add(normalized);
    }
  }
  return [...seen];
}

function shortNameLabels(feature: ViewerFeature): Record<string, string> {
  const shortName = feature.sourceProperties["short_name"];
  if (shortName === null || typeof shortName !== "object") {
    return {};
  }
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(shortName)) {
    if (typeof value === "string" && value !== "") {
      labels[key] = value;
    }
  }
  return labels;
}

/**
 * Build the search index from normalized viewer features. Indexes
 * occupant, amenity, unit, opening, and kiosk labels, alternate labels,
 * short labels, category, and feature type. Raw anchors are never indexed.
 */
export function buildSearchEntries(features: Iterable<ViewerFeature>): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const feature of features) {
    if (INDEXED_TYPES[feature.featureType] !== true) {
      continue;
    }
    const normalizedAlt = new Set(normalizedValues(feature.altLabels));
    for (const value of normalizedValues(shortNameLabels(feature))) {
      normalizedAlt.add(value);
    }
    entries.push({
      featureId: feature.id,
      featureType: feature.featureType,
      levelId: feature.levelId,
      category: feature.category,
      labels: feature.labels,
      altLabels: feature.altLabels,
      normalizedLabels: normalizedValues(feature.labels),
      normalizedAltLabels: [...normalizedAlt],
      normalizedCategory: normalizeSearchText(feature.category ?? ""),
    });
  }
  return entries;
}
