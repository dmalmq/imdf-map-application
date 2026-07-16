import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { LocaleCode } from "../imdf/types";
import { login } from "../platform/catalogClient";
import type { AccountInfo } from "../platform/types";

const ui = {
  heading: { ja: "アカウントにサインイン", en: "Sign in to your account" },
  username: { ja: "ユーザー名", en: "Username" },
  password: { ja: "パスワード", en: "Password" },
  submit: { ja: "送信", en: "Submit" },
  cancel: { ja: "キャンセル", en: "Cancel" },
} as const;

export interface SignInDialogProps {
  open: boolean;
  locale: LocaleCode;
  onClose: () => void;
  onSignedIn: (account: AccountInfo) => void;
}

const HEADING_ID = "signin-dialog-title";

export function SignInDialog({ open, locale, onClose, onSignedIn }: SignInDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  // Mirrors `open` so an in-flight login resolving after close never fires
  // onSignedIn or mutates state behind the user's cancellation.
  const openRef = useRef(open);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Open modally (jsdom lacks showModal — fall back to the `open` property,
  // matching GdbImportDialog), reset the previous attempt's busy/error, and
  // focus the username input. App owns post-close focus.
  useEffect(() => {
    openRef.current = open;
    if (!open) {
      return;
    }
    setBusy(false);
    setError(null);
    const dialog = dialogRef.current;
    if (dialog) {
      if (typeof dialog.showModal === "function") {
        if (!dialog.open) dialog.showModal();
      } else {
        dialog.open = true;
      }
    }
    usernameRef.current?.focus();
  }, [open]);

  // Escape on a modal dialog fires a native `cancel` event; route it to
  // onClose and let React own the close, matching GdbImportDialog.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    void login(String(data.get("username") ?? ""), String(data.get("password") ?? ""))
      .then((account) => {
        if (!openRef.current) return;
        setBusy(false);
        onSignedIn(account);
      })
      .catch((caught: unknown) => {
        if (!openRef.current) return;
        setBusy(false);
        setError(caught instanceof Error ? caught.message : String(caught));
      });
  };

  return (
    <dialog ref={dialogRef} className="signin-dialog" aria-labelledby={HEADING_ID} onClose={onClose}>
      <form className="signin-dialog__form" aria-busy={busy} onSubmit={onSubmit}>
        <h2 id={HEADING_ID} className="signin-dialog__title">
          {ui.heading[locale]}
        </h2>
        <label className="signin-dialog__field">
          {ui.username[locale]}
          <input
            ref={usernameRef}
            className="signin-dialog__input"
            name="username"
            autoComplete="username"
            disabled={busy}
            required
          />
        </label>
        <label className="signin-dialog__field">
          {ui.password[locale]}
          <input
            className="signin-dialog__input"
            name="password"
            type="password"
            autoComplete="current-password"
            disabled={busy}
            required
          />
        </label>
        {error !== null ? (
          <p className="signin-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="signin-dialog__actions">
          <button type="button" className="signin-dialog__btn" onClick={onClose}>
            {ui.cancel[locale]}
          </button>
          <button
            type="submit"
            className="signin-dialog__btn signin-dialog__btn--primary"
            disabled={busy}
          >
            {ui.submit[locale]}
          </button>
        </div>
      </form>
    </dialog>
  );
}
