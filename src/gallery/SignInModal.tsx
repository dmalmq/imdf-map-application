import { useState, type FormEvent } from "react";
import { KirikoMark } from "../components/icons";
import type { LocaleCode } from "../imdf/types";
import { api, ApiError } from "./api";

const ui = {
  title: { ja: "Kiriko にサインイン", en: "Sign in to Kiriko" },
  username: { ja: "ユーザー名", en: "Username" },
  password: { ja: "パスワード", en: "Password" },
  submit: { ja: "サインイン", en: "Sign in" },
  wrong: {
    ja: "ユーザー名またはパスワードが違います",
    en: "Wrong username or password.",
  },
  failed: { ja: "サインインに失敗しました", en: "Sign-in failed" },
} as const;

export interface SignInModalProps {
  locale: LocaleCode;
  onSignedIn: () => void;
}

export function SignInModal({ locale, onSignedIn }: SignInModalProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    api
      .login(username, password)
      .then(() => {
        onSignedIn();
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError && err.status === 401 ? ui.wrong[locale] : ui.failed[locale]);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="modal-overlay">
      <form className="signin-card" onSubmit={onSubmit} aria-label={ui.title[locale]}>
        <div className="signin-card__brand">
          <KirikoMark size={32} className="signin-card__mark" />
          <h2 className="signin-card__title">{ui.title[locale]}</h2>
        </div>
        <div className="kiriko-input">
          <input
            aria-label={ui.username[locale]}
            placeholder={ui.username[locale]}
            autoComplete="username"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
          />
        </div>
        <div className="kiriko-input">
          <input
            type="password"
            aria-label={ui.password[locale]}
            placeholder={ui.password[locale]}
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </div>
        {error !== null ? (
          <p className="signin-card__error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn-primary signin-card__submit" disabled={busy}>
          {ui.submit[locale]}
        </button>
      </form>
    </div>
  );
}
