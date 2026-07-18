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

- Queue rows omit a floor label: the approved `IssuesPanelProps` carry no venue level data and `anchor.levelId` is a raw IMDF UUID (noise, not signal). If Task 12 wants localized floor names in rows, the panel needs a levels input added to the contract.
- While a body editor is open in detail, the editor Save and the thread Reply button are both `btn-primary`; Task 12's styling pass may demote one if design review objects.
