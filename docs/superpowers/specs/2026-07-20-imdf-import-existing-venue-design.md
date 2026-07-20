# Kiriko: IMDF Upload as New Version of Existing Venue

**Date:** 2026-07-20  
**Status:** Approved (design direction)  
**Depends on:** Gallery upload modal + `POST /api/venues/:id/versions`; mirrors GDB card version import (`2026-07-20-gdb-import-existing-venue-design.md`).

## 1. Context

IMDF publishing today:

1. Header **Open local data** opens `UploadModal`.
2. User picks an IMDF `.zip` and a dataset name.
3. Modal always calls `api.createVenue(name)` then `api.uploadVersion(venue.id, file)`.
4. On job failure after `createVenue`, the **empty venue is left behind** (unlike the GDB create path, which deletes the orphan on sync failure).

The server already supports versioning: `POST /api/venues/:id/versions` inserts `MAX(seq)+1` with `source_kind='imdf'`. Dataset cards already expose **Import GDB** for geodatabase versions. IMDF has no card-level “add version” action.

## 2. Goals

- Dataset card action **Upload IMDF** (bilingual) that opens the existing upload UI targeted at that venue.
- Version path: `uploadVersion(venueId, file)` only — no `createVenue`, no `deleteVenue` on failure.
- Create path (header): keep name + file form; **add orphan cleanup** — if `createVenue` succeeded and a later step fails before `done`, best-effort `deleteVenue(createdId)`.
- Done state opens the correct slug (existing venue slug on version path; new slug on create path).
- No server API changes.

## 3. Non-goals

- GDB changes (already shipped).
- Renaming venues from the upload modal.
- Version history browser / picking which version to open from the card.
- Changing max upload size, publish job semantics, or IMDF validation.
- Merging IMDF and GDB into one picker.

## 4. Product and interaction

### 4.1 Entry points

| Entry | Mode | Behavior |
|--------|------|----------|
| Header **Open local data** | create | Name field editable; `createVenue` + `uploadVersion`; orphan delete on failure after create |
| Card **Upload IMDF** | version | Name locked to `venue.name`; `uploadVersion(venue.id)` only |

Card labels (exact):

- en: `Upload IMDF`
- ja: `IMDF をアップロード`

### 4.2 Version flow

```
Card "Upload IMDF"
  → UploadModal target={ venueId, venueName, slug }
  → pick IMDF zip (name field read-only showing venueName)
  → Publish → uploadVersion(venueId, file) → waitForJob
  → done → Open ?dataset=slug ; onPublished → gallery reload
```

### 4.3 Create flow (updated failure handling)

```
Header modal (no target)
  → pick zip + name
  → createVenue
  → uploadVersion(newId)
  → waitForJob
  on any failure after createVenue returned:
      best-effort deleteVenue(newId)
      show failed phase (do not call onPublished)
```

If failure happens **before** `createVenue` completes, nothing to delete.

### 4.4 Dialog copy

- Create title stays **Open local data** / ローカルデータを開く.
- Version title: en `Upload IMDF version`, ja `IMDF バージョンをアップロード` (or reuse create title with locked name — prefer distinct title so mode is obvious).
- Publish / progress / error strings unchanged.

## 5. Architecture

### 5.1 No server changes

`registerUploadRoute` already versions by venue id.

### 5.2 `UploadModal`

```ts
export interface UploadModalTarget {
  venueId: number;
  venueName: string;
  slug: string;
}

export interface UploadModalProps {
  locale: LocaleCode;
  onClose: () => void;
  onPublished: () => void;
  /** When set, publish a new version of this venue (no createVenue). */
  target?: UploadModalTarget;
}
```

Submit logic:

```ts
let createdVenueId: number | null = null;
try {
  let venueId: number;
  let slug: string;
  if (target) {
    venueId = target.venueId;
    slug = target.slug;
  } else {
    const venue = await api.createVenue(name.trim());
    createdVenueId = venue.id;
    venueId = venue.id;
    slug = venue.slug;
  }
  const { jobId } = await api.uploadVersion(venueId, file, onProgress);
  // waitForJob...
  // done with slug
} catch / job error:
  if (createdVenueId !== null) {
    try { await api.deleteVenue(createdVenueId); } catch { /* best effort */ }
  }
  setPhase failed
```

UI:

- When `target` set: name input `readOnly`/`disabled`, value `target.venueName` (ignore file-based name prefill for the locked field; still accept file).
- Enable Publish when `file` set; create mode still requires non-empty name.
- Prefill name from file **only** in create mode.

### 5.3 `DatasetCard`

```ts
onUploadImdf?: () => void;
```

Button next to Import GDB (ghost), labels above. Render only if callback provided.

### 5.4 `GalleryPage`

```ts
const [uploadTarget, setUploadTarget] = useState<UploadModalTarget | null>(null);
// header: setUploadTarget(null); setUploadOpen(true)
// card: setUploadTarget({ venueId, venueName, slug }); setUploadOpen(true)
// close: setUploadOpen(false); setUploadTarget(null)
// <UploadModal target={uploadTarget ?? undefined} ... />
```

### 5.5 API client

No new methods. Ensure `deleteVenue` remains available (already used by GDB/gallery).

## 6. Testing

### UploadModal

- **Create (regression):** file + name → createVenue + uploadVersion + done; open href uses new slug.
- **Create orphan cleanup:** createVenue resolves; uploadVersion rejects → `deleteVenue` called with created id; failed UI shown; `onPublished` not called.
- **Create orphan cleanup on job error:** create + upload ok; waitForJob error → deleteVenue called.
- **Version:** render with `target`; name locked to venueName; Publish → uploadVersion(target.venueId, …); createVenue not called; deleteVenue not called on upload failure; done open href uses target.slug.

### DatasetCard

- `onUploadImdf` shows **Upload IMDF** / **IMDF をアップロード** and fires callback.
- Omitted → button hidden.

### GalleryPage (light)

- Optional: card Upload IMDF opens modal (if easy with existing harness). Prefer covering behavior in UploadModal + DatasetCard unit tests; gallery wiring smoke via typecheck + one gallery test if low cost.

## 7. Success criteria

- Existing venue card can receive a new IMDF version without a second venue row.
- Failed version upload does not delete the existing venue.
- Failed **new** IMDF publish after create no longer leaves an empty venue.
- Header create happy path unchanged aside from orphan cleanup on failure.
- Focused tests + `tsc` pass; GDB card actions still work.

## 8. Implementation order

1. `UploadModal` target prop + orphan cleanup + tests.  
2. `DatasetCard` Upload IMDF button + tests.  
3. `GalleryPage` wiring.  
4. Verification.
