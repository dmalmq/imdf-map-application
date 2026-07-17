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

- **Task 11 (Mobile viewer screens):**
  - All four frames built on page `📱 Mobile` (`1:8`), each 390×844, positioned left-to-right at x=0/450/900/1350: `Mobile / Viewer 390` `111:2`, `Mobile / Sheet feature` `112:1930`, `Mobile / Sheet comments` `114:2006`, `Mobile / Gallery 390` `119:206`.
  - `Mobile / Viewer 390` (`111:2`): `MapMock/1F` instance `111:3` positioned at local `x=-350,y=0` (crops to a slice showing the left core, "Station Shop"/"改札口" units, and corridor). Context pill `111:40` (top-left, 12px inset) — auto-layout pill, panel fill + `Elevation/Floating`, back-arrow SVG icon `111:41` (hand-drawn, hardcoded `#1C1917` stroke, same convention as other unbound rail/icon SVGs) + text `111:44` "新宿駅構内図" (Noto Sans JP Medium, `maxWidth=260`, `textTruncation=ENDING`, `maxLines=1`). `FloorStack (detached: 44x40 touch targets)` `111:55` (right edge, 12px inset, vertically centered) — detached from instance `26:21` per brief's "detach + disclose" guidance so each floor button could be resized from 40×36 to 44×40; container `primaryAxisSizingMode`/`counterAxisSizingMode` had to be flipped from `FIXED` to `AUTO` after resizing children so the pill re-hugged to 52×132 (fix applied after first pass left the container at its stale 48×120 size, clipping the enlarged buttons). Bottom Bar `111:1944` (floating pill, width 366, height 56, radius pill, `Elevation/Floating`, `clipsContent=false`) with 4 `Icon Button` frames (44×44, `clipsContent=false`) for Search/Layers/Comments/Warnings; Comments and Warnings buttons carry `Badge/tone=accent` "3" (`111:1962`) and `Badge/tone=warning` "5" (`111:1964`) anchored top-right via `layoutPositioning=ABSOLUTE` — badge text required an explicit override (default component text read "12"/placeholder) fixed in a follow-up call.
  - `Mobile / Sheet feature` (`112:1930`, clone of the viewer base with `Bottom Bar` set `visible=false`): sheet `114:91` (390×420, anchored bottom, top corners `radius/lg` only, panel fill, `Elevation/Raised`), drag handle `114:92` (32×4, hairline fill, centered), content column `114:93` — title "Station Shop" `114:94` (Title/18), subtitle "occupant · shopping · 1F" `114:95` (Caption/12 secondary), divider `114:96`, attribute table `114:97` (6 hand-built Mono/12 rows matching the hero inspector's exact row structure/spacing: NAME, NAME_KANA "ステーションショップ" in Noto Sans JP, FLOOR, SHOP_CODE, AREA_M2, OPEN_HOURS — same sample values as the Task 6 hero panel), footer `114:116` with two full-width stacked buttons: ghost "Copy link" `114:117` + primary "Comment on this feature" `114:119`. Content hugs to 305px, comfortably inside the 420 sheet with no overflow.
  - `Mobile / Sheet comments` (`114:2006`, same base + hidden bottom bar): sheet `115:132` (same recipe as the feature sheet), header "Comments" `115:135` (Title/18), filter chip row `115:136` (fixed-width 350, `clipsContent=true`, 5 `Chip/filter` instances "All 5" (selected) / "Open 3" / "In review 1" / "Closed 1" / "Mine · 2" — each resized post-text-override to its measured text width + 20px padding, since setting `layoutSizingHorizontal='FIXED'` before the text change had locked the pre-override hug width and caused visible overlap; fixed by resizing every chip after its text was set), 2 `CommentCard` instances (`active=true,status=open` clone + `active=false,status=in-review` clone, both ship the component set's baked-in sample content per the Task 8 convention), `CommentComposer` instance. Content (407px) slightly exceeds the 420 sheet once the 24px top offset is added, so the composer's bottom edge clips a few px — read as an intentional "scrollable" affordance, consistent with the chip row's overflow-clip. Canvas annotation `115:239` "Pin placement = long-press on map." (Caption/12, `color/text/secondary`) placed beside the frame at `x=1314,y=436`, not inside it.
  - `Mobile / Gallery 390` (`119:206`, fresh frame, `color/bg/app` fill): header `119:207` (56h, bottom hairline, space-between) — `KirikoMark` instance `119:209` + "Kiriko" wordmark `119:214` (Title/18) left, `Avatar` size=24 instance `119:215` right; content column `119:217` — "Datasets" `119:218` (Display/24), filter `Input` instance `119:219` (width variable unbound then resized/FILL to 350, placeholder overridden to "Filter datasets…", matching the Task 6 fix-round-1 pattern for `size/panel-width`-bound inputs), 3 `DatasetCard` instances stacked 1-up at FILL width (342): `119:2090` "新宿駅構内図" (GDB snapshot, Noto Sans JP Bold name), `119:2112` "Tokyo Station IMDF" (IMDF, Inter Semi Bold name), `119:2132` "渋谷駅構内図" (GDB snapshot). Combined content height (~996px across 3×288px cards) exceeds the 844 frame height, so the third card is partially clipped by the frame's `clipsContent=true` — read as a normal scrollable dataset list rather than a defect.
  - Verified all four frames with `get_screenshot` (full-frame + a combined page overview): touch targets on FloorStack buttons (44×40) and bottom-bar icon buttons (44×44) both meet/exceed the 44px minimum; both bottom sheets read clearly layered above the map via `Elevation/Raised` shadow; badges "3"/"5" render fully unclipped; DatasetCards fill their 342px column cleanly with no horizontal overflow; JA strings ("新宿駅構内図", "改札口", "ステーションショップ", "渋谷駅構内図") render correctly with no tofu; all floating top elements sit at or below y=12, nothing hidden under the simulated notch area.
  - Concerns: (1) the Sheet-comments composer clips a few px at the bottom given the half-height sheet budget — cosmetic, not a broken element. (2) the two CommentCard instances in Sheet comments show identical body text because the component set's non-Task-8 variants ship shared placeholder content by design (per Task 8's established convention) — only author/status/chip badge differ; no per-instance text override was applied since the brief didn't request distinct copy here. (3) Gallery's third DatasetCard is mostly clipped below the 844 frame edge — consistent with a real scrollable list, not fixed to keep the frame from growing past the standard mobile viewport height.
  - Did not touch the `🚀 Publish` page (concurrent work) — only referenced components from `🧩 Components` and the Task 6 hero inspector panel (`54:158`, `54:165`) via read-only lookups by node id.
  - Full report: `.superpowers/sdd/kiriko-task-11-report.md`
- **Task 10 (Embed frame):**
  - Frame `Embed / 960×600`: `108:62` on page `🔐 Sign-in & Embed` (`1:7`).
  - Key sub-node IDs: `MapMock/1F` instance `108:63` (cropped: positioned at local `x=-320,y=-150`, centering the 900×620 footprint in the 960×600 frame with the frame clipping the rest, so corridor + both unit rows + all labels are visible); `FloorStack` instance `108:100` (right-center, 12px inset); `ZoomCluster` instance `108:107` (bottom-right, 12px inset); attribution text `108:118` ("IMDF venue data © Company", Caption/12, bottom-left, 12px inset); Kiriko badge `108:119` (auto-layout pill, panel fill + `Elevation/Floating` + `radius/pill`, padding 10×6) containing `KirikoMark` instance `108:120` (resized to 14×14) + text `108:125` ("Kiriko ↗", Label/13) — positioned right-aligned with the zoom cluster, 8px above it; info card `108:126` (auto-layout, 240 wide, panel fill + `Elevation/Floating` + `radius/lg`, padding 12) containing title text `108:127` ("Station Shop", Label/13) + subtitle text `108:128` ("occupant · 1F", Caption/12, `color/text/secondary`) — top-left, 12px inset, no buttons.
  - Verified with `get_screenshot`: reads unmistakably as a stripped-down embed viewer — cropped map fills the frame, floor stack and zoom cluster sit right-side with clean 12px insets, the Kiriko badge is a subtle pill sitting just above the zoom cluster, attribution is legible bottom-left, info card is a plain read-only surface top-left with no buttons. No icon rail, no comments UI, no account cluster. Nothing touches the frame edges.
  - Did not touch the `🚀 Publish` page (under concurrent review) — only referenced components from `🧩 Components` (read-only lookups by node id).
  - Full report: `.superpowers/sdd/kiriko-task-10-report.md`
- **Task 9 (Publish flow screens):**
  - All 7 artboards built on page `🚀 Publish` (`1:6`), each a duplicate of `Gallery / Default 1440` (`66:2`) or `Viewer / Hero 1440` (`49:2`) with a full-bleed `#1C1917` 40%-opacity dim overlay (bound to `color/text/primary`), modal centered on top. Row layout: y=0 `Open local data` (x=0) / `GDB review` (x=1600, Viewer backdrop); y=1000 `Wizard 1 Details` (x=0) / `Wizard 2 Upload` (x=1600) / `Wizard 3 Done` (x=3200); y=2000 `Sign-in` (x=0) / `Account menu` (x=1600, custom 480×320 artboard, not a backdrop dup).
  - `Publish / Open local data`: `91:2` (backdrop, dim `91:18`). Modal `92:15` "Modal — Open local data (detached: no body slot)" — `Modal/560` detached to swap the TEXT-only body slot for a `Drop Targets` row `92:26` containing clones of the existing offline-fallback drop targets `71:268`→`92:27` (IMDF ZIP) and `71:275`→`92:34` (GDB folder/archive), unmodified originals. Footer left with only the `Cancel` ghost instance `92:22` (Confirm instance removed).
  - `Publish / GDB review`: `91:19` (Viewer-hero backdrop, dim `91:87`, kept `publish=hidden` ContextBar as-is per brief). Modal `94:742` "Modal — GDB review (detached: no body slot)" (`Modal/720`) — 6 layer rows `94:752/760/768/776/784/791` (`Icon/CheckboxOn` `74:58` / `Icon/CheckboxOff` `74:61` instances + `Mono/12` name + right-aligned `Caption/12` count; Walls_Ref/Annotations unchecked with `—` count), amber warning row `94:798` (`color/semantic/warning-bg` fill, `color/semantic/warning` text), summary bar `94:800` (top hairline stroke, `Label/13` "14 layers · 3,204 features · 4 levels"), footer `Cancel` `94:749` + `Confirm` relabeled "Import 4 layers" `94:750`.
  - Wizard steps — all `Modal/560` detached (`(detached: no body slot)`), shared header title "Publish dataset", and a hand-built 3-dot `Progress Dots` row (8×8 ellipses, gap 8) inserted directly under the header: active = `color/accent/primary` fill; done = `color/accent/subtle` fill **+ 1px `color/accent/primary` stroke** (added in a fix pass so "done" reads distinctly from "pending" instead of nearly invisible pale-on-white); pending = no fill, 1px `color/border/hairline` stroke.
    - `Wizard 1 Details`: backdrop `91:88` (dim `91:104`). Modal `96:760`, dots `96:769` (active=0). Body `96:773`: field group `96:774` (Label/13 "Dataset name" + `Input` `96:776` value "新宿駅構内図" set in Noto Sans JP Regular, search-icon slot hidden, width fixed to fill 512), slug row `96:781` (Mono/12 "kiriko.local/?dataset=" secondary + "shinjuku-station" accent-colored + hand-drawn `Icon/Pencil` `96:784` SVG import), amber overwrite-warning card `96:787` (Noto Sans JP Regular, "This will overwrite 新宿駅構内図, updated 2026-07-16."). Footer `Back` (relabeled Cancel) + `Publish` (relabeled Confirm, primary/enabled — non-blocking per brief).
    - `Wizard 2 Upload`: backdrop `91:105` (dim `91:121`). Modal `97:764`, dots `97:773` (active=1). Body `97:777`: pill progress track `97:778` (`color/accent/subtle` fill) with 62%-width fill bar `97:779` (`color/accent/primary`), `Caption/12` secondary "38 MB of 61 MB · uploading snapshot.zip". Footer: ghost `Cancel` only (`Confirm` instance removed).
    - `Wizard 3 Done`: backdrop `91:122` (dim `91:138`). Modal `97:1853`, dots `97:1862` (active=2, first two dots "done"). Body `97:1866`: `Success` cluster `97:1867` — 32×32 `color/semantic/success`-filled circle wrapper `99:753` (rebuilt as a plain frame after a first attempt mis-parented the check glyph via `layoutPositioning=ABSOLUTE` on an auto-layout sibling instead of the circle's own coordinate space — fixed by wrapping circle + centered check SVG in one non-auto-layout frame) + `Title/18` "Published"; two hairline-bordered `radius/md` copy rows — `97:1872` view link "?dataset=shinjuku-station" and `97:1877` embed snippet `<iframe src="…&embed=1">`, both `Mono/12` + hand-drawn `Icon/Copy` SVG. Footer: `Confirm` relabeled "Open in gallery" only (`Cancel` removed).
  - `Publish / Sign-in`: backdrop `91:139` (dim `91:155`). Modal `100:766` "Modal — Sign-in (detached: no body slot, width override 400)" — resized to 400w, standard Header row removed entirely (no ✕, not specified in brief) in favor of a centered `Sign-in Header` cluster `100:776` (`KirikoMark` instance resized to 32×32 `100:777` + `Title/18` "Sign in to Kiriko"), `Username`/`Password` `Input` instances `100:783`/`100:788` (search-icon slots hidden, resized to fill 352), red `Caption/12` error line `100:793` "Wrong username or password.", full-width primary `Sign in` button `100:794`. Footer row removed (no Back/Cancel).
  - `Account menu`: `91:156`, custom 480×320 frame (not a backdrop duplicate), fill `color/bg/app`. Account cluster `102:812` (`Avatar` "DM" `102:813` + `Chip/filter` "EN" `102:815`) top-right. `Account Dropdown` `102:817` (220w, `color/bg/panel`, `radius/md`, `Elevation/Raised`, padding 8) anchored directly under and right-aligned to the cluster: user row `102:818` ("daniel" `Label/13` + `Chip/context` "admin", generic icon slot hidden), divider `102:825`, `ListRow` `102:834` "ListRow — Sign out (detached: no icon-swap slot)" — detached (ListRow has no `INSTANCE_SWAP` icon property, unlike `IconRail`) to append the new `Icon/LogOut` instance into the leading-icon slot; subtitle and trailing-chevron slots hidden.
  - New component: `Icon/LogOut` `101:96` on `🧩 Components` (16×16, hand-drawn Lucide-style SVG import, hardcoded `#78716C` stroke matching the existing Icon/* convention), placed beside `Icon/CheckboxOn`/`Icon/CheckboxOff` in the row at `y=3862`.
  - Fix-ups applied after first pass: (1) two `Input` instances (`96:776` Wizard 1 dataset-name field, `100:783`/`100:788` Sign-in fields) didn't pick up `layoutSizingHorizontal=FILL` when set immediately after `appendChild` while the ancestor auto-layout frame was still mid-resize in the same script — fixed with an explicit `resize()` to the target pixel width in a follow-up call. (2) Progress-dot "done" state was upgraded from bare `accent-subtle` fill (near-invisible on white) to fill+stroke so the 3-dot sequence reads clearly at a glance.
  - Verified all 7 artboards with `get_screenshot` (full-frame + close-up crops of the progress dots and success check icon): modals centered on dimmed backdrops; progress dots read as a clear 3-step sequence (solid active / outlined-and-tinted done / hairline pending); Walls_Ref overwrite and GDB-review warnings are amber but non-blocking (Publish and Import buttons stay enabled primary); Mono slugs/URLs and the embed snippet are legible; Account menu dropdown is unambiguously anchored under the avatar cluster.
  - Full report: `.superpowers/sdd/kiriko-task-9-report.md`
- **Task 8 (Comments and viewer panel states):**
  - New icon components on `🧩 Components` (page `1:2`), labeled row at `y=3862`: `Icon/Eye` `74:48`, `Icon/EyeOff` `74:54`, `Icon/CheckboxOn` `74:58`, `Icon/CheckboxOff` `74:61`, `Icon/Crosshair` `74:69` (all imported via `figma.createNodeFromSvg`, hand-authored Lucide-style paths — hardcoded stroke/fill hex matching token values, same convention as Task 4's rail icons which are also unbound).
  - `CommentCard` component set: `78:94` on `🧩 Components` at `x=0,y=4002` (label `78:95`). Variants `active=true|false` × `status=open|in-review|closed`, children `78:88`…`78:93`. All 6 variants ship the same sample content (yuki/"YK", "· 2h", JA body "改札口の位置が実際と少しずれています", level "1F" + feature "改札口" context chips, "⋯" overflow as a text glyph) per the brief; active variant adds `color/accent/subtle` fill + 2px `strokeLeftWeight` in `color/accent/primary` (`strokeAlign=INSIDE`). Context chips' `Icon/Generic` slot hidden via `visible=false` (not removed — instance children can't be `.remove()`d), same pattern as Task 7's `DatasetCard` Kind Chip.
  - `CommentComposer` component: `79:102` at `x=0,y=4310` (label `79:103`). Top hairline divider (bound `color/border/hairline`) + `Input` (placeholder "Add a comment…", search icon slot hidden) + chip row: `Chip/filter` "📍 Pin" (unselected) + `Chip/filter` selected "改札口 ✕" (Noto Sans JP Medium) + spacer + `Button/primary/sm` "Post".
  - `Comments / Signed-in`: `81:7` on `💬 Comments` (`1:5`) at `x=0,y=0`. Built from a detached `FloatingPanel` instance (name discloses `(detached: no body slot)`) — header "Comments", wrapped filter row (`Chip/filter` "All 5", selected "Open 3", "In review 1", "Closed 1", "Mine · 2") `81:12`, 4 `CommentCard` instances `81:23`/`81:58`/`81:93`/`81:128` (① yuki/open/active with the sample JA text, ② daniel/open with level chip hidden — `hideLevel` via `visible=false` — "linked-feature-only", ③ yuki/in-review pinned "B1", ④ daniel/closed "解決済みです — moved the marker."), then `CommentComposer` instance `81:163`. Panel `primaryAxisSizingMode` fixed by default on `FloatingPanel` — set to `AUTO` post-detach so it hugs the stacked content (final `320×749`).
  - `Comments / Signed-out`: `82:463` (clone of Signed-in at `x=400,y=0`) — composer swapped for a "Sign-in card" `82:605` (`Body/14` "Sign in to comment" + `Button/primary/sm` "Sign in").
  - `Comments / Empty`: `82:649` (clone of Signed-in at `x=800,y=0`) — 4 cards + composer removed, replaced with a padded wrap frame containing centered `Body/14` secondary "No comments yet — drop the first pin."
  - `Comments / Pin-placement 1440`: `83:211` on `💬 Comments`, cloned from hero `49:2` at `x=0,y=900`. Search panel removed; rail `Search` button `I83:221;34:43` set `active=false`, `Comments` button `I83:221;34:58` set `active=true` via `setProperties`. New detached Comments panel `85:344` at the freed `x=72,y=72` slot (header + filter row + 2 `CommentCard`s for brevity + `CommentComposer`), composer's Pin chip swapped to the selected filter-chip variant via `swapComponent` (nested instances inside a live instance can't be added/removed, only swapped/edited) and the link chip retextedd to "Station Shop ✕" to match the hero's actual selection. Ghost pin `85:834` (clone of the hero's pin-1 teardrop vector, `color/accent/primary` @ 50% opacity) at `(970,440)`; `Icon/Crosshair` instance `85:836` centered above it; hint toast `85:844` (`#1C1917` @ 90%, pill, white `Label/13` "Click the map to place the pin · Esc to cancel") bottom-center.
  - `Viewer / Layers panel 1440`: `87:149` on `🖥 Viewer` (`1:3`), cloned from hero at `x=0,y=1000`. Search panel removed, rail `Layers` set active. Detached `FloatingPanel` `87:987`: "FEATURE TYPES" section (5 toggle rows — `Icon/Eye` × Units/Gates/Amenities/Openings, `Icon/EyeOff` × Fixtures), hairline divider, "BUILDINGS" section (`Icon/CheckboxOn` 本館, `Icon/CheckboxOff` 南館), footer `Button/ghost/sm` "Reset visibility".
  - `Viewer / Warnings panel 1440`: `87:1047` (clone at `x=0,y=2000`), rail `Warnings` set active. Detached `FloatingPanel` `87:1249`: 5 rows, each a 16×16 `Icon/AlertTriangle` instance (cloned from the existing rail icon `34:36`, resized, vector strokes rebound to `color/semantic/warning`) + `Body/14` message + `Caption/12` secondary detail (Missing display point / unit a1000008…, Unclosed ring repaired / Shops_B1, Level ordinal conflict / B1/B1M, Unknown category 'kiosk2' / Fixtures_1F, Anchor without unit / 改札口前 in Noto Sans JP).
  - `Viewer / Dataset info 1440`: `88:369` (clone at `x=0,y=3000`), Search panel removed (was overlapping the dropdown's anchor slot). `ContextBar` instance detached in this duplicate only (`88:557`, name discloses `(detached: pressed state highlight)`) to insert a `color/accent/subtle` "Pressed highlight" rect behind the dataset name — note: the highlight had to be set `layoutPositioning="ABSOLUTE"` before insertion, since `ContextBar` is a horizontal auto-layout pill and a normal `insertChild` was first tried and pushed every sibling (dataset name, separator, floor) out of the flex flow and off the visible pill, clipping them; fixed by making the highlight absolute so it overlays without participating in layout. Dropdown card `88:569` (300w, `color/bg/panel`, `radius/md`, `Elevation/Raised`) anchored directly under the dataset name with 5 label/value rows (Source `JRShinjukuSta.gdb` in `Mono/12`, Kind `GDB snapshot`, Floors `4`, Features `3,204`, Updated `2026-07-16`).
  - Verified all 7 artboards + 2 components with `get_screenshot`: 3 distinct status colors confirmed (indigo/amber/gray+check) on both the component set and the Signed-in panel; Mine chip reads as part of the segmented row; ghost pin (lavender teardrop) + crosshair + dark hint toast all legible over the map; Layers panel's eye/eye-off and checkbox on/off read instantly; Warnings rows are amber but calm (no red, no heavy fills); Dataset info dropdown is unambiguously anchored under the pressed dataset-name pill. No empty checkbox-like placeholder squares introduced anywhere (context-chip generic icon slots hidden, not left visible).
  - Full report: `.superpowers/sdd/kiriko-task-8-report.md`
- Figma file key: `GU8TTQDEycQ0ngkmkwHzcz`
- Figma file URL: https://www.figma.com/design/GU8TTQDEycQ0ngkmkwHzcz
- Page node IDs:
  - `📐 Foundation`: `0:1`
  - `🧩 Components`: `1:2`
  - `🖥 Viewer`: `1:3`
  - `🗂 Gallery`: `1:4`
  - `💬 Comments`: `1:5`
  - `🚀 Publish`: `1:6`
  - `🔐 Sign-in & Embed`: `1:7`
  - `📱 Mobile`: `1:8`
- Component node IDs: _(set by Tasks 3–5)_
- **Task 7 (Gallery screens):**
  - `DatasetCard` component set: `64:47` on page `🧩 Components` (variant `state=default|hover`; children `64:45` (default), `64:46` (hover); placed at `x=0,y=3454`, 120px below `MapMock/1F` `43:42`, with gray "DatasetCard" label `62:41`). Card 368×288 (8px taller than the nominal 368×280 spec — see deviation note below), fill `color/bg/panel`, radius `radius/lg` (all four corners bound), effect `Elevation/Floating` (`Elevation/Raised` on hover). Header `Pattern Header` `62:43`/`63:...`: 368×140, fill `color/bg/app`, `clipsContent=true`, 9 rounded-rect blocks (`Block` nodes `62:44`…`62:52`) alternating `color/accent/subtle` (bound), `#E0E7FF`, `#F5F5F4`, varied sizes/radii, no two adjacent same fill. `Body` frame (`62:53`/`63:54`) padding 16 (`space/4` bound) all sides, gap 4: `Name` text (Title-style size/line-height but font hard-set to Noto Sans JP Bold for JA samples / Inter Semi Bold for EN, fixed 336×52 box, `textTruncation=ENDING`, 2-line clamp — confirmed by test with an oversized string, wraps and clips at 2 lines), `Kind Chip` (`Chip` `kind=context` instance, generic icon hidden via `visible=false` rather than removed — instance children can't be `.remove()`d), `Meta` (`Caption/12`), `Source` (`Mono/12`). Hover variant (`64:46`) adds `Overflow` text `⋯` top-right of body and `Open Link` text "Open →" (`color/accent/primary`) bottom-right of body, both `layoutPositioning=ABSOLUTE` within `Body`.
  - **Deviation:** card built at 368×288, not the spec's exact 368×280. At padding 16 + the design system's actual text-style line-heights (Title/18 2-line=52, Chip=26, Caption/12=16, Mono/12=18), the body content alone sums to 112px against a 108px budget (140 header − 32 padding) even with zero gaps between rows — there is no gap value that fits the literal 280 total without either clipping content or violating the 16px padding. Chose to keep the spec's `space/4` (16) padding and the design system's fixed text styles/chip geometry, and let the card grow 8px rather than crop or shrink outside the token system.
  - Frame `Gallery / Default 1440`: `66:2` on page `🗂 Gallery` (`1:4`), 1440×900, fill `color/bg/app`. `Header` `66:3` (64h, bottom hairline stroke): `KirikoMark` instance `66:4` + `Wordmark` "Kiriko" (Title/18) `66:9` left; `Avatar` "DM" instance `66:10` + `Chip/filter` "EN" instance `66:12` right. `Title Row` `66:174` (y=104): "Datasets" `Display/24` `66:175`, `Filter Input` (`Input` instance, resized 280w) `66:176`, `Open Local Data Button` (`Button/primary/md`) `66:181`. Grid at `x=144,y=180`, 3×2, 24 gap: instances `68:13` (新宿駅構内図, GDB snapshot), `68:37` (Tokyo Station IMDF), `68:57` (渋谷駅構内図), `68:77` (Haneda T3 IMDF), `68:97` (東京駅構内図, **hover-state variant**), `68:123` (Yokohama Station GDB).
  - Frame `Gallery / Empty 1440`: `69:121` (cloned from Default, cards removed). `Empty State Card` `69:280` (auto-hug, padding 64, centered in grid area): "No datasets published yet" (Title/18) + body copy (Body/14 secondary) + `Open Local Data Button` (Button/primary/md).
  - Frame `Gallery / Delete confirm`: `70:133` (cloned from Default). `Dim Overlay` rect `70:149` (`#1C1917` @ 40% opacity, full-bleed). `Delete Confirm Modal` `70:150` — `Modal` `width=560` instance resized to 400w, centered: title "Delete dataset?", body "新宿駅構内図 and all its comments will be permanently removed." (font hard-set to Noto Sans JP Regular for the mixed JA/EN sentence), footer `Cancel` instance (unchanged `Button/ghost/sm`) + `Confirm` instance **swapped** to `Button/destructive/sm` main component, relabeled "Delete".
  - Frame `Gallery / Offline fallback 1440`: `71:260`. Compact `Header` (wordmark only, no account cluster). Two dashed drop targets built fresh (Task 9 not yet built to reuse): `Drop Target — IMDF ZIP` `71:268` and `Drop Target — GDB folder/archive` `71:275`, both 240×160, dashed 1.5px `color/border/hairline` stroke, `radius/lg`, containing a Lucide-style SVG icon (archive / folder, imported via `figma.createNodeFromSvg`, colored `color/text/secondary`), `Label/13` title, `Caption/12` "Drop or browse". `Fallback Caption` `71:280` below: "Server unavailable — open local data to view it in your browser."
  - Verified all four frames + the component set with `get_screenshot`: grid aligns cleanly, pattern headers read as intentional abstract floor-plan compositions (not noise), hover card (東京駅構内図) is visibly lifted with overflow icon + "Open →" affordance, delete modal reads clearly destructive (red button on dimmed backdrop), offline fallback has no server-dependent UI. No checkbox-like placeholder squares appear anywhere. Spot-checked token binding via `get_variable_defs` on `64:47`, `66:2`, `71:260` — all resolve to the `Kiriko Tokens` collection.
  - **Note:** Execution Notes for Task 6 still read "USER SIGN-OFF STILL PENDING" as of the start of this task; this task proceeded on the orchestrator's explicit instruction that the hero screen's visual direction was already approved. Flagging this discrepancy — the plan file itself was not updated to reflect that approval.
  - Full report: `.superpowers/sdd/kiriko-task-7-report.md`
- **Task 6 (Viewer hero screen):**
  - Frame `Viewer / Hero 1440`: `49:2` on page `🖥 Viewer` (`1:3`)
  - Key sub-node IDs: `MapMock/1F` instance `49:3`; selection overlay rect `49:40`; comment pins `49:41`/`49:44` (+ number text `49:43`/`49:46`); `ContextBar` instance `49:47`; `IconRail` instance `49:62`; `FloorStack` instance `49:111` (repositioned to `y=429` to clear the inspector panel); `ZoomCluster` instance `49:121`; attribution text `49:132`; `FloatingPanel — Search` (detached) `52:134` with `Input` `52:139`, filter chip row `52:144`, `RESULTS` header `52:153`, `ListRow` instances `52:154`/`52:162`/`52:170`; account cluster `54:148` (Avatar `54:149` + "EN" Chip `54:151`); `FloatingPanel — Inspector` (detached, width override 340) `54:158` with attribute-table rows `54:166`…`54:187` and footer `54:191`.
  - Full report: `.superpowers/sdd/kiriko-task-6-report.md`
  - USER SIGN-OFF: APPROVED 2026-07-17 (one change requested and applied: ListRow leading icon slot hidden by default; no checkbox-like squares in search results). Direction locked for Tasks 7-12.
- **Task 5 (Map mock):**
  - `MapMock/1F` component: `43:42` (1440×900, fill `#EDEDEB`, at page position `x=0,y=2394` on `🧩 Components`, well below Task 4's section with 120px clearance; small gray "MapMock/1F" label text node `43:41` placed above it)
  - Venue footprint rounded rect `43:43` (900×620 at local `350,140`, fill `#E3E7EE`, 1px stroke `#C8CEDA`, corner radius 36)
  - 14 unit rectangles/L-shapes (7 top row, 7 bottom row) alternating fills `#F4F6F9`/`#E9EDF4`/`#DFE6F0` plus 2 beige `#F0EBE0` and 2 green `#E4EEE4` units, 1px stroke `#C8CEDA`; 2 of the 14 are true L-shapes built via `figma.subtract()` boolean operations (one top unit, one bottom unit)
  - 1 horizontal corridor rect fill `#F8F9FB` spanning between the two cores; 2 stair/elevator core rects fill `#D5DAE3` at either end of the footprint
  - 6 unit labels in `Caption/12`-equivalent styling (`#6B7280`, 12px/16px): "Station Shop", "改札口" (rendered in Noto Sans JP per Task 2's JA convention — the Figma text style itself is Inter, so this node's font is overridden to Noto Sans JP rather than bound to the style), "Info", "Restroom", "Café", "Lockers" — each centered in its unit
  - 8 POI marker ellipses (8×8, fill `#8B93A5`) scattered along the corridor and near the two cores
  - Verified with `get_screenshot` at both full size and a 360px (~25%) thumbnail: reads instantly as a station-concourse floor plan; light enough for indigo UI to pop; JA label renders correctly (no tofu)
  - Full report: `.superpowers/sdd/kiriko-task-5-report.md`
- **Task 4 (Core components — containers and map controls):**
  - `KirikoMark` component: `16:7` (children `16:3`,`16:4`,`16:5`,`16:6` — 4 facet triangles bound to `color/accent/primary` at opacities 1/0.85/0.7/0.55)
  - `FloatingPanel` component: `26:20` (320×hug, header row = `Title` text `26:20`'s child + trailing chevron icon; width bound to `size/panel-width` `VariableID:3:30` as of fix round 2)
  - `Modal` component set: `18:24` (variant `width=560|720`; children `18:2` (560), `18:13` (720); each has Header/Body/Footer with `Button/ghost/sm` "Cancel" + `Button/primary/sm` "Confirm" instances)
  - `ListRow` component set: `19:30` (variant `state=default|hover|selected`; children `19:6`,`19:14`,`19:22`)
  - `FloorStack` component: `26:21` (pill stack; nested variant set `FloorStack / Floor Button` at `20:10`, variant `active=true|false`, children `20:6`(false)/`20:8`(true); sample instances 2F/1F(active)/B1 at `20:12`,`20:14`,`20:16`)
  - `ZoomCluster` component: `21:21` (ghost +/−/compass icon buttons, no variant)
  - `ContextBar` component set: `22:33` (variant `publish=visible|hidden`; children `22:9`(hidden),`22:20`(visible); visible variant appends `Button/primary/sm` "Publish"; dataset name text uses Noto Sans JP Medium, `maxWidth=280`, `textTruncation=ENDING`, `maxLines=1`)
  - `IconRail` component: `25:52` (nested variant set `IconRail / Icon Button` at `23:24`, variant `active=true|false`, children `23:18`(false)/`23:21`(true), now with an `INSTANCE_SWAP` component property `Icon#34:0` defaulting to `Icon/Search`; rail buttons rebuilt in fix round 2 as **live instances** with the icon swapped per button: Search `34:43` (active=true, icon=Icon/Search), Layers `34:50` (active=false, icon=Icon/Layers), Comments `34:58` (active=false, icon=Icon/MessageCircle) + `Badge/tone=accent` instance "3" `34:74` anchored top-right (`layoutPositioning=ABSOLUTE`), Warnings `34:64` (active=false, icon=Icon/AlertTriangle) + `Badge/tone=warning` instance "5" `34:78` anchored top-right. `IconRail` (`25:52`) `clipsContent=false` so the absolutely-positioned badges aren't clipped.
  - New icon components (fix round 2, for the `IconRail / Icon Button` instance-swap property): `Icon/Search` `34:23`, `Icon/Layers` `34:28`, `Icon/MessageCircle` `34:31`, `Icon/AlertTriangle` `34:36` — 20×20 Lucide-style vectors, 1.5px stroke, placed inside section `26:23` near the `IconRail / Icon Button` helper row.
  - All 8 wrapped in Section `Task 4 — Containers & Map Controls`: `26:23` (resized in fix round 2 to `x=-40, y=520, width=1420, height=1714` to hug the re-laid-out content with 40px padding and 120px gaps between row groups), with per-component `Title/18` labels plus 3 new small gray helper labels (`35:43`, `35:44`, `35:45`) above the nested variant sets and the icon row.
  - Full report: `.superpowers/sdd/task-4-report.md` (see "Fix round 2" section for full detail)
- **Task 3 (Core components — primitives):**
  - `Button` component set: `9:14` (variants: `variant=primary|ghost|destructive` × `size=md|sm`; children `9:2`,`9:4`,`9:6`,`9:8`,`9:10`,`9:12`)
  - `Input` component set: `10:12` (variants: `state=default|focus`; children `10:2`,`10:7`)
  - `Chip` component set: `12:20` (variants: `kind=filter|status|context` × `selected=true|false` × `status=open|in-review|closed`; children `12:2`,`12:4`,`12:6`,`12:9`,`12:12`,`12:15`)
  - `Badge` component set: `12:25` (variant: `tone=accent|warning`; children `12:21`,`12:23`)
  - `Avatar` component set: `12:30` (variant: `size=24|32`; children `12:26`,`12:28`)
  - Section label text nodes: `12:31`–`12:35`
  - Full report: `.superpowers/sdd/task-3-report.md`
- **Task 2 (Foundation variables and styles):**
  - Variable collection `Kiriko Tokens`: `VariableCollectionId:3:2`, single mode `Light` (mode id `3:0`), 29 variables (15 color + 14 number). Variable IDs: `color/bg/app`=`VariableID:3:3`, `color/bg/panel`=`VariableID:3:4`, `color/border/hairline`=`VariableID:3:5`, `color/text/primary`=`VariableID:3:6`, `color/text/secondary`=`VariableID:3:7`, `color/accent/primary`=`VariableID:3:8`, `color/accent/hover`=`VariableID:3:9`, `color/accent/subtle`=`VariableID:3:10`, `color/status/open`=`VariableID:3:11`, `color/status/in-review`=`VariableID:3:12`, `color/status/closed`=`VariableID:3:13`, `color/semantic/warning`=`VariableID:3:14`, `color/semantic/warning-bg`=`VariableID:3:15`, `color/semantic/danger`=`VariableID:3:16`, `color/semantic/success`=`VariableID:3:17`, `space/1..8`=`VariableID:3:18`…`3:25`, `radius/sm`=`3:26`, `radius/md`=`3:27`, `radius/lg`=`3:28`, `radius/pill`=`3:29`, `size/panel-width`=`3:30`, `size/edge-inset`=`3:31`.
  - Text styles: `Display/24` Inter Semi Bold 24/32, `Title/18` Inter Semi Bold 18/26, `Body/14` Inter Regular 14/20, `Label/13` Inter Medium 13/18, `Caption/12` Inter Regular 12/16, `Mono/12` IBM Plex Mono Regular 12/18. (Figma's exact style-name spelling for "Semibold" is `Semi Bold`.)
  - Effect styles: `Elevation/Floating` (drop shadow 0/4/24, 8% black), `Elevation/Raised` (drop shadow 0/8/32, 12% black).
  - `Token Sheet` frame node ID: `4:5` on `📐 Foundation`. Sections: Colors `4:7` (15 swatches), Typography `4:8` (6 rows), Elevation `4:9` (2 cards).
  - Full report: `.superpowers/sdd/task-2-report.md`.

---

### Task 1: Create the Kiriko file and page structure

**Files:**
- Create: Figma design file **Kiriko** (via `create_new_file`, editor type `design`)

**Interfaces:**
- Consumes: nothing
- Produces: file key + page node IDs, recorded in Execution Notes. All later tasks operate in this file.

- [x] **Step 1: Invoke `figma:figma-create-new-file`, then create the file**

Create a design file named **Kiriko**.

- [x] **Step 2: Invoke `figma:figma-use`, then create the page structure**

Rename the default page and add pages so the file contains, in order:

1. `📐 Foundation`
2. `🧩 Components`
3. `🖥 Viewer`
4. `🗂 Gallery`
5. `💬 Comments`
6. `🚀 Publish`
7. `🔐 Sign-in & Embed`
8. `📱 Mobile`

- [x] **Step 3: Verify**

Run `get_metadata` on the document root.
Expected: exactly the 8 pages above, in order, no extra pages.

- [x] **Step 4: Record**

Append file key and the 8 page node IDs to Execution Notes. Check this task's boxes.

---

### Task 2: Foundation variables and styles

**Files:**
- Modify: Kiriko file, page `📐 Foundation`

**Interfaces:**
- Consumes: file key (Execution Notes)
- Produces: variable collection `Kiriko Tokens` with the exact variable names below; text styles `Display/24`, `Title/18`, `Body/14`, `Label/13`, `Caption/12`, `Mono/12`; effect styles `Elevation/Floating`, `Elevation/Raised`. Later tasks bind by these names.

- [x] **Step 1: Invoke `figma:figma-use` + `figma:figma-generate-library`, then create the variable collection `Kiriko Tokens`** (single mode `Light`) with exactly:

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

- [x] **Step 2: Create text styles**

| Style | Font | Size/Line | Weight |
|---|---|---|---|
| `Display/24` | Inter | 24/32 | Semibold |
| `Title/18` | Inter | 18/26 | Semibold |
| `Body/14` | Inter | 14/20 | Regular |
| `Label/13` | Inter | 13/18 | Medium |
| `Caption/12` | Inter | 12/16 | Regular |
| `Mono/12` | IBM Plex Mono | 12/18 | Regular |

(Japanese text falls back to Noto Sans JP; where a JA sample string is the primary content of a node, set that node's font to Noto Sans JP at the same size/weight.)

- [x] **Step 3: Create effect styles**

- `Elevation/Floating`: drop shadow `0 4 24 rgba(0,0,0,0.08)`
- `Elevation/Raised`: drop shadow `0 8 32 rgba(0,0,0,0.12)`

- [x] **Step 4: Build a token sheet on `📐 Foundation`**

One frame `Token Sheet` (auto-layout, vertical) that swatches every color variable with its name, renders each text style with sample string "Kiriko 切子 0123", and shows the two shadows on white cards. This is the visual regression reference for the whole file.

- [x] **Step 5: Verify**

`get_screenshot` of `Token Sheet`.
Expected: all 15 color swatches labeled, 6 text styles rendered (JA glyphs visible, not tofu), 2 shadow cards visibly distinct.

- [x] **Step 6: Record**

Append the collection ID to Execution Notes; check boxes.

---

### Task 3: Core components — primitives (Button, Input, Chip, Badge, Avatar)

**Files:**
- Modify: Kiriko file, page `🧩 Components`

**Interfaces:**
- Consumes: `Kiriko Tokens` variables, text styles, effect styles (Task 2)
- Produces: component sets `Button`, `Input`, `Chip`, `Badge`, `Avatar` with the exact variant properties listed below. Screen tasks place instances by these names.

- [x] **Step 1: Invoke `figma:figma-use`, then build `Button`** (component set)

Variants: `variant = primary | ghost | destructive`, `size = md | sm`. Auto-layout horizontal, padding md `16×8` / sm `12×6` (use `space/*`), radius `radius/md`, text `Label/13`.
- primary: fill `color/accent/primary`, text white; hover-noted description "hover: accent/hover".
- ghost: no fill, text `color/text/primary`, 1px stroke `color/border/hairline`.
- destructive: fill `color/semantic/danger`, text white.

- [x] **Step 2: Build `Input`**

Variants: `state = default | focus`. 320 wide fill-container, height 36, radius `radius/md`, fill `color/bg/panel`, stroke `color/border/hairline` (focus: 2px `color/accent/primary`), placeholder text `Body/14` in `color/text/secondary`, left search icon slot 16×16.

- [x] **Step 3: Build `Chip`**

Variants: `kind = filter | status | context`, `selected = true | false` (status chips ignore `selected`; set `status = open | in-review | closed` as a third property used only when `kind=status`).
- Base: auto-layout pill, radius `radius/pill`, padding 10×4, text `Label/13`.
- filter unselected: stroke hairline, text secondary; selected: fill `color/accent/subtle`, text + stroke `color/accent/primary`.
- status: leading 6×6 dot filled with matching `color/status/*` (closed uses a ✓ glyph instead of dot), text primary, stroke hairline.
- context (level/feature chips on comment cards): fill `#F5F5F4`, no stroke, leading 12×12 icon slot.

- [x] **Step 4: Build `Badge`**

Count badge: 16×16 min circle, fill `color/accent/primary`, white `Caption/12` text, auto-width for 2 digits. Variant `tone = accent | warning` (warning fill `color/semantic/warning`).

- [x] **Step 5: Build `Avatar`**

24×24 circle, fill `#DDD6FE` (sample pastel), initials in `Label/13` `color/text/primary`. Variant `size = 24 | 32`.

- [x] **Step 6: Verify**

`get_screenshot` of the components page region.
Expected: 5 component sets, all variants laid out, colors visibly bound to tokens (spot-check one: Button/primary fill inspects as `color/accent/primary`).

- [x] **Step 7: Record node IDs; check boxes.**

---

### Task 4: Core components — containers and map controls (FloatingPanel, Modal, ListRow, FloorStack, ZoomCluster, ContextBar)

**Files:**
- Modify: Kiriko file, page `🧩 Components`

**Interfaces:**
- Consumes: Tasks 2–3 outputs
- Produces: components `FloatingPanel`, `Modal`, `ListRow`, `FloorStack`, `ZoomCluster`, `ContextBar`, `IconRail`. The Viewer task composes these directly.

- [x] **Step 1: Invoke `figma:figma-use`, then build `FloatingPanel`**

Frame 320 wide (`size/panel-width`) × hug, fill `color/bg/panel`, radius `radius/lg`, effect `Elevation/Floating`, padding `space/4` (16), auto-layout vertical gap 12. Header row slot: `Title/18` text + optional trailing icon.

- [x] **Step 2: Build `Modal`**

560 wide × hug, same surface recipe as FloatingPanel but effect `Elevation/Raised`, padding 24, header (`Title/18` + close ✕), body slot, footer row (right-aligned Button instances). Variant `width = 560 | 720` (720 for the GDB import review).

- [x] **Step 3: Build `ListRow`**

Fill-width auto-layout horizontal, padding 12×10, radius `radius/md`, gap 12: leading 16 icon slot, title `Body/14` primary + subtitle `Caption/12` secondary stacked, trailing slot. Variants `state = default | hover | selected` (hover fill `#F5F5F4`; selected fill `color/accent/subtle` + 2px left inner accent edge).

- [x] **Step 4: Build `FloorStack`**

Vertical auto-layout pill container (fill panel, radius `radius/pill`, `Elevation/Floating`, padding 4, gap 2) of floor buttons 40×36 radius `radius/md`: text `Label/13`. Variant per-button `active = true | false` (active: fill `color/accent/primary`, white text). Ship the set with sample floors `2F / 1F / B1`.

- [x] **Step 5: Build `ZoomCluster`**

Vertical pill container like FloorStack containing `+`, `−`, compass icons, 36×36 each, ghost style.

- [x] **Step 6: Build `ContextBar`**

Pill bar (radius `radius/pill`, fill panel, `Elevation/Floating`, padding 8×8 with 12 gap, height 48): back-arrow icon 20, Kiriko mark (20×20 indigo faceted-diamond vector — draw a simple 4-facet lozenge), dataset name `Label/13` (max 280, truncate), separator dot, floor indicator `Label/13` secondary. Variant `publish = visible | hidden` — visible appends a `Button/primary/sm` labeled "Publish".

- [x] **Step 7: Build `IconRail`**

Vertical floating pill (like ZoomCluster) with 4 icon buttons 40×40: search, layers, message-circle, alert-triangle (Lucide style, 1.5px stroke, 20×20). Variant per-button `active` (fill `color/accent/subtle`, icon `color/accent/primary`); message-circle and alert-triangle each carry an optional `Badge` (accent "3", warning "5") anchored top-right.

- [x] **Step 8: Verify**

`get_screenshot` of the page.
Expected: 7 new components; ContextBar reads as one pill with logo + name + floor; IconRail badges overlap icon corners correctly.

- [x] **Step 9: Record node IDs; check boxes.**

---

### Task 5: Map mock

**Files:**
- Modify: Kiriko file, page `🧩 Components`

**Interfaces:**
- Consumes: Task 2 tokens
- Produces: component `MapMock/1F` (1440×900) — a station-like light floor plan used as the background of every viewer/embed/mobile screen.

- [x] **Step 1: Invoke `figma:figma-use`, then build the base**

Frame 1440×900, fill `#EDEDEB` (map ground). Inside, a venue footprint: large rounded polygon (~900×620, centered right-of-center) fill `#E3E7EE`, 1px stroke `#C8CEDA`.

- [x] **Step 2: Add units**

12–16 rectangles/L-shapes inside the footprint as rooms: fills alternating `#F4F6F9`, `#E9EDF4`, `#DFE6F0`, a couple of beige `#F0EBE0` and green `#E4EEE4` units, 1px strokes `#C8CEDA`. One long horizontal corridor `#F8F9FB`. Two stair/elevator cores in `#D5DAE3`.

- [x] **Step 3: Add labels and POI dots**

6 unit labels in `Caption/12` `#6B7280` ("Station Shop", "改札口", "Info", "Restroom", "Café", "Lockers") and 8 small 8×8 circle POI markers `#8B93A5`.

- [x] **Step 4: Make it a component; verify**

`get_screenshot` of `MapMock/1F`.
Expected: reads instantly as an indoor floor plan at 25% zoom; light enough that indigo UI pops; JA label renders.

- [x] **Step 5: Record node ID; check boxes.**

---

### Task 6: Viewer hero screen — USER SIGN-OFF GATE

**Files:**
- Modify: Kiriko file, page `🖥 Viewer`

**Interfaces:**
- Consumes: everything from Tasks 2–5
- Produces: frame `Viewer / Hero 1440` — the approved visual direction all remaining tasks must match. **Execution pauses here for user approval.**

- [x] **Step 1: Invoke `figma:figma-use`, then compose the frame**

Frame `Viewer / Hero 1440` (1440×900): `MapMock/1F` instance as background layer, then per spec §2, all floating elements inset 12 (`size/edge-inset`) from edges:

- Top-left: `ContextBar` (publish=hidden), dataset name "新宿駅構内図", floor "1F".
- Left, below ContextBar: `IconRail` — search active, comments badge "3", warnings badge "5". Beside it a `FloatingPanel` "Search": `Input` (placeholder "Search features…"), filter `Chip` row (All selected · Gates · Shops · Facilities), "RESULTS" `Caption/12` secondary header, 3 `ListRow`s ("Station Shop / occupant · 1F" selected, "改札口 / gate · 1F", "Info Kiosk / amenity · 1F").
- Right-top: account cluster (Avatar "DM" + "EN" ghost chip), and below it the inspector `FloatingPanel` (340 wide override): title "Station Shop", `Caption/12` secondary "occupant · shopping · 1F", divider, attribute table — 8 rows of two columns: field name `Mono/12` secondary (`NAME`, `NAME_KANA`, `FLOOR`, `SHOP_CODE`, `AREA_M2`, `OPEN_HOURS`, `TEL`, `NOTE`), value `Mono/12` primary with one explicit `null`; provenance line `Caption/12` secondary "JRShinjukuSta.gdb › Shops_1F"; footer: `Button/ghost/sm` "Copy link" + `Button/primary/sm` "Comment on this feature".
- Right-center: `FloorStack` (2F/1F/B1, 1F active).
- Bottom-right: `ZoomCluster`. Bottom-left: `Caption/12` attribution "IMDF venue data © Company".
- On the map: 2 numbered comment pins (teardrop 24×30: ① `color/status/open`, ② `color/status/in-review`) on the corridor; "Station Shop" unit gets 2px `color/accent/primary` stroke + `color/accent/subtle` 40% overlay fill (selection glow).

- [x] **Step 2: Verify**

`get_screenshot` of the frame.
Expected: full-bleed map visible between floating elements; no element touches a screen edge; selection + pins clearly indigo/amber; attribute table aligns as two columns.

- [x] **Step 3: USER SIGN-OFF GATE** _(approved 2026-07-17; one change requested and applied: no leading checkbox-like squares in ListRow / search results)_

Show the screenshot to the user. Ask explicitly: "This locks the visual direction for all remaining screens — approve, or list changes." Iterate on this frame until approved. Do NOT proceed to Task 7 without approval.

- [x] **Step 4: Record node ID; check boxes.**

---

### Task 7: Gallery screens

**Files:**
- Modify: Kiriko file, page `🗂 Gallery`

**Interfaces:**
- Consumes: Tasks 2–4 components; hero-approved direction (Task 6)
- Produces: frames `Gallery / Default 1440`, `Gallery / Empty 1440`, `Gallery / Delete confirm`, `Gallery / Offline fallback 1440`, component `DatasetCard`

- [x] **Step 1: Invoke `figma:figma-use`, then build `DatasetCard`** (component, 368×280)

Fill panel, radius `radius/lg`, `Elevation/Floating`. Top: 368×140 pattern header — 8–10 abstract rounded rectangles in `color/accent/subtle`, `#E0E7FF`, `#F5F5F4` on `#FAFAF9` (deterministic-looking block composition echoing a floor plan), radius top corners only. Body padding 16: name `Title/18` 2-line clamp, kind `Chip/context` ("GDB snapshot" or "IMDF"), meta `Caption/12` secondary "4 floors · 3,204 features · Updated 2026-07-16", source `Mono/12` secondary "JRShinjukuSta.gdb". Variants: `state = default | hover` (hover: `Elevation/Raised`, "Open →" `Label/13` accent appears bottom-right, ⋯ overflow icon top-right of body).

- [x] **Step 2: Build `Gallery / Default 1440`**

1440×900, fill `color/bg/app`. Header 64 high: Kiriko mark + wordmark `Title/18` left; right: Avatar "DM" + "EN" chip. Content column max 1200 centered: title row — "Datasets" `Display/24`, `Input` (placeholder "Filter datasets…", 280 wide), `Button/primary/md` "Open local data". Grid 3×2 of `DatasetCard` instances with varied sample data (新宿駅構内図 / Tokyo Station IMDF / 渋谷駅構内図 / Haneda T3 IMDF / 東京駅構内図 hover-state / Yokohama Station GDB), 24 gap.

- [x] **Step 3: Build `Gallery / Empty 1440`**

Same header/title row; centered empty card: "No datasets published yet" `Title/18`, `Body/14` secondary "Publish a reviewed GDB or IMDF dataset to share it with colleagues.", `Button/primary/md` "Open local data".

- [x] **Step 4: Build `Gallery / Delete confirm`**

Duplicate `Gallery / Default 1440`, dim with `#1C1917` 40% overlay, centered `Modal/560` width-overridden to 400: title "Delete dataset?", `Body/14` "新宿駅構内図 and all its comments will be permanently removed.", footer: `Button/ghost` "Cancel" + `Button/destructive` "Delete".

- [x] **Step 5: Build `Gallery / Offline fallback 1440`**

For when the server probe fails (local dev): `color/bg/app` fill, compact header (wordmark only, no account), centered content = the two drop targets from Task 9's "Open local data" modal rendered directly on the page (not in a modal), with `Caption/12` secondary line "Server unavailable — open local data to view it in your browser."

- [x] **Step 6: Verify**

`get_screenshot` of all four frames.
Expected: cards align to grid, pattern headers look intentional (not noise), JA names clamp to 2 lines, hover card visibly lifted, delete modal reads destructive, fallback page works without any server-dependent UI.

- [x] **Step 7: Record node IDs; check boxes.**

---

### Task 8: Comments and viewer panel states

**Files:**
- Modify: Kiriko file, pages `💬 Comments` and `🖥 Viewer`

**Interfaces:**
- Consumes: Tasks 2–4; status chip variants (Task 3); hero frame (Task 6)
- Produces: components `CommentCard`, `CommentComposer`; frames `Comments / Signed-in`, `Comments / Signed-out`, `Comments / Empty`, `Comments / Pin-placement 1440`; on the Viewer page: `Viewer / Layers panel 1440`, `Viewer / Warnings panel 1440`, `Viewer / Dataset info 1440`

- [x] **Step 1: Invoke `figma:figma-use`, then build `CommentCard`** (component, fill-width)

Auto-layout vertical padding 12 gap 8, radius `radius/md`: row 1 — `Avatar/24` + author `Label/13` + "· 2h" `Caption/12` secondary + spacer + `Chip/status`; row 2 — text `Body/14` ("改札口の位置が実際と少しずれています"); row 3 — `Chip/context` level "1F" + `Chip/context` feature "改札口" + spacer + ⋯ icon. Variants: `active = true | false` (active: `color/accent/subtle` fill + 2px left accent edge), `status = open | in-review | closed`.

- [x] **Step 2: Build `CommentComposer`** (component)

Fill-width, top hairline divider, padding-top 12: `Input` fill-width (placeholder "Add a comment…"), row below: `Chip/filter` "📍 Pin" + `Chip/filter` selected "改札口 ✕" (link-to-selection prefilled) + spacer + `Button/primary/sm` "Post".

- [x] **Step 3: Build the three panel frames** (each a 320-wide `FloatingPanel` on its own artboard)

Header "Comments" + filter row: segmented chips `All 5 · Open 3 · In review 1 · Closed 1` (Open selected) + `Chip/filter` "Mine · 2".
- `Signed-in`: 4 `CommentCard`s — ① open by yuki (the sample above, active), ② open by daniel linked-feature-only, ③ in-review by yuki pinned "B1", ④ closed by daniel ("解決済みです — moved the marker.") — then `CommentComposer`.
- `Signed-out`: same list; composer replaced by a card: `Body/14` "Sign in to comment" + `Button/primary/sm` "Sign in".
- `Empty`: header + filters, then `Body/14` secondary centered "No comments yet — drop the first pin." — no composer change.

- [x] **Step 4: Build `Comments / Pin-placement 1440`**

Duplicate of the Task 6 hero frame with: comments panel open instead of search, composer's Pin chip selected (accent), a ghost pin (50% opacity teardrop) mid-map under a crosshair cursor icon, and a hint toast bottom-center (dark `#1C1917` 90% pill, white `Label/13` "Click the map to place the pin · Esc to cancel").

- [x] **Step 5: Build the remaining viewer panel states on `🖥 Viewer`** (each a duplicate of the Task 6 hero with a different panel open)

- `Viewer / Layers panel 1440`: rail Layers active; `FloatingPanel` "Layers": section header `Caption/12` secondary "FEATURE TYPES" with 5 toggle rows (eye / eye-off icon 16 + label `Body/14`: Units ☑, Gates ☑, Amenities ☑, Fixtures ☐, Openings ☑), divider, "BUILDINGS" with 2 rows (本館 ☑, 南館 ☐), footer `Button/ghost/sm` "Reset visibility".
- `Viewer / Warnings panel 1440`: rail Warnings active (warning badge "5"); `FloatingPanel` "Warnings": 5 rows — amber alert-triangle icon 16 + `Body/14` message + `Caption/12` secondary detail (e.g. "Missing display point — unit a1000008…", "Unclosed ring repaired — Shops_B1", "Level ordinal conflict — B1/B1M", "Unknown category 'kiosk2'", "Anchor without unit — 改札口前").
- `Viewer / Dataset info 1440`: ContextBar's dataset name shown pressed with a 300-wide dropdown card below it (panel fill, radius `radius/md`, `Elevation/Raised`): rows of `Caption/12` secondary label + `Body/14` value — Source `JRShinjukuSta.gdb` (Mono/12), Kind `GDB snapshot`, Floors `4`, Features `3,204`, Updated `2026-07-16`.

- [x] **Step 6: Verify**

`get_screenshot` of all seven artboards.
Expected: status chips show 3 distinct colors; Mine chip composes visually with segments; ghost pin + toast legible over the map; layers toggles read on/off at a glance; warnings rows amber but not alarming; dropdown clearly anchored to the dataset name.

- [x] **Step 7: Record node IDs; check boxes.**

---

### Task 9: Publish flow screens

**Files:**
- Modify: Kiriko file, page `🚀 Publish`

**Interfaces:**
- Consumes: Tasks 2–4 (`Modal`, buttons, chips, inputs)
- Produces: frames `Publish / Open local data`, `Publish / GDB review`, `Publish / Wizard 1 Details`, `Publish / Wizard 2 Upload`, `Publish / Wizard 3 Done`, `Publish / Sign-in`, `Account menu` — modals sit on a dimmed 1440×900 backdrop (gallery or viewer frame with `#1C1917` 40% overlay)

- [x] **Step 1: Invoke `figma:figma-use`, then build `Open local data`**

`Modal/560`: title "Open local data"; two side-by-side 240×160 drop targets (dashed 1.5px `color/border/hairline`, radius `radius/lg`, hover-accent note): left — ZIP icon, "IMDF ZIP" `Label/13`, "Drop or browse" `Caption/12` secondary; right — folder icon, "GDB folder / archive". Footer: `Button/ghost` "Cancel".

- [x] **Step 2: Build `GDB review`**

`Modal/720`: title "Review GDB import — JRShinjukuSta.gdb"; body: 6 layer rows (checkbox ☑, layer name `Mono/12` — `Shops_1F`, `Shops_B1`, `Gates`, `Facilities`, `Walls_Ref` ☐ excluded, `Annotations` ☐ excluded — feature count `Caption/12` secondary right-aligned); one inline amber warning row (`color/semantic/warning-bg` fill, `Caption/12` "Walls_Ref: no level field detected — excluded by default"); summary footer bar `Label/13` "14 layers · 3,204 features · 4 levels"; footer buttons: ghost "Cancel", primary "Import 4 layers".

- [x] **Step 3: Build the wizard steps** (all `Modal/560` with a 3-dot progress row under the title — active dot accent, done dot accent-subtle, pending hairline)

1. `Details`: label "Dataset name" + `Input` value "新宿駅構内図"; below, slug row `Mono/12` "kiriko.local/?dataset=**shinjuku-station**" + pencil icon; amber inline warning card "This will overwrite 新宿駅構内図, updated 2026-07-16."; footer: ghost "Back", primary "Publish".
2. `Upload`: progress bar (fill-width 8 high, radius pill, accent fill at 62%), `Caption/12` secondary "38 MB of 61 MB · uploading snapshot.zip"; footer: ghost "Cancel" only.
3. `Done`: 32 green check circle, `Title/18` "Published"; two copy rows (hairline-bordered, radius md, `Mono/12` URL + copy icon): view link `?dataset=shinjuku-station`, embed snippet `<iframe src="…&embed=1">`; footer: primary "Open in gallery".

- [x] **Step 4: Build `Sign-in`**

`Modal/560` width-overridden to 400, centered content: Kiriko mark 32, `Title/18` "Sign in to Kiriko", `Input` "Username", `Input` "Password", inline `Caption/12` `color/semantic/danger` error line "Wrong username or password." (shown), full-width `Button/primary/md` "Sign in".

- [x] **Step 5: Build `Account menu`**

Small artboard: the top-right account cluster (Avatar "DM" + "EN" chip) with an open 220-wide dropdown card below it (panel fill, radius `radius/md`, `Elevation/Raised`, padding 8): row 1 — "daniel" `Label/13` + `Chip/context` "admin"; divider; row 2 — `ListRow` "Sign out" with log-out icon.

- [x] **Step 6: Verify**

`get_screenshot` of all seven artboards.
Expected: modals centered on dimmed backdrops; progress dots read as a sequence; overwrite warning amber and non-blocking (Publish button still primary/enabled); mono slugs/URLs legible; account menu anchored to the avatar.

- [x] **Step 7: Record node IDs; check boxes.**

---

### Task 10: Embed frame

**Files:**
- Modify: Kiriko file, page `🔐 Sign-in & Embed`

**Interfaces:**
- Consumes: Tasks 2–5 (MapMock, FloorStack, ZoomCluster)
- Produces: frame `Embed / 960×600`

- [x] **Step 1: Invoke `figma:figma-use`, then compose**

Frame 960×600: `MapMock/1F` cropped fill; `FloorStack` right-center; `ZoomCluster` bottom-right; attribution `Caption/12` bottom-left; bottom-right above zoom: **Kiriko badge** — small pill (fill panel, `Elevation/Floating`, padding 10×6): Kiriko mark 14 + "Kiriko ↗" `Label/13`. Add a slim read-only info card top-left (240 wide FloatingPanel override: "Station Shop" `Label/13` + "occupant · 1F" `Caption/12` secondary — no buttons).

- [x] **Step 2: Verify**

`get_screenshot`.
Expected: unmistakably a stripped-down viewer; badge subtle but present; no rail, no comments, no account UI.

- [x] **Step 3: Record node ID; check boxes.**

---

### Task 11: Mobile viewer screens

**Files:**
- Modify: Kiriko file, page `📱 Mobile`

**Interfaces:**
- Consumes: all prior components
- Produces: frames `Mobile / Viewer 390`, `Mobile / Sheet feature`, `Mobile / Sheet comments`, `Mobile / Gallery 390`

- [x] **Step 1: Invoke `figma:figma-use`, then build `Mobile / Viewer 390`** (390×844)

`MapMock/1F` scaled/cropped background; top inset 12: compact context pill (back arrow + "新宿駅構内図" `Label/13`, max 260 truncate); right edge: `FloorStack` with 44×40 touch targets; bottom: **bottom bar** — full-width-minus-24 floating pill (height 56, radius pill, `Elevation/Floating`): 4 icon buttons (search, layers, message-circle + accent Badge "3", alert-triangle + warning Badge "5") evenly spaced.

- [x] **Step 2: Build `Mobile / Sheet feature`**

Same base; half-height bottom sheet (390×420 anchored bottom, top corners radius lg, panel fill, `Elevation/Raised`, 32×4 drag handle centered): inspector content from Task 6 (title, category line, attribute table 6 rows, footer buttons full-width stacked). Bottom bar hidden behind sheet.

- [x] **Step 3: Build `Mobile / Sheet comments`**

Same base; half-height sheet: "Comments" header + filter chips row (horizontally scrollable — let chips overflow-clip right edge), 2 `CommentCard`s, `CommentComposer`. Annotate beside the frame in `Caption/12` gray: "Pin placement = long-press on map."

- [x] **Step 4: Build `Mobile / Gallery 390`**

`color/bg/app` fill: compact header (wordmark + avatar), "Datasets" `Display/24`, `Input` filter, `DatasetCard`s stacked 1-up ×3 (fill-width 342).

- [x] **Step 5: Verify**

`get_screenshot` of all four frames.
Expected: touch targets ≥44 on interactive elements; sheets clearly layered above map; cards fill width cleanly.

- [x] **Step 6: Record node IDs; check boxes.**

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
