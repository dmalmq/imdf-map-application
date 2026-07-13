import type { LocaleCode } from "../imdf/types";
import type { SearchCategory } from "../search/searchVenue";

const CATEGORIES: SearchCategory[] = ["all", "gates", "shops", "facilities"];

const labels: Record<SearchCategory, Record<LocaleCode, string>> = {
  all: { ja: "すべて", en: "All" },
  gates: { ja: "改札・出入口", en: "Gates" },
  shops: { ja: "店舗", en: "Shops" },
  facilities: { ja: "設備", en: "Facilities" },
};

const ui = {
  group: { ja: "カテゴリ", en: "Category" },
} as const;

export interface CategoryChipsProps {
  category: SearchCategory;
  locale: LocaleCode;
  onChange: (category: SearchCategory) => void;
}

export function CategoryChips({ category, locale, onChange }: CategoryChipsProps) {
  return (
    <div className="category-chips" role="group" aria-label={ui.group[locale]}>
      {CATEGORIES.map((id) => {
        const selected = id === category;
        return (
          <button
            key={id}
            type="button"
            className={selected ? "category-chips__chip category-chips__chip--active" : "category-chips__chip"}
            aria-pressed={selected}
            onClick={() => {
              onChange(id);
            }}
          >
            {labels[id][locale]}
          </button>
        );
      })}
    </div>
  );
}
