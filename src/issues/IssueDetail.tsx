import { useEffect, useRef, useState } from "react";
import type { LocaleCode } from "../imdf/types";
import { formatIssueInstant } from "./issueDates";
import { dueDateText, issueStatusLabel, issueSummary } from "./IssueQueue";
import {
  checkIssueBody,
  MarkdownBody,
  MarkdownEditorFeedback,
  normalizeIssueMarkdown,
} from "./MarkdownBody";
import type {
  CreateReplyInput,
  IssuePatch,
  IssueReply,
  IssueStatus,
  ReplyBodyPatch,
  ReviewerSummary,
  ReviewIssue,
} from "./types";
import type { IssueActor } from "./useIssueSync";

/**
 * Issue detail: root body, metadata, role-gated controls, and the one-level
 * reply thread. Controls are convenience visibility only — the server
 * remains authoritative for every permission.
 */

const ui = {
  back: { ja: "課題一覧に戻る", en: "Back to issues" },
  author: { ja: "作成者", en: "Author" },
  created: { ja: "作成日", en: "Created" },
  updated: { ja: "更新日", en: "Updated" },
  status: { ja: "ステータス", en: "Status" },
  assignee: { ja: "担当者", en: "Assignee" },
  dueDate: { ja: "期限", en: "Due date" },
  unassigned: { ja: "未割り当て", en: "Unassigned" },
  noDueDate: { ja: "なし", en: "None" },
  floor: { ja: "フロア", en: "Floor" },
  pin: { ja: "ピン", en: "Pin" },
  feature: { ja: "地物", en: "Feature" },
  editIssue: { ja: "課題を編集", en: "Edit issue" },
  deleteIssue: { ja: "課題を削除", en: "Delete issue" },
  editIssueBody: { ja: "課題の本文を編集", en: "Edit issue body" },
  editReply: { ja: "返信を編集", en: "Edit reply" },
  deleteReply: { ja: "返信を削除", en: "Delete reply" },
  editReplyBody: { ja: "返信の本文を編集", en: "Edit reply body" },
  save: { ja: "保存", en: "Save" },
  cancel: { ja: "キャンセル", en: "Cancel" },
  assignToMe: { ja: "自分に割り当て", en: "Assign to me" },
  unassignMe: { ja: "割り当てを解除", en: "Unassign me" },
  clearDueDate: { ja: "期限をクリア", en: "Clear due date" },
  replies: { ja: "返信", en: "Replies" },
  reply: { ja: "返信", en: "Reply" },
  replyPlaceholder: { ja: "返信を入力…", en: "Write a reply…" },
  signInToReply: { ja: "返信するにはサインイン", en: "Sign in to reply" },
  edited: { ja: "編集済み", en: "Edited" },
} as const;

export interface IssueDetailProps {
  locale: LocaleCode;
  issue: ReviewIssue;
  currentUser: IssueActor | null;
  reviewers: ReviewerSummary[];
  /** True while any mutation is in flight; submit controls disable. */
  pending: boolean;
  /**
   * True when the most recent mutation outcome failed (mutation-scope error,
   * conflict, or expired session). Mutations are UI-serialized, so together
   * with `pending` this identifies the submitted command's own outcome.
   */
  mutationFailed: boolean;
  onBack: () => void;
  onRequestSignIn: () => void;
  onPatchIssue: (patch: IssuePatch) => void;
  onDeleteIssue: (expectedVersion: number) => void;
  onCreateReply: (input: CreateReplyInput) => void;
  onPatchReply: (replyId: string, patch: ReplyBodyPatch) => void;
  onDeleteReply: (replyId: string, expectedVersion: number) => void;
}

type Editing = { kind: "root" } | { kind: "reply"; replyId: string } | null;

interface SubmittedEdit {
  bodyMarkdown: string;
  expectedVersion: number;
}

interface BodyEditorProps {
  locale: LocaleCode;
  label: string;
  initial: string;
  pending: boolean;
  onSave: (normalized: string) => void;
  onCancel: () => void;
}

/**
 * Inline body editor. Saving never closes the editor by itself — the owner
 * closes it when the canonical projection admits the edit, so text survives
 * network failures and stale-issue conflicts.
 */
function BodyEditor({ locale, label, initial, pending, onSave, onCancel }: BodyEditorProps) {
  const [text, setText] = useState(initial);
  const normalized = normalizeIssueMarkdown(text);
  const check = checkIssueBody(normalized);
  return (
    <div className="issue-editor">
      <textarea
        className="issue-editor__input"
        aria-label={label}
        rows={4}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <MarkdownEditorFeedback locale={locale} check={check} />
      <div className="issue-editor__actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          {ui.cancel[locale]}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={pending || check.problem !== null}
          onClick={() => {
            onSave(normalized);
          }}
        >
          {ui.save[locale]}
        </button>
      </div>
    </div>
  );
}

interface ReplyComposerProps {
  locale: LocaleCode;
  pending: boolean;
  mutationFailed: boolean;
  onSubmit: (input: CreateReplyInput) => void;
}

/**
 * Reply box. The request ID is allocated once per composed reply and reused
 * across failed retries so the server-side idempotency key stays stable.
 * Mutations are UI-serialized, so this submission's own outcome is observed
 * through the pending flag: when the in-flight mutation settles without a
 * failure, the box clears and the ID rotates; any failure keeps both. Remote
 * revisions and refetches never touch the composed text.
 */
function ReplyComposer({ locale, pending, mutationFailed, onSubmit }: ReplyComposerProps) {
  const [text, setText] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const phaseRef = useRef<"idle" | "submitted" | "inflight">("idle");

  useEffect(() => {
    if (phaseRef.current === "submitted" && pending) {
      phaseRef.current = "inflight";
      return;
    }
    if (phaseRef.current === "inflight" && !pending) {
      phaseRef.current = "idle";
      if (!mutationFailed) {
        setText("");
        setRequestId(crypto.randomUUID());
      }
    }
  }, [pending, mutationFailed]);

  const normalized = normalizeIssueMarkdown(text);
  const check = checkIssueBody(normalized);
  return (
    <div className="issue-reply-composer">
      <textarea
        className="issue-reply-composer__input"
        aria-label={ui.reply[locale]}
        placeholder={ui.replyPlaceholder[locale]}
        rows={3}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <MarkdownEditorFeedback locale={locale} check={check} />
      <div className="issue-reply-composer__actions">
        <button
          type="button"
          className="btn-primary"
          disabled={pending || check.problem !== null}
          onClick={() => {
            phaseRef.current = "submitted";
            onSubmit({ requestId, bodyMarkdown: normalized });
          }}
        >
          {ui.reply[locale]}
        </button>
      </div>
    </div>
  );
}

interface ReplyRowProps {
  locale: LocaleCode;
  reply: IssueReply;
  currentUser: IssueActor | null;
  pending: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (normalized: string) => void;
  onDeleteReply: (replyId: string, expectedVersion: number) => void;
}

function ReplyRow({
  locale,
  reply,
  currentUser,
  pending,
  editing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDeleteReply,
}: ReplyRowProps) {
  const isAuthor = currentUser !== null && currentUser.id === reply.author.id;
  const live = reply.deletedAt === null;
  const canEdit = live && isAuthor;
  const canDelete = live && (isAuthor || currentUser?.role === "admin");
  const wasEdited = live && reply.updatedAt !== reply.createdAt;
  return (
    <li className="issue-reply">
      <p className="issue-reply__meta">
        <span className="issue-reply__author">{reply.author.username}</span>
        {" · "}
        {formatIssueInstant(reply.createdAt, locale)}
        {wasEdited ? ` · ${ui.edited[locale]}` : ""}
      </p>
      {editing ? (
        <BodyEditor
          locale={locale}
          label={ui.editReplyBody[locale]}
          initial={reply.bodyMarkdown ?? ""}
          pending={pending}
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      ) : live ? (
        <div className="issue-reply__body">
          <MarkdownBody body={reply.bodyMarkdown ?? ""} />
        </div>
      ) : (
        <p className="issue-reply__tombstone">{issueSummary(null, locale)}</p>
      )}
      {!editing && (canEdit || canDelete) ? (
        <div className="issue-reply__actions">
          {canEdit ? (
            <button type="button" className="btn-ghost" onClick={onStartEdit}>
              {ui.editReply[locale]}
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              className="btn-ghost"
              disabled={pending}
              onClick={() => {
                onDeleteReply(reply.id, reply.rowVersion);
              }}
            >
              {ui.deleteReply[locale]}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Kiriko issue detail body: root text, metadata rows, role-gated controls,
 * and the chronological reply thread. Hosted inside the Issues panel.
 */
export function IssueDetail({
  locale,
  issue,
  currentUser,
  reviewers,
  pending,
  mutationFailed,
  onBack,
  onRequestSignIn,
  onPatchIssue,
  onDeleteIssue,
  onCreateReply,
  onPatchReply,
  onDeleteReply,
}: IssueDetailProps) {
  const [editing, setEditing] = useState<Editing>(null);
  // The body edit submitted from the currently open editor. The editor closes
  // only when the canonical projection carries this exact body at a newer row
  // version (admission) or on explicit cancel — never on failure.
  const submittedEditRef = useRef<SubmittedEdit | null>(null);

  useEffect(() => {
    const submitted = submittedEditRef.current;
    if (submitted === null || editing === null) {
      return;
    }
    let canonicalBody: string | null = null;
    let canonicalVersion = 0;
    if (editing.kind === "root") {
      canonicalBody = issue.bodyMarkdown;
      canonicalVersion = issue.rowVersion;
    } else {
      const reply = issue.replies.find(({ id }) => id === editing.replyId);
      if (reply === undefined) {
        return;
      }
      canonicalBody = reply.bodyMarkdown;
      canonicalVersion = reply.rowVersion;
    }
    if (
      canonicalVersion > submitted.expectedVersion
      && canonicalBody === submitted.bodyMarkdown
    ) {
      submittedEditRef.current = null;
      setEditing(null);
    }
  }, [issue, editing]);

  const live = issue.deletedAt === null;
  const isAuthor = currentUser !== null && currentUser.id === issue.author.id;
  const canModerate =
    currentUser !== null && (currentUser.role === "member" || currentUser.role === "admin");
  const canEditRoot = live && isAuthor;
  const canDeleteRoot = live && (isAuthor || currentUser?.role === "admin");

  const closeEditor = () => {
    submittedEditRef.current = null;
    setEditing(null);
  };

  const assigneeOptions: ReviewerSummary[] = [];
  {
    const seen = new Set<number>();
    for (const reviewer of reviewers) {
      if (!seen.has(reviewer.id)) {
        seen.add(reviewer.id);
        assigneeOptions.push(reviewer);
      }
    }
    if (currentUser !== null && !seen.has(currentUser.id)) {
      assigneeOptions.push({ id: currentUser.id, username: currentUser.username });
    }
    if (issue.assignee !== null && !seen.has(issue.assignee.id)) {
      assigneeOptions.push(issue.assignee);
    }
  }

  return (
    <div className="issue-detail">
      <button type="button" className="btn-ghost issue-detail__back" onClick={onBack}>
        {ui.back[locale]}
      </button>

      <p className="issue-detail__kind">#{issue.pinNumber}</p>

      {editing?.kind === "root" ? (
        <BodyEditor
          locale={locale}
          label={ui.editIssueBody[locale]}
          initial={issue.bodyMarkdown ?? ""}
          pending={pending}
          onSave={(normalized) => {
            submittedEditRef.current = {
              bodyMarkdown: normalized,
              expectedVersion: issue.rowVersion,
            };
            onPatchIssue({
              type: "body",
              bodyMarkdown: normalized,
              expectedVersion: issue.rowVersion,
            });
          }}
          onCancel={closeEditor}
        />
      ) : live ? (
        <div className="issue-detail__body">
          <MarkdownBody body={issue.bodyMarkdown ?? ""} />
        </div>
      ) : (
        <p className="issue-detail__tombstone">{issueSummary(null, locale)}</p>
      )}

      {editing?.kind !== "root" && (canEditRoot || canDeleteRoot) ? (
        <div className="issue-detail__actions">
          {canEditRoot ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setEditing({ kind: "root" });
              }}
            >
              {ui.editIssue[locale]}
            </button>
          ) : null}
          {canDeleteRoot ? (
            <button
              type="button"
              className="btn-ghost"
              disabled={pending}
              onClick={() => {
                onDeleteIssue(issue.rowVersion);
              }}
            >
              {ui.deleteIssue[locale]}
            </button>
          ) : null}
        </div>
      ) : null}

      <dl className="issue-detail__meta">
        <div className="issue-detail__row">
          <dt>{ui.author[locale]}</dt>
          <dd>{issue.author.username}</dd>
        </div>
        <div className="issue-detail__row">
          <dt>{ui.created[locale]}</dt>
          <dd>{formatIssueInstant(issue.createdAt, locale)}</dd>
        </div>
        <div className="issue-detail__row">
          <dt>{ui.updated[locale]}</dt>
          <dd>{formatIssueInstant(issue.updatedAt, locale)}</dd>
        </div>
        <div className="issue-detail__row">
          <dt>{ui.status[locale]}</dt>
          <dd>
            {live && canModerate ? (
              <select
                aria-label={ui.status[locale]}
                value={issue.status}
                disabled={pending}
                onChange={(event) => {
                  onPatchIssue({
                    type: "status",
                    status: event.target.value as IssueStatus,
                    expectedVersion: issue.rowVersion,
                  });
                }}
              >
                <option value="open">{issueStatusLabel("open", locale)}</option>
                <option value="in_review">{issueStatusLabel("in_review", locale)}</option>
                <option value="closed">{issueStatusLabel("closed", locale)}</option>
              </select>
            ) : (
              issueStatusLabel(issue.status, locale)
            )}
          </dd>
        </div>
        <div className="issue-detail__row">
          <dt>{ui.assignee[locale]}</dt>
          <dd>
            {live && canModerate ? (
              <select
                aria-label={ui.assignee[locale]}
                value={issue.assignee?.id ?? ""}
                disabled={pending}
                onChange={(event) => {
                  onPatchIssue({
                    type: "assignment",
                    assigneeId: event.target.value === "" ? null : Number(event.target.value),
                    expectedVersion: issue.rowVersion,
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
            ) : (
              <>
                {issue.assignee?.username ?? ui.unassigned[locale]}
                {live && currentUser !== null && !canModerate && issue.assignee === null ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={pending}
                    onClick={() => {
                      onPatchIssue({
                        type: "assignment",
                        assigneeId: currentUser.id,
                        expectedVersion: issue.rowVersion,
                      });
                    }}
                  >
                    {ui.assignToMe[locale]}
                  </button>
                ) : null}
                {live
                && currentUser !== null
                && !canModerate
                && issue.assignee?.id === currentUser.id ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={pending}
                    onClick={() => {
                      onPatchIssue({
                        type: "assignment",
                        assigneeId: null,
                        expectedVersion: issue.rowVersion,
                      });
                    }}
                  >
                    {ui.unassignMe[locale]}
                  </button>
                ) : null}
              </>
            )}
          </dd>
        </div>
        <div className="issue-detail__row">
          <dt>{ui.dueDate[locale]}</dt>
          <dd>
            {live && canModerate ? (
              <>
                <input
                  type="date"
                  aria-label={ui.dueDate[locale]}
                  value={issue.dueDate ?? ""}
                  disabled={pending}
                  onChange={(event) => {
                    onPatchIssue({
                      type: "due_date",
                      dueDate: event.target.value === "" ? null : event.target.value,
                      expectedVersion: issue.rowVersion,
                    });
                  }}
                />
                {issue.dueDate !== null ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={pending}
                    onClick={() => {
                      onPatchIssue({
                        type: "due_date",
                        dueDate: null,
                        expectedVersion: issue.rowVersion,
                      });
                    }}
                  >
                    {ui.clearDueDate[locale]}
                  </button>
                ) : null}
              </>
            ) : issue.dueDate !== null ? (
              dueDateText(issue.dueDate, locale)
            ) : (
              ui.noDueDate[locale]
            )}
          </dd>
        </div>
        <div className="issue-detail__row">
          <dt>{ui.floor[locale]}</dt>
          <dd className="issue-detail__mono">{issue.anchor.levelId}</dd>
        </div>
        <div className="issue-detail__row">
          <dt>{ui.pin[locale]}</dt>
          <dd className="issue-detail__mono">
            {issue.anchor.longitude}, {issue.anchor.latitude}
          </dd>
        </div>
        {issue.anchor.featureId !== undefined ? (
          <div className="issue-detail__row">
            <dt>{ui.feature[locale]}</dt>
            <dd className="issue-detail__mono">{issue.anchor.featureId}</dd>
          </div>
        ) : null}
      </dl>

      <section className="issue-detail__thread" aria-label={ui.replies[locale]}>
        <h3 className="panel-caption">
          {ui.replies[locale]} ({issue.replies.length})
        </h3>
        {issue.replies.length > 0 ? (
          <ul className="issue-detail__replies">
            {issue.replies.map((reply) => (
              <ReplyRow
                key={reply.id}
                locale={locale}
                reply={reply}
                currentUser={currentUser}
                pending={pending}
                editing={editing?.kind === "reply" && editing.replyId === reply.id}
                onStartEdit={() => {
                  setEditing({ kind: "reply", replyId: reply.id });
                }}
                onCancelEdit={closeEditor}
                onSaveEdit={(normalized) => {
                  submittedEditRef.current = {
                    bodyMarkdown: normalized,
                    expectedVersion: reply.rowVersion,
                  };
                  onPatchReply(reply.id, {
                    type: "body",
                    bodyMarkdown: normalized,
                    expectedVersion: reply.rowVersion,
                  });
                }}
                onDeleteReply={onDeleteReply}
              />
            ))}
          </ul>
        ) : null}
        {live ? (
          currentUser !== null ? (
            <ReplyComposer
              locale={locale}
              pending={pending}
              mutationFailed={mutationFailed}
              onSubmit={onCreateReply}
            />
          ) : (
            <button type="button" className="btn-ghost" onClick={onRequestSignIn}>
              {ui.signInToReply[locale]}
            </button>
          )
        ) : null}
      </section>
    </div>
  );
}
