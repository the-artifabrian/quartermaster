# Design system

Quartermaster should feel like a warm, quiet cookbook that also works as a
kitchen tool. This file holds durable visual rules, not a screen-by-screen
duplicate of the code.

For product voice, see [COPYWRITING.md](./COPYWRITING.md). For product terms,
see [GLOSSARY.md](../GLOSSARY.md).

## Core rules

- Design phone-first for one-handed use and a phone propped on a counter.
- Use at least 44px touch targets and 16px body text for cooking surfaces.
- Keep content flat on the cream canvas. Use hairline dividers, not a stack of
  cards.
- Elevation belongs to overlays: menus, popovers, sheets, dialogs, and toasts.
- Sage means interactive. Copper marks “now” and small dots for something new.
  Headings stay ink.
- Recipe imagery carries warmth. Shopping, Staples, settings, and Menus stay
  imageless.
- Prefer fewer controls and fewer words. Reveal secondary actions only when
  relevant.

## Type

- **Young Serif**: page titles, Recipe titles, and editorial day headings. It
  has one weight; vary size, not weight.
- **DM Sans**: body text, labels, metadata, navigation, and controls.
- **Source Sans 3**: the homepage only, as its body sans (`font-humanist`); the
  app never uses it.

All fonts are self-hosted: the files sit in `app/assets/fonts/` and
`app/styles/fonts.css` declares them, so a face downloads only when a page uses
it. `app/root.tsx` preloads the Young Serif and DM Sans latin files. Caveat is
declared (`fonts.css`, and `--font-handwritten` in `app/styles/tailwind.css`),
but no page uses it.

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

### Homepage palette

The marketing homepage sits on its own espresso palette in both themes:
`espresso` (canvas), `espresso-deep` (sunk bands), `espresso-surface` and
`espresso-raised` (mock app screens and their controls), `espresso-line`
(hairlines), `cream` and `cream-muted` (text), `sage` for the primary CTA and
`copper` for at most two highlights such as the “Today” marker. The tokens live
next to the semantic ones in `app/styles/tailwind.css`.

The route sets `data-chrome="espresso"` on the app shell (see `root.tsx`), which
remaps the semantic tokens so the shared header and footer sit on the same
canvas. Keep the homepage to these tokens; do not add page-specific colors.

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
- Marketing content: 960px (the homepage uses the full 1400px `container`)

Static groups use either a flat divided list or a quiet `bg-muted/40 rounded-lg`
inset with no shadow. Inline controls use at most an 8px radius. Twelve-pixel
radii and warm shadows are for floating layers.

## Controls

Use the shared controls in `app/components/ui/` rather than styling a button for
each screen:

- **Button and Input** are 44px tall wherever a finger taps them. A control may
  drop below 44px only under the `desktop:` variant (a wide screen with a fine
  pointer), never by width alone: a phone on its side or an iPad is wide but
  touched. Button `sm` is compact only there.
- **Chip** is the one chip: 44px tall, fully rounded, a hairline border, and a
  sage fill when pressed (`aria-pressed`). Use it for picking days, labels, and
  classification values, and for one-tap suggestions with a leading `+`. A
  control that must stay its own element in a row of chips (a native `<select>`,
  a menu trigger) takes the same look from `chipClassName`.
- **Segmented control** picks one of two or three equal-width options with a
  sage pill that slides under the selection. Use tabs when it switches what the
  page shows, radios when it picks a setting, and `SegmentedLinks` when the
  options are routes.
- **Switch** is an iOS-style track and thumb for an on/off setting; never an
  “On”/“Off” pill.
- Previous and next use chevrons, not arrows.
- **Adding on a tab root** is one control (`TitleAddButton`): a round sage +,
  44px, at the right end of the big serif title's row on Recipes, Staples and
  Plan. Its label says what it adds (“New Recipe”, “Add Staple”, “Add Meal to
  Thursday, Nov 19”). Shopping keeps its floating + instead.

## Sheets and deleting

- A bottom sheet is for anything you type or pick in; a dropdown menu is a short
  list of actions. Every sheet has the same anatomy (`BottomSheet`): a grabber,
  a Young Serif title on the left, a round Close button on the right (a 44px
  target), and an optional one-line description under the title. It covers the
  tab bar over a dim scrim, clears the home indicator, and closes by a pull
  down, the scrim, Escape or Close. Off a phone it is a centered dialog. A
  sheet's primary action is full width at the bottom. It renders on the page
  body, takes focus while open and gives it back after, unless focus has moved
  on in the meantime. A sheet leaves showing what it showed; what was typed or
  picked clears on the next open.
- A phone is below `sm`, or a finger on a screen no taller than 500px (a phone
  on its side). On a phone nothing you type or pick in is a popover or a panel
  that opens in place: Add a Meal, Add a Recipe to a Meal, Edit details, Edit
  item, Scale, From Staples, From Plan, Add to Plan and Link recipe open as
  sheets (`opensAsSheet`, read when they open). Wider screens keep their popover
  or inline panel.
- A Delete in a menu or behind a swipe is red from the start. Shopping and
  Staples rows swipe left to show theirs; the swipe locks to one axis, so a
  vertical drag still scrolls. A Staple row with a mouse shows a trash button
  instead; with a keyboard or VoiceOver its Delete is the next stop after Add,
  and the row slides open while it has focus.
- A delete that can be undone (a Meal, a Recipe in a Meal, a Shopping item,
  Clear checked, deleting a Staple) happens at once with an Undo toast at the
  bottom, above the tab bar; every other toast stays at the top. A deleted row,
  Staple or Meal closes its gap and Undo opens it again; Clear checked goes at
  once. The delete is saved at once and Undo puts back what it removed. Opening
  a sheet closes the Undo toast, so it never sits over a sheet.
- A delete that cannot be undone (Recipe, Menu, account, passkey, removing a
  member, leaving the Household, disabling 2FA) opens a confirm sheet
  (`ConfirmSheet`): the question as the title, one line on what is lost, a
  full-width red button, and Cancel under it, which has focus. Leaving an edit
  screen with changes asks the same way: “Discard changes?”, a red Discard
  Changes, and Keep Editing in Cancel's place.

## Navigation

The header, the status bar strip in the iOS app and the tab bar are opaque
(`bg-card`) with no blur.

Mobile has four tabs: Recipes, Staples, Plan, and Shopping. The active tab uses
sage text and a medium-weight label. A small copper dot on the Shopping icon
appears when Shopping changes anywhere other than the open Shopping page
(another member, another device, or an add from Recipes, Staples or Plan), and
clears when you open Shopping.

Tab roots (Recipes, Menus, Staples, Plan, Shopping) keep the brand header.
Pushed pages (Recipe detail, edit, new and Import; Menu detail, edit and new;
Settings and its pages; Upgrade) swap it on phones for a nav bar pinned at the
top, under the status bar in the iOS app: a sage `‹ Parent` back button on the
left, and a small centered title that fades in (150ms opacity, instant with
reduced motion) once the page's big serif h1 has scrolled under the bar. The
page declares its parent in its route `handle` (`nav`, rules in
`app/utils/nav-back.ts`). Back undoes the last move: it pops history to the page
that opened this one — the parent, a Recipe's Menu, a linked Recipe, or another
tab (the Plan behind tonight's Recipe, labelled “‹ Plan”) — stepping over the
form that led there. A page the tab bar restored goes back down its own stack,
past the other tabs. With nothing to return to (a deep link, a cold start) Back
opens the parent in the page's place. Settings and Upgrade go back to whatever
page opened them. Pages do not add their own “Back to…”, arrow or Cancel links.

Edit screens (Recipe edit and new, Menu edit and new) put Cancel on the left of
the bar and Save on the right (sage, semibold, dimmed while disabled, a spinner
while saving), shown only while the form is on screen. The form has no Save bar
of its own, and Return in its fields does not save (a Recipe's or a new Menu's
title still does); Delete stays at the end of the form. Each pushed page has
exactly one h1, its big title. Toasts open below the bar.

Edit screens hide the tab bar, as an iOS edit screen does, from the server's
first paint (Import keeps it). Cancel and Save are the ways out, and anything
that sits above the tab bar elsewhere sits above the home indicator here.
Leaving with changes by Cancel, the edge swipe or a link asks first; a form
nobody changed never asks. A Save that finds errors shows each one at what it is
about (a row's under the row, a list's under its section heading), scrolls the
first into view below the bar, opening its section, and focuses it. A saved edit
screen leaves as if dismissed: it pops back to the page that opened it, a new
Recipe or Menu takes its form's place, and a Delete lands on the list with none
of the deleted item's pages directly behind it. Going back to a Recipe or Menu
that is gone or has left the Household, from anywhere in the history (a page the
browser kept is loaded again), opens its list in that entry's place; a link to
one still says it is not found. A Save that cannot go through (offline, a linked
sub-Recipe deleted meanwhile) keeps the form and its edits and says why. A
reload or a closed tab with changes asks the browser first (not in the iOS app,
whose web view shows no prompt).

On desktop, keep the same information hierarchy and give content more width; do
not add extra product destinations just because space exists. The desktop header
keeps its brand row and links on pushed pages, with the nav bar as a second row
under it, since there is no tab bar.

## Imagery

A Recipe thumbnail shows either its photo or the deterministic warm-gradient
monogram from `recipe-placeholder.ts`. Plan Meal rows are text-only on purpose
and show no thumbnail (#178).

Typical square thumbnail sizes:

- 64px in Recipe rows
- 56–64px in “Up next”
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
- Personal notes render only when they exist: a quiet tinted block in the body
  sans, collapsed to a few lines with a Show more toggle. No copper edge and no
  handwriting on the detail page.
- Every ingredient row offers a direct Shopping action; the page never claims to
  know what the household has.
- Keep scaling, cooking cues, unit display, and print practical rather than
  decorative.

### Menus

- A Menu reads as ordered sections of Recipe and note rows.
- A named section is a Young Serif heading over a hairline rule; on phones its
  rows are flat and divided, and 1× stays implicit on Recipe rows.
- Use quiet section insets only when several sections need visual grouping.
- Reorder and move controls need labels, keyboard access, and phone-sized
  targets; drag is optional.
- Keep detail readable and editing explicit. No Menu image or cover UI.

### Plan

- Show an ordered list of Meals under each day, not permanent meal-type slots.
- Use serif day headings, a copper marker for today, and flat Meal rows: no card
  border, fill or shadow. A full-width hairline separates Meals; inside a Meal,
  Recipes are separated by a lighter hairline inset past the cooked toggle.
- A Meal may be one Recipe, several Recipe items, a Menu snapshot, or plain
  text. Keep the one-Recipe path fast.
- Dense Menu snapshots may need progressive disclosure; do not solve density by
  adding more card chrome.
- Labels and serving times are context, not automatic sort keys.
- On a phone the title's + adds a Meal to the day showing, in the Add a Meal
  sheet; the day itself has no Add Meal button. The desktop agenda keeps an Add
  Meal in each day.
- On a phone a Recipe's title link and its scale field share one line, the field
  trailing, so each is a 44px target without the row growing.

### Shopping

- Use one centered flat list with large checkboxes and hairline dividers.
- Checked rows fade and strike through; show a simple checked/total count.
- Sort unchecked before checked and alphabetically within each state.
- Do not add aisle/category sections. Categories may remain internal.
- Quick add is inline on desktop and may use a bottom sheet from a mobile FAB.
- Generated and manual demand can share a displayed total, but UI actions must
  make corrections understandable.

### Staples

- Use one compact searchable alphabetical list; no grouping. Each row has an Add
  to Shopping button, and is deleted by a swipe left (a trash button with a
  mouse). The + beside the title adds a Staple. The button's spoken name starts
  with its visible words and then names the Staple (“Add to Shopping, Salt”), so
  Voice Control can tap it by what it shows; Delete is “Delete Salt” and its
  toast “Deleted Salt”.
- Each row carries its own Add control, its own state and its own errors. A
  shopper is usually scrolled somewhere down a long list, so a banner at the top
  of the page is a message they will never see.
- A Staple already waiting in Next shop reads “On list” in place of Add to
  Shopping. Keep the control focusable and the row where it was; repeat the
  result in a visually hidden live region for a screen reader.
- No availability state, quantities, expiry dates, stock ledger, images, or
  category sections.

### Empty states and onboarding

Use one short explanation and one clear action. Favor importing an existing
Recipe over a blank form. Use quiet insets or plain muted text, not feature
grids, illustrations, or congratulatory copy.

## Motion and accessibility

- Animate transform and opacity only, usually 150–300ms. A switch track and a
  selected label may change color as their thumb or pill moves. The one change
  of size is a deleted row closing its gap (`RowCollapse`): height and opacity
  together, 200ms `--ease-exit`, and opacity only under reduced motion.
- Respect `prefers-reduced-motion`; behavior must not depend on animation.
- Keep visible focus, semantic landmarks, labelled icon buttons, and reachable
  reorder controls.
- Hover is polish. Every action must work by tap and keyboard. Tooltips are for
  a mouse: they never open on a touch screen or in the iOS app.
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

_Updated 18 November 2026._
