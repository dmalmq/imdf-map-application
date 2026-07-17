# Kiriko Figma North-Star Design — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Kiriko UI/UX north-star design in one Figma file — foundation variables, core components, viewer hero screen (user sign-off gate), then all remaining surfaces — per `docs/superpowers/specs/2026-07-17-kiriko-ui-redesign-design.md`.

**Architecture:** Approach A from the spec: token foundation first, ~8 core components built on those tokens, one full-fidelity viewer hero screen validated with the user before rolling the direction out to gallery, comments, publish, sign-in, embed, and mobile. Everything is authored via the Figma MCP (`use_figma`, `create_new_file`, `get_screenshot`).

**Tech Stack:** Figma MCP server (official), Figma variables + components, Inter / Noto Sans JP / IBM Plex Mono (all available as Google Fonts inside Figma).

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-07-17-kiriko-ui-redesign-design.md`. On any conflict, the spec wins.
- **MANDATORY:** invoke the `figma:figma-use` skill before any `use_figma` call; invoke `figma:figma-create-new-file` before `create_new_file`; load `figma:figma-generate-library` alongside for variable/component tasks. Never call these tools cold.
- All work happens in ONE Figma design file named **Kiriko**. Task 1 creates it; every later task reuses its file key from Execution Notes below.
- Every color, text style, spacing, radius, and shadow in components and screens binds to the variables/styles from Task 2 — no hardcoded hex or px where a token exists.
- Desktop frames: 1440×900. Mobile frames: 390×844.
- Light mode only. No dark-mode variants anywhere in this plan.
- Text containers must tolerate Japanese strings: never fixed-width single-line name labels; use auto-layout with fill + truncation or 2-line clamps as specified per screen.
- Sample data everywhere uses the two personas of the sharing spec: datasets "新宿駅構内図" (GDB snapshot) and "Tokyo Station IMDF" (IMDF); users `daniel` (admin) and `yuki` (user).
- Every task ends with a `get_screenshot` verification step and its expected result. There are no git commits in Figma tasks; after each task, check the task's boxes in this plan file and append produced node IDs to Execution Notes.
- The task executor MUST append the file key (Task 1) and the node IDs of pages/components they create to the Execution Notes section, since later tasks consume them.

## Execution Notes (append as you go)

- Figma file key: _(set by Task 1)_
- Page node IDs: _(set by Task 1)_
- Component node IDs: _(set by Tasks 3–5)_

---

### Task 1: Create the Kiriko file and page structure

**Files:**
- Create: Figma design file **Kiriko** (via `create_new_file`, editor type `design`)

**Interfaces:**
- Consumes: nothing
- Produces: file key + page node IDs, recorded in Execution Notes. All later tasks operate in this file.

- [ ] **Step 1: Invoke `figma:figma-create-new-file`, then create the file**

Create a design file named **Kiriko**.

- [ ] **Step 2: Invoke `figma:figma-use`, then create the page structure**

Rename the default page and add pages so the file contains, in order:

1. `📐 Foundation`
2. `🧩 Components`
3. `🖥 Viewer`
4. `🗂 Gallery`
5. `💬 Comments`
6. `🚀 Publish`
7. `🔐 Sign-in & Embed`
8. `📱 Mobile`

- [ ] **Step 3: Verify**

Run `get_metadata` on the document root.
Expected: exactly the 8 pages above, in order, no extra pages.

- [ ] **Step 4: Record**

Append file key and the 8 page node IDs to Execution Notes. Check this task's boxes.

---

### Task 2: Foundation variables and styles

**Files:**
- Modify: Kiriko file, page `📐 Foundation`

**Interfaces:**
- Consumes: file key (Execution Notes)
- Produces: variable collection `Kiriko Tokens` with the exact variable names below; text styles `Display/24`, `Title/18`, `Body/14`, `Label/13`, `Caption/12`, `Mono/12`; effect styles `Elevation/Floating`, `Elevation/Raised`. Later tasks bind by these names.

- [ ] **Step 1: Invoke `figma:figma-use` + `figma:figma-generate-library`, then create the variable collection `Kiriko Tokens`** (single mode `Light`) with exactly:

Colors:

| Variable | Value |
|---|---|
| `color/bg/app` | `#FAFAF9` |
| `color/bg/panel` | `#FFFFFF` |
| `color/border/hairline` | `#E7E5E4` |
| `color/text/primary` | `#1C1917` |
| `color/text/secondary` | `#78716C` |
| `color/accent/primary` | `#4F46E5` |
| `color/accent/hover` | `#4338CA` |
| `color/accent/subtle` | `#EEF2FF` |
| `color/status/open` | `#4F46E5` |
| `color/status/in-review` | `#D97706` |
| `color/status/closed` | `#78716C` |
| `color/semantic/warning` | `#D97706` |
| `color/semantic/warning-bg` | `#FEF3C7` |
| `color/semantic/danger` | `#DC2626` |
| `color/semantic/success` | `#16A34A` |

Numbers:

| Variable | Value |
|---|---|
| `space/1` … `space/8` | 4, 8, 12, 16, 20, 24, 32, 48 |
| `radius/sm` | 6 |
| `radius/md` | 8 |
| `radius/lg` | 12 |
| `radius/pill` | 999 |
| `size/panel-width` | 320 |
| `size/edge-inset` | 12 |

- [ ] **Step 2: Create text styles**

| Style | Font | Size/Line | Weight |
|---|---|---|---|
| `Display/24` | Inter | 24/32 | Semibold |
| `Title/18` | Inter | 18/26 | Semibold |
| `Body/14` | Inter | 14/20 | Regular |
| `Label/13` | Inter | 13/18 | Medium |
| `Caption/12` | Inter | 12/16 | Regular |
| `Mono/12` | IBM Plex Mono | 12/18 | Regular |

(Japanese text falls back to Noto Sans JP; where a JA sample string is the primary content of a node, set that node's font to Noto Sans JP at the same size/weight.)

- [ ] **Step 3: Create effect styles**

- `Elevation/Floating`: drop shadow `0 4 24 rgba(0,0,0,0.08)`
- `Elevation/Raised`: drop shadow `0 8 32 rgba(0,0,0,0.12)`

- [ ] **Step 4: Build a token sheet on `📐 Foundation`**

One frame `Token Sheet` (auto-layout, vertical) that swatches every color variable with its name, renders each text style with sample string "Kiriko 切子 0123", and shows the two shadows on white cards. This is the visual regression reference for the whole file.

- [ ] **Step 5: Verify**

`get_screenshot` of `Token Sheet`.
Expected: all 15 color swatches labeled, 6 text styles rendered (JA glyphs visible, not tofu), 2 shadow cards visibly distinct.

- [ ] **Step 6: Record**

Append the collection ID to Execution Notes; check boxes.

---

### Task 3: Core components — primitives (Button, Input, Chip, Badge, Avatar)

**Files:**
- Modify: Kiriko file, page `🧩 Components`

**Interfaces:**
- Consumes: `Kiriko Tokens` variables, text styles, effect styles (Task 2)
- Produces: component sets `Button`, `Input`, `Chip`, `Badge`, `Avatar` with the exact variant properties listed below. Screen tasks place instances by these names.

- [ ] **Step 1: Invoke `figma:figma-use`, then build `Button`** (component set)

Variants: `variant = primary | ghost | destructive`, `size = md | sm`. Auto-layout horizontal, padding md `16×8` / sm `12×6` (use `space/*`), radius `radius/md`, text `Label/13`.
- primary: fill `color/accent/primary`, text white; hover-noted description "hover: accent/hover".
- ghost: no fill, text `color/text/primary`, 1px stroke `color/border/hairline`.
- destructive: fill `color/semantic/danger`, text white.

- [ ] **Step 2: Build `Input`**

Variants: `state = default | focus`. 320 wide fill-container, height 36, radius `radius/md`, fill `color/bg/panel`, stroke `color/border/hairline` (focus: 2px `color/accent/primary`), placeholder text `Body/14` in `color/text/secondary`, left search icon slot 16×16.

- [ ] **Step 3: Build `Chip`**

Variants: `kind = filter | status | context`, `selected = true | false` (status chips ignore `selected`; set `status = open | in-review | closed` as a third property used only when `kind=status`).
- Base: auto-layout pill, radius `radius/pill`, padding 10×4, text `Label/13`.
- filter unselected: stroke hairline, text secondary; selected: fill `color/accent/subtle`, text + stroke `color/accent/primary`.
- status: leading 6×6 dot filled with matching `color/status/*` (closed uses a ✓ glyph instead of dot), text primary, stroke hairline.
- context (level/feature chips on comment cards): fill `#F5F5F4`, no stroke, leading 12×12 icon slot.

- [ ] **Step 4: Build `Badge`**

Count badge: 16×16 min circle, fill `color/accent/primary`, white `Caption/12` text, auto-width for 2 digits. Variant `tone = accent | warning` (warning fill `color/semantic/warning`).

- [ ] **Step 5: Build `Avatar`**

24×24 circle, fill `#DDD6FE` (sample pastel), initials in `Label/13` `color/text/primary`. Variant `size = 24 | 32`.

- [ ] **Step 6: Verify**

`get_screenshot` of the components page region.
Expected: 5 component sets, all variants laid out, colors visibly bound to tokens (spot-check one: Button/primary fill inspects as `color/accent/primary`).

- [ ] **Step 7: Record node IDs; check boxes.**

---

### Task 4: Core components — containers and map controls (FloatingPanel, Modal, ListRow, FloorStack, ZoomCluster, ContextBar)

**Files:**
- Modify: Kiriko file, page `🧩 Components`

**Interfaces:**
- Consumes: Tasks 2–3 outputs
- Produces: components `FloatingPanel`, `Modal`, `ListRow`, `FloorStack`, `ZoomCluster`, `ContextBar`, `IconRail`. The Viewer task composes these directly.

- [ ] **Step 1: Invoke `figma:figma-use`, then build `FloatingPanel`**

Frame 320 wide (`size/panel-width`) × hug, fill `color/bg/panel`, radius `radius/lg`, effect `Elevation/Floating`, padding `space/4` (16), auto-layout vertical gap 12. Header row slot: `Title/18` text + optional trailing icon.

- [ ] **Step 2: Build `Modal`**

560 wide × hug, same surface recipe as FloatingPanel but effect `Elevation/Raised`, padding 24, header (`Title/18` + close ✕), body slot, footer row (right-aligned Button instances). Variant `width = 560 | 720` (720 for the GDB import review).

- [ ] **Step 3: Build `ListRow`**

Fill-width auto-layout horizontal, padding 12×10, radius `radius/md`, gap 12: leading 16 icon slot, title `Body/14` primary + subtitle `Caption/12` secondary stacked, trailing slot. Variants `state = default | hover | selected` (hover fill `#F5F5F4`; selected fill `color/accent/subtle` + 2px left inner accent edge).

- [ ] **Step 4: Build `FloorStack`**

Vertical auto-layout pill container (fill panel, radius `radius/pill`, `Elevation/Floating`, padding 4, gap 2) of floor buttons 40×36 radius `radius/md`: text `Label/13`. Variant per-button `active = true | false` (active: fill `color/accent/primary`, white text). Ship the set with sample floors `2F / 1F / B1`.

- [ ] **Step 5: Build `ZoomCluster`**

Vertical pill container like FloorStack containing `+`, `−`, compass icons, 36×36 each, ghost style.

- [ ] **Step 6: Build `ContextBar`**

Pill bar (radius `radius/pill`, fill panel, `Elevation/Floating`, padding 8×8 with 12 gap, height 48): back-arrow icon 20, Kiriko mark (20×20 indigo faceted-diamond vector — draw a simple 4-facet lozenge), dataset name `Label/13` (max 280, truncate), separator dot, floor indicator `Label/13` secondary. Variant `publish = visible | hidden` — visible appends a `Button/primary/sm` labeled "Publish".

- [ ] **Step 7: Build `IconRail`**

Vertical floating pill (like ZoomCluster) with 4 icon buttons 40×40: search, layers, message-circle, alert-triangle (Lucide style, 1.5px stroke, 20×20). Variant per-button `active` (fill `color/accent/subtle`, icon `color/accent/primary`); message-circle and alert-triangle each carry an optional `Badge` (accent "3", warning "5") anchored top-right.

- [ ] **Step 8: Verify**

`get_screenshot` of the page.
Expected: 7 new components; ContextBar reads as one pill with logo + name + floor; IconRail badges overlap icon corners correctly.

- [ ] **Step 9: Record node IDs; check boxes.**

---

### Task 5: Map mock

**Files:**
- Modify: Kiriko file, page `🧩 Components`

**Interfaces:**
- Consumes: Task 2 tokens
- Produces: component `MapMock/1F` (1440×900) — a station-like light floor plan used as the background of every viewer/embed/mobile screen.

- [ ] **Step 1: Invoke `figma:figma-use`, then build the base**

Frame 1440×900, fill `#EDEDEB` (map ground). Inside, a venue footprint: large rounded polygon (~900×620, centered right-of-center) fill `#E3E7EE`, 1px stroke `#C8CEDA`.

- [ ] **Step 2: Add units**

12–16 rectangles/L-shapes inside the footprint as rooms: fills alternating `#F4F6F9`, `#E9EDF4`, `#DFE6F0`, a couple of beige `#F0EBE0` and green `#E4EEE4` units, 1px strokes `#C8CEDA`. One long horizontal corridor `#F8F9FB`. Two stair/elevator cores in `#D5DAE3`.

- [ ] **Step 3: Add labels and POI dots**

6 unit labels in `Caption/12` `#6B7280` ("Station Shop", "改札口", "Info", "Restroom", "Café", "Lockers") and 8 small 8×8 circle POI markers `#8B93A5`.

- [ ] **Step 4: Make it a component; verify**

`get_screenshot` of `MapMock/1F`.
Expected: reads instantly as an indoor floor plan at 25% zoom; light enough that indigo UI pops; JA label renders.

- [ ] **Step 5: Record node ID; check boxes.**

---

### Task 6: Viewer hero screen — USER SIGN-OFF GATE

**Files:**
- Modify: Kiriko file, page `🖥 Viewer`

**Interfaces:**
- Consumes: everything from Tasks 2–5
- Produces: frame `Viewer / Hero 1440` — the approved visual direction all remaining tasks must match. **Execution pauses here for user approval.**

- [ ] **Step 1: Invoke `figma:figma-use`, then compose the frame**

Frame `Viewer / Hero 1440` (1440×900): `MapMock/1F` instance as background layer, then per spec §2, all floating elements inset 12 (`size/edge-inset`) from edges:

- Top-left: `ContextBar` (publish=hidden), dataset name "新宿駅構内図", floor "1F".
- Left, below ContextBar: `IconRail` — search active, comments badge "3", warnings badge "5". Beside it a `FloatingPanel` "Search": `Input` (placeholder "Search features…"), filter `Chip` row (All selected · Gates · Shops · Facilities), "RESULTS" `Caption/12` secondary header, 3 `ListRow`s ("Station Shop / occupant · 1F" selected, "改札口 / gate · 1F", "Info Kiosk / amenity · 1F").
- Right-top: account cluster (Avatar "DM" + "EN" ghost chip), and below it the inspector `FloatingPanel` (340 wide override): title "Station Shop", `Caption/12` secondary "occupant · shopping · 1F", divider, attribute table — 8 rows of two columns: field name `Mono/12` secondary (`NAME`, `NAME_KANA`, `FLOOR`, `SHOP_CODE`, `AREA_M2`, `OPEN_HOURS`, `TEL`, `NOTE`), value `Mono/12` primary with one explicit `null`; provenance line `Caption/12` secondary "JRShinjukuSta.gdb › Shops_1F"; footer: `Button/ghost/sm` "Copy link" + `Button/primary/sm` "Comment on this feature".
- Right-center: `FloorStack` (2F/1F/B1, 1F active).
- Bottom-right: `ZoomCluster`. Bottom-left: `Caption/12` attribution "IMDF venue data © Company".
- On the map: 2 numbered comment pins (teardrop 24×30: ① `color/status/open`, ② `color/status/in-review`) on the corridor; "Station Shop" unit gets 2px `color/accent/primary` stroke + `color/accent/subtle` 40% overlay fill (selection glow).

- [ ] **Step 2: Verify**

`get_screenshot` of the frame.
Expected: full-bleed map visible between floating elements; no element touches a screen edge; selection + pins clearly indigo/amber; attribute table aligns as two columns.

- [ ] **Step 3: USER SIGN-OFF GATE**

Show the screenshot to the user. Ask explicitly: "This locks the visual direction for all remaining screens — approve, or list changes." Iterate on this frame until approved. Do NOT proceed to Task 7 without approval.

- [ ] **Step 4: Record node ID; check boxes.**

---

### Task 7: Gallery screens

**Files:**
- Modify: Kiriko file, page `🗂 Gallery`

**Interfaces:**
- Consumes: Tasks 2–4 components; hero-approved direction (Task 6)
- Produces: frames `Gallery / Default 1440`, `Gallery / Empty 1440`, `Gallery / Delete confirm`, `Gallery / Offline fallback 1440`, component `DatasetCard`

- [ ] **Step 1: Invoke `figma:figma-use`, then build `DatasetCard`** (component, 368×280)

Fill panel, radius `radius/lg`, `Elevation/Floating`. Top: 368×140 pattern header — 8–10 abstract rounded rectangles in `color/accent/subtle`, `#E0E7FF`, `#F5F5F4` on `#FAFAF9` (deterministic-looking block composition echoing a floor plan), radius top corners only. Body padding 16: name `Title/18` 2-line clamp, kind `Chip/context` ("GDB snapshot" or "IMDF"), meta `Caption/12` secondary "4 floors · 3,204 features · Updated 2026-07-16", source `Mono/12` secondary "JRShinjukuSta.gdb". Variants: `state = default | hover` (hover: `Elevation/Raised`, "Open →" `Label/13` accent appears bottom-right, ⋯ overflow icon top-right of body).

- [ ] **Step 2: Build `Gallery / Default 1440`**

1440×900, fill `color/bg/app`. Header 64 high: Kiriko mark + wordmark `Title/18` left; right: Avatar "DM" + "EN" chip. Content column max 1200 centered: title row — "Datasets" `Display/24`, `Input` (placeholder "Filter datasets…", 280 wide), `Button/primary/md` "Open local data". Grid 3×2 of `DatasetCard` instances with varied sample data (新宿駅構内図 / Tokyo Station IMDF / 渋谷駅構内図 / Haneda T3 IMDF / 東京駅構内図 hover-state / Yokohama Station GDB), 24 gap.

- [ ] **Step 3: Build `Gallery / Empty 1440`**

Same header/title row; centered empty card: "No datasets published yet" `Title/18`, `Body/14` secondary "Publish a reviewed GDB or IMDF dataset to share it with colleagues.", `Button/primary/md` "Open local data".

- [ ] **Step 4: Build `Gallery / Delete confirm`**

Duplicate `Gallery / Default 1440`, dim with `#1C1917` 40% overlay, centered `Modal/560` width-overridden to 400: title "Delete dataset?", `Body/14` "新宿駅構内図 and all its comments will be permanently removed.", footer: `Button/ghost` "Cancel" + `Button/destructive` "Delete".

- [ ] **Step 5: Build `Gallery / Offline fallback 1440`**

For when the server probe fails (local dev): `color/bg/app` fill, compact header (wordmark only, no account), centered content = the two drop targets from Task 9's "Open local data" modal rendered directly on the page (not in a modal), with `Caption/12` secondary line "Server unavailable — open local data to view it in your browser."

- [ ] **Step 6: Verify**

`get_screenshot` of all four frames.
Expected: cards align to grid, pattern headers look intentional (not noise), JA names clamp to 2 lines, hover card visibly lifted, delete modal reads destructive, fallback page works without any server-dependent UI.

- [ ] **Step 7: Record node IDs; check boxes.**

---

### Task 8: Comments and viewer panel states

**Files:**
- Modify: Kiriko file, pages `💬 Comments` and `🖥 Viewer`

**Interfaces:**
- Consumes: Tasks 2–4; status chip variants (Task 3); hero frame (Task 6)
- Produces: components `CommentCard`, `CommentComposer`; frames `Comments / Signed-in`, `Comments / Signed-out`, `Comments / Empty`, `Comments / Pin-placement 1440`; on the Viewer page: `Viewer / Layers panel 1440`, `Viewer / Warnings panel 1440`, `Viewer / Dataset info 1440`

- [ ] **Step 1: Invoke `figma:figma-use`, then build `CommentCard`** (component, fill-width)

Auto-layout vertical padding 12 gap 8, radius `radius/md`: row 1 — `Avatar/24` + author `Label/13` + "· 2h" `Caption/12` secondary + spacer + `Chip/status`; row 2 — text `Body/14` ("改札口の位置が実際と少しずれています"); row 3 — `Chip/context` level "1F" + `Chip/context` feature "改札口" + spacer + ⋯ icon. Variants: `active = true | false` (active: `color/accent/subtle` fill + 2px left accent edge), `status = open | in-review | closed`.

- [ ] **Step 2: Build `CommentComposer`** (component)

Fill-width, top hairline divider, padding-top 12: `Input` fill-width (placeholder "Add a comment…"), row below: `Chip/filter` "📍 Pin" + `Chip/filter` selected "改札口 ✕" (link-to-selection prefilled) + spacer + `Button/primary/sm` "Post".

- [ ] **Step 3: Build the three panel frames** (each a 320-wide `FloatingPanel` on its own artboard)

Header "Comments" + filter row: segmented chips `All 5 · Open 3 · In review 1 · Closed 1` (Open selected) + `Chip/filter` "Mine · 2".
- `Signed-in`: 4 `CommentCard`s — ① open by yuki (the sample above, active), ② open by daniel linked-feature-only, ③ in-review by yuki pinned "B1", ④ closed by daniel ("解決済みです — moved the marker.") — then `CommentComposer`.
- `Signed-out`: same list; composer replaced by a card: `Body/14` "Sign in to comment" + `Button/primary/sm` "Sign in".
- `Empty`: header + filters, then `Body/14` secondary centered "No comments yet — drop the first pin." — no composer change.

- [ ] **Step 4: Build `Comments / Pin-placement 1440`**

Duplicate of the Task 6 hero frame with: comments panel open instead of search, composer's Pin chip selected (accent), a ghost pin (50% opacity teardrop) mid-map under a crosshair cursor icon, and a hint toast bottom-center (dark `#1C1917` 90% pill, white `Label/13` "Click the map to place the pin · Esc to cancel").

- [ ] **Step 5: Build the remaining viewer panel states on `🖥 Viewer`** (each a duplicate of the Task 6 hero with a different panel open)

- `Viewer / Layers panel 1440`: rail Layers active; `FloatingPanel` "Layers": section header `Caption/12` secondary "FEATURE TYPES" with 5 toggle rows (eye / eye-off icon 16 + label `Body/14`: Units ☑, Gates ☑, Amenities ☑, Fixtures ☐, Openings ☑), divider, "BUILDINGS" with 2 rows (本館 ☑, 南館 ☐), footer `Button/ghost/sm` "Reset visibility".
- `Viewer / Warnings panel 1440`: rail Warnings active (warning badge "5"); `FloatingPanel` "Warnings": 5 rows — amber alert-triangle icon 16 + `Body/14` message + `Caption/12` secondary detail (e.g. "Missing display point — unit a1000008…", "Unclosed ring repaired — Shops_B1", "Level ordinal conflict — B1/B1M", "Unknown category 'kiosk2'", "Anchor without unit — 改札口前").
- `Viewer / Dataset info 1440`: ContextBar's dataset name shown pressed with a 300-wide dropdown card below it (panel fill, radius `radius/md`, `Elevation/Raised`): rows of `Caption/12` secondary label + `Body/14` value — Source `JRShinjukuSta.gdb` (Mono/12), Kind `GDB snapshot`, Floors `4`, Features `3,204`, Updated `2026-07-16`.

- [ ] **Step 6: Verify**

`get_screenshot` of all seven artboards.
Expected: status chips show 3 distinct colors; Mine chip composes visually with segments; ghost pin + toast legible over the map; layers toggles read on/off at a glance; warnings rows amber but not alarming; dropdown clearly anchored to the dataset name.

- [ ] **Step 7: Record node IDs; check boxes.**

---

### Task 9: Publish flow screens

**Files:**
- Modify: Kiriko file, page `🚀 Publish`

**Interfaces:**
- Consumes: Tasks 2–4 (`Modal`, buttons, chips, inputs)
- Produces: frames `Publish / Open local data`, `Publish / GDB review`, `Publish / Wizard 1 Details`, `Publish / Wizard 2 Upload`, `Publish / Wizard 3 Done`, `Publish / Sign-in`, `Account menu` — modals sit on a dimmed 1440×900 backdrop (gallery or viewer frame with `#1C1917` 40% overlay)

- [ ] **Step 1: Invoke `figma:figma-use`, then build `Open local data`**

`Modal/560`: title "Open local data"; two side-by-side 240×160 drop targets (dashed 1.5px `color/border/hairline`, radius `radius/lg`, hover-accent note): left — ZIP icon, "IMDF ZIP" `Label/13`, "Drop or browse" `Caption/12` secondary; right — folder icon, "GDB folder / archive". Footer: `Button/ghost` "Cancel".

- [ ] **Step 2: Build `GDB review`**

`Modal/720`: title "Review GDB import — JRShinjukuSta.gdb"; body: 6 layer rows (checkbox ☑, layer name `Mono/12` — `Shops_1F`, `Shops_B1`, `Gates`, `Facilities`, `Walls_Ref` ☐ excluded, `Annotations` ☐ excluded — feature count `Caption/12` secondary right-aligned); one inline amber warning row (`color/semantic/warning-bg` fill, `Caption/12` "Walls_Ref: no level field detected — excluded by default"); summary footer bar `Label/13` "14 layers · 3,204 features · 4 levels"; footer buttons: ghost "Cancel", primary "Import 4 layers".

- [ ] **Step 3: Build the wizard steps** (all `Modal/560` with a 3-dot progress row under the title — active dot accent, done dot accent-subtle, pending hairline)

1. `Details`: label "Dataset name" + `Input` value "新宿駅構内図"; below, slug row `Mono/12` "kiriko.local/?dataset=**shinjuku-station**" + pencil icon; amber inline warning card "This will overwrite 新宿駅構内図, updated 2026-07-16."; footer: ghost "Back", primary "Publish".
2. `Upload`: progress bar (fill-width 8 high, radius pill, accent fill at 62%), `Caption/12` secondary "38 MB of 61 MB · uploading snapshot.zip"; footer: ghost "Cancel" only.
3. `Done`: 32 green check circle, `Title/18` "Published"; two copy rows (hairline-bordered, radius md, `Mono/12` URL + copy icon): view link `?dataset=shinjuku-station`, embed snippet `<iframe src="…&embed=1">`; footer: primary "Open in gallery".

- [ ] **Step 4: Build `Sign-in`**

`Modal/560` width-overridden to 400, centered content: Kiriko mark 32, `Title/18` "Sign in to Kiriko", `Input` "Username", `Input` "Password", inline `Caption/12` `color/semantic/danger` error line "Wrong username or password." (shown), full-width `Button/primary/md` "Sign in".

- [ ] **Step 5: Build `Account menu`**

Small artboard: the top-right account cluster (Avatar "DM" + "EN" chip) with an open 220-wide dropdown card below it (panel fill, radius `radius/md`, `Elevation/Raised`, padding 8): row 1 — "daniel" `Label/13` + `Chip/context` "admin"; divider; row 2 — `ListRow` "Sign out" with log-out icon.

- [ ] **Step 6: Verify**

`get_screenshot` of all seven artboards.
Expected: modals centered on dimmed backdrops; progress dots read as a sequence; overwrite warning amber and non-blocking (Publish button still primary/enabled); mono slugs/URLs legible; account menu anchored to the avatar.

- [ ] **Step 7: Record node IDs; check boxes.**

---

### Task 10: Embed frame

**Files:**
- Modify: Kiriko file, page `🔐 Sign-in & Embed`

**Interfaces:**
- Consumes: Tasks 2–5 (MapMock, FloorStack, ZoomCluster)
- Produces: frame `Embed / 960×600`

- [ ] **Step 1: Invoke `figma:figma-use`, then compose**

Frame 960×600: `MapMock/1F` cropped fill; `FloorStack` right-center; `ZoomCluster` bottom-right; attribution `Caption/12` bottom-left; bottom-right above zoom: **Kiriko badge** — small pill (fill panel, `Elevation/Floating`, padding 10×6): Kiriko mark 14 + "Kiriko ↗" `Label/13`. Add a slim read-only info card top-left (240 wide FloatingPanel override: "Station Shop" `Label/13` + "occupant · 1F" `Caption/12` secondary — no buttons).

- [ ] **Step 2: Verify**

`get_screenshot`.
Expected: unmistakably a stripped-down viewer; badge subtle but present; no rail, no comments, no account UI.

- [ ] **Step 3: Record node ID; check boxes.**

---

### Task 11: Mobile viewer screens

**Files:**
- Modify: Kiriko file, page `📱 Mobile`

**Interfaces:**
- Consumes: all prior components
- Produces: frames `Mobile / Viewer 390`, `Mobile / Sheet feature`, `Mobile / Sheet comments`, `Mobile / Gallery 390`

- [ ] **Step 1: Invoke `figma:figma-use`, then build `Mobile / Viewer 390`** (390×844)

`MapMock/1F` scaled/cropped background; top inset 12: compact context pill (back arrow + "新宿駅構内図" `Label/13`, max 260 truncate); right edge: `FloorStack` with 44×40 touch targets; bottom: **bottom bar** — full-width-minus-24 floating pill (height 56, radius pill, `Elevation/Floating`): 4 icon buttons (search, layers, message-circle + accent Badge "3", alert-triangle + warning Badge "5") evenly spaced.

- [ ] **Step 2: Build `Mobile / Sheet feature`**

Same base; half-height bottom sheet (390×420 anchored bottom, top corners radius lg, panel fill, `Elevation/Raised`, 32×4 drag handle centered): inspector content from Task 6 (title, category line, attribute table 6 rows, footer buttons full-width stacked). Bottom bar hidden behind sheet.

- [ ] **Step 3: Build `Mobile / Sheet comments`**

Same base; half-height sheet: "Comments" header + filter chips row (horizontally scrollable — let chips overflow-clip right edge), 2 `CommentCard`s, `CommentComposer`. Annotate beside the frame in `Caption/12` gray: "Pin placement = long-press on map."

- [ ] **Step 4: Build `Mobile / Gallery 390`**

`color/bg/app` fill: compact header (wordmark + avatar), "Datasets" `Display/24`, `Input` filter, `DatasetCard`s stacked 1-up ×3 (fill-width 342).

- [ ] **Step 5: Verify**

`get_screenshot` of all four frames.
Expected: touch targets ≥44 on interactive elements; sheets clearly layered above map; cards fill width cleanly.

- [ ] **Step 6: Record node IDs; check boxes.**

---

### Task 12: Consistency pass and handoff summary

**Files:**
- Modify: Kiriko file (all pages); Create: summary comment frame on `📐 Foundation`

**Interfaces:**
- Consumes: the whole file
- Produces: verified, internally consistent file + `Handoff Notes` frame

- [ ] **Step 1: Cross-file audit**

`get_screenshot` every page. Check against spec §1–§6: 12px edge insets everywhere; no hardcoded colors where tokens exist (spot-check 5 random nodes with `get_variable_defs`); status colors identical across chips, pins, and filters; JA strings render in Noto Sans JP; every screen uses component instances (not detached copies) — fix any drift found.

- [ ] **Step 2: Build `Handoff Notes` frame on Foundation**

Text frame listing: token → CSS custom property naming convention (`color/accent/primary` → `--k-color-accent-primary`), the component ↔ React component map from spec §8, and the deferred items from spec §9.

- [ ] **Step 3: Final verification with the user**

Post the viewer hero + gallery screenshots and the Figma file link. Confirm the file is ready to drive the restyle plan.

- [ ] **Step 4: Check boxes; update Execution Notes with any final IDs.**
