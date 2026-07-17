import { localizedLabel } from "../imdf/localize";
import type { LocaleCode, ViewerLevel } from "../imdf/types";

const ui = {
  group: { ja: "フロア", en: "Levels" },
} as const;

export interface FloorStackProps {
  levels: ViewerLevel[];
  selectedLevelId: string;
  locale: LocaleCode;
  manifestLanguage: string;
  onSelect: (levelId: string) => void;
}

/** Short floor label ("1F", "B1"); falls back to the full label. */
function shortLabelFor(
  level: ViewerLevel,
  locale: LocaleCode,
  manifestLanguage: string,
): string {
  const short = localizedLabel(level.shortName, locale, "", manifestLanguage);
  if (short !== "") {
    return short;
  }
  return localizedLabel(level.label, locale, level.id, manifestLanguage);
}

/**
 * Kiriko FloorStack: floating vertical stack of floor buttons on the map's
 * right edge; the active floor is an Ai Indigo fill.
 */
export function FloorStack({
  levels,
  selectedLevelId,
  locale,
  manifestLanguage,
  onSelect,
}: FloorStackProps) {
  return (
    <div className="floor-stack" role="group" aria-label={ui.group[locale]}>
      {levels.map((level) => {
        const selected = level.id === selectedLevelId;
        const label = shortLabelFor(level, locale, manifestLanguage);
        const full = localizedLabel(level.label, locale, level.id, manifestLanguage);
        return (
          <button
            key={level.id}
            type="button"
            className={selected ? "floor-stack__btn floor-stack__btn--active" : "floor-stack__btn"}
            aria-pressed={selected}
            aria-label={full}
            title={full}
            onClick={() => {
              onSelect(level.id);
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
