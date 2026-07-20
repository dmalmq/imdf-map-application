# Viewer Floor-Merge by Ordinal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The viewer's floor selector shows one button per ordinal; selecting a floor renders every same-ordinal level (all buildings on that floor). Viewer-only; no data-model/import changes.

**Architecture:** A pure `groupLevelsByOrdinal` helper drives FloorStack (one button per ordinal). `buildRenderFeatures`, `fitLevelBounds`, and `useIssuePins` operate on the selected level's *ordinal* (union of same-ordinal levels) instead of a single level id. `selectedLevelId` stays a real level id.

**Tech Stack:** React, MapLibre, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-floor-merge-design.md`.
- No changes to `normalizeVenue`, `hydrateVenue`, bundle, GDB import, `viewerReducer` level semantics, deep-links, facilities, or routing.
- Merged button label = most common source `short_name` among same-ordinal levels; tie → representative (first in descending order).
- `selectedLevelId` remains a real level id whose ordinal defines the floor.
- Single-building/IMDF venues must render identically (1:1 grouping no-op).
- TDD; `pnpm exec tsc --noEmit` + `pnpm exec vitest run`; commit per task; no push.

## File map

| File | Role |
|------|------|
| `src/state/floorGroups.ts` (new) | `groupLevelsByOrdinal`, `ordinalOfLevel`, `levelIdsForOrdinal` |
| `src/state/floorGroups.test.ts` (new) | helper tests |
| `src/components/FloorStack.tsx` | one button per group |
| `src/components/components.test.tsx` | FloorStack grouping tests |
| `src/map/buildRenderFeatures.ts` | union same-ordinal levels |
| `src/map/buildRenderFeatures.test.ts` | union tests (create if absent) |
| `src/map/IndoorMap.tsx` | `fitLevelBounds` ordinal union |
| `src/map/useIssuePins.ts` | ordinal-based pin filter |
| `src/map/useIssuePins.test.ts` | pin ordinal test |

---

### Task 1: `groupLevelsByOrdinal` helper

**Files:** Create `src/state/floorGroups.ts`, `src/state/floorGroups.test.ts`.

**Interfaces (Produces):**

```ts
export interface FloorGroup {
  ordinal: number;
  representativeLevelId: string;
  levelIds: string[];
  label: Record<string, string>;
  shortName: Record<string, string>;
}
export function groupLevelsByOrdinal(levels: ViewerLevel[]): FloorGroup[];
export function ordinalOfLevel(levels: ViewerLevel[], levelId: string): number | null;
export function levelIdsForOrdinal(levels: ViewerLevel[], ordinal: number): string[];
```

- [ ] **Step 1: Failing tests** — `floorGroups.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ViewerLevel } from "../imdf/types";
import { groupLevelsByOrdinal, ordinalOfLevel, levelIdsForOrdinal } from "./floorGroups";

function lvl(id: string, ordinal: number, short: string): ViewerLevel {
  return { id, ordinal, label: { en: short }, shortName: { en: short } };
}

// Descending-ordinal order, as normalizeVenue produces.
const TOKYO: ViewerLevel[] = [
  lvl("a2", 1, "2F"), lvl("b2", 1, "F2"),
  lvl("a1", 0, "1F"), lvl("b1", 0, "1F"), lvl("c1", 0, "地上1階"),
  lvl("aB1", -1, "B1"),
];

describe("groupLevelsByOrdinal", () => {
  it("collapses same-ordinal levels into one descending group each", () => {
    const groups = groupLevelsByOrdinal(TOKYO);
    expect(groups.map((g) => g.ordinal)).toEqual([1, 0, -1]);
    expect(groups[1]!.levelIds).toEqual(["a1", "b1", "c1"]);
    expect(groups[1]!.representativeLevelId).toBe("a1");
  });

  it("labels the group with the most common short_name (tie → representative)", () => {
    const groups = groupLevelsByOrdinal(TOKYO);
    expect(groups[1]!.shortName["en"]).toBe("1F"); // 2× "1F" beats 1× "地上1階"
  });

  it("is a 1:1 no-op for single-level-per-ordinal venues", () => {
    const imdf = [lvl("x", 1, "2F"), lvl("y", 0, "1F")];
    const groups = groupLevelsByOrdinal(imdf);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.representativeLevelId)).toEqual(["x", "y"]);
  });

  it("resolves ordinal of a level and level ids for an ordinal", () => {
    expect(ordinalOfLevel(TOKYO, "b1")).toBe(0);
    expect(ordinalOfLevel(TOKYO, "missing")).toBeNull();
    expect(levelIdsForOrdinal(TOKYO, 0)).toEqual(["a1", "b1", "c1"]);
  });
});
```

- [ ] **Step 2: RED** — `pnpm exec vitest run src/state/floorGroups.test.ts`.

- [ ] **Step 3: Implement `floorGroups.ts`**

```ts
import type { ViewerLevel } from "../imdf/types";

export interface FloorGroup {
  ordinal: number;
  representativeLevelId: string;
  levelIds: string[];
  label: Record<string, string>;
  shortName: Record<string, string>;
}

/** Most frequent record among `records` by JSON value; ties → first. */
function mostCommon(records: Record<string, string>[]): Record<string, string> {
  const counts = new Map<string, number>();
  const first = new Map<string, Record<string, string>>();
  let bestKey: string | null = null;
  let bestCount = 0;
  for (const rec of records) {
    const key = JSON.stringify(rec);
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    if (!first.has(key)) first.set(key, rec);
    if (next > bestCount) {
      bestCount = next;
      bestKey = key;
    }
  }
  return bestKey === null ? {} : first.get(bestKey)!;
}

export function groupLevelsByOrdinal(levels: ViewerLevel[]): FloorGroup[] {
  const order: number[] = [];
  const byOrdinal = new Map<number, ViewerLevel[]>();
  for (const level of levels) {
    const bucket = byOrdinal.get(level.ordinal);
    if (bucket === undefined) {
      byOrdinal.set(level.ordinal, [level]);
      order.push(level.ordinal);
    } else {
      bucket.push(level);
    }
  }
  return order.map((ordinal) => {
    const members = byOrdinal.get(ordinal)!;
    return {
      ordinal,
      representativeLevelId: members[0]!.id,
      levelIds: members.map((m) => m.id),
      label: mostCommon(members.map((m) => m.label)),
      shortName: mostCommon(members.map((m) => m.shortName)),
    };
  });
}

export function ordinalOfLevel(levels: ViewerLevel[], levelId: string): number | null {
  return levels.find((l) => l.id === levelId)?.ordinal ?? null;
}

export function levelIdsForOrdinal(levels: ViewerLevel[], ordinal: number): string[] {
  return levels.filter((l) => l.ordinal === ordinal).map((l) => l.id);
}
```

- [ ] **Step 4: GREEN** — `pnpm exec vitest run src/state/floorGroups.test.ts && pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/state/floorGroups.ts src/state/floorGroups.test.ts
git commit -m "feat(web): groupLevelsByOrdinal floor helper"
```

---

### Task 2: FloorStack one button per ordinal

**Files:** Modify `src/components/FloorStack.tsx`, `src/components/components.test.tsx`.

**Interfaces:** Consumes `groupLevelsByOrdinal`, `ordinalOfLevel`. Props unchanged.

- [ ] **Step 1: Failing tests** — add to `components.test.tsx` FloorStack describe:

```ts
it("shows one button per ordinal for a multi-building venue", () => {
  const levels = [
    { id: "a1", ordinal: 0, label: { en: "1F" }, shortName: { en: "1F" } },
    { id: "b1", ordinal: 0, label: { en: "1F" }, shortName: { en: "1F" } },
    { id: "c1", ordinal: 0, label: { en: "地上1階" }, shortName: { en: "地上1階" } },
    { id: "aB1", ordinal: -1, label: { en: "B1" }, shortName: { en: "B1" } },
  ];
  render(<FloorStack levels={levels} selectedLevelId="b1" locale="en" manifestLanguage="ja-JP" onSelect={() => {}} />);
  expect(screen.getAllByRole("button", { name: "1F" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "1F" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "B1" })).toBeTruthy();
});

it("selects the representative level id for a tapped floor", () => {
  const onSelect = vi.fn();
  const levels = [
    { id: "a1", ordinal: 0, label: { en: "1F" }, shortName: { en: "1F" } },
    { id: "b1", ordinal: 0, label: { en: "1F" }, shortName: { en: "1F" } },
  ];
  render(<FloorStack levels={levels} selectedLevelId="a1" locale="en" manifestLanguage="ja-JP" onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("button", { name: "1F" }));
  expect(onSelect).toHaveBeenCalledWith("a1");
});
```

Keep the existing FloorStack tests (single-level-per-ordinal) — they must still pass unchanged (1:1 grouping).

- [ ] **Step 2: RED** — `pnpm exec vitest run components.test`.

- [ ] **Step 3: Implement** — in `FloorStack.tsx`, build groups and render per group:

```ts
import { groupLevelsByOrdinal, ordinalOfLevel } from "../state/floorGroups";
// ...
export function FloorStack({ levels, selectedLevelId, locale, manifestLanguage, onSelect }: FloorStackProps) {
  const groups = groupLevelsByOrdinal(levels);
  const selectedOrdinal = ordinalOfLevel(levels, selectedLevelId);
  return (
    <div className="floor-stack" role="group" aria-label={ui.group[locale]}>
      {groups.map((group) => {
        const selected = group.ordinal === selectedOrdinal;
        const label = shortLabelForGroup(group, locale, manifestLanguage);
        const full = localizedLabel(group.label, locale, group.representativeLevelId, manifestLanguage);
        return (
          <button
            key={group.representativeLevelId}
            type="button"
            className={selected ? "floor-stack__btn floor-stack__btn--active" : "floor-stack__btn"}
            aria-pressed={selected}
            aria-label={full}
            title={full}
            onClick={() => onSelect(group.representativeLevelId)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
```

Add `shortLabelForGroup(group, locale, manifestLanguage)` mirroring `shortLabelFor` but reading `group.shortName`/`group.label` (keep or delete the old `shortLabelFor` if now unused). `key` uses `representativeLevelId` (unique per ordinal).

- [ ] **Step 4: GREEN** — `pnpm exec vitest run components.test && pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/components/FloorStack.tsx src/components/components.test.tsx
git commit -m "feat(web): FloorStack one button per ordinal"
```

---

### Task 3: `buildRenderFeatures` unions same-ordinal levels

**Files:** Modify `src/map/buildRenderFeatures.ts`; add/extend `src/map/buildRenderFeatures.test.ts`.

- [ ] **Step 1: Failing test** — assert features from two same-ordinal levels both render when either is selected:

```ts
import { describe, expect, it } from "vitest";
import { buildRenderFeatures } from "./buildRenderFeatures";
// build a minimal LoadedVenue with levels a1/b1 at ordinal 0 (each one render feature)
// and c2 at ordinal 1 (one feature).
it("unions render features across same-ordinal levels", () => {
  const venue = makeVenue();
  const fc = buildRenderFeatures(venue, "a1");
  const ids = fc.features.map((f) => f.properties?.["__feature_id"]);
  expect(ids).toContain("feat-a1");
  expect(ids).toContain("feat-b1"); // sibling same-ordinal level included
  expect(ids).not.toContain("feat-c2"); // other ordinal excluded
});
```

(Write `makeVenue()` inline with `levels`, `renderFeaturesByLevel` for `a1`/`b1`/`c2`, `featuresById`, empty `boundsByLevel`/`searchEntries`/`warnings`, a `venue` context feature.)

- [ ] **Step 2: RED** — `pnpm exec vitest run buildRenderFeatures`.

- [ ] **Step 3: Implement** — replace the single `renderFeaturesByLevel.get(levelId)` lookup with a union over all same-ordinal level ids:

```ts
import { levelIdsForOrdinal, ordinalOfLevel } from "../state/floorGroups";
// ...
const ordinal = ordinalOfLevel(venue.levels, levelId);
const groupLevelIds = ordinal === null ? [levelId] : levelIdsForOrdinal(venue.levels, ordinal);
for (const id of groupLevelIds) {
  const levelCollection = venue.renderFeaturesByLevel.get(id);
  if (levelCollection == null) continue;
  for (const feature of levelCollection.features) {
    // ...existing per-feature dedupe + push...
  }
}
```

Keep the existing context-feature block and dedupe (`seen`) exactly as-is.

- [ ] **Step 4: GREEN** — `pnpm exec vitest run buildRenderFeatures && pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/map/buildRenderFeatures.ts src/map/buildRenderFeatures.test.ts
git commit -m "feat(web): render all same-ordinal levels for the active floor"
```

---

### Task 4: Bounds union + issue-pin ordinal filter

**Files:** Modify `src/map/IndoorMap.tsx` (`fitLevelBounds`), `src/map/useIssuePins.ts`; extend `src/map/useIssuePins.test.ts` (and IndoorMap tests if bounds are asserted).

- [ ] **Step 1: Failing test** — in `useIssuePins.test.ts`, a pin on a sibling same-ordinal level shows when that floor is selected:

```ts
// levels: "1f"(ord 0), "1f-b"(ord 0), "2f"(ord 1). Pins: one on "1f-b".
// Select "1f" → the "1f-b" pin renders (same ordinal). Select "2f" → it does not.
```

Model it on the existing useIssuePins tests (they render the hook via a harness and count `.issue-pin` elements).

- [ ] **Step 2: RED** — `pnpm exec vitest run useIssuePins`.

- [ ] **Step 3: Implement**
  - `useIssuePins.ts`: compute the selected ordinal and filter by it:

    ```ts
    import { ordinalOfLevel } from "../state/floorGroups";
    // ...
    const selectedOrdinal = ordinalOfLevel(levels, levelId);
    const floorPins = pins
      .filter((pin) => {
        const pinOrdinal = levelsById.get(pin.levelId)?.ordinal ?? null;
        return selectedOrdinal !== null ? pinOrdinal === selectedOrdinal : pin.levelId === levelId;
      })
      .slice()
      .sort((a, b) => a.pinNumber - b.pinNumber);
    ```
  - `IndoorMap.tsx` `fitLevelBounds`: union `boundsByLevel` across `levelIdsForOrdinal(venue.levels, activeOrdinalFor(venue, levelId))`; fall back to the single level's bounds when only one exists or the ordinal is null. Keep existing padding/max-zoom.

- [ ] **Step 4: GREEN** — `pnpm exec vitest run src/map && pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/map/useIssuePins.ts src/map/useIssuePins.test.ts src/map/IndoorMap.tsx src/map/IndoorMap.test.tsx
git commit -m "feat(web): floor bounds union + issue pins by ordinal"
```

---

### Task 5: Verification + Tokyo smoke

**Files:** none (fixes only).

- [ ] **Step 1:** `pnpm exec tsc --noEmit` and `pnpm exec vitest run` — all green.
- [ ] **Step 2: Manual smoke** (backend + web up) — open the Tokyo venue (publish via combined GDB import or an existing `tokyo-*` dataset). Confirm: the floor stack shows ~12–16 buttons (one per ordinal), selecting `1F` renders every building's `1F` and fits to all of them, issue pins/facilities/routing still work, and a single-building IMDF venue looks unchanged. Screenshot.
- [ ] **Step 3:** Commit any fixes.

---

## Spec coverage

| Spec section | Task |
|---|---|
| §4.1 groupLevelsByOrdinal | 1 |
| §4.2 FloorStack | 2 |
| §4.3 buildRenderFeatures | 3 |
| §4.4 bounds + §4.5 issue pins | 4 |
| §5–6 testing + success | 1–5 |

## Self-review

- Types/names consistent: `FloorGroup`, `groupLevelsByOrdinal`, `ordinalOfLevel`, `levelIdsForOrdinal`, `representativeLevelId`.
- `selectedLevelId` stays a real level id everywhere; no reducer/deep-link changes.
- Facilities/routing untouched (already ordinal-based).
- Single-level venues: 1:1 grouping keeps current behavior (existing FloorStack tests unchanged).

## Execution handoff

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between.
2. **Inline Execution** — batch with checkpoints.
