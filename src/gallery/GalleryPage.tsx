import { useCallback, useEffect, useRef, useState } from "react";
import { KirikoMark } from "../components/icons";
import type { GdbInspectResponse, GdbMappingPlan } from "../gdb/types";
import type { LocaleCode } from "../imdf/types";
import { api, gdbErrorMessage, type ApiUser, type GdbError, type VenueSummary } from "./api";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { DatasetCard } from "./DatasetCard";
import { GdbImportDialog } from "./GdbImportDialog";
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
  importGdb: { ja: "Geodatabase を取り込む", en: "Import Geodatabase" },
  inspecting: { ja: "検査中…", en: "Inspecting…" },
  publishedWithSkips: {
    ja: (n: number, sample: string) =>
      `公開しました（${n} レイヤーをスキップ: 例 ${sample}）`,
    en: (n: number, sample: string) =>
      `Published with ${n} layer(s) skipped (e.g. ${sample}).`,
  },
} as const;

type GalleryState =
  | { phase: "loading" }
  | { phase: "signed-out" }
  | { phase: "ready"; user: ApiUser; venues: VenueSummary[] }
  | { phase: "error" };

type GdbFlow =
  | { phase: "idle" }
  | { phase: "inspecting" }
  | { phase: "review"; data: GdbInspectResponse; busy: boolean; error: GdbError | null }
  | { phase: "error"; message: string };

export function GalleryPage() {
  const [locale, setLocale] = useState<LocaleCode>("ja");
  const [state, setState] = useState<GalleryState>({ phase: "loading" });
  const [filter, setFilter] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState<VenueSummary | null>(null);
  const [gdbFlow, setGdbFlow] = useState<GdbFlow>({ phase: "idle" });
  const [gdbNotice, setGdbNotice] = useState<string | null>(null);
  const gdbInputRef = useRef<HTMLInputElement>(null);

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

  const startGdbImport = () => {
    setGdbNotice(null);
    gdbInputRef.current?.click();
  };
  const onGdbFile = (file: File | undefined) => {
    if (!file) return;
    setGdbNotice(null);
    setGdbFlow({ phase: "inspecting" });
    void (async () => {
      try {
        const data = await api.inspectGdb(file);
        setGdbFlow({ phase: "review", data, busy: false, error: null });
      } catch (err) {
        setGdbFlow({ phase: "error", message: gdbErrorMessage(err as GdbError, locale) });
      }
    })();
  };

  const publishGdbPlan = (plan: GdbMappingPlan) => {
    if (gdbFlow.phase !== "review") return;
    const data = gdbFlow.data;
    setGdbFlow({ phase: "review", data, busy: true, error: null });
    void (async () => {
      let venueId: number | null = null;
      try {
        const venue = await api.createVenue(plan.venueName.trim());
        venueId = venue.id;
        const published = await api.publishGdb(venue.id, data.blobHash, plan);
        const job = await api.waitForJob(published.jobId);
        if (job.status === "done") {
          const skipped = published.excludedLayers ?? [];
          if (skipped.length > 0) {
            const sample = skipped[0]!.layer;
            setGdbNotice(ui.publishedWithSkips[locale](skipped.length, sample));
          } else {
            setGdbNotice(null);
          }
          setGdbFlow({ phase: "idle" });
          if (gdbInputRef.current) gdbInputRef.current.value = "";
          await reload();
        } else {
          setGdbFlow({
            phase: "review",
            data,
            busy: false,
            error: { code: "gdb_conversion_failed", message: job.error },
          });
        }
      } catch (err) {
        if (venueId !== null) {
          try {
            await api.deleteVenue(venueId);
          } catch {
            /* best effort orphan cleanup */
          }
        }
        setGdbFlow({
          phase: "review",
          data,
          busy: false,
          error: err as GdbError,
        });
      }
    })();
  };

  const cancelGdbImport = () => {
    setGdbFlow({ phase: "idle" });
    if (gdbInputRef.current) gdbInputRef.current.value = "";
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
          <button type="button" className="chip" onClick={startGdbImport}>
            {ui.importGdb[locale]}
          </button>
          <input
            ref={gdbInputRef}
            type="file"
            accept=".zip,.gdb.zip"
            style={{ display: "none" }}
            onChange={(e) => {
              onGdbFile(e.target.files?.[0]);
            }}
          />
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
            void api
              .deleteVenue(deleting.id)
              .catch(() => {
                // Deletion failed (network/server); reload below re-syncs the list.
              })
              .then(() => {
                setDeleting(null);
                return reload();
              });
          }}
        />
      ) : null}
      {gdbFlow.phase === "inspecting" ? <div className="gallery-toast">{ui.inspecting[locale]}</div> : null}
      {gdbFlow.phase === "error" ? <div className="gallery-toast gallery-toast--error">{gdbFlow.message}</div> : null}
      {gdbNotice !== null ? (
        <div className="gallery-toast" role="status">{gdbNotice}</div>
      ) : null}
      {gdbFlow.phase === "review" ? (
        <GdbImportDialog
          inspection={gdbFlow.data.inspection}
          initialPlan={gdbFlow.data.suggestedPlan}
          locale={locale}
          busy={gdbFlow.busy}
          error={gdbFlow.error}
          onImport={publishGdbPlan}
          onCancel={cancelGdbImport}
        />
      ) : null}
    </div>
  );
}
