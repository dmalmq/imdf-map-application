### Task 7 report: Issue REST routes and server integration

#### RED

- Added `server/test/issuesRoutes.test.ts` and expanded `server/test/venues.test.ts` before production changes.
- Initial focused run failed all 11 REST route tests with missing-route `404`s, venue deletion returned only `boolean`, and production SSE lifecycle tests timed out because the shared graph was not registered.
- Follow-up regressions reproduced malformed, empty, over-limit, unsupported-media, and content-length-mismatch request bodies incorrectly returning/logging `500`, plus missing SSE `400`/`500` response schemas and unscoped SSE validation output before their fixes.

#### GREEN

- Registered exactly nine issue endpoints. Collection GET and SSE are public; reviewer directory and every mutation use `requireSession`.
- Collection responses are direct `IssueCollection` projections. Reviewer responses contain only `{id,username}`. Mutations expose only `{revision,resourceId}`; internal repository fields never reach the wire.
- Added strict TypeBox params/body/response schemas, disabled Ajv additional-property removal, registered `kiriko-rfc3339-utc` with Fastify Ajv, and registered the same format for response union serialization.
- Encapsulated issue validation/error handling. Schema failures and every request-side Fastify content-parser category (`INVALID_JSON_BODY`, `EMPTY_JSON_BODY`, `BODY_TOO_LARGE`, `INVALID_MEDIA_TYPE`, and `INVALID_CONTENT_LENGTH`) map locally to exact sanitized `400 invalid_request`; only intentional JSON syntax failures include a stable body detail. Domain errors retain their code-gated fields; unexpected causes are logged and return sanitized `500 internal_error`.
- JSON issue responses use `Cache-Control: no-store`; live SSE retains `text/event-stream`, `no-cache, no-transform`, capacity `503`, and `Retry-After: 15`.
- Built one production `IssueRepository -> AnchorIndexCache -> IssueEventHub -> IssueService` graph shared by REST and SSE.
- Venue deletion selects every permanent public version ID and deletes inside one synchronous SQLite transaction. Routes close only those exact hub keys after commit.
- Added `preClose` hub shutdown so live streams end before socket wait. Ordered `onClose` cleanup clears the cache before closing SQLite.
- Added the compatible 401 body `{error:"unauthorized",message:"Authentication is required."}`.

#### Acceptance coverage

- Exact `200`, all four domain `400` categories plus strict extras and every request-parser category, `401`, `403`, opaque `404`, all three `409` conflicts, sanitized `500`, and SSE `503` bodies/status schemas/headers.
- Root creation and replay, reply creation, four issue patch operations, reply patch, both deletes, stale `current` discriminants, tombstones, and no leaked internal/deleted fields.
- Published/public access, malformed IDs and extras, UUID-v4 validation, unpublished/unknown parity, reviewer projection, and exact OpenAPI response status schemas.
- Shared production mutation-to-SSE publication, replay revision stability, capacity release, deletion rollback ordering, exact stream closure, recreated-version isolation, and live `app.close()` completion.

#### Verification

- `pnpm core:build:node` — PASS.
- `TZ=Asia/Tokyo pnpm --filter kiriko-server exec vitest run test/issuesMigration.test.ts test/issuesRepository.test.ts test/issuesValidation.test.ts test/issuesService.test.ts test/issuesSse.test.ts test/issuesRoutes.test.ts test/venues.test.ts` — PASS, 7 files / 209 tests.
- `pnpm --filter kiriko-server typecheck` — PASS.
- Project-wide `pnpm test:server`, formatter, and linter were intentionally not run per the Task 7 harness constraint.

#### Files and commit

- Added: `server/src/issues/routes.ts`, `server/test/issuesRoutes.test.ts`.
- Modified: `server/src/issues/sseRoutes.ts`, `server/src/app.ts`, `server/src/auth/guard.ts`, `server/src/venues/routes.ts`, `server/src/venues/service.ts`, `server/test/venues.test.ts`.
- Report: `.superpowers/sdd/task-7-report.md`.
- Commit subject: `feat(server): expose version-pinned review issue API`.

#### Self-review and concerns

- Four reviewer passes were completed; all Critical/Important findings were addressed, including the post-commit request-parser edge cases.
- The focused rollback and sanitized-500 tests intentionally produce server-side error logs, proving causes are logged while response bodies stay sanitized.
- No unresolved Task 7 concerns.
