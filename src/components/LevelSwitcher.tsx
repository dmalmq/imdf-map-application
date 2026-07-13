import { localizedLabel } from "../imdf/localize";
import type { LocaleCode, ViewerLevel } from "../imdf/types";

const ui = {
  group: { ja: "フロア", en: "Levels" },
} as const;

export interface LevelSwitcherProps {
  levels: ViewerLevel[];
  selectedLevelId: string;
  locale: LocaleCode;
  manifestLanguage: string;
  onSelect: (levelId: string) => void;
}

export function LevelSwitcher({
  levels,
  selectedLevelId,
  locale,
  manifestLanguage,
  onSelect,
}: LevelSwitcherProps) {
  return (
    <div className="level-switcher" role="group" aria-label={ui.group[locale]}>
      <div className="level-switcher__scroller">
        {levels.map((level) => {
          const selected = level.id === selectedLevelId;
          const label = localizedLabel(level.label, locale, level.id, manifestLanguage);
          return (
            <button
              key={level.id}
              type="button"
              className={selected ? "level-switcher__pill level-switcher__pill--active" : "level-switcher__pill"}
              aria-pressed={selected}
              onClick={() => {
                onSelect(level.id);
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
