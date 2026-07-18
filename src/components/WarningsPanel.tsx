import type { LocaleCode, ViewerWarning } from "../imdf/types";
import { IconAlertTriangle } from "./icons";

const ui = {
  empty: { ja: "警告はありません", en: "No warnings" },
} as const;

export interface WarningsPanelProps {
  warnings: ViewerWarning[];
  locale: LocaleCode;
}

/**
 * Kiriko Warnings panel body: loader warnings as icon rows — code as the
 * title line, message as the caption. Hosted inside a FloatingPanel.
 */
export function WarningsPanel({ warnings, locale }: WarningsPanelProps) {
  if (warnings.length === 0) {
    return <p className="warnings-panel__empty">{ui.empty[locale]}</p>;
  }
  return (
    <ul className="warnings-panel">
      {warnings.map((warning, index) => {
        const key = `${warning.code}-${warning.featureId ?? warning.archiveEntry ?? index}`;
        return (
          <li key={key} className="warning-row">
            <IconAlertTriangle size={16} className="warning-row__icon" />
            <div className="warning-row__text">
              <span className="warning-row__title">{warning.message}</span>
              <span className="warning-row__meta">
                {warning.code}
                {warning.featureId != null ? ` · ${warning.featureId}` : ""}
                {warning.archiveEntry != null ? ` · ${warning.archiveEntry}` : ""}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
