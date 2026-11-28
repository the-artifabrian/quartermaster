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

- **Newsreader** for titles only: tab, page and sheet titles, a Recipe's title,
  day and section headings, an empty state's heading, a step's numeral.
  Everything you read is in the sans, names in rows included (a Shopping item, a
  dish on Plan, a Recipe or Menu in a list or a picker), at weight 500
  (`font-medium`). Titles are weight 500 too, which `font-serif` sets on its own
  (`app/styles/tailwind.css`), so a serif title takes no weight class. The files
  carry weights 400 to 600 only, so never ask the serif for less or more. The
  roman has an optical-size axis the browser sets from the font size, and there
  is no italic file. The serif sets lining figures, and `tabular-nums` adds to
  them.
- **Schibsted Grotesk** for everything that is not a title: names, running text,
  controls, labels, metadata and navigation, weights 400 to 700. Running text is
  400, names 500 and amounts 600 on a phone (500 on wider screens). It has no
  italic file, so the app does not set the sans in italic.

All fonts are self-hosted: the files sit in `app/assets/fonts/` as `latin` and
`latin-ext` subsets (the Households write Romanian), and `app/styles/fonts.css`
declares them, so a face downloads only when a page uses it. `app/root.tsx`
preloads the two latin files every page sets first, Newsreader and Schibsted
Grotesk, the homepage included.

Headings balance their lines (`text-wrap: balance` in
`app/styles/tailwind.css`). Long reading text, such as a Recipe's description,
steps and notes, uses `text-pretty` so a paragraph doesn't end on a single word.
Browsers without it wrap as usual.

Useful sizes:

| Use                                                                                  | Size                                                                                |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Tab title (`TabTitle`)                                                               | 40px Newsreader, 1.05 lines                                                         |
| Recipe title on a phone (`text-recipe-title`)                                        | 36px Newsreader, 1.1 lines; 32px wider                                              |
| Menu title on a phone (`text-menu-title`)                                            | 32px Newsreader, 1.125 lines; wider, 24px on its page and 30px shared               |
| Any edit, Import, Settings or signed-out form's title on a phone (`text-edit-title`) | 28px Newsreader, 1.15 lines; 24px wider                                             |
| Plan's day heading on a phone                                                        | 31px Newsreader                                                                     |
| Recipe or Menu section heading on a phone (`text-recipe-section`)                    | 24px Newsreader; 18px wider                                                         |
| A section of the Recipe or Menu form on a phone (`text-recipe-section`)              | 24px Newsreader; wider, the 12px uppercase label                                    |
| Other page title                                                                     | 24px Newsreader                                                                     |
| Plan dish on a phone (`text-dish`)                                                   | 17px Schibsted Grotesk, 19px under a Dinner's photo (`text-dish-photo`)             |
| Recipe or Menu row on a phone (`text-list-name`)                                     | 17px Schibsted Grotesk                                                              |
| Shopping item or Staple on a phone (`text-item-name`)                                | 17px Schibsted Grotesk                                                              |
| A closed ingredient row in the Recipe form on a phone (`text-item-name`)             | 17px Schibsted Grotesk, weight 400; 14px wider                                      |
| A Recipe card's name in the Menu form on a phone (`text-item-name`)                  | 17px Schibsted Grotesk, weight 500; 14px wider                                      |
| The line that says an import is running, on a phone (`text-item-name`)               | 17px Schibsted Grotesk, weight 500; 18px wider                                      |
| A row's name in Settings on a phone (`text-item-name`)                               | 17px Schibsted Grotesk, weight 500; 16px wider                                      |
| A step on a phone (`text-step`)                                                      | 17px Schibsted Grotesk, 1.6 lines; its numeral 24px Newsreader (`text-step-number`) |
| An ingredient on a phone (`text-ingredient`)                                         | 17px Schibsted Grotesk, 1.45 lines                                                  |
| Body, and ingredients and steps wider                                                | 16px Schibsted Grotesk                                                              |
| UI label                                                                             | 14px Schibsted Grotesk                                                              |
| Small label (`text-label`)                                                           | 13.5px Schibsted Grotesk, weight 600                                                |
| Caption                                                                              | 13px Schibsted Grotesk                                                              |
| Tiny navigation label                                                                | 12px Schibsted Grotesk                                                              |

The Plan dish sizes (`text-dish`, `text-dish-photo`), the list row size
(`text-list-name`), the Shopping item and Staple size (`text-item-name`), the
Recipe page's sizes (`text-recipe-title`, `text-recipe-section`,
`text-ingredient`, `text-step`, `text-step-number`), a Menu's title size
(`text-menu-title`), the edit screens' title size (`text-edit-title`) and
`text-label` are font size tokens in `app/styles/tailwind.css`, each set once,
and `cn` in `app/utils/misc.tsx` knows them. A `leading-*` class beside one of
them wins over the size's own line height, so a class list that has both names
the line height again (`leading-(--text-step--line-height)`).

A small label (a Meal's label, the weekday in Plan's strip and over its day, the
groups of a picker, a heading inside a Recipe's ingredients, a Recipe's facts
and its Notes) is sentence case at weight 600 with no tracking:
`text-label font-semibold`. On a phone a field's label is the same small label,
muted, on its own line above the field; the shared `Label` sets it, so every
form has it. Wider it is the 14px UI label. Wider screens set a section's label
uppercase and letter-spaced (`sectionLabelClass`), as the sections of the Recipe
form, the Menu form's Recipes heading and the groups of Settings do; on a phone
those are sentence case. A printed Recipe keeps its uppercase headings.

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

### Homepage

The signed-out homepage is an ordinary page in the app's paint: the same tokens
and faces, the theme the visitor's device or setting picks, and the shared
header and footer as on About. It is all on the page background, with no filled
sections. Its h1, its section headings and their numerals are Newsreader;
everything else is the sans. Its two buttons are the app's: the green fill for
"Start cooking" and the quiet `secondary` fill for the demo, both 48px tall like
a Recipe's Add to Plan.

The hero puts the headline, the text and the buttons on the left and, from `lg`,
two phones on the right: Plan on today in front and Shopping behind it, up and
to the right with its left third covered. The pair is cut by a full-width
hairline at the hero's foot, always below the Plan's day heading and its first
two Meals. Below `lg` the pair sits under the buttons, and below 640px the Plan
stands alone, since two phones would be too small to read. The Shopping behind
is decoration, kept out of the accessibility tree; it is read as the fourth
step.

How it works is one section of four steps in the order Recipes, Plan, Staples,
Shopping: a phone, then the number, a 28px heading and the text, all on the
phone's left edge. They are four across from 1280px, two by two from 640px, and
one column on a phone, where each phone follows its text. The text comes first
in the page's order, so a screen reader hears each picture with its own step;
from 640px CSS `order` lifts the phone above it.

Its pictures are phones drawn in CSS (`PhoneFrame` in
`app/components/phone-frame.tsx`): a rounded card-colored outline with the
page's background inside, no notch and no brand marks. Each screen is laid out
at 390 by 844 at the app's own sizes and scaled as a whole by `--phone-scale`,
so at the default text size it never reflows (the frame is in pixels, the text
in rem). The slot around a screen takes its scaled size, so the outline fits the
screen with no gap. A picture is one image to a screen reader, named for what it
shows, and nothing in it takes focus (`inert`).

The scale steps live in `phoneScales`, one set for the hero's pair and one for
the steps. A phone is as wide as its column allows, up to a cap of 0.86 (347px
wide, about 740px tall), past which it would only make its row taller than a
screen: from 1024px to 1279px a step's phone sits at that cap in a wider column.
No text inside renders under 8px from 640px up. Every step is a `min-[…]` width:
Tailwind orders those before its named breakpoints, so a set that mixed `lg:`
with `min-[1280px]:` would let `lg:` win at 1280px.

The screens themselves (`app/components/homepage-phones.tsx`) copy today's phone
screens: Plan on today (breakfast, lunch and a snack, cut through the snack), a
Recipe without a photo, Plan on the coming Saturday with a Meal's menu open,
Staples, and Shopping. The real screens switch layout on the viewport, so the
copies take the phone's classes directly (`text-dish`, `text-ingredient`, the
check circle, `chipClassName`, `buttonVariants`, the Staple row's classes), or
use the real component where it has no `phone:` layout of its own
(`RecipeFacts`), and must follow a screen when it changes. They leave out the
tab bar, since the text with each phone names its tab. Their days come from the
visitor's own today (`app/utils/homepage-plan-days.ts`), sent by the loader, so
the server and the browser draw the same week.

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
a step number, a small label, the first icon of a row of icons, the text of a
Recipe's ingredient on a phone) starts on the content edge, and the dots, trash
and cart glyphs that end a row end on it. A 44px tap area reaches into the page
gutter with a negative margin rather than pushing its glyph in. Inside a row,
titles share one edge past the leading glyph, and a heading's chevron trails the
heading. A page title has no rule under it.

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
- **Button labels** on a phone are 16px on a full-size button (`default` and
  `lg`) and 14px on a small one (`sm`). A full-size button that reads as a small
  control keeps 14px with `phone:text-sm` where it is used: the Need pill, the
  header's Log in and Sign up, a confirm sheet's two buttons, the round add
  button beside a tab's title, the two buttons of a Household invite, and
  Later's Clear checked on Shopping. `wide`, `pill` and `icon` set no size. An
  icon that would follow the label's size (`1em`) has a fixed size where the
  label is 16px on a phone only, and `StatusButton`'s spinner, tick and cross
  hold 14px on a phone, so the words are all that differs from wider screens,
  where labels are 14px.
- **Fields.** The field helpers in `app/components/forms.tsx` carry the phone
  sizes, so a screen adds none. A label (`Field`, `TextareaField`, `OTPField`)
  is the small label, 13.5px semibold and muted, on its own line. A code's boxes
  (`OTPField`) are 44px tall with 20px characters, the six of a 2FA code 44px
  squares. An error line (`ErrorList`) is 13.5px in the error colour. The words
  beside a checkbox (`CheckboxField`) are 16px in ink, since they are read as
  text. A `Field` or `TextareaField` with another field helper straight after it
  keeps 16px under it; two fields side by side turn that off. The Meal editor's
  error line stays 14px.
- **Chip** is the one chip: 44px tall, fully rounded, a hairline border, and a
  green fill when pressed (`aria-pressed`). Use it for picking days, labels, and
  classification values, and for one-tap suggestions with a leading `+`. A
  control that must stay its own element in a row of chips (a native `<select>`,
  a menu trigger) takes the same look from `chipClassName`. The Recipes list's
  filters and a Recipe's Metric show a chosen chip on the tint with a green ring
  and green text (`tone="tint"`, `chipClassName(on, 'tint')`) instead of the
  fill.
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
  “Add Meal to Thursday, Nov 19”). On a phone, while Staples' search row is
  pinned, the row ends with a second + of the same name (see Staples). Shopping
  adds from its floating “Add an item” pill instead (see Shopping).

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
  instead; with a keyboard or VoiceOver its Delete is the next stop after Need,
  and the row slides open while it has focus.
- A delete that can be undone (a Meal, a Recipe in a Meal, a Shopping item,
  Clear checked, deleting a Staple) happens at once with an Undo toast at the
  bottom, above the tab bar; every other toast stays at the top, below whatever
  is pinned there (a pushed page's nav bar, the pinned rows of a phone's Plan,
  Recipes and Staples). A deleted row, Staple or Meal closes its gap and Undo
  opens it again; Clear checked goes at once. The delete is saved at once and
  Undo puts back what it removed. Opening a sheet closes the Undo toast, so it
  never sits over a sheet.
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

A pushed page may put its own buttons at the right of the bar on a phone: a
Recipe's Favorite, Share and dots, and a Menu's Share and Edit, ink icons with a
green filled heart for a favorite. The route's handle names them (`navActions`)
and the bar draws them from the route's loader data, so they come with the
server's HTML and the page's first frame. What they send goes through the page's
own fetchers (a fetcher answers an error at the route it was made in, and the
bar is the root's), and the page says whether there are cooking checks to reset.
An edit screen's route names none. The bar needs the loader's data and the page
on screen (it registers with `useNavBarActions`), so a page that failed to load,
a loader that fails on a later navigation, and an error after load (a favorite
tapped on a Recipe deleted meanwhile) show none. Wider screens show the page's
own row instead. Beside them the small title takes the room between Back and the
buttons rather than the bar's centre. Focusing Back or a button in the bar never
scrolls the page: what can take focus in the page has a scroll margin that
clears the bar, rather than the page having a scroll padding. A textarea is the
exception, since Chromium scrolls it by its caret and leaves out the margin:
while one in the page has focus, the page takes the padding too, so a step field
partly under the bar comes out below it.

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
monogram from `recipe-placeholder.ts`. A phone's Recipe row shows no monogram: a
Recipe without a photo shows nothing there. On a phone, a Dinner on Plan shows
its first Recipe's photo full width, 152px tall, above its dishes, and the Plan
picker puts a Recipe's photo at the end of its row and shows none for a Recipe
without one. Other Meals, and the desktop agenda, are text only.

Typical square thumbnail sizes:

- 52px at the end of a Recipe row on a phone; a desktop card puts the photo on
  top
- 36–40px in pickers

On a phone a Recipe's photo runs edge to edge, 244px tall, under the nav bar; a
Recipe without one starts with its title. Desktop shows it beside the title.
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

On a phone the Recipes and Menus lists share a title and a row shape:

- The title is "Recipes" and "Menus" side by side at the tab title's size, two
  links. The list showing is the page's heading in ink, the other is faint, and
  the round + ends the row. It takes the place of a count in the title and of
  the segmented switch, which wider screens keep under their title. Below 360px
  the two titles step down to 34px so the + still fits.
- Recipes' search field and the filter button sit under the title, 14px above
  and below, and stay pinned under the status bar while the list scrolls,
  opaque, with a hairline under them. A focused row or control lands below them
  (a scroll margin on what can take focus outside the pinned row), and focusing
  the pinned field or a chip scrolls nothing. Toasts open below the row where it
  rests under the title (and under the demo banner in a demo), chips included,
  so they never cover it, at the top of the list or scrolled. The field has a
  clear button, named "Clear the search field", once it has text, and the
  browser's own is hidden. A search or a filter takes the page back to the top,
  so the new list starts under the search row.
- The filter button opens the chips as one row that scrolls sideways, edge to
  edge, inside the pinned row: sort, cook time, Favorites, then Cuisine, Season
  and Course. Sort and cook time are the phone's own pickers. A chosen chip is
  tinted and ringed in green, and the button's badge counts what is set. A chip
  reached from the keyboard scrolls fully into the row; a tapped one stays under
  the finger.
- While searching or filtering, a line above the list reads "8 of 24 Recipes",
  then the filters by name, with "Clear search and filters" at its right. Wider
  screens count in the title, so their line names the filters, or counts for a
  search alone. Filters that leave nothing read "No Recipes match these
  filters", with "Try a longer time, or turn Favorites off." only while cook
  time or Favorites is set.
- A row is the name in the sans at 17px, weight 500, a green heart after it for
  a favorite, and under it the total time at weight 600 then the first line of
  the description, in the sans. A 52px photo ends the row on the content edge;
  without one the row is text only. Names wrap to three lines; a longer one is
  cut there and its heart ends the third line. The heart reads "Favorite" to a
  screen reader.
- A Menu's row is the same: its title, then "4 Recipes" at weight 600 and its
  description, or the Recipes' names when it has none, with the guests at the
  right.

### Recipe detail

- Put the title and optional hero first, then metadata, ingredients, and steps.
- On a phone the page is the photo (244px tall, edge to edge), the title, the
  description in muted sans, then the facts: Active, Total and what it makes (at
  the current scale), each a small label over its value, only those the Recipe
  has, with the source site under them. Add to Plan is the one full-width green
  button; Favorite, Share and the dots are in the nav bar, and the dots hold
  Edit (named Edit Recipe) first, then Reset cooking checks while there are
  checks, Copy Recipe and Print, and for Pro the suggestion of a description and
  times. Wider screens keep the title and facts beside the photo and the row of
  icon actions, Edit among them.
- On a phone a section heading (Ingredients, Instructions) has more room above
  it (32 to 36px) than between it and its first row (20 to 24px). The yield
  shows once, in the facts; the line under the Ingredients heading shows only
  while the Recipe is scaled, with the original beside it.
- Reading text on a phone's Recipe page is 17px (notes, ingredients and steps),
  and the description stays 16px and muted. Small text is 13.5px (`text-label`):
  semibold for labels, regular for the source link, Scale and the scaled yield.
  Shared controls keep their own 14px (the Metric chip, Show more). Nothing is
  12 or 15px.
- On a phone an ingredient row starts with Shopping's check circle
  (`CheckCircle`) on the content edge, then one line of text: the amount and
  unit at weight 600, the name, then any note in muted roman after its comma,
  with the cart on the other edge. One-line rows are 56px and touch, so the
  whole list checks a row. A long row wraps under its own text. Headings start
  on the content edge in sentence case over a hairline, with more room above
  than below. The row is the checkbox: a checked row fills its circle and fades
  its whole line, amount included, without a strike. Wider screens keep a square
  box and strike a checked row. The Ingredients sheet and the shared Recipe page
  draw the same rows.
- On a phone a step is a green Newsreader numeral in a column as wide as an
  ingredient's circle and its gap, so the two texts line up, and the text in the
  sans, with a hairline between steps. A finished step fades without a strike
  and its numeral becomes a green check on its first line. Times and
  temperatures are weight 600 over a green underline, in ink on a phone and
  green wider.
- Print keeps its own layout. A printed page is about as wide as a phone, so
  `max-md:` reaches print too; the Recipe page's phone layout goes through
  `phone:` (a screen below `md`), which print never matches.
- Desktop may keep ingredients sticky beside instructions; mobile stacks them.
- Ingredient and instruction check-off must work across the full row.
- Personal notes render only when they exist: a quiet tinted block in the body
  sans, collapsed to a few lines with a Show more toggle. No colored edge and no
  handwriting on the detail page.
- An ingredient row offers a direct Shopping action until it is checked (a
  sub-Recipe's row links to that Recipe); the page never claims to know what the
  household has.
- Keep scaling, cooking cues, unit display, and print practical rather than
  decorative.

### Recipe form and Import

On a phone Recipe edit, New Recipe and Import are set in the Recipe page's
sizes. Wider screens keep the sizes they had.

- The screen's title is 28px in the serif (`text-edit-title`).
- Each section of the Recipe form (Ingredients, Instructions, Photo, Details,
  Classification) opens and closes from its whole heading row: a chevron, the
  heading in sentence case at 24px in the serif (`text-recipe-section`) and a
  muted 13.5px summary such as “7 items”. A hairline sits above each section.
- Labels are the small label, muted. Hints, a section's summary and Import's
  status lines are 13.5px muted, and an error is 13.5px in the error colour.
- Inputs are 44px tall, and every field has 16px text, so iOS never zooms the
  page on focus. A closed ingredient row reads at 17px on one line in a 52px
  row. A heading among the ingredients keeps its tint and drops the thicker left
  edge it has on wider screens.
- While an import runs, its line reads at 17px (`text-item-name`) over the
  13.5px status lines.
- Button labels are 16px. The buttons under each of Import's sources (Import,
  Read as written, Read with AI) are a full-width stack, 48px tall, up to 767px
  wide; from 768px they sit in a row at the right. Other buttons stay 44px.
- The notice on a just-imported Recipe has 16px sentences and actions, with the
  source line at 13.5px.

The shared controls inside these screens keep their own sizes: chips and the
segmented control are 14px.

### Menus

- A Menu reads as ordered sections of Recipe and note rows.
- A named section is a Newsreader heading over a hairline rule; its Recipes'
  names are in the sans. On phones its rows are flat and divided, and 1× stays
  implicit on Recipe rows.
- On a phone a Menu's page takes the Recipe page's sizes, with its title a step
  smaller at 32px (`text-menu-title`): the guest line at 13.5px, the description
  at 16px and muted, section headings at 24px with more room above (32px) than
  between the heading and its first row. Add to Plan is the one full-width 48px
  button; Share and Edit are in the nav bar, where Edit is a link that works
  before the page has run script. Wider screens keep Share and Edit beside the
  button. Between 640 and 767px Add to Plan opens its form in place, where the
  button's row was.
- A Recipe row on a phone is at least 56px, its 44px photo on the content edge,
  the name at 17px and weight 500 on up to two lines, then at 13.5px and muted
  the quantity ("2× · makes 8 servings") and the note under it. A missing
  Recipe's line is 13.5px in the error red, and its row is not a link. A note
  card reads at 17px with its Shopping lines at 13.5px. An empty section's line
  is 13.5px; an empty Menu's sits on the page without a box. Nothing is 12, 14
  or 15px apart from shared controls (a sheet's line under its title, the letter
  of a Recipe without a photo).
- On a phone Add to Plan's sheet has 13.5px semibold labels over 44px fields and
  a 48px full-width button.
- The shared Menu page draws the same rows, and its header follows on a phone:
  the same title, 13.5px small lines and one full-width 48px button.
- On a phone Menu edit and New Menu take the Recipe form's sizes: the title at
  28px (`text-edit-title`), "Recipes" in sentence case at 24px in the serif,
  small muted labels over 44px fields with 16px text, 13.5px hints ("Makes 8
  servings", an empty section's line, a missing Recipe's line in the error red)
  and errors, and 16px button labels. The Recipes heading has more room above
  (32px) than under it; with two or more sections a 13.5px muted line under it
  says how to move them. Wider screens keep the sizes they had.
- In the form on a phone a Recipe card's name is 17px at weight 500 on up to two
  lines, with the row beside its thumb to itself; the scale field and Remove sit
  under it at the right, then the note field, then the arrows and Move to…. A
  note card's Add shopping line has a row of its own above its arrows and Move
  to…. Add Recipe and Add note stay side by side down to a 320px screen.
- The Add Recipe sheet and the Move to… menu read at 17px in rows of 44px or
  more on a phone; the sheet's group labels and a Recipe's time are 13.5px. The
  sheet's title and the letter of a Recipe without a photo keep their own sizes.
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
  opaque, with a hairline under the strip. A focused control or a Meal a link
  opens lands below them (a scroll margin on what can take focus outside the
  pinned rows, as on Recipes), and focusing a chevron or a day scrolls nothing.
  Toasts open below the strip where it rests, under the demo banner in a demo
  too. A range too long for the row breaks after its dash. On another week,
  "This week" heads the day under the strip.
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
  row per dish follows, 8px apart: the name in the sans at 17px, then the trash
  when the Meal has more than one Recipe or has notes, the scale field, and the
  cooked circle on the right edge. A Dinner whose first Recipe has a photo shows
  it above its dishes and sets their names at 19px. A typed Meal is muted at
  weight 400, apart from a Recipe's name at 500. A cooked dish strikes through
  and fades its text to faint, on the page, never on a fill.
- "+ Add Meal" in green ends the day and opens the same Add Meal sheet as the
  title's +. An empty day reads "Nothing planned" in the sans at 20px, weight
  500 (a line of text, where other empty states have a serif heading), over the
  line pointing at the +.
- A sideways swipe anywhere on the day, its bare foot included, steps to the
  next day or the one before, and past Sunday or before Monday into the next or
  last week. The day stays still under the finger and changes at once, as a tap
  in the strip does; either one starts the new day at its heading. The swipe
  needs 64px of sideways travel that beats the vertical by half again, so a
  scroll never steps the day. It does not start in the scale field, in a picker
  or form opened in place, or in a sheet or menu the day opened. A drag of 20px
  or more sideways never ends in a tap, so it opens no Recipe; a tap whose
  finger drifts less still taps. A field being typed in loses focus before the
  day steps, so the scale field saves what was typed.

The desktop agenda shows the whole week, a day per row, with today on the tint
and a green marker bar. Its cooked circles lead the rows, titles share one edge
32px in, and a lighter hairline that starts where the titles start separates the
Recipes of a Meal. A Meal's header line shows only when it has a label, time,
guests or source Menu; otherwise the Meal's dots end its last row. Each day
keeps its own Add Meal.

### Shopping

- One centered flat list with hairline dividers. A row is a check circle (the
  control edge when empty, the green fill with a white tick when checked), the
  name at weight 500, then the amount: on a phone after the name on the same
  line when it fits, wider on the line under it. The whole row checks it.
  Checked rows strike through in faint text, so they stay on the page, never on
  a fill.
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

- Use one searchable alphabetical list; no grouping. A row is shaped like a
  Shopping row: at least 56px, hairlines between, the name in the sans at weight
  500 from the content edge (17px on a phone), wrapping to more lines and
  breaking a long word rather than being cut off. It ends with a Need button
  that puts it on Next shop, and is deleted by a swipe left (a trash button with
  a mouse). The + beside the title adds a Staple. The button's spoken name
  starts with its visible words and then names the Staple (“Need, Salt”), so
  Voice Control can tap it by what it shows; Delete is “Delete Salt” and its
  toast “Deleted Salt”.
- Need is a quiet pill, 44px tall, on `muted` with no border, at 14px and weight
  600, its fill ending on the content edge on a phone (with a mouse the trash
  follows it). Its ring shows for the keyboard, not after a tap. Only the button
  adds: the row itself is not a tap target, since a tap that lands while
  scrolling would put the Staple on Next shop and the screen has no Undo for
  that. The row's look comes from `app/components/staple-row-styles.ts`, which
  the homepage's picture of the screen uses too.
- The row looks the same at every width: the same height, pill and “On list”,
  with names at 16px above `md` as on Shopping, and the trash after Need with a
  mouse. Only the pinned search row and its + are phone only.
- Each row carries its own Add control, its own state and its own errors. A
  shopper is usually scrolled somewhere down a long list, so a banner at the top
  of the page is a message they will never see.
- A Staple already waiting in Next shop reads a green check and “On list” in
  green text with no fill, in place of Need, ending where the pill ends. The
  button keeps one width in both states, so a tap never wraps the name again.
  Keep the control focusable and the row where it was; repeat the result in a
  visually hidden live region for a screen reader.
- The line under the title is 15px muted. Search shows from 12 Staples, and once
  it has shown it stays for the visit, so a delete under 12 neither moves the
  list nor drops a search that is still filtering it. On a phone its row stays
  pinned under the status bar while the list scrolls, opaque, with a hairline
  under it, as Recipes' does: a focused row lands below it, focusing the field
  scrolls nothing, and top toasts open below the row where it rests. The field
  has a clear button, “Clear the search field”, once it has text. While the row
  is pinned the title's + has scrolled away, so the row ends with its own 44px
  +, also “Add Staple”; only one of the two is shown and reachable, read from
  the row's place on each scrolled frame, and focus on one moves to the other as
  they swap. The add form opens in place under the title, replacing Search:
  opened from the pinned +, the page goes back to the top with the field focused
  inside the tap, so iOS raises the keyboard. Escape, Cancel (the quiet button)
  or an add closes it, and focus goes back to whichever + shows, the pinned one
  when the page was scrolled far down meanwhile.
- “No Staples found” and “No Staples yet” sit on the page as the Recipes list's
  empty states do, with a serif heading; the suggestions for a new Household sit
  on the page as a row of chips.
- No availability state, quantities, expiry dates, stock ledger, images, or
  category sections.

### Settings

On a phone Settings and its pages take the sizes of the other phone screens.
From 768px they are set in the 14 and 16px of the wider layouts.

- Settings is a tab, so its title is the 40px tab title. A page pushed from it
  (Edit profile, Password, Email, Passkeys, Household, Import data, Two-factor
  auth) has a 28px serif title (`text-edit-title`).
- On Settings itself a group's heading (General, Account, Data) is the small
  label in sentence case, muted. A row is at least 44px: its name at 17px and
  weight 500, its value at the right at 16px and muted. The profile block has
  the name at 17px over the email at 13.5px, and the tier pill reads at 13.5px.
  The big initial keeps its 20px.
- A paragraph that explains a page or a section is 16px and muted; the steps of
  setting up two-factor are 17px, since they are read through. Small print (what
  deleting the account does, an invite's expiry, the notes on Import data) is
  13.5px.
- The Household page has real sections (Members, Invites, Leave Household), so
  their headings are 24px in the serif (`text-recipe-section`). One label over
  one list (Open invites, the kind of export being read) is the small label.
  "Import complete" reads at 17px.
- In a list (members, passkeys, invites) a name is 17px at weight 500 over a
  13.5px muted line.
- A page with one main action (Save changes, Change password, Send confirmation,
  Add passkey, Enable 2FA, Disable 2FA) sets it full width and 48px tall. Pages
  with several keep 44px buttons.
- The small buttons inside rows (Remove, Copy, Copy link, Revoke, a passkey's
  Delete) are `sm` and keep 14px. Deleting the account and logging out of other
  sessions are full-width and read at 16px.

### Signed-out forms

Log in, Create an account, Forgot password, the code screens, Choose a new
password and Set up your account share one layout on a phone. Its classes are in
`app/routes/_auth/+signed-out.tsx`, and each screen keeps its own layout from
768px.

- One column on the page gutter, 448px wide at most and centred once the page is
  wider than that. The title, the fields and the buttons share both its edges.
- The title is the 28px serif (`text-edit-title`) from the left edge, 32px under
  the header. "This link isn't valid" is that title too, and reads as body text
  from 768px. Signed in, a code screen comes from Settings under a notice, so it
  keeps the 80px above its title that it has from 768px.
- The paragraph under the title is 16px and muted, 8px below it. "Check your
  email." after a reset is asked for is 17px in ink. A second line (the trial,
  how long a code lasts, what a reset logs out) is 13.5px and muted. The address
  on Set up your account is in ink and breaks inside the column.
- The first field starts 24px under the text, and the main action sits 32px
  under the last field or checkbox row.
- The main action is full width, 48px tall, with a 16px semibold label. Log in
  with a passkey and Try the demo are 48px too, outlined, at the button's usual
  weight, so Log in is the one filled button. The passkey button is outlined at
  every width.
- A link ("Forgot password?", "Create an account", "Log in", "Back to log in",
  "Ask for a new code") is 16px with a 44px tap area. One under the main action
  is centred on its own row.
- A code's boxes are `OTPField`'s (see Controls). The eight of an emailed code
  share the column up to 352px, so each is about 43px wide.
- The header's Log in and Sign up button keeps its 14px.

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
