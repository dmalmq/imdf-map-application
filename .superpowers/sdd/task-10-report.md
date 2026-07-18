# Task 10 report

## Dependency

- `pnpm add -w --save-exact react-markdown@10.1.0 remark-breaks@4.0.0` — exact pins recorded in `package.json`/`pnpm-lock.yaml` (pnpm alphabetized the dependency block; no other entry changed). No rehype-raw, HTML sanitizer, date, SSE, or state library was added.

## RED → GREEN

- RED: `pnpm exec vitest run src/issues/issueDates.test.ts` failed — `./issueDates` missing. GREEN: 26 tests.
- RED: `pnpm exec vitest run src/issues/MarkdownBody.test.tsx` failed — `./MarkdownBody` missing. GREEN after one assertion correction (mdast→hast emits a `\n` text node after `<br>`; the boundary itself was right): 48 tests.
- RED: `pnpm exec vitest run src/issues/IssuesPanel.test.tsx` failed — `./IssueQueue`/`./IssuesPanel` missing. First GREEN run exposed two test defects (author/assignee fixture shared one username; two detail renders in one test) — both fixed on the test side, implementation unchanged: 58 tests.
- Final: `pnpm exec vitest run src/issues/MarkdownBody.test.tsx src/issues/issueDates.test.ts src/issues/IssuesPanel.test.tsx` → 3 files, 132 passed; `pnpm typecheck` clean; whole `src/issues` (incl. Task 9) 170/170.

## Markdown security

`MarkdownBody` is the sole rendering boundary: `react-markdown` + `remarkBreaks`, `allowedElements` exactly `p/br/em/strong/ol/ul/li/a/code`, `skipHtml`, `urlTransform={safeIssueUrl}` returning an href only for absolute `http:`/`https:`/`mailto:` (relative, protocol-relative, `javascript:`, `data:`, entity-encoded schemes all render anchors with no href), and `a` forced to `target="_blank" rel="noopener noreferrer"`. Tests prove no script/iframe/img/heading/table ever reaches the DOM and raw HTML is dropped, not rendered. `normalizeIssueMarkdown`/`checkIssueBody` mirror the server exactly: CRLF/CR→LF, Unicode-scalar counting (astral = 1), 4000/4001 boundary, whitespace-only, tab+LF as the only permitted controls (C0/C1 and unpaired surrogates flagged).

## Calendar boundaries

`issueDates` never calls `new Date("YYYY-MM-DD")`: parsing is regex + real-calendar validation (leap rules; no overflow coercion), classification subtracts days-from-civil serials — before local today `overdue`, today through +3 local calendar days `due_soon`, day four `none` — proven across month/leap/year boundaries. Display formats from numeric local components (`Intl`, ja/en); created/updated instants format under an explicitly pinned `TZ` in tests (server-test pattern).

## Panel

`IssuesPanel` (exact approved props) + `IssueQueue`/`IssueDetail`/`IssueComposer` drive everything through `controller.commands`/`controller.ui` — no reducer dispatch, no canonical mutation. Covered by tests: four filters + `setFilter`; all-floor active count (`countActiveIssues` exported for the Task 12 rail badge); summary = first non-empty normalized line, whitespace-collapsed, 80-scalar cut with `…` iff longer, localized **Comment deleted**; full role matrix (anonymous/viewer/member/admin, edit-own vs delete-any); viewer self-assign/unassign transitions with `expectedVersion`; member assignee/due/status patches incl. reopen; root/reply tombstones with reply edit/delete retained; replies on closed roots (reply request ID is UUID v4, reused across failed retries, regenerated only after the canonical revision passes the submission); collection retry, mutation error, 409 conflict, `authRequired` sign-in, reconnecting/stale, deleted-selection notice; identity-disabled and auth-lookup-error states; placement begin/hint/cancel; manual feature removal via `updateDraft` (anchor without `featureId`); `invalid_anchor` resubmit notice preserving the controller-owned `requestId`; scalar count `N/4000` with accessible limit error; composer entry focus and focus return to New issue on cancel. Every string has ja/en copy; chips/list-rows/buttons/panel-caption reuse the existing Kiriko vocabulary, new `issue-*` class hooks left for Task 12 styling.

## Files and commit

- Modified: `package.json`, `pnpm-lock.yaml`
- Created: `src/issues/MarkdownBody.tsx` + test, `src/issues/issueDates.ts` + test, `src/issues/IssueQueue.tsx`, `src/issues/IssueDetail.tsx`, `src/issues/IssueComposer.tsx`, `src/issues/IssuesPanel.tsx` + test
- Commit subject: `feat(web): add review issue panel and discussion`

## Self-review

- `IssueDetail` is keyed by issue id so editor/reply-box state never leaks across selections; detail view hides the New-issue footer to keep one primary action (pinned by test).
- No App/map/rail/CSS files touched; no `dangerouslySetInnerHTML`/`innerHTML` anywhere; `new Date` string parsing only for full RFC 3339 instants.

## Concerns

- While a body editor is open in detail, the editor Save and the thread Reply button are both `btn-primary`; Task 12's styling pass may demote one if design review objects.

## Gate fixes (second pass)

RED-first for each; whole `src/issues` now 189/189, typecheck clean.

1. Body editors (root + reply) no longer close on save: `IssueDetail` records the submitted `{bodyMarkdown, expectedVersion}` and closes only when the canonical projection carries that exact body at a newer row version (admission) or on explicit cancel — text/open state survive network failures and 409s; a remote refetch with someone else's newer body keeps the editor open.
2. `ReplyComposer` dropped the `appliedRevision` heuristic. It keeps its local UUID + text through failures and, using only the UI-serialized `pendingMutations` + mutation outcome (submitted → inflight → settled), clears and rotates the ID solely on its own success. No new Task 9 public surface.
3. Root/draft `requestId` is never rotated. An `idempotency_conflict` now renders its own copy (the key admitted different content; input kept; cancel and start again) — distinct from `stale_issue`, no deterministic auto-retry.
4. On a known role change to viewer, `IssueComposer` routes removal of now-forbidden `dueDate`/other-assignee through `updateDraft` (body, anchor, requestId, self-assignment preserved); signed-out/unknown state changes nothing.
5. Floor (`levelId`) and optional feature IDs now render as mono machine values with ja/en labels in queue rows, detail meta, and composer.
6. `formatDueDate` builds in leap-year 2000 then `setFullYear`, so years 0000–0099 avoid the legacy Date 1900 offset; low-year cases tested.
7. Every Markdown editor (composer, root edit, reply edit, reply box) shares `MarkdownEditorFeedback`: localized hint, `N/4000` count, `role="alert"` validation reason, and an empty-state note explaining a disabled Save/Post.
8. An expired session auto-calls `onRequestSignIn` once per `authRequired` episode (explicit button retained; no repeat modal); signing back in returns focus to the retained composer textarea.

## Gate fixes (third pass — five blockers)

RED-first for each; whole `src/issues` now 198/198, typecheck clean.

1. Post-submit edits are no longer discarded. `ReplyComposer` disables its textarea + action while its serialized mutation is in flight and keeps the submitted body; the inline `BodyEditor` has a submitted→inflight→admission phase — locked (textarea + Save disabled) from save until the canonical body+version admits the exact edit, and unlocked with the draft unchanged on failure; the root composer's `pending` now includes `draftAdmissionResourceId !== null`, disabling textarea/assignee/due/feature controls through canonical admission (re-enabled on failure).
2. A `ReplyComposer` `idempotency_conflict` renders an explicit localized "Post as new reply" action; only that click generates a fresh local UUID and resubmits the retained text — no silent rotation. Retryable/other failures keep the same UUID + text.
3. Reply local text/UUID survive `currentUser` becoming null: the composer stays mounted across the signed-out branch (textarea shown whenever it holds text or the account is known) and refocuses on null→actor recovery. **Task 12 integration invariant (must enforce):** exact props cannot signal same-actor reauth, so the App's auth-recovery `onRequestSignIn` MUST set `currentUser` to null before opening the modal; successful sign-in then re-installs the actor as a null→actor transition, which is what drives reply/composer refocus.
4. Terminal vs retryable mutation copy is branched: `issue_deleted` = permanently deleted / no retry; `forbidden` (403) = denied / no retry; `idempotency_conflict` = cancel or restart; `stale_issue` and network/other keep review-and-retry copy. All ja/en.
5. `formatDueDate` adds a localized short era only for Gregorian year 0 (1 BC), which otherwise formats identically to year 1; exact en/ja assertions added ("Jan 1, 1 BC" / 「紀元前1年1月1日」 vs "Jan 1, 1" / 「1年1月1日」).

No server contract changed; no App/map/rail/CSS files touched.

## Gate fix (fourth pass — refetch-failure Retry reachability)

RED-first; whole `src/issues` now 201/201, typecheck clean.

- A loaded-collection refetch that fails after a post-create or post-edit leaves the draft locked on `draftAdmissionResourceId` (composer) or the editor locked on `submittedEdit` (detail), while `collection_fetch_failed` clears refetch demand — and the previous `collectionFailed` alert + Retry only rendered in the queue/null-collection branches, so the composer and detail views had no `retryCollection()` path and stayed permanently locked.
- The loaded-collection `collectionFailed` alert + Retry now renders at panel level, above the draft/detail/queue switch, so every view exposes it; the plain stale line is suppressed while it shows. The null-collection full error state is unchanged, the duplicate queue-branch alert is removed, and gating (`collection !== null` vs the null branch) keeps exactly one Retry in every state.
- RED tests cover a failed post-create GET with the draft open and a failed post-edit GET with the editor open: Retry is reachable from that view, `retryCollection()` fires, and a subsequent successful admitting refetch clears the draft / closes the editor. A third test pins a single Retry for the never-loaded collection.
