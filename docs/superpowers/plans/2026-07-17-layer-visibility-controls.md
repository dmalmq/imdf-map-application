# Layer Visibility Controls & Unit Coloring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the viewer toggle which feature types and buildings are shown, and color unit fills from the source `color2` attribute.

**Architecture:** A per-feature `buildingId` is resolved once in `normalizeVenue` (authoritative `building_ids`, before the GDB source-property restore) and stamped onto render features and search entries. A single visibility predicate over `(featureType, buildingId)` governs rendering, hit-testing, POI markers, and search. Unit fills gain a `__unit_color` render property (from `color2`) consumed via a `coalesce` in the unit fill layers, leaving theme colors as the fallback. A dedicated `LayerControls` panel drives session-only hidden-sets in `ReadyVenueState`.

**Tech Stack:** TypeScript (strict), React 19, MapLibre GL 5, Vitest, Playwright, Vite. No new dependencies.

## Global Constraints

- Session-only state: no URL/deep-link/embed encoding; a new venue (`load_succeeded`) resets both hidden sets to empty (all visible).
- Store **hidden** sets (`ReadonlySet`), so empty = all visible. Reducer stays pure — always write a fresh `Set`.
- "Hidden everywhere": a hidden type/building is excluded from rendering, map click/hover, POI markers, and search results.
- `color2` palette is exact from `C:\Repositories\cesium` (`src/main.js`/`src/viewer.js` `COLOR2_LOOKUP`) plus `道白 → #FFFFFF`; present-but-unmapped → `#808080`; absent/blank → no override. Fill only — unit outline stays per-theme.
- Buildings section renders only when the venue has ≥ 2 buildings. Feature-type rows render only for types present in the venue.
- All UI strings localized `ja`/`en`, matching existing `ui` string-table conventions.
- Project rules: no one-expression wrapper functions; no inline `as {…}` cast-then-access (narrow with `typeof`/`in`); use `Set`/`Map` for runtime collections, `Record` for static tables.
- Commands (repo standard): tests `corepack pnpm test --run <file>`, typecheck `corepack pnpm typecheck`, build `corepack pnpm build`, e2e `corepack pnpm exec playwright test <spec> --project=chromium`.

---

### Task 1: Per-feature building id + venue buildings

**Files:**
- Modify: `src/imdf/types.ts` (`ViewerFeature`, `SearchEntry`, `LoadedVenue`)
- Modify: `src/imdf/normalizeVenue.ts` (resolve `buildingId`; build `buildings`)
- Modify: `src/search/buildSearchEntries.ts` (copy `buildingId`)
- Test: `src/imdf/normalizeVenue.test.ts`

**Interfaces:**
- Produces: `ViewerFeature.buildingId: string | null`; `SearchEntry.buildingId: string | null`; `LoadedVenue.buildings: VenueBuilding[]` where `export interface VenueBuilding { id: string; label: Record<string, string> }`.

- [ ] **Step 1: Write the failing test**

Add to `src/imdf/normalizeVenue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeVenue } from "./normalizeVenue";
import type { ParsedImdfArchive } from "./types";

function fc(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features };
}

describe("normalizeVenue building resolution", () => {
  it("resolves buildingId for levels, units, and building features, and lists buildings", () => {
    const archive: ParsedImdfArchive = {
      manifest: { version: "1.0.0", language: "ja" },
      collections: {
        building: fc([
          { type: "Feature", id: "bldg-A", geometry: null, properties: { name: { en: "A", ja: "A" } } },
        ]),
        level: fc([
          {
            type: "Feature",
            id: "lvl-1",
            geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
            properties: { ordinal: 0, building_ids: ["bldg-A"], name: { en: "1", ja: "1" } },
          },
        ]),
        unit: fc([
          {
            type: "Feature",
            id: "unit-1",
            geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
            properties: { level_id: "lvl-1", category: "room" },
          },
        ]),
      },
    };
    const venue = normalizeVenue(archive);
    expect(venue.featuresById.get("lvl-1")?.buildingId).toBe("bldg-A");
    expect(venue.featuresById.get("unit-1")?.buildingId).toBe("bldg-A");
    expect(venue.featuresById.get("bldg-A")?.buildingId).toBe("bldg-A");
    expect(venue.buildings).toEqual([{ id: "bldg-A", label: { en: "A", ja: "A" } }]);
  });

  it("leaves buildingId null when unresolved", () => {
    const archive: ParsedImdfArchive = {
      manifest: { version: "1.0.0", language: "ja" },
      collections: {
        amenity: fc([
          { type: "Feature", id: "am-1", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} },
        ]),
      },
    };
    const venue = normalizeVenue(archive);
    expect(venue.featuresById.get("am-1")?.buildingId).toBeNull();
    expect(venue.buildings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm test --run src/imdf/normalizeVenue.test.ts`
Expected: FAIL — `buildingId` missing on `ViewerFeature`; `buildings` missing on `LoadedVenue` (type error / undefined).

- [ ] **Step 3: Extend the types**

In `src/imdf/types.ts`, add to `ViewerFeature` (after `restriction`):

```ts
  /** Resolved building feature id this feature belongs to, or null. */
  buildingId: string | null;
```

Add to `SearchEntry` (after `levelId`):

```ts
  buildingId: string | null;
```

Add near `LoadedVenue` (before it):

```ts
export interface VenueBuilding {
  id: string;
  label: Record<string, string>;
}
```

Add to `LoadedVenue` (after `levels`):

```ts
  buildings: VenueBuilding[];
```

- [ ] **Step 4: Resolve buildingId in `normalizeVenue`**

In `src/imdf/normalizeVenue.ts`, add near the top-level helpers (after `RawFeature`):

```ts
function firstBuildingId(props: Record<string, unknown>): string | null {
  const ids = props["building_ids"];
  if (!Array.isArray(ids)) {
    return null;
  }
  for (const value of ids) {
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return null;
}
```

In the `viewerFeature` object literal (currently ends with `sourceProperties: props,`), add:

```ts
        buildingId: null,
```

In the second loop, immediately after `feature.levelId = levelId;` (line ~297), resolve the building from the **source** level id (`levelId` here is still the source level id, before the ordinal-group remap):

```ts
    if (feature.featureType === "building") {
      feature.buildingId = feature.id;
    } else if (feature.featureType === "footprint" || feature.featureType === "level") {
      feature.buildingId = firstBuildingId(props);
    } else if (levelId !== null) {
      const sourceLevel = featuresById.get(levelId);
      feature.buildingId = sourceLevel ? firstBuildingId(sourceLevel.sourceProperties) : null;
    }
```

- [ ] **Step 5: Build the `buildings` list and add to the return**

In `src/imdf/normalizeVenue.ts`, before the final `return {`:

```ts
  const buildings: VenueBuilding[] = [];
  for (const feature of featuresById.values()) {
    if (feature.featureType === "building") {
      buildings.push({ id: feature.id, label: feature.labels });
    }
  }
  buildings.sort((a, b) => {
    const la = a.label["ja"] ?? a.label["en"] ?? a.id;
    const lb = b.label["ja"] ?? b.label["en"] ?? b.id;
    return la < lb ? -1 : la > lb ? 1 : 0;
  });
```

Add `buildings,` to the returned object (after `levels,`). Import `VenueBuilding` in the existing `import type { … } from "./types"` block.

- [ ] **Step 6: Copy `buildingId` into search entries**

In `src/search/buildSearchEntries.ts`, add to the pushed entry object (after `levelId: feature.levelId,`):

```ts
      buildingId: feature.buildingId,
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `corepack pnpm test --run src/imdf/normalizeVenue.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `corepack pnpm typecheck`
Expected: no errors. (If existing `ViewerFeature`/`SearchEntry` fixtures elsewhere now lack `buildingId`, add `buildingId: null` to them — search test files for `featureType:` object literals building these types.)

- [ ] **Step 9: Commit**

```bash
git add src/imdf/types.ts src/imdf/normalizeVenue.ts src/search/buildSearchEntries.ts src/imdf/normalizeVenue.test.ts
git commit -m "feat: resolve per-feature buildingId and venue buildings"
```

---

### Task 2: `color2` palette + render feature properties

**Files:**
- Create: `src/map/color2.ts`
- Create: `src/map/color2.test.ts`
- Modify: `src/map/buildRenderFeatures.ts` (`RenderFeatureProperties`, `renderFeatureFromViewer`)
- Test: `src/map/buildRenderFeatures.test.ts`

**Interfaces:**
- Consumes: `ViewerFeature.buildingId` (Task 1).
- Produces: `color2Fill(value: unknown): string | null`; `RenderFeatureProperties.__building_id: string | null`; `RenderFeatureProperties.__unit_color?: string`.

- [ ] **Step 1: Write the failing color2 test**

Create `src/map/color2.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { color2Fill, COLOR2_DEFAULT } from "./color2";

describe("color2Fill", () => {
  it("maps known values to their exact hex", () => {
    expect(color2Fill("橙")).toBe("#FFC090");
    expect(color2Fill("濃鼠")).toBe("#C8C9CA");
    expect(color2Fill("ラチ外白")).toBe("#FFFFFF");
  });
  it("maps 道白 to white", () => {
    expect(color2Fill("道白")).toBe("#FFFFFF");
  });
  it("returns the default gray for a present-but-unmapped value", () => {
    expect(color2Fill("未知の色")).toBe(COLOR2_DEFAULT);
    expect(COLOR2_DEFAULT).toBe("#808080");
  });
  it("returns null when the value is absent or blank", () => {
    expect(color2Fill(undefined)).toBeNull();
    expect(color2Fill(null)).toBeNull();
    expect(color2Fill("")).toBeNull();
    expect(color2Fill(42)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm test --run src/map/color2.test.ts`
Expected: FAIL — module `./color2` not found.

- [ ] **Step 3: Create the palette module**

Create `src/map/color2.ts`:

```ts
/**
 * Per-feature fill colors for unit (_Space) features, keyed by the source
 * `color2` attribute. Hex values are copied verbatim from the Cesium project
 * (`src/main.js` / `src/viewer.js` COLOR2_LOOKUP); `道白` is added as white.
 */
export const COLOR2_LOOKUP: Record<string, string> = {
  "橙": "#FFC090",
  "トイレ": "#E5E6E6",
  "薄紅": "#FFECE6",
  "緑": "#DDF5D9",
  "濃空": "#C2E5F2",
  "濃鼠": "#C8C9CA",
  "白": "#FFFFFF",
  "薄空": "#C0E0EA",
  "薄鼠": "#A0A1A2",
  "黄": "#F5F5C0",
  "濃紅": "#F2CFC2",
  "ラチ外白": "#FFFFFF",
  "進入制限あり": "#E5E6E6",
  "道白": "#FFFFFF",
};

/** Fallback fill for a present-but-unmapped color2 value (matches Cesium). */
export const COLOR2_DEFAULT = "#808080";

/**
 * Resolve a unit's fill from its raw `color2` value: the mapped hex, the
 * default gray for a present-but-unmapped string, or null when absent/blank so
 * the caller keeps the theme color.
 */
export function color2Fill(value: unknown): string | null {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return COLOR2_LOOKUP[value] ?? COLOR2_DEFAULT;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm test --run src/map/color2.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing render-property test**

Add to `src/map/buildRenderFeatures.test.ts`:

```ts
it("stamps __building_id and __unit_color for a unit with color2", () => {
  const feature = {
    id: "u1",
    featureType: "unit" as const,
    levelId: "ordinal:0",
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } as GeoJSON.Geometry,
    center: [0.5, 0.5] as [number, number],
    labels: {},
    altLabels: {},
    category: "room",
    accessibility: [],
    restriction: null,
    buildingId: "bldg-A",
    sourceProperties: { color2: "緑" },
  };
  const rendered = renderFeatureFromViewer(feature);
  expect(rendered?.properties?.["__building_id"]).toBe("bldg-A");
  expect(rendered?.properties?.["__unit_color"]).toBe("#DDF5D9");
});

it("omits __unit_color for non-units and units without color2", () => {
  const base = {
    id: "x",
    levelId: "ordinal:0",
    geometry: { type: "Point", coordinates: [0, 0] } as GeoJSON.Geometry,
    center: [0, 0] as [number, number],
    labels: {},
    altLabels: {},
    category: null,
    accessibility: [],
    restriction: null,
    buildingId: null,
    sourceProperties: { color2: "緑" },
  };
  const amenity = renderFeatureFromViewer({ ...base, featureType: "amenity" as const });
  expect(amenity?.properties?.["__unit_color"]).toBeUndefined();
  const unitNoColor = renderFeatureFromViewer({
    ...base,
    featureType: "unit" as const,
    sourceProperties: {},
  });
  expect(unitNoColor?.properties?.["__unit_color"]).toBeUndefined();
});
```

(If `renderFeatureFromViewer` is not yet imported in the test file, add it to the import from `./buildRenderFeatures`.)

- [ ] **Step 6: Run to verify it fails**

Run: `corepack pnpm test --run src/map/buildRenderFeatures.test.ts`
Expected: FAIL — `__building_id`/`__unit_color` undefined.

- [ ] **Step 7: Extend render properties**

In `src/map/buildRenderFeatures.ts`, add to `RenderFeatureProperties` (after `__restricted`):

```ts
  __building_id: string | null;
  /** Per-unit fill from the source `color2` value; absent when not applicable. */
  __unit_color?: string;
```

Add the import at the top:

```ts
import { color2Fill } from "./color2";
```

In `renderFeatureFromViewer`, add `__building_id` to the `properties` literal (after `__restricted`):

```ts
    __building_id: feature.buildingId,
```

After the existing `markerIcon` block (before `return`), add:

```ts
  if (feature.featureType === "unit") {
    const unitColor = color2Fill(feature.sourceProperties["color2"]);
    if (unitColor !== null) {
      properties.__unit_color = unitColor;
    }
  }
```

- [ ] **Step 8: Run to verify tests pass**

Run: `corepack pnpm test --run src/map/buildRenderFeatures.test.ts src/map/color2.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/map/color2.ts src/map/color2.test.ts src/map/buildRenderFeatures.ts src/map/buildRenderFeatures.test.ts
git commit -m "feat: add color2 palette and stamp __unit_color/__building_id on render features"
```

---

### Task 3: Unit fill layers consume `__unit_color`

**Files:**
- Modify: `src/map/featureLayers.ts` (`buildFeatureLayers`, `applyThemePaintProperties`)
- Test: `src/map/featureLayers.test.ts`

**Interfaces:**
- Consumes: `__unit_color` render property (Task 2).

- [ ] **Step 1: Write the failing test**

Add to `src/map/featureLayers.test.ts` (import `buildFeatureLayers` and a theme; reuse the file's existing theme import):

```ts
it("wraps unit fill colors in a coalesce over __unit_color", () => {
  const layers = buildFeatureLayers(themeForTest); // existing test theme
  const room = layers.find((l) => l.id === "indoor-room-fill");
  expect(room?.paint?.["fill-color"]).toEqual([
    "coalesce",
    ["get", "__unit_color"],
    expect.any(String),
  ]);
});
```

(Use whatever theme value the existing tests in this file already construct; name it accordingly.)

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm test --run src/map/featureLayers.test.ts`
Expected: FAIL — `fill-color` is a plain string.

- [ ] **Step 3: Add a coalesce helper and apply it to unit fills**

In `src/map/featureLayers.ts`, inside `buildFeatureLayers` after `const c = theme.colors;`:

```ts
  const unitFill = (themeColor: string): ExpressionSpecification => [
    "coalesce",
    ["get", "__unit_color"],
    themeColor,
  ];
```

Change the `fill-color` of each unit fill layer to use it:
- `LAYER_WALKWAY_FILL`: `"fill-color": unitFill(c.walkway),`
- `LAYER_ROOM_FILL`: `unitFill(c.unit)`
- `LAYER_UNENCLOSED_FILL`: `unitFill(c.unitUnenclosed)`
- `LAYER_TRANSIT_FILL`: `unitFill(c.unitTransit)`
- `LAYER_RESTROOM_FILL`: `unitFill(c.unitRestroom)`
- `LAYER_NONPUBLIC_FILL`: `unitFill(c.unitNonPublic)`
- `LAYER_PARKING_FILL`: `unitFill(c.unitParking)`
- `LAYER_PLATFORM_FILL`: `unitFill(c.unitPlatform)`
- `LAYER_STRUCTURE_FILL`: `unitFill(c.unit)`
- `LAYER_RESTRICTED_FILL`: `unitFill(c.restricted)`

Leave context/fixture/kiosk/detail/opening/amenity/occupant layers unchanged.

- [ ] **Step 4: Mirror the coalesce on theme switch**

In `applyThemePaintProperties`, replace the `fill-color` sets for the same ten layers with the coalesce form, e.g.:

```ts
  setPaintProperty(LAYER_ROOM_FILL, "fill-color", ["coalesce", ["get", "__unit_color"], c.unit]);
```

Apply to `LAYER_WALKWAY_FILL` (`c.walkway`), `LAYER_ROOM_FILL` (`c.unit`), `LAYER_UNENCLOSED_FILL` (`c.unitUnenclosed`), `LAYER_TRANSIT_FILL` (`c.unitTransit`), `LAYER_RESTROOM_FILL` (`c.unitRestroom`), `LAYER_NONPUBLIC_FILL` (`c.unitNonPublic`), `LAYER_PARKING_FILL` (`c.unitParking`), `LAYER_PLATFORM_FILL` (`c.unitPlatform`), `LAYER_STRUCTURE_FILL` (`c.unit`), `LAYER_RESTRICTED_FILL` (`c.restricted`). Leave the `*_OUTLINE` line-color sets untouched.

- [ ] **Step 5: Run to verify it passes**

Run: `corepack pnpm test --run src/map/featureLayers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/map/featureLayers.ts src/map/featureLayers.test.ts
git commit -m "feat: color unit fills by color2 via coalesce over theme colors"
```

---

### Task 4: Visibility predicate module

**Files:**
- Create: `src/map/visibility.ts`
- Create: `src/map/visibility.test.ts`

**Interfaces:**
- Consumes: `ViewerFeature.buildingId`, `SearchEntry.buildingId`.
- Produces:
  - `export interface VisibilitySelection { hiddenTypes: ReadonlySet<FeatureType>; hiddenBuildings: ReadonlySet<string> }`
  - `isTypeAndBuildingVisible(featureType: FeatureType, buildingId: string | null, v: VisibilitySelection): boolean`
  - `visibleSearchEntries(entries: SearchEntry[], v: VisibilitySelection): SearchEntry[]`

- [ ] **Step 1: Write the failing test**

Create `src/map/visibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isTypeAndBuildingVisible, visibleSearchEntries, type VisibilitySelection } from "./visibility";
import type { SearchEntry } from "../imdf/types";

const none: VisibilitySelection = { hiddenTypes: new Set(), hiddenBuildings: new Set() };

describe("isTypeAndBuildingVisible", () => {
  it("shows everything when nothing is hidden", () => {
    expect(isTypeAndBuildingVisible("unit", "b1", none)).toBe(true);
  });
  it("hides a hidden type", () => {
    const v: VisibilitySelection = { hiddenTypes: new Set(["unit"]), hiddenBuildings: new Set() };
    expect(isTypeAndBuildingVisible("unit", "b1", v)).toBe(false);
    expect(isTypeAndBuildingVisible("opening", "b1", v)).toBe(true);
  });
  it("hides a feature in a hidden building but keeps null-building features", () => {
    const v: VisibilitySelection = { hiddenTypes: new Set(), hiddenBuildings: new Set(["b1"]) };
    expect(isTypeAndBuildingVisible("unit", "b1", v)).toBe(false);
    expect(isTypeAndBuildingVisible("unit", "b2", v)).toBe(true);
    expect(isTypeAndBuildingVisible("unit", null, v)).toBe(true);
  });
  it("always shows the venue outline", () => {
    const v: VisibilitySelection = { hiddenTypes: new Set(["venue"]), hiddenBuildings: new Set(["b1"]) };
    expect(isTypeAndBuildingVisible("venue", "b1", v)).toBe(true);
  });
});

describe("visibleSearchEntries", () => {
  it("drops entries whose type or building is hidden", () => {
    const entries: SearchEntry[] = [
      { featureId: "u1", featureType: "unit", levelId: "l", buildingId: "b1", category: null, labels: {}, altLabels: {}, normalizedLabels: [], normalizedAltLabels: [], normalizedCategory: "" },
      { featureId: "o1", featureType: "opening", levelId: "l", buildingId: "b2", category: null, labels: {}, altLabels: {}, normalizedLabels: [], normalizedAltLabels: [], normalizedCategory: "" },
    ];
    const v: VisibilitySelection = { hiddenTypes: new Set(["unit"]), hiddenBuildings: new Set() };
    expect(visibleSearchEntries(entries, v).map((e) => e.featureId)).toEqual(["o1"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm test --run src/map/visibility.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

Create `src/map/visibility.ts`:

```ts
import type { FeatureType, SearchEntry } from "../imdf/types";

/** Session visibility: the sets of hidden feature types and building ids. */
export interface VisibilitySelection {
  hiddenTypes: ReadonlySet<FeatureType>;
  hiddenBuildings: ReadonlySet<string>;
}

/**
 * Whether a feature of `featureType` belonging to `buildingId` is visible under
 * the current selection. The venue outline is always visible; a null building
 * is unaffected by building filters.
 */
export function isTypeAndBuildingVisible(
  featureType: FeatureType,
  buildingId: string | null,
  v: VisibilitySelection,
): boolean {
  if (featureType === "venue") {
    return true;
  }
  if (v.hiddenTypes.has(featureType)) {
    return false;
  }
  return buildingId === null || !v.hiddenBuildings.has(buildingId);
}

/** Search entries that survive the current visibility selection. */
export function visibleSearchEntries(
  entries: SearchEntry[],
  v: VisibilitySelection,
): SearchEntry[] {
  return entries.filter((entry) => isTypeAndBuildingVisible(entry.featureType, entry.buildingId, v));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm test --run src/map/visibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/map/visibility.ts src/map/visibility.test.ts
git commit -m "feat: add visibility predicate and search-entry filter"
```

---

### Task 5: `buildRenderFeatures` honors visibility

**Files:**
- Modify: `src/map/buildRenderFeatures.ts`
- Test: `src/map/buildRenderFeatures.test.ts`

**Interfaces:**
- Consumes: `VisibilitySelection`, `isTypeAndBuildingVisible` (Task 4); render props `__feature_type`, `__building_id` (Task 2).
- Produces: `buildRenderFeatures(venue, levelId, visibility?: VisibilitySelection)` — third arg optional; omitted = current behavior.

- [ ] **Step 1: Write the failing test**

Add to `src/map/buildRenderFeatures.test.ts` (using the file's existing venue fixture builder; if none, build a minimal `LoadedVenue` with one unit + one opening on the same level, each with a `buildingId`):

```ts
it("excludes hidden types and buildings but keeps the venue outline", () => {
  const venue = venueFixture(); // existing helper in this test file
  const levelId = venue.levels[0]!.id;
  const hidden = buildRenderFeatures(venue, levelId, {
    hiddenTypes: new Set(["unit"]),
    hiddenBuildings: new Set(),
  });
  const types = hidden.features.map((f) => f.properties?.["__feature_type"]);
  expect(types).not.toContain("unit");
  expect(types).toContain("venue");
});
```

If the test file has no `venueFixture`, construct one inline via `normalizeVenue` (import it) with a venue feature, one level (`building_ids:["b1"]`), one unit (`level_id` to that level), and one opening; assert the unit is dropped when `unit` is hidden and retained otherwise.

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm test --run src/map/buildRenderFeatures.test.ts`
Expected: FAIL — third arg ignored; unit still present.

- [ ] **Step 3: Add the visibility filter**

In `src/map/buildRenderFeatures.ts`, add imports:

```ts
import { isTypeAndBuildingVisible, type VisibilitySelection } from "./visibility";
```

Add a private helper (module scope) that reads render properties:

```ts
function renderPropsVisible(
  properties: RenderFeatureProperties,
  visibility: VisibilitySelection | undefined,
): boolean {
  if (visibility === undefined) {
    return true;
  }
  return isTypeAndBuildingVisible(properties.__feature_type, properties.__building_id, visibility);
}
```

Change the signature to `buildRenderFeatures(venue: LoadedVenue, levelId: string, visibility?: VisibilitySelection): FeatureCollection`.

In `pushFeature`, after `const rendered = renderFeatureFromViewer(feature);` and its null check, add:

```ts
    const props = rendered.properties as RenderFeatureProperties;
    if (!renderPropsVisible(props, visibility)) {
      return;
    }
```

In the level-collection loop, before `features.push(feature);`, guard with the feature's own properties:

```ts
      if (!renderPropsVisible(feature.properties as RenderFeatureProperties, visibility)) {
        continue;
      }
```

(Note: `feature.properties` here are the precomputed `RenderFeatureProperties`; the cast is the established boundary cast in this file. If the project's `ts-no-inline-cast-access` rule flags it, extract `const p = feature.properties;` then read fields via `isTypeAndBuildingVisible(p?.__feature_type, …)` with `typeof` guards instead.)

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm test --run src/map/buildRenderFeatures.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/map/buildRenderFeatures.ts src/map/buildRenderFeatures.test.ts
git commit -m "feat: filter render features by visibility selection"
```

---

### Task 6: Reducer state, actions, reset, and selection clear

**Files:**
- Modify: `src/state/viewerReducer.ts`
- Test: `src/state/viewerReducer.test.ts`

**Interfaces:**
- Produces: `ReadyVenueState.hiddenTypes: ReadonlySet<FeatureType>`, `ReadyVenueState.hiddenBuildings: ReadonlySet<string>`; actions `toggle_type`, `toggle_building`, `set_types_hidden`, `set_buildings_hidden`.

- [ ] **Step 1: Write the failing tests**

Add to `src/state/viewerReducer.test.ts` (reuse the file's helper that produces a `ready` state with a loaded venue; call it `ready` below):

```ts
it("toggles a hidden type on and off", () => {
  const s0 = ready();
  const s1 = viewerReducer(s0, { type: "toggle_type", featureType: "unit" });
  expect(s1.status === "ready" && s1.hiddenTypes.has("unit")).toBe(true);
  const s2 = viewerReducer(s1, { type: "toggle_type", featureType: "unit" });
  expect(s2.status === "ready" && s2.hiddenTypes.has("unit")).toBe(false);
});

it("bulk-sets hidden buildings", () => {
  const s = viewerReducer(ready(), { type: "set_buildings_hidden", hidden: ["b1", "b2"] });
  expect(s.status === "ready" && s.hiddenBuildings.has("b1") && s.hiddenBuildings.has("b2")).toBe(true);
});

it("resets hidden sets on load_succeeded", () => {
  const hiddenState = viewerReducer(ready(), { type: "toggle_type", featureType: "unit" });
  const loaded = viewerReducer(hiddenState, {
    type: "load_succeeded",
    fileName: hiddenState.status === "ready" ? hiddenState.fileName : "x",
    venue: hiddenState.status === "ready" ? hiddenState.loadedVenue : anyVenue(),
  });
  // load_succeeded only applies from loading/reviewing; assert the fresh-ready shape instead:
  const fresh = freshReadyFromLoad(); // build a loading state then dispatch load_succeeded
  expect(fresh.status === "ready" && fresh.hiddenTypes.size === 0 && fresh.hiddenBuildings.size === 0).toBe(true);
});

it("clears the selection when its type is hidden", () => {
  const withSel = viewerReducer(ready(), { type: "select_feature", featureId: KNOWN_UNIT_ID });
  const hidden = viewerReducer(withSel, { type: "toggle_type", featureType: "unit" });
  expect(hidden.status === "ready" && hidden.selectedFeatureId).toBeNull();
});
```

Adapt the helpers (`ready`, `anyVenue`, `KNOWN_UNIT_ID`, `freshReadyFromLoad`) to the fixtures already present in this test file. `KNOWN_UNIT_ID` must be a unit feature id in the fixture venue.

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm test --run src/state/viewerReducer.test.ts`
Expected: FAIL — actions/fields absent (type errors, undefined `hiddenTypes`).

- [ ] **Step 3: Extend `ReadyVenueState` and `currentReadyState`**

In `src/state/viewerReducer.ts`, add to `ReadyVenueState`:

```ts
  hiddenTypes: ReadonlySet<FeatureType>;
  hiddenBuildings: ReadonlySet<string>;
```

Import `FeatureType` from `../imdf/types` (extend the existing import). In `currentReadyState`, include the new fields in the destructure and return object.

- [ ] **Step 4: Add the actions**

Add to `ViewerAction`:

```ts
  | { type: "toggle_type"; featureType: FeatureType }
  | { type: "toggle_building"; buildingId: string }
  | { type: "set_types_hidden"; hidden: FeatureType[] }
  | { type: "set_buildings_hidden"; hidden: string[] }
```

- [ ] **Step 5: Initialize on `load_succeeded`**

In the `load_succeeded` return object, add:

```ts
        hiddenTypes: new Set(),
        hiddenBuildings: new Set(),
```

- [ ] **Step 6: Implement the toggle/bulk cases with selection clear**

Add a helper above `viewerReducer`:

```ts
function clearedSelectionIfHidden(
  state: ViewerState & { status: "ready" },
  hiddenTypes: ReadonlySet<FeatureType>,
  hiddenBuildings: ReadonlySet<string>,
): string | null {
  const id = state.selectedFeatureId;
  if (id === null) {
    return null;
  }
  const feature = state.loadedVenue.featuresById.get(id);
  if (feature === undefined) {
    return id;
  }
  const visible =
    !hiddenTypes.has(feature.featureType) &&
    (feature.buildingId === null || !hiddenBuildings.has(feature.buildingId));
  return visible ? id : null;
}
```

Add cases inside `viewerReducer`'s switch:

```ts
    case "toggle_type": {
      if (state.status !== "ready") return state;
      const hiddenTypes = new Set(state.hiddenTypes);
      if (hiddenTypes.has(action.featureType)) hiddenTypes.delete(action.featureType);
      else hiddenTypes.add(action.featureType);
      return {
        ...state,
        hiddenTypes,
        selectedFeatureId: clearedSelectionIfHidden(state, hiddenTypes, state.hiddenBuildings),
      };
    }
    case "toggle_building": {
      if (state.status !== "ready") return state;
      const hiddenBuildings = new Set(state.hiddenBuildings);
      if (hiddenBuildings.has(action.buildingId)) hiddenBuildings.delete(action.buildingId);
      else hiddenBuildings.add(action.buildingId);
      return {
        ...state,
        hiddenBuildings,
        selectedFeatureId: clearedSelectionIfHidden(state, state.hiddenTypes, hiddenBuildings),
      };
    }
    case "set_types_hidden": {
      if (state.status !== "ready") return state;
      const hiddenTypes = new Set(action.hidden);
      return {
        ...state,
        hiddenTypes,
        selectedFeatureId: clearedSelectionIfHidden(state, hiddenTypes, state.hiddenBuildings),
      };
    }
    case "set_buildings_hidden": {
      if (state.status !== "ready") return state;
      const hiddenBuildings = new Set(action.hidden);
      return {
        ...state,
        hiddenBuildings,
        selectedFeatureId: clearedSelectionIfHidden(state, state.hiddenTypes, hiddenBuildings),
      };
    }
```

- [ ] **Step 7: Run tests**

Run: `corepack pnpm test --run src/state/viewerReducer.test.ts`
Expected: PASS. Then `corepack pnpm typecheck` — fix any `ReadyVenueState` constructor sites (search for `status: "ready"` literals in tests/fixtures) to include the two new sets.

- [ ] **Step 8: Commit**

```bash
git add src/state/viewerReducer.ts src/state/viewerReducer.test.ts
git commit -m "feat: hidden type/building state, toggles, reset, and selection clear"
```

---

### Task 7: POI markers honor visibility

**Files:**
- Modify: `src/map/useFeatureMarkers.ts` (`collectMarkerFeatures` + hook options)
- Test: `src/map/useFeatureMarkers.test.ts`

**Interfaces:**
- Consumes: `VisibilitySelection` (Task 4), `ViewerFeature.buildingId`.
- Produces: `collectMarkerFeatures(venue, levelId, selectedFeatureId, searchCategory, visibility)` gains a trailing `visibility: VisibilitySelection` parameter; `useFeatureMarkers` options gain `visibility: VisibilitySelection`.

- [ ] **Step 1: Write the failing test**

Add to `src/map/useFeatureMarkers.test.ts` (reuse its venue fixture + existing `collectMarkerFeatures` call sites):

```ts
it("omits markers for hidden types and buildings", () => {
  const venue = markerVenueFixture();
  const levelId = venue.levels[0]!.id;
  const hiddenType = collectMarkerFeatures(venue, levelId, null, "all", {
    hiddenTypes: new Set(["amenity"]),
    hiddenBuildings: new Set(),
  });
  expect(hiddenType.some((f) => f.featureType === "amenity")).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm test --run src/map/useFeatureMarkers.test.ts`
Expected: FAIL — extra arg ignored / arity mismatch.

- [ ] **Step 3: Thread visibility through**

In `src/map/useFeatureMarkers.ts`:
- Import: `import { isTypeAndBuildingVisible, type VisibilitySelection } from "./visibility";`
- Add `visibility: VisibilitySelection` as the final parameter of `collectMarkerFeatures`.
- In its `for (const feature of venue.featuresById.values())` loop, after the existing `levelId`/`center`/type guards, add:

```ts
    if (!isTypeAndBuildingVisible(feature.featureType, feature.buildingId, visibility)) {
      continue;
    }
```

- Add `visibility: VisibilitySelection;` to the hook's options interface, destructure it in `useFeatureMarkers({ … })`, pass it to the `collectMarkerFeatures(...)` call, and add `visibility` to the marker effect's dependency array.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm test --run src/map/useFeatureMarkers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/map/useFeatureMarkers.ts src/map/useFeatureMarkers.test.ts
git commit -m "feat: hide POI markers for hidden types and buildings"
```

---

### Task 8: `IndoorMap` wires visibility into source + markers

**Files:**
- Modify: `src/map/IndoorMap.tsx`
- Test: `src/map/IndoorMap.test.tsx`

**Interfaces:**
- Consumes: `VisibilitySelection`; `buildRenderFeatures` third arg; `useFeatureMarkers` visibility option.
- Produces: `IndoorMapProps.visibility: VisibilitySelection`.

- [ ] **Step 1: Write the failing test**

Add to `src/map/IndoorMap.test.tsx` a test that renders `IndoorMap` with `visibility={{ hiddenTypes: new Set(["unit"]), hiddenBuildings: new Set() }}` and asserts the source `setData` (spied via the existing MapLibre stub in this test file) received a collection with no `unit` features. Follow the file's existing render + stub harness; assert on the last `setData` payload.

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm test --run src/map/IndoorMap.test.tsx`
Expected: FAIL — `visibility` prop unknown; unit still present.

- [ ] **Step 3: Add the prop and thread it**

In `src/map/IndoorMap.tsx`:
- Import: `import type { VisibilitySelection } from "./visibility";`
- Add `visibility: VisibilitySelection;` to `IndoorMapProps` and destructure `visibility` in the component.
- Change the source updater `updateSource(map, venue, levelId)` to `updateSource(map, venue, levelId, visibility)` and its body `source.setData(buildRenderFeatures(venue, levelId, visibility));`. Update all call sites.
- Add `visibility` to the dependency array of the effect that calls `updateSource` (the effect currently keyed on `[venue, levelId]`).
- Pass `visibility` to the `useFeatureMarkers({ … })` options.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm test --run src/map/IndoorMap.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/map/IndoorMap.tsx src/map/IndoorMap.test.tsx
git commit -m "feat: pass visibility selection into the indoor source and markers"
```

---

### Task 9: `LayerControls` panel component

**Files:**
- Create: `src/components/LayerControls.tsx`
- Test: `src/components/components.test.tsx` (new describe block)

**Interfaces:**
- Consumes: `FeatureType`, `VenueBuilding`, `LocaleCode`.
- Produces:

```ts
export interface LayerTypeRow { featureType: FeatureType; count: number }
export interface LayerBuildingRow { id: string; label: string; count: number }
export interface LayerControlsProps {
  locale: LocaleCode;
  types: LayerTypeRow[];            // only types present in the venue
  buildings: LayerBuildingRow[];    // empty or length>=2 (App enforces)
  hiddenTypes: ReadonlySet<FeatureType>;
  hiddenBuildings: ReadonlySet<string>;
  onToggleType: (featureType: FeatureType) => void;
  onToggleBuilding: (buildingId: string) => void;
  onSetTypesHidden: (hidden: FeatureType[]) => void;
  onSetBuildingsHidden: (hidden: string[]) => void;
  onOpenChange: (open: boolean) => void;
}
```

- [ ] **Step 1: Write the failing tests**

Add to `src/components/components.test.tsx`:

```ts
import { LayerControls } from "./LayerControls";

function layerProps(over: Partial<ComponentProps<typeof LayerControls>> = {}) {
  return {
    locale: "en" as const,
    types: [
      { featureType: "unit" as const, count: 142 },
      { featureType: "opening" as const, count: 12 },
    ],
    buildings: [] as ComponentProps<typeof LayerControls>["buildings"],
    hiddenTypes: new Set<FeatureType>(),
    hiddenBuildings: new Set<string>(),
    onToggleType: vi.fn(),
    onToggleBuilding: vi.fn(),
    onSetTypesHidden: vi.fn(),
    onSetBuildingsHidden: vi.fn(),
    onOpenChange: vi.fn(),
    ...over,
  };
}

describe("LayerControls", () => {
  it("opens the panel and lists present types with counts", async () => {
    const user = userEvent.setup();
    render(<LayerControls {...layerProps()} />);
    await user.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getByRole("checkbox", { name: "Units (142)" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Openings (12)" })).toBeTruthy();
  });

  it("reflects hidden state and fires onToggleType", async () => {
    const user = userEvent.setup();
    const props = layerProps({ hiddenTypes: new Set(["unit"]) });
    render(<LayerControls {...props} />);
    await user.click(screen.getByRole("button", { name: "Layers" }));
    const unit = screen.getByRole("checkbox", { name: "Units (142)" }) as HTMLInputElement;
    expect(unit.checked).toBe(false); // hidden = unchecked
    await user.click(unit);
    expect(props.onToggleType).toHaveBeenCalledWith("unit");
  });

  it("omits the buildings section when fewer than two buildings", async () => {
    const user = userEvent.setup();
    render(<LayerControls {...layerProps({ buildings: [] })} />);
    await user.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.queryByRole("group", { name: "Buildings" })).toBeNull();
  });

  it("shows buildings and hide-all fires onSetBuildingsHidden with every id", async () => {
    const user = userEvent.setup();
    const props = layerProps({
      buildings: [
        { id: "b1", label: "A", count: 3 },
        { id: "b2", label: "B", count: 4 },
      ],
    });
    render(<LayerControls {...props} />);
    await user.click(screen.getByRole("button", { name: "Layers" }));
    const group = screen.getByRole("group", { name: "Buildings" });
    await user.click(within(group).getByRole("button", { name: "Hide all" }));
    expect(props.onSetBuildingsHidden).toHaveBeenCalledWith(["b1", "b2"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm test --run src/components/components.test.tsx`
Expected: FAIL — module `./LayerControls` not found.

- [ ] **Step 3: Implement the component**

Create `src/components/LayerControls.tsx`. Model the open/close/portal/escape/outside-click behavior on `ViewerMenu.tsx`. Concrete implementation:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { FeatureType, LocaleCode } from "../imdf/types";

const ui = {
  button: { ja: "レイヤー", en: "Layers" },
  panel: { ja: "レイヤー表示", en: "Layers" },
  types: { ja: "地物種別", en: "Feature types" },
  buildings: { ja: "建物", en: "Buildings" },
  showAll: { ja: "すべて表示", en: "Show all" },
  hideAll: { ja: "すべて非表示", en: "Hide all" },
} as const;

const TYPE_LABELS: Record<string, { ja: string; en: string }> = {
  unit: { ja: "ユニット", en: "Units" },
  opening: { ja: "開口部", en: "Openings" },
  detail: { ja: "ディテール", en: "Details" },
  amenity: { ja: "アメニティ", en: "Amenities" },
  fixture: { ja: "什器", en: "Fixtures" },
  kiosk: { ja: "キオスク", en: "Kiosks" },
  occupant: { ja: "テナント", en: "Occupants" },
};

export interface LayerTypeRow {
  featureType: FeatureType;
  count: number;
}
export interface LayerBuildingRow {
  id: string;
  label: string;
  count: number;
}
export interface LayerControlsProps {
  locale: LocaleCode;
  types: LayerTypeRow[];
  buildings: LayerBuildingRow[];
  hiddenTypes: ReadonlySet<FeatureType>;
  hiddenBuildings: ReadonlySet<string>;
  onToggleType: (featureType: FeatureType) => void;
  onToggleBuilding: (buildingId: string) => void;
  onSetTypesHidden: (hidden: FeatureType[]) => void;
  onSetBuildingsHidden: (hidden: string[]) => void;
  onOpenChange: (open: boolean) => void;
}

function typeLabel(featureType: FeatureType, locale: LocaleCode): string {
  const entry = TYPE_LABELS[featureType];
  return entry ? entry[locale] : featureType;
}

export function LayerControls({
  locale,
  types,
  buildings,
  hiddenTypes,
  hiddenBuildings,
  onToggleType,
  onToggleBuilding,
  onSetTypesHidden,
  onSetBuildingsHidden,
  onOpenChange,
}: LayerControlsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange(next);
    },
    [onOpenChange],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocPointer = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpenState(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpenState(false);
      }
    };
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpenState]);

  const anyHidden = hiddenTypes.size > 0 || hiddenBuildings.size > 0;
  const showBuildings = buildings.length >= 2;

  return (
    <div className="layer-controls" ref={rootRef}>
      <button
        type="button"
        className={anyHidden ? "layer-controls__btn layer-controls__btn--active" : "layer-controls__btn"}
        aria-expanded={open}
        aria-pressed={anyHidden}
        onClick={() => setOpenState(!open)}
      >
        {ui.button[locale]}
      </button>
      {open ? (
        <div className="layer-controls__panel" role="group" aria-label={ui.panel[locale]}>
          <section className="layer-controls__section" role="group" aria-label={ui.types[locale]}>
            <header className="layer-controls__header">
              <span>{ui.types[locale]}</span>
              <span className="layer-controls__bulk">
                <button type="button" onClick={() => onSetTypesHidden([])}>
                  {ui.showAll[locale]}
                </button>
                <button type="button" onClick={() => onSetTypesHidden(types.map((t) => t.featureType))}>
                  {ui.hideAll[locale]}
                </button>
              </span>
            </header>
            <ul className="layer-controls__list">
              {types.map((row) => (
                <li key={row.featureType}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!hiddenTypes.has(row.featureType)}
                      onChange={() => onToggleType(row.featureType)}
                    />
                    {`${typeLabel(row.featureType, locale)} (${row.count})`}
                  </label>
                </li>
              ))}
            </ul>
          </section>
          {showBuildings ? (
            <section className="layer-controls__section" role="group" aria-label={ui.buildings[locale]}>
              <header className="layer-controls__header">
                <span>{ui.buildings[locale]}</span>
                <span className="layer-controls__bulk">
                  <button type="button" onClick={() => onSetBuildingsHidden([])}>
                    {ui.showAll[locale]}
                  </button>
                  <button type="button" onClick={() => onSetBuildingsHidden(buildings.map((b) => b.id))}>
                    {ui.hideAll[locale]}
                  </button>
                </span>
              </header>
              <ul className="layer-controls__list">
                {buildings.map((row) => (
                  <li key={row.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!hiddenBuildings.has(row.id)}
                        onChange={() => onToggleBuilding(row.id)}
                      />
                      {`${row.label} (${row.count})`}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify tests pass**

Run: `corepack pnpm test --run src/components/components.test.tsx`
Expected: PASS. (Ensure `within` and `ComponentProps` are imported in the test file — both already are per existing tests.)

- [ ] **Step 5: Commit**

```bash
git add src/components/LayerControls.tsx src/components/components.test.tsx
git commit -m "feat: add LayerControls panel component"
```

---

### Task 10: App wiring + styles

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/app.css`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: `LayerControls`, `visibleSearchEntries`, `VisibilitySelection`, reducer actions, `LoadedVenue.buildings`, `ViewerFeature.buildingId`.

- [ ] **Step 1: Write the failing test**

Add to `src/app/App.test.tsx` a test (reusing the file's GDB/IMDF load harness) that, after a venue is ready: clicks the `Layers` button, unchecks `Units`, and asserts the map stub's last render collection has no `unit` features and that search for a unit label returns nothing. Follow the existing harness patterns (the file already renders `<App/>` and drives the menu). Assert via the `IndoorMap` stub already mocked in `App.test.tsx`.

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm test --run src/app/App.test.tsx`
Expected: FAIL — no `Layers` button.

- [ ] **Step 3: Derive visibility + lists in `App`**

In `src/app/App.tsx`:
- Import: `import { LayerControls, type LayerTypeRow, type LayerBuildingRow } from "../components/LayerControls";` and `import { visibleSearchEntries, type VisibilitySelection } from "../map/visibility";`
- Build the visibility object from state (memoized):

```ts
const visibility = useMemo<VisibilitySelection>(
  () =>
    venueState
      ? { hiddenTypes: venueState.hiddenTypes, hiddenBuildings: venueState.hiddenBuildings }
      : { hiddenTypes: new Set(), hiddenBuildings: new Set() },
  [venueState],
);
```

- Present-type rows + building rows with counts (memoized over `loadedVenue`):

```ts
const TYPE_ORDER: FeatureType[] = ["unit", "opening", "detail", "amenity", "fixture", "kiosk", "occupant"];
const layerTypeRows = useMemo<LayerTypeRow[]>(() => {
  if (!venueState) return [];
  const counts = new Map<FeatureType, number>();
  for (const f of venueState.loadedVenue.featuresById.values()) {
    counts.set(f.featureType, (counts.get(f.featureType) ?? 0) + 1);
  }
  return TYPE_ORDER.filter((t) => counts.has(t)).map((t) => ({ featureType: t, count: counts.get(t) ?? 0 }));
}, [venueState]);

const layerBuildingRows = useMemo<LayerBuildingRow[]>(() => {
  if (!venueState) return [];
  const counts = new Map<string, number>();
  for (const f of venueState.loadedVenue.featuresById.values()) {
    if (f.buildingId !== null) counts.set(f.buildingId, (counts.get(f.buildingId) ?? 0) + 1);
  }
  return venueState.loadedVenue.buildings.map((b) => ({
    id: b.id,
    label: localizedLabel(b.label, locale, b.id, venueState.loadedVenue.manifest.language),
    count: counts.get(b.id) ?? 0,
  }));
}, [venueState, locale]);
```

- Filter search entries before `searchVenue`. Locate where `searchResults` are computed (the `searchVenue(venueState.loadedVenue.searchEntries, …)` call) and wrap the entries:

```ts
const visibleEntries = useMemo(
  () => (venueState ? visibleSearchEntries(venueState.loadedVenue.searchEntries, visibility) : []),
  [venueState, visibility],
);
```

Pass `visibleEntries` to `searchVenue(...)` in place of `…searchEntries`. Add `visibility`/`visibleEntries` to that memo's deps.

- [ ] **Step 4: Render `LayerControls` and pass `visibility` to `IndoorMap`**

In the ready branch JSX (near `<LevelSwitcher … />`), add `visibility={visibility}` to the `<IndoorMap … />` props, and render the panel in the chrome:

```tsx
<LayerControls
  locale={locale}
  types={layerTypeRows}
  buildings={layerBuildingRows}
  hiddenTypes={venueState.hiddenTypes}
  hiddenBuildings={venueState.hiddenBuildings}
  onToggleType={(featureType) => dispatch({ type: "toggle_type", featureType })}
  onToggleBuilding={(buildingId) => dispatch({ type: "toggle_building", buildingId })}
  onSetTypesHidden={(hidden) => dispatch({ type: "set_types_hidden", hidden })}
  onSetBuildingsHidden={(hidden) => dispatch({ type: "set_buildings_hidden", hidden })}
  onOpenChange={() => {}}
/>
```

Place it inside the same container as `ViewerMenu`/`LevelSwitcher` (follow the existing chrome layout div). If `FeatureType` is not already imported in `App.tsx`, add it to the `../imdf/types` import.

- [ ] **Step 5: Add styles**

In `src/app/app.css`, add (adjust to match existing chrome positioning tokens):

```css
.layer-controls {
  position: relative;
}
.layer-controls__btn {
  /* match .viewer-menu__trigger sizing/colors */
}
.layer-controls__btn--active {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.layer-controls__panel {
  position: absolute;
  z-index: var(--z-floating-popover);
  background: var(--color-panel);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
  max-height: 60vh;
  overflow-y: auto;
  min-width: 220px;
}
.layer-controls__section + .layer-controls__section {
  margin-top: 12px;
  border-top: 1px solid var(--color-border);
  padding-top: 12px;
}
.layer-controls__header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
}
.layer-controls__bulk button {
  font-size: 12px;
}
.layer-controls__list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `corepack pnpm test --run src/app/App.test.tsx && corepack pnpm typecheck`
Expected: PASS / no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/App.tsx src/app/app.css src/app/App.test.tsx
git commit -m "feat: wire LayerControls, visibility rendering, and search filtering into App"
```

---

### Task 11: Full verification + browser smoke

**Files:**
- (No new source; may add `e2e/layers.spec.ts` if the repo has a Playwright venue fixture; otherwise do the manual browser smoke below.)

- [ ] **Step 1: Full unit suite**

Run: `corepack pnpm test --run`
Expected: all pass.

- [ ] **Step 2: Typecheck + build**

Run: `corepack pnpm typecheck && corepack pnpm build`
Expected: no type errors; build succeeds.

- [ ] **Step 3: Browser smoke (Tokyo GDB)**

Start dev server (`node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173`), open the app, import `Q:\BIM\past\受け渡しフォルダ\Daniel\Cesium\NW,POI_20260514東京\JRTokyoSta_3857.gdb.zip`, exclude the four known non-convertible layers, and load the venue. Then verify:
  - Units render with `color2` colors (e.g. greens/oranges), not the flat theme fill.
  - Open **Layers** → uncheck all types except Units, Details, Openings → only those draw; markers for hidden types disappear; search no longer returns hidden-type features.
  - With ≥2 buildings, uncheck all but one building → only that building's features show on the current floor.
  - Select a unit, then hide Units → selection clears (no selected-feature panel).
  - Re-check everything → full venue returns.

- [ ] **Step 4: Commit any fixes, then final commit**

```bash
git add -A
git commit -m "test: verify layer visibility and unit coloring end-to-end"
```

---

## Self-Review

**Spec coverage:**
- Visibility state + actions + reset + selection clear → Task 6. ✓
- Per-feature building resolution in normalizeVenue + `buildings` list → Task 1. ✓
- Visibility predicate (render/markers/search) → Tasks 4, 5, 7, 8, 10. ✓
- Search "hidden everywhere" → Task 10 (`visibleSearchEntries`). ✓
- `LayerControls` panel (present-only types, ≥2 buildings, counts, show/hide-all, localized) → Task 9. ✓
- Unit coloring by `color2` (exact palette + 道白 white + #808080 default, theme outline kept) → Tasks 2, 3. ✓
- Marker path risk → Task 7 explicit. ✓
- Browser smoke → Task 11. ✓

**Placeholder scan:** Task 5/8/9/10/11 reference existing test fixtures/harnesses by name (`venueFixture`, `markerVenueFixture`, `ready`, App/IndoorMap stubs) rather than reproducing them — the implementer adapts to the fixtures already in each test file. All new production code is shown in full.

**Type consistency:** `VisibilitySelection { hiddenTypes, hiddenBuildings }`, `buildingId: string | null`, `VenueBuilding { id, label }`, `LayerTypeRow`/`LayerBuildingRow`, and action names (`toggle_type`, `toggle_building`, `set_types_hidden`, `set_buildings_hidden`) are used identically across tasks. `buildRenderFeatures(venue, levelId, visibility?)` and `collectMarkerFeatures(…, visibility)` signatures match their consumers.
