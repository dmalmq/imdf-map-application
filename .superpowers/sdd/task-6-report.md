# Task 6 Report: Bounded revision SSE

## Scope

Implemented Task 6 only. The production `buildApp` route graph remains unchanged; focused tests construct and register the SSE plugin with one repository and hub.

## RED

Command:

```text
pnpm --filter kiriko-server exec vitest run test/issuesSse.test.ts
```

Observed failure before implementation: Vitest could not resolve `../src/issues/events`; 0 tests ran and the command exited 1 because the Task 6 hub and route modules did not exist.

## GREEN

Commands and observed results:

```text
pnpm --filter kiriko-server exec vitest run test/issuesSse.test.ts test/auth.test.ts
```

- Exit 0
- 2 test files passed
- 21 tests passed

```text
pnpm --filter kiriko-server typecheck
```

- Exit 0
- `tsc --noEmit` reported no errors

## Socket, capacity, and lifecycle evidence

- Real Node HTTP sockets receive the exact initial `revision` event and required SSE headers.
- A repository seam publishes revisions during `getCurrentRevision`; the stream emits the maximum buffered/current revision, proving subscribe-before-read setup does not lose the commit.
- A deleted row is recreated with the same numeric version ID and a different permanent public ID; only the replacement public-ID stream receives its publication.
- Real responses prove disconnect capacity release, `closeVersion` response termination and capacity release, and global `preClose` hub shutdown ending a deliberately live response while `app.close()` resolves.
- Global and per-public-version overflow return non-hijacked JSON `503 sse_capacity`, `Cache-Control: no-store`, and `Retry-After: 15`; rejected listeners do not alter subscriber counts.
- Hub tests prove idempotent unsubscribe, exact-key close, empty-key cleanup through capacity reuse, global close, and ignored publication after closure.
- The heartbeat callback is registered at exactly 15,000 ms and writes exactly `: heartbeat\n\n`.
- Stream assertions reject issue bodies and deltas; only revision invalidations are sent.

## Files

- `server/src/config.ts`
- `server/src/issues/events.ts`
- `server/src/issues/sseRoutes.ts`
- `server/test/helpers.ts`
- `server/test/auth.test.ts`
- `server/test/app.test.ts`
- `server/test/issuesSse.test.ts`
- `.superpowers/sdd/task-6-report.md`

## Commit

Exact subject: `feat(server): stream bounded issue revisions`

## Self-review

A dedicated reviewer found no actionable findings and assessed the implementation ready. Manual scope review confirmed no production `buildApp`, REST, or web registration/change; the hub uses permanent public IDs exclusively and capacity is reserved only after published-version resolution.

## Concerns

None identified within Task 6 scope. Task 7 still owns production construction, shared dependency registration, venue-deletion `closeVersion` calls, and the Fastify `preClose` hook.
