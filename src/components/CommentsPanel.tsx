import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { LocaleCode } from "../imdf/types";
import {
  PlatformError,
  deleteComment,
  fetchComments,
  postComment,
} from "../platform/catalogClient";
import type { AccountInfo, CommentInput, CommentRecord } from "../platform/types";

const ui = {
  heading: { ja: "コメント", en: "Comments" },
  comment: { ja: "コメント", en: "Comment" },
  post: { ja: "投稿", en: "Post" },
  pin: { ja: "地図にピンを打つ", en: "Pin on map" },
  pinArmed: { ja: "地図をクリックしてください…", en: "Click the map…" },
  pinSet: { ja: "ピン設定済み", en: "Pin set" },
  clearPin: { ja: "ピンを外す", en: "Remove pin" },
  attachFeature: { ja: "選択中の地物に紐付け", en: "Link selected feature" },
  signInPrompt: { ja: "サインインしてコメント", en: "Sign in to comment" },
  empty: { ja: "コメントはまだありません。", en: "No comments yet." },
  pinned: { ja: "ピン付き", en: "Pinned" },
  deleteLabel: { ja: "コメントを削除", en: "Delete comment" },
  deleteFailed: {
    ja: "コメントを削除できませんでした。",
    en: "The comment could not be deleted.",
  },
  loadFailed: {
    ja: "コメントを読み込めませんでした。",
    en: "Comments could not be loaded.",
  },
  retry: { ja: "再試行", en: "Retry" },
} as const;

export interface CommentsPanelProps {
  datasetId: string;
  account: AccountInfo | null;
  locale: LocaleCode;
  selectedFeatureId: string | null;
  pinDraft: { levelId: string; lngLat: [number, number] } | null;
  pinArmed: boolean;
  onArmPin: () => void;
  onClearPin: () => void;
  onFocusComment: (comment: CommentRecord) => void;
  onRequestSignIn: () => void;
}

export function CommentsPanel({
  datasetId,
  account,
  locale,
  selectedFeatureId,
  pinDraft,
  pinArmed,
  onArmPin,
  onClearPin,
  onFocusComment,
  onRequestSignIn,
}: CommentsPanelProps) {
  const [comments, setComments] = useState<CommentRecord[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [text, setText] = useState("");
  const [attachFeature, setAttachFeature] = useState(false);
  const [busy, setBusy] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  // Guards: a load token invalidates superseded/unmounted loads even when a
  // mocked fetch ignores the AbortSignal; the dataset ref keeps late post or
  // delete completions from acting on a dataset the panel no longer shows.
  const loadTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const datasetRef = useRef(datasetId);
  datasetRef.current = datasetId;
  const disposedRef = useRef(false);

  const reload = useCallback(() => {
    if (disposedRef.current || datasetRef.current !== datasetId) {
      return;
    }
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoadError(false);
    fetchComments(datasetId, controller.signal)
      .then((loaded) => {
        if (token !== loadTokenRef.current) {
          return;
        }
        setComments([...loaded].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
      })
      .catch(() => {
        if (token !== loadTokenRef.current) {
          return;
        }
        setLoadError(true);
      });
  }, [datasetId]);

  // Load on mount and whenever the dataset changes; the previous dataset's
  // list is dropped and its in-flight request invalidated.
  useEffect(() => {
    disposedRef.current = false;
    setComments(null);
    setDeleteError(false);
    setPostError(null);
    setText("");
    setAttachFeature(false);
    setBusy(false);
    reload();
    return () => {
      disposedRef.current = true;
      loadTokenRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [reload]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed === "" || busy) {
      return;
    }
    const input: CommentInput = {
      text: trimmed,
      ...(pinDraft !== null ? { levelId: pinDraft.levelId, lngLat: pinDraft.lngLat } : {}),
      ...(attachFeature && selectedFeatureId !== null
        ? { featureId: selectedFeatureId }
        : {}),
    };
    setBusy(true);
    setPostError(null);
    postComment(datasetId, input)
      .then(() => {
        if (disposedRef.current || datasetRef.current !== datasetId) {
          return;
        }
        setBusy(false);
        setText("");
        setAttachFeature(false);
        onClearPin();
        reload();
      })
      .catch((caught: unknown) => {
        if (disposedRef.current || datasetRef.current !== datasetId) {
          return;
        }
        setBusy(false);
        if (caught instanceof PlatformError && caught.status === 401) {
          onRequestSignIn();
        }
        setPostError(caught instanceof Error ? caught.message : String(caught));
      });
  };

  const onDelete = (comment: CommentRecord) => {
    setDeleteError(false);
    void deleteComment(datasetId, comment.id)
      .then(() => {
        if (disposedRef.current || datasetRef.current !== datasetId) {
          return;
        }
        reload();
      })
      .catch((caught: unknown) => {
        if (disposedRef.current || datasetRef.current !== datasetId) {
          return;
        }
        if (caught instanceof PlatformError && caught.status === 401) {
          onRequestSignIn();
        }
        setDeleteError(true);
      });
  };

  const canDelete = (comment: CommentRecord): boolean =>
    account !== null && (account.role === "admin" || account.username === comment.author);

  return (
    <aside className="comments-panel" aria-label={ui.heading[locale]}>
      <h2 className="comments-panel__heading">{ui.heading[locale]}</h2>
      {loadError ? (
        <p className="comments-panel__notice">
          {ui.loadFailed[locale]}{" "}
          <button type="button" onClick={reload}>
            {ui.retry[locale]}
          </button>
        </p>
      ) : null}
      {deleteError ? (
        <p className="comments-panel__notice" role="alert">
          {ui.deleteFailed[locale]}
        </p>
      ) : null}
      {comments !== null && comments.length === 0 ? (
        <p className="comments-panel__notice">{ui.empty[locale]}</p>
      ) : null}
      <ul className="comments-panel__list">
        {(comments ?? []).map((comment) => {
          const pinned = comment.lngLat !== undefined;
          return (
            <li
              key={comment.id}
              className={
                pinned
                  ? "comments-panel__item comments-panel__item--pinned"
                  : "comments-panel__item"
              }
            >
              <button
                type="button"
                className="comments-panel__body"
                onClick={() => {
                  onFocusComment(comment);
                }}
              >
                <span className="comments-panel__author">
                  {comment.author}
                  {pinned ? (
                    <span className="comments-panel__pin-flag">{ui.pinned[locale]}</span>
                  ) : null}
                </span>
                <span>{comment.text}</span>
                <time className="comments-panel__time" dateTime={comment.createdAt}>
                  {new Date(comment.createdAt).toLocaleString(
                    locale === "ja" ? "ja-JP" : "en-US",
                  )}
                </time>
              </button>
              {canDelete(comment) ? (
                <button
                  type="button"
                  aria-label={ui.deleteLabel[locale]}
                  className="comments-panel__delete"
                  onClick={() => {
                    onDelete(comment);
                  }}
                >
                  ×
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {account === null ? (
        <button type="button" className="comments-panel__signin" onClick={onRequestSignIn}>
          {ui.signInPrompt[locale]}
        </button>
      ) : (
        <form className="comments-panel__composer" aria-busy={busy} onSubmit={onSubmit}>
          <label>
            {ui.comment[locale]}
            <textarea
              value={text}
              maxLength={2000}
              required
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          </label>
          <div className="comments-panel__pin-controls">
            {pinDraft !== null ? (
              <>
                <span>{ui.pinSet[locale]}</span>
                <button type="button" onClick={onClearPin}>
                  {ui.clearPin[locale]}
                </button>
              </>
            ) : (
              <button type="button" onClick={onArmPin} disabled={pinArmed}>
                {pinArmed ? ui.pinArmed[locale] : ui.pin[locale]}
              </button>
            )}
            <label>
              <input
                type="checkbox"
                checked={attachFeature}
                disabled={selectedFeatureId === null}
                onChange={(event) => {
                  setAttachFeature(event.target.checked);
                }}
              />
              {ui.attachFeature[locale]}
            </label>
          </div>
          {postError !== null ? (
            <p className="comments-panel__notice" role="alert">
              {postError}
            </p>
          ) : null}
          <button type="submit" disabled={busy || text.trim() === ""}>
            {ui.post[locale]}
          </button>
        </form>
      )}
    </aside>
  );
}
