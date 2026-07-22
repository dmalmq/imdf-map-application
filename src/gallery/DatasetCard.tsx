import type { LocaleCode } from "../imdf/types";
import type { VenueSummary } from "./api";

const ui = {
  open: { ja: "開く", en: "Open" },
  delete: { ja: "削除", en: "Delete" },
  uploadImdf: { ja: "IMDF をアップロード", en: "Upload IMDF" },
  importGdb: { ja: "GDB を取り込む", en: "Import GDB" },
  addData: { ja: "経路・地点データを追加", en: "Add routing / facilities" },
  editMapping: { ja: "マッピングを編集", en: "Edit mapping" },
  floors: { ja: "フロア", en: "floors" },
  features: { ja: "地物", en: "features" },
  processing: { ja: "処理中・未公開", en: "not published yet" },
} as const;

export interface DatasetCardProps {
  venue: VenueSummary;
  locale: LocaleCode;
  onOpen: () => void;
  onDelete: () => void;
  onImportGdb?: () => void;
  onAddData?: () => void;
  onEditMapping?: () => void;
  onUploadImdf?: () => void;
}

export function DatasetCard({
  venue,
  locale,
  onOpen,
  onDelete,
  onImportGdb,
  onAddData,
  onEditMapping,
  onUploadImdf,
}: DatasetCardProps) {
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
        {onUploadImdf ? (
          <button type="button" className="btn-ghost" onClick={onUploadImdf}>
            {ui.uploadImdf[locale]}
          </button>
        ) : null}
        {onImportGdb ? (
          <button type="button" className="btn-ghost" onClick={onImportGdb}>
            {ui.importGdb[locale]}
          </button>
        ) : null}
        {onAddData ? (
          <button type="button" className="btn-ghost" onClick={onAddData}>
            {ui.addData[locale]}
          </button>
        ) : null}
        {onEditMapping ? (
          <button type="button" className="btn-ghost" onClick={onEditMapping}>
            {ui.editMapping[locale]}
          </button>
        ) : null}
        <button type="button" className="btn-primary" onClick={onOpen}>
          {ui.open[locale]}
        </button>
      </div>
    </article>
  );
}
