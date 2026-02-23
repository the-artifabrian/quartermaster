# Design System Implementation Plan

Phased implementation of `DESIGN_SYSTEM.md`. Each phase is self-contained and
shippable. Phases are ordered by dependency — later phases assume earlier ones
are complete.

**Current state**: Colors, CSS variables, shadows, radii, container widths,
paper grain, and basic animation keyframes are already implemented. The main
gaps are the font swap, type scale consistency, the signature strikethrough,
copper accent usage, and per-surface polish.

---

## Phase 1: Typography Foundation

Everything else depends on the fonts and type scale being correct. This is the
riskiest phase because Young Serif 400 may feel lighter than Crimson Pro 600 —
test recipe card titles immediately after the swap.

### Font swap

- [x] Replace `Crimson Pro:wght@300;400;600` with `Young Serif` in the Google
  Fonts `<link>` in `root.tsx`
- [x] Update `--font-serif` in `tailwind.css` to `'Young Serif', Georgia, serif`
- [x] Remove all `font-semibold`/`font-light`/`font-bold` from `font-serif`
  elements (17 instances across 12 files). Ingredient section headings changed
  to `font-sans font-medium` per design spec. Wordmark changed to `font-sans`.
- [x] Visual test: Young Serif 400 at 18px looks good on recipe cards

### Type scale cleanup

The current CSS defines generic heading tokens (`--text-h1` through
`--text-h6`, `--text-body-*`) that don't map to the design system's
purpose-driven scale. These need to be reconciled.

- [ ] Audit which components actually use the generic scale tokens (`text-h1`,
  `text-h2`, etc.) vs inline Tailwind sizes
- [ ] For each usage, replace with the correct value from the design system type
  scale table (e.g., recipe detail title → `text-[2.5rem] leading-[1.15]
  tracking-[-0.02em]`)
- [ ] Remove unused generic scale tokens from `tailwind.css` (lines 129-170),
  or replace them with the design system values if they're widely used
- [ ] Verify line-height and letter-spacing values match the type scale table
  across all serif usages

### Verification

- [x] All pages render correctly with Young Serif
- [x] No `font-semibold`/`font-light`/`font-bold` on any `font-serif` element
- [ ] Recipe cards, recipe detail, meal plan, landing page all use correct sizes
  from the type scale table

---

## Phase 2: Signature Strikethrough — SKIPPED

Pen-stroke `scaleX` animation was implemented and tested but wasn't visible
enough in practice. Reverted to standard CSS `line-through`. The old
`@keyframes strikethrough` and `animate-strikethrough` class were removed as
cleanup.

---

## Phase 3: Copper Accent System

Copper should mark "where you are" and "what matters now." Several places
currently use sage (primary) or red where copper is specified.

### Navigation

- [ ] Bottom tab bar (`bottom-nav.tsx`): Add copper dot or underline indicator
  below the active tab icon. Currently uses `text-primary` (sage) — keep sage
  for the icon fill, add copper for the indicator
- [ ] Bottom tab bar: inactive tabs should use stone color
  (`text-muted-foreground`)
- [ ] Header wordmark: verify "Quartermaster" is DM Sans 500 (`font-sans
  font-medium`)
- [ ] Header active page indicator: if applicable, add copper treatment for
  current route

### Recipe detail

- [ ] Add thin copper left-edge strip on desktop (2-3px) as a bookmark accent.
  Apply to the recipe detail container, visible only at `md:` and above
- [ ] Verify personal notes copper left border is already correct (audit shows
  `border-accent border-l-[3px]` — this should be fine)

### Favorites

- [ ] Change favorite heart fill from red to copper (`text-accent` instead of
  `text-red-*` or `text-destructive`)
- [ ] Update in `recipe-card.tsx` and `$recipeId.tsx` (both places where
  favorite heart appears)

### Meal plan (verify existing)

- [ ] Confirm today's card has 3px copper top-border (audit says yes)
- [ ] Confirm "Up next" / tonight banner has copper accent border — add if
  missing

### Verification

- [ ] Bottom nav: copper indicator visible on active tab
- [ ] Recipe detail: copper strip on left edge (desktop only)
- [ ] Favorite hearts are copper, not red
- [ ] Meal plan today: copper top-border
- [ ] Copper usage is limited to the 5 specified contexts — no stray `accent`
  usage elsewhere that contradicts the structural intent

---

## Phase 4: Recipe List

The most important screen. This is where the typography-forward identity is most
visible.

### Card titles

- [ ] Grid view: recipe card title → `font-serif text-[1.125rem] leading-[1.3]
  tracking-[-0.005em]` (18px). Remove any `font-semibold`
- [ ] List view: recipe card title → `font-serif text-[1rem] leading-[1.4]`
  (16px)
- [ ] Allow wrapping to 2 lines on mobile list view before truncating

### Letter avatars

- [ ] Remove letter avatar circles from recipe cards
- [ ] Test the list without them — if it feels flat, try a thin (3px) colored
  left border per card as the fallback
- [ ] If removing avatars, also remove the color-generation logic

### AI Generated indicator

- [ ] Replace the green badge + sparkle icon with a small muted text label in
  the metadata row (e.g., `text-muted-foreground text-xs`)
- [ ] Remove the sparkle icon import if no longer used elsewhere

### No-image cards (grid)

- [ ] Increase padding on cards without images — the card is a typographic
  composition, not a card missing its photo
- [ ] Give description more space on no-image cards (2-3 lines instead of 1)
- [ ] Ensure the card feels intentional, not empty

### Hover states

- [ ] Card hover: `shadow-hover` transition at 180ms
- [ ] Border warms slightly on hover (shift toward copper at 20% opacity)
- [ ] Image cards: image scales 1.02x on hover

### Verification

- [ ] Grid view with mix of image/no-image cards looks cohesive
- [ ] List view with 40+ recipes scans well without avatars
- [ ] Title sizes match type scale exactly
- [ ] AI badge is demoted to metadata
- [ ] Hover effects are smooth, not jarring

---

## Phase 5: Recipe Detail

The signature surface — users spend the most time here during cooking.

### Hero area

- [ ] Title: `font-serif text-[2.5rem] leading-[1.15] tracking-[-0.02em]`
  (currently 2.25rem — bump to 2.5rem)
- [ ] Cedar `<hr>` below title
- [ ] Metadata (prep, cook, total time) in small DM Sans, muted

### Ingredients (left column, sticky on desktop)

- [ ] Amounts/units in Young Serif: wrap amount + unit in a `font-serif` span
- [ ] Ingredient names in DM Sans (default — no class needed)
- [ ] This creates the scanning rhythm: serif amount → sans ingredient
- [ ] Section headings (`isHeading`): DM Sans 500, small-caps or uppercase at
  12px, subtle underline, **no checkbox**
- [x] Checkboxes: 24px, sage fill when checked (already `size-6`)
- [ ] Line spacing: 1.7

### Instructions (right column)

- [ ] Step numbers in Young Serif, oversized (e.g., `font-serif text-xl`)
- [ ] Step text in DM Sans, line-height 1.75
- [ ] 24px spacing between steps
- [ ] Checked steps: dim to 40% opacity with subtle strikethrough

### Mobile

- [ ] Base text size: 17px for arm's-length reading
- [ ] Full-row tap targets for checkboxes
- [ ] Ingredients collapsible, starts expanded

### Print view

- [ ] No chrome, no colors
- [ ] Ingredients in tight two-column layout (amount | name)
- [ ] Instructions numbered, compact line-height
- [ ] Source URL as small footer text
- [ ] Young Serif titles preserved in print

### Verification

- [ ] Title is noticeably larger than other page titles (2.5rem vs 2.25rem)
- [ ] Ingredient list has visible serif/sans rhythm
- [ ] Section headings look like headers, not checkable items
- [ ] Print preview looks like a cookbook page
- [ ] Mobile text is comfortable at arm's length

---

## Phase 6: Shopping List

Narrow, focused, satisfying to cross off.

### Layout

- [x] Verify 480px max-width, centered (already uses `container-narrow`)
- [ ] 16px vertical padding per item for touch targets

### Items

- [ ] Checkboxes: 24px, sage fill when checked
- [ ] Item name: DM Sans 16px
- [ ] Quantity/unit: small caption below the name
- [ ] Checked items: pen-stroke strikethrough (from Phase 2) + text fades to
  50% opacity. Line is 2px in stone color

### Section headings

- [ ] `isHeading` items: no checkbox, DM Sans 500, uppercase or small-caps at
  12px
- [ ] Subtle cedar line below the heading
- [ ] Visually distinct from checkable items

### Other details

- [ ] Progress counter in header: "Shopping List (3/10)"
- [ ] Quick add input: DM Sans placeholder "Add an item...", ghost + button
- [ ] Checked item actions footer: "Add to inventory" and "Clear checked" as
  text links, slides up when items are checked

### Print view

- [ ] Unicode checkboxes, compact spacing, no chrome
- [ ] Fits one page for a typical weekly shop

### Verification

- [ ] List is narrow and centered, not stretched
- [ ] Section headings are clearly not checkable
- [ ] Strikethrough animation matches recipe detail
- [ ] Print output fits one page

---

## Phase 7: Meal Plan & Inventory

Two surfaces that need targeted polish rather than a full rebuild.

### Meal Plan

- [ ] Day name headers in Young Serif (verify or update)
- [ ] Desktop 7-day grid: cards should feel like index cards on a table
  (generous padding, warm backgrounds)
- [ ] "Up next" banner: linen background, copper accent border
- [ ] Adding meals: new meal fades in with element-reveal curve (280ms)
- [ ] Past days faded to 80% opacity
- [ ] Empty days: ghost "+" button

### Inventory

- [ ] Row density: 12px vertical padding (tighter than shopping list's 16px —
  current `py-2` is 8px, may need bump to `py-3` for 12px)
- [ ] Category headers (PANTRY, FRIDGE, FREEZER): DM Sans 500, 12px, uppercase
- [ ] Colored dot indicator per category + item count
- [ ] Sticky category headers on scroll
- [ ] No checkboxes, no strikethrough — visual language says "reference"

### Verification

- [ ] Meal plan today card has copper top-border, past days are faded
- [ ] Inventory rows are visibly denser than shopping list rows
- [ ] Category headers stick on scroll in inventory

---

## Phase 8: Landing Page

Public-facing polish. Depends on Phase 1 (font swap) being complete.

### Hero

- [ ] Young Serif at 40px (2.5rem), centered, with `leading-[1.2]
  tracking-[-0.02em]` per type scale
- [ ] Tagline in DM Sans, muted stone color
- [ ] "Start cooking" button (sage) + "See how it works" text link
- [ ] 30-40% viewport whitespace — restraint communicates confidence
- [ ] Landing page content within 960px max-width (`container-landing`)

### Artifacts

- [ ] Recipe page artifact: Young Serif title, short ingredient list, metadata.
  Slight angle (2-3deg rotation), warm shadow. Should look like a typeset
  cookbook page
- [ ] Week view artifact: days of the week with meals in Caveat. Feels like a
  fridge note
- [ ] Shopping list artifact: a few items, some with pen-stroke strikethrough
- [ ] Artifact labels in Caveat 700 at 20px (landing artifact label from type
  scale)
- [ ] Each artifact fades up on scroll (element reveal, 280ms, staggered at
  40ms between items, max 6 animated — rest appear instantly)

### Close

- [ ] Simple final CTA section
- [ ] No footer clutter

### Verification

- [ ] Artifacts look like designed objects, not wireframes or screenshots
- [ ] Scroll reveal animations are smooth, respect `prefers-reduced-motion`
- [ ] Caveat appears only on artifact labels and week view
- [ ] Page feels confident and restrained, not cluttered

---

## Phase 9: Component & Detail Polish

Final pass across the whole app for consistency.

### Card borders & hover

- [ ] All cards: 1px solid cedar border
- [ ] Hover: border warms slightly (shift toward copper at 20% opacity)
- [ ] Verify shadow-rest / shadow-hover / shadow-elevated usage is consistent

### Image treatment

- [ ] All recipe images: 6px radius, 1px cedar border
- [ ] Prefer slight letterboxing over aggressive cropping

### Dividers

- [ ] All `<hr>` elements use cedar color
- [ ] No hand-drawn SVG lines anywhere

### Empty states

- [ ] All empty states: DM Sans in stone color, dashed borders
  (`border-dashed` with `background-size` or SVG for 6px dash / 8px gap)
- [ ] No Caveat font in empty states
- [ ] Getting started checklist: warm but direct tone, encourage importing
- [ ] Pantry staples onboarding: tappable chips, quick bulk-add

### prefers-reduced-motion audit

- [ ] All animations respect `prefers-reduced-motion: reduce`
- [ ] Strikethrough: instant appearance, no sweep
- [ ] Page reveals: instant appearance, no fade
- [ ] List staggers: all items appear at once

### Spacing audit

- [ ] Page top padding: 32px mobile, 48px desktop across all routes
- [ ] Card internal padding: 20-24px consistently
- [ ] 8px rhythm respected — no odd padding values (13px, 15px, etc.)

### Verification

- [ ] Toggle through all main pages — visual consistency check
- [ ] Toggle dark mode — all surfaces look correct with dark tokens
- [ ] Toggle reduced motion — all animations disabled gracefully
- [ ] No stray oklch values in color palette CSS (shadow definitions
  intentionally use oklch for warm-tinted semi-transparency — that's correct,
  leave those alone. The "hex migration" applies only to the main palette
  variables, which are already hex)
