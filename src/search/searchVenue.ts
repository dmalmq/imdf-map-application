import { localizedLabel } from "../imdf/localize";
import type { LocaleCode, SearchEntry, SearchResult } from "../imdf/types";
import { normalizeSearchText } from "./normalizeSearchText";

export type SearchCategory = "all" | "gates" | "shops" | "facilities";

export interface SearchQuery {
  text: string;
  category: SearchCategory;
  locale: LocaleCode;
  levelId: string | null;
}

const MAX_RESULTS = 50;
const LEVEL_BOOST = 20;

function matchesCategory(entry: SearchEntry, category: SearchCategory): boolean {
  switch (category) {
    case "all":
      return true;
    case "gates":
      return entry.featureType === "opening" && (entry.category?.startsWith("pedestrian") ?? false);
    case "shops":
      return entry.featureType === "occupant";
    case "facilities":
      return entry.featureType === "amenity" || entry.featureType === "kiosk";
  }
}

function matchScore(entry: SearchEntry, text: string): number {
  for (const label of entry.normalizedLabels) {
    if (label === text) {
      return 500;
    }
  }
  for (const label of entry.normalizedAltLabels) {
    if (label === text) {
      return 450;
    }
  }
  for (const label of entry.normalizedLabels) {
    if (label.startsWith(text)) {
      return 400;
    }
  }
  for (const label of entry.normalizedAltLabels) {
    if (label.startsWith(text)) {
      return 350;
    }
  }
  for (const label of entry.normalizedLabels) {
    if (label.includes(text)) {
      return 300;
    }
  }
  for (const label of entry.normalizedAltLabels) {
    if (label.includes(text)) {
      return 250;
    }
  }
  if (entry.normalizedCategory.includes(text) || entry.featureType.includes(text)) {
    return 200;
  }
  return 0;
}

function toResult(entry: SearchEntry, locale: LocaleCode, score: number): SearchResult {
  return {
    featureId: entry.featureId,
    featureType: entry.featureType,
    levelId: entry.levelId,
    label: localizedLabel(entry.labels, locale, entry.featureId),
    score,
  };
}

export function searchVenue(entries: SearchEntry[], query: SearchQuery): SearchResult[] {
  const text = normalizeSearchText(query.text);
  const filtered = entries.filter((entry) => matchesCategory(entry, query.category));

  if (text === "") {
    if (query.category === "all") {
      return [];
    }
    return filtered
      .map((entry) => toResult(entry, query.locale, 0))
      .sort((a, b) => {
        const aOnLevel = a.levelId === query.levelId ? 0 : 1;
        const bOnLevel = b.levelId === query.levelId ? 0 : 1;
        if (aOnLevel !== bOnLevel) {
          return aOnLevel - bOnLevel;
        }
        const byLabel = a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
        if (byLabel !== 0) {
          return byLabel;
        }
        return a.featureId < b.featureId ? -1 : a.featureId > b.featureId ? 1 : 0;
      })
      .slice(0, MAX_RESULTS);
  }

  const results: SearchResult[] = [];
  for (const entry of filtered) {
    let score = matchScore(entry, text);
    if (score === 0) {
      continue;
    }
    if (entry.levelId === query.levelId) {
      score += LEVEL_BOOST;
    }
    results.push(toResult(entry, query.locale, score));
  }

  return results
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      const byLabel = a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
      if (byLabel !== 0) {
        return byLabel;
      }
      return a.featureId < b.featureId ? -1 : a.featureId > b.featureId ? 1 : 0;
    })
    .slice(0, MAX_RESULTS);
}
