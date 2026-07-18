import type { LocaleCode } from "../imdf/types";
import type { VenueSummary } from "./api";

const ui = {
  open: { ja: "開く", en: "Open" },
  delete: { ja: "削除", en: "Delete" },
  floors: { ja: "フロア", en: "floors" },
  features: { ja: "地物", en: "features" },
  processing: { ja: "処理中・未公開", en: "not published yet" },
} as const;

export interface DatasetCardProps {
  venue: VenueSummary;
  locale: LocaleCode;
  onOpen: () => void;
  onDelete: () => void;
}

export function DatasetCard({ venue, locale, onOpen, onDelete }: DatasetCardProps) {
  const stats = venue.latest?.stats ?? null;
  const date = (venue.latest?.createdAt ?? venue.createdAt).slice(0, 10);
  return (
    <article className="dataset-card">
      <button type="button" className="dataset-card__thumb" aria-hidden="true" tabIndex={-1} onClick={onOpen} />
      <div className="dataset-card__body">
        <h3 className="dataset-card__name">{venue.name}</h3>
        <div className="dataset-card__chips">
          <span className="chip">IMDF</span>
        </div>
        <p className="dataset-card__meta">
          {stats
            ? `${stats.levels} ${ui.floors[locale]} · ${stats.features.toLocaleString()} ${ui.features[locale]} · ${date}`
            : ui.processing[locale]}
        </p>
        <p className="dataset-card__slug">{venue.slug}</p>
      </div>
      <div className="dataset-card__actions">
        <button type="button" className="btn-ghost" onClick={onDelete} aria-label={`${ui.delete[locale]}: ${venue.name}`}>
          {ui.delete[locale]}
        </button>
        <button type="button" className="btn-primary" onClick={onOpen}>
          {ui.open[locale]}
        </button>
      </div>
    </article>
  );
}
