import type { LocaleCode } from "../imdf/types";

const ui = {
  title: { ja: "データセットを削除", en: "Delete dataset" },
  body: {
    ja: "は完全に削除されます。この操作は取り消せません。",
    en: "will be permanently deleted. This cannot be undone.",
  },
  cancel: { ja: "キャンセル", en: "Cancel" },
  confirm: { ja: "削除", en: "Delete" },
} as const;

export interface ConfirmDeleteModalProps {
  locale: LocaleCode;
  venueName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDeleteModal({ locale, venueName, onConfirm, onCancel }: ConfirmDeleteModalProps) {
  return (
    <div className="modal-overlay">
      <div className="confirm-modal" role="alertdialog" aria-label={ui.title[locale]}>
        <h2 className="confirm-modal__title">{ui.title[locale]}</h2>
        <p className="confirm-modal__body">
          <strong>{venueName}</strong> {ui.body[locale]}
        </p>
        <div className="confirm-modal__footer">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            {ui.cancel[locale]}
          </button>
          <button type="button" className="btn-destructive" onClick={onConfirm}>
            {ui.confirm[locale]}
          </button>
        </div>
      </div>
    </div>
  );
}
