# Quartermaster - Recipe Management App Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application built to
replace 100+ recipes scattered across Apple Notes. It provides searchable recipe
storage, kitchen inventory tracking, meal planning, and smart shopping list
generation.

> For tech stack, architecture, commands, database schema, and route structure,
> see [CLAUDE.md](../CLAUDE.md).

---

## What's Built (Phases 1-5) ✅

The MVP is complete and deployed. Here's a summary of everything implemented:

### Recipe Management

- Full CRUD with title, description, servings, prep/cook time, ingredients,
  instructions
- Image uploads (S3-compatible storage, max 3MB)
- 16 predefined tags across cuisine, meal-type, and dietary categories
- Full-text search across title, ingredients, and description
- Tag filtering with bookmarkable URL params
- Recipe scaling with +/- servings controls and fraction display
- Cooking assistance: tap-to-cross-off ingredients/steps, Wake Lock toggle

### Inventory System

- Three locations: Pantry, Fridge, Freezer
- Items with optional quantity, unit, expiration, and low-stock flag
- Quick-add shortcuts for 30 common ingredients
- "What can I make?" discovery page with fuzzy ingredient matching
- Match percentage scoring and missing ingredient highlighting

### Meal Planning

- Weekly calendar view (Monday-start, 4 meal types per day)
- Click-to-assign recipes to meal slots, multiple recipes per slot
- Week navigation (previous/next/current)
- Mobile-optimized with horizontal scroll

### Shopping List

- Auto-generation from meal plan with ingredient consolidation
- Grouped by store section (produce, dairy, meat, pantry, frozen, bakery, other)
- Inventory-aware: subtracts items already in stock and staple ingredients
- Manual item addition, check-off while shopping, clear checked items

### Infrastructure

- Deployed on Fly.io with custom domain, HTTPS, and email
- Session-based auth with per-user recipe libraries
- New user onboarding with recommended pantry staples checklist
- Mobile-first responsive layout with bottom navigation
- Responsive grid (1 col / 2 col / 3 col)

---

## Roadmap

Priority is driven by daily use — features that remove friction from the core
cooking workflow come first.

### Phase 5: Recipe Growth & Quick Access

**Goal**: Get real recipes into the app fast and make the collection easy to
navigate

- [x] **Import from URL** - Scrape recipes from websites using JSON-LD
      structured data. This is the fastest path to growing the collection from
      web sources.
- [x] **Quick recipe entry** - Paste-and-save freeform text input for recipes
      that don't come from a URL. Many Apple Notes recipes are plain text —
      making users fill every structured field (dynamic ingredient arrays,
      separate amount/unit/notes per ingredient) is too slow for bulk migration.
      A simple title + text body that can be structured later.
- [x] **Favorite/bookmark recipes** - Boolean field + filter. Low effort, high
      daily value for quick access to go-to recipes.
- [x] **Recipe source URL** - Store where a recipe came from (useful alongside
      URL import).
- [x] **"Surprise me"** - Random recipe from collection. Trivial to implement
      (single random query), adds personality to the app once the collection
      grows. No reason to wait for a later phase.
- [x] **JSON export** - Download all recipes as JSON for backup. Important for
      data safety, but the app is already deployed on Fly.io with a managed
      database — this isn't as urgent as getting recipes in.

### Phase 6: UI Refresh & Onboarding Overhaul

**Goal**: Make the app feel like its own product, not a styled Epic Stack
template. Remove training wheels and let real features carry the experience.

The color system (sage green + peach accent, OKLch) and typography scale are
already custom. But page layouts, cards, forms, and navigation still follow
generic shadcn/Epic Stack patterns. This phase focuses on the areas with the
highest visual impact. Do this after importing real recipes so you're designing
around actual content, not sample data.

- [x] **Landing page redesign** - The homepage should explain what Quartermaster
      is and why it exists: recipe management, inventory tracking, meal planning,
      and smart shopping lists. Show the value proposition clearly for new
      visitors and provide a compelling entry point. Currently it's a generic
      Epic Stack landing page that says nothing about the app.
- [x] **Remove sample recipe/inventory seeding** - Delete
      `prisma/seed-sample-data.ts` and remove all `seedSampleData()` calls:
      `seed.ts` (kody dev user), `auth.server.ts` (email signup + OAuth signup).
      Now that URL import and quick text entry exist, auto-seeding 18 recipes
      and 38 inventory items is clutter, not help. New users start with an empty
      library and use the import/entry tools to build their own collection.
      Update CLAUDE.md references to sample data accordingly.
- [x] **Recommended pantry staples** - Replace auto-seeded inventory with an
      opt-in "recommended pantry staples" feature. Show a curated checklist of
      common staples (oils, spices, flour, sugar, salt, etc.) on the empty
      inventory state or as part of a first-use onboarding step. Users select
      what they actually have and add with one tap. Better than force-feeding 38
      items because it reflects what the user actually owns. Can reuse/expand the
      existing quick-add shortcuts (30 common ingredients) as a starting point.
- [ ] **Page headers and visual hierarchy** - All pages currently use the same
      flat pattern: `text-2xl font-bold` title + content. Add section
      backgrounds, visual grouping, and better spacing to create distinct page
      identities. The recipe list, meal plan, and inventory pages should each
      feel purpose-built, not like the same template three times.
- [ ] **Card redesign** - Recipe cards, inventory cards, and meal slot cards all
      use identical `border bg-card rounded-lg shadow-sm` styling. Differentiate
      them: recipe cards should emphasize the image and quick info (time, tags),
      inventory cards should make location and status (expiring, low stock) more
      scannable, meal plan cards should be compact and calendar-appropriate.
- [ ] **Search and filter UI** - The recipe search is a plain input with an icon
      overlay, and tag filters are basic pill buttons. Add better visual
      feedback on active filters, filter counts, and a more polished search
      experience.
- [ ] **Navigation active states** - Desktop nav links have no active state
      indicator. Bottom nav uses only color change. Add clear visual indicators
      for the current page on both desktop and mobile.
- [ ] **Recipe detail page** - This is the most-viewed page (you look at it
      every time you cook). Give it a dedicated layout: hero image, clear
      ingredient/instruction sections, better scaling controls, and a more
      immersive cooking-mode feel.
- [ ] **Form layout** - Recipe creation form has no visual grouping between
      sections (basic info, tags, ingredients, instructions, image). Add section
      dividers or cards to make the form scannable and less intimidating.
- [ ] **Empty states** - Current empty states are icon + text + button. Add more
      personality — these are the first thing new users see and the thing
      returning users see when they haven't added content to a section yet.

### Phase 7: Shopping List Accuracy & Smarter Planning

**Goal**: Fix data quality issues that compound as the recipe collection grows,
and reduce meal planning friction

- [ ] **Fix shopping list ingredient normalization** - BUG:
      `shopping-list.server.ts` uses simple `toLowerCase().trim()` for
      consolidation, while the discovery system uses the full
      `normalizeIngredientName()` with modifier stripping, plural handling, and
      synonym resolution. This causes duplicate shopping list entries (e.g.,
      "Fresh Garlic" and "garlic, minced" appear as separate items). Reuse the
      existing normalization function.
- [ ] **Ingredient auto-suggest in recipe forms** - Suggest from existing
      ingredient names as the user types. Currently the ingredient name field is
      completely free-form with zero guidance, which causes naming drift
      ("parmesan" vs "parmesan cheese", "chicken breast" vs "chicken"). This
      directly degrades discovery matching accuracy and shopping list
      consolidation. More impactful than it sounds.
- [ ] **Meal plan serving sizes** - Add a `servings` field to MealPlanEntry so
      users can specify how many servings they want when assigning a recipe to a
      meal slot. Currently, the shopping list always uses the recipe's default
      serving count — if a recipe serves 4 but you're cooking for 2, you buy
      double what you need. Wire scaled amounts through to shopping list
      generation.
- [ ] **Recipe history** - Track when you last made a recipe, with optional
      personal notes/ratings. Helps avoid repeating meals and surfaces forgotten
      recipes.
- [ ] **Copy week to next week** - Common pattern for meal prep routines.

### Phase 8: Quality of Life

**Goal**: Polish based on real usage patterns

- [ ] **Shopping list unit consolidation** - Currently, quantities are only
      summed when units match exactly (e.g., 2 cups + 1 cup = 3 cups). Mixed
      units show as a count like "2x" instead of converting. Add common unit
      conversions (tbsp to cup, oz to lb, ml to l) so the shopping list produces
      a single consolidated quantity.
- [ ] **Expand synonym database** - The matching algorithm is strong but has
      gaps for common variants: dark soy sauce / soy sauce, chicken breast /
      chicken, pecorino / parmesan. Audit real recipe data after importing 50+
      recipes and fill gaps.
- [ ] **Filter by cook time** - Useful for weeknight "what's quick?" filtering.
- [ ] **Print shopping list** - Printer-friendly layout.
- [ ] **Subtract ingredients from inventory after cooking**
- [ ] **Mark meal as "cooked" in meal plan**
- [ ] **Expiration-based suggestions** - Surface recipes using ingredients about
      to expire. Useful in theory, but depends on users consistently maintaining
      expiration dates, which is high-friction. Revisit after seeing whether
      expiration data gets entered in practice.

### Backlog

Lower-priority items to reconsider once the app has been in daily use:

- [ ] PWA / offline support - The app has a web manifest and is installable, but
      has no service worker or offline caching. For a kitchen app with wake lock
      support, offline access to the current recipe would reduce friction. Build
      if connectivity proves to be a real problem.
- [ ] Drag-and-drop recipes on meal plan (desktop)
- [ ] Shared household - Invite another account (e.g. partner) to share recipes,
      inventory, meal plans, and shopping lists. Both users see and edit the same
      data. Requires a "household" or "group" concept that owns the data instead
      of individual users, plus invite/accept flow and permission scoping. This is
      the highest-impact social feature — cooking and inventory are shared
      activities in most households, and without this the app is single-player
      only. Significant scope: touches data ownership model, most queries, and
      auth. Worth doing once the core app is stable and in daily use by both
      people.
- [ ] Recipe sharing via public link
- [ ] Bulk import (paste-and-parse for Apple Notes at scale)
- [ ] Performance audit (optimize queries, lazy load images, bundle analysis)
- [ ] Nutrition info via external API
- [ ] Bun runtime migration - Faster CI and native TypeScript, but minimal
      user-facing value for a personal app. React Router v7 Bun support has edge
      cases. Revisit when the framework ecosystem is more stable.

---

## AI-Powered Features (Future)

The one AI feature worth building first is **ingredient substitutions** — it
solves a real moment ("I'm about to cook but I'm missing one thing") and is
simple to implement.

### Ingredient Substitutions

When missing an ingredient, AI suggests practical alternatives with context on
how it affects the recipe. "No buttermilk? Use 1 cup milk + 1 tbsp lemon juice."

### Smart Inventory via Photo

- **Receipt scanning** - Photo of grocery receipt -> AI extracts items,
  quantities, locations
- **Grocery photo scanning** - Photo of groceries on counter -> AI identifies
  items and quantities
- Review screen before confirming additions to inventory
- Large feature surface — camera access, image upload, API calls, review UI.
  Build only if manual inventory entry becomes a real pain point.

### Implementation Notes

- Claude API (Sonnet or Haiku) for text features, with vision for photo scanning
- Estimated cost: ~$0.003-0.015 per call (affordable for personal use)
- Store API key in environment variables, not in codebase

---

## Success Metrics

- [x] Can find any recipe in < 5 seconds
- [x] Discover recipes based on available ingredients
- [x] Weekly meal planning with one-click shopping lists
- [x] App is usable in the kitchen (wake lock, tap-to-cross-off)
- [x] Deployed and accessible on mobile
- [ ] 50+ real recipes imported (replacing Apple Notes as primary store)
- [ ] Data is backed up / exportable
- [ ] App has its own visual identity (not recognizable as Epic Stack template)

---

_Document created: February 2026_ _Last updated: February 6, 2026 - Implemented
Phase 6 landing page, sample data removal, and pantry staples onboarding. Added
shared household feature to backlog._
