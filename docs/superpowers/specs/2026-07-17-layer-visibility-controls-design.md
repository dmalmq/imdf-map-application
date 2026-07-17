# Layer Visibility Controls & Unit Coloring — Design

Date: 2026-07-17
Status: Approved (pending written-spec review)

Two related viewer enhancements for GDB/IMDF venues:

1. **Visibility controls** — toggle which feature types and buildings are shown.
2. **Unit coloring by `color2`** — color unit fills from the source `color2`
   attribute, matching the Cesium project's palette.

They share one new piece of infrastructure: a per-feature **building id**
resolved at load.

---

## Feature 1 — Visibility controls

### Goal

Let a viewer declutter by toggling which **feature types** (Units, Openings,
Details, Amenities, Fixtures, Kiosks, Occupants) and which **buildings** are
shown. E.g. show only Units + Details + Openings, or isolate one building in a
multi-building venue (Tokyo Station).

### Non-goals

- No persistence across venue loads; no URL/deep-link/embed encoding
  (session-only; a new venue resets to all-visible).
- No sub-category control under a type (Units toggles rooms, walkways, transit,
  restrooms, platforms, structures, … as one group). Grouping is by IMDF
  feature type only.

### Behavior

- Everything starts visible. The control stores the **hidden** sets, so the
  empty set means "all visible".
- Hiding a type or building removes its features from **rendering, map
  click/hover, POI markers, and search results** ("hidden everywhere").
- If the selected feature becomes hidden, the selection clears.
- Loading a new venue resets both hidden sets to empty.

### State (`src/state/viewerReducer.ts`)

Extend `ReadyVenueState`:

```ts
hiddenTypes: ReadonlySet<FeatureType>;
hiddenBuildings: ReadonlySet<string>; // building feature ids
```

New actions (reducer stays pure; a fresh `Set` per change):

- `toggle_type { featureType }`
- `toggle_building { buildingId }`
- `set_types_hidden { hidden: FeatureType[] }` (show-all / hide-all)
- `set_buildings_hidden { hidden: string[] }` (show-all / hide-all)

`load_succeeded` initializes both to empty. When a toggle/bulk-set hides the
type or building of the current `selectedFeatureId`, the same transition sets
`selectedFeatureId` to null.

### Visibility predicate

```ts
isFeatureVisible(feature, hiddenTypes, hiddenBuildings): boolean
```

False when `hiddenTypes.has(feature.featureType)`, or when `feature.buildingId`
is non-null and in `hiddenBuildings`. The `venue` feature (outline) is always
visible. `buildingId` comes from the feature itself (see Shared infrastructure).

Integration points (all use the one predicate):

1. **Rendering + hit-testing** — `buildRenderFeatures(venue, levelId,
   visibility?)` gains an optional `{ hiddenTypes, hiddenBuildings }` argument
   and filters both context and level features. `IndoorMap` gains a
   `visibility` prop; the `source.setData(...)` effect re-runs on change. Hidden
   features leave the source, so `queryRenderedFeatures` (click/hover) and the
   selected-outline layer ignore them.
2. **POI markers** — `useFeatureMarkers` receives the visibility inputs and
   skips hidden features (separate render path from the GeoJSON source).
3. **Search** — `App` filters `venue.searchEntries` through the predicate
   (memoized) before `searchVenue`. `SearchEntry` gains `buildingId` (set in
   `buildSearchEntries` from the feature) so search can filter by building.
4. **Selection clear** — handled in the reducer (above).

### UI — `LayerControls` panel

New `src/components/LayerControls.tsx` plus a toggle button in the map chrome
near the menu/floor pills (own control; matches `LevelSwitcher`/`ViewerMenu`
conventions: localized `ui` table, `role`/`aria-*`, keyboard/Escape, outside-
click close). The button shows an active indicator when anything is hidden.

- **Feature types** section: one labeled checkbox per type **present in the
  venue** (from `featuresById`) among Units, Openings, Details, Amenities,
  Fixtures, Kiosks, Occupants. Each row shows a count, e.g. `Units (142)` /
  `ユニット (142)`. Show-all / hide-all affordance.
- **Buildings** section: shown only when the venue has **≥2** buildings. One
  labeled checkbox per building (localized label + feature count). Show-all /
  hide-all.

Checked = visible; toggling dispatches. Presentational/pure: `App` computes the
present-type list and building list (memoized, with counts) and wires callbacks
to `dispatch`.

---

## Feature 2 — Unit coloring by `color2`

### Goal

Color unit fills from the source `color2` attribute using the Cesium project's
exact palette, so GDB spaces render with their authored colors.

### Palette (`src/map/color2.ts`)

Exact hex from `C:\Repositories\cesium` (`src/main.js`, `src/viewer.js`
`COLOR2_LOOKUP`), plus `道白` added per review:

```ts
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
export const COLOR2_DEFAULT = "#808080";
```

`color2Fill(value): string | null` returns the mapped hex, `COLOR2_DEFAULT` for
a present-but-unmapped value, or `null` when `color2` is absent/blank.

### Rendering

- `renderFeatureFromViewer` adds `__unit_color` to a feature's render
  properties **only** when `feature.featureType === "unit"` and
  `color2Fill(sourceProperties.color2)` is non-null. (Runs inside
  `normalizeVenue` where unit `sourceProperties` still hold `color2`.)
- The unit fill layers (`buildFeatureLayers`: room, walkway, transit, restroom,
  nonpublic, parking, platform, structure, unenclosed) set
  `fill-color` = `["coalesce", ["get", "__unit_color"], <existing theme color>]`.
  So a unit with `color2` wins regardless of its category bucket; IMDF units
  (no `color2`) keep the theme color unchanged.
- **Outline unchanged** — units keep their per-theme outline; only the fill is
  recolored.
- `applyThemePaintProperties` keeps setting the theme color as the coalesce
  fallback on theme switch (per-feature `__unit_color` is unaffected).

### Scope

Always on; not a toggle and not in the visibility panel. Only affects units
that carry a `color2` value, so non-GDB venues are visually unchanged.

---

## Shared infrastructure — per-feature building id

Both features need each feature's building. Resolve it in
`src/imdf/normalizeVenue.ts` (authoritative: `building_ids` are present in level
properties for both IMDF and GDB at normalize time, before the GDB
source-property restore):

- Add `buildingId: string | null` to `ViewerFeature`.
- Resolution: a `level` feature → its own `building_ids[0]`; a `building`
  feature → its own id; a `footprint` → its `building_ids[0]`; any other
  feature → its resolved **source** level (the `level_id` already computed
  during normalize) → that level feature's `building_ids[0]`. Unresolved →
  `null`.
- `null`-building features are always visible under building filters (only type
  toggles affect them).
- Add `buildings: { id: string; label: Record<string, string> }[]` to
  `LoadedVenue`, from `building` features with localized labels, sorted by
  label. Drives the Buildings section (shown only when length ≥ 2).

`SearchEntry` also gains `buildingId` (copied from the feature in
`buildSearchEntries`) so search can honor building filters.

---

## Testing

- **reducer** — type/building toggles add/remove; bulk set replaces;
  `load_succeeded` resets; hiding the selected feature's type/building clears
  `selectedFeatureId`; unrelated toggles keep it.
- **normalizeVenue building resolution** — level/unit/amenity/building/footprint
  resolve to the correct building via `building_ids` and the source-level chain
  (IMDF and GDB fixtures); unresolved → null; `buildings` sorted/deduped;
  <2 buildings handled.
- **buildRenderFeatures** — with a visibility arg, excludes hidden-type and
  hidden-building features, keeps the venue outline; no arg = unchanged
  (back-compat).
- **search** — the App-level entry filter drops hidden features.
- **color2** — `color2Fill` maps each known value, `道白`→white, unmapped→
  `#808080`, absent→null; `renderFeatureFromViewer` sets `__unit_color` only for
  units with `color2` and never for other types; the coalesce leaves IMDF units
  on the theme color.
- **LayerControls** — renders only present types and (≥2) buildings; counts
  correct; checkbox reflects hidden state; toggles + show-all/hide-all fire
  callbacks; localized.
- **browser smoke (Tokyo GDB)** — units render with `color2` colors; hide all
  but Units/Details/Openings; isolate one building; confirm map, markers, and
  search honor it; selecting then hiding clears the selection.

## Risks / edge cases

- **Marker path**: `useFeatureMarkers` is separate from the GeoJSON source; must
  receive visibility or markers leak. Primary integration risk.
- **`color2` availability**: assumed present on GDB `_Space`/unit
  `sourceProperties` (ogr2ogr keeps all fields; `buildGdbVenue` restores
  originals). Confirmed by the source QGIS styling; the browser smoke verifies
  end-to-end.
- **Ordinal aggregation**: a `ViewerLevel` (ordinal group) can span buildings;
  filtering is per feature via its source level, so mixed-building floors filter
  correctly.
- **Unresolved buildings**: features with no building stay visible under
  building filters; documented rather than force a spurious assignment.
- **Empty result**: hiding everything yields an empty (reversible) map.
