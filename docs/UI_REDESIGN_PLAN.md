# UX Redesign: From Developer Tool to Daily Cookbook

## Context

Phase 1 of the visual redesign (warm colors, Fraunces/DM Sans typography,
rounded corners, warm shadows) is complete. The app is warmer and prettier, but
the **page structures, information hierarchy, and interaction patterns are still
"Epic Stack CRUD app."** Every page follows the same shape: header with gradient
→ filter bar → grid of cards → empty state. There's no visual variety, no sense
of delight, and no feeling of using a personal cookbook.

This plan goes deeper: **structural layout changes, interaction upgrades, and UX
rethinks** that transform how each page feels to use daily. No schema or API
changes — this is purely frontend.

## Design Principles

1. **Image-first**: Food is visual. Every surface that can show food imagery
   should.
2. **Reduce sameness**: Not every page needs the same header → grid layout. Vary
   the rhythm.
3. **Progressive disclosure**: Show the essential action first, reveal
   complexity on demand.
4. **Cooking context**: The app is used in a kitchen with messy hands. Tap
   targets should be large, text readable at arm's length.
5. **Emotional empty states**: Empty pages are opportunities for warmth, not
   just "no data" messages.
6. **Mobile-native**: Most cooking happens on a phone propped on a counter.
   Design for that first.

---

## Phase 1: Recipe Detail Page Overhaul ✅ IMPLEMENTED

**Files**: `app/routes/recipes/$recipeId.tsx`,
`app/utils/recipe-placeholder.ts`, `app/components/recipe-card.tsx`,
`app/components/recipe-match-card.tsx`

### 1A. Restructure Information Hierarchy ✅

Reorganized into three clear zones:

**Header** (compact, no hero image):

- Decision: hero images were removed entirely from the recipe detail page — even
  for recipes with images. A full-width hero took up half the viewport on
  desktop/laptop and pushed the actual recipe content below the fold. The
  compact layout gets users to the recipe content immediately.
- Back link + serif title (`font-serif text-3xl md:text-4xl`) at the top
- Meta card below the title (`bg-card rounded-2xl shadow-warm-lg`) containing:
  servings with +/- scaling controls, prep/cook/total time, source URL (inline),
  and tag pills

**Content zone** (the recipe itself):

- Two-column layout with swapped ratio: `md:grid-cols-[2fr_3fr]` (ingredients
  get more room)
- Ingredients panel: sticky on desktop (`md:sticky md:top-20 md:self-start`),
  read-only bullet list in normal mode
- Instructions: `space-y-6` breathing room, `size-8` step number circles,
  `text-base` minimum
- Cross-off/checkbox behavior is reserved for cooking mode only — normal mode
  shows a clean read-only view. This gives cooking mode a clear purpose.
- "My Notes" promoted above the content zone as an accent-bordered callout
- Description shown between meta card and content

**History zone** (below the fold):

- Cooking history collapsed by default behind a clickable header with chevron
  and count ("Cooking History (5)")

### 1B. Redesign the Action Bar ✅

- **Mobile**: floating action bar fixed at `bottom-20 inset-x-4 z-30` (above
  bottom nav), `bg-card/95 backdrop-blur-md`. Primary "Start Cooking" button +
  icon-only Favorite and Edit
- **Desktop**: inline action bar with "Start Cooking" as primary button,
  Favorite and Edit with tooltips
- "I Made This" and "Keep Awake" removed from the action bar — "I Made This"
  moved to cooking mode completion flow, wake lock auto-activates in cooking
  mode

### 1C. Cooking Mode ✅

Activated via "Start Cooking" button, `?cooking=true` URL param for
bookmarkability.

- **Hides**: tags, description, source URL, cooking history, notes, raw text,
  edit button
- **Shows**: compact title + "Cooking mode" subtitle, ingredients panel,
  instructions, timer FAB, "Done Cooking" button
- **Mobile step paginator**: one step at a time, large text (`text-lg`), step
  counter ("Step 2 of 8"), progress dots for navigation, Previous/Next buttons.
  Last step shows green "Done Cooking" button
- **Desktop**: all steps visible, current step highlighted with
  `border-l-4 border-accent bg-accent/5` and "Current Step" label
- **Auto-advance**: checking off a step automatically advances the "current
  step" marker to the next unchecked step
- **Ingredients**: sticky sidebar on desktop, collapsible drawer on mobile with
  toggle button. Includes servings scaling controls
- **Ingredient/step cross-off**: checkbox-style circles for ingredients, step
  checking with visual feedback — this interactive behavior only exists in
  cooking mode
- **"Done Cooking" modal**: celebratory bottom sheet/modal ("Nice work!") with
  date picker, star rating, notes, inventory subtraction checkbox, Save/Skip
  buttons
- **Wake Lock**: auto-activates on entering cooking mode, deactivates on exit
- **Exit**: "Exit" button in header, or browser back

### 1D. Better Image Placeholder ✅

- Created shared `app/utils/recipe-placeholder.ts` utility
- Deduplicated `getRecipeGradient()` from `recipe-card.tsx` and
  `recipe-match-card.tsx`
- 6 warm color themes (terracotta, sage, golden, dusty rose, slate blue, warm
  plum) with dark mode variants
- Deterministic selection based on title hash
- Applied to card components only (recipe detail page has no image display)

---

## Phase 2: Discover Page — Make It Exciting (~1 file)

**File**: `app/routes/discover/index.tsx`

Currently: header → expiring section → stats row (makeable count + inventory
count + "Show Only Makeable" toggle) → card grid. It's a filtered list with
numbers. The most exciting page in the app (you can make dinner with what you
already have!) feels like a report.

### 2A. Hero Card for Top Match

Replace the stats line + grid with a **hero treatment for the #1 match**:

- If the user has a 100% match (or highest match): render it as a large card
  spanning full width, `bg-card rounded-2xl shadow-warm-lg overflow-hidden`
- Show the recipe image at `aspect-[2/1]` (wide), title overlaid with gradient
  scrim (same pattern as recipe detail hero)
- Below the image: "You have everything you need" badge (green), missing count
  if not 100%, and a prominent "Let's Cook" button
- On mobile this card should feel like a recommendation from the app —
  "Tonight's Pick" label above it in `font-serif text-accent`

Below the hero: the rest of the matches in the existing grid, but starting from
#2.

### 2B. Visual Match Indicators

Replace the percentage badge (`87% Match`) with a **visual progress ring**:

- Small circular SVG progress indicator (`size-10`) showing the match percentage
  as a filled arc
- Color transitions: green (100-80%), accent/amber (79-50%), muted (below 50%)
- Percentage number centered inside the ring
- This replaces the colored badge on `recipe-match-card.tsx` — more scannable
  than reading "87%"

### 2C. Expiring Items Urgency

Current "Use It Before You Lose It" section is an accent-tinted card with a grid
of match cards. It doesn't convey urgency.

New treatment:

- Show the expiring items themselves as small pills above the recipe
  suggestions: "Spinach (2 days)" "Chicken (3 days)" in warm amber pills
- Recipe cards in this section get a subtle amber left border or top accent
  strip to visually connect them to the expiring items
- If an item expires tomorrow or today: use a more urgent warm red pill with
  `animate-pulse` (subtle)

### 2D. Quick Actions on Match Cards

Add a "Plan This" quick-action button on each match card (small, bottom-right)
that opens a meal-slot picker popover (day + meal type) without navigating away
from Discover. Currently users must: click card → view recipe → go back → go to
plan → add to slot. This shortcut makes Discover → Plan a 2-tap flow.

**Complexity note**: This requires submitting a form action to create a meal
plan entry from the discover page. Reuse the existing `assignRecipe` action
pattern from `plan/index.tsx` via a `useFetcher` POST to `/plan`. No new API
route needed, but the popover UI (day picker + meal type selector) is
non-trivial. Consider deferring this to a later pass if it slows down the core
visual work.

---

## Phase 3: Meal Plan — Visual and Inviting ✅ IMPLEMENTED

**Files**: `app/routes/plan/index.tsx`, `app/components/meal-plan-calendar.tsx`,
`app/components/meal-slot-card.tsx`

The 7-column grid was functional but horizontally cramped — recipe titles
truncated after a few characters and the page felt like a spreadsheet.

### 3A. Two-Row Calendar Layout ✅

Replaced the 7-column grid with a **two-row layout**: Mon–Thu (4 columns) on
top, Fri–Sun (3 columns + empty cell) below. Both rows use `grid-cols-4` for
consistent column widths. Each day gets ~25% width instead of ~14%, giving
recipe titles nearly double the breathing room. Cards with multiple entries use
subtle `divide-border/50` separators between recipes.

### 3B. Meal Slot Cards with Recipe Images — SKIPPED

Thumbnails (`size-10`) were implemented and tested but **removed** — in the
narrow card columns they consumed too much horizontal space and cluttered the
layout without adding enough value. The two-row layout improvement made this
unnecessary.

### 3C. Compact Card Layout ✅

- "Add Another" button moved from a full-width button in the card body to a
  small `+` icon in the card header's top-right corner
- Saves a full line of vertical space per filled card

### 3D. Today Column Emphasis ✅

- Desktop: today's header uses a filled badge
  (`bg-accent text-accent-foreground rounded-full px-3 py-0.5 text-xs font-semibold`)
- Desktop: today's column gets a subtle `bg-accent/5` background
- Mobile: today's card gets `border-t-2 border-accent`

### 3E. Mobile Calendar Improvements ✅

- Auto-scroll to today on mount via `useRef` + `useEffect` +
  `scrollIntoView({ behavior: 'smooth', inline: 'center' })`
- Summary line per day card: "3 meals planned" or "Nothing planned yet" in
  `text-xs text-muted-foreground`

### 3F. Empty Meal Plan Welcome ✅

Replaced the dashed `bg-muted/30` empty state with a warm card:
`bg-card rounded-2xl shadow-warm-lg p-8 text-center` with `font-serif text-xl`
"Plan Your Week" heading, conversational subtitle, and dual CTAs ("Browse
Recipes" → `/recipes`, "See What You Can Make" → `/discover`). Single "Add Your
First Recipe" CTA if no recipes exist.

### 3G. Overlap Summary Redesign ✅

Replaced the expandable `MealPlanWasteAlerts` dropdown (which showed an
overwhelming wall of shared ingredient details) with a **compact inline
summary**: a solid `bg-accent` badge showing the overlap percentage and shared
ingredient count, followed by inline "Pairs well:" links to the top 3 recipe
suggestions ranked by shared ingredient count. The old component
(`meal-plan-waste-alerts.tsx`) was deleted.

---

## Phase 4: Inventory — Dashboard Feel (~2 files)

**Files**: `app/routes/inventory/index.tsx`,
`app/components/inventory-item-card.tsx`

Currently: location tabs → grid of cards. It's a list. A daily-use inventory
page should immediately surface what matters.

### 4A. Dashboard Summary Strip

Add a horizontal strip below the header (before tabs) with 3 quick-stat cards:

- **Expiring Soon**: count of items expiring within 7 days, amber-tinted,
  clickable (scrolls to/filters those items)
- **Low Stock**: count of items flagged low stock, with a subtle badge
- **Total Items**: plain count

Each stat card: `bg-card rounded-xl border p-3 text-center min-w-[100px]` in a
horizontal scroll on mobile, flex row on desktop. Tapping "Expiring Soon" could
filter the list to only show those items (add a URL param `?filter=expiring`).

### 4B. Expiring Items Callout

If any items expire within 3 days, show a prominent card above the grid:

- Amber/warm-red background tint
- Lists the items by name with days remaining: "Chicken breast — expires
  tomorrow", "Spinach — 2 days left"
- CTA: "Find recipes to use these" → links to `/discover` (which already has the
  "Use It Before You Lose It" feature)

This creates a natural daily workflow: check inventory → see what's expiring →
discover recipes → plan meals.

### 4C. Item Cards: Show Expiry Countdown

Current item cards show "Expired", "Expires soon", or a date. Replace with a
human-readable countdown:

- "Expires tomorrow" (amber)
- "Expires in 3 days" (muted amber)
- "Expires Feb 15" (muted, if >7 days)
- "Expired 2 days ago" (red, if past)

This is more scannable than a formatted date string.

### 4D. Location Sections with Visual Identity

When viewing "All", each location section (Pantry, Fridge, Freezer) currently
has a colored dot and a heading. Give each section a subtle distinct identity:

- Section header: location name with its icon and a count badge
- Subtle background tint per section: `bg-amber-50/30` for pantry (warm),
  `bg-blue-50/30` for fridge (cool), `bg-cyan-50/30` for freezer (cold). In dark
  mode: `dark:bg-amber-950/20` etc.
- This creates visual separation without heavy borders or dividers

---

## Phase 5: Recipe List — Add Variety and Sort Options (~1 file)

**File**: `app/routes/recipes/index.tsx`

### 5A. Sort Options

Currently recipes are sorted by `updatedAt` desc only. Add a sort dropdown next
to the search:

- Recently updated (default)
- Most cooked
- Recently cooked
- Alphabetical
- Newest first

Implement as URL param `?sort=most-cooked` so it's bookmarkable. Each option
maps to a Prisma `orderBy`.

### 5B. Recipe Count and Active Filter Summary

Move the recipe count from the header into the filter bar area, alongside active
filter information. When filters are active, show: "12 of 47 recipes · Filtered
by: Italian, <30min" with a clear-all link. This grounds the user in what
they're looking at.

### 5C. Tag Pills with Category Colors

Currently all tag pills look the same. Add subtle category-based tinting:

- Cuisine tags (Italian, Mexican, etc.): warm olive tint
- Meal-type tags (breakfast, dinner, etc.): warm amber tint
- Dietary tags (vegetarian, gluten-free, etc.): warm sage tint

When selected, they all use the accent color. When unselected, the category tint
gives visual grouping without requiring explicit section headers.

### 5D. Grid Density

The 3-column grid is good for desktop browsing but on a phone, each card takes
significant vertical space. Consider a compact list view toggle:

- **Grid** (default): current card layout
- **List**: horizontal rows with small thumbnail, title, cook time, tags on one
  line. Fits ~6 recipes on a phone screen vs ~2 in grid mode

Toggle via an icon button pair (grid icon / list icon) in the filter bar,
persisted in URL param `?view=list`.

---

## Phase 6: Shopping List — More Delightful (~2 files)

**Files**: `app/routes/plan/shopping-list.tsx`,
`app/components/shopping-list-item.tsx`

### 6A. Progress Bar

Add a visual progress bar at the top of the list (below the header) showing
checked/total items. A thin horizontal bar: `h-1.5 rounded-full bg-muted` with a
fill of `bg-accent` animated with `transition-all duration-300`. Percentage
label to the right.

This creates a satisfying "checking things off" feel. The current "X of Y
checked" text in the header is functional but not visual.

### 6B. Category Sections as Collapsible

Each store section (Produce, Dairy, Meat, etc.) becomes collapsible with a
chevron. Fully-checked sections auto-collapse to reduce clutter as the user
shops. Section header shows checked count: "Produce (3/5)".

### 6C. Swipe to Check (mobile) — Stretch Goal

On mobile, add swipe-right gesture on items to toggle checked state (in addition
to the tap checkbox). Use a CSS transform-based swipe with a green accent reveal
behind the item. This feels native and fast for one-handed shopping use.

**Complexity note**: Reliable touch swipe detection without a library (to match
our "no third-party UI libraries" constraint) is finicky — needs
`touchstart`/`touchmove`/`touchend` handling with threshold logic, conflict
avoidance with scroll, and snap-back animation. Mark as stretch goal: nice to
have, skip if it takes more than a day. The existing tap checkbox is already a
fine interaction.

### 6D. Recently Bought Items

When the manual add form is focused, show a "Recently bought" section below it
with the last 5-10 unique items the user has added manually to any shopping
list. These appear as quick-tap pills. This reduces typing for items bought
weekly.

**Implementation note**: Requires adding a query to the shopping list loader to
fetch recent distinct item names. This is a loader data change, not a schema
change — the data already exists in the `ShoppingListItem` table.

---

## Phase 7: Navigation & Shell Polish (~3 files)

**Files**: `app/root.tsx`, `app/components/bottom-nav.tsx`,
`app/components/user-dropdown.tsx`

### 7A. Global Quick Search

Add a search icon button in the header (between nav links and notification bell
on desktop, in the header on mobile). Clicking it opens a command-palette style
modal:

- `bg-card rounded-2xl shadow-warm-lg border` modal centered on screen
- Single search input, auto-focused
- Results grouped: Recipes (by title), Inventory Items (by name)
- Keyboard shortcut: `Cmd+K` / `Ctrl+K` on desktop
- This replaces needing to navigate to the recipes page just to search

Implementation: a resource route (`resources/quick-search.tsx`) that queries
recipe titles and inventory item names on demand via `useFetcher`. Avoids
bloating the root loader with search data on every page load — only fetches when
the search modal opens. Debounce the input at 200ms. At 500+ recipes this is
still fast since it's just title/name columns with a `contains` filter.

### 7B. Mobile Bottom Nav — Active Route Animation

Current bottom nav: icon + label with a pill background on active. Add a subtle
slide animation when switching between routes — the active pill indicator
smoothly slides between positions using CSS `transition-all` on a pseudo-element
that tracks the active index position.

### 7C. User Dropdown Enhancements

Add the user's name (or first letter avatar if no profile image) as visible text
on desktop, not just an icon. Show the household name below if in a household.
This personalizes the header.

---

## Phase 8: Recipe Form — Mobile-Friendly (~2 files)

**Files**: `app/components/recipe-form.tsx`,
`app/components/ingredient-fields.tsx`

The recipe form is one of the longest pages in the app. On mobile it's a single
vertical scroll through Photo → Details → Tags → Ingredients → Instructions. The
development plan backlog specifically calls out "Recipe form length on mobile"
as a UX issue.

### 8A. Collapsible Sections

Wrap each form section (Photo, Details, Tags, Ingredients, Instructions) in a
collapsible `<details>` element (or a Collapsible component from shadcn) with a
section header that shows completion state:

- "Photo" — shows thumbnail preview or "No photo" in the header when collapsed
- "Details (3/6 filled)" — shows how many optional fields are filled
- "Tags (2 selected)" — shows count
- "Ingredients (5)" — shows count
- "Instructions (4 steps)" — shows count

On initial load for new recipes: Details expanded, others collapsed. On edit:
all expanded (user is likely editing a specific section).

### 8B. Fix Servings/Time Grid on Mobile

Current: `grid-cols-3` for servings, prep time, cook time — fixed 3 columns
regardless of screen width. On narrow phones (~320px) these fields are cramped.

Fix: `grid-cols-1 sm:grid-cols-3` — stack vertically on small phones, 3-column
on wider screens.

### 8C. Ingredient Row Improvements

Current ingredient rows are functional but dense. Improvements:

- Add a drag handle hint (grip icon, `text-muted-foreground/30`) to suggest
  reorderability (even if drag-and-drop isn't implemented yet, the visual
  language communicates "these are ordered")
- On mobile, stack the amount/unit fields below the name field instead of
  inline. Current inline layout works on desktop but can feel cramped on phones
- Larger remove button tap target (`size-9` not `size-7`)

---

## Phase 9: Empty States with Personality (~across all route files)

Empty states are currently: centered icon + heading + description + CTA button.
They're informative but cold.

### Principles for new empty states:

- Use `font-serif` headings with a warm, conversational tone
- Replace generic icons with contextual mini-illustrations (CSS-based or simple
  SVG compositions)
- Add a subtle entrance animation (`animate-fade-up`)
- Give each empty state a unique personality message:

**Recipes (no recipes)**: "Your cookbook is empty — every great collection
starts with one recipe."

**Recipes (no filter matches)**: "Nothing matches those filters. Try broadening
your search or [clear all filters]."

**Inventory (empty)**: Current pantry staples onboarding is good — keep it.

**Meal Plan (empty)**: "A blank canvas for the week ahead. What sounds good?"

**Discover (no inventory, no recipes)**: "Add some recipes and stock your pantry
— then we'll show you what you can make tonight."

**Discover (no matches)**: "None of your recipes match what's in your kitchen
right now. Time to go shopping or [add new recipes]?"

**Shopping List (empty)**: "Nothing on the list. Generate one from your [meal
plan] or add items manually."

**Cooking History (no logs on recipe page)**: "You haven't cooked this yet. Give
it a try!"

---

## Phase 10: Landing Page — Sell the Experience (~1 file)

**File**: `app/routes/_marketing/index.tsx`

Note: The CTA already correctly links to `/signup` (this was fixed previously).
Focus is on layout and messaging.

### 10A. Hero Overhaul

Current: small cookie icon + title + description + button. It's generic.

New hero:

- Much larger heading:
  `text-5xl md:text-7xl font-serif font-bold tracking-tight`
- Subheading with personality: "Your recipes. Your pantry. Your plan. One
  place." (not "Track recipes and plan meals")
- CTA: "Start Cooking — It's Free" with a more compelling label than "Get
  Started"
- Secondary CTA: "See how it works" → smooth scrolls to features section
- Background: subtle warm gradient or food-inspired pattern

### 10B. Feature Section as Story

Replace the 2x2 grid of feature cards with a **scrolling narrative**:

1. "Import your favorite recipes" — with a mock recipe card visual
2. "Track what's in your kitchen" — with a mock inventory strip
3. "Plan meals that share ingredients" — with a mock calendar snippet
4. "Generate a smart shopping list" — with a mock checklist

Each section alternates: visual left + text right, then text left + visual
right. This tells a story instead of listing features.

### 10C. Social Proof Area

Add a section (can be static content initially, real testimonials later):

- "Built for home cooks who care about what they eat" heading
- 2-3 persona cards: "Sarah, meal-prep Sunday enthusiast", "Marcus, zero-waste
  kitchen", "The Chen family, shared meal planning" — each with a short quote
  about the workflow
- Even if fictional initially, this humanizes the product

---

## Dark Mode Considerations

Several new patterns introduce elements that need explicit dark mode treatment:

- **Recipe placeholder colors** (Phase 1D, done): All 6 placeholder themes have
  explicit `dark:` variants (e.g. `bg-orange-50 dark:bg-orange-950/30`).
- **Floating meta card** (Phase 1A, done): `bg-card` already respects theme.
  `shadow-warm-lg` works with border fallback.
- **Progress ring SVG** (Phase 2B): Use `stroke="currentColor"` with Tailwind
  color classes so ring inherits theme colors.
- **Location section tints** (Phase 4D): Light mode uses `bg-amber-50/30` etc.
  Dark mode needs `dark:bg-amber-950/20` etc. (already noted in 4D).
- **Expiry urgency pills** (Phase 2C, 4B): Amber/red pills need dark variants.
  Use the existing pattern:
  `bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200`.

**Rule of thumb**: Every hardcoded color (not from the theme system) needs a
`dark:` variant. Prefer semantic colors (`bg-accent`, `text-muted-foreground`)
over raw colors wherever possible.

---

## Implementation Order

1. **Phase 1 (Recipe Detail + Cooking Mode)** ✅ — Highest daily-use impact.
   Cooking mode is the flagship new feature.
2. **Phase 2 (Discover)** — Second most unique page, biggest "wow" potential.
3. **Phase 3 (Meal Plan)** ✅ — Two-row layout, compact cards, overlap redesign.
4. **Phase 9 (Empty States)** — Quick wins, personality injection, can do
   alongside any phase.
5. **Phase 4 (Inventory)** — Dashboard treatment improves daily check-in flow.
6. **Phase 5 (Recipe List)** — Sort and density options improve browsing.
7. **Phase 8 (Recipe Form)** — Mobile UX fixes, directly supports the recipe
   creation workflow.
8. **Phase 7 (Navigation)** — Global search is high-value but can wait for core
   pages.
9. **Phase 6 (Shopping List)** — Progress bar and collapsible sections are
   polish. Swipe-to-check is a stretch goal.
10. **Phase 10 (Landing Page)** — Important for conversions but doesn't affect
    daily use.

Phases 1-3 are structural rethinks. Phases 4-10 are enhancements and polish.
Each phase is independently deployable.

## Files Summary (~18 primary files)

| Phase             | Files                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| 1 (Recipe Detail) | `recipes/$recipeId.tsx`, `recipe-card.tsx`, `recipe-match-card.tsx`, new shared `utils/recipe-placeholder.ts` |
| 2 (Discover)      | `discover/index.tsx`, `recipe-match-card.tsx`                                                                 |
| 3 (Meal Plan)     | `plan/index.tsx`, `meal-plan-calendar.tsx`, `meal-slot-card.tsx`                                              |
| 4 (Inventory)     | `inventory/index.tsx`, `inventory-item-card.tsx`                                                              |
| 5 (Recipe List)   | `recipes/index.tsx`                                                                                           |
| 6 (Shopping List) | `plan/shopping-list.tsx`, `shopping-list-item.tsx`                                                            |
| 7 (Navigation)    | `root.tsx`, `bottom-nav.tsx`, `user-dropdown.tsx`, new `resources/quick-search.tsx`                           |
| 8 (Recipe Form)   | `recipe-form.tsx`, `ingredient-fields.tsx`                                                                    |
| 9 (Empty States)  | Across all route files (text/class changes only)                                                              |
| 10 (Landing Page) | `_marketing/index.tsx`                                                                                        |

## Verification

After each phase:

- `npm run dev` — visual inspection in **both light and dark modes**, mobile +
  desktop
- `npm run typecheck` — no type errors
- `npm run lint` — no lint issues
- `npm test` — all existing tests pass (no logic changes except cooking mode URL
  param)
- Manual: check that cooking mode works on actual phone (large tap targets,
  readable at arm's length)
- Manual: verify dark mode doesn't have invisible shadows, unreadable text, or
  missing color variants

## Non-Goals

- **No schema changes.** All data stays the same.
- **No new API routes** except: a `resources/quick-search.tsx` route for global
  search (Phase 7), and a loader query addition for recently bought items (Phase
  6D).
- **No third-party UI libraries.** Everything built with existing Tailwind +
  shadcn primitives. Touch gestures (6C) are stretch goals that may be cut.
- **No breaking URL changes.** Cooking mode uses a query param. Sort/view/filter
  use query params. All existing URLs continue to work.

## Pages Intentionally Not Changed

- **Settings (`settings/profile/index.tsx`)** — Already well-organized with card
  sections, icons, and hover states. No redesign needed.
- **Prep list (`plan/prep-list.tsx`)** — Clean and functional. Could benefit
  from visual grouping later but not a priority.
- **Auth pages (`_auth/*`)** — Standard login/signup forms. Functional and fine.
- **Recipe edit (`recipes/$recipeId.edit.tsx`)** — Uses `recipe-form.tsx`, so
  Phase 8 improvements cover it automatically.
