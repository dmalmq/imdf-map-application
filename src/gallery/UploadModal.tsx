import { useRef, useState, type DragEvent } from "react";
import type { LocaleCode } from "../imdf/types";
import { api } from "./api";
import { IconClose } from "../components/icons";

const ui = {
  title: { ja: "ローカルデータを開く", en: "Open local data" },
  dropTitle: { ja: "IMDF ZIP", en: "IMDF ZIP" },
  dropHint: { ja: "ドロップまたはクリックで選択", en: "Drop or click to choose" },
  nameLabel: { ja: "データセット名", en: "Dataset name" },
  publish: { ja: "公開", en: "Publish" },
  uploading: { ja: "アップロード中", en: "Uploading" },
  processing: { ja: "検証・公開処理中…", en: "Validating and publishing…" },
  published: { ja: "公開しました", en: "Published" },
  open: { ja: "開く", en: "Open" },
  close: { ja: "閉じる", en: "Close" },
  cancel: { ja: "キャンセル", en: "Cancel" },
} as const;

export interface UploadModalProps {
  locale: LocaleCode;
  onClose: () => void;
  onPublished: () => void;
}

type Phase =
  | { step: "form" }
  | { step: "uploading"; fraction: number }
  | { step: "processing" }
  | { step: "done"; slug: string }
  | { step: "failed"; message: string };

export function UploadModal({ locale, onClose, onPublished }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<Phase>({ step: "form" });
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFile = (candidate: File | undefined) => {
    if (!candidate || !candidate.name.toLowerCase().endsWith(".zip")) {
      return;
    }
    setFile(candidate);
    if (name === "") {
      setName(candidate.name.replace(/\.zip$/i, ""));
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    acceptFile(event.dataTransfer.files[0]);
  };

  const submit = () => {
    if (!file || name.trim() === "") {
      return;
    }
    setPhase({ step: "uploading", fraction: 0 });
    void (async () => {
      try {
        const venue = await api.createVenue(name.trim());
        const { jobId } = await api.uploadVersion(venue.id, file, (fraction) => {
          setPhase({ step: "uploading", fraction });
        });
        setPhase({ step: "processing" });
        const job = await api.waitForJob(jobId);
        if (job.status === "done") {
          setPhase({ step: "done", slug: venue.slug });
          onPublished();
        } else {
          setPhase({ step: "failed", message: job.error });
        }
      } catch (error) {
        setPhase({ step: "failed", message: error instanceof Error ? error.message : String(error) });
      }
    })();
  };

  const busy = phase.step === "uploading" || phase.step === "processing";

  return (
    <div className="modal-overlay">
      <div className="upload-modal" role="dialog" aria-label={ui.title[locale]}>
        <header className="upload-modal__header">
          <h2 className="upload-modal__title">{ui.title[locale]}</h2>
          <button type="button" className="floating-panel__close" aria-label={ui.close[locale]} onClick={onClose} disabled={busy}>
            <IconClose />
          </button>
        </header>

        {phase.step === "done" ? (
          <div className="upload-modal__done">
            <p className="upload-modal__published">{ui.published[locale]}</p>
            <div className="upload-modal__footer">
              <button type="button" className="btn-ghost" onClick={onClose}>
                {ui.close[locale]}
              </button>
              <a className="btn-primary" href={`/?dataset=${encodeURIComponent(phase.slug)}`}>
                {ui.open[locale]}
              </a>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              className={dragActive ? "drop-target drop-target--active" : "drop-target"}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => {
                setDragActive(false);
              }}
              onDrop={onDrop}
              disabled={busy}
            >
              <span className="drop-target__title">{file ? file.name : ui.dropTitle[locale]}</span>
              <span className="drop-target__hint">{ui.dropHint[locale]}</span>
            </button>
            <input
              ref={inputRef}
              className="imdf-dropzone__input"
              type="file"
              accept=".zip,application/zip"
              aria-label={ui.dropTitle[locale]}
              onChange={(event) => {
                acceptFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <label className="upload-modal__name">
              <span>{ui.nameLabel[locale]}</span>
              <div className="kiriko-input">
                <input
                  aria-label={ui.nameLabel[locale]}
                  value={name}
                  disabled={busy}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              </div>
            </label>

            {phase.step === "uploading" ? (
              <div className="upload-modal__progress">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.round(phase.fraction * 100)}%` }} />
                </div>
                <span>{ui.uploading[locale]}…</span>
              </div>
            ) : null}
            {phase.step === "processing" ? <p className="upload-modal__processing">{ui.processing[locale]}</p> : null}
            {phase.step === "failed" ? (
              <p className="upload-modal__error" role="alert">
                {phase.message}
              </p>
            ) : null}

            <div className="upload-modal__footer">
              <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
                {ui.cancel[locale]}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={submit}
                disabled={busy || !file || name.trim() === ""}
              >
                {ui.publish[locale]}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
