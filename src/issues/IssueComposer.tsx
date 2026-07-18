import { useEffect, useRef } from "react";
import type { LocaleCode } from "../imdf/types";
import {
  checkIssueBody,
  ISSUE_MARKDOWN_MAX_SCALARS,
  normalizeIssueMarkdown,
} from "./MarkdownBody";
import type {
  CreateIssueInput,
  IssueDraft,
  IssueDraftPatch,
  ReviewerSummary,
} from "./types";
import type { IssueActor } from "./useIssueSync";

/**
 * New-issue composer over the controller-owned draft. It mounts after a
 * successful placement started the draft, routes every field change through
 * `updateDraft`, and never generates or replaces the controller-owned
 * request ID. Assignment and due date never block creation.
 */

const ui = {
  heading: { ja: "新しい課題", en: "New issue" },
  bodyLabel: { ja: "課題の本文", en: "Issue body" },
  bodyPlaceholder: { ja: "課題の内容を入力…", en: "Describe the issue…" },
  markdownHint: {
    ja: "Markdown：**太字**、*斜体*、リスト、リンクが使えます",
    en: "Markdown: **bold**, *italic*, lists, links",
  },
  tooLong: { ja: "4,000文字以内で入力してください", en: "Keep it under 4,000 characters." },
  controlCharacters: {
    ja: "使用できない制御文字が含まれています",
    en: "Remove unsupported control characters.",
  },
  brokenCharacters: { ja: "不正な文字が含まれています", en: "The text contains broken characters." },
  assignee: { ja: "担当者", en: "Assignee" },
  dueDate: { ja: "期限", en: "Due date" },
  optional: { ja: "（任意）", en: "(optional)" },
  unassigned: { ja: "未割り当て", en: "Unassigned" },
  pin: { ja: "ピン", en: "Pin" },
  feature: { ja: "地物", en: "Feature" },
  removeFeature: { ja: "地物を解除", en: "Remove feature" },
  cancel: { ja: "キャンセル", en: "Cancel" },
  post: { ja: "課題を投稿", en: "Post issue" },
  signInToPost: { ja: "投稿するにはサインイン", en: "Sign in to post" },
} as const;

export interface IssueComposerProps {
  locale: LocaleCode;
  draft: IssueDraft;
  currentUser: IssueActor | null;
  reviewers: ReviewerSummary[];
  /** True while any mutation is in flight; posting disables. */
  pending: boolean;
  onUpdateDraft: (patch: IssueDraftPatch) => void;
  onSubmit: (input: CreateIssueInput) => void;
  onCancel: () => void;
  onRequestSignIn: () => void;
}

/**
 * Kiriko issue composer body: Markdown textarea with a formatting hint,
 * scalar character count, accessible limit error, optional assignee/due
 * metadata, and the captured anchor context. Hosted inside the Issues panel.
 */
export function IssueComposer({
  locale,
  draft,
  currentUser,
  reviewers,
  pending,
  onUpdateDraft,
  onSubmit,
  onCancel,
  onRequestSignIn,
}: IssueComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // Placement just completed — move focus into the composer.
    textareaRef.current?.focus();
  }, []);

  const normalized = normalizeIssueMarkdown(draft.bodyMarkdown);
  const check = checkIssueBody(normalized);
  const signedIn = currentUser !== null;
  const canSetDueDate = currentUser !== null && currentUser.role !== "viewer";

  // A viewer may only leave the issue unassigned or assign themselves;
  // members and admins may pick any existing account.
  const assigneeOptions: ReviewerSummary[] = [];
  if (currentUser !== null) {
    if (currentUser.role === "viewer") {
      assigneeOptions.push({ id: currentUser.id, username: currentUser.username });
    } else {
      const seen = new Set<number>();
      for (const reviewer of reviewers) {
        if (!seen.has(reviewer.id)) {
          seen.add(reviewer.id);
          assigneeOptions.push(reviewer);
        }
      }
      if (!seen.has(currentUser.id)) {
        assigneeOptions.push({ id: currentUser.id, username: currentUser.username });
      }
    }
  }

  return (
    <div className="issue-composer">
      <h3 className="panel-caption">{ui.heading[locale]}</h3>

      <textarea
        ref={textareaRef}
        className="issue-composer__input"
        aria-label={ui.bodyLabel[locale]}
        placeholder={ui.bodyPlaceholder[locale]}
        rows={5}
        value={draft.bodyMarkdown}
        onChange={(event) => {
          onUpdateDraft({ bodyMarkdown: event.target.value });
        }}
      />
      <div className="issue-composer__hint-row">
        <p className="issue-composer__hint">{ui.markdownHint[locale]}</p>
        <p className="issue-composer__count" aria-live="polite">
          {`${check.scalars}/${ISSUE_MARKDOWN_MAX_SCALARS}`}
        </p>
      </div>
      {check.problem === "too_long" ? (
        <p className="issue-composer__error" role="alert">
          {ui.tooLong[locale]}
        </p>
      ) : null}
      {check.problem === "control_characters" ? (
        <p className="issue-composer__error" role="alert">
          {ui.controlCharacters[locale]}
        </p>
      ) : null}
      {check.problem === "unpaired_surrogates" ? (
        <p className="issue-composer__error" role="alert">
          {ui.brokenCharacters[locale]}
        </p>
      ) : null}

      {signedIn ? (
        <label className="issue-composer__field">
          <span>
            {ui.assignee[locale]} {ui.optional[locale]}
          </span>
          <select
            aria-label={ui.assignee[locale]}
            value={draft.assigneeId ?? ""}
            onChange={(event) => {
              onUpdateDraft({
                assigneeId: event.target.value === "" ? null : Number(event.target.value),
              });
            }}
          >
            <option value="">{ui.unassigned[locale]}</option>
            {assigneeOptions.map((reviewer) => (
              <option key={reviewer.id} value={reviewer.id}>
                {reviewer.username}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {canSetDueDate ? (
        <label className="issue-composer__field">
          <span>
            {ui.dueDate[locale]} {ui.optional[locale]}
          </span>
          <input
            type="date"
            aria-label={ui.dueDate[locale]}
            value={draft.dueDate ?? ""}
            onChange={(event) => {
              onUpdateDraft({ dueDate: event.target.value === "" ? null : event.target.value });
            }}
          />
        </label>
      ) : null}

      <p className="issue-composer__anchor">
        {ui.pin[locale]}{" "}
        <span className="issue-composer__mono">
          {draft.anchor.longitude}, {draft.anchor.latitude}
        </span>
      </p>
      {draft.anchor.featureId !== undefined ? (
        <p className="issue-composer__anchor">
          {ui.feature[locale]}{" "}
          <span className="issue-composer__mono">{draft.anchor.featureId}</span>{" "}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              const { featureId: _featureId, ...anchor } = draft.anchor;
              onUpdateDraft({ anchor });
            }}
          >
            {ui.removeFeature[locale]}
          </button>
        </p>
      ) : null}

      <div className="issue-composer__footer">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          {ui.cancel[locale]}
        </button>
        {signedIn ? (
          <button
            type="button"
            className="btn-primary"
            disabled={pending || check.problem !== null}
            onClick={() => {
              onSubmit({
                requestId: draft.requestId,
                bodyMarkdown: normalized,
                anchor: {
                  levelId: draft.anchor.levelId,
                  longitude: draft.anchor.longitude,
                  latitude: draft.anchor.latitude,
                  featureId: draft.anchor.featureId ?? null,
                },
                assigneeId: draft.assigneeId,
                dueDate: draft.dueDate,
              });
            }}
          >
            {ui.post[locale]}
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={onRequestSignIn}>
            {ui.signInToPost[locale]}
          </button>
        )}
      </div>
    </div>
  );
}
