import { localizedLabel, pickLocalizedValue } from "../imdf/localize";
import type { LocaleCode, LoadedVenue, ViewerFeature, ViewerLevel } from "../imdf/types";

const ui = {
  title: { ja: "詳細", en: "Details" },
  type: { ja: "種別", en: "Type" },
  category: { ja: "カテゴリ", en: "Category" },
  level: { ja: "フロア", en: "Level" },
  accessibility: { ja: "アクセシビリティ", en: "Accessibility" },
  restriction: { ja: "制限", en: "Restriction" },
  hours: { ja: "営業時間", en: "Hours" },
  id: { ja: "ID", en: "ID" },
  altName: { ja: "別名", en: "Also known as" },
  copyLink: { ja: "リンクをコピー", en: "Copy link" },
  copied: { ja: "コピーしました", en: "Copied" },
} as const;

export interface InspectorPanelProps {
  feature: ViewerFeature;
  levels: ViewerLevel[];
  locale: LocaleCode;
  manifestLanguage: string;
  /** Copies a deep link to the current view; omitted when not linkable. */
  onCopyLink?: () => void;
  /** Transient feedback state owned by the caller. */
  copied?: boolean;
}

function levelLabelFor(
  feature: ViewerFeature,
  levels: ViewerLevel[],
  locale: LocaleCode,
  manifestLanguage: string,
): string | null {
  if (feature.levelId === null) {
    return null;
  }
  const level = levels.find((entry) => entry.id === feature.levelId);
  if (!level) {
    return null;
  }
  return localizedLabel(level.label, locale, level.id, manifestLanguage);
}

function hoursFromSource(feature: ViewerFeature): string | null {
  const hours = feature.sourceProperties.hours;
  return typeof hours === "string" && hours !== "" ? hours : null;
}

/**
 * Kiriko Inspector body: feature name, category line, attribute table with
 * mono values, optional copy-link footer. Hosted inside a FloatingPanel
 * whose title is the feature name, so this renders from the category line
 * down.
 */
export function InspectorPanel({
  feature,
  levels,
  locale,
  manifestLanguage,
  onCopyLink,
  copied,
}: InspectorPanelProps) {
  const primary = localizedLabel(feature.labels, locale, feature.id, manifestLanguage);
  const alt = pickLocalizedValue(feature.altLabels, locale, manifestLanguage);
  const levelLabel = levelLabelFor(feature, levels, locale, manifestLanguage);
  const hours = hoursFromSource(feature);

  const categoryLine = [feature.featureType, feature.category, levelLabel]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");

  return (
    <div className="inspector">
      <p className="inspector__kind">{categoryLine}</p>
      {alt !== null && alt !== primary ? (
        <p className="inspector__alt">
          <span>{ui.altName[locale]}</span> {alt}
        </p>
      ) : null}
      <div className="inspector__divider" aria-hidden="true" />
      <dl className="inspector__table" aria-label={ui.title[locale]}>
        <div className="inspector__row">
          <dt>{ui.type[locale]}</dt>
          <dd>{feature.featureType}</dd>
        </div>
        {feature.category !== null ? (
          <div className="inspector__row">
            <dt>{ui.category[locale]}</dt>
            <dd>{feature.category}</dd>
          </div>
        ) : null}
        {levelLabel !== null ? (
          <div className="inspector__row">
            <dt>{ui.level[locale]}</dt>
            <dd>{levelLabel}</dd>
          </div>
        ) : null}
        {feature.accessibility.length > 0 ? (
          <div className="inspector__row">
            <dt>{ui.accessibility[locale]}</dt>
            <dd>{feature.accessibility.join(", ")}</dd>
          </div>
        ) : null}
        {feature.restriction !== null ? (
          <div className="inspector__row">
            <dt>{ui.restriction[locale]}</dt>
            <dd>{feature.restriction}</dd>
          </div>
        ) : null}
        {hours !== null ? (
          <div className="inspector__row">
            <dt>{ui.hours[locale]}</dt>
            <dd>{hours}</dd>
          </div>
        ) : null}
        <div className="inspector__row">
          <dt>{ui.id[locale]}</dt>
          <dd>{feature.id}</dd>
        </div>
      </dl>
      {onCopyLink !== undefined ? (
        <div className="inspector__footer">
          <button type="button" className="btn-ghost" onClick={onCopyLink}>
            {copied === true ? ui.copied[locale] : ui.copyLink[locale]}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Convenience: resolve selected feature from venue state. */
export function resolveSelectedFeature(
  venue: LoadedVenue,
  selectedFeatureId: string | null,
): ViewerFeature | null {
  if (selectedFeatureId === null) {
    return null;
  }
  return venue.featuresById.get(selectedFeatureId) ?? null;
}
