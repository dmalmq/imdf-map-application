import type { LocaleCode } from "../imdf/types";
import type { AccountInfo } from "../platform/types";

const ui = {
  signIn: { ja: "サインイン", en: "Sign in" },
  signOut: { ja: "サインアウト", en: "Sign out" },
} as const;

export interface AccountStatusProps {
  account: AccountInfo | null;
  locale: LocaleCode;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function AccountStatus({ account, locale, onSignIn, onSignOut }: AccountStatusProps) {
  if (account === null) {
    return (
      <button type="button" className="account-status__button" onClick={onSignIn}>
        {ui.signIn[locale]}
      </button>
    );
  }
  return (
    <div className="account-status">
      <span className="account-status__name">
        {account.username} ({account.role})
      </span>
      <button type="button" className="account-status__button" onClick={onSignOut}>
        {ui.signOut[locale]}
      </button>
    </div>
  );
}
