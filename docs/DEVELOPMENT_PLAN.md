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
- Accessible star rating buttons and displays (aria-labels, role="img")

### Test Coverage

- 190 unit and integration tests across 16 files
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

### Phases 5-8 ✅ (complete)

- **Phase 5 — Recipe Growth & Quick Access**: URL import (JSON-LD scraping),
  quick text entry, favorites, source URL tracking, "Surprise me", JSON export
- **Phase 6 — UI Refresh & Onboarding**: Landing page redesign, removed sample
  data seeding, pantry staples onboarding, page headers, card redesign, search
  UI, navigation active states, recipe detail polish, form layout, empty states
- **Phase 7 — Shopping List Accuracy & Smarter Planning**: Ingredient
  normalization with canonical names, auto-suggest in recipe forms, meal plan
  serving sizes, cooking log with star ratings, copy week to next week
- **Phase 8 — Quality of Life**: Shopping list unit conversion (tbsp + cup),
  expanded synonym database (~20 groups), cook time filter, print-friendly
  shopping list, subtract ingredients from inventory after cooking, mark meal as
  cooked, expiration-based recipe suggestions

### Phase 9: Test Coverage Expansion (9A-C complete, 9D-E remaining)

190 tests across 16 files. All Quartermaster-specific business logic is covered
(recipe matching, fractions, ingredient parsing, shopping list, date utilities,
inventory subtraction, meal plan actions, recipe CRUD).

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

- [x] **Fix "Epic Notes" branding** — Change onboarding meta title from "Setup
      Epic Notes Account" to "Setup Quartermaster Account". Also fixed email
      subject and body in change-email flow.
- [x] **Add `meta` exports to all routes** — Recipe detail: `{recipe.title} |
      Quartermaster` (dynamic). All other pages: descriptive titles for
      browser tabs and bookmarks. 17 routes updated.
- [x] **Add canonical URLs** — Global `<link rel="canonical">` in root.tsx
      using `requestInfo.origin + requestInfo.path` (strips query params)
- [x] **Add `<main>` landmark** — Wrap `<Outlet>` in `<main>` in root.tsx.
      Changed landing page `<main>` to `<div>` to avoid nested landmarks.
- [x] **Fix heading hierarchy** — Add `<h2>` section headings on landing page
      before the `<h3>` feature cards
- [x] **Add web manifest description** — Add `description` field to
      `public/site.webmanifest`
- [x] **Star rating accessibility** — Add `aria-label` to star buttons and
      `role="img"` + `aria-label` to `StarDisplay` wrapper

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
Phase 10 quick wins (branding fixes, meta exports on 17 routes, canonical URLs,
main landmark, heading hierarchy, web manifest description, star rating
accessibility). Completed Phase 9A-C (unit + integration tests: 190 tests across
16 files). Added Phase 9 (test coverage expansion) and Phase 10 (SEO audit &
overhaul). Updated "What's Built" summary to cover Phases 1-8. Marked completed
success metrics. Removed backlog items captured in Phase 10. Clarified AI
substitutions vs synonym database._
