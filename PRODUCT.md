# Product

## Register

product

## Users

Public visitors navigating stations, retail venues, campuses, and other indoor environments, often through a viewer embedded in a venue or operator website. Venue teams also need to publish the viewer without exposing IMDF implementation or validation details.

## Product Purpose

Provide a fast, map-first way to find places and facilities, understand the current floor, and inspect useful visitor information without persistent application chrome competing with the map. Success means visitors can search, filter, select, and understand a destination in either a standalone viewer or a constrained embed.

## Brand Personality

Host-brand neutral, legible, unobtrusive. The viewer should feel familiar and trustworthy while allowing the embedding website’s theme and venue content to carry the identity.

## Anti-references

- Admin-dashboard chrome, dense metadata panels, and validation-tool language
- Consumer-map clutter, promoted content, excessive pins, and stacked cards
- Decorative glassmorphism, weak contrast, and motion without state meaning
- Rigid viewer branding that competes with the host website

## Design Principles

- Keep the map primary; reveal controls and information only when needed.
- Use one predictable interaction and category model across search, filters, and markers.
- Show visitor-relevant information; retain technical diagnostics outside the customer interface.
- Degrade gracefully when optional enrichment is missing or invalid.
- Stay neutral and themeable so the viewer belongs inside its host context.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Support complete keyboard operation, screen-reader semantics, visible focus, reduced motion, AA contrast, non-color-only state communication, and responsive interactions that remain usable in constrained embeds.
