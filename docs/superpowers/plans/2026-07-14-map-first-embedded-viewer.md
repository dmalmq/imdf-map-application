# Map-first Embedded Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace persistent viewer chrome with a map-first hamburger/search shell, authoritative map filtering, visitor-facing selected-place content, and optional versioned ZIP enrichment.

**Architecture:** Add one shared category predicate consumed by search, reducer state transitions, and marker collection. Parse optional `viewer-enrichment.json` in the existing worker into a normalized `LoadedVenue` map, then resolve selected-feature/anchor/core fields through one pure content resolver. Keep React responsible for shell, search, menu, and compact sheet; use MapLibre `Popup` for desktop point anchoring.

**Tech Stack:** React 19, TypeScript 7, MapLibre GL 5, Vite 8, Vitest/jsdom, Testing Library, Playwright.

## Global Constraints

- The map fills the viewer root (`width: 100%; height: 100%`), not an unconditional browser viewport.
- No persistent top bar or sidebar remains in ready state.
- Floating search/filter is upper-left; hamburger is upper-right; both use opaque theme-token surfaces.
- Embedded mode omits file controls by default and enables them only with `allowOpen=1`; standalone mode always keeps open/replace archive.
- Filtering is authoritative: nonmatching markers disappear and a nonmatching selection is cleared.
- Floor geometry never changes because of search category.
- Search and marker filtering use one category predicate; default marker eligibility remains separate.
- `all` uses the existing normal marker set; focused `gates` promotes pedestrian openings to markers.
- Selected markers keep their coordinate and dimensions; rich content is a separate desktop popup or compact sheet.
- Compact layout is based on viewer-root width `< 900px`, not the embedding parent window.
- `viewer-enrichment.json` is optional, root-level, version `1.0`, and nonfatal when absent or invalid.
- Enrichment resolution is field-by-field: selected feature, then its string `anchor_id`, then core IMDF data.
- Lead image resolution is atomic; never combine one image source with another image’s alt text.
- Nonfatal parser/normalization warnings remain internal and are absent from customer UI.
- Preserve existing compact-marker threshold, selected-marker exception, icon bubbles, native wheel bubbling, click, keyboard, tooltip, and `aria-label` behavior.
- Keyboard marker activation keeps focus on the replacement selected marker; popup/sheet close restores focus to the replacement unselected marker.
- Target WCAG 2.2 AA, including keyboard combobox behavior, focus restoration, visible focus, reduced motion, and non-color-only state.
- Add no runtime dependency; use installed React, MapLibre, and browser platform APIs.
- Treat unrelated working-tree changes as user-owned; never reset, rewrite, or commit them.

---

### Task 1: Shared Category Semantics and Authoritative Reducer State

**Files:**
- Create: `src/search/searchCategories.ts`
- Create: `src/search/searchCategories.test.ts`
- Modify: `src/search/searchVenue.ts:1-27`
- Modify: `src/search/searchVenue.test.ts`
- Modify: `src/state/viewerReducer.ts:1-4,186-190`
- Modify: `src/state/viewerReducer.test.ts`
- Modify: `src/map/useFeatureMarkers.ts:166-186`

**Interfaces:**
- Produces: `SearchCategory`, `CategoryFeature`, `isUnitMarkerEligible(feature)`, and `matchesSearchCategory(feature, category)`.
- Consumes: `FeatureType` and the existing geometry-only unit category list.
- Invariant: changing to a category that excludes the selected feature sets `selectedFeatureId` to `null` in the same reducer transition.

- [ ] **Step 1: Write failing category-contract tests**

Create `src/search/searchCategories.test.ts` with table-driven assertions:

```ts
import { describe, expect, it } from "vitest";
import type { ViewerFeature } from "../imdf/types";
import { isUnitMarkerEligible, matchesSearchCategory } from "./searchCategories";

function feature(featureType: ViewerFeature["featureType"], category: string | null): ViewerFeature {
  return {
    id: `${featureType}-${category ?? "none"}`,
    featureType,
    levelId: "level-1",
    geometry: null,
    center: [139.7, 35.6],
    labels: { en: "Place" },
    altLabels: {},
    category,
    accessibility: [],
    restriction: null,
    sourceProperties: {},
  };
}

describe("matchesSearchCategory", () => {
  it("uses one deterministic category contract", () => {
    expect(matchesSearchCategory(feature("occupant", "shopping"), "shops")).toBe(true);
    expect(matchesSearchCategory(feature("opening", "pedestrian.primary"), "gates")).toBe(true);
    expect(matchesSearchCategory(feature("opening", "service"), "gates")).toBe(false);
    expect(matchesSearchCategory(feature("amenity", "information"), "facilities")).toBe(true);
    expect(matchesSearchCategory(feature("kiosk", null), "facilities")).toBe(true);
    expect(matchesSearchCategory(feature("unit", "elevator"), "facilities")).toBe(true);
    expect(matchesSearchCategory(feature("unit", "walkway"), "facilities")).toBe(false);
    expect(matchesSearchCategory(feature("occupant", "shopping"), "facilities")).toBe(false);
  });

  it("keeps default unit marker eligibility separate and exact", () => {
    expect(isUnitMarkerEligible(feature("unit", "room"))).toBe(true);
    expect(isUnitMarkerEligible(feature("unit", "restroom.female"))).toBe(true);
    expect(isUnitMarkerEligible(feature("unit", "platform"))).toBe(false);
    expect(isUnitMarkerEligible(feature("amenity", "restroom"))).toBe(false);
  });
});
```

Add reducer coverage proving a selected occupant survives `shops`, clears on `facilities`, and a null selection stays null.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```powershell
corepack pnpm exec vitest run src/search/searchCategories.test.ts src/state/viewerReducer.test.ts
```

Expected: `searchCategories.ts` import failure and reducer selection not clearing.

- [ ] **Step 3: Implement the shared predicate**

Create `src/search/searchCategories.ts`:

```ts
import type { FeatureType } from "../imdf/types";

export type SearchCategory = "all" | "gates" | "shops" | "facilities";

export interface CategoryFeature {
  featureType: FeatureType;
  category: string | null;
}

const GEOMETRY_ONLY_UNIT_CATEGORIES: ReadonlySet<string> = new Set([
  "walkway",
  "corridor",
  "opentowalkway",
  "ramp",
  "sidewalk",
  "unenclosedarea",
  "opentobelow",
  "structure",
  "platform",
]);

export function isUnitMarkerEligible(feature: CategoryFeature): boolean {
  return (
    feature.featureType === "unit" &&
    feature.category !== null &&
    !GEOMETRY_ONLY_UNIT_CATEGORIES.has(feature.category)
  );
}

export function matchesSearchCategory(
  feature: CategoryFeature,
  category: SearchCategory,
): boolean {
  switch (category) {
    case "all":
      return true;
    case "gates":
      return (
        feature.featureType === "opening" &&
        (feature.category?.startsWith("pedestrian") ?? false)
      );
    case "shops":
      return feature.featureType === "occupant";
    case "facilities":
      return (
        feature.featureType === "amenity" ||
        feature.featureType === "kiosk" ||
        isUnitMarkerEligible(feature)
      );
  }
}
```

Move `SearchCategory` imports from `searchVenue.ts` to this file, export the imported type from `searchVenue.ts` temporarily only if a same-task caller still needs migration, then migrate every caller and remove the re-export before committing. Delete the duplicate geometry-only category constant and `isMarkerUnit` implementation from `useFeatureMarkers.ts`; import `isUnitMarkerEligible` there.

Update `searchVenue.ts` to filter with `matchesSearchCategory(entry, query.category)`.

Update the reducer branch:

```ts
case "set_search_category": {
  if (state.status !== "ready") {
    return state;
  }
  const selected =
    state.selectedFeatureId === null
      ? undefined
      : state.loadedVenue.featuresById.get(state.selectedFeatureId);
  return {
    ...state,
    searchCategory: action.category,
    selectedFeatureId:
      selected !== undefined && !matchesSearchCategory(selected, action.category)
        ? null
        : state.selectedFeatureId,
  };
}
```

- [ ] **Step 4: Run category, search, and reducer tests**

Run:

```powershell
corepack pnpm exec vitest run src/search/searchCategories.test.ts src/search/searchVenue.test.ts src/state/viewerReducer.test.ts src/map/useFeatureMarkers.test.ts
```

Expected: all focused files pass; existing search ordering and marker eligibility remain unchanged.

- [ ] **Step 5: Commit Task 1**

```powershell
git add src/search/searchCategories.ts src/search/searchCategories.test.ts src/search/searchVenue.ts src/search/searchVenue.test.ts src/state/viewerReducer.ts src/state/viewerReducer.test.ts src/map/useFeatureMarkers.ts src/map/useFeatureMarkers.test.ts
git commit -m "feat: share viewer category filtering"
```

---

### Task 2: Filter-aware Marker Collection and Focused Gate Markers

**Files:**
- Modify: `src/map/useFeatureMarkers.ts`
- Modify: `src/map/useFeatureMarkers.test.ts`
- Modify: `src/map/IndoorMap.tsx:24-32,184-191`
- Modify: `src/app/App.tsx:451-460`
- Modify: `src/app/App.test.tsx`

**Interfaces:**
- Changes: `collectMarkerFeatures(venue, levelId, selectedFeatureId, category)`.
- Changes: `UseFeatureMarkersArgs` and `IndoorMapProps` gain `searchCategory: SearchCategory`.
- Produces: focused Gates markers for pedestrian openings, with localized label fallback `Entrance` / `入口`.
- Consumes: Task 1 `matchesSearchCategory` and `SearchCategory`.

- [ ] **Step 1: Add failing marker-filter tests**

Extend `src/map/useFeatureMarkers.test.ts` with a venue containing an occupant, amenity, kiosk, elevator unit, walkway unit, pedestrian opening, and service opening. Assert:

```ts
expect(collectMarkerFeatures(venue, LEVEL, null, "shops").map((entry) => entry.id)).toEqual([
  "shop",
]);
expect(collectMarkerFeatures(venue, LEVEL, null, "facilities").map((entry) => entry.id)).toEqual([
  "elevator",
  "amenity",
  "kiosk",
]);
expect(collectMarkerFeatures(venue, LEVEL, null, "gates").map((entry) => entry.id)).toEqual([
  "pedestrian-opening",
]);
expect(collectMarkerFeatures(venue, LEVEL, null, "all").map((entry) => entry.id)).not.toContain(
  "pedestrian-opening",
);
```

Add label assertions:

```ts
expect(markerLabelFor(feature("gate", "opening", "pedestrian", { labels: {} }), "en", "ja")).toBe(
  "Entrance",
);
expect(markerLabelFor(feature("gate", "opening", "pedestrian", { labels: {} }), "ja", "en")).toBe(
  "入口",
);
```

- [ ] **Step 2: Run the marker tests and confirm RED**

```powershell
corepack pnpm exec vitest run src/map/useFeatureMarkers.test.ts
```

Expected: compile failures for the new category parameter and gate label expectations.

- [ ] **Step 3: Implement category-aware collection**

Apply these rules in `collectMarkerFeatures`:

```ts
const focused = category !== "all";
const markerUnit = isUnitMarkerEligible(feature);
const defaultMarker = MARKER_FEATURE_TYPES[feature.featureType] === true || markerUnit;
const focusedMarker = focused && matchesSearchCategory(feature, category);
if (!(focused ? focusedMarker : defaultMarker)) {
  continue;
}
```

For focused categories, retain the existing bubble/pill priority and cap. Treat pedestrian openings as text markers in Gates mode. Preserve selected-first behavior only when the selected feature matches the active category; Task 1 normally clears a mismatch before this function runs.

Add the unnamed-opening fallback before the generic UUID fallback in `markerLabelFor`:

```ts
if (
  feature.featureType === "opening" &&
  (feature.category?.startsWith("pedestrian") ?? false) &&
  Object.keys(feature.labels).length === 0
) {
  return locale === "ja" ? "入口" : "Entrance";
}
```

Thread `searchCategory` from `App` through `IndoorMap` to `useFeatureMarkers`.

- [ ] **Step 4: Run marker and App tests**

```powershell
corepack pnpm exec vitest run src/map/useFeatureMarkers.test.ts src/app/App.test.tsx
```

Expected: focused filters select the exact marker sets; current compact marker transform tests remain green.

- [ ] **Step 5: Commit Task 2**

```powershell
git add src/map/useFeatureMarkers.ts src/map/useFeatureMarkers.test.ts src/map/IndoorMap.tsx src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: filter map markers by category"
```

---

### Task 3: Versioned ZIP Enrichment Parser and Venue Model

**Files:**
- Create: `src/imdf/viewerEnrichment.ts`
- Create: `src/imdf/viewerEnrichment.test.ts`
- Modify: `src/imdf/types.ts:28-44,90-106`
- Modify: `src/imdf/imdf.worker.ts:28-56,309-509`
- Modify: `src/imdf/imdfArchive.test.ts`
- Modify: `src/imdf/normalizeVenue.ts:193-482`
- Modify: `src/imdf/normalizeVenue.test.ts`
- Modify: `e2e/helpers.ts` only if the ZIP fixture builder needs an optional enrichment entry

**Interfaces:**
- Produces: `ViewerEnrichmentImage`, `ViewerEnrichmentEntry`, `parseViewerEnrichment(value)`.
- Changes: `ParsedImdfArchive` gains optional `enrichment: Record<string, ViewerEnrichmentEntry>`.
- Changes: `LoadedVenue` gains `enrichmentByFeatureId: Map<string, ViewerEnrichmentEntry>`.
- Adds warning codes: `invalid_viewer_enrichment` and `duplicate_viewer_enrichment`.

- [ ] **Step 1: Write parser RED tests**

Create tests that cover:

1. Valid version `1.0` with localized description, contact fields, and one image.
2. More than 5,000 features rejects enrichment.
3. A feature key longer than 128 characters drops that entry.
4. Invalid phone, HTTP website, protocol-relative image, and missing image alt are dropped individually while valid description survives.
5. Unknown top-level members are ignored.
6. Unsupported version returns no entries plus one internal diagnostic.
7. Zero images and one image are valid; two images drops the `images` field.

Use an exact return contract:

```ts
export interface ViewerEnrichmentParseResult {
  entries: Record<string, ViewerEnrichmentEntry>;
  warnings: ViewerWarning[];
}
```

- [ ] **Step 2: Run parser tests and confirm RED**

```powershell
corepack pnpm exec vitest run src/imdf/viewerEnrichment.test.ts
```

Expected: import failure because the parser does not exist.

- [ ] **Step 3: Implement bounded pure parsing**

Define types in `src/imdf/types.ts`:

```ts
export interface ViewerEnrichmentImage {
  src: string;
  alt: Record<string, string>;
}

export interface ViewerEnrichmentEntry {
  description?: Record<string, string>;
  hours?: string;
  phone?: string;
  website?: string;
  images?: [] | [ViewerEnrichmentImage];
}
```

Implement pure helpers in `viewerEnrichment.ts` with these constants:

```ts
const MAX_FEATURES = 5_000;
const MAX_ID_LENGTH = 128;
const MAX_LOCALES = 16;
const MAX_LOCALE_LENGTH = 35;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_ALT_LENGTH = 300;
const MAX_HOURS_LENGTH = 512;
const MAX_PHONE_LENGTH = 64;
const MAX_URL_LENGTH = 2_048;
const PHONE_RE = /^[+0-9().\- ]+$/;
```

Validation behavior must match the spec exactly: invalid entry identity drops the entry; invalid optional fields drop only that field; unsupported/malformed top level returns no entries and a warning. Store viewer-relative image paths beginning `/` unchanged; store absolute HTTPS URLs unchanged. Reject all other URL forms.

- [ ] **Step 4: Add worker archive-boundary RED tests**

Extend `src/imdf/imdfArchive.test.ts`:

```ts
it("loads one valid viewer-enrichment.json into the normalized venue", async () => {
  const bytes = await buildMinimalImdfZip({
    extraEntries: {
      "viewer-enrichment.json": JSON.stringify({
        version: "1.0",
        features: {
          [OCCUPANT_ID]: { description: { en: "Concourse shop" } },
        },
      }),
    },
  });
  const result = await loadArchive(new File([bytes], "venue.zip"));
  expect(result.type).toBe("loaded");
  if (result.type === "loaded") {
    expect(result.venue.enrichmentByFeatureId.get(OCCUPANT_ID)?.description?.en).toBe(
      "Concourse shop",
    );
  }
});
```

Add a ZIP fixture with both `viewer-enrichment.json` and `VIEWER-ENRICHMENT.JSON`; assert the venue still loads, enrichment is empty, and one `duplicate_viewer_enrichment` warning is present. Add malformed and unsupported-version fixtures asserting nonfatal load plus `invalid_viewer_enrichment`.

- [ ] **Step 5: Wire the worker and normalization**

Before iterating archive entries, compute case-insensitive enrichment matches. If count is greater than one, record `duplicate_viewer_enrichment` and skip every match. If exactly one, extract it through existing counted text extraction. Parse enrichment JSON inside an enrichment-only `try`/`catch`: malformed JSON records `invalid_viewer_enrichment` and yields no enrichment instead of escaping through core `parseJson` as a fatal archive error. Pass a successfully parsed unknown value to `parseViewerEnrichment`.

Pass valid records through `ParsedImdfArchive.enrichment`. In `normalizeVenue`, construct:

```ts
const enrichmentByFeatureId = new Map(Object.entries(archive.enrichment ?? {}));
```

Include it in every returned `LoadedVenue`. Update all hand-built `LoadedVenue` test fixtures with `enrichmentByFeatureId: new Map()`.

- [ ] **Step 6: Run parser, archive, and normalization tests**

```powershell
corepack pnpm exec vitest run src/imdf/viewerEnrichment.test.ts src/imdf/imdfArchive.test.ts src/imdf/normalizeVenue.test.ts
```

Expected: all enrichment limits, partial recovery, duplicate handling, and normalized-map assertions pass.

- [ ] **Step 7: Commit Task 3**

```powershell
git add src/imdf/viewerEnrichment.ts src/imdf/viewerEnrichment.test.ts src/imdf/types.ts src/imdf/imdf.worker.ts src/imdf/imdfArchive.test.ts src/imdf/normalizeVenue.ts src/imdf/normalizeVenue.test.ts e2e/helpers.ts
git commit -m "feat: load versioned viewer enrichment"
```

---

### Task 4: Resolved Visitor Content and Customer-facing Details

**Files:**
- Create: `src/components/selectedFeatureContent.ts`
- Create: `src/components/selectedFeatureContent.test.ts`
- Create: `src/components/SelectedFeatureContent.tsx`
- Modify: `src/components/components.test.tsx`
- Remove after replacement: `src/components/FeatureDetails.tsx`

**Interfaces:**
- Produces: `ResolvedFeatureContent`, `resolveSelectedFeatureContent(venue, feature, locale)`.
- Produces: `<SelectedFeatureContent content={content} locale={locale} onClose={fn} />`.
- Consumes: Task 3 `enrichmentByFeatureId` and existing localized-label helpers.

- [ ] **Step 1: Write failing pure-resolution tests**

Use selected occupant ID `occupant`, anchor ID `anchor`, and these contracts:

```ts
expect(resolveSelectedFeatureContent(venue, occupant, "en")).toMatchObject({
  name: "Station Shop",
  description: "Occupant description",
  hours: "Daily 09:00-21:00",
  phone: "+81 3 1234 5678",
  website: "https://example.com",
});
```

Cover separately:

- Selected entry field wins over anchor.
- Missing selected field falls back to anchor.
- Missing enrichment falls back to `sourceProperties.hours`, `phone`, and HTTPS `website`.
- Selected and anchor description maps merge by locale.
- Selected image is atomic and never inherits anchor alt text.
- Explicit selected `images: []` suppresses anchor image.
- Invalid core HTTP website and invalid core phone are omitted.
- Feature ID/anchor collision chooses selected feature.

- [ ] **Step 2: Run resolver tests and confirm RED**

```powershell
corepack pnpm exec vitest run src/components/selectedFeatureContent.test.ts
```

Expected: missing module/functions.

- [ ] **Step 3: Implement the pure resolver**

Define:

```ts
export interface ResolvedFeatureContent {
  name: string;
  description: string | null;
  category: string | null;
  floor: string | null;
  hours: string | null;
  accessibility: string[];
  phone: string | null;
  website: string | null;
  image: { src: string; alt: string } | null;
}
```

Use property-presence checks (`Object.hasOwn`) so an explicit empty selected `images` array suppresses anchor media. Merge only description locale maps. Resolve image as one atomic object from selected or anchor. Resolve relative image `src` in the React component with `new URL(src, window.location.origin)`; the pure resolver keeps the validated source string.

- [ ] **Step 4: Write failing visitor-content component tests**

Replace raw `FeatureDetails` expectations with assertions that visitor content:

- Shows name, description, hours, category/floor, phone link, website link, and accessibility when present.
- Omits Type, ID, restriction diagnostics, and missing rows.
- Uses `target="_blank"` and `rel="noreferrer"` for website.
- Removes the media region after an image `error` event.
- Calls `onClose` from its localized close button.

- [ ] **Step 5: Implement `SelectedFeatureContent`**

Render semantic heading/content, one 16:9 image region, `tel:` and HTTPS actions, and a real close button. Keep image failure in local component state keyed by `content.image?.src` so selecting a new feature resets failure state. Do not render a placeholder after failure.

Delete `FeatureDetails.tsx` only after all callsites move in later tasks; until then, leave it untouched to keep intermediate commits compiling. The final removal occurs in Task 6.

- [ ] **Step 6: Run resolver and component tests**

```powershell
corepack pnpm exec vitest run src/components/selectedFeatureContent.test.ts src/components/components.test.tsx
```

Expected: all visitor-content contracts pass; unrelated component tests remain green.

- [ ] **Step 7: Commit Task 4**

```powershell
git add src/components/selectedFeatureContent.ts src/components/selectedFeatureContent.test.ts src/components/SelectedFeatureContent.tsx src/components/components.test.tsx
git commit -m "feat: resolve visitor-facing feature content"
```

---

### Task 5: Accessible Floating Search and Category Control

**Files:**
- Create: `src/components/FloatingSearch.tsx`
- Create: `src/components/FloatingSearch.test.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Produces: `FloatingSearchProps` shown below.
- Consumes: `SearchResult[]`, `SearchCategory`, current-floor marker count, and existing callbacks.
- Invariant: maximum 50 rendered options; empty `all` query closes results; focused empty category lists results.

```ts
export interface FloatingSearchProps {
  locale: LocaleCode;
  value: string;
  category: SearchCategory;
  results: SearchResult[];
  selectedFeatureId: string | null;
  currentFloorMatchCount: number;
  onValueChange: (value: string) => void;
  onCategoryChange: (category: SearchCategory) => void;
  onSelectResult: (result: SearchResult) => void;
  onOpenChange: (open: boolean) => void;
}
```

- [ ] **Step 1: Write failing combobox tests**

Test with Testing Library and `userEvent`:

- Input has `role="combobox"`, `aria-autocomplete="list"`, `aria-controls`, and correct `aria-expanded`.
- Typing opens the list and renders at most 50 options.
- ArrowDown updates `aria-activedescendant`; Enter selects that result.
- Escape closes results without clearing input.
- Empty `all` stays closed; empty `shops` opens category-browse results.
- Filter choices expose pressed/selected semantics and call `onCategoryChange`.
- A non-`all` category with zero current-floor markers shows localized no-floor-match copy and clear-filter action.
- Search and filter trigger buttons have visible accessible names in Japanese and English.

- [ ] **Step 2: Run the component test and confirm RED**

```powershell
corepack pnpm exec vitest run src/components/FloatingSearch.test.tsx
```

Expected: missing component.

- [ ] **Step 3: Implement `FloatingSearch` as one coordinated surface**

Use stable IDs from `useId()`. Keep `activeIndex` bounded whenever results change. Set `aria-activedescendant` only when an option is active. Use `onMouseDown` or controlled blur handling so clicking an option does not close the list before selection. Render the dropdown in a portal attached to `document.body` and position it from the control’s `getBoundingClientRect`; update from a `ResizeObserver` on the trigger plus window resize and capture-phase scroll.

Keep category choices inside the same floating surface. Opening filter choices closes result options but preserves input and category. Clearing the category selects `all`.

- [ ] **Step 4: Wire search state in `App` without removing the old shell yet**

Render `FloatingSearch` over `map-stage` alongside the current shell for this intermediate commit. Compute `currentFloorMatchCount` from visible-level features using Task 1’s predicate and Task 2’s marker eligibility. Preserve existing `searchVenue` result computation and `onSelectResult` atomic level/feature dispatch.

- [ ] **Step 5: Run focused search and App tests**

```powershell
corepack pnpm exec vitest run src/components/FloatingSearch.test.tsx src/search/searchVenue.test.ts src/app/App.test.tsx
```

Expected: combobox and integration tests pass; current app shell still compiles.

- [ ] **Step 6: Commit Task 5**

```powershell
git add src/components/FloatingSearch.tsx src/components/FloatingSearch.test.tsx src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: add floating viewer search"
```

---

### Task 6: Hamburger Menu and Map-first Shell Cutover

**Files:**
- Create: `src/components/ViewerMenu.tsx`
- Create: `src/components/ViewerMenu.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/viewerParams.ts`
- Modify: `src/app/viewerParams.test.ts`
- Modify: `src/components/ViewerNotice.tsx`
- Modify: `src/components/components.test.tsx`
- Remove: `src/components/ExplorerSidebar.tsx`
- Remove: `src/components/FeatureDetails.tsx`
- Remove: `src/components/SearchBox.tsx`
- Remove: `src/components/CategoryChips.tsx`

**Interfaces:**
- Produces: `ViewerMenuProps` with venue/floor/locale/theme/file callbacks.
- Consumes: existing `LevelSwitcher`, `ThemeSwitcher`, locale state, and `openPicker`.
- Invariant: standalone shows Open IMDF ZIP; embed omits it unless parsed viewer params contain `allowOpen: true`.

- [ ] **Step 1: Write failing menu tests**

Test:

- Menu button has localized accessible name and `aria-expanded`.
- Opening shows venue name, current floor, all level controls, locale, and theme.
- Standalone renders Open IMDF ZIP and invokes `onOpenFile`.
- Embed omits Open IMDF ZIP.
- Embed with `allowOpen=1` renders Open IMDF ZIP.
- Escape and outside click close the menu and restore focus to the trigger.
- Opening callback lets App close the search surface.

- [ ] **Step 2: Run menu tests and confirm RED**

```powershell
corepack pnpm exec vitest run src/components/ViewerMenu.test.tsx
```

Expected: missing component.

- [ ] **Step 3: Implement `ViewerMenu`**

Use a button plus a nonmodal anchored menu. Prefer the platform popover API only if jsdom and browser support can be wrapped without a polyfill; otherwise use a body portal and fixed positioning, matching `FloatingSearch`. Accept a `showFileControls` prop and render file actions only when it is true. Reuse `LevelSwitcher` and `ThemeSwitcher`; do not create duplicate level/theme implementations.

- [ ] **Step 4: Cut over `App` to the map-first shell**

Extend `parseViewerParams` with `allowOpen: params.get("allowOpen") === "1"` and cover `1`, `0`, `true`, and absence in `viewerParams.test.ts`. Pass `showFileControls={!embed || params.allowOpen}` to `ViewerMenu`.

In ready state:

- Remove the rendered `.top-bar`.
- Remove `ExplorerSidebar`.
- Render `FloatingSearch` and `ViewerMenu` as children of `.map-stage` above `IndoorMap`.
- Keep file input, empty/drop/loading/error states, drag-and-drop replacement, live region, and MapLibre controls.
- Keep venue and level names computed for the menu.
- Coordinate search/menu open state so opening either closes the other.
- Do not clear selected feature when either control opens.

Remove `ViewerWarnings` rendering and export; keep `ViewerErrorNotice`. Delete warning disclosure tests but retain warning data-model tests. Delete `ExplorerSidebar.tsx`, obsolete `FeatureDetails.tsx`, `SearchBox.tsx`, and `CategoryChips.tsx` after all callsites are gone.

- [ ] **Step 5: Add App-shell assertions**

Update `src/app/App.test.tsx` to assert in ready state:

```ts
expect(document.querySelector(".top-bar")).toBeNull();
expect(document.querySelector(".explorer-sidebar")).toBeNull();
expect(screen.getByRole("combobox", { name: "Search" })).toBeTruthy();
expect(screen.getByRole("button", { name: "Menu" })).toBeTruthy();
expect(screen.queryByText("Warnings")).toBeNull();
```

Retain explicit tests for fatal `ViewerErrorNotice` and empty/loading archive states.

- [ ] **Step 6: Run shell tests**

```powershell
corepack pnpm exec vitest run src/components/ViewerMenu.test.tsx src/components/FloatingSearch.test.tsx src/components/components.test.tsx src/app/viewerParams.test.ts src/app/App.test.tsx
```

Expected: ready-state shell is map-first; load/error behaviors remain green.

- [ ] **Step 7: Commit Task 6**

```powershell
git add src/components/ViewerMenu.tsx src/components/ViewerMenu.test.tsx src/app/viewerParams.ts src/app/viewerParams.test.ts src/app/App.tsx src/app/App.test.tsx src/components/ViewerNotice.tsx src/components/components.test.tsx src/components/ExplorerSidebar.tsx src/components/FeatureDetails.tsx src/components/SearchBox.tsx src/components/CategoryChips.tsx
git commit -m "feat: replace viewer chrome with map controls"
```

---

### Task 7: Desktop MapLibre Popup and Compact Bottom Sheet

**Files:**
- Create: `src/map/useSelectedFeaturePopup.tsx`
- Create: `src/map/useSelectedFeaturePopup.test.tsx`
- Create: `src/components/SelectedFeatureSheet.tsx`
- Create: `src/components/SelectedFeatureSheet.test.tsx`
- Modify: `src/map/IndoorMap.tsx`
- Create: `src/map/IndoorMap.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

**Interfaces:**
- Produces: `useSelectedFeaturePopup(args)` for root width `>= 900`.
- Produces: `SelectedFeatureSheet` for root width `< 900`.
- Changes: `IndoorMapProps` gains `compact: boolean` and `bottomPadding: number`.
- Consumes: Task 4 content resolver/component and existing `onSelectFeature(null)`.

```ts
export interface UseSelectedFeaturePopupArgs {
  map: MapLibreMap | null;
  venue: LoadedVenue;
  selectedFeatureId: string | null;
  locale: LocaleCode;
  compact: boolean;
  onClose: () => void;
}
```

- [ ] **Step 1: Write failing popup lifecycle tests**

Mock MapLibre `Popup` at the module boundary and assert:

- No popup for null selection, compact mode, missing feature, or missing `feature.center`.
- Desktop selection calls `setLngLat(feature.center)`, `setDOMContent`, and `addTo(map)`.
- Locale or selection updates replace rendered content without leaving multiple roots/popups.
- Popup close invokes `onClose` once.
- Cleanup unmounts the React root and removes the popup.

Add `src/map/IndoorMap.test.tsx` around the selection-camera contract. With a selected display point already inside the current padded viewport, assert neither `easeTo`, `jumpTo`, nor `panBy` runs. With a point outside the desktop viewport, assert `panBy` receives only the overflow delta needed to place it 16px inside the relevant edge. In compact mode, assert the selection effect does not pan; sheet-padding logic owns compact adjustment.

- [ ] **Step 2: Run popup tests and confirm RED**

```powershell
corepack pnpm exec vitest run src/map/useSelectedFeaturePopup.test.tsx src/map/IndoorMap.test.tsx
```

Expected: missing popup hook and failure because current selection handling unconditionally calls `easeTo` or `jumpTo` even for an already-visible point.

- [ ] **Step 3: Implement the desktop popup hook**

Create one container and React root per active popup. Instantiate:

```ts
new Popup({
  closeButton: false,
  closeOnClick: true,
  focusAfterOpen: false,
  maxWidth: "360px",
  offset: 14,
})
```

Render `SelectedFeatureContent` into the popup container. Let MapLibre choose/flip anchors. Stop popup clicks from becoming map-background selections. On explicit content close call `popup.remove()` and `onClose()` without duplicate dispatch.

Replace the unconditional selection `jumpTo`/`easeTo` block in `IndoorMap` with a pure `revealOffset(point, viewport, padding, margin)` helper. It returns `null` when the projected display point is already inside all padded bounds. Otherwise it returns `[dx, dy]`, where each component is only the signed overflow past the nearest bound; call `map.panBy(offset, { duration: prefersReducedMotion() ? 0 : EASE_DURATION_MS })`. Skip this desktop adjustment when `compact` is true because the sheet-padding effect below owns compact visibility.

- [ ] **Step 4: Write failing compact-sheet tests**

Test the sheet renders the same resolved content, reports its height through `ResizeObserver`, closes selection, and limits its scroll region. Mock `ResizeObserver` deterministically.

- [ ] **Step 5: Implement root-width compact mode and sheet padding**

Replace `window.matchMedia` compact detection in `App` with a root `ResizeObserver`; compact is `contentRect.width < 900`. Render `SelectedFeatureSheet` only when compact and selection resolves.

Pass the sheet’s measured height to `IndoorMap`. In an effect, call `map.setPadding({ top: 0, right: 0, bottom: bottomPadding, left: 0 })`. When padding grows and the projected selected display point is inside the obscured region, call `map.panBy([0, overlap + 16])`; do not recenter when already visible. Reset bottom padding to zero when the sheet closes or layout becomes desktop.

- [ ] **Step 6: Run popup, sheet, map, and App tests**

```powershell
corepack pnpm exec vitest run src/map/useSelectedFeaturePopup.test.tsx src/map/IndoorMap.test.tsx src/components/SelectedFeatureSheet.test.tsx src/app/App.test.tsx src/map/useFeatureMarkers.test.ts
```

Expected: desktop/compact selection modes are mutually exclusive; marker lifecycle tests remain green.

- [ ] **Step 7: Commit Task 7**

```powershell
git add src/map/useSelectedFeaturePopup.tsx src/map/useSelectedFeaturePopup.test.tsx src/map/IndoorMap.tsx src/map/IndoorMap.test.tsx src/components/SelectedFeatureSheet.tsx src/components/SelectedFeatureSheet.test.tsx src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: show selected places over the map"
```

---

### Task 8: Marker Focus Continuity Across Selection and Popup Close

**Files:**
- Modify: `src/map/useFeatureMarkers.ts`
- Modify: `src/map/useFeatureMarkers.test.ts`
- Modify: `src/map/useSelectedFeaturePopup.tsx`
- Modify: `src/map/useSelectedFeaturePopup.test.tsx`
- Modify: `src/components/SelectedFeatureSheet.tsx`
- Modify: `src/components/SelectedFeatureSheet.test.tsx`
- Modify: `e2e/viewer.spec.ts`

**Interfaces:**
- Produces: `focusFeatureMarker(featureId: string, root?: ParentNode): boolean`.
- Adds: `data-feature-id` to every DOM marker button.
- Invariant: selecting with keyboard keeps focus on the replacement selected marker; closing popup/sheet restores focus to the replacement unselected marker.

- [ ] **Step 1: Write a failing hook regression for marker recreation**

Extend `src/map/useFeatureMarkers.test.ts` with a harness that renders one room marker, focuses it, activates it, rerenders with that feature selected, then rerenders with selection cleared. Assert after each rerender:

```ts
expect(document.activeElement).toBe(
  canvasContainer.querySelector('[data-feature-id="room"]'),
);
```

Also assert `focusFeatureMarker("room", canvasContainer)` returns `true`, focuses the current marker with `{ preventScroll: true }`, and an unknown ID returns `false`.

- [ ] **Step 2: Run the marker test and confirm RED**

```powershell
corepack pnpm exec vitest run src/map/useFeatureMarkers.test.ts
```

Expected: focus falls back to `document.body` because the selected-state effect destroys the focused button.

- [ ] **Step 3: Preserve focus through marker replacement**

Set `el.dataset.featureId = feature.id` during marker creation. Add a `useRef<string | null>` that survives selected-state effect cleanup.

Before removing the old overlay, capture focus only when the active element is one of that overlay’s marker buttons:

```ts
const active = document.activeElement;
if (active instanceof HTMLElement && overlay.contains(active)) {
  pendingFocusFeatureId.current = active.dataset.featureId ?? null;
}
```

After new markers are appended, measured, and repositioned, focus the replacement matching the pending feature ID with `{ preventScroll: true }`, then clear the pending value.

Export this helper for close behavior:

```ts
export function focusFeatureMarker(
  featureId: string,
  root: ParentNode = document,
): boolean {
  const marker = Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-feature-id]"),
  ).find((candidate) => candidate.dataset.featureId === featureId);
  if (marker === undefined) {
    return false;
  }
  marker.focus({ preventScroll: true });
  return true;
}
```

Keep the helper exact-ID based and do not construct a CSS selector from untrusted IDs.

- [ ] **Step 4: Write failing popup and sheet focus-return tests**

In popup and sheet tests, focus the close button, trigger Escape/close, and assert the selected marker receives focus before `onClose` clears selection. Cover both explicit close and MapLibre popup `close` event without duplicate callbacks.

- [ ] **Step 5: Restore marker focus before clearing selection**

In the desktop popup, scope lookup to `map.getCanvasContainer()`. In the compact sheet, scope it to the viewer root passed from `App`:

```ts
focusFeatureMarker(selectedFeatureId, markerRoot);
onClose();
```

Because selection clearing recreates the marker overlay, Task 8 Step 3 then transfers focus from the selected marker to its unselected replacement. Keep `focusAfterOpen: false`; the nonmodal popup must not steal focus when opened.

- [ ] **Step 6: Add keyboard Playwright coverage**

Add a journey that:

1. Tabs to the `Waiting Room` marker.
2. Presses Enter.
3. Asserts the selected marker remains `document.activeElement` and the popup is visible.
4. Presses Escape.
5. Asserts the popup closes and the unselected `Waiting Room` marker is again `document.activeElement`.

Repeat the close-focus assertion at compact width for the bottom sheet.

- [ ] **Step 7: Run focused unit and browser tests**

```powershell
corepack pnpm exec vitest run src/map/useFeatureMarkers.test.ts src/map/useSelectedFeaturePopup.test.tsx src/components/SelectedFeatureSheet.test.tsx
```

Then build/start preview and run:

```powershell
$env:CI=""
node_modules/.bin/playwright.cmd test e2e/viewer.spec.ts --project=chromium --grep "marker keyboard focus"
```

Expected: unit and Chromium focus journeys pass.

- [ ] **Step 8: Commit Task 8**

```powershell
git add src/map/useFeatureMarkers.ts src/map/useFeatureMarkers.test.ts src/map/useSelectedFeaturePopup.tsx src/map/useSelectedFeaturePopup.test.tsx src/components/SelectedFeatureSheet.tsx src/components/SelectedFeatureSheet.test.tsx e2e/viewer.spec.ts
git commit -m "fix: preserve marker focus through selection"
```

---

### Task 9: Map-first Styling, Responsive Behavior, and Interaction E2E

**Files:**
- Modify: `src/app/app.css`
- Modify: `e2e/helpers.ts`
- Modify: `e2e/viewer.spec.ts`
- Modify: `e2e/embed.spec.ts`
- Modify: `e2e/viewer.visual.spec.ts` only if the Linux acceptance runner confirms intentional pixel changes

**Interfaces:**
- Consumes all prior tasks.
- Produces final visitor-visible shell and browser-level behavior.

- [ ] **Step 1: Add failing Playwright journeys before final CSS**

Add one desktop embed journey that asserts:

1. No `.top-bar` or `.explorer-sidebar`.
2. Floating search and hamburger are visible.
3. Typing `Station` opens options; ArrowDown/Enter selects Station Shop.
4. Desktop selection opens the customer popup and does not show raw `ID`, `Type`, or warnings.
5. Opening the hamburger shows floor/language/theme but not Open IMDF ZIP.
6. Shops filter hides facility markers.
7. Facilities filter clears the selected shop popup.
8. Gates filter shows an Entrance marker and no shop markers.
9. Wheel zoom still works while the pointer is over a compact marker.

Add one compact embed journey at `390×844` that asserts:

1. Search and hamburger remain usable without horizontal overflow.
2. Feature selection opens the bottom sheet, not MapLibre popup content.
3. The sheet is bounded and dismissible.
4. Search text and category survive sheet dismissal.
5. Hamburger restores focus on Escape.

- [ ] **Step 2: Build and run the new journeys to confirm RED**

```powershell
corepack pnpm build
```

Start preview:

```powershell
corepack pnpm exec vite preview --host 127.0.0.1 --port 4173
```

In another terminal:

```powershell
$env:CI=""
node_modules/.bin/playwright.cmd test e2e/viewer.spec.ts e2e/embed.spec.ts --project=chromium --grep "map-first|compact selected place"
```

Expected: failures on missing final positioning/responsive styles, not fixture loading.

- [ ] **Step 3: Implement the final CSS cutover**

Delete obsolete top-bar, explorer-sidebar, feature-details, warning-disclosure, and old compact-header rules only after their markup is gone.

Add styles for:

- Full-size `.app`, `.app__body`, and `.map-stage` rooted in the host container.
- Semantic z-index tokens for map controls, search dropdown, menu, popup/sheet, and fatal error.
- Opaque floating search/menu surfaces using `--color-panel`, `--color-border`, and `--color-text`.
- 44px minimum touch targets.
- Bounded 50-option result list with visible active/selected states.
- Active-filter summary and no-floor-match message.
- Visitor popup width `min(360px, calc(100vw - 32px))`.
- 16:9 media region and failed-image removal without reserved blank space.
- Bottom sheet max height `min(60%, 480px)`, safe-area padding, and internal scrolling.
- `:focus-visible` AA focus treatment.
- 150–200ms transform/opacity state transitions only.
- `@media (prefers-reduced-motion: reduce)` disabling those transitions.

Do not animate width, height, padding, or positioned marker geometry.

- [ ] **Step 4: Run focused Chromium journeys**

```powershell
$env:CI=""
node_modules/.bin/playwright.cmd test e2e/viewer.spec.ts e2e/embed.spec.ts --project=chromium
```

Expected: every viewer/embed Chromium journey passes, including the compact-marker wheel regression.

- [ ] **Step 5: Run a real enriched-venue smoke**

Create a temporary enriched fixture from the existing minimal archive with `viewer-enrichment.json` containing one description and one same-origin image URL. Serve it from `dist/venues/`, open desktop and compact embed URLs, and verify:

- JSON description appears.
- Missing enrichment on another feature falls back to core data.
- Image failure removes only the media region.
- Changing from Shops to Facilities clears the shop selection.
- Hamburger and combobox remain inside the viewer root.

Remove the temporary venue and image from `dist/venues/` and stop preview afterward.

- [ ] **Step 6: Commit Task 9**

```powershell
git add src/app/app.css e2e/helpers.ts e2e/viewer.spec.ts e2e/embed.spec.ts
git commit -m "feat: finish map-first embedded viewer"
```

Do not commit Windows-generated visual snapshots. If Linux acceptance reports only intentional shell pixel diffs, regenerate `e2e/viewer.visual.spec.ts` snapshots on that Linux runner in a separate baseline commit.

---

### Task 10: Final Contract Verification

**Files:**
- Verify only; modify a file only to fix a demonstrated failure in its owning task.

**Interfaces:**
- Verifies the complete approved specification and clean cutover.

- [ ] **Step 1: Confirm obsolete customer chrome and warning paths are gone**

Search `src` and `e2e` for:

```text
ExplorerSidebar
FeatureDetails
ViewerWarnings
explorer-sidebar
top-bar__
feature-details
viewer-warnings
```

Expected: no runtime/UI matches. Test fixture prose may mention the absence only where it asserts the clean cutover.

- [ ] **Step 2: Run static and full unit verification**

```powershell
corepack pnpm typecheck
corepack pnpm exec vitest run
```

Expected: TypeScript passes; every Vitest file passes with zero failures.

- [ ] **Step 3: Run production build**

```powershell
corepack pnpm build
```

Expected: Vite production build succeeds. The existing bundle-size warning is nonblocking; no new dependency or chunk is introduced.

- [ ] **Step 4: Run complete Chromium viewer coverage**

Start preview:

```powershell
corepack pnpm exec vite preview --host 127.0.0.1 --port 4173
```

Then:

```powershell
$env:CI=""
node_modules/.bin/playwright.cmd test e2e/viewer.spec.ts e2e/embed.spec.ts --project=chromium
```

Expected: all journeys pass, covering standalone, desktop embed, compact embed, combobox, filters, menu, popup/sheet, locale/floor, file errors, and wheel-over-marker zoom.

- [ ] **Step 5: Review network and security evidence**

Run the unenriched zero-post-load-network journey and assert zero HTTP(S) requests after static app load. Run the enriched fixture journey and assert every post-load request matches the validated image origin declared by the fixture; no other request is allowed.

- [ ] **Step 6: Stop preview and confirm temporary smoke assets are removed**

Confirm `dist/venues/` and any temporary enriched media created by Task 9 are absent. Do not delete unrelated user assets.

- [ ] **Step 7: Commit any verification-only test correction**

If verification required no changes, do not create an empty commit. If a demonstrated failure required a test or implementation correction, stage only those files and use:

```powershell
git commit -m "fix: close map-first viewer regression"
```
