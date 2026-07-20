# GDB Import as Version on Existing Venue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user import a `.gdb.zip` as a new version of an existing gallery venue via a dataset-card action, without creating a second venue.

**Architecture:** Thin `GdbTarget` on gallery GDB flow state. Card starts import with `{ mode: "version", venueId, venueName }`; header keeps `{ mode: "create" }`. Dialog gains `venueNameLocked` when versioning. `publishGdb` already accepts `venueId` — no server changes.

**Tech Stack:** React, Vitest + Testing Library, existing gallery GDB API client.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-gdb-import-existing-venue-design.md`.
- **No server / API route changes.**
- Header **Import Geodatabase** remains new-venue-only (`createVenue` + orphan delete on sync 400).
- Card **Import GDB** labels: en `Import GDB`, ja `GDB を取り込む`.
- Existing-venue path: never `createVenue`, never `deleteVenue` on publish failure.
- When targeting existing venue: seed plan `venueName` from `venue.name`; lock venue name field in dialog.
- IMDF upload flow untouched.
- TDD; commit per task; do not push unless asked.
- Strict TypeScript, no `any`.

## File map

| File | Role |
|------|------|
| `src/gallery/GdbImportDialog.tsx` | `venueNameLocked` prop |
| `src/gallery/GdbImportDialog.test.tsx` | locked-name test |
| `src/gallery/DatasetCard.tsx` | optional `onImportGdb` + button |
| `src/gallery/DatasetCard.test.tsx` | create if missing; card button tests |
| `src/gallery/GalleryPage.tsx` | `GdbTarget`, card wiring, publish branch |
| `src/gallery/gallery.test.tsx` | version-path + create-path regression |

---

### Task 1: Dialog `venueNameLocked`

**Files:**
- Modify: `src/gallery/GdbImportDialog.tsx`
- Modify: `src/gallery/GdbImportDialog.test.tsx`

**Interfaces:**
- Produces: `venueNameLocked?: boolean` on `GdbImportDialogProps` (default `false`)

- [ ] **Step 1: Write the failing test** — append to `src/gallery/GdbImportDialog.test.tsx`:

```tsx
  it("locks the venue name field when venueNameLocked is true", () => {
    render(
      <GdbImportDialog
        inspection={inspection}
        initialPlan={plan}
        locale="en"
        busy={false}
        error={null}
        venueNameLocked
        onImport={vi.fn()}
        onCancel={() => {}}
      />,
    );
    const input = screen.getByLabelText(/venue name/i) as HTMLInputElement;
    // Prefer getByRole('textbox', { name: /venue name/i }) if label association works.
    expect(input.readOnly || input.disabled).toBe(true);
    expect(input.value).toBe("Station");
  });
```

If the venue input is not labelled for a11y today, first add `aria-label={ui.venueName[locale]}` in the implementation step (required for the query). Existing tests must still pass.

- [ ] **Step 2: Run — RED**

Run: `pnpm exec vitest run GdbImportDialog`  
Expected: FAIL (prop unknown and/or input not readOnly).

- [ ] **Step 3: Implement**

In `GdbImportDialogProps`:

```ts
  /** When true, venue name is shown but not editable (existing-venue version import). */
  venueNameLocked?: boolean;
```

Destructure `venueNameLocked = false`. On the venue name `<input>`:

```tsx
            <input
              ref={venueInputRef}
              type="text"
              className="gdb-dialog__input"
              aria-label={ui.venueName[locale]}
              value={plan.venueName}
              readOnly={venueNameLocked}
              onChange={(event) => {
                if (venueNameLocked) return;
                setPlan((c) => ({ ...c, venueName: event.target.value }));
              }}
            />
```

- [ ] **Step 4: Run — GREEN**

```bash
pnpm exec vitest run GdbImportDialog && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/gallery/GdbImportDialog.tsx src/gallery/GdbImportDialog.test.tsx
git commit -m "feat(web): lock venue name in GDB dialog for version import"
```

---

### Task 2: DatasetCard Import GDB action

**Files:**
- Modify: `src/gallery/DatasetCard.tsx`
- Create: `src/gallery/DatasetCard.test.tsx` (if no card unit test exists)

**Interfaces:**
- Produces: `onImportGdb?: () => void` on `DatasetCardProps`

- [ ] **Step 1: Write failing tests** — `src/gallery/DatasetCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DatasetCard } from "./DatasetCard";
import type { VenueSummary } from "./api";

const venue: VenueSummary = {
  id: 3,
  slug: "tokyo-station",
  name: "Tokyo Station",
  createdAt: "2026-07-20 00:00:00",
  latest: {
    seq: 1,
    status: "published",
    stats: { levels: 2, features: 10 },
    createdAt: "2026-07-20 00:00:00",
  },
};

describe("DatasetCard", () => {
  it("shows Import GDB and calls onImportGdb when provided", () => {
    const onImportGdb = vi.fn();
    render(
      <DatasetCard
        venue={venue}
        locale="en"
        onOpen={() => {}}
        onDelete={() => {}}
        onImportGdb={onImportGdb}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Import GDB" }));
    expect(onImportGdb).toHaveBeenCalledTimes(1);
  });

  it("hides Import GDB when onImportGdb is omitted", () => {
    render(
      <DatasetCard venue={venue} locale="en" onOpen={() => {}} onDelete={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Import GDB" })).toBeNull();
  });

  it("uses Japanese label when locale is ja", () => {
    render(
      <DatasetCard
        venue={venue}
        locale="ja"
        onOpen={() => {}}
        onDelete={() => {}}
        onImportGdb={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "GDB を取り込む" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — RED**

Run: `pnpm exec vitest run DatasetCard`

- [ ] **Step 3: Implement** in `DatasetCard.tsx`:

```tsx
const ui = {
  open: { ja: "開く", en: "Open" },
  delete: { ja: "削除", en: "Delete" },
  importGdb: { ja: "GDB を取り込む", en: "Import GDB" },
  floors: { ja: "フロア", en: "floors" },
  features: { ja: "地物", en: "features" },
  processing: { ja: "処理中・未公開", en: "not published yet" },
} as const;

export interface DatasetCardProps {
  venue: VenueSummary;
  locale: LocaleCode;
  onOpen: () => void;
  onDelete: () => void;
  onImportGdb?: () => void;
}

export function DatasetCard({ venue, locale, onOpen, onDelete, onImportGdb }: DatasetCardProps) {
  // ... existing body ...
      <div className="dataset-card__actions">
        <button type="button" className="btn-ghost" onClick={onDelete} aria-label={`${ui.delete[locale]}: ${venue.name}`}>
          {ui.delete[locale]}
        </button>
        {onImportGdb ? (
          <button type="button" className="btn-ghost" onClick={onImportGdb}>
            {ui.importGdb[locale]}
          </button>
        ) : null}
        <button type="button" className="btn-primary" onClick={onOpen}>
          {ui.open[locale]}
        </button>
      </div>
```

- [ ] **Step 4: Run — GREEN**

```bash
pnpm exec vitest run DatasetCard && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/gallery/DatasetCard.tsx src/gallery/DatasetCard.test.tsx
git commit -m "feat(web): add Import GDB action on dataset cards"
```

---

### Task 3: GalleryPage target orchestration

**Files:**
- Modify: `src/gallery/GalleryPage.tsx`
- Modify: `src/gallery/gallery.test.tsx`

**Interfaces:**
- Consumes: `DatasetCard.onImportGdb`, `GdbImportDialog.venueNameLocked`
- Internal:

```ts
type GdbTarget =
  | { mode: "create" }
  | { mode: "version"; venueId: number; venueName: string };
```

- [ ] **Step 1: Write failing gallery tests** — append in `src/gallery/gallery.test.tsx` (reuse `gdbInspection` / `gdbPlan` fixtures; ensure `listVenues` returns a venue for the card path):

```tsx
  it("imports a geodatabase as a new version of an existing venue", async () => {
    me.mockResolvedValue({ id: 1, username: "daniel", role: "admin" });
    listVenues.mockResolvedValue([
      {
        id: 42,
        slug: "existing-station",
        name: "Existing Station",
        createdAt: "2026-07-20 00:00:00",
        latest: {
          seq: 1,
          status: "published",
          stats: { levels: 2, features: 9 },
          createdAt: "2026-07-20 00:00:00",
        },
      },
    ]);
    inspectGdb.mockResolvedValue({
      blobHash: "b".repeat(64),
      inspection: gdbInspection,
      suggestedPlan: { ...gdbPlan, venueName: "FromArchive" },
    });
    publishGdb.mockResolvedValue({
      jobId: "j2",
      versionId: 2,
      seq: 2,
      excludedLayers: [],
    });
    waitForJob.mockResolvedValue({ status: "done" });

    const user = userEvent.setup();
    const { container } = render(<GalleryPage />);
    await waitFor(() => expect(screen.getByText("Existing Station")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "EN" }));
    await user.click(screen.getByRole("button", { name: "Import GDB" }));

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "Station.gdb.zip", {
      type: "application/zip",
    });
    await user.upload(input, file);

    await waitFor(() => expect(screen.getByRole("button", { name: "Import" })).toBeTruthy());
    // Venue name locked to existing venue
    const nameInput = screen.getByLabelText(/venue name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Existing Station");
    expect(nameInput.readOnly || nameInput.disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(publishGdb).toHaveBeenCalledTimes(1));
    expect(createVenue).not.toHaveBeenCalled();
    expect(publishGdb).toHaveBeenCalledWith(
      42,
      "b".repeat(64),
      expect.objectContaining({ venueName: "Existing Station" }),
    );
    expect(deleteVenue).not.toHaveBeenCalled();
    await waitFor(() => expect(listVenues).toHaveBeenCalledTimes(2));
  });

  it("does not delete an existing venue when version publish fails", async () => {
    me.mockResolvedValue({ id: 1, username: "daniel", role: "admin" });
    listVenues.mockResolvedValue([
      {
        id: 42,
        slug: "existing-station",
        name: "Existing Station",
        createdAt: "2026-07-20 00:00:00",
        latest: null,
      },
    ]);
    inspectGdb.mockResolvedValue({
      blobHash: "c".repeat(64),
      inspection: gdbInspection,
      suggestedPlan: gdbPlan,
    });
    publishGdb.mockRejectedValue({
      code: "gdb_conversion_failed",
      message: "nope",
    });

    const user = userEvent.setup();
    const { container } = render(<GalleryPage />);
    await waitFor(() => expect(screen.getByText("Existing Station")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "EN" }));
    await user.click(screen.getByRole("button", { name: "Import GDB" }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(
      input,
      new File([new Uint8Array([1])], "x.gdb.zip", { type: "application/zip" }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Import" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(publishGdb).toHaveBeenCalled());
    expect(deleteVenue).not.toHaveBeenCalled();
    expect(createVenue).not.toHaveBeenCalled();
  });
```

Ensure top-of-file mock factory already exposes `deleteVenue` (it does from prior GDB work). Keep the existing header create-venue test green.

- [ ] **Step 2: Run — RED**

Run: `pnpm exec vitest run gallery.test`  
Expected: FAIL — no card Import GDB / still createVenue.

- [ ] **Step 3: Implement GalleryPage**

Replace GDB types and handlers with:

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

// ref holds target chosen before the OS file dialog returns
const gdbTargetRef = useRef<GdbTarget>({ mode: "create" });

const startGdbImport = (target: GdbTarget = { mode: "create" }) => {
  setGdbNotice(null);
  gdbTargetRef.current = target;
  gdbInputRef.current?.click();
};

const onGdbFile = (file: File | undefined) => {
  if (!file) return;
  const target = gdbTargetRef.current;
  setGdbNotice(null);
  setGdbFlow({ phase: "inspecting", target });
  void (async () => {
    try {
      const data = await api.inspectGdb(file);
      let suggestedPlan = data.suggestedPlan;
      if (target.mode === "version") {
        suggestedPlan = { ...suggestedPlan, venueName: target.venueName };
      }
      setGdbFlow({
        phase: "review",
        target,
        data: { ...data, suggestedPlan },
        busy: false,
        error: null,
      });
    } catch (err) {
      setGdbFlow({
        phase: "error",
        target,
        message: gdbErrorMessage(err as GdbError, locale),
      });
    }
  })();
};

const publishGdbPlan = (plan: GdbMappingPlan) => {
  if (gdbFlow.phase !== "review") return;
  const data = gdbFlow.data;
  const target = gdbFlow.target;
  setGdbFlow({ phase: "review", target, data, busy: true, error: null });
  void (async () => {
    let createdVenueId: number | null = null;
    try {
      let venueId: number;
      if (target.mode === "version") {
        venueId = target.venueId;
      } else {
        const venue = await api.createVenue(plan.venueName.trim());
        createdVenueId = venue.id;
        venueId = venue.id;
      }
      const published = await api.publishGdb(venueId, data.blobHash, plan);
      const job = await api.waitForJob(published.jobId);
      if (job.status === "done") {
        const skipped = published.excludedLayers ?? [];
        if (skipped.length > 0) {
          const sample = skipped[0]!.layer;
          setGdbNotice(ui.publishedWithSkips[locale](skipped.length, sample));
        } else {
          setGdbNotice(null);
        }
        setGdbFlow({ phase: "idle" });
        if (gdbInputRef.current) gdbInputRef.current.value = "";
        gdbTargetRef.current = { mode: "create" };
        await reload();
      } else {
        setGdbFlow({
          phase: "review",
          target,
          data,
          busy: false,
          error: { code: "gdb_conversion_failed", message: job.error },
        });
      }
    } catch (err) {
      // Orphan cleanup only for venues we just created in this attempt.
      if (createdVenueId !== null) {
        try {
          await api.deleteVenue(createdVenueId);
        } catch {
          /* best effort */
        }
      }
      setGdbFlow({
        phase: "review",
        target,
        data,
        busy: false,
        error: err as GdbError,
      });
    }
  })();
};

const cancelGdbImport = () => {
  setGdbFlow({ phase: "idle" });
  gdbTargetRef.current = { mode: "create" };
  if (gdbInputRef.current) gdbInputRef.current.value = "";
};
```

Wire header button:

```tsx
<button type="button" className="chip" onClick={() => startGdbImport({ mode: "create" })}>
```

Wire card:

```tsx
              <DatasetCard
                key={venue.id}
                venue={venue}
                locale={locale}
                onOpen={() => {
                  openVenue(venue.slug);
                }}
                onDelete={() => {
                  setDeleting(venue);
                }}
                onImportGdb={() => {
                  startGdbImport({
                    mode: "version",
                    venueId: venue.id,
                    venueName: venue.name,
                  });
                }}
              />
```

Dialog:

```tsx
      {gdbFlow.phase === "review" ? (
        <GdbImportDialog
          inspection={gdbFlow.data.inspection}
          initialPlan={gdbFlow.data.suggestedPlan}
          locale={locale}
          busy={gdbFlow.busy}
          error={gdbFlow.error}
          venueNameLocked={gdbFlow.target.mode === "version"}
          onImport={publishGdbPlan}
          onCancel={cancelGdbImport}
        />
      ) : null}
```

- [ ] **Step 4: Run — GREEN**

```bash
pnpm exec vitest run gallery.test DatasetCard GdbImportDialog
pnpm exec tsc --noEmit
```

Expected: all PASS; existing header import test still calls `createVenue`.

- [ ] **Step 5: Commit**

```bash
git add src/gallery/GalleryPage.tsx src/gallery/gallery.test.tsx
git commit -m "feat(web): import GDB as new version on existing venue"
```

---

### Task 4: Verification

**Files:** none (verification only)

- [ ] **Step 1:**

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run gallery DatasetCard GdbImportDialog
```

Optional full web: `pnpm exec vitest run`

- [ ] **Step 2 (optional manual):**  
  Sign in → card **Import GDB** → Tokyo zip → Import → same slug gains new version / updated stats; no duplicate venue. Header import still creates a new venue.

- [ ] **Step 3:** Commit only if smoke-driven fixes were required.

---

## Spec coverage

| Spec | Task |
|------|------|
| Card Import GDB labels | 2 |
| Header create-only | 3 (unchanged path) |
| publish without createVenue | 3 |
| no deleteVenue on version fail | 3 |
| venueName seed + locked | 1, 3 |
| excludedLayers toast reuse | 3 (existing success path) |
| No server changes | — |
| Tests | 1–4 |

## Execution handoff

Plan complete after commit. Choose:

1. **Subagent-Driven (recommended)** — `superpowers:subagent-driven-development`  
2. **Inline Execution** — `superpowers:executing-plans`
