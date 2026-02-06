# Quartermaster - Recipe Management App Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application built to
replace 100+ recipes scattered across Apple Notes. It provides searchable recipe
storage, kitchen inventory tracking, meal planning, and smart shopping list
generation.

> For tech stack, architecture, commands, database schema, and route structure,
> see [CLAUDE.md](../CLAUDE.md).

---

## What's Built (Phases 1-10) ✅

The app is feature-complete for daily use. Here's a summary of everything
implemented:

### Recipe Management

- Full CRUD with title, description, servings, prep/cook time, ingredients,
  instructions
- Image uploads (S3-compatible storage, max 3MB)
- 16 predefined tags across cuisine, meal-type, and dietary categories
- Full-text search across title, ingredients, and description
- Tag filtering and cook time filtering with bookmarkable URL params
- Recipe scaling with +/- servings controls and fraction display
- Cooking assistance: tap-to-cross-off ingredients/steps, Wake Lock toggle
- Favorite/bookmark recipes with filter toggle
- Import from URL (JSON-LD scraping), quick text entry, JSON export
- "Surprise me" random recipe picker
- Cooking log with star ratings and notes ("I Made This")
- "Last cooked" stats on recipe cards (cook count + relative time ago)

### Inventory System

- Three locations: Pantry, Fridge, Freezer
- Items with optional quantity, unit, expiration, and low-stock flag
- Quick-add shortcuts for 30 common ingredients
- "What can I make?" discovery page with fuzzy ingredient matching
- Match percentage scoring and missing ingredient highlighting
- Expiration-based recipe suggestions ("Use It Before You Lose It")
- Automatic inventory subtraction after cooking (with unit conversion)

### Meal Planning

- Weekly calendar view (Monday-start, 4 meal types per day)
- Click-to-assign recipes to meal slots, multiple recipes per slot
- Per-entry serving size overrides with +/- controls
- Mark meals as "cooked" with optimistic toggle UI
- Copy week to next week (preserves servings, skips duplicates)
- Week navigation (previous/next/current)
- Mobile-optimized with horizontal scroll

### Shopping List

- Auto-generation from meal plan with ingredient consolidation
- Unit-aware consolidation (e.g., 2 tbsp + 1 cup → 1 1/8 cup)
- Grouped by store section (produce, dairy, meat, pantry, frozen, bakery, other)
- Inventory-aware: subtracts items already in stock and staple ingredients
- Manual item addition, check-off while shopping, clear checked items
- Print-friendly layout (Tailwind `print:` variants)

### UI & Design

- Custom color system (sage green + peach accent, OKLch) and typography
- Redesigned landing page with value proposition, feature cards, and CTAs
- Card redesign with location color-coding, tag pills, and match badges
- Polished empty states with contextual icons and CTAs
- Active navigation states for desktop and mobile
- Proper heading hierarchy (h1 → h2 → h3) on all pages

### SEO & Accessibility

- Descriptive `<title>` on every page (e.g., `Chicken Tikka | Quartermaster`)
- `<link rel="canonical">` on all pages (strips query params)
- `<main>` landmark wrapping page content
- Web manifest with app description
- Open Graph and Twitter Card meta tags (global defaults + per-recipe with image)
- JSON-LD Recipe structured data (ingredients, instructions, times, ratings)
- Marketing pages with real content (about, privacy, ToS, support) in sitemap
- `Cache-Control: public, max-age=300` on marketing pages
- Accessible star rating buttons and displays (aria-labels, role="img")
- Recipe card placeholder accessibility (role="img", aria-label)

### Test Coverage

- 199 unit and integration tests across 16 files
- Covers: recipe matching, fractions, ingredient parsing, shopping list
  generation/subtraction, date utilities, inventory subtraction, unit
  conversion, meal plan actions, recipe CRUD actions, category guessing

### Infrastructure

- Deployed on Fly.io with custom domain, HTTPS, and email
- Session-based auth with per-user recipe libraries
- New user onboarding with recommended pantry staples checklist
- Ingredient auto-suggest in recipe forms (from user's recipe history)
- Expanded ingredient synonym database (~20 synonym groups)
- Mobile-first responsive layout with bottom navigation
- Responsive grid (1 col / 2 col / 3 col)

---

## Roadmap

Priority is driven by daily use — features that remove friction from the core
cooking workflow come first.

### Phases 5-8 ✅

- **Phase 5**: URL import, quick text entry, favorites, "Surprise me", JSON
  export
- **Phase 6**: Landing page redesign, pantry staples onboarding, card redesign,
  empty states, navigation polish
- **Phase 7**: Ingredient normalization, auto-suggest, meal plan servings,
  cooking log with ratings, copy week
- **Phase 8**: Unit conversion, expanded synonyms, cook time filter,
  print-friendly shopping list, inventory subtraction, mark cooked

### Phase 9: Test Coverage ✅

199 unit and integration tests across 16 files. All business logic is covered
(recipe matching, fractions, ingredient parsing, shopping list, date utilities,
inventory subtraction, meal plan actions, recipe CRUD). E2E happy-path tests
were dropped — they'd mostly test that React Router and Prisma work, not app
logic. Playwright E2E tests should be added selectively for complex cross-cutting
workflows (e.g. shopping list → inventory pipeline) as those features are built.

### Phase 10: SEO Audit & Overhaul ✅

Audited 18 SEO/accessibility issues and resolved 15 of them:

- Fixed branding ("Epic Notes" → "Quartermaster"), added `meta` exports to all
  17 routes, canonical URLs, `<main>` landmark, heading hierarchy, web manifest
  description
- Open Graph + Twitter Card meta tags (global defaults in root, per-recipe with
  `og:image` 1200x630 and `summary_large_image`)
- JSON-LD Recipe structured data on recipe detail (`recipeIngredient`,
  `recipeInstructions` as HowToStep, ISO 8601 durations, `recipeCategory`,
  `recipeCuisine`, `aggregateRating` from cooking logs)
- Marketing pages: real content (about, privacy, ToS, support), sitemap entries
  with priority, `Cache-Control: public, max-age=300`
- Accessibility: star rating aria-labels, `role="img"` on StarDisplay and recipe
  card gradient placeholders, removed unused `font-poppins` class

**Unresolved (not worth the complexity):** auth-gated content (no public recipe
pages), UUID URLs vs slugs, image preload hints, `<noscript>` fallback. Public
recipe sharing is tracked in backlog.

### Phase 11: Workflow Polish

Small, high-impact improvements to reduce daily friction. No schema migrations
required for most items.

- [ ] **Shopping list → inventory pipeline** — When checking off shopping list
      items (meaning "I bought this"), offer to add them to inventory with
      pre-filled name, location, and quantity. This closes the biggest workflow
      gap: without it, inventory accuracy degrades after every shopping trip.
      Build this before any AI inventory features — it's the manual fallback
      that must exist regardless.
- [x] **"Last cooked" on recipe cards** — Show "Last made: 3 weeks ago" or
      "Made 5 times" on recipe list cards. Low lift — join cooking logs in
      the recipes loader. Helps answer "what haven't I made in a while?"
      without clicking into each recipe.
- [x] **Recipe personal notes** — A free-text "My notes" field on the Recipe
      model for persistent reminders ("always double the garlic", "serve with
      rice", "kids don't like this"). Different from description (recipe's own
      text) and cooking log (per-cook reflections).
- [ ] **Cooking timer** — A simple floating timer on the recipe detail page.
      Number input + start/pause/reset. No instruction parsing — just a manual
      kitchen timer that lives on the page. Useful when cooking with messy hands
      and the phone is propped up.
- [ ] **Duplicate detection on import** — When importing from URL, check for
      existing recipes with the same `sourceUrl` or very similar title. Show
      "You may already have this recipe" warning. Prevents clutter as the
      library grows past 50+ recipes.
- [ ] **PWA / offline recipe access** — Service worker to cache the
      currently-viewed recipe and the current week's meal plan. The app already
      has a web manifest and wake lock — offline access would make it
      significantly more reliable in kitchens with spotty connectivity.

### Phase 12: AI Features

Claude API (Sonnet or Haiku) for text, vision for images. Estimated cost:
~$0.01-0.03 per call (affordable for personal use). API key in environment
variables.

- [ ] **Receipt scanning → inventory** — Photo of grocery receipt, AI extracts
      item names, quantities, and guesses storage locations. Review/confirm
      screen before adding to inventory. Receipts are structured text so
      extraction is reliable. The main challenge is mapping abbreviated receipt
      line items ("ORG BROCCOLINI", "GV 2% MLK") to clean inventory names.
      Build after the manual shopping → inventory pipeline (Phase 11) exists as
      a fallback.
- [ ] **Ingredient substitutions** — When a recipe ingredient is missing from
      inventory, suggest practical alternatives with context: "No buttermilk?
      Use 1 cup milk + 1 tbsp lemon juice." Goes beyond the synonym database
      (Phase 8) — AI substitutions are contextual, consider the recipe, and
      explain trade-offs.

### Phase 13: Nutrition & Insights

- [ ] **Per-recipe nutrition estimates** — Hit a nutrition API (Nutritionix or
      Edamam) with the ingredient list to get estimated calories and macros.
      Display on recipe detail page. Numbers will be rough estimates (portion
      sizes, cooking methods, and brands all affect accuracy) — present them
      as approximations, not precise counts.
- [ ] **Monthly cooking summary** — Simple stats from cooking logs: meals
      cooked this month, most-made recipes, average rating, estimated
      calories if nutrition data is available. Light analytics, not full diet
      tracking — only covers meals logged in Quartermaster, so explicitly
      don't position it as comprehensive calorie counting.

### Backlog

Lower-priority items to reconsider once the app has been in daily use:

- [ ] Shared household — Invite another account (e.g. partner) to share recipes,
      inventory, meal plans, and shopping lists. Both users see and edit the same
      data. Requires a "household" or "group" concept that owns the data instead
      of individual users, plus invite/accept flow and permission scoping.
      Highest-impact social feature — cooking is a shared activity in most
      households. Significant scope: touches data ownership model, most queries,
      and auth. Worth doing once the core app is stable and in daily use by both
      people.
- [ ] Public recipe sharing — `/r/$recipeId` public read-only route without
      auth, with JSON-LD, OG tags, and sitemap entries. Requires opt-in sharing
      toggle per recipe. Highest SEO ceiling item.
- [ ] Bulk import (paste-and-parse for Apple Notes at scale)
- [ ] Performance audit (query profiling, lazy load images, bundle analysis)
- [ ] Bun runtime migration — revisit when React Router v7 Bun support is more
      stable

---

## Success Metrics

- [x] Can find any recipe in < 5 seconds
- [x] Discover recipes based on available ingredients
- [x] Weekly meal planning with one-click shopping lists
- [x] App is usable in the kitchen (wake lock, tap-to-cross-off)
- [x] Deployed and accessible on mobile
- [ ] 50+ real recipes imported (replacing Apple Notes as primary store)
- [x] Data is backed up / exportable (Phase 5: JSON export)
- [x] App has its own visual identity (Phase 6: full UI overhaul)

---

_Document created: February 2026_ _Last updated: February 6, 2026 - Reorganized
roadmap: added Phase 11 (workflow polish: shopping→inventory pipeline, last
cooked, recipe notes, cooking timer, duplicate detection, PWA offline), Phase 12
(AI: receipt scanning, ingredient substitutions), Phase 13 (nutrition estimates,
monthly cooking summary). Moved shared household and public sharing to backlog.
Removed drag-and-drop, nutrition API, and grocery haul photo as standalone items.
Dropped Phase 9D-E (Playwright E2E) — CRUD happy paths have poor ROI given
existing unit/integration coverage. Previously: completed Phase 10 SEO, Phase
9A-C tests._
