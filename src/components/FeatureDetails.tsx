import { localizedLabel, pickLocalizedValue } from "../imdf/localize";
import type { LocaleCode, LoadedVenue, ViewerFeature, ViewerLevel } from "../imdf/types";

const ui = {
  title: { ja: "詳細", en: "Details" },
  empty: {
    ja: "地図または検索結果から地物を選択してください。",
    en: "Select a feature on the map or from search results.",
  },
  type: { ja: "種別", en: "Type" },
  category: { ja: "カテゴリ", en: "Category" },
  level: { ja: "フロア", en: "Level" },
  accessibility: { ja: "アクセシビリティ", en: "Accessibility" },
  restriction: { ja: "制限", en: "Restriction" },
  hours: { ja: "営業時間", en: "Hours" },
  id: { ja: "ID", en: "ID" },
  altName: { ja: "別名", en: "Also known as" },
} as const;

export interface FeatureDetailsProps {
  feature: ViewerFeature | null;
  levels: ViewerLevel[];
  locale: LocaleCode;
  manifestLanguage: string;
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

export function FeatureDetails({ feature, levels, locale, manifestLanguage }: FeatureDetailsProps) {
  if (feature === null) {
    return (
      <section className="feature-details" aria-label={ui.title[locale]}>
        <h2 className="feature-details__heading">{ui.title[locale]}</h2>
        <p className="feature-details__empty">{ui.empty[locale]}</p>
      </section>
    );
  }

  const primary = localizedLabel(feature.labels, locale, feature.id, manifestLanguage);
  const alt = pickLocalizedValue(feature.altLabels, locale, manifestLanguage);
  const levelLabel = levelLabelFor(feature, levels, locale, manifestLanguage);
  const hours = hoursFromSource(feature);

  return (
    <section className="feature-details" aria-label={ui.title[locale]}>
      <h2 className="feature-details__heading">{ui.title[locale]}</h2>
      <p className="feature-details__name">{primary}</p>
      {alt !== null && alt !== primary ? (
        <p className="feature-details__alt">
          <span className="feature-details__key">{ui.altName[locale]}</span>
          <span>{alt}</span>
        </p>
      ) : null}
      <dl className="feature-details__list">
        <div className="feature-details__row">
          <dt>{ui.type[locale]}</dt>
          <dd>{feature.featureType}</dd>
        </div>
        {feature.category !== null ? (
          <div className="feature-details__row">
            <dt>{ui.category[locale]}</dt>
            <dd>{feature.category}</dd>
          </div>
        ) : null}
        {levelLabel !== null ? (
          <div className="feature-details__row">
            <dt>{ui.level[locale]}</dt>
            <dd>{levelLabel}</dd>
          </div>
        ) : null}
        {feature.accessibility.length > 0 ? (
          <div className="feature-details__row">
            <dt>{ui.accessibility[locale]}</dt>
            <dd>{feature.accessibility.join(", ")}</dd>
          </div>
        ) : null}
        {feature.restriction !== null ? (
          <div className="feature-details__row">
            <dt>{ui.restriction[locale]}</dt>
            <dd>{feature.restriction}</dd>
          </div>
        ) : null}
        {hours !== null ? (
          <div className="feature-details__row">
            <dt>{ui.hours[locale]}</dt>
            <dd>{hours}</dd>
          </div>
        ) : null}
        <div className="feature-details__row">
          <dt>{ui.id[locale]}</dt>
          <dd className="feature-details__id">{feature.id}</dd>
        </div>
      </dl>
    </section>
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
