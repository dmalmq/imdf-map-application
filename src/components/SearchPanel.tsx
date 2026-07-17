import type { LocaleCode, SearchResult } from "../imdf/types";
import type { SearchCategory } from "../search/searchVenue";
import { IconClose, IconSearch } from "./icons";

const CATEGORIES: SearchCategory[] = ["all", "gates", "shops", "facilities"];

const categoryLabels: Record<SearchCategory, Record<LocaleCode, string>> = {
  all: { ja: "すべて", en: "All" },
  gates: { ja: "改札・出入口", en: "Gates" },
  shops: { ja: "店舗", en: "Shops" },
  facilities: { ja: "設備", en: "Facilities" },
};

const ui = {
  placeholder: { ja: "施設・店舗を検索", en: "Search features…" },
  searchLabel: { ja: "検索", en: "Search" },
  clear: { ja: "検索をクリア", en: "Clear search" },
  category: { ja: "カテゴリ", en: "Category" },
  results: { ja: "検索結果", en: "Results" },
  noResults: { ja: "該当する結果がありません", en: "No matching results" },
} as const;

export interface SearchPanelProps {
  locale: LocaleCode;
  searchText: string;
  searchCategory: SearchCategory;
  results: SearchResult[];
  selectedFeatureId: string | null;
  onSearchText: (text: string) => void;
  onSearchCategory: (category: SearchCategory) => void;
  onSelectResult: (result: SearchResult) => void;
}

/**
 * Kiriko Search panel body: icon input, filter chips, result list rows.
 * Hosted inside a FloatingPanel.
 */
export function SearchPanel({
  locale,
  searchText,
  searchCategory,
  results,
  selectedFeatureId,
  onSearchText,
  onSearchCategory,
  onSelectResult,
}: SearchPanelProps) {
  const inputId = "viewer-search-input";
  return (
    <div className="search-panel">
      <div className="kiriko-input">
        <IconSearch size={16} className="kiriko-input__icon" />
        <input
          id={inputId}
          type="search"
          value={searchText}
          placeholder={ui.placeholder[locale]}
          aria-label={ui.searchLabel[locale]}
          autoComplete="off"
          onChange={(event) => {
            onSearchText(event.target.value);
          }}
        />
        {searchText !== "" ? (
          <button
            type="button"
            className="kiriko-input__clear"
            aria-label={ui.clear[locale]}
            onClick={() => {
              onSearchText("");
            }}
          >
            <IconClose size={14} />
          </button>
        ) : null}
      </div>

      <div className="chip-row" role="group" aria-label={ui.category[locale]}>
        {CATEGORIES.map((id) => {
          const selected = id === searchCategory;
          return (
            <button
              key={id}
              type="button"
              className={selected ? "chip chip--selected" : "chip"}
              aria-pressed={selected}
              onClick={() => {
                onSearchCategory(id);
              }}
            >
              {categoryLabels[id][locale]}
            </button>
          );
        })}
      </div>

      <section className="search-panel__results" aria-label={ui.results[locale]}>
        <h3 className="panel-caption">{ui.results[locale]}</h3>
        {results.length === 0 ? (
          <p className="search-panel__empty">{ui.noResults[locale]}</p>
        ) : (
          <ul className="list-rows" role="listbox" aria-label={ui.results[locale]}>
            {results.map((result) => {
              const selected = selectedFeatureId === result.featureId;
              return (
                <li key={result.featureId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={selected ? "list-row list-row--selected" : "list-row"}
                    onClick={() => {
                      onSelectResult(result);
                    }}
                  >
                    <span className="list-row__title">{result.label}</span>
                    <span className="list-row__meta">{result.featureType}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
