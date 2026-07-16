import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { LoadedVenue, LocaleCode } from "../imdf/types";
import { writeVenueSnapshot } from "../imdf/venueSnapshot";
import { datasetViewUrl, publishDataset, slugifyDatasetId } from "../platform/catalogClient";
import type { CatalogEntry, DatasetKind } from "../platform/types";

const ui = {
  heading: { ja: "データセットを公開", en: "Publish dataset" },
  name: { ja: "表示名", en: "Display name" },
  id: { ja: "データセットID", en: "Dataset ID" },
  overwrite: {
    ja: "このIDは既に存在します。公開すると既存のデータセットを置き換えます。",
    en: "This ID already exists. Publishing will replace the existing dataset.",
  },
  publish: { ja: "公開", en: "Publish" },
  close: { ja: "閉じる", en: "Close" },
  publishing: { ja: "公開中…", en: "Publishing…" },
  done: { ja: "公開しました", en: "Published" },
  viewUrl: { ja: "表示URL", en: "View URL" },
  embedUrl: { ja: "埋め込みURL", en: "Embed URL" },
  copy: { ja: "コピー", en: "Copy" },
  invalidId: {
    ja: "IDは英小文字・数字・ハイフン（64文字以内）です。",
    en: "IDs are lowercase letters, digits, and hyphens (max 64 chars).",
  },
} as const;

/** Client-side mirror of the server's dataset id rule. */
const DATASET_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface PublishDialogProps {
  venue: LoadedVenue;
  defaultName: string;
  sourceName: string;
  kind: DatasetKind;
  imdfFile: File | null;
  existingIds: readonly string[];
  locale: LocaleCode;
  onClose: () => void;
  onPublished: (entry: CatalogEntry) => void;
}

const HEADING_ID = "publish-dialog-title";

export function PublishDialog({
  venue,
  defaultName,
  sourceName,
  kind,
  imdfFile,
  existingIds,
  locale,
  onClose,
  onPublished,
}: PublishDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const attemptRef = useRef(0);
  const [name, setName] = useState(defaultName);
  const [id, setId] = useState(() => slugifyDatasetId(defaultName));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<CatalogEntry | null>(null);

  // Open modally (jsdom lacks showModal — fall back to the `open` property,
  // matching SignInDialog/GdbImportDialog) and focus the name input once.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.open = true;
      }
    }
    nameRef.current?.focus();
  }, []);

  // A publish settling after unmount must not touch state or fire callbacks.
  useEffect(
    () => () => {
      attemptRef.current += 1;
    },
    [],
  );

  // Escape on a modal dialog fires a native `cancel` event; route it to
  // onClose and let React own the close, matching SignInDialog. Closing
  // invalidates any in-flight publish so a late completion is ignored.
  const requestClose = () => {
    attemptRef.current += 1;
    setBusy(false);
    onClose();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    const handleCancel = (event: Event) => {
      event.preventDefault();
      requestClose();
    };
    dialog.addEventListener("cancel", handleCancel);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
    };
  }, [onClose]);

  const idValid = DATASET_ID_RE.test(id);
  const overwrite = idValid && existingIds.includes(id);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!idValid || name.trim() === "" || busy) {
      return;
    }
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    setBusy(true);
    setError(null);
    void (async () => {
      const data =
        kind === "imdf" && imdfFile !== null
          ? imdfFile
          : await writeVenueSnapshot(venue, sourceName);
      return publishDataset(
        {
          id,
          name,
          kind,
          levelCount: venue.levels.length,
          featureCount: venue.featuresById.size,
          sourceName,
        },
        data,
      );
    })()
      .then((entry) => {
        if (attempt !== attemptRef.current) {
          return;
        }
        setBusy(false);
        setPublished(entry);
        onPublished(entry);
      })
      .catch((caught: unknown) => {
        if (attempt !== attemptRef.current) {
          return;
        }
        setBusy(false);
        setError(caught instanceof Error ? caught.message : String(caught));
      });
  };

  return (
    <dialog
      ref={dialogRef}
      className="publish-dialog"
      aria-labelledby={HEADING_ID}
      onClose={requestClose}
    >
      {published === null ? (
        <form className="publish-dialog__form" aria-busy={busy} onSubmit={onSubmit}>
          <h2 id={HEADING_ID} className="publish-dialog__title">
            {ui.heading[locale]}
          </h2>
          <label className="publish-dialog__field">
            {ui.name[locale]}
            <input
              ref={nameRef}
              className="publish-dialog__input"
              value={name}
              required
              maxLength={120}
              disabled={busy}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          <label className="publish-dialog__field">
            {ui.id[locale]}
            <input
              className="publish-dialog__input"
              value={id}
              required
              disabled={busy}
              onChange={(event) => {
                setId(event.target.value);
              }}
            />
          </label>
          {!idValid && id !== "" ? (
            <p className="publish-dialog__warning">{ui.invalidId[locale]}</p>
          ) : null}
          {overwrite ? <p className="publish-dialog__warning">{ui.overwrite[locale]}</p> : null}
          {error !== null ? (
            <p className="publish-dialog__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="publish-dialog__actions">
            <button type="button" className="publish-dialog__btn" onClick={requestClose}>
              {ui.close[locale]}
            </button>
            <button
              type="submit"
              className="publish-dialog__btn publish-dialog__btn--primary"
              disabled={busy || !idValid || name.trim() === ""}
            >
              {busy ? ui.publishing[locale] : ui.publish[locale]}
            </button>
          </div>
        </form>
      ) : (
        <div className="publish-dialog__success">
          <h2 id={HEADING_ID} className="publish-dialog__title">
            {ui.done[locale]}
          </h2>
          <label className="publish-dialog__field">
            {ui.viewUrl[locale]}
            <input className="publish-dialog__input" readOnly value={datasetViewUrl(published.id)} />
          </label>
          <button
            type="button"
            className="publish-dialog__btn"
            onClick={() => {
              void navigator.clipboard?.writeText(datasetViewUrl(published.id));
            }}
          >
            {ui.copy[locale]}
          </button>
          <label className="publish-dialog__field">
            {ui.embedUrl[locale]}
            <input
              className="publish-dialog__input"
              readOnly
              value={datasetViewUrl(published.id, true)}
            />
          </label>
          <button
            type="button"
            className="publish-dialog__btn"
            onClick={() => {
              void navigator.clipboard?.writeText(datasetViewUrl(published.id, true));
            }}
          >
            {ui.copy[locale]}
          </button>
          <div className="publish-dialog__actions">
            <button type="button" className="publish-dialog__btn" onClick={requestClose}>
              {ui.close[locale]}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
