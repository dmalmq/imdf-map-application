import { venueLoadErrorCopy } from "../errors/VenueLoadError";
import type { VenueLoadError } from "../errors/VenueLoadError";
import type { LocaleCode } from "../imdf/types";

const ui = {
  errorTitle: { ja: "読み込みに失敗しました", en: "Could not load archive" },
  retry: { ja: "再試行", en: "Retry" },
} as const;

export interface ViewerErrorNoticeProps {
  error: VenueLoadError;
  locale: LocaleCode;
  onRetry?: () => void;
}

export function ViewerErrorNotice({ error, locale, onRetry }: ViewerErrorNoticeProps) {
  const copy = venueLoadErrorCopy[error.code];
  return (
    <div className="viewer-notice viewer-notice--error" role="alert">
      <p className="viewer-notice__title">{ui.errorTitle[locale]}</p>
      <p className="viewer-notice__body">{copy}</p>
      {onRetry ? (
        <button type="button" className="viewer-notice__retry" onClick={onRetry}>
          {ui.retry[locale]}
        </button>
      ) : null}
    </div>
  );
}
