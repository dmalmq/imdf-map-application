import { useState } from "react";
import type { LocaleCode } from "../imdf/types";
import type { ResolvedFeatureContent } from "./resolveSelectedFeatureContent";

const ui = {
  category: { ja: "カテゴリ", en: "Category" },
  floor: { ja: "フロア", en: "Floor" },
  hours: { ja: "営業時間", en: "Hours" },
  accessibility: { ja: "アクセシビリティ", en: "Accessibility" },
  phone: { ja: "電話", en: "Phone" },
  website: { ja: "ウェブサイト", en: "Website" },
  sourceData: { ja: "元データ", en: "Source data" },
  close: { ja: "詳細を閉じる", en: "Close details" },
} as const;

export interface SelectedFeatureContentProps {
  content: ResolvedFeatureContent;
  locale: LocaleCode;
  onClose: () => void;
}

function FeatureImage({ image }: { image: NonNullable<ResolvedFeatureContent["image"]> }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className="selected-feature__media">
      <img
        src={new URL(image.src, window.location.origin).href}
        alt={image.alt}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

export function SelectedFeatureContent({
  content,
  locale,
  onClose,
}: SelectedFeatureContentProps) {
  return (
    <article className="selected-feature">
      <button
        type="button"
        className="selected-feature__close"
        aria-label={ui.close[locale]}
        onClick={onClose}
      >
        ×
      </button>
      {content.image === null ? null : <FeatureImage key={content.image.src} image={content.image} />}
      <h2 className="selected-feature__heading">{content.name}</h2>
      {content.description === null ? null : (
        <p className="selected-feature__description">{content.description}</p>
      )}
      {content.sourceAttributes !== null ? (
        <>
          <p className="selected-feature__provenance">{content.provenance}</p>
          <div
            className="selected-feature__attributes-scroll"
            aria-label={ui.sourceData[locale]}
            tabIndex={0}
          >
            <table className="selected-feature__attributes">
              <caption className="selected-feature__attributes-caption">
                {ui.sourceData[locale]}
              </caption>
              <tbody>
                {content.sourceAttributes.map((attribute) => (
                  <tr key={attribute.field}>
                    <th scope="row">{attribute.field}</th>
                    <td>{attribute.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <dl className="selected-feature__details">
          {content.category === null ? null : (
            <div>
              <dt>{ui.category[locale]}</dt>
              <dd>{content.category}</dd>
            </div>
          )}
          {content.floor === null ? null : (
            <div>
              <dt>{ui.floor[locale]}</dt>
              <dd>{content.floor}</dd>
            </div>
          )}
          {content.hours === null ? null : (
            <div>
              <dt>{ui.hours[locale]}</dt>
              <dd>{content.hours}</dd>
            </div>
          )}
          {content.accessibility.length === 0 ? null : (
            <div>
              <dt>{ui.accessibility[locale]}</dt>
              <dd>{content.accessibility.join(", ")}</dd>
            </div>
          )}
          {content.phone === null ? null : (
            <div>
              <dt>{ui.phone[locale]}</dt>
              <dd>
                <a href={`tel:${content.phone}`}>{content.phone}</a>
              </dd>
            </div>
          )}
          {content.website === null ? null : (
            <div>
              <dt>{ui.website[locale]}</dt>
              <dd>
                <a href={content.website} target="_blank" rel="noreferrer">
                  {ui.website[locale]}
                </a>
              </dd>
            </div>
          )}
        </dl>
      )}
    </article>
  );
}
