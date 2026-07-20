import type { LocaleCode } from "../imdf/types";
import { IconChevronLeft, KirikoMark } from "./icons";

const ui = {
  back: { ja: "ギャラリーへ戻る", en: "Back to gallery" },
} as const;

export interface ContextBarProps {
  /** Venue (dataset) display name. */
  venueName: string;
  /** Active floor short label, when a venue is loaded. */
  levelName: string | null;
  locale: LocaleCode;
}

/**
 * Kiriko ContextBar: floating top-left wayfinding — back to gallery, mark,
 * dataset name, separator dot, floor.
 */
export function ContextBar({ venueName, levelName, locale }: ContextBarProps) {
  return (
    <div className="context-bar">
      <a
        className="context-bar__back"
        href="/"
        aria-label={ui.back[locale]}
        title={ui.back[locale]}
      >
        <IconChevronLeft />
      </a>
      <KirikoMark className="context-bar__mark" />
      <span className="context-bar__name">{venueName}</span>
      {levelName !== null ? (
        <>
          <span className="context-bar__sep" aria-hidden="true" />
          <span className="context-bar__level">{levelName}</span>
        </>
      ) : null}
    </div>
  );
}
