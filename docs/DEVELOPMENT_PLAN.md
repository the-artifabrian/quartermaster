# Quartermaster - Recipe Management App Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application built to
replace 100+ recipes scattered across Apple Notes. It provides searchable recipe
storage, kitchen inventory tracking, meal planning, and smart shopping list
generation.

> For tech stack, architecture, commands, database schema, and route structure,
> see [CLAUDE.md](../CLAUDE.md).

---

## What's Built (Phases 1-8) ✅

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
- Redesigned landing page explaining the app's value proposition
- Card redesign with location color-coding, tag pills, and match badges
- Polished empty states with contextual icons and CTAs
- Active navigation states for desktop and mobile

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
- [x] **Page headers and visual hierarchy** - All main pages use a `bg-muted/30`
      header band with title, subtitle/count, and primary actions. Inventory
      "All" view has color-coded location dots (amber/blue/cyan) on section
      headings.
- [x] **Card redesign** - Recipe cards use `ring-1 ring-border` with
      overflow-hidden, cook time inline with title, sage-tinted tag pills
      (`bg-primary/10`), capped at 3 with "+N". Inventory cards have
      `border-l-4` color-coded by location, pill badges for low-stock and
      expiry with dark mode variants. Meal slot empty states use dashed borders.
      Match cards have backdrop-blur badge and styled missing-ingredients box.
- [x] **Search and filter UI** - Search and tag filters wrapped in a
      `bg-muted/30 rounded-xl` zone with contrasting input background. Active
      tag pills get shadow-sm lift. Added result count and "Clear all filters"
      link when filters are active.
- [x] **Navigation active states** - Desktop nav uses NavLink with
      `text-primary border-b-2 border-primary` active indicator; inactive links
      use `text-muted-foreground`. Mobile bottom nav adds a `bg-primary` bar at
      the top of the active tab with bold label text.
- [x] **Recipe detail page** - Wider `max-w-4xl` container, `tracking-tight`
      title, action buttons as ghost sm below title with text labels.
      `bg-muted/30 rounded-xl` stat bar with vertical dividers. Sage-tinted
      tags. Ingredients in `bg-muted/20 rounded-xl` panel with "Scaled" badge.
      Edge-to-edge image on mobile, `rounded-xl` on desktop.
- [x] **Form layout** - Each section (Photo, Details, Tags, Ingredients,
      Instructions) wrapped in `rounded-xl border p-6` cards with section
      headers. Alternating row backgrounds on ingredient fields. Submit buttons
      separated with `border-t pt-6`.
- [x] **Empty states** - All empty states use a `bg-muted/50 rounded-full
      size-20` icon circle, `max-w-sm` constrained text, and contextual copy.
      Recipes page has dual CTAs (Add Recipe + Import from URL) and a separate
      "No matches found" state with clear-filters link. Discover has four
      distinct states with contextual icons. Shopping list uses dashed border.

### Phase 7: Shopping List Accuracy & Smarter Planning

**Goal**: Fix data quality issues that compound as the recipe collection grows,
and reduce meal planning friction

- [x] **Fix shopping list ingredient normalization** - Added
      `getCanonicalIngredientName()` that maps synonyms to a stable canonical
      key (alphabetically first equivalent). Shopping list consolidation now
      uses the full normalization pipeline — "Fresh Garlic" and "garlic, minced"
      correctly merge into one entry. Includes unit tests.
- [x] **Ingredient auto-suggest in recipe forms** - Resource route
      (`/resources/ingredient-suggestions`) returns distinct ingredient names
      from the user's recipes. `IngredientFields` component loads suggestions
      via `useFetcher`, merges with `COMMON_INGREDIENTS`, and renders a native
      HTML `<datalist>` — zero UI dependencies, accessible, works on all
      browsers.
- [x] **Meal plan serving sizes** - Added `servings Int?` to MealPlanEntry
      schema. Inline +/- controls on each meal slot entry. Shopping list
      generation scales ingredient amounts by the serving ratio
      (`entryServings / recipeServings`). Copy-week preserves servings.
- [x] **Recipe history (cooking log)** - New `CookingLog` model with
      `cookedAt`, `notes`, and `rating` (1-5 stars). "I Made This" button on
      recipe detail page expands an inline form. Cooking history section at
      bottom shows past events with star ratings and notes. Delete support via
      double-check button.
- [x] **Copy week to next week** - Button in meal plan header duplicates all
      entries with dates shifted +7 days, preserving serving overrides. Skips
      entries that already exist in the target week. Redirects to next week
      after copying.

### Phase 8: Quality of Life

**Goal**: Polish based on real usage patterns

- [x] **Shopping list unit consolidation** - Added `unit-conversion.ts` with
      unit families (US volume, US weight, metric volume, metric weight) and
      alias normalization. Shopping list now converts compatible units (e.g.,
      2 tbsp + 1 cup = 1 1/8 cup) instead of showing "2×". Prefers display
      units that appeared in the input for natural results.
- [x] **Expand synonym database** - Added synonym groups for soy sauces
      (tamari, shoyu), proteins (chicken ↔ chicken breast/thigh), hard cheeses
      (parmesan ↔ pecorino ↔ grana padano), yogurt, sugars (icing sugar),
      leavening (baking soda ↔ bicarbonate of soda), starch (cornstarch ↔
      corn starch), vegetables (eggplant ↔ aubergine, arugula ↔ rocket,
      green beans ↔ string/french beans), and alliums (shallot → onion).
      Synonym keys aligned with post-normalization names.
- [x] **Filter by cook time** - Added `maxTime` URL param to recipes page
      with `<select>` dropdown (Any time, Under 30 min, Under 1 hour, Under
      2 hours). Post-filters recipes where prepTime + cookTime ≤ maxTime.
- [x] **Print shopping list** - Added print button and Tailwind `print:`
      variants. Interactive elements (forms, buttons, bottom nav) hidden on
      print; items show Unicode checkbox characters (☐/☑) for print.
- [x] **Subtract ingredients from inventory after cooking** - New
      `inventory-subtract.server.ts` with `subtractRecipeIngredientsFromInventory()`.
      Matches recipe ingredients to inventory items, subtracts quantities when
      units match, marks low stock when depleted. "I Made This" form includes
      optional "Subtract ingredients from inventory" checkbox.
- [x] **Mark meal as "cooked" in meal plan** - Added `cooked Boolean` to
      MealPlanEntry schema. Toggle button on each meal slot entry with
      optimistic UI (green checkmark, strikethrough title, dimmed opacity).
- [x] **Expiration-based suggestions** - Discover page shows "Use It Before
      You Lose It" section when inventory items expire within 7 days. Displays
      up to 6 matching recipes sorted by how many expiring ingredients they use.
      Hidden when no expirations exist.

### Phase 9: Test Coverage Expansion

**Goal**: Build confidence in the codebase by testing the core business logic
and critical user flows that Phases 1-8 shipped without test coverage

As of Phase 8: 41 tests across 7 files. Zero coverage of Quartermaster-specific
business logic (recipe matching, fractions, ingredient parsing, meal planning,
discover). All existing tests are Epic Stack infrastructure or Phase 7-8
utilities.

#### Phase 9A — High-value pure unit tests (no DB, fast to write)

- [ ] **Recipe matching tests** (`recipe-matching.server.test.ts`, ~25 tests) —
      `normalizeIngredientName` (modifier stripping, pluralization, alternatives,
      comma removal), `ingredientMatchesInventoryItem` (exact match, synonym
      match, core word match, multi-word containment, negative cases like "rice"
      vs "rice vinegar"), `matchRecipesWithInventory` (percentage calculation,
      sorting, staple exclusion, canMake flag), `isStapleIngredient`,
      `getCanonicalIngredientName` (synonym stability, bidirectional mapping)
- [ ] **Fractions tests** (`fractions.test.ts`, ~15 tests) — `parseAmount`
      (integers, decimals, fractions, mixed numbers, division by zero, empty
      string, non-numeric), `formatAmount` (whole numbers, common fractions,
      mixed numbers, snap-to-nearest, zero), `scaleAmount` (scaling, null input,
      unparseable passthrough)
- [ ] **Ingredient parser tests** (`ingredient-parser.server.test.ts`, ~15
      tests) — `parseIngredient` (standard "2 cups flour", no-space metric
      "600g broccoli", no amount "salt", comma notes, unicode fractions,
      checkbox format), `parseISODuration` (PT30M, PT1H15M, PT0M, invalid)

#### Phase 9B — Shopping & inventory unit tests

- [ ] **Shopping list subtraction tests** (extend `shopping-list.server.test.ts`,
      ~13 tests) — `subtractInventoryFromShoppingList` (removes staples, removes
      in-stock items, keeps low-stock items, correct removedCount), serving
      scaling (ratio doubles amounts, ratio halves, missing amount passthrough,
      servings=0 fallback)
- [ ] **Category guessing tests** (`shopping-list-validation.test.ts`, ~10
      tests) — `guessCategory` (tomato→produce, chicken→meat, milk→dairy,
      flour→pantry, bread→bakery, frozen peas→frozen, unknown→other)
- [ ] **Date utility tests** (`date.test.ts`, ~10 tests) — `getWeekStart`
      (returns Monday), `getWeekDays` (7 days Mon-Sun), `getNextWeek`/
      `getPreviousWeek`, `serializeDate`/`parseDate` round-trip, `isToday`

#### Phase 9C — Integration tests (DB-backed)

- [ ] **Inventory subtraction integration** (`inventory-subtract.server.test.ts`,
      ~9 tests) — subtracts matching quantities, marks low stock at 0, skips
      staples, skips missing inventory match, skips incompatible units, handles
      unit conversion (tbsp→cup), respects serving ratio, quantity never < 0,
      nonexistent recipe is no-op
- [ ] **Meal plan actions** (~10 tests) — assign recipe to slot, duplicate
      assignment is idempotent, update servings, toggle cooked, remove entry,
      copy week (duplicates entries +7 days, skips existing, preserves
      servings), entry not found 404
- [ ] **Shopping list actions** (~8 tests) — generate from meal plan end-to-end,
      generate removes staples/inventory, generate replaces previous generated
      items, add manual item, toggle checked, delete item, clear checked, no
      meal plan 404
- [ ] **Recipe CRUD actions** (~12 tests) — create with valid data, validation
      failure, view detail with ingredients/instructions/tags/logs, 404 for
      nonexistent, 403 for other user's recipe, toggle favorite, log cook, log
      cook with subtractInventory, delete cook log

#### Phase 9D — E2E happy paths (Playwright)

- [ ] **Recipe CRUD flow** (`recipes.test.ts`) — create recipe with title,
      ingredients, instructions, tags → verify in list → view detail → edit →
      delete
- [ ] **Meal plan flow** (`meal-plan.test.ts`) — assign recipe to slot → verify
      in calendar → copy week → navigate to next week → verify → mark cooked
- [ ] **Shopping list flow** (`shopping-list.test.ts`) — generate from meal
      plan → verify categorized items → add manual item → check items → clear
      checked
- [ ] **Inventory flow** (`inventory.test.ts`) — add item → verify by location
      → edit → delete → pantry staples onboarding

#### Phase 9E — E2E edge cases

- [ ] **Discover page flow** (`discover.test.ts`) — with recipes + inventory
      shows match cards → "Show Only Makeable" filter → empty states
- [ ] **Cooking log flow** (`cooking-log.test.ts`) — "I Made This" with rating
      and notes → verify in history → subtract inventory checkbox → delete log
- [ ] **Recipe import flow** (`recipe-import.test.ts`) — enter URL → preview →
      confirm → verify recipe created (requires MSW mock for external fetch)

### Phase 10: SEO Audit & Overhaul

**Goal**: Make the app discoverable by search engines and shareable on social
media. The app currently has zero indexable recipe content and no structured
data.

#### Audit findings (by severity)

**Critical:**
1. No JSON-LD Recipe structured data on recipe detail pages
2. Missing `meta` exports (title/description) on most pages — every page shows
   generic "Quartermaster" title
3. No Open Graph or Twitter Card meta tags anywhere — shared links have no
   preview
4. All content pages are auth-gated — search engines can't index any recipe
   content
5. Marketing pages (about, privacy, tos, support) are empty one-line stubs

**Important:**
6. Sitemap is empty — all routes return `getSitemapEntries: () => null`
7. No `<link rel="canonical">` tags — filter params create duplicate URLs
8. Heading hierarchy skip (h1→h3) on landing page
9. "Epic Notes" branding in onboarding meta title
10. No `<main>` landmark in root layout
11. No user-editable image alt text; missing alt on placeholder recipe cards
12. No font loading strategy (potential CLS impact)

**Nice-to-have:**
13. UUID URLs instead of human-readable slugs
14. No preload hints for above-the-fold recipe images
15. No Cache-Control headers on HTML pages
16. Web manifest missing description field
17. Star rating buttons lack aria-labels
18. No `<noscript>` fallback

#### Implementation items

##### Quick wins (single session)

- [ ] **Fix "Epic Notes" branding** — Change onboarding meta title from "Setup
      Epic Notes Account" to "Setup Quartermaster Account"
- [ ] **Add `meta` exports to all routes** — Recipe detail: `{recipe.title} |
      Quartermaster` with description. All other pages: descriptive titles for
      browser tabs and bookmarks.
- [ ] **Add canonical URLs** — Global `<link rel="canonical">` in root.tsx
      using `requestInfo.origin + requestInfo.path` (strips query params)
- [ ] **Add `<main>` landmark** — Wrap `<Outlet>` in `<main>` in root.tsx
- [ ] **Fix heading hierarchy** — Add `<h2>` section headings on landing page
      before the `<h3>` feature cards
- [ ] **Add web manifest description** — Add `description` field to
      `public/site.webmanifest`
- [ ] **Star rating accessibility** — Add `aria-label` to star buttons and
      `StarDisplay` wrapper

##### Open Graph & social sharing

- [ ] **Global OG tags** — Add `og:site_name`, `og:type`, `og:locale`,
      `twitter:card` to root.tsx meta
- [ ] **Per-page OG tags** — Recipe detail: `og:title`, `og:description`,
      `og:image` (recipe image URL), `og:url`, `twitter:title`,
      `twitter:description`, `twitter:image`

##### Structured data

- [ ] **JSON-LD Recipe schema** — Add `<script type="application/ld+json">` to
      recipe detail page with `@type: Recipe`, `name`, `description`, `image`,
      `prepTime`/`cookTime`/`totalTime` (ISO 8601 duration),
      `recipeYield`, `recipeIngredient` (string array),
      `recipeInstructions` (HowToStep array), `recipeCategory` (from tags),
      `aggregateRating` (from cooking logs if available)

##### Content & indexability

- [ ] **Fill marketing pages** — Write real content for about, privacy policy,
      terms of service, and support pages
- [ ] **Add marketing pages to sitemap** — Return sitemap entries for `/`,
      `/about`, `/privacy`, `/tos`, `/support`
- [ ] **Public recipe sharing** (optional, largest lift) — Add `/r/$recipeId`
      public read-only route that doesn't require auth. Include JSON-LD, OG
      tags, and sitemap entries for shared recipes. This is the single highest
      SEO ceiling item but requires an opt-in sharing mechanism per recipe.

##### Performance & polish

- [ ] **Image alt text** — Add `role="img"` and `aria-label` to placeholder
      gradient recipe cards
- [ ] **Font loading** — Verify font loading strategy, add `font-display: swap`
      and `<link rel="preconnect">` if using web fonts
- [ ] **Cache-Control headers** — Add `Cache-Control: public, max-age=300` to
      marketing pages via `headers` export

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
- [ ] Bulk import (paste-and-parse for Apple Notes at scale)
- [ ] Performance audit (optimize queries, lazy load images, bundle analysis).
      Phase 10 covers SEO-adjacent perf items (font loading, cache headers, image
      preload); this covers deeper work like query profiling and bundle analysis.
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
This goes beyond the synonym database (Phase 8), which handles direct equivalents
(parmesan ↔ pecorino, tamari ↔ soy sauce). AI substitutions are contextual —
they consider the recipe, suggest compound replacements, and explain trade-offs.

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
- [x] Data is backed up / exportable (Phase 5: JSON export)
- [x] App has its own visual identity (Phase 6: full UI overhaul)

---

_Document created: February 2026_ _Last updated: February 6, 2026 - Completed
Phase 8. Added Phase 9 (test coverage expansion) and Phase 10 (SEO audit &
overhaul). Updated "What's Built" summary to cover Phases 1-8. Marked completed
success metrics. Removed backlog items captured in Phase 10. Clarified AI
substitutions vs synonym database._
