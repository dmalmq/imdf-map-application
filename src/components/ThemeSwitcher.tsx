import type { ThemeId } from "../theme/types";
import { themes } from "../theme/presets";
import type { LocaleCode } from "../imdf/types";

const THEME_IDS: ThemeId[] = ["tokyo-green", "customer-blue"];

const ui = {
  label: { ja: "テーマ", en: "Theme" },
} as const;

export interface ThemeSwitcherProps {
  themeId: ThemeId;
  locale: LocaleCode;
  onChange: (themeId: ThemeId) => void;
}

export function ThemeSwitcher({ themeId, locale, onChange }: ThemeSwitcherProps) {
  return (
    <div className="theme-switcher" role="group" aria-label={ui.label[locale]}>
      {THEME_IDS.map((id) => {
        const selected = id === themeId;
        return (
          <button
            key={id}
            type="button"
            className={selected ? "theme-switcher__btn theme-switcher__btn--active" : "theme-switcher__btn"}
            aria-pressed={selected}
            onClick={() => {
              onChange(id);
            }}
          >
            {themes[id].label}
          </button>
        );
      })}
    </div>
  );
}
