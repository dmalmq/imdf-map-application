# Kiriko — UI/UX Redesign Design

Date: 2026-07-17
Status: Approved (brainstorming complete)

## Purpose

Give the GIS dataset sharing platform (see
`2026-07-16-gis-dataset-sharing-design.md`) a designed product identity and a
north-star UI, authored in Figma, that the existing React app is then restyled
to match. The functional architecture is unchanged; this spec covers visual
identity, layout, and UX flows, plus one functional addition (comment status
lifecycle).

## Decisions record

| Question | Decision |
|---|---|
| Design goal | North-star in Figma, then restyle the real app to match. |
| Visual style | Forma-style light: airy, map-dominant, floating panels. |
| Scope | All surfaces: gallery, viewer, comments, publish/GDB import, sign-in, embed. |
| Devices | Desktop-first; additionally mobile/compact viewer and embed. Publish/gallery-admin flows desktop-only. |
| Brand | Free rein; new product identity. Name: **Kiriko**. |
| UX latitude | Rethink layouts and flows freely; implementation adapts. |
| Figma approach | Approach A: slim token/component foundation → viewer hero screen for direction sign-off → systematize and roll out to all surfaces. |
| Comment lifecycle | Comments carry status open → in review → closed; any signed-in user can change status. |
| Own-issues filter | "Mine" filter chip in the comments panel, composable with status filters. Client-side only. |

## 1. Identity and visual foundation

**Name.** *Kiriko* (Japanese cut glass — precise facets echoing floor plans).
Used in the header wordmark, sign-in modal, embed badge, and the Figma file
name. The repo/package name is unchanged.

**Color tokens.**

| Token group | Values |
|---|---|
| Surfaces | App background `#FAFAF9` (warm gray); floating panels pure white; hairline borders `#E7E5E4`; map canvas stays light. |
| Text | Primary `#1C1917`; secondary mid-warm-gray. |
| Accent | Deep indigo, `#4F46E5` family. Chosen to stay legible on top of map data (unit fills are blues/greens/beiges) without being confusable with it. Used for selection, primary buttons, active floor, open-status pins, focus rings. |
| Semantic | Amber = warnings / in-review; red = destructive; green = publish success; gray = closed. |

**Typography.** Inter (Latin) + Noto Sans JP (Japanese) as the UI pair.
IBM Plex Mono for feature IDs, slugs, filenames, and raw GDB attribute
values — the verbatim-fields table reads as authoritative data.

**Shape and elevation.** Floating panels detached from screen edges (12px
inset), 12px corner radius, soft wide shadows (`0 4px 24px rgba(0,0,0,0.08)`),
no hard borders on floating elements. The map is always the full-bleed
background layer; every UI element floats above it.

**Iconography.** Lucide (1.5px stroke). Existing PNG POI markers are kept;
redrawing them as SVG is deferred.

**Token plumbing.** All of the above are Figma variables (color / type /
space / radius / shadow) mapping 1:1 to CSS custom properties at
implementation time.

## 2. Viewer (hero screen)

Full-bleed map; four floating zones.

- **Top-left context bar.** One pill-shaped bar: back-arrow to gallery →
  Kiriko mark → dataset name → floor indicator. Replaces the current
  full-width header. Clicking the dataset name opens a dropdown with dataset
  metadata (source file, feature/level counts, updated date). When a local
  venue is loaded and the account is admin with the server up, an indigo
  **Publish** button joins the bar (see §5).
- **Left icon rail + panel.** Slim vertical rail: Search, Layers, Comments,
  Warnings. Clicking an icon opens a single 320px floating panel beside the
  rail; clicking again collapses it. Search keeps its current internals
  (query, category chips, results), restyled. Layers hosts the visibility
  toggles. Warnings moves out of the details card into its own rail item with
  a count badge. The Comments rail icon badges the **open**-issue count.
- **Right inspector.** Selecting a feature opens a floating card top-right:
  name, category, level, then the details content — GDB datasets show the
  verbatim attribute table in Plex Mono with the provenance line; IMDF
  datasets show the enriched summary (hours, phone, website). Footer actions:
  "Comment on this feature" and copy deep link. Left = browsing, right =
  selection.
- **Edge controls.** Floor switcher is a vertical stack, right-center
  (scales past 3 floors). Zoom + compass bottom-right; attribution
  bottom-left; account chip + language toggle cluster top-right above the
  inspector position.

Selected features get an indigo outline + soft glow. Comment pins render per
§4.

## 3. Gallery (landing)

Centered content column (max ~1200px) on the warm-gray background.

- **Header.** Kiriko wordmark left; account chip + language toggle right.
  Title row: "Datasets" heading, search-filter input, and (admin only) an
  **Open local data** button.
- **Cards.** White floating cards, 3-up at 1440px. Visual header: a
  deterministic abstract floor-plan pattern generated from the dataset id
  (light indigo/gray blocks) — stable per dataset, aids recognition; real map
  thumbnails remain deferred and drop into the same slot later. Body: name
  (two-line clamp, JA-friendly), kind badge (GDB snapshot / IMDF), meta row
  (floors · features · updated date), source filename in small mono. Hover:
  card lifts, "Open →" affordance; admins get an overflow ⋯ with Copy embed
  link and Delete (destructive-red, confirm dialog).
- **Publisher entry.** "Open local data" opens a modal with the IMDF ZIP
  dropzone and GDB folder/archive picker as two side-by-side drop targets.
  When the server probe fails (local dev / static preview), this modal's
  content becomes the landing page, preserving the existing fallback.
- **Empty state.** "No datasets published yet" + the open-local-data button
  for admins.

## 4. Comments with status lifecycle

Comments live in the left rail panel; pins and panel act as one.

**Status.** Every comment has `status: "open" | "in-review" | "closed"`
(default `open`; any transition allowed, so closed issues can reopen). Any
signed-in user can change status.

- Card chip: Open (indigo dot) / In review (amber dot) / Closed (gray
  check); clicking opens a status dropdown.
- Map pins are numbered indigo teardrops (numbers match list order); pin
  color follows status (indigo / amber / gray). Closed pins are hidden on the
  map by default.
- Filter row at the top of the panel: segmented **All · Open · In review ·
  Closed** with counts, plus a **Mine** toggle chip (signed-in only, shows own
  count) that composes with the status filter, e.g. Mine + Open. Filters
  drive both list and pins. Mine is client-side (filter on `author`).

**List.** Compact cards: initials avatar (deterministic pastel from author
name), author + relative time, text, up to two context chips — level chip
("1F") when pinned, feature chip (name) when linked. Newest first. Clicking a
card switches floor if needed, flies to the pin, and selects the linked
feature; the card gets an indigo active edge and its pin enlarges. Pins on
other floors don't render; the level chip signals that clicking switches
floors.

**Composer.** Docked at the panel bottom: text field + two attachment-style
toggle chips — **Pin** (crosshair placement mode: ghost pin follows the
mouse, click drops, Esc cancels, hint toast explains) and
**link-to-selection** (pre-filled chip when a feature is selected, one click
removes). Indigo Post button.

**States.** Signed-out: list readable, composer replaced by a "Sign in to
comment" card. Delete via overflow ⋯ (own comments; admins all) with confirm.
Load/post failures: inline amber notice with Retry inside the panel, never
blocking the map. Empty state: "No comments yet — drop the first pin."

**Server changes (extends the sharing spec).**

- `Comment.status: "open" | "in-review" | "closed"`; server defaults
  missing/legacy values to `"open"` on read.
- `PATCH /api/datasets/:id/comments/:cid` `<- { status }` — any signed-in
  account (`user` or `admin`); `401` signed out; validation `400` on unknown
  status values.

## 5. Publish flow (admin, desktop-only)

- **Entry points.** Gallery: Open local data modal. Viewer: the Publish
  button in the context bar (visible only when a local venue is loaded, the
  server probe succeeded, and the account is admin — same gating as today).
- **GDB import review.** Same dialog structure, restyled: layer list with
  include/exclude checkboxes, per-layer feature counts, inline amber
  warnings, summary footer ("14 layers, 3,204 features, 4 levels"), mono
  layer names. Confirm loads the venue into the live viewer as today.
- **Publish wizard.** One modal, three progress-dotted steps:
  1. **Details** — name pre-filled from the venue (JA-friendly); URL slug
     auto-generated below in mono with an edit affordance; if the slug
     exists, an amber inline warning "This will overwrite *〈name〉*, updated
     〈date〉" — visible but non-blocking.
  2. **Upload** — progress bar with size/percent; errors show the server's
     typed message inline with Retry; the venue stays loaded.
  3. **Done** — success check; copyable **View link** and **Embed snippet**
     rows; "Open in gallery."
- **Sign-in.** Minimal centered modal: Kiriko mark, username/password, one
  indigo button, inline red error message. The account chip (top-right on
  all surfaces) shows initials when signed in; menu: name, role badge, sign
  out.

## 6. Embed mode and mobile viewer

**Embed** (`&embed=1`). Full-bleed map; floor stack right-center; zoom
bottom-right; attribution bottom-left; one floating **"Kiriko ↗"** badge
bottom-right opening the full viewer in a new tab. Feature selection shows a
slim read-only info card. No search rail, comments, or account.

**Mobile / compact viewer.**

- The icon rail becomes a bottom bar: Search, Layers, Comments (open-issue
  badge), Warnings.
- Every panel opens as a bottom sheet (half-height, drag to full), unifying
  on the existing `SelectedFeatureSheet` pattern. Feature selection uses the
  same inspector content; the attribute table scrolls within the sheet.
- Floor stack stays right-edge with larger touch targets; the context bar
  collapses to back-arrow + dataset name.
- Comment pin placement is long-press.
- Gallery stacks cards 1-up. Publish flows are desktop-only.

## 7. Figma deliverable (Approach A)

One Figma file, **Kiriko**, built in this order:

1. **Foundation page.** Variables (color, type, space, radius, shadow) and
   ~8 core components: floating panel, button (primary/ghost/destructive),
   input, chip (filter/status/context), list row, badge, dialog/modal frame,
   floor pill/stack. Light mode only; token structure leaves room for a dark
   mode later.
2. **Hero screen.** Viewer at 1440px in full fidelity (rail + search panel
   open, feature selected, comments with mixed statuses, pins on map) —
   direction sign-off happens here before rollout.
3. **Rollout pages.** Gallery (grid, hover, empty, admin states), comments
   panel states, publish flow (import review + 3 wizard steps), sign-in,
   embed frame, mobile viewer (bottom bar, sheets, mobile gallery).

Screens use a real-looking indoor floor-plan mock (station-like venue) rather
than gray boxes, so map/UI contrast decisions are honest.

## 8. Implementation notes (for the later restyle plan)

- Figma variables map 1:1 to CSS custom properties; existing theme-switcher
  machinery can host the token set.
- Component inventory maps onto existing React components (FloatingSearch,
  LayerControls, CommentsPanel, SelectedFeatureSheet, PublishDialog,
  GdbImportDialog, SignInDialog, DatasetGallery, LevelSwitcher, ViewerMenu,
  AccountStatus); the redesign recomposes their layout but reuses their
  logic.
- The comment-status feature is the only server/API change in this spec.
- JA/EN both ship today; all text containers must tolerate Japanese string
  lengths (name clamps, chips, wizard labels).

## 9. Out of scope / deferred

- Dark mode (token structure allows it later).
- Real map thumbnails in gallery cards (`preserveDrawingBuffer` trade-off);
  the abstract-pattern slot is designed to receive them.
- Redrawing PNG POI markers as SVG.
- Assignees, mentions, threads on comments (status lifecycle only).
- Everything already deferred in the sharing spec (routing, versions, SSO,
  shapefiles, live updates).
