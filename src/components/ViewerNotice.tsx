import { archiveErrorCopy } from "../errors/ArchiveError";
import type { ArchiveError } from "../errors/ArchiveError";
import type { LocaleCode, ViewerWarning } from "../imdf/types";

const ui = {
  errorTitle: { ja: "読み込みに失敗しました", en: "Could not load archive" },
  warnings: { ja: "警告", en: "Warnings" },
  retry: { ja: "再試行", en: "Retry" },
} as const;

export interface ViewerErrorNoticeProps {
  error: ArchiveError;
  locale: LocaleCode;
  onRetry?: () => void;
}

export function ViewerErrorNotice({ error, locale, onRetry }: ViewerErrorNoticeProps) {
  const copy = archiveErrorCopy[error.code];
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

export interface ViewerWarningsProps {
  warnings: ViewerWarning[];
  locale: LocaleCode;
}

export function ViewerWarnings({ warnings, locale }: ViewerWarningsProps) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <details className="viewer-warnings">
      <summary className="viewer-warnings__summary">
        <span>{ui.warnings[locale]}</span>
        <span className="viewer-warnings__badge" aria-label={`${warnings.length}`}>
          {warnings.length}
        </span>
      </summary>
      <ul className="viewer-warnings__list">
        {warnings.map((warning, index) => {
          const key = `${warning.code}-${warning.featureId ?? warning.archiveEntry ?? index}`;
          return (
            <li key={key} className="viewer-warnings__item">
              <span className="viewer-warnings__code">{warning.code}</span>
              <span className="viewer-warnings__message">{warning.message}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
