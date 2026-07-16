import type { LocaleCode } from "../imdf/types";
import type { CatalogEntry } from "../platform/types";

const ui = {
  heading: { ja: "データセット", en: "Datasets" },
  empty: {
    ja: "公開されたデータセットはまだありません。",
    en: "No datasets have been published yet.",
  },
  updated: { ja: "更新", en: "Updated" },
} as const;

const KIND_BADGE = { "venue-snapshot": "GDB", imdf: "IMDF" } as const;

function metaLine(entry: CatalogEntry, locale: LocaleCode): string {
  return locale === "ja"
    ? `${entry.levelCount} フロア / ${entry.featureCount} 地物`
    : `${entry.levelCount} levels / ${entry.featureCount} features`;
}

export interface DatasetGalleryProps {
  entries: CatalogEntry[];
  locale: LocaleCode;
  onOpen: (id: string) => void;
}

export function DatasetGallery({ entries, locale, onOpen }: DatasetGalleryProps) {
  return (
    <section className="dataset-gallery" aria-label={ui.heading[locale]}>
      <h2 className="dataset-gallery__heading">{ui.heading[locale]}</h2>
      {entries.length === 0 ? (
        <p className="dataset-gallery__empty">{ui.empty[locale]}</p>
      ) : (
        <ul className="dataset-gallery__list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="dataset-gallery__card"
                onClick={() => {
                  onOpen(entry.id);
                }}
              >
                <span className="dataset-gallery__kind">{KIND_BADGE[entry.kind]}</span>
                <span className="dataset-gallery__name">{entry.name}</span>
                <span className="dataset-gallery__meta">{metaLine(entry, locale)}</span>
                <span className="dataset-gallery__meta">
                  {ui.updated[locale]}: {new Date(entry.updatedAt).toLocaleDateString(
                    locale === "ja" ? "ja-JP" : "en-US",
                  )}
                  {" · "}
                  {entry.sourceName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
