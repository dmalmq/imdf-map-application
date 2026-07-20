# Kiriko: Viewer Floor-Merge by Ordinal

**Date:** 2026-07-20
**Status:** Approved (design direction)
**Depends on:** viewer level model (`LoadedVenue.levels`, `renderFeaturesByLevel`, `boundsByLevel`), `viewerReducer`, `FloorStack`, `IndoorMap`, `useIssuePins`.

## 1. Context

GDB import synthesizes one IMDF level per `(building, ordinal)` (`resolveOrCreateLevel`, keyed by `buildingUuid\0ordinal`). This is correct IMDF modeling — a level belongs to one building — but a multi-building venue like Tokyo Station (~15 buildings) produces ~15 distinct levels at ordinal 0, so the floor selector shows ~15 `1F` buttons (Tokyo shows ~300 buttons total) and selecting one shows only that building's geometry.

`LoadedVenue.levels` is one `ViewerLevel` per IMDF level, sorted descending by ordinal. `renderFeaturesByLevel` and `boundsByLevel` are keyed by level id. The viewer tracks a single `selectedLevelId`. Facilities and routing already key off **ordinal** (`activeOrdinalFor(levelId)`), so they are unaffected.

## 2. Goal

Present one floor per distinct ordinal in the viewer: the floor selector shows a single button per ordinal, and selecting a floor renders every same-ordinal level's geometry (all buildings on that floor) together. No changes to the data model, import, normalize, hydrate, or bundle.

## 3. Scope decisions (locked in brainstorming)

- **Approach:** viewer render/UI grouping by ordinal. `selectedLevelId` stays a real level id; its ordinal defines the displayed floor.
- **Merged button label:** most common source `short_name` among same-ordinal levels; ties broken by the representative (first in descending-ordinal order).
- **Universal:** single-building/IMDF venues (one level per ordinal) are a visual no-op.

### Non-goals
Data-model / `normalizeVenue` / `hydrateVenue` / bundle / GDB-import changes; per-building floor sub-selection; changing route/facility ordinal logic; `color2` unit fills (separate phase).

## 4. Design

### 4.1 `groupLevelsByOrdinal` (new pure helper)

`src/state/floorGroups.ts`:

```ts
export interface FloorGroup {
  ordinal: number;
  representativeLevelId: string; // first level at this ordinal (levels are desc-sorted)
  levelIds: string[];            // every level id sharing this ordinal
  label: Record<string, string>;
  shortName: Record<string, string>;
}
export function groupLevelsByOrdinal(levels: ViewerLevel[]): FloorGroup[];
export function ordinalOfLevel(levels: ViewerLevel[], levelId: string): number | null;
export function levelIdsForOrdinal(levels: ViewerLevel[], ordinal: number): string[];
```

- One group per distinct ordinal, preserving input (descending) order.
- `representativeLevelId` = first level encountered at that ordinal.
- `label`/`shortName` = the most frequent `short_name`/`label` object among the group's levels (by the localized value; compared as JSON for determinism); tie → representative's.
- IMDF single-level venues → 1:1 groups.

### 4.2 FloorStack

Render one button per `FloorGroup`:
- `active` when `ordinalOfLevel(levels, selectedLevelId) === group.ordinal`.
- `onClick` → `onSelect(group.representativeLevelId)`.
- Label from the group's merged `shortName`/`label`.

Props unchanged (`levels`, `selectedLevelId`, `onSelect`); grouping computed inside from `levels`.

### 4.3 Rendering — `buildRenderFeatures(venue, levelId)`

Union `renderFeaturesByLevel` for **every level whose ordinal equals `levelId`'s ordinal**, not just `levelId`. Context features (venue-level) already always included. Existing per-feature-id dedupe (`seen`) handles overlaps. When `levelId`'s ordinal can't be resolved, fall back to the single-level lookup (current behavior).

### 4.4 Bounds — `fitLevelBounds` / `boundsByLevel`

`fitLevelBounds` (IndoorMap) unions `boundsByLevel` across the ordinal group so "fit floor" frames all buildings on the floor. Fall back to the single level's bounds when only one exists.

### 4.5 Issue pins — `useIssuePins`

Change the filter from `pin.levelId === levelId` to "pin's level ordinal === selected level's ordinal" (via a `levelsById` ordinal lookup). Pins for any building on the active floor show.

### 4.6 Unchanged

`selectedLevelId` semantics (a real level id), `select_level`/`select_feature`, `pickInitialLevelId`, `matchLevelId`, deep-link `?level=`, `activeOrdinalFor`, facilities, routing.

## 5. Testing

- **`groupLevelsByOrdinal`:** dedupe by ordinal; representative = first desc; most-common-label tie-break; descending order preserved; single-level no-op; `ordinalOfLevel`/`levelIdsForOrdinal` correctness.
- **FloorStack:** 15 levels at ordinal 0 → one button; `active` tracks the selected level's ordinal; `onSelect` fires the representative id; distinct ordinals each get a button in descending order.
- **`buildRenderFeatures`:** unions features from all same-ordinal levels; excludes other ordinals; dedupes shared ids; context features present.
- **Bounds:** union across the group frames all member levels.
- **`useIssuePins`:** a pin on a sibling same-ordinal level shows when that floor is selected; pins on other ordinals hidden.
- **App integration (light):** a multi-building venue renders a deduped floor stack.

## 6. Success criteria

- Tokyo shows one button per ordinal (~12–16) instead of ~300.
- Selecting `1F` renders every building's `1F` geometry and frames them.
- Issue pins, facilities, routing, deep-links unaffected.
- Single-building IMDF venues render identically to today.
- `tsc` + web vitest green.

## 7. Implementation order

1. `groupLevelsByOrdinal` helper + tests.
2. FloorStack grouping + tests.
3. `buildRenderFeatures` ordinal union + tests.
4. IndoorMap bounds union + `useIssuePins` ordinal filter + tests.
5. Verification + Tokyo smoke.
