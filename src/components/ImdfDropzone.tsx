import { useCallback, useState, type DragEvent } from "react";
import type { LocaleCode } from "../imdf/types";

const ui = {
  open: { ja: "IMDF ZIP を開く", en: "Open IMDF ZIP" },
  dropTitle: { ja: "IMDF ZIP をドロップ", en: "Drop an IMDF ZIP" },
  dropHint: {
    ja: "Apple 検証済みの IMDF .zip を選択またはドロップしてください。",
    en: "Choose or drop an Apple-validated IMDF .zip archive.",
  },
  loading: { ja: "読み込み中…", en: "Loading…" },
  replace: {
    ja: "ドロップして会場を差し替え",
    en: "Drop to replace venue",
  },
  retry: { ja: "再試行", en: "Retry" },
} as const;

function isZipFile(file: File | undefined): file is File {
  if (!file) {
    return false;
  }
  return file.name.toLowerCase().endsWith(".zip");
}

export interface ImdfDropzoneProps {
  locale: LocaleCode;
  status: "empty" | "loading" | "ready" | "error";
  fileName?: string;
  variant: "empty" | "overlay";
  onFile: (file: File) => void;
  /** Opens the parent-owned file picker (click / retry). */
  onOpenPicker: () => void;
}

export function ImdfDropzone({
  locale,
  status,
  fileName,
  variant,
  onFile,
  onOpenPicker,
}: ImdfDropzoneProps) {
  const [dragActive, setDragActive] = useState(false);

  const acceptFile = useCallback(
    (file: File | undefined) => {
      if (isZipFile(file)) {
        onFile(file);
      }
    },
    [onFile],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDragActive(false);
      const file = event.dataTransfer.files[0];
      acceptFile(file);
    },
    [acceptFile],
  );

  if (variant === "overlay") {
    return (
      <div
        className={
          dragActive
            ? "imdf-dropzone imdf-dropzone--overlay imdf-dropzone--active"
            : "imdf-dropzone imdf-dropzone--overlay"
        }
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="imdf-dropzone__overlay-card">
          <p className="imdf-dropzone__title">{ui.replace[locale]}</p>
          {status === "loading" && fileName ? (
            <p className="imdf-dropzone__progress">
              <span className="imdf-dropzone__spinner" aria-hidden="true" />
              <span>
                {ui.loading[locale]} {fileName}
              </span>
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        dragActive
          ? "imdf-dropzone imdf-dropzone--empty imdf-dropzone--active"
          : "imdf-dropzone imdf-dropzone--empty"
      }
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="imdf-dropzone__card">
        <p className="imdf-dropzone__title">{ui.dropTitle[locale]}</p>
        <p className="imdf-dropzone__hint">{ui.dropHint[locale]}</p>
        {status === "loading" && fileName ? (
          <p className="imdf-dropzone__progress">
            <span className="imdf-dropzone__spinner" aria-hidden="true" />
            <span>
              {ui.loading[locale]} {fileName}
            </span>
          </p>
        ) : (
          <button type="button" className="imdf-dropzone__open-btn" onClick={onOpenPicker}>
            {ui.open[locale]}
          </button>
        )}
        {status === "error" ? (
          <button type="button" className="imdf-dropzone__retry-btn" onClick={onOpenPicker}>
            {ui.retry[locale]}
          </button>
        ) : null}
      </div>
    </div>
  );
}
