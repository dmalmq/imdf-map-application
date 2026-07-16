import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LocaleCode } from "../imdf/types";
import type { ThemeId } from "../theme/types";
import { ThemeSwitcher } from "./ThemeSwitcher";

const ui = {
  menu: { ja: "メニュー", en: "Menu" },
  panel: { ja: "ビューアーメニュー", en: "Viewer menu" },
  language: { ja: "言語", en: "Language" },
  japanese: { ja: "日本語", en: "日本語" },
  english: { ja: "English", en: "English" },
  open: { ja: "IMDF ZIP を開く", en: "Open IMDF ZIP" },
  gdbArchive: { ja: "GDB アーカイブを開く", en: "Open GDB archive(s)" },
  gdbFolder: { ja: "GDB フォルダを開く", en: "Open GDB folder" },
  gdbFolderUnsupported: {
    ja: "このブラウザーはフォルダ選択に対応していません。各 .gdb を ZIP 化して「GDB アーカイブを開く」をご利用ください。",
    en: "This browser cannot pick folders. Zip each .gdb and use Open GDB archive(s).",
  },
} as const;

export interface ViewerMenuProps {
  venueName: string;
  floorName: string | null;
  locale: LocaleCode;
  themeId: ThemeId;
  showFileControls: boolean;
  onLocaleChange: (locale: LocaleCode) => void;
  onThemeChange: (themeId: ThemeId) => void;
  onOpenFile: () => void;
  onOpenGdbArchives: () => void;
  onOpenGdbFolder: () => void;
  gdbFolderSupported?: boolean;
  onOpenChange: (open: boolean) => void;
  accountSlot?: ReactNode;
}

export function ViewerMenu({
  venueName,
  floorName,
  locale,
  themeId,
  showFileControls,
  onLocaleChange,
  onThemeChange,
  onOpenFile,
  onOpenGdbArchives,
  onOpenGdbFolder,
  gdbFolderSupported = true,
  onOpenChange,
  accountSlot,
}: ViewerMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const close = useCallback(() => {
    setOpen(false);
    onOpenChange(false);
    triggerRef.current?.focus();
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect !== undefined) {
        setPosition({
          top: rect.bottom + 8,
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)),
        });
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    update();
    document.addEventListener("click", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      document.removeEventListener("click", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [close, open]);

  return (
    <div className="viewer-menu">
      <button
        ref={triggerRef}
        type="button"
        className="viewer-menu__trigger"
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else {
            setOpen(true);
            onOpenChange(true);
          }
        }}
      >
        {ui.menu[locale]}
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={ui.panel[locale]}
              className="viewer-menu__panel"
              style={{ position: "fixed", top: position.top, left: position.left }}
            >
              <div className="viewer-menu__meta">
                <strong>{venueName}</strong>
                {floorName === null ? null : <span>{floorName}</span>}
              </div>
              <div role="group" aria-label={ui.language[locale]} className="viewer-menu__locale">
                <button
                  type="button"
                  aria-pressed={locale === "ja"}
                  onClick={() => onLocaleChange("ja")}
                >
                  {ui.japanese[locale]}
                </button>
                <button
                  type="button"
                  aria-pressed={locale === "en"}
                  onClick={() => onLocaleChange("en")}
                >
                  {ui.english[locale]}
                </button>
              </div>
              <ThemeSwitcher themeId={themeId} locale={locale} onChange={onThemeChange} />
              {showFileControls ? (
                <>
                  <button type="button" className="viewer-menu__open" onClick={onOpenFile}>
                    {ui.open[locale]}
                  </button>
                  <button
                    type="button"
                    className="viewer-menu__open"
                    onClick={onOpenGdbArchives}
                  >
                    {ui.gdbArchive[locale]}
                  </button>
                  {gdbFolderSupported ? (
                    <button
                      type="button"
                      className="viewer-menu__open"
                      onClick={onOpenGdbFolder}
                    >
                      {ui.gdbFolder[locale]}
                    </button>
                  ) : (
                    <p className="viewer-menu__hint">{ui.gdbFolderUnsupported[locale]}</p>
                  )}
                </>
              ) : null}
              {accountSlot !== undefined ? (
                <div className="viewer-menu__account">{accountSlot}</div>
              ) : null}
            </div>,
            triggerRef.current?.closest(".app") ?? document.body,
          )
        : null}
    </div>
  );
}
