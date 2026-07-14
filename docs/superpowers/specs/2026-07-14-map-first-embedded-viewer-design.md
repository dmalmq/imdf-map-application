# Map-first embedded viewer design

**Status:** Approved in conversation on 2026-07-14

## Purpose

Redesign the viewer around the map so it works well as both a standalone application and an embedded surface. Remove persistent top and side chrome, provide fast search and authoritative category filtering, and show customer-facing feature information in a point-anchored popover or mobile bottom sheet.

## Goals

- Maximize usable map canvas in standalone and embedded layouts.
- Keep search and filtering immediately available without a permanent sidebar.
- Move venue, floor, locale, theme, and file controls into a hamburger menu.
- Make search results available as the user types.
- Make category filters control both search results and visible map markers.
- Show selected-place information without moving or resizing the marker anchor.
- Support optional store descriptions, contact details, and images through versioned venue-packaged JSON.
- Remove nonfatal IMDF warnings from the visitor interface while retaining diagnostics internally.
- Meet WCAG 2.2 AA.

## Non-goals

- Building an IMDF validation interface.
- Adding a remote content API in the first implementation.
- Embedding binary images or large base64 payloads in the enrichment JSON.
- Hiding or restyling floor geometry as part of category filtering.
- Replacing MapLibre navigation controls.
- Showing promotional content or advertisements.

## Application shell

The map fills the viewer root element (`width: 100%; height: 100%`), not an unconditional browser viewport. An iframe viewport naturally bounds the root; a non-iframe host must give the viewer container a definite height. There is no persistent top bar and no persistent sidebar.

Two compact, opaque controls remain over the canvas:

1. A floating search/filter control in the upper-left safe area.
2. A hamburger button in the upper-right safe area.

Both controls use the active host/viewer theme tokens. They must remain high contrast and visually neutral rather than using decorative blur or glass effects. Their placement must account for browser safe areas and MapLibre controls.

### Hamburger menu

The hamburger opens a nonmodal anchored menu containing:

- Venue name and current floor
- Floor selection
- Language selection
- Theme selection
- Open/replace IMDF archive in standalone mode
- Optional host-provided venue attribution

Embedded mode keeps the venue, floor, language, and theme controls. It omits file-opening controls by default and includes them only when the host URL sets `allowOpen=1`; standalone mode always includes them. Closing the menu restores focus to the hamburger trigger. The menu must not clear search, filtering, or feature selection.

## Search and filter interaction

### Search combobox

The search input implements the ARIA combobox/listbox pattern. Results open in an anchored dropdown while the user types.

- Results update from the existing in-memory search index and retain its deterministic score/label/ID ordering.
- At most 50 results render; virtualization is unnecessary at that bound.
- Up/Down Arrow moves the active option.
- Enter selects the active result and switches floors when necessary.
- Escape closes the results without clearing the query.
- Each result presents the localized name plus a concise category and floor descriptor.
- The list has a bounded height and internal scrolling.
- An empty query with category `all` keeps the result list closed.
- An empty query with `gates`, `shops`, or `facilities` lists up to 50 matching places, preserving the existing category-browse behavior.
- A nonempty query with no matches produces a compact `No matching places` state inside the dropdown.

The dropdown must escape clipping and stacking contexts through a portal, fixed positioning, or the platform popover API. It must not be placed as an absolutely positioned child of an overflow-clipped container.

### Category filter

The categories remain:

- `all`
- `gates`
- `shops`
- `facilities`

A filter button exposes these choices without creating a permanent second toolbar. The active filter is visible beside the search field and has a clear action.

Filtering is authoritative:

- Search results use the active category.
- Visible DOM markers use the same category.
- Nonmatching markers disappear.
- Floor geometry remains visible and unchanged.
- Search text remains unchanged.
- If the selected feature no longer matches, selection is cleared and its popover closes immediately.

One shared `matchesSearchCategory` predicate defines category membership for both search entries and viewer features. Default marker eligibility remains a separate concern: category `all` uses the existing normal marker set, while a focused category may promote an otherwise-search-only feature such as a pedestrian opening into a marker.

Category membership is deterministic:

- **All:** every searchable feature; marker rendering still uses normal marker eligibility.
- **Shops:** `featureType === "occupant"`.
- **Facilities:** `featureType` is `amenity` or `kiosk`, or it is a `unit` accepted by the existing unit-marker eligibility rule (therefore excluding walkway, corridor, open-to-walkway, ramp, sidewalk, unenclosed-area, open-to-below, structure, and platform geometry-only categories).
- **Gates:** `featureType === "opening"` and the category starts with `pedestrian`.

In focused Gates mode, qualifying openings receive markers at the same `feature.center` display point used by selection. A localized feature label wins; an unnamed qualifying opening falls back to localized `Entrance` / `入口`. Gates remain absent from the default All marker set to avoid overview clutter.

For a non-`all` filter with no matching current-floor markers, the floating search/filter control shows `No [category] on this floor` directly below the active-filter row with a clear-filter action. This state is not another transient surface and does not replace a query-specific no-results message in an already-open result list.

## Selected-feature presentation

### Desktop and tablet

Selecting a marker keeps the marker at its original map coordinate and opens a separate MapLibre point-anchored popup. The positioned marker itself never expands into a rich card.

The popup:

- Anchors to the selected feature's `feature.center`, exactly matching the marker/display point; features without a center cannot open a map popup.
- Flips or offsets at viewport edges using MapLibre popup positioning.
- Repositions as the camera moves.
- Does not move the camera when the display point is already inside the padded map viewport. For an off-screen desktop selection, pan only enough to bring the point into the visible viewport; never unconditionally recenter every selection.
- Is replaced when another feature is selected.
- Closes on Escape, explicit close, or a map-background click.
- Does not trap focus.
- Leaves the selected marker visually distinct.

This separation prevents rich content from changing marker geometry or clipping inside `.indoor-marker-overlay`, which intentionally hides overflow.

### Narrow layouts

When the viewer root is narrower than 900px, determined from the root/container width rather than the parent browser window, the same content renders as a bottom sheet instead of a map popup.

- The sheet grows to content height up to `min(60% of the viewer height, 480px)`.
- Overflowing content scrolls inside the sheet.
- Dismissing it clears selection but preserves search text and active filter.
- While the sheet is open, apply map bottom padding equal to the rendered sheet height. If the selected display point falls behind that padded region, pan only enough to bring it into the remaining visible map area; do not recenter unconditionally.

### Content hierarchy

Render only visitor-relevant fields, in this order:

1. Optional lead image
2. Localized place/store name
3. Optional localized short description
4. Category and floor
5. Hours
6. Accessibility information
7. Phone and website actions
8. Close control

Do not show raw feature type, UUID, archive warnings, or other implementation metadata in the normal visitor interface. Missing values collapse without empty rows.

Resolve enrichment field by field. For each field, a property explicitly present on the selected-feature entry wins; a missing property falls back to the entry addressed by the selected feature's string `sourceProperties.anchor_id`; a missing anchor property falls back to normalized IMDF data. Merge `description` locale keys with selected-feature keys winning over anchor keys. Treat the lead image atomically: selected-feature `images`, when present, supplies both `src` and its complete localized `alt` map; otherwise use anchor `images`. An explicit empty selected-feature `images` array suppresses an anchor image. Never combine alt text from one image with another image's source.

Core fallbacks are concrete: `hours`, `phone`, and `website` come from same-named nonempty string values in `feature.sourceProperties`; accessibility comes from `feature.accessibility`; category comes from `feature.category`; floor comes from the selected feature's `levelId` resolved through `LoadedVenue.levels`. Core and enriched websites must pass the same HTTPS validation. Phone values are trimmed, limited to 64 characters, and accepted only when they contain digits plus optional `+`, spaces, parentheses, periods, or hyphens.

## Venue enrichment

### Archive contract

A ZIP may contain one recognized optional root entry:

`viewer-enrichment.json`

The first supported schema is version `1.0`:

```json
{
  "version": "1.0",
  "features": {
    "<stable-occupant-or-anchor-id>": {
      "description": {
        "en": "Store description",
        "ja": "店舗説明"
      },
      "hours": "Mo-Fr 10:00-20:00",
      "phone": "+81-00-0000-0000",
      "website": "https://example.com",
      "images": [
        {
          "src": "https://cdn.example.com/store.jpg",
          "alt": {
            "en": "Store interior",
            "ja": "店舗内観"
          }
        }
      ]
    }
  }
}
```

Keys are exact stable feature IDs. There is no name-based or fuzzy matching. Selection resolves enrichment deterministically: first by the selected feature ID, then by that feature's string `sourceProperties.anchor_id` when present. A selected-feature entry always wins over an anchor entry when both exist. This allows shared anchor-level merchandising while keeping occupant-specific content authoritative.

### Worker validation

`imdf.worker.ts` must recognize the exact filename before the generic unknown-root-entry branch. It reads the file through the existing limits: 64 archive entries, 100 MiB compressed input, 100 MiB per uncompressed entry, and 300 MiB total uncompressed data. Duplicate case-insensitive root entries named `viewer-enrichment.json` disable enrichment and record an internal diagnostic; neither first nor last silently wins.

Schema limits and recovery rules:

- The top level must be an object containing supported `version` and object `features` fields; unknown top-level members are ignored for forward-compatible metadata.
- Version `1.0` permits at most 5,000 feature entries.
- Feature keys are nonempty strings of at most 128 characters.
- Each localized map permits at most 16 locale keys; locale keys are at most 35 characters.
- `description` values are at most 2,000 characters; image `alt` values are at most 300 characters.
- `hours` is at most 512 characters, `phone` 64, and `website` or image `src` 2,048.
- Version 1 accepts zero or one image. The image must be an object with string `src` and a nonempty localized `alt` map; otherwise that image alone is dropped.
- Image `src` accepts viewer-origin-relative URLs beginning `/` or absolute HTTPS URLs. Relative URLs resolve against the viewer document origin, including inside an iframe—not the embedding parent page or ZIP URL.
- Website accepts absolute HTTPS URLs only.
- `javascript:`, `data:`, `blob:`, protocol-relative, and other URL forms are rejected.
- An invalid feature key or non-object feature value drops that feature entry. Invalid optional fields and images are dropped individually while other valid fields on the entry survive.
- An absent, malformed, duplicate, or unsupported optional enrichment file never prevents core venue loading; enrichment is omitted and an internal structured diagnostic is recorded.

The normalized venue contract adds an `enrichmentByFeatureId` map. UI components consume only the normalized representation and never parse archive JSON.

### Future API seam

The content source is replaceable behind one loader interface. A future CMS/API adapter must produce the same normalized enrichment map as the ZIP loader. Search, markers, and the selected-feature component do not depend on the source.

API concerns—loading, caching, retries, authentication, CORS, CSP, privacy, and stale data—remain outside the first JSON-backed implementation.

### Image behavior and network policy

Version 1 accepts one optional lead image, represented by the first and only valid `images` entry.

- Reserve a fixed 16:9 media region while the image loads to prevent layout shift.
- Omit the media region when no valid image exists.
- Remove a failed image instead of displaying a broken image icon or generic placeholder.
- A nonempty localized alt map is required; an image without valid alt text is dropped. Version 1 has no decorative-image form.

Remote media is opted into by placing an absolute HTTPS image URL in the venue enrichment file. No separate runtime flag exists in v1. This changes the zero-post-load-network assumption only for venues that declare remote images. Tests retain zero post-load requests for unenriched venues and explicitly allow only origins derived from validated image URLs in enriched fixtures. Deployments must update `img-src` CSP and privacy documentation before publishing such a venue.

## Warnings and errors

Remove `ViewerWarnings` from `ExplorerSidebar` and do not relocate it into the hamburger or popup.

Retain `LoadedVenue.warnings` for:

- Automated tests
- Developer diagnostics
- Optional logging
- A possible future debug mode

Fatal archive/load failures remain visible because the viewer cannot function. Optional enrichment failures remain nonfatal and are not shown to visitors.

Graceful degradation:

- No enrichment: show available core IMDF fields.
- Missing description: begin with structured details.
- Missing image: omit media.
- Failed image: remove media while retaining content.
- Invalid phone/website: omit the action.
- Invalid enrichment entry or version: retain the venue, omit invalid enrichment, record diagnostics.

## Open-surface behavior

Search results and filter choices are one search surface. The search surface and hamburger menu are mutually exclusive: opening either closes the other without clearing its state. The selected-feature popup or sheet may remain visible behind either control.

Track actual opening order for Escape handling rather than a fixed type priority. Escape closes the most recently opened visible surface, then restores focus to that surface's trigger when applicable. A second Escape may then close the selected-feature popup or sheet. Opening search or the hamburger does not clear selection. Selecting a nonmatching filter does clear selection by the authoritative-filter rule.

## Motion and accessibility

Target WCAG 2.2 AA.

- All controls are keyboard operable.
- Focus is visible and never communicated by color alone.
- Filter selection uses text/state semantics and `aria-pressed` or equivalent.
- The search control follows the ARIA combobox/listbox pattern.
- Selection changes are announced through a polite live region.
- Popup content has an accessible name based on the selected feature.
- The nonmodal popup does not trap focus.
- Hamburger closure restores focus to its trigger.
- Text and control contrast meet AA requirements.
- Touch targets remain usable in embedded and compact layouts.
- Standard transitions last 150–200ms and communicate state only.
- `prefers-reduced-motion: reduce` uses immediate state changes.

## Component and data boundaries

Recommended responsibilities:

- `ViewerShell`: full-viewport composition and transient-surface coordination.
- `FloatingSearch`: input, combobox results, and active-filter summary.
- `CategoryFilter`: category selection using the shared predicate.
- `ViewerMenu`: hamburger plus venue/floor/language/theme/file controls.
- `SelectedFeaturePopover`: customer-facing feature content, rendered through a desktop popup or compact sheet.
- Shared category matcher: defines category membership for search entries and viewer features.
- Enrichment parser/normalizer: validates archive JSON and produces normalized entries.
- Marker collection: accepts the active category and returns the correct current-floor marker set.

Avoid introducing a general overlay framework or speculative content-provider hierarchy. One enrichment loader contract and one transient-surface state are sufficient.

## Verification contracts

Automated coverage must pin:

- Shared category membership for search and markers
- Filtered marker visibility on the current floor
- Clearing a selected feature that does not match a new filter
- Focused Gates mode producing pedestrian-opening markers
- Search combobox typing, keyboard navigation, selection, and empty state
- Result selection switching floors where necessary
- Hamburger contents in standalone and embedded modes
- Hamburger focus restoration
- Desktop popup anchoring and camera repositioning
- Compact bottom-sheet rendering and dismissal
- Customer-facing content precedence and omission of raw diagnostics
- Valid, missing, partially invalid, malformed, and unsupported enrichment JSON
- Enrichment resolution by selected feature ID, fallback through `anchor_id`, and selected-feature precedence on collision
- Archive size limits applying to enrichment
- Unsafe URLs being rejected
- Failed images disappearing without breaking remaining content
- Warnings remaining available internally while absent from customer UI
- Existing marker click, keyboard, tooltip, `aria-label`, wheel zoom, locale, level switching, and map selection behavior
- Zero post-load requests for unenriched venues
- Explicitly bounded image-origin requests for enriched fixtures

End-to-end verification must cover at least one desktop embed and one compact embed, not only standalone mode.
