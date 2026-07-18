# Task 7 — Dataset Viewer Cutover Report

## Status

Complete. Published datasets now load `/v/default/${slug}/bundle` through `loadKirikoBundle`; explicit `?src=` and local input/drop remain on the TypeScript ZIP worker. Task 8 archive-route removal was intentionally not performed.

## TDD: RED / GREEN

### RED

1. Changed the gallery API test to require `datasetBundleUrl("tokyo-station") === "/v/default/tokyo-station/bundle"` and added App tests with both loaders mocked. The first run failed because `datasetBundleUrl` did not exist and dataset links still entered `fetchImdfFile`/`loadImdfArchive` instead of `loadKirikoBundle`.
2. The initial drop regression targeted `.map-stage` while the empty state owns its drop handler on `.imdf-dropzone`; that test setup was corrected before production changes.
3. Review found that retry on a dataset page could switch a failed local replacement back to dataset provenance. A new dataset → failed local replacement test failed as expected: the retry started `loadKirikoBundle` again instead of retrying the same local `File`.

### GREEN

- `datasetBundleUrl` is the sole exported dataset URL builder and returns the exact bundle path.
- `App` routes dataset/src/local/drop attempts to the correct loader and retains the latest failed `LoadAttempt` for same-provenance retry.
- Focused unit command: `pnpm exec vitest run src/app/App.test.tsx src/gallery/api.test.ts src/state/viewerReducer.test.ts src/bundle`
  - Result: **8 files passed, 115 tests passed**.
- `pnpm typecheck`
  - Result: **passed**.

## Provenance State and Data Flow

| Provenance | Input | Load function | Disallowed calls |
| --- | --- | --- | --- |
| Published dataset | `?dataset=<slug>` | `datasetBundleUrl(slug)` → `loadKirikoBundle(url, signal)` | no `fetchImdfFile`; no `loadImdfArchive` |
| Explicit source | `?src=<url>` | `fetchImdfFile(url, signal)` → `loadImdfArchive(file, signal)` | no `loadKirikoBundle` |
| Hidden input | selected `File` | `loadImdfArchive(file, signal)` | no fetch; no `loadKirikoBundle` |
| Drop/dropzone | dropped `.zip` `File` | `loadImdfArchive(file, signal)` | no fetch; no `loadKirikoBundle` |

`src` retains precedence when both `src` and `dataset` are present. No filename, extension, or MIME inference selects the dataset loader. Every path resolves to `LoadedVenue` and enters the existing `load_started`, `load_succeeded`, and `load_failed` reducer actions.

## Retry, Abort, and Stale Attempts

- `runLoad` remains the common reducer/lifecycle path.
- Starting any attempt aborts the previous `AbortController`, increments the attempt token, and retains the previous ready venue through the existing reducer.
- Completion/failure dispatches only when its token is current; a late dataset result after a local replacement is ignored.
- Abort failures do not dispatch an error.
- Retry stores the latest attempt’s exact loader closure and provenance. Dataset retries the same bundle URL; src repeats fetch + ZIP decode; a failed local replacement retries the same `File` rather than reverting to URL provenance.
- The retry closure is cleared after a current successful load so a large local `File` is not retained unnecessarily.

Regression coverage also keeps requested level selection, embed chrome, locale initialization, source-over-dataset precedence, previous-venue retention, search/selection/details, and the existing viewer reducer suite green.

## Caller Migration / Reference Evidence

- Clean rename: `datasetArchiveUrl` → `datasetBundleUrl`; no alias or re-export remains.
- Repository reference search under `src` and `e2e` found only `datasetBundleUrl` at:
  - `src/gallery/api.ts`
  - `src/gallery/api.test.ts`
  - `src/app/App.tsx`
- No `datasetArchiveUrl` reference remains.
- Exact API assertion: `/v/default/tokyo-station/bundle`.

## E2E and Network Assertion

Command:

`PATH="$HOME/.cargo/bin:$PATH" pnpm exec playwright test e2e/gallery.spec.ts e2e/viewer.spec.ts e2e/embed.spec.ts --project=chromium`

Result: **8 passed**.

- Gallery sign-in → upload → publish → viewer rendered the published venue through the real server, KVB response, inline worker, and WASM decoder.
- The gallery request listener is installed before navigation and records dataset-resource paths through ready render. It asserted the exact array `[/v/default/<slug>/bundle]`: exactly one bundle request and no `/archive` request.
- The local viewer journey remains separate and covers ZIP upload → map → levels → search → selection → inspector details/hours/IDs → warnings → compact layout → corrupt replacement recovery, with zero dataset HTTP requests after app load.
- Embed `?src=` recorded exactly one source ZIP request and zero dataset bundle/archive requests; retry still re-fetches the source ZIP.

The first gallery E2E run exposed an existing Task 6 inline-worker WASM URL issue: wasm-pack default initialization resolved against a `blob:` `import.meta.url` and returned `worker_failed` after the single bundle fetch. The Task 6 owner fixed the authoritative WASM boundary in separate commit `8578f3a`; the unchanged Task 7 E2E then passed through the real worker/WASM path.

## Browser-Visible Smoke Evidence

A production preview and real API were opened in Chromium at `/?dataset=tokyo-test`. Observed:

- context bar venue: `東京駅テスト会場`;
- `.indoor-map[data-map-idle="true"]`;
- visible level, amenity, occupant, and kiosk controls;
- Performance Resource Timing dataset resources: exactly `http://127.0.0.1:4173/v/default/tokyo-test/bundle` and no archive resource.

## Files

- `src/gallery/api.ts`
- `src/gallery/api.test.ts`
- `src/app/App.tsx`
- `src/app/App.test.tsx`
- `e2e/helpers.ts`
- `e2e/gallery.spec.ts`
- `e2e/viewer.spec.ts`
- `e2e/embed.spec.ts`
- `.superpowers/sdd/task-7-report.md`

## Self-Review

A reviewer found one Important issue in the first pass: retry could cross from failed local replacement back to dataset provenance. It was reproduced with a failing test and fixed by retaining the latest `LoadAttempt`. Follow-up review found no remaining Critical or Important issues. The review’s only Minor concern—retaining a successful local `File`—was removed by clearing the retry attempt on success.

## Concerns

- `wasm-pack` 0.13.1 was installed at `$HOME/.cargo/bin` but that directory was absent from the default command PATH, so the exact E2E command required the PATH prefix shown above.
- The server `/archive` routes and local ZIP loader intentionally remain for Task 8 and later phases respectively.
