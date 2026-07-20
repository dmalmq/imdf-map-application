# Kiriko: GDB Import as New Version of Existing Venue

**Date:** 2026-07-20  
**Status:** Approved  
**Depends on:** Frontend GDB import (`2026-07-20-gdb-import-frontend-design.md`) and harden/auto-prune (`2026-07-20-gdb-harden-design.md`). Server `POST /api/gdb/publish` already accepts `venueId`.

## 1. Context

Today the gallery GDB path always:

1. inspects a `.gdb.zip`
2. opens `GdbImportDialog`
3. **`api.createVenue(plan.venueName)`**
4. `api.publishGdb(newVenueId, blobHash, plan)`
5. waits for the job and reloads

IMDF `UploadModal` likewise always creates a new venue; there is no “add version to this dataset” control on `DatasetCard` for either format.

The server GDB publish contract already takes `venueId` and inserts the next `versions.seq` for that venue with `source_kind='gdb'`. No server API change is required for the happy path.

**This phase:** let a signed-in user import a geodatabase as a **new version of an existing gallery venue**, without creating a second venue.

## 2. Goals

- Dataset card action: **Import GDB** (bilingual), next to Delete / Open.
- Flow: pick `.gdb.zip` → inspect → review dialog → publish to **that card’s `venue.id`** → job done → gallery reload (latest stats/status update).
- Header **Import Geodatabase** remains **new-venue only** (unchanged product meaning).
- On existing-venue import: **do not** call `createVenue`; **do not** delete the venue on publish 400 (no orphan).
- Venue display name is **not** renamed by this flow (version publish does not update `venues.name`).
- Reuse inspect, dialog, `publishGdb`, auto-prune `excludedLayers` toast, and blocking validation as-is.

## 3. Non-goals

- IMDF “upload new version to existing venue.”
- Renaming the venue from the GDB dialog when targeting an existing venue.
- Choosing among historical versions in the gallery card (still open latest / viewer entry as today).
- Server changes to publish schema, auth, or version identity.
- Bulk layer UX, markers, routing.

## 4. Product and interaction

### 4.1 Entry points

| Entry | Target | After Import |
|--------|--------|----------------|
| Header **Import Geodatabase** | New venue | `createVenue` + `publishGdb` (today) |
| Card **Import GDB** | Existing `venue.id` | `publishGdb(venue.id, …)` only |

Card label (exact copy):

- en: `Import GDB`
- ja: `GDB を取り込む`

### 4.2 Flow (existing venue)

```
Card "Import GDB"
  → file picker (.zip / .gdb.zip)
  → POST /api/gdb/inspect
  → GdbImportDialog(
       inspection,
       initialPlan with venueName forced to venue.name,
       …
     )
  → Import:
       → api.publishGdb(venue.id, blobHash, plan)   // plan.venueName ignored for venue row
       → waitForJob
  → reload gallery; toast excludedLayers if any
```

### 4.3 Dialog behavior when targeting existing venue

- Seed `initialPlan.venueName` from **`venue.name`** (not archive basename), so the summary matches the dataset.
- **Venue name field is read-only** (or omitted with a static label showing the venue name) so the user is not led to believe Import renames the dataset.
- Buildings / layer table / blocking rules unchanged.
- Cancel returns to gallery; no venue mutation.

### 4.4 Error handling

| Failure | Behavior |
|---------|----------|
| Inspect error | Same as today (toast / error phase); no venue touch |
| Publish 400 (conversion) | Show error on dialog via `GdbError`; **do not** `deleteVenue` |
| Publish 404 venue/blob | Surface as GDB/generic error on dialog; no delete |
| Job error after 202 | Same as today: stay on review with error; failed version row remains (IMDF parity) |
| New-venue path publish 400 | Keep today’s orphan `deleteVenue` |

## 5. Architecture

### 5.1 No server changes

`POST /api/gdb/publish` body stays `{ venueId, blobHash, plan }`. Version insert already uses `MAX(seq)+1` for that venue.

### 5.2 Client

**`GalleryPage` orchestration**

Extend GDB flow state with an optional target:

```ts
type GdbTarget =
  | { mode: "create" }
  | { mode: "version"; venueId: number; venueName: string };

type GdbFlow =
  | { phase: "idle" }
  | { phase: "inspecting"; target: GdbTarget }
  | {
      phase: "review";
      target: GdbTarget;
      data: GdbInspectResponse;
      busy: boolean;
      error: GdbError | null;
    }
  | { phase: "error"; message: string; target: GdbTarget };
```

- Header start: `target: { mode: "create" }`.
- Card start: `target: { mode: "version", venueId, venueName }`.
- Single hidden file input (or one per mode — prefer **one** input; stash `pendingTarget` in a ref set before `click()`).
- `publishGdbPlan`:
  - `create`: existing createVenue → publish → orphan delete on sync failure.
  - `version`: publish only with `target.venueId`; never delete venue.

**`DatasetCard`**

New optional callback:

```ts
onImportGdb?: () => void;
```

Render the Import GDB button only when `onImportGdb` is provided (gallery always passes it when signed-in ready).

**`GdbImportDialog`**

New optional prop:

```ts
venueNameLocked?: boolean; // default false
```

When true: venue name control is `readOnly` / `disabled`, still showing `plan.venueName`. Parent passes `initialPlan` already seeded with the venue’s name and `venueNameLocked={target.mode === "version"}`.

**`api.ts`**

No new endpoints. `publishGdb` unchanged.

### 5.3 Boundaries

- Card: presentation + click only.
- GalleryPage: target + inspect/publish orchestration.
- Dialog: plan editing; no knowledge of venue id (only locked name UX).
- Server: unchanged.

## 6. Testing

- **DatasetCard:** with `onImportGdb`, button present and invokes callback; without prop, button absent.
- **GalleryPage:**  
  - Card Import GDB → mock inspect → dialog → Import → `publishGdb` called with **card venue id**; `createVenue` **not** called; `deleteVenue` not called on mocked publish rejection.  
  - Header path still calls `createVenue` (existing test remains).
- **GdbImportDialog:** `venueNameLocked` → venue name input disabled/readOnly; Import still works when plan valid.
- No new server tests required unless a regression appears.

## 7. Success criteria

- From an existing published (or unpublished) venue card, user can import a `.gdb.zip` and get a new version on **that** venue’s slug/id.
- No second venue row is created.
- Failed conversion does not delete the existing venue.
- Header “new venue” GDB flow and IMDF upload flow remain unchanged.
- Focused gallery/dialog tests and typecheck pass.

## 8. Implementation order (for plan)

1. `GdbImportDialog` `venueNameLocked` + test.  
2. `DatasetCard` action + test.  
3. `GalleryPage` target state, card wiring, publish branch, tests.  
4. Verification (vitest gallery + tsc; optional manual smoke).
