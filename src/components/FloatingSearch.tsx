import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LocaleCode, SearchResult } from "../imdf/types";
import type { SearchCategory } from "../search/searchCategories";

const categories: SearchCategory[] = ["all", "gates", "shops", "facilities"];
const labels = {
  search: { ja: "検索", en: "Search" },
  placeholder: { ja: "場所を検索", en: "Search places" },
  filter: { ja: "絞り込み", en: "Filter" },
  results: { ja: "検索結果", en: "Search results" },
  categories: { ja: "カテゴリ", en: "Categories" },
  clearFilter: { ja: "絞り込みを解除", en: "Clear filter" },
  noFloor: { ja: "このフロアにありません", en: "on this floor" },
  noMatches: { ja: "一致する場所がありません", en: "No matching places" },
  category: {
    all: { ja: "すべて", en: "All" },
    gates: { ja: "改札・出入口", en: "Gates" },
    shops: { ja: "店舗", en: "Shops" },
    facilities: { ja: "設備", en: "Facilities" },
  },
} as const;

export interface FloatingSearchProps {
  locale: LocaleCode;
  value: string;
  category: SearchCategory;
  results: SearchResult[];
  selectedFeatureId: string | null;
  currentFloorMatchCount: number;
  onValueChange: (value: string) => void;
  onCategoryChange: (category: SearchCategory) => void;
  onSelectResult: (result: SearchResult) => void;
  onOpenChange: (open: boolean) => void;
}

interface PopupPosition {
  top: number;
  left: number;
  width: number;
}

export function FloatingSearch({
  locale,
  value,
  category,
  results,
  selectedFeatureId,
  currentFloorMatchCount,
  onValueChange,
  onCategoryChange,
  onSelectResult,
  onOpenChange,
}: FloatingSearchProps) {
  const id = useId().replace(/:/g, "");
  const listboxId = `${id}-results`;
  const controlRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<PopupPosition>({ top: 0, left: 0, width: 320 });
  const visibleResults = results.slice(0, 50);
  const canOpenResults = value.trim() !== "" || category !== "all";

  useEffect(() => {
    setActiveIndex((current) =>
      visibleResults.length === 0 ? -1 : Math.min(current, visibleResults.length - 1),
    );
  }, [visibleResults.length]);

  useEffect(() => {
    onOpenChange(resultsOpen || filtersOpen);
  }, [filtersOpen, onOpenChange, resultsOpen]);

  useEffect(() => {
    const control = controlRef.current;
    if (control === null) return;
    const update = () => {
      const rect = control.getBoundingClientRect();
      setPosition({ top: rect.bottom + 8, left: rect.left, width: rect.width });
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(control);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, []);

  const closeResults = () => {
    setResultsOpen(false);
    setActiveIndex(-1);
  };

  const chooseResult = (result: SearchResult) => {
    onSelectResult(result);
    closeResults();
  };

  const popup =
    resultsOpen || filtersOpen
      ? createPortal(
          <div
            className="floating-search__dropdown"
            style={{ position: "fixed", top: position.top, left: position.left, width: position.width }}
          >
            {resultsOpen ? (
              <div id={listboxId} role="listbox" aria-label={labels.results[locale]}>
                {visibleResults.length === 0 && value.trim() !== "" ? (
                  <p className="floating-search__no-matches">{labels.noMatches[locale]}</p>
                ) : null}
                {visibleResults.map((result, index) => (
                  <button
                    key={result.featureId}
                    id={`${id}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={result.featureId === selectedFeatureId}
                    className={index === activeIndex ? "floating-search__option floating-search__option--active" : "floating-search__option"}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseResult(result)}
                  >
                    <span>{result.label}</span>
                    <span>{result.featureType}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {filtersOpen ? (
              <div role="group" aria-label={labels.categories[locale]} className="floating-search__filters">
                {categories.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    aria-pressed={category === choice}
                    onClick={() => {
                      onCategoryChange(choice);
                      setFiltersOpen(false);
                    }}
                  >
                    {labels.category[choice][locale]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>,
          controlRef.current?.closest(".app") ?? document.body,
        )
      : null;

  return (
    <div className="floating-search">
      <div ref={controlRef} className="floating-search__control">
        <button
          type="button"
          className="floating-search__search-trigger"
          onClick={() => {
            inputRef.current?.focus();
            if (canOpenResults) setResultsOpen(true);
            setFiltersOpen(false);
          }}
        >
          {labels.search[locale]}
        </button>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label={labels.search[locale]}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={resultsOpen}
          aria-activedescendant={activeIndex < 0 ? undefined : `${id}-option-${activeIndex}`}
          placeholder={labels.placeholder[locale]}
          value={value}
          onFocus={() => {
            if (canOpenResults) setResultsOpen(true);
            setFiltersOpen(false);
          }}
          onChange={(event) => {
            const next = event.target.value;
            onValueChange(next);
            setFiltersOpen(false);
            setResultsOpen(next.trim() !== "" || category !== "all");
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // Chromium's native type=search Escape clears the field, and the
              // bubbled keydown would also close the selected-feature surface.
              event.preventDefault();
              event.stopPropagation();
              closeResults();
              setFiltersOpen(false);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              if (!canOpenResults || visibleResults.length === 0) return;
              event.preventDefault();
              setResultsOpen(true);
              setActiveIndex((current) => {
                if (event.key === "ArrowDown") return Math.min(current + 1, visibleResults.length - 1);
                return current <= 0 ? visibleResults.length - 1 : current - 1;
              });
              return;
            }
            if (event.key === "Enter" && activeIndex >= 0) {
              event.preventDefault();
              const result = visibleResults[activeIndex];
              if (result !== undefined) chooseResult(result);
            }
          }}
        />
        <button
          type="button"
          className="floating-search__filter-trigger"
          aria-expanded={filtersOpen}
          onClick={() => {
            closeResults();
            setFiltersOpen((open) => !open);
          }}
        >
          {labels.filter[locale]}
        </button>
      </div>
      {category !== "all" && currentFloorMatchCount === 0 ? (
        <div className="floating-search__no-floor-match">
          <span>
            {locale === "ja"
              ? `${labels.category[category].ja}は${labels.noFloor.ja}`
              : `No ${labels.category[category].en} ${labels.noFloor.en}`}
          </span>
          <button type="button" onClick={() => onCategoryChange("all")}>
            {labels.clearFilter[locale]}
          </button>
        </div>
      ) : null}
      {popup}
    </div>
  );
}
