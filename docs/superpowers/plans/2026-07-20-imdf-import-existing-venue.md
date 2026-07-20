# IMDF Upload as Version on Existing Venue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload an IMDF ZIP as a new version of an existing gallery venue from the dataset card, and stop leaving orphan venues when the header create path fails after `createVenue`.

**Architecture:** Extend `UploadModal` with optional `target: { venueId, venueName, slug }`. Version mode skips create and locks the name. Create mode adds best-effort `deleteVenue` after a failed post-create step. `DatasetCard` gains **Upload IMDF**; `GalleryPage` passes target when opening the modal from a card.

**Tech Stack:** React, Vitest + Testing Library, existing `api.createVenue` / `uploadVersion` / `deleteVenue` / `waitForJob`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-imdf-import-existing-venue-design.md`.
- **No server changes.**
- Card labels: en `Upload IMDF`, ja `IMDF をアップロード`.
- Version title: en `Upload IMDF version`, ja `IMDF バージョンをアップロード`.
- Version path: never `createVenue`, never `deleteVenue` on failure.
- Create path: orphan `deleteVenue(createdId)` if create succeeded and upload/job fails before done.
- GDB card actions and flows must remain green.
- TDD; commit per task; do not push unless asked.
- Strict TypeScript, no `any`.

## File map

| File | Role |
|------|------|
| `src/gallery/UploadModal.tsx` | `target` prop, orphan cleanup, locked name |
| `src/gallery/upload.test.tsx` | create regression, orphan, version tests |
| `src/gallery/DatasetCard.tsx` | `onUploadImdf` button |
| `src/gallery/DatasetCard.test.tsx` | button visibility/labels |
| `src/gallery/GalleryPage.tsx` | `uploadTarget` state + wiring |

---

### Task 1: UploadModal target + orphan cleanup

**Files:**
- Modify: `src/gallery/UploadModal.tsx`
- Modify: `src/gallery/upload.test.tsx`

**Interfaces:**
- Produces:

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
  target?: UploadModalTarget;
}
```

- [ ] **Step 1: Extend the mock factory** in `upload.test.tsx` to include `deleteVenue`:

```ts
const createVenue = vi.fn();
const uploadVersion = vi.fn();
const waitForJob = vi.fn();
const deleteVenue = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      createVenue: (...a: unknown[]) => createVenue(...a),
      uploadVersion: (...a: unknown[]) => uploadVersion(...a),
      waitForJob: (...a: unknown[]) => waitForJob(...a),
      deleteVenue: (...a: unknown[]) => deleteVenue(...a),
    },
  };
});
```

- [ ] **Step 2: Write failing tests** — append to `upload.test.tsx`:

```tsx
  it("deletes the orphan venue when create succeeds but upload fails", async () => {
    createVenue.mockResolvedValue({ id: 99, slug: "orphan", name: "orphan", createdAt: "" });
    uploadVersion.mockRejectedValue(new Error("network error"));
    deleteVenue.mockResolvedValue(undefined);
    const onPublished = vi.fn();
    const user = userEvent.setup();
    render(<UploadModal locale="en" onClose={() => {}} onPublished={onPublished} />);

    await user.upload(screen.getByLabelText("IMDF ZIP"), zipFile("orphan.zip"));
    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(deleteVenue).toHaveBeenCalledWith(99));
    expect(onPublished).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("deletes the orphan venue when the publish job fails", async () => {
    createVenue.mockResolvedValue({ id: 100, slug: "job-fail", name: "job-fail", createdAt: "" });
    uploadVersion.mockResolvedValue({ jobId: "j-fail" });
    waitForJob.mockResolvedValue({ status: "error", error: "not a ZIP archive" });
    deleteVenue.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<UploadModal locale="en" onClose={() => {}} onPublished={() => {}} />);

    await user.upload(screen.getByLabelText("IMDF ZIP"), zipFile("job-fail.zip"));
    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(deleteVenue).toHaveBeenCalledWith(100));
    expect(await screen.findByText(/not a ZIP archive/)).toBeTruthy();
  });

  it("uploads a new version to an existing venue without createVenue", async () => {
    uploadVersion.mockResolvedValue({ jobId: "jv1" });
    waitForJob.mockResolvedValue({ status: "done" });
    const onPublished = vi.fn();
    const user = userEvent.setup();
    render(
      <UploadModal
        locale="en"
        onClose={() => {}}
        onPublished={onPublished}
        target={{ venueId: 42, venueName: "Existing Station", slug: "existing-station" }}
      />,
    );

    expect(screen.getByRole("dialog", { name: /upload imdf version/i })).toBeTruthy();
    const nameInput = screen.getByLabelText("Dataset name") as HTMLInputElement;
    expect(nameInput.value).toBe("Existing Station");
    expect(nameInput.readOnly || nameInput.disabled).toBe(true);

    await user.upload(screen.getByLabelText("IMDF ZIP"), zipFile("v2.zip"));
    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(screen.getByText("Published")).toBeTruthy());
    expect(createVenue).not.toHaveBeenCalled();
    expect(uploadVersion).toHaveBeenCalled();
    const uploadArgs = uploadVersion.mock.calls[0]!;
    expect(uploadArgs[0]).toBe(42);
    expect(deleteVenue).not.toHaveBeenCalled();
    expect(onPublished).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe(
      "/?dataset=existing-station",
    );
  });

  it("does not delete an existing venue when version upload fails", async () => {
    uploadVersion.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(
      <UploadModal
        locale="en"
        onClose={() => {}}
        onPublished={() => {}}
        target={{ venueId: 42, venueName: "Existing Station", slug: "existing-station" }}
      />,
    );
    await user.upload(screen.getByLabelText("IMDF ZIP"), zipFile("bad.zip"));
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(createVenue).not.toHaveBeenCalled();
    expect(deleteVenue).not.toHaveBeenCalled();
  });
```

Existing happy-path create test must still pass (it will need `deleteVenue` not called on success — assert optional).

- [ ] **Step 3: Run — RED**

Run: `pnpm exec vitest run upload`  
Expected: FAIL — no orphan delete / no target prop.

- [ ] **Step 4: Implement `UploadModal.tsx`**

Add exports and props:

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
  target?: UploadModalTarget;
}
```

UI copy additions:

```ts
  titleVersion: { ja: "IMDF バージョンをアップロード", en: "Upload IMDF version" },
```

Component:

```ts
export function UploadModal({ locale, onClose, onPublished, target }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(target?.venueName ?? "");
  // ...
```

`acceptFile`: only prefill name from filename when `!target` and name is empty.

Title:

```tsx
<h2 className="upload-modal__title">
  {(target ? ui.titleVersion : ui.title)[locale]}
</h2>
```

Dialog `aria-label` should match the title string used.

Name input:

```tsx
<input
  aria-label={ui.nameLabel[locale]}
  value={target ? target.venueName : name}
  disabled={busy}
  readOnly={Boolean(target)}
  onChange={(event) => {
    if (target) return;
    setName(event.target.value);
  }}
/>
```

Publish disabled:

```ts
disabled={busy || !file || (!target && name.trim() === "")}
```

`submit`:

```ts
  const submit = () => {
    if (!file) return;
    if (!target && name.trim() === "") return;
    setPhase({ step: "uploading", fraction: 0 });
    void (async () => {
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
        const { jobId } = await api.uploadVersion(venueId, file, (fraction) => {
          setPhase({ step: "uploading", fraction });
        });
        setPhase({ step: "processing" });
        const job = await api.waitForJob(jobId);
        if (job.status === "done") {
          setPhase({ step: "done", slug });
          onPublished();
        } else {
          if (createdVenueId !== null) {
            try {
              await api.deleteVenue(createdVenueId);
            } catch {
              /* best effort */
            }
          }
          setPhase({ step: "failed", message: publishErrorMessage(job.error) });
        }
      } catch (error) {
        if (createdVenueId !== null) {
          try {
            await api.deleteVenue(createdVenueId);
          } catch {
            /* best effort */
          }
        }
        setPhase({
          step: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  };
```

- [ ] **Step 5: Run — GREEN**

```bash
pnpm exec vitest run upload && pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/gallery/UploadModal.tsx src/gallery/upload.test.tsx
git commit -m "feat(web): IMDF version upload target and create orphan cleanup"
```

---

### Task 2: DatasetCard Upload IMDF button

**Files:**
- Modify: `src/gallery/DatasetCard.tsx`
- Modify: `src/gallery/DatasetCard.test.tsx`

**Interfaces:**
- Produces: `onUploadImdf?: () => void`

- [ ] **Step 1: Failing tests** — append to `DatasetCard.test.tsx`:

```tsx
  it("shows Upload IMDF and calls onUploadImdf when provided", () => {
    const onUploadImdf = vi.fn();
    render(
      <DatasetCard
        venue={venue}
        locale="en"
        onOpen={() => {}}
        onDelete={() => {}}
        onUploadImdf={onUploadImdf}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Upload IMDF" }));
    expect(onUploadImdf).toHaveBeenCalledTimes(1);
  });

  it("hides Upload IMDF when onUploadImdf is omitted", () => {
    render(
      <DatasetCard venue={venue} locale="en" onOpen={() => {}} onDelete={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Upload IMDF" })).toBeNull();
  });

  it("uses Japanese Upload IMDF label when locale is ja", () => {
    render(
      <DatasetCard
        venue={venue}
        locale="ja"
        onOpen={() => {}}
        onDelete={() => {}}
        onUploadImdf={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "IMDF をアップロード" })).toBeTruthy();
  });
```

Reuse existing `venue` fixture and imports from the file.

- [ ] **Step 2: Run — RED**

Run: `pnpm exec vitest run DatasetCard`

- [ ] **Step 3: Implement**

```ts
const ui = {
  // existing...
  uploadImdf: { ja: "IMDF をアップロード", en: "Upload IMDF" },
  importGdb: { ja: "GDB を取り込む", en: "Import GDB" },
  // ...
};

export interface DatasetCardProps {
  // existing...
  onImportGdb?: () => void;
  onUploadImdf?: () => void;
}

export function DatasetCard({
  venue,
  locale,
  onOpen,
  onDelete,
  onImportGdb,
  onUploadImdf,
}: DatasetCardProps) {
  // actions:
        {onUploadImdf ? (
          <button type="button" className="btn-ghost" onClick={onUploadImdf}>
            {ui.uploadImdf[locale]}
          </button>
        ) : null}
        {onImportGdb ? (
          <button type="button" className="btn-ghost" onClick={onImportGdb}>
            {ui.importGdb[locale]}
          </button>
        ) : null}
```

Order: Delete → Upload IMDF → Import GDB → Open (IMDF before GDB is fine; keep both ghosts).

- [ ] **Step 4: Run — GREEN**

```bash
pnpm exec vitest run DatasetCard && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/gallery/DatasetCard.tsx src/gallery/DatasetCard.test.tsx
git commit -m "feat(web): add Upload IMDF action on dataset cards"
```

---

### Task 3: GalleryPage wiring

**Files:**
- Modify: `src/gallery/GalleryPage.tsx`

**Interfaces:**
- Consumes: `UploadModalTarget`, `onUploadImdf`

- [ ] **Step 1: Implement** (no separate gallery test required if UploadModal+Card cover behavior; optional smoke test is nice-to-have only if cheap)

```ts
import { UploadModal, type UploadModalTarget } from "./UploadModal";

const [uploadOpen, setUploadOpen] = useState(false);
const [uploadTarget, setUploadTarget] = useState<UploadModalTarget | null>(null);

const openCreateUpload = () => {
  setUploadTarget(null);
  setUploadOpen(true);
};

const openVersionUpload = (venue: VenueSummary) => {
  setUploadTarget({
    venueId: venue.id,
    venueName: venue.name,
    slug: venue.slug,
  });
  setUploadOpen(true);
};

const closeUpload = () => {
  setUploadOpen(false);
  setUploadTarget(null);
};
```

Header button:

```tsx
<button
  type="button"
  className="btn-primary gallery__upload-btn"
  onClick={openCreateUpload}
>
```

Card:

```tsx
              <DatasetCard
                key={venue.id}
                venue={venue}
                locale={locale}
                onOpen={() => openVenue(venue.slug)}
                onDelete={() => setDeleting(venue)}
                onUploadImdf={() => openVersionUpload(venue)}
                onImportGdb={() => {
                  startGdbImport({
                    mode: "version",
                    venueId: venue.id,
                    venueName: venue.name,
                  });
                }}
              />
```

Modal:

```tsx
      {uploadOpen ? (
        <UploadModal
          locale={locale}
          target={uploadTarget ?? undefined}
          onClose={closeUpload}
          onPublished={() => {
            void reload();
          }}
        />
      ) : null}
```

- [ ] **Step 2: Typecheck + related tests**

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run upload DatasetCard gallery.test
```

Expected: PASS (gallery GDB tests unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/gallery/GalleryPage.tsx
git commit -m "feat(web): wire IMDF version upload from dataset cards"
```

---

### Task 4: Verification

**Files:** none

- [ ] **Step 1:**

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run
```

Expected: all web tests pass (including prior GDB suite).

- [ ] **Step 2 (optional manual):**  
  Card **Upload IMDF** → zip → Published → same slug.  
  Header create with forced failure after create should not leave empty venue (harder to force manually).

- [ ] **Step 3:** Commit only if fixes required.

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| UploadModal target | 1 |
| Create orphan cleanup | 1 |
| Version no create/delete | 1 |
| Locked name + version title | 1 |
| Card Upload IMDF labels | 2 |
| Gallery wiring | 3 |
| No server changes | — |
| GDB untouched | 4 regression |

## Execution handoff

After this plan is committed:

1. **Subagent-Driven (recommended)**  
2. **Inline Execution**
