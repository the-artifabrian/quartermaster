# Weekly Reset Flow — Design

## Problem

The "what should I cook this week?" moment has no dedicated surface. Users
open the meal plan page, see an empty week, and have to manually browse
recipes, remember what's expiring, and recall favorites. The weekly reset flow
stitches existing signals (expiring inventory, favorites, inventory match) into
one guided planning moment.

## Solution

A dedicated page at `/plan/new-week` with a weekend nudge banner on `/plan`.
Single scrollable page with curated recipe suggestions, a mini week calendar
for assigning meals, and a finish action to generate the shopping list.

## Entry Points

### Weekend nudge banner

Appears on `/plan` when all conditions are met:

- Day is Saturday or Sunday
- Next week's meal plan has zero entries
- User hasn't dismissed it this weekend (localStorage, keyed by next week's
  start date)

Uses the existing `bg-card border-border shadow-warm` card pattern (same as
bulk-import nudge). Content: "Ready to plan next week?" with primary CTA "Plan
your week" and secondary "Browse recipes first" link. Dismissible with X
button.

### Persistent link

A "Plan next week" link in the week navigation area, visible when viewing
current or past week and next week has no entries. Always available — no
conditions beyond next week being empty.

Both link to `/plan/new-week?week=YYYY-MM-DD` (next Monday).

## Page Layout: `/plan/new-week`

Single scrollable page, mobile-first. Three zones:

### 1. Suggestion cards

Horizontal-scroll rows, one per category. Each card shows recipe name, reason
for suggestion, and an [+ Add] button. Categories in order:

**Use these up** — Recipes containing ingredients expiring within 7 days.
Sorted by soonest expiry. Each card shows the expiring ingredient name +
countdown ("salmon 2d"). Uses existing recipe-ingredient matching. Omitted if
no expiring items.

**Favorites** — Recipes with `isFavorite: true`, sorted by least-recently-
cooked (via CookingLog). Skips any cooked in the last 7 days. Each card shows
days since last cook. Omitted if no favorites.

**Ready to cook** — Highest inventory match percentage, excluding recipes
already shown in above categories. Each card shows match fraction ("8/10
ingredients"). Top 6. Omitted if no inventory.

### 2. Day/meal picker

Tapping [+ Add] on a suggestion card opens a popover (desktop) or bottom sheet
(mobile):

- 7-day grid (Mon–Sun) for picking the day
- Meal type selector defaulting to "dinner" (breakfast/lunch/dinner/snack)
- Tap a day to assign; popover closes

After assignment the suggestion card shows a checkmark overlay and the mini
calendar updates.

### 3. Mini week calendar

Compact 7-day strip at the bottom showing assigned recipes (thumbnail or
letter placeholder + name). Tapping an empty [+] slot opens the full recipe
picker (same component used on the main plan page). Tapping an assigned recipe
shows a remove option.

Below the calendar: "{N} dinners planned" counter and two actions:

- **Generate shopping list** — runs existing generation for this week, then
  navigates to `/shopping`
- **Done, go to my week** — navigates to `/plan?week=YYYY-MM-DD`

## Suggestion Ranking

Priority order within each category:

1. **Use these up**: Sort by earliest expiry date of matched ingredient. If a
   recipe matches multiple expiring items, use the soonest one. Cap at 6.
2. **Favorites**: Sort by `lastCookedAt` ascending (longest since last cook
   first). Exclude if cooked within last 7 days. Cap at 6.
3. **Ready to cook**: Sort by match percentage descending. Exclude recipes
   already in categories 1 or 2. Cap at 6.

## Data Flow

### Loader

- Requires Pro tier (redirect to `/upgrade` otherwise)
- Accepts `?week=YYYY-MM-DD` param, defaults to next Monday
- Parallel queries:
  - Expiring inventory items (next 7 days) + recipe matching
  - Favorite recipes + last cook date from CookingLog
  - All recipes with inventory match percentages (existing matching logic)
  - Current meal plan entries for this week (for mini calendar state)

### Actions

No new mutations. Reuses existing:

- Assign recipe → `assign` action on `/plan` (POST)
- Remove entry → `remove` action on `/plan` (POST)
- Generate shopping list → existing `/shopping` generate action

## Edge Cases

- **Next week already has entries** — page works additively. Mini calendar
  shows existing entries. Suggestions still appear.
- **All suggestion sections empty** — show the mini calendar with empty state
  text ("No suggestions right now") and a "Browse all recipes" link.
- **Nudge dismissed but user navigates directly** — page always works; dismiss
  only hides the banner.
- **Household co-user** — all data is household-scoped. Both users see the
  same plan and can both use the flow.
- **Past week parameter** — redirect to current next-week if the week param is
  in the past.

## Non-goals

- No auto-fill / AI-generated plan — user picks recipes manually
- No template integration on this page (templates already work from `/plan`)
- No meal type intelligence ("quick meals on weeknights") — keep it simple,
  revisit if users ask
