# Quartermaster - Recipe Management App Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application built to
replace 100+ recipes scattered across Apple Notes. It provides searchable recipe
storage, kitchen inventory tracking, meal planning, and smart shopping list
generation.

> For tech stack, architecture, commands, database schema, and route structure,
> see [CLAUDE.md](../CLAUDE.md).

---

## What's Built (Phases 1-11) ✅

The app is feature-complete for solo daily use. Here's a summary of everything
implemented across 11 phases of development:

### Recipe Management

- Full CRUD with title, description, servings, prep/cook time, ingredients,
  instructions
- Image uploads (S3-compatible storage, max 3MB)
- 16 predefined tags across cuisine, meal-type, and dietary categories
- Full-text search across title, ingredients, and description
- Tag filtering and cook time filtering with bookmarkable URL params
- Recipe scaling with +/- servings controls and fraction display
- Cooking assistance: tap-to-cross-off ingredients/steps, Wake Lock toggle,
  floating kitchen timer with start/pause/reset
- Favorite/bookmark recipes with filter toggle
- Import from URL (JSON-LD scraping) with duplicate detection, quick text entry,
  JSON export
- "Surprise me" random recipe picker
- Cooking log with star ratings and notes ("I Made This")
- "Last cooked" stats on recipe cards (cook count + relative time ago)
- Personal notes field per recipe ("always double the garlic", "kids don't like
  this")

### Inventory System

- Three locations: Pantry, Fridge, Freezer
- Items with optional quantity, unit, expiration, and low-stock flag
- Quick-add shortcuts for 30 common ingredients
- "What can I make?" discovery page with fuzzy ingredient matching
- Match percentage scoring and missing ingredient highlighting
- Expiration-based recipe suggestions ("Use It Before You Lose It")
- Automatic inventory subtraction after cooking (with unit conversion and
  feedback toast showing what changed)

### Meal Planning & Shopping

- Weekly calendar view (Monday-start, 4 meal types per day)
- Click-to-assign recipes to meal slots, multiple recipes per slot
- Per-entry serving size overrides with +/- controls
- Mark meals as "cooked" with optimistic toggle UI
- Copy week to next week (preserves servings, skips duplicates)
- Auto-generated shopping list with unit-aware ingredient consolidation
- Grouped by store section (produce, dairy, meat, pantry, frozen, bakery, other)
- Inventory-aware: subtracts items already in stock and staple ingredients
- Shopping list → inventory pipeline: check off items to add them to inventory
  with pre-filled name, location, and quantity
- Manual item addition, check-off while shopping, clear checked items
- Print-friendly layout

### UI, SEO & Infrastructure

- Custom color system (sage green + peach accent, OKLch) and typography
- Polished landing page, card designs, empty states, navigation
- Descriptive `<title>`, canonical URLs, Open Graph / Twitter Card meta tags
- JSON-LD Recipe structured data, marketing pages with sitemap
- PWA with service worker: offline access for viewed recipes and meal plan
- 199 unit/integration tests across 16 files
- Deployed on Fly.io with custom domain, HTTPS, and email
- Mobile-first responsive layout with bottom navigation

---

## Roadmap

Priority is driven by daily use — features that remove friction from the core
cooking workflow come first.

### Phase 12: Household Sharing

The biggest architectural change since launch. Cooking is a shared activity —
most households have two people planning meals, shopping, and cooking together.
This phase transforms Quartermaster from a single-user app into a collaborative
one.

#### 12a: Data Model & Core Sharing

- [ ] **Household model** — New `Household` entity that owns recipes, inventory,
      meal plans, and shopping lists. A household has one or more members (users).
      When a user creates an account, they get a default single-person household.
      All existing queries shift from `where: { userId }` to
      `where: { householdId }` — this is the biggest migration. The `userId`
      fields on Recipe, InventoryItem, MealPlan, etc. become `householdId`.
      Keep `createdBy` / `updatedBy` fields on records for attribution.
- [ ] **Invite flow** — Household owner generates an invite link (token-based,
      expires in 7 days). Recipient clicks link → if logged in, joins household;
      if not, signs up then joins. A user belongs to exactly one household at a
      time. Leaving a household creates a new solo one.
- [ ] **Member management UI** — Settings page showing household members, roles
      (owner vs member), pending invites. Owner can remove members and revoke
      invites. Member can leave household.

#### 12b: Real-Time Activity Notifications

- [ ] **Server-Sent Events (SSE) endpoint** — `/resources/household-events` SSE
      stream scoped to the user's household. Emits events when a household member
      modifies shared data: adds to shopping list, changes meal plan, updates
      inventory, etc. SSE over WebSockets because it's simpler (unidirectional,
      works with HTTP/2, no extra server), and RR7's resource routes make it
      natural.
- [ ] **Activity banner / toast** — Client subscribes to the SSE stream.
      Incoming events show as a toast or a subtle banner: "Alex added 3 items to
      the shopping list", "Alex planned Chicken Tikka for Thursday dinner". Tap
      to navigate to the relevant page. Use `useSyncExternalStore` to subscribe
      to the EventSource (same pattern as the offline indicator — external
      browser API). Auto-reconnect on disconnect.
- [ ] **Event recording** — Lightweight `HouseholdEvent` table (householdId,
      userId, type, payload JSON, createdAt) to persist recent activity. Powers
      both the SSE stream and an optional "Recent activity" feed on the
      household settings page. Auto-prune events older than 30 days.

#### Scope & Considerations

This phase touches nearly every query in the app. Plan for a careful migration
strategy: add `householdId` alongside `userId` first, backfill existing data
(each user gets a household), then swap queries. Feature-flag the invite flow
until the data model is stable. SSE adds a persistent connection per client —
fine for a small household app, but add a heartbeat interval and connection
timeout to avoid resource leaks.

### Phase 13: No-Waste Meal Planning

Inspired by [Restaurant Dropout](https://restaurantdropout.substack.com/) (Zoe
Barrie Soderstrom) — plan your week's meals around shared ingredients, prep once,
cook all week. The existing ingredient normalization and synonym matching systems
are the foundation for this.

#### 13a: Ingredient Overlap Scoring

- [ ] **Overlap analysis engine** — Given a set of recipes (e.g. the current
      week's meal plan), compute pairwise ingredient overlap using the existing
      normalization pipeline (`normalizeIngredient`, synonym lookup, core word
      matching). Output: which ingredients appear in 2+ recipes, how many recipes
      share each ingredient, and an overall "efficiency score" for the plan (ratio
      of unique ingredients to total ingredient slots).
- [ ] **"Suggest recipes that pair well"** — When adding a recipe to the meal
      plan, show a ranked list of other recipes sorted by ingredient overlap with
      what's already planned. Reuses the matching engine but inverted: instead of
      matching inventory → recipes, match planned-recipe-ingredients → candidate
      recipes. Helps the user build a week where buying one bunch of cilantro
      covers 3 dinners instead of rotting after one.

#### 13b: Unified Prep List

- [ ] **Weekly prep list generation** — From the meal plan, extract all
      ingredients that appear in 2+ recipes and generate a single "Sunday prep"
      checklist: "Dice 4 onions (Mon stir-fry, Wed soup, Fri tacos)", "Cook 3
      cups rice (Tue bowl, Thu curry)". Group by prep type (chop, cook, marinate,
      etc.). The key insight from restaurant kitchens: prep your shared
      ingredients once, store them, assemble meals throughout the week.
- [ ] **Prep freshness guidance** — Flag ingredients where prep-ahead has limits.
      Avocado or fresh herbs can't be prepped 5 days early. Simple heuristic
      rules (not AI): a small lookup table of ingredients with max-prep-ahead
      days. Items beyond their window get a note: "Prep this the day of" or
      "Prep max 2 days ahead."

#### 13c: Plan Efficiency Dashboard

- [ ] **Overlap visualization on meal plan** — Show a small badge or indicator
      on the meal plan view: "This week: 34 ingredients, 22 unique (65%
      efficiency)". Tapping it shows which ingredients bridge which meals. Makes
      the waste-reduction benefit tangible and gamifies building efficient plans.
- [ ] **Waste alerts** — When the meal plan has ingredients used in only one
      recipe that are typically sold in bulk (a whole bunch of parsley, a full
      can of coconut milk), suggest: "You're only using parsley in one recipe
      this week. Add [Tabbouleh] to use the rest?" Ties into the overlap
      suggestion engine from 13a.

#### Why This Works Here

Quartermaster already has the hardest pieces: ingredient normalization that
strips modifiers and handles plurals, a synonym database with ~20 groups, and
multi-level fuzzy matching. The overlap engine is essentially the recipe-matching
algorithm run sideways — instead of "what can I make with my inventory?", it's
"what shares ingredients with my plan?" The prep list is a grouped, annotated
version of the shopping list generator. This phase is high-value with relatively
low new infrastructure.

### Backlog

Lower-priority items to reconsider later:

- [ ] **AI: Receipt scanning → inventory** — Photo of grocery receipt, AI
      extracts items and guesses storage locations. Review/confirm before adding.
- [ ] **AI: Ingredient substitutions** — When an ingredient is missing, suggest
      contextual alternatives ("No buttermilk? Use 1 cup milk + 1 tbsp lemon
      juice").
- [ ] **Nutrition estimates** — Hit a nutrition API (Nutritionix or Edamam) for
      estimated calories and macros on recipe detail pages.
- [ ] **Monthly cooking summary** — Stats from cooking logs: meals cooked, most-
      made recipes, average rating. Light analytics, not diet tracking.
- [ ] **Public recipe sharing** — `/r/$recipeId` public read-only route with
      JSON-LD, OG tags, and sitemap. Opt-in per recipe.
- [ ] Bulk import (paste-and-parse for Apple Notes at scale)
- [ ] Performance audit (query profiling, lazy load images, bundle analysis)

---

## Success Metrics

- [x] Can find any recipe in < 5 seconds
- [x] Discover recipes based on available ingredients
- [x] Weekly meal planning with one-click shopping lists
- [x] App is usable in the kitchen (wake lock, tap-to-cross-off, timer, offline)
- [x] Deployed and accessible on mobile
- [ ] 50+ real recipes imported (replacing Apple Notes as primary store)
- [x] Data is backed up / exportable (JSON export)
- [x] App has its own visual identity (custom color system + typography)
- [ ] Household sharing: two people use the same recipe library and meal plan
- [ ] Weekly meal plans regularly achieve 60%+ ingredient efficiency

---

_Document created: February 2026. Last updated: February 9, 2026 — completed
Phase 11 (PWA offline, cooking timer, personal notes, duplicate detection,
shopping→inventory pipeline, inventory subtraction feedback). Compacted Phases
1-11 into "What's Built". Added Phase 12 (Household Sharing with real-time
notifications) and Phase 13 (No-Waste Meal Planning). Moved AI features and
nutrition to backlog._
