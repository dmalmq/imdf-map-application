import type { ReactNode } from "react";
import type { LocaleCode, LoadedVenue, SearchResult, ViewerFeature } from "../imdf/types";
import type { SearchCategory } from "../search/searchVenue";
import { CategoryChips } from "./CategoryChips";
import { FeatureDetails } from "./FeatureDetails";
import { SearchBox } from "./SearchBox";
import { ViewerWarnings } from "./ViewerNotice";

const ui = {
  results: { ja: "検索結果", en: "Results" },
  noResults: { ja: "該当する結果がありません", en: "No matching results" },
  explorer: { ja: "エクスプローラー", en: "Explorer" },
} as const;

export interface ExplorerSidebarProps {
  locale: LocaleCode;
  searchText: string;
  searchCategory: SearchCategory;
  results: SearchResult[];
  selectedFeature: ViewerFeature | null;
  venue: LoadedVenue | null;
  onSearchText: (text: string) => void;
  onSearchCategory: (category: SearchCategory) => void;
  onSelectResult: (result: SearchResult) => void;
  /** Compact layout: venue/level + locale/theme controls rendered above search. */
  compactHeader?: ReactNode;
}

export function ExplorerSidebar({
  locale,
  searchText,
  searchCategory,
  results,
  selectedFeature,
  venue,
  onSearchText,
  onSearchCategory,
  onSelectResult,
  compactHeader,
}: ExplorerSidebarProps) {
  return (
    <aside className="explorer-sidebar" aria-label={ui.explorer[locale]}>
      {compactHeader}
      <div className="explorer-sidebar__body">
        <SearchBox value={searchText} locale={locale} onChange={onSearchText} />
        <CategoryChips category={searchCategory} locale={locale} onChange={onSearchCategory} />

        <section className="explorer-sidebar__results" aria-label={ui.results[locale]}>
          <h2 className="explorer-sidebar__section-title">{ui.results[locale]}</h2>
          {results.length === 0 ? (
            <p className="explorer-sidebar__empty">{ui.noResults[locale]}</p>
          ) : (
            <ul className="explorer-sidebar__result-list" role="listbox">
              {results.map((result) => {
                const selected = selectedFeature?.id === result.featureId;
                return (
                  <li key={result.featureId}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={
                        selected
                          ? "explorer-sidebar__result explorer-sidebar__result--selected"
                          : "explorer-sidebar__result"
                      }
                      onClick={() => {
                        onSelectResult(result);
                      }}
                    >
                      <span className="explorer-sidebar__result-label">{result.label}</span>
                      <span className="explorer-sidebar__result-meta">{result.featureType}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <FeatureDetails
          feature={selectedFeature}
          levels={venue?.levels ?? []}
          locale={locale}
          manifestLanguage={venue?.manifest.language ?? "en"}
        />

        {venue ? <ViewerWarnings warnings={venue.warnings} locale={locale} /> : null}
      </div>
    </aside>
  );
}
