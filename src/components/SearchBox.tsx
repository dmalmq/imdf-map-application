import type { LocaleCode } from "../imdf/types";

const ui = {
  label: { ja: "検索", en: "Search" },
  placeholder: { ja: "施設・店舗を検索", en: "Search places" },
  clear: { ja: "クリア", en: "Clear" },
} as const;

export interface SearchBoxProps {
  value: string;
  locale: LocaleCode;
  onChange: (text: string) => void;
}

export function SearchBox({ value, locale, onChange }: SearchBoxProps) {
  const inputId = "viewer-search-input";
  return (
    <div className="search-box">
      <label className="search-box__label" htmlFor={inputId}>
        {ui.label[locale]}
      </label>
      <div className="search-box__row">
        <input
          id={inputId}
          className="search-box__input"
          type="search"
          value={value}
          placeholder={ui.placeholder[locale]}
          autoComplete="off"
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        {value !== "" ? (
          <button
            type="button"
            className="search-box__clear"
            aria-label={ui.clear[locale]}
            onClick={() => {
              onChange("");
            }}
          >
            {ui.clear[locale]}
          </button>
        ) : null}
      </div>
    </div>
  );
}
