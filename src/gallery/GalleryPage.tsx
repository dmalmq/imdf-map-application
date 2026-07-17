import { useCallback, useEffect, useState } from "react";
import { KirikoMark } from "../components/icons";
import type { LocaleCode } from "../imdf/types";
import { api, type ApiUser, type VenueSummary } from "./api";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { DatasetCard } from "./DatasetCard";
import { SignInModal } from "./SignInModal";
import { UploadModal } from "./UploadModal";

const ui = {
  datasets: { ja: "データセット", en: "Datasets" },
  filter: { ja: "データセットを検索…", en: "Filter datasets…" },
  openLocal: { ja: "ローカルデータを開く", en: "Open local data" },
  empty: { ja: "データセットがありません", en: "No datasets yet" },
  emptyHint: {
    ja: "IMDF ZIP をアップロードして最初のデータセットを公開しましょう。",
    en: "Upload an IMDF ZIP to publish your first dataset.",
  },
  signOut: { ja: "サインアウト", en: "Sign out" },
  loadError: { ja: "読み込みに失敗しました", en: "Could not load datasets" },
} as const;

type GalleryState =
  | { phase: "loading" }
  | { phase: "signed-out" }
  | { phase: "ready"; user: ApiUser; venues: VenueSummary[] }
  | { phase: "error" };

export function GalleryPage() {
  const [locale, setLocale] = useState<LocaleCode>("ja");
  const [state, setState] = useState<GalleryState>({ phase: "loading" });
  const [filter, setFilter] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState<VenueSummary | null>(null);

  const reload = useCallback(async () => {
    try {
      const user = await api.me();
      if (user === null) {
        setState({ phase: "signed-out" });
        return;
      }
      setState({ phase: "ready", user, venues: await api.listVenues() });
    } catch {
      setState({ phase: "error" });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openVenue = (slug: string) => {
    window.location.assign(`/?dataset=${encodeURIComponent(slug)}`);
  };

  const header = (
    <header className="gallery-header">
      <div className="gallery-header__brand">
        <KirikoMark className="gallery-header__mark" />
        <span className="gallery-header__wordmark">Kiriko</span>
      </div>
      <div className="gallery-header__actions">
        {state.phase === "ready" ? (
          <>
            <span className="chip">{state.user.username}</span>
            <button
              type="button"
              className="chip"
              onClick={() => {
                void api.logout().then(reload);
              }}
            >
              {ui.signOut[locale]}
            </button>
          </>
        ) : null}
        <div className="locale-chips" role="group" aria-label="Language">
          <button
            type="button"
            className={locale === "ja" ? "chip chip--selected" : "chip"}
            aria-pressed={locale === "ja"}
            onClick={() => {
              setLocale("ja");
            }}
          >
            日本語
          </button>
          <button
            type="button"
            className={locale === "en" ? "chip chip--selected" : "chip"}
            aria-pressed={locale === "en"}
            onClick={() => {
              setLocale("en");
            }}
          >
            EN
          </button>
        </div>
      </div>
    </header>
  );

  if (state.phase === "loading") {
    return <div className="gallery">{header}</div>;
  }
  if (state.phase === "signed-out") {
    return (
      <div className="gallery">
        {header}
        <SignInModal
          locale={locale}
          onSignedIn={() => {
            void reload();
          }}
        />
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div className="gallery">
        {header}
        <p className="gallery__error" role="alert">
          {ui.loadError[locale]}
        </p>
      </div>
    );
  }

  const visible = state.venues.filter((venue) => {
    const q = filter.trim().toLowerCase();
    return q === "" || venue.name.toLowerCase().includes(q) || venue.slug.includes(q);
  });

  return (
    <div className="gallery">
      {header}
      <main className="gallery__main">
        <div className="gallery__title-row">
          <h1 className="gallery__title">{ui.datasets[locale]}</h1>
          <div className="kiriko-input gallery__filter">
            <input
              type="search"
              role="searchbox"
              value={filter}
              placeholder={ui.filter[locale]}
              aria-label={ui.filter[locale]}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
            />
          </div>
          <button type="button" className="btn-primary gallery__upload-btn" onClick={() => { setUploadOpen(true); }}>
            {ui.openLocal[locale]}
          </button>
        </div>
        {visible.length === 0 ? (
          <div className="gallery__empty">
            <h2>{ui.empty[locale]}</h2>
            <p>{ui.emptyHint[locale]}</p>
          </div>
        ) : (
          <div className="gallery__grid">
            {visible.map((venue) => (
              <DatasetCard
                key={venue.id}
                venue={venue}
                locale={locale}
                onOpen={() => {
                  openVenue(venue.slug);
                }}
                onDelete={() => {
                  setDeleting(venue);
                }}
              />
            ))}
          </div>
        )}
      </main>
      {uploadOpen ? (
        <UploadModal
          locale={locale}
          onClose={() => {
            setUploadOpen(false);
          }}
          onPublished={() => {
            void reload();
          }}
        />
      ) : null}
      {deleting !== null ? (
        <ConfirmDeleteModal
          locale={locale}
          venueName={deleting.name}
          onCancel={() => {
            setDeleting(null);
          }}
          onConfirm={() => {
            void api.deleteVenue(deleting.id).then(() => {
              setDeleting(null);
              return reload();
            });
          }}
        />
      ) : null}
    </div>
  );
}
