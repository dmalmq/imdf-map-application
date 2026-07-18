# Task 9 report

## RED → GREEN

- RED: `pnpm exec vitest run src/issues/api.test.ts src/issues/issueReducer.test.ts` failed because `./api` and `./issueReducer` did not exist.
- RED: `pnpm exec vitest run src/issues/useIssueSync.test.tsx` failed because `./useIssueSync` did not exist.
- Additional controlled-order RED cases reproduced canonical-admission, mutation-error overwrite, replacement-draft, dependency-generation, overlapping-error, and notice-dismissal races before each correction.
- GREEN: `pnpm exec vitest run src/issues/api.test.ts src/issues/issueReducer.test.ts src/issues/useIssueSync.test.tsx` — 3 files, 36 tests passed.
- GREEN: `pnpm typecheck` and `git diff --check` exited 0.

## Delivered contract

- Exact same-origin REST client routes, JSON bodies, GET `AbortSignal`, reviewer response unwrapping, opaque-ID URL encoding, EventSource URL, and `IssueApiError` preservation of `status`, `error`, `message`, `details`, `current`, and `revision`.
- Independent issue wire/controller types and pure reducer. Canonical collection and `appliedRevision` change only after an accepted GET; observations and successful mutations update only the monotonic `highestObservedRevision` and refetch demand.
- Stable controller commands/UI methods; no reducer dispatch is exposed. Null identity resets to idle and performs no GET, EventSource, or mutation request.
- Draft UUID is allocated once per captured draft and retained through network/auth/conflict/feature recovery. Canonical admission or cancellation clears it. Feature-specific `invalid_anchor` clears only the matching draft's `featureId`.

## Deterministic synchronization proof

Controlled promises and a fake EventSource cover initial GET, immediate/burst revisions, at-most-one GET, behind-response follow-up, stale projection suppression, reconnect repair, local revision 7 interleaved with unseen revision 6, old GET/mutation generation suppression, option-identity stability, network retry, canonical draft admission, selected tombstone fallback, and unmount/key-change close+abort cleanup. Mutation and collection failures remain visible regardless of overlapping callback order.

## Files and commit

- `src/issues/types.ts`
- `src/issues/api.ts`
- `src/issues/api.test.ts`
- `src/issues/issueReducer.ts`
- `src/issues/issueReducer.test.ts`
- `src/issues/useIssueSync.ts`
- `src/issues/useIssueSync.test.tsx`
- Commit subject: `feat(web): synchronize canonical review issues`

## Self-review

Four review passes found and verified fixes for six adversarial ordering defects; the final reviewer marked the implementation ready with 0.98 confidence. No App, panel, map, viewer reducer, `VenueLoadError`, or canonical optimistic-patch integration was added. No known concerns remain.
