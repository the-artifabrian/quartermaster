# Design system

Quartermaster should feel like a warm, quiet cookbook that also works as a
kitchen tool. This file holds durable visual rules, not a screen-by-screen
duplicate of the code.

For product voice, see [COPYWRITING.md](./COPYWRITING.md). For product terms,
see [CONTEXT.md](../CONTEXT.md).

## Core rules

- Design phone-first for one-handed use and a phone propped on a counter.
- Use at least 44px touch targets and 16px body text for cooking surfaces.
- Keep content flat on the cream canvas. Use hairline dividers, not a stack of
  cards.
- Elevation belongs to overlays: menus, popovers, sheets, dialogs, and toasts.
- Sage means interactive. Copper marks “now” or the current location. Headings
  stay ink.
- Recipe imagery carries warmth. Shopping, Staples, settings, and Menus stay
  imageless.
- Prefer fewer controls and fewer words. Reveal secondary actions only when
  relevant.

## Type

- **Young Serif**: page titles, Recipe titles, and editorial day headings. It
  has one weight; vary size, not weight.
- **DM Sans**: body text, labels, metadata, navigation, and controls.
- **Caveat**: personal Recipe notes and a few marketing artifacts only. It is
  the user’s voice, not the app’s.

Useful sizes:

| Use                   | Size             |
| --------------------- | ---------------- |
| Page title            | 24px Young Serif |
| Recipe detail title   | 32px Young Serif |
| Recipe row title      | 17px Young Serif |
| Body and ingredients  | 16px DM Sans     |
| UI label              | 14px DM Sans     |
| Caption               | 13px DM Sans     |
| Tiny navigation label | 12px DM Sans     |

Running text uses a 1.5–1.7 line height. Recipe detail is deliberately generous
for arm’s-length reading.

## Color

The light palette is aged paper, ink, cedar, sage, copper, and clay:

| Token            | Value     | Use                                |
| ---------------- | --------- | ---------------------------------- |
| background       | `#F6F1EB` | cream canvas                       |
| card             | `#FDFAF6` | overlays and limited tile surfaces |
| foreground       | `#2D2926` | primary text                       |
| muted foreground | `#6F6358` | secondary text                     |
| border           | `#DED6CA` | hairlines                          |
| primary          | `#4E7A54` | actions and links                  |
| accent           | `#C4956A` | structural “now” markers           |
| destructive      | `#B85C4A` | errors and destructive actions     |

Dark mode uses warm charcoal, smoke, parchment, light sage, and light copper.
The exact semantic tokens live in `app/styles/tailwind.css`.

Raw copper does not meet contrast for small text on cream. Use it for dots,
edges, and fills; use `--copper-text` when copper text is necessary.

## Layout and surfaces

Use an 8px spacing rhythm:

- 8–12px within a small group
- 24–32px between groups
- 48–64px between major sections
- 16px page-top padding in app screens

Common maximum widths:

- Shopping: 480px
- Recipe detail and settings: 880px
- Recipe library and Staples: 1080px
- Marketing content: 960px

Static groups use either a flat divided list or a quiet `bg-muted/40 rounded-lg`
inset with no shadow. Inline controls use at most an 8px radius. Twelve-pixel
radii and warm shadows are for floating layers.

## Navigation

Mobile has four tabs: Recipes, Staples, Plan, and Shop. The active tab uses sage
plus a small copper marker. Sub-pages rely on app navigation instead of adding a
“Back to…” link at the top of every screen.

On desktop, keep the same information hierarchy and give content more width; do
not add extra product destinations just because space exists.

## Imagery

Every Recipe slot shows either its photo or the deterministic warm-gradient
monogram from `recipe-placeholder.ts`.

Typical square thumbnail sizes:

- 64px in Recipe rows
- 56–64px in “Up next”
- 44px in mobile Meal rows
- 36–40px in pickers

Recipe detail may use a full-bleed mobile hero and a side image on desktop.
Thumbnails beside visible titles are decorative (`alt=""`). Shopping, Staples,
Menus, settings, and forms stay text-first; an upload preview is the exception.

Menus are intentionally imageless. Do not restore the old fixed Menu
placeholder.

## Current surface patterns

### Recipes

- Mobile uses flat divided rows; desktop may use bordered image tiles.
- Cards show a thumbnail, title, useful time when known, and favorite state.
- Do not show availability text, match percentages, cook counts, or hidden
  availability ordering.
- Recently Updated is the real default sort.
- Search and visible filters keep the full library easy to reach.

### Recipe detail

- Put the title and optional hero first, then metadata, ingredients, and steps.
- Desktop may keep ingredients sticky beside instructions; mobile stacks them.
- Ingredient and instruction check-off must work across the full row.
- Personal notes use a copper edge and Caveat only when notes exist.
- Staples/Out-aware availability belongs here because it can lead to an
  immediate Shopping action.
- Keep scaling, cooking cues, unit display, and print practical rather than
  decorative.

### Menus

- A Menu reads as ordered sections of Recipe and note rows.
- Use quiet section insets only when several sections need visual grouping.
- Reorder and move controls need labels, keyboard access, and phone-sized
  targets; drag is optional.
- Keep detail readable and editing explicit. No Menu image or cover UI.

### Plan

- Show an ordered list of Meals under each day, not permanent meal-type slots.
- Use serif day headings, a copper marker for today, and flat Meal rows.
- A Meal may be one Recipe, several Recipe items, a Menu snapshot, or plain
  text. Keep the one-Recipe path fast.
- Dense Menu snapshots may need progressive disclosure; do not solve density by
  adding more card chrome.
- Labels and serving times are context, not automatic sort keys.

### Shopping

- Use one centered flat list with large checkboxes and hairline dividers.
- Checked rows fade and strike through; show a simple checked/total count.
- Sort unchecked before checked and alphabetically within each state.
- Do not add aisle/category sections. Categories may remain internal.
- Quick add is inline on desktop and may use a bottom sheet from a mobile FAB.
- Generated and manual demand can share a displayed total, but UI actions must
  make corrections understandable.

### Staples

- Use a compact searchable alphabetical list with direct Add, Out, and Remove
  controls.
- Out must expose clear pressed/state feedback.
- Keep the archived Pantry restore action secondary and explicit.
- No quantities, expiry dates, stock ledger, images, or category sections.

### Empty states and onboarding

Use one short explanation and one clear action. Favor importing an existing
Recipe over a blank form. Use quiet insets or plain muted text, not feature
grids, illustrations, or congratulatory copy.

## Motion and accessibility

- Animate transform and opacity only, usually 150–300ms.
- Respect `prefers-reduced-motion`; behavior must not depend on animation.
- Keep visible focus, semantic landmarks, labelled icon buttons, and reachable
  reorder controls.
- Hover is polish. Every action must work by tap and keyboard.
- Test realistic long Recipe titles, Menu notes, ingredients, and translated or
  custom labels at phone and desktop widths.

## Building a new surface

Start with the nearest existing surface and these defaults:

- one Young Serif page title
- DM Sans 16px body
- flat rows with `divide-border/40`
- a quiet inset only when grouping needs containment
- sage actions, cedar borders, 8px inline radii
- warm-shadow elevation only for overlays
- one primary action and secondary actions hidden until useful

If a new pattern needs a long explanation here, first ask whether it belongs in
the component itself or whether the UI can be simpler.

_Updated 4 September 2026._
