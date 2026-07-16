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
  gdbArchive: { ja: "GDB アーカイブを開く", en: "Open GDB archive(s)" },
  gdbFolder: { ja: "GDB フォルダを開く", en: "Open GDB folder" },
  gdbFolderUnsupported: {
    ja: "このブラウザーはフォルダ選択に対応していません。各 .gdb を ZIP 化して「GDB アーカイブを開く」をご利用ください。",
    en: "This browser cannot pick folders. Zip each .gdb and use Open GDB archive(s).",
  },
} as const;

/**
 * A dropped selection is accepted only as exactly one IMDF `.zip` (not a
 * `.gdb.zip`) or one-or-more files that all end `.gdb.zip`; App disambiguates
 * which loader runs. Any other mixture returns null and is ignored.
 */
function acceptedDrop(files: readonly File[]): readonly File[] | null {
  if (files.length === 0) {
    return null;
  }
  if (files.every((file) => file.name.toLowerCase().endsWith(".gdb.zip"))) {
    return files;
  }
  if (files.length === 1 && files[0]!.name.toLowerCase().endsWith(".zip")) {
    return files;
  }
  return null;
}

export interface ImdfDropzoneProps {
  locale: LocaleCode;
  status: "empty" | "loading" | "ready" | "error";
  fileName?: string;
  variant: "empty" | "overlay";
  onFiles: (files: readonly File[]) => void;
  /** Opens the parent-owned file picker (click / retry). */
  onOpenPicker: () => void;
  onOpenGdbArchives: () => void;
  onOpenGdbFolder: () => void;
  /** Directory picking needs `webkitdirectory`; hide the folder control when
   * the browser lacks it. Defaults to shown. */
  gdbFolderSupported?: boolean;
}

export function ImdfDropzone({
  locale,
  status,
  fileName,
  variant,
  onFiles,
  onOpenPicker,
  onOpenGdbArchives,
  onOpenGdbFolder,
  gdbFolderSupported = true,
}: ImdfDropzoneProps) {
  const [dragActive, setDragActive] = useState(false);

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
      const accepted = acceptedDrop(Array.from(event.dataTransfer.files));
      if (accepted) {
        onFiles(accepted);
      }
    },
    [onFiles],
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
        <button type="button" className="imdf-dropzone__open-btn" onClick={onOpenGdbArchives}>
          {ui.gdbArchive[locale]}
        </button>
        {gdbFolderSupported ? (
          <button type="button" className="imdf-dropzone__open-btn" onClick={onOpenGdbFolder}>
            {ui.gdbFolder[locale]}
          </button>
        ) : (
          <p className="imdf-dropzone__hint">{ui.gdbFolderUnsupported[locale]}</p>
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
