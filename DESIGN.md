---
name: Kiriko
description: Calm, precise viewer-and-review workspace for indoor GIS datasets (IMDF / GDB)
colors:
  ai-indigo: "#4F46E5"
  indigo-deep: "#4338CA"
  indigo-mist: "#EEF2FF"
  sumi-ink: "#1C1917"
  stone-gray: "#78716C"
  washi-white: "#FAFAF9"
  panel-white: "#FFFFFF"
  hairline: "#E7E5E4"
  chip-stone: "#F5F5F4"
  status-in-review: "#D97706"
  warning-bg: "#FEF3C7"
  danger: "#DC2626"
  success: "#16A34A"
typography:
  display:
    fontFamily: "Inter, 'Noto Sans JP', sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: "32px"
    letterSpacing: "0"
  title:
    fontFamily: "Inter, 'Noto Sans JP', sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "26px"
    letterSpacing: "0"
  body:
    fontFamily: "Inter, 'Noto Sans JP', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
    letterSpacing: "0"
  label:
    fontFamily: "Inter, 'Noto Sans JP', sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "18px"
    letterSpacing: "0"
  caption:
    fontFamily: "Inter, 'Noto Sans JP', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
    letterSpacing: "0"
  mono:
    fontFamily: "'IBM Plex Mono', monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "18px"
    letterSpacing: "0"
rounded:
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
components:
  button-primary:
    backgroundColor: "{colors.ai-indigo}"
    textColor: "{colors.panel-white}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.indigo-deep}"
  button-primary-sm:
    padding: "6px 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.sumi-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-destructive:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.panel-white}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.sumi-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 12px"
  chip:
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  floating-panel:
    backgroundColor: "{colors.panel-white}"
    rounded: "{rounded.lg}"
    padding: "16px"
    width: "320px"
---

# Design System: Kiriko

## 1. Overview

**Creative North Star: "The Cut Glass"**

Kiriko (切子) is named for Edo Kiriko cut glass, and the interface behaves like it: a precise, calm craft object where clarity is the whole point. Surfaces are quiet — warm stone neutrals under crisp white panels — and every line is a deliberate facet: 1px hairline borders, exact attribute tables, small confident labels. Light passes through, it doesn't bounce around; the one saturated color, a deep ai (藍) indigo, appears the way indigo appears in the glass — sparingly, and always meaning something.

The map is the product. UI chrome floats above the map canvas on structural shadows and otherwise stays out of the way; density lives in the data (attributes, warnings, comments), never in the chrome. This system explicitly rejects the desktop-GIS look (toolbar forests, dockable panel mazes), the generic SaaS dashboard (stat cards, gradient heroes), and heavy-enterprise weight (deep nav trees, slow modals). A non-GIS reviewer should feel none of those things when they open a link.

**Key Characteristics:**
- Warm stone neutrals; white panels; a single indigo voice
- Hairline precision: 1px borders, exact values, small type
- Panels float over the map on two structural shadow levels
- Japanese and English typeset as peers (Inter + Noto Sans JP)
- Data values in mono; chrome recedes, data leads

## 2. Colors

A warm-neutral field with one indigo voice: quiet stone grays carry the interface, indigo carries meaning.

### Primary
- **Ai Indigo** (#4F46E5): the single accent. Primary buttons, focused inputs, selected chips and rows, the active floor, selection outlines on the map, and the "open" comment status. If it's indigo, it's interactive or selected.
- **Indigo Deep** (#4338CA): hover state of Ai Indigo. Nothing else.
- **Indigo Mist** (#EEF2FF): selected-state fills — selected filter chips, selected list rows, selected map units. Always paired with Ai Indigo text or border.

### Neutral
- **Sumi Ink** (#1C1917): primary text. Near-black with warmth, never pure black.
- **Stone Gray** (#78716C): secondary text — captions, metadata, placeholders, and the "closed" status. On white this is 4.7:1; do not lighten it further.
- **Washi White** (#FAFAF9): the app background behind panels and around the map canvas.
- **Panel White** (#FFFFFF): floating panels, modals, cards, inputs.
- **Hairline** (#E7E5E4): every border and divider, always 1px.
- **Chip Stone** (#F5F5F4): context-chip fill and other faint neutral fills.

### Tertiary (status & semantic)
- **Amber** (#D97706): "in review" comment status and validation warnings; pale amber (#FEF3C7) as warning-row background.
- **Danger Red** (#DC2626): destructive buttons and errors only.
- **Success Green** (#16A34A): publish confirmation and success states only.

Map data fills (unit categories, walkways, openings) are a separate muted layer palette defined in the viewer theme; they sit visually beneath everything above and must never compete with Ai Indigo selection.

### Named Rules
**The One Indigo Rule.** Ai Indigo is the only voice in the room — it marks interaction and selection and covers well under 10% of any screen. If indigo appears on something that can't be clicked or isn't selected, it's wrong.

**The Hairline Rule.** Borders are 1px Hairline (#E7E5E4), full-perimeter, or absent. No 2px borders (except the focused input's Ai Indigo ring), no colored side-stripes, no double borders.

## 3. Typography

**UI Font:** Inter (with Noto Sans JP for Japanese, system sans fallback)
**Data Font:** IBM Plex Mono

**Character:** Small, exact, unhurried. A six-step scale topping out at 24px — the interface never shouts. Japanese and English are set as peers: line-heights are chosen to hold CJK glyphs (never below 1.35), and mixed-script strings are the design case, not the edge case.

### Hierarchy
- **Display** (700, 24/32px): page titles only — "Datasets", the sign-in card. One per screen at most.
- **Title** (600, 18/26px): panel headers, modal headers, card titles, feature names.
- **Body** (400, 14/20px): default text — list rows, comment bodies, form values.
- **Label** (500, 13/18px): buttons, chips, tabs, attribute keys. The workhorse of the chrome.
- **Caption** (400, 12/16px): metadata, timestamps, section headers like RESULTS, attributions. Stone Gray.
- **Mono** (400, 12/18px, IBM Plex Mono): data values — attribute values, IDs, file names, coordinates, counts. If a human didn't write it, it's mono.

### Named Rules
**The Mono Data Rule.** Machine values (SHP-1042, JRShinjukuSta.gdb, 42.5, hex IDs) are always IBM Plex Mono. Prose is never mono. The split is what makes attribute tables scannable.

## 4. Elevation

Shadows are structural, not decorative: a shadow means "this floats above the map." Exactly two levels exist. Everything that doesn't float — cards in the gallery, list rows, inputs, attribute tables — is flat, separated by Hairline borders or background shifts.

### Shadow Vocabulary
- **Floating** (`box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08)`): panels floating over the map — Search, Layers, Comments, Warnings, Inspector, map control clusters, dropdowns.
- **Raised** (`box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12)`): modals and the mobile bottom sheet — the top layer, always with a dim overlay behind it.

### Named Rules
**The Float Rule.** Shadow = layer above the map, nothing else. If an element sits in the page flow, it gets a hairline border, not a shadow. Two shadows exist; there is no third.

## 5. Components

Refined and restrained: small type, tight padding, quiet ghosts. Controls recede so data can lead.

### Buttons
- **Shape:** gently rounded (8px), Label type (13/18 medium), no uppercase.
- **Primary:** Ai Indigo fill, white text, 8px 16px padding (md) / 6px 12px (sm). Hover: Indigo Deep. One primary per view.
- **Ghost:** transparent with 1px Hairline border, Sumi Ink text. The default for everything that isn't the one primary action.
- **Destructive:** Danger Red fill, white text. Confirmation contexts only.
- **Focus:** visible focus ring on all variants (keyboard operability is a WCAG AA commitment).

### Chips
- **Shape:** pill (999px), 4px 10px padding, Label type.
- **Filter:** Hairline border, Stone Gray text; selected: Indigo Mist fill + Ai Indigo border and text.
- **Status:** Hairline border, Sumi Ink text, leading 6px dot — indigo (open), amber (in review); closed swaps the dot for a ✓ with Stone Gray text.
- **Context:** Chip Stone fill, no border, optional 12px leading icon (floor badges, language toggle).

### Cards / Containers
- **FloatingPanel:** 320px wide, Panel White, 12px radius, 16px padding, Floating shadow. Header = Title + 20px trailing icon. The container for Search, Layers, Comments, Warnings; Inspector overrides width to 340px.
- **Modal:** Panel White, 12px radius, 24px padding, Raised shadow, 560px or 720px wide, over a dim overlay. Footer actions right-aligned: ghost Cancel, primary Confirm.
- **DatasetCard:** 368×288, Panel White, 12px radius, hairline border, flat at rest; hover lifts to Floating shadow. Floor-plan thumbnail, Title, kind chip, mono metadata line.
- **ListRow:** 58px, flat; hover: Chip Stone fill; selected: Indigo Mist fill. Title in Body, metadata in Caption.

### Inputs / Fields
- **Style:** 36px tall, Panel White, 1px Hairline border, 8px radius, 12px side padding, optional leading 16px icon.
- **Placeholder:** Stone Gray, Body type.
- **Focus:** border becomes 2px Ai Indigo — the only sanctioned 2px border.

### Navigation
- **ContextBar** (top-left, floating): back arrow, Kiriko mark, dataset name · floor. The only wayfinding on the viewer.
- **IconRail** (left edge, floating): 48px-wide vertical rail of 40px icon buttons (Search, Layers, Comments, Warnings) with count badges; active state = Indigo Mist fill + Ai Indigo icon.
- **Gallery header:** flat 64px bar — mark + wordmark left, avatar + language chip right. No nav tree.
- **Mobile:** rail becomes a floating bottom bar of 44px touch targets; panels become Raised bottom sheets with a drag handle.

### Map Controls (signature)
Floating clusters on the map's right edge: **FloorStack** (48px-wide stack of floor buttons, active floor = Ai Indigo fill with white text) and **ZoomCluster** (44px-wide +/− and locate). Comment pins are numbered indigo teardrops; amber when in review. These clusters are the most Kiriko-specific components — keep them small, white, and Floating-shadowed.

## 6. Do's and Don'ts

### Do:
- **Do** keep Ai Indigo under 10% of any screen — it marks interaction and selection only (The One Indigo Rule).
- **Do** use 1px Hairline (#E7E5E4) full-perimeter borders for all in-flow separation; reserve shadows for elements floating above the map (The Float Rule).
- **Do** set machine values — IDs, file names, numbers — in IBM Plex Mono (The Mono Data Rule).
- **Do** test every label and layout with Japanese and English strings; line-height ≥ 1.35 everywhere CJK can appear.
- **Do** keep body/secondary text at AA contrast: Sumi Ink or Stone Gray on white, nothing lighter.
- **Do** give every interactive element a visible focus state and a 44px touch target on mobile.

### Don't:
- **Don't** drift toward desktop GIS: no toolbar forests, no dockable panel mazes, no settings-dense chrome. One floating panel open per side, ever.
- **Don't** build the generic SaaS dashboard: no stat cards, no gradient heroes, no marketing chrome inside the product.
- **Don't** import heavy-enterprise weight (the ACC feel): no deep nav trees, no multi-level breadcrumbs, no permission bureaucracy in the UI.
- **Don't** add a third shadow, a colored side-stripe border, gradient text, or glassmorphism. None of these exist in this system.
- **Don't** let map-layer colors compete with Ai Indigo — selection must always be the most saturated thing on the canvas.
- **Don't** exceed 24px type anywhere in the app UI. The interface never shouts.
