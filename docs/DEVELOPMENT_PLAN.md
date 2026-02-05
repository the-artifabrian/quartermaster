# Quartermaster - Recipe Management App Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application built to replace 100+ recipes scattered across Apple Notes. It provides searchable recipe storage, kitchen inventory tracking, meal planning, and smart shopping list generation.

> For tech stack, architecture, commands, database schema, and route structure, see [CLAUDE.md](../CLAUDE.md).

---

## What's Built (Phases 1-4) ✅

The MVP is complete and deployed. Here's a summary of everything implemented:

### Recipe Management
- Full CRUD with title, description, servings, prep/cook time, ingredients, instructions
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
- New user onboarding with 18 sample recipes + 38 inventory items
- Mobile-first responsive layout with bottom navigation
- Responsive grid (1 col / 2 col / 3 col)

---

## Roadmap

Priority is driven by daily use — features that remove friction from the core cooking workflow come first.

### Phase 5: Recipe Growth & Data Safety

**Goal**: Fill the app with real recipes and protect data

- [ ] **Import from URL** - Scrape recipes from websites using JSON-LD structured data. This is the fastest path to migrating from Apple Notes and growing the collection.
- [ ] **JSON export** - Download all recipes as JSON/markdown for backup. Essential before relying on the app as the single source of truth.
- [ ] **Favorite/bookmark recipes** - Low effort, high daily value for quick access to go-to recipes.
- [ ] **Recipe source URL** - Store where a recipe came from (useful alongside URL import).

### Phase 6: Smarter Meal Planning

**Goal**: Reduce decision fatigue around "what should I cook?"

- [ ] **Recipe history** - Track when you last made a recipe, with optional personal notes/ratings. Helps avoid repeating meals and surfaces forgotten recipes.
- [ ] **Copy week to next week** - Common pattern for meal prep routines.
- [ ] **Expiration-based suggestions** - Surface recipes using ingredients about to expire.
- [ ] **"Surprise me"** - Random recipe from collection.

### Phase 7: Quality of Life

**Goal**: Polish based on real usage patterns

- [ ] **Ingredient auto-suggest in recipe forms** - Suggest from existing ingredient names for consistency, which improves matching accuracy over time.
- [ ] **Quick recipe entry** - Simpler freeform text input for when you just want to save a recipe fast without filling every structured field.
- [ ] **Print shopping list** - Printer-friendly layout.
- [ ] **Filter by cook time** - Useful for weeknight "what's quick?" filtering.
- [ ] **Subtract ingredients from inventory after cooking**
- [ ] **Mark meal as "cooked" in meal plan**

### Phase 8: Runtime Migration (Bun)

**Goal**: Faster development, faster CI, potential runtime performance gains

Migrate from Node.js to Bun runtime. Bun offers 3-4x faster execution, 10x faster package installs, and built-in TypeScript support without transpilation.

- [ ] **Switch to Bun package manager** - Use `bun install` instead of `npm install`. Immediate CI/CD speedup with no runtime risk.
- [ ] **Update image optimization** - Switch `openimg/node` to `openimg/bun` in `app/routes/resources/images.tsx`. The openimg library has a dedicated Bun adapter.
- [ ] **Remove redundant packages** - Bun handles these natively:
  - `dotenv` (Bun auto-loads .env files)
  - `source-map-support` (Bun has built-in source maps)
  - `cross-env` (Bun handles env vars cross-platform)
- [ ] **Update Prisma configuration** - Add Bun runtime config to schema generator. Run Prisma CLI with `bun --bun prisma`.
- [ ] **Update npm scripts** - Replace `node index.ts` with `bun index.ts` in package.json scripts.
- [ ] **Validate full test suite** - Run `npm run validate` to ensure no regressions.
- [ ] **Update Fly.io deployment** - Use `Dockerfile.bun` template for production deployment.

**Compatibility notes**:
- Sharp (used by openimg) supports Bun via Node-API v9
- Express works with Bun (consider Hono migration later for max performance)
- React Router v7 has community Bun support with some edge cases to watch

**Rollback plan**: Keep Node.js scripts as fallback (`node index.ts` still works).

### Backlog

Lower-priority items to reconsider once the app has been in daily use:

- [ ] Drag-and-drop recipes on meal plan (desktop)
- [ ] Recipe sharing via public link
- [ ] Bulk import (paste-and-parse for Apple Notes at scale)
- [ ] Performance audit (optimize queries, lazy load images, bundle analysis)
- [ ] PWA / offline support (only if connectivity is a real problem in practice)
- [ ] Nutrition info via external API
- [ ] Hono migration (replace Express for native Bun HTTP performance)

---

## AI-Powered Features (Future)

The one AI feature worth building first is **ingredient substitutions** — it solves a real moment ("I'm about to cook but I'm missing one thing") and is simple to implement.

### Ingredient Substitutions
When missing an ingredient, AI suggests practical alternatives with context on how it affects the recipe. "No buttermilk? Use 1 cup milk + 1 tbsp lemon juice."

### Smart Inventory via Photo
- **Receipt scanning** - Photo of grocery receipt -> AI extracts items, quantities, locations
- **Grocery photo scanning** - Photo of groceries on counter -> AI identifies items and quantities
- Review screen before confirming additions to inventory
- Large feature surface — camera access, image upload, API calls, review UI. Build only if manual inventory entry becomes a real pain point.

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

---

*Document created: February 2026*
*Last updated: February 5, 2026 - Added Phase 8 (Bun runtime migration).*
