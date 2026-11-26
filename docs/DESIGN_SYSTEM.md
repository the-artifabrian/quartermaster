# Design system

Quartermaster should feel like a warm, quiet cookbook that also works as a
kitchen tool. This file holds durable visual rules, not a screen-by-screen
duplicate of the code.

For product voice, see [COPYWRITING.md](./COPYWRITING.md). For product terms,
see [GLOSSARY.md](../GLOSSARY.md).

## Core rules

- Design phone-first for one-handed use and a phone propped on a counter.
- Use at least 44px touch targets and 16px body text for cooking surfaces.
- Keep content flat on the near-white page. Use hairline dividers, not a stack
  of cards.
- Elevation belongs to overlays: menus, popovers, sheets, dialogs, and toasts.
- Green means interactive. It also marks today and now, and the small dots for
  something new. Headings stay ink.
- Recipe imagery carries warmth. Shopping, Staples, settings, and Menus stay
  imageless.
- Prefer fewer controls and fewer words. Reveal secondary actions only when
  relevant.

## Type

- **Newsreader** for anything you read or cook from: page and tab titles, Recipe
  and item names, section and day headings. Titles and names are weight 500,
  which `font-serif` sets on its own (`app/styles/tailwind.css`), so a serif
  title takes no weight class. Running text is 400 and amounts 600. The files
  carry weights 400 to 600 only, so never ask the serif for less or more. The
  roman has an optical-size axis the browser sets from the font size; the italic
  has none. The serif sets lining figures, and `tabular-nums` adds to them.
- **Schibsted Grotesk** for controls, labels, metadata, navigation and secondary
  text, weights 400 to 700. It has no italic file, so the app does not set the
  sans in italic.
- **Young Serif, DM Sans and Source Sans 3**: the homepage only (see Homepage
  palette). Source Sans 3 is its body sans (`font-humanist`).

All fonts are self-hosted: the files sit in `app/assets/fonts/` as `latin` and
`latin-ext` subsets (the Households write Romanian), and `app/styles/fonts.css`
declares them, so a face downloads only when a page uses it. `app/root.tsx`
preloads the two latin files the page sets first: Newsreader and Schibsted
Grotesk on app pages, Young Serif and DM Sans on the homepage.

Headings balance their lines (`text-wrap: balance` in
`app/styles/tailwind.css`). Long reading text, such as a Recipe's description,
steps and notes, uses `text-pretty` so a paragraph doesn't end on a single word.
Browsers without it wrap as usual.

Useful sizes:

| Use                                | Size                                         |
| ---------------------------------- | -------------------------------------------- |
| Tab title (`TabTitle`)             | 40px Newsreader, 1.05 lines                  |
| Plan's day heading on a phone      | 31px Newsreader                              |
| Other page title                   | 24px Newsreader                              |
| Recipe detail title                | 32px Newsreader                              |
| Plan dish on a phone (`text-dish`) | 22px Newsreader, 26px under a Dinner's photo |
| Recipe row title                   | 17px Newsreader                              |
| Body and ingredients               | 16px Schibsted Grotesk                       |
| UI label                           | 14px Schibsted Grotesk                       |
| Small label (`text-label`)         | 13.5px Schibsted Grotesk, weight 600         |
| Caption                            | 13px Schibsted Grotesk                       |
| Tiny navigation label              | 12px Schibsted Grotesk                       |

The Plan dish sizes (`text-dish`, `text-dish-photo`) and `text-label` are font
size tokens in `app/styles/tailwind.css`, each set once.

A small label (a Meal's label, the weekday in Plan's strip and over its day, the
groups of a picker) is sentence case at weight 600 with no tracking:
`text-label font-semibold`. Other screens set theirs uppercase and letter-spaced
(`sectionLabelClass`).

Every tab's own page (Recipes, Menus, Staples, Plan, Shopping, Settings) opens
with its title in `TabTitle`, beside the controls of its row.

Running text uses a 1.5–1.7 line height. Recipe detail is deliberately generous
for arm’s-length reading.

## Color

Near-white paper, ink, and one bottle green:

| Token                             | Light     | Dark      | Use                                   |
| --------------------------------- | --------- | --------- | ------------------------------------- |
| background                        | `#FBFBF8` | `#151513` | the page                              |
| card (and popover)                | `#FFFFFF` | `#1E1E1B` | sheets, menus, the header and tab bar |
| foreground                        | `#1A1915` | `#EFEDE6` | text                                  |
| muted foreground                  | `#69665E` | `#A5A299` | secondary text                        |
| faint                             | `#76736B` | `#8F8C84` | checked and cooked rows               |
| border (and input)                | `#E3E1D9` | `#2F2E2A` | hairlines                             |
| control edge                      | `#8A867D` | `#77746C` | empty check circles and boxes         |
| muted (and secondary)             | `#F1F0EA` | `#242421` | fields, quiet buttons, pressed rows   |
| primary                           | `#1F5A3D` | `#8CC9A4` | green text: links, icons, today       |
| primary fill                      | `#1F5A3D` | `#2C7551` | buttons and filled circles            |
| primary tint                      | `#E6EFE8` | `#1D2B23` | selected chips, a row just added      |
| destructive                       | `#B3261E` | `#B3261E` | red button fills                      |
| foreground-destructive (red text) | `#A8281F` | `#F0A198` | errors, Delete labels, bad input      |

Green comes in two: `text-primary` for green text and icons, and
`bg-primary-fill` for anything filled, always with white text
(`text-primary-foreground`) on it. In light mode they are the same green; dark
mode needs a lighter green for text than a fill can take under white text. A
small dot or a marker bar is drawn like an icon, in `bg-primary`. Selected and
just-added states take `bg-primary-tint`, with ink or green text.

Faint text clears 4.5:1 on the page and on cards, not on `muted` or the tint, so
keep it off those.

Red text on the page (`text-foreground-destructive`, and `--input-invalid` for
an invalid field's border) is a shade darker than the red button fill so small
text clears 4.5:1 on the page and on cards. A boxed error sits on the faint
`bg-destructive/5` tint. `text-destructive` is the fill color, so keep it off
text. Red buttons take white text in both themes.

Shadows are neutral and belong to floating layers. The tokens live in
`app/styles/tailwind.css`.

### Homepage palette

The marketing homepage sits on its own espresso palette in both themes:
`espresso` (canvas), `espresso-deep` (sunk bands), `espresso-surface` and
`espresso-raised` (mock app screens and their controls), `espresso-line`
(hairlines), `cream` and `cream-muted` (text), `sage` for the primary CTA and
`copper` for at most two highlights such as the “Today” marker. The tokens live
next to the semantic ones in `app/styles/tailwind.css`.

The route sets `data-chrome="espresso"` on the app shell (see `root.tsx`), which
remaps the semantic tokens so the shared header and footer sit on the same
canvas, and keeps its warm shadows. It also keeps Young Serif and DM Sans: the
font variables are remapped on `<html>` whenever the page holds that shell, so
nothing on it, the skip link included, loads the app's faces. A token or face
added for the app gets a remap in those two rules. Keep the homepage to these
tokens; do not add page-specific colors.

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

Rows line up on the page's edges. What leads a row (a checkbox, a cooked circle,
a step number, a small label, the first icon of a row of icons) starts on the
content edge, and the dots, trash and cart glyphs that end a row end on it. A
44px tap area reaches into the page gutter with a negative margin rather than
pushing its glyph in. Inside a row, titles share one edge past the leading
glyph, and a heading's chevron trails the heading. A page title has no rule
under it.

Plan's day on a phone puts its cooked circles at the other end: each dish row
starts with the dish name on the content edge and ends with the circle, its
glyph on the right content edge. A dish name is a link to its Recipe and the row
does not check off, so the name leads, as a Recipe's title does in its list, and
the circle sits under the thumb. Shopping's whole row checks, so its circle
leads.

Static groups use either a flat divided list or a quiet `bg-muted/40 rounded-lg`
inset with no shadow. Inline controls use at most an 8px radius. Twelve-pixel
radii and shadows are for floating layers.

## Controls

Use the shared controls in `app/components/ui/` rather than styling a button for
each screen:

- **Button and Input** are 44px tall wherever a finger taps them. A control may
  drop below 44px only under the `desktop:` variant (a wide screen with a fine
  pointer), never by width alone: a phone on its side or an iPad is wide but
  touched. Button `sm` is compact only there.
- **Chip** is the one chip: 44px tall, fully rounded, a hairline border, and a
  green fill when pressed (`aria-pressed`). Use it for picking days, labels, and
  classification values, and for one-tap suggestions with a leading `+`. A
  control that must stay its own element in a row of chips (a native `<select>`,
  a menu trigger) takes the same look from `chipClassName`.
- **Segmented control** picks one of two or three equal-width options with a
  green pill that slides under the selection. Use tabs when it switches what the
  page shows, radios when it picks a setting, and `SegmentedLinks` when the
  options are routes.
- **Switch** is an iOS-style track and thumb for an on/off setting; never an
  “On”/“Off” pill.
- Previous and next use chevrons, not arrows.
- **Adding on a tab root** is one control (`TitleAddButton`): a round green +,
  44px, at the right end of the big serif title's row on Recipes, Menus, Staples
  and Plan. Its label says what it adds (“New Recipe”, “New Menu”, “Add Staple”,
  “Add Meal to Thursday, Nov 19”). Shopping adds from its floating “Add an item”
  pill instead (see Shopping).

## Sheets and deleting

- A bottom sheet is for anything you type or pick in; a dropdown menu is a short
  list of actions. Every sheet has the same anatomy (`BottomSheet`): a grabber,
  a Newsreader title on the left, a round Close button on the right (a 44px
  target), and an optional one-line description under the title. It covers the
  tab bar over a dim scrim, clears the home indicator, and closes by a pull
  down, the scrim, Escape or Close. Off a phone it is a centered dialog. A
  sheet's primary action is full width at the bottom. It renders on the page
  body, takes focus while open and gives it back after, unless focus has moved
  on in the meantime. A sheet leaves showing what it showed; what was typed or
  picked clears on the next open.
- A phone is below `sm`, or a finger on a screen no taller than 500px (a phone
  on its side). On a phone nothing you type or pick in is a popover or a panel
  that opens in place: Add Meal, Add a Recipe to a Meal, Edit details, Edit
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

The header, the nav bar, the status bar strip in the iOS app and the tab bar are
opaque with no blur.

Mobile has five tabs: Recipes, Staples, Plan, Shopping and Settings. Their order
lives in `navItems` (`app/components/bottom-nav.tsx`) alone. Settings is drawn
as the user's initial in a 24px ring, filled when it is the tab showing. The
active tab uses green text and a medium-weight label. A small green dot on the
Shopping icon appears when Shopping changes anywhere other than the open
Shopping page (another member, another device, or an add from Recipes, Staples
or Plan), and clears when you open Shopping. Each tab remembers the last page it
showed, and a tap on the tab showing goes back to its own page.

On a phone a tab's own page (Recipes, Menus, Staples, Plan, Shopping, Settings)
has no brand row: its title is the top of the page, and in the iOS app the
status bar strip takes the page's color. A demo visitor's banner keeps its own
row above the title. A signed-in page of no tab (Support, a page not found)
keeps the brand row without the avatar, since Settings is a tab. Signed out, the
brand row keeps the logo and Log in or Sign up.

Pushed pages (Recipe detail, edit, new and Import; Menu detail, edit and new;
Settings' pages; Upgrade) show a nav bar pinned at the top on phones, under the
status bar in the iOS app: a green `‹ Parent` back button on the left, and a
small centered title that fades in (150ms opacity, instant with reduced motion)
once the page's big serif h1 has scrolled under the bar. The page declares its
parent in its route `handle` (`nav`, rules in `app/utils/nav-back.ts`); a tab's
own page inside a layout that declares one (Settings) declares `nav: null`. Back
undoes the last move: it pops history to the page that opened this one, stepping
over the form that led there. That page can be the parent, a Recipe's Menu, a
linked Recipe, or another tab (the Plan behind tonight's Recipe, labelled “‹
Plan”). A page the tab bar restored goes back down its own stack, past the other
tabs. With nothing to return to (a deep link, a cold start) Back opens the
parent in the page's place. Settings' pages go back to Settings, or to another
tab's page that opened one directly, and Upgrade to whatever page opened it.
Pages do not add their own “Back to…”, arrow or Cancel links.

Edit screens (Recipe edit and new, Menu edit and new) put Cancel on the left of
the bar and Save on the right (green, semibold, dimmed while disabled, a spinner
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

In the iOS app every push into a pushed page slides in from the right (320ms,
the old page receding a quarter), and Back, Cancel and an edit screen's leave
after Save or Delete slide back; tab switches and the system's edge swipe add
none, and reduced motion turns it off. A link to a pushed page is a `PushLink`
(`app/components/push-link.tsx`); a plain `Link` there opens without the slide.
Outside the app pushes do not slide (the Recipe and Menu cards cross-fade).

On desktop, keep the same information hierarchy and give content more width; do
not add extra product destinations just because space exists. The desktop header
keeps its brand row, its links and the avatar that opens Settings on every page.
Its links and the browser's Back do the nav bar's job there, so on a desktop
(wide, with a mouse: the `desktop:` variant) only an edit screen keeps the nav
bar, as a second row under the header, for Cancel and Save. A sideways phone is
as wide but has no browser Back, so it keeps the bar on every pushed page.

## Imagery

A Recipe thumbnail shows either its photo or the deterministic warm-gradient
monogram from `recipe-placeholder.ts`. On a phone, a Dinner on Plan shows its
first Recipe's photo full width, 152px tall, above its dishes, and the Plan
picker puts a Recipe's photo at the end of its row and shows none for a Recipe
without one. Other Meals, and the desktop agenda, are text only.

Typical square thumbnail sizes:

- 64px in Recipe rows
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
- Recently updated is the real default sort.
- Search and visible filters keep the full library easy to reach.

### Recipe detail

- Put the title and optional hero first, then metadata, ingredients, and steps.
- Desktop may keep ingredients sticky beside instructions; mobile stacks them.
- Ingredient and instruction check-off must work across the full row.
- Personal notes render only when they exist: a quiet tinted block in the body
  sans, collapsed to a few lines with a Show more toggle. No colored edge and no
  handwriting on the detail page.
- Every ingredient row offers a direct Shopping action; the page never claims to
  know what the household has.
- Keep scaling, cooking cues, unit display, and print practical rather than
  decorative.

### Menus

- A Menu reads as ordered sections of Recipe and note rows.
- A named section is a Newsreader heading over a hairline rule; on phones its
  rows are flat and divided, and 1× stays implicit on Recipe rows.
- Use quiet section insets only when several sections need visual grouping.
- Reorder and move controls need labels, keyboard access, and phone-sized
  targets; drag is optional.
- Keep detail readable and editing explicit. No Menu image or cover UI.

### Plan

- Show an ordered list of Meals under each day, not permanent meal-type slots.
- Use serif day headings, a green marker for today, and flat Meal rows: no card
  border, fill or shadow.
- A Meal may be one Recipe, several Recipe items, a Menu snapshot, or plain
  text. Keep the one-Recipe path fast.
- Dense Menu snapshots may need progressive disclosure; do not solve density by
  adding more card chrome.
- Labels and serving times are context, not automatic sort keys.
- A Recipe row's scale field is a quiet fill with the × inside, muted at 1×; the
  fields of a day form one column.

On a phone Plan shows one day at a time:

- The title, the week's chevrons around its range, and the round + share one
  row, with the date strip under it. Both stay pinned under the status bar,
  opaque, with a hairline under the strip. A range too long for the row breaks
  after its dash. On another week, "This week" heads the day under the strip.
- The strip shows each date as a 38px circle under its weekday. The day showing
  is a green fill with white text; today, when another day shows, is green text
  with a green weekday; past days are in faint text, which turns muted on a
  hover fill. A dot under the date marks a day with Meals, green on the day
  showing and the control edge elsewhere. A sideways swipe on the strip turns
  the week.
- The day heading is the date in Newsreader at 31px under its weekday, or under
  "Today" in green.
- Each Meal sits under a full-width hairline. Its label line (label, time,
  guests, source Menu, in the small label) ends with Add Recipe (a +) and the
  dots; a Meal with none of those still has the line, for the two buttons. One
  row per dish follows, 8px apart: the name in Newsreader at 22px, then the
  trash when the Meal has more than one Recipe or has notes, the scale field,
  and the cooked circle on the right edge. A Dinner whose first Recipe has a
  photo shows it above its dishes and sets their names at 26px. Typed Meals are
  italic at weight 400. A cooked dish strikes through and fades its text to
  faint, on the page, never on a fill.
- "+ Add Meal" in green ends the day and opens the same Add Meal sheet as the
  title's +. An empty day reads "Nothing planned" in the serif over the sans
  line pointing at the +.
- A sideways swipe anywhere on the day, its bare foot included, steps to the
  next day or the one before, and past Sunday or before Monday into the next or
  last week. The day stays still under the finger and changes at once, as a tap
  in the strip does; either one starts the new day at its heading. The swipe
  needs 64px of sideways travel that beats the vertical by half again, so a
  scroll never steps the day. It does not start in the scale field, or in a
  sheet or menu the day opened, and the click that ends it never opens a Recipe.

The desktop agenda shows the whole week, a day per row, with today on the tint
and a green marker bar. Its cooked circles lead the rows, titles share one edge
32px in, and a lighter hairline that starts where the titles start separates the
Recipes of a Meal. A Meal's header line shows only when it has a label, time,
guests or source Menu; otherwise the Meal's dots end its last row. Each day
keeps its own Add Meal.

### Shopping

- One centered flat list with hairline dividers. A row is a check circle (the
  control edge when empty, the green fill with a white tick when checked), the
  name in Newsreader, then the amount in the sans: on a phone after the name on
  the same line when it fits, wider on the line under it. The whole row checks
  it. Checked rows strike through in faint text, so they stay on the page, never
  on a fill.
- Sort the rows to buy alphabetically. Do not add aisle or category sections.
  Categories may remain internal.
- On a phone the title carries the count in the sans (“7 to buy”, “All
  checked”). From Staples and From Plan sit under it as two quiet 44px buttons.
  From 15 rows the search field waits behind a magnifier at the right of the
  title row; it opens focused, with Done beside it, and Done or Escape puts it
  away and clears the search. Under 15 rows the field goes with its query.
  Wider, the title shows checked/total, the buttons follow it and the field
  shows from 15 rows.
- On a phone checked rows gather under a small “Checked” heading with “3 of 12”
  and Clear checked at its right. A row checked there keeps its place for half a
  second, then folds where it was and opens at the top of Checked; unchecked, it
  goes back to its place by name the same way. A second tap takes it back, and
  it stays where it is while that tap is out. The half second outlasts the
  check's answer, a reload and a change from the other phone, and a row whose
  check isn't confirmed waits where it is. Next shop stays one list, so a row
  keeps its open editor, menu or swipe whichever group it is in, and one checked
  from the keyboard keeps focus on its check once it lands. With reduced motion
  it moves without folding. When every row is checked, “Everything is checked”
  takes the list's place. Later keeps its own checked rows at the end of its
  list. Wider, the checked rows close the one list and Clear checked sits under
  it.
- On a phone adding is an “Add an item” pill floating at the bottom right, above
  the tab bar: a card with a hairline edge (lighter in dark) and a shadow, over
  the list, which shows past it and stays tappable beside it. The list's end and
  the Undo toast stay clear of it. It opens Add to Shopping as a tall sheet with
  the field at the top, focused inside the tap so iOS raises the keyboard, which
  then covers only the empty lower half. The sheet stays open between adds and
  lists each one under the field with an Undo that takes the add back, without a
  toast, while the row is still as it was added. A row someone has checked,
  edited or added to since stays, and its line says so. Desktop keeps its inline
  quick add.
- Generated and manual demand can share a displayed total, but UI actions must
  make corrections understandable.

### Staples

- Use one compact searchable alphabetical list; no grouping. Each row has a Need
  button that puts it on Next shop, and is deleted by a swipe left (a trash
  button with a mouse). The + beside the title adds a Staple. The button's
  spoken name starts with its visible words and then names the Staple (“Need,
  Salt”), so Voice Control can tap it by what it shows; Delete is “Delete Salt”
  and its toast “Deleted Salt”.
- Each row carries its own Add control, its own state and its own errors. A
  shopper is usually scrolled somewhere down a long list, so a banner at the top
  of the page is a message they will never see.
- A Staple already waiting in Next shop reads “On list” in place of Need. Keep
  the control focusable and the row where it was; repeat the result in a
  visually hidden live region for a screen reader.
- No availability state, quantities, expiry dates, stock ledger, images, or
  category sections.

### Empty states and onboarding

Use one short explanation and one clear action. Favor importing an existing
Recipe over a blank form. Use quiet insets or plain muted text, not feature
grids, illustrations, or congratulatory copy.

## Motion and accessibility

- Animate transform and opacity only, usually 150–300ms. A switch track and a
  selected label may change color as their thumb or pill moves, and a Shopping
  check's tick draws in from the left (a 150ms `clip-path`). The one change of
  size is a row closing its gap (`RowCollapse`): height and opacity together,
  200ms `--ease-exit`, and opacity only under reduced motion. A deleted row
  closes this way, and so does a Shopping row its check moves on a phone, which
  then opens in its new place.
- Respect `prefers-reduced-motion`; behavior must not depend on animation.
- Haptics (iOS app only, `haptic()` in `app/utils/shell-bridge.ts`) follow the
  native control, once per tap, never on load or a refresh: `selection` for a
  tab, a switch, a new segment, ticking or unticking a Shopping item, an
  ingredient or a step, a swipe that turns Plan's week or steps its day, and
  unmarking cooked; `success` for Mark cooked, a Save the server took, and an
  import; `medium` for a delete with Undo; `warning` when a confirm sheet asks.
- Keep visible focus, semantic landmarks, labelled icon buttons, and reachable
  reorder controls.
- Hover is polish. Every action must work by tap and keyboard. Tooltips are for
  a mouse: they never open on a touch screen or in the iOS app.
- Test realistic long Recipe titles, Menu notes, ingredients, and translated or
  custom labels at phone and desktop widths.

## Building a new surface

Start with the nearest existing surface and these defaults:

- one Newsreader page title
- Schibsted Grotesk 16px body
- flat rows with `divide-border/40`
- a quiet inset only when grouping needs containment
- green actions, hairline borders, 8px inline radii
- shadow elevation only for overlays
- one primary action and secondary actions hidden until useful

If a new pattern needs a long explanation here, first ask whether it belongs in
the component itself or whether the UI can be simpler.
