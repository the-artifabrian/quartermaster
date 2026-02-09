# Quartermaster - Recipe Management App Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application built to
replace 100+ recipes scattered across Apple Notes. It provides searchable recipe
storage, kitchen inventory tracking, meal planning, and smart shopping list
generation.

> For tech stack, architecture, commands, database schema, and route structure,
> see [CLAUDE.md](../CLAUDE.md).

---

## What's Built (Phases 1-13b) ✅

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
- Ingredient overlap analysis with efficiency scoring and waste alerts
- Pairing suggestions when adding recipes to meal plan (sorted by shared
  ingredient count with green badges)
- Single-use ingredient waste alerts with recipe suggestions to reduce waste
- Unified prep list: shared ingredients across 2+ recipes aggregated into a
  Sunday prep checklist with per-recipe attribution, serving-scaled amounts,
  prep method grouping from ingredient notes, and storage tips for prepped items
- Plan efficiency dashboard: total/unique ingredient stats, expandable shared
  ingredient bridges with recipe name pills

### UI, SEO & Infrastructure

- Custom color system (sage green + peach accent, OKLch) and typography
- Polished landing page, card designs, empty states, navigation
- Descriptive `<title>`, canonical URLs, Open Graph / Twitter Card meta tags
- JSON-LD Recipe structured data, marketing pages with sitemap
- PWA with service worker: offline access for viewed recipes and meal plan
- 251 unit/integration tests across 18 files
- Deployed on Fly.io with custom domain, HTTPS, and email
- Mobile-first responsive layout with bottom navigation

---

## Roadmap

Priority is driven by daily use — features that remove friction from the core
cooking workflow come first. Phase 12 (No-Waste Meal Planning) ships first
because it builds on proven infrastructure with no migration risk and delivers
immediate daily value. Phase 13 (Household Sharing) is the bigger architectural
lift and ships once a second person is ready to use the app. Phase 14
the pitch that justifies paying, so it needs to be real first.

### Phase 12: No-Waste Meal Planning ✅

Inspired by [Restaurant Dropout](https://restaurantdropout.substack.com/) (Zoe
Barrie Soderstrom) — plan your week's meals around shared ingredients, prep
once, cook all week. The existing ingredient normalization and synonym matching
systems are the foundation for this. No schema migrations, no query rewrites —
just new logic on top of battle-tested infrastructure.

#### 12a: Ingredient Overlap & Pairing Suggestions ✅

- [x] **Overlap analysis engine** — Given a set of recipes (e.g. the current
      week's meal plan), compute pairwise ingredient overlap using the existing
      normalization pipeline (`normalizeIngredient`, synonym lookup, core word
      matching). Output: which ingredients appear in 2+ recipes, how many
      recipes share each ingredient, and an overall "efficiency score" for the
      plan (ratio of unique ingredients to total ingredient slots).
- [x] **"Suggest recipes that pair well"** — The lead feature of this phase.
      When adding a recipe to the meal plan, show a ranked list of other recipes
      sorted by ingredient overlap with what's already planned. Reuses the
      matching engine but inverted: instead of matching inventory → recipes,
      match planned-recipe-ingredients → candidate recipes. Helps the user build
      a week where buying one bunch of cilantro covers 3 dinners instead of
      rotting after one. Ship this UI before the efficiency dashboard — a ranked
      suggestion list is more actionable than a post-hoc score.
- [x] **Waste alerts** — Flag ingredients used in only one recipe this week.
      "You're only using parsley in one recipe this week. Add [Tabbouleh] to use
      the rest?" Start simple: any single-use ingredient gets flagged.
      Packaging-aware heuristics ("sold in bulk", "whole bunch") can be layered
      on later if the basic alerts prove useful — avoid building a packaging
      knowledge database upfront.

#### 12b: Unified Prep List ✅

- [x] **Weekly prep list generation** — From the meal plan, extract all
      ingredients that appear in 2+ recipes and generate a single "Sunday prep"
      checklist. Amounts are aggregated across recipes using the existing
      shopping list consolidation logic (unit-aware quantity merging and
      canonical name deduplication). Prep method grouping extracts verbs from
      ingredient notes (minced, sliced, diced, etc.) and shows per-method
      quantities with recipe attribution. Storage tips (~30 ingredients) give
      practical fridge/freezer guidance for prepped items. Non-preppable filter
      (90+ shelf-stable items) keeps the list focused on items that actually
      need physical prep. Normalization fixes (leading "of " stripping, meat
      descriptors, count-unit synonyms like "garlic cloves" → "garlic") ensure
      proper consolidation.

#### 12c: Plan Efficiency Dashboard ✅

- [x] **Overlap visualization on meal plan** — Show a small badge or indicator
      on the meal plan view: "This week: 34 ingredients, 22 unique (65%
      efficiency)". Tapping it shows which ingredients bridge which meals. Makes
      the waste-reduction benefit tangible and gamifies building efficient
      plans. Lower priority than 12a/12b — this is polish, not core value. Ship
      after the overlap engine and prep list are proven useful in daily cooking.

#### Why This Works Here

Quartermaster already has the hardest pieces: ingredient normalization that
strips 40+ modifiers and handles plurals/irregulars, a synonym database with ~25
groups (~145 lines of mappings), and 4-level fuzzy matching (exact, synonym,
core word, multi-word containment). The overlap engine is essentially the
recipe-matching algorithm run sideways — instead of "what can I make with my
inventory?", it's "what shares ingredients with my plan?" The prep list is a
grouped, annotated version of the shopping list generator (which already handles
unit-aware quantity consolidation across unit families). This phase is
high-value with relatively low new infrastructure.

### Phase 13: Household Sharing

The biggest architectural change since launch. Cooking is a shared activity —
most households have two people planning meals, shopping, and cooking together.
This phase transforms Quartermaster from a single-user app into a collaborative
one.

#### 13a: Schema & Data Migration ✅

The foundation. Add household tables and migrate ownership, but don't change any
route queries yet — the app continues to work exactly as before.

- [x] **Household model** — New `Household` entity with `id` and `name`. New
      `HouseholdMember` join table (`householdId`, `userId`,
      `role: owner|member`). A user belongs to exactly one household at a
      time — this avoids household-selector UX complexity and ambiguous data
      ownership. Leaving a household creates a new solo one. Forward-planning
      `Subscription` model also added (tier, Stripe fields) for Phase 14.
- [x] **Add `householdId` to shared models** — Add `householdId` column to
      Recipe, InventoryItem, MealPlan, and ShoppingList alongside the existing
      `userId`. Keep `userId` as `createdBy` for attribution. **CookingLog stays
      user-scoped** — cooking logs are personal ("I made this, I rated it 4
      stars") and shouldn't merge when households combine. Household members can
      see each other's cooking activity on shared recipes, but ratings and notes
      belong to the individual.
- [x] **Backfill migration** — Data migration that creates a default
      single-person `Household` for each existing user, adds them as
      `HouseholdMember` with role `owner`, and backfills `householdId` on all
      their existing records. Keep `householdId` **nullable during 13a/13b** —
      SQLite can't `ALTER COLUMN` to add `NOT NULL` after the fact without
      recreating tables. The `requireUserWithHousehold` helper provides the
      runtime guarantee. Tighten the constraint to non-nullable in a follow-up
      migration after 13b is complete and all records are confirmed backfilled.
- [x] **Signup flows** — Both `signup()` and `signupWithConnection()` wrapped
      in `$transaction` to atomically create user + household + membership.
      `requireUserWithHousehold` helper ready for 13b with race-safe
      auto-creation fallback.

#### 13b: Query Migration ✅

Systematically swap `where: { userId }` → `where: { householdId }` across the
app. There are ~47 userId-scoped queries. Migrate by feature area so each batch
is independently testable:

- [x] **Auth helper** — New `requireUserWithHousehold(request)` that returns
      `{ userId, householdId }`. Wraps `requireUserId` + household membership
      lookup. All routes migrate to this helper.
- [x] **Recipes** — Migrate recipe list, detail, create, edit, import, export,
      cooking log, and favorites queries to use `householdId`.
- [x] **Inventory** — Migrate inventory list, create, edit, quick-add, and
      pantry staples queries.
- [x] **Meal plan & shopping list** — Migrate meal plan CRUD, shopping list
      generation, and inventory subtraction queries.
- [x] **Discovery** — Migrate the `/discover` loader (recipe matching uses
      inventory, so it needs household-scoped inventory + recipes).

#### 13c: Invite Flow & Member Management

Ship only after 13a and 13b are stable.

- [ ] **Invite flow** — Household owner generates an invite link (token-based,
      expires in 7 days). New `HouseholdInvite` model (`token`, `householdId`,
      `expiresAt`, `usedAt?`). Recipient clicks link → if logged in, joins
      household; if not, signs up then joins.
- [ ] **Member management UI** — Settings page showing household members, roles
      (owner vs member), pending invites. Owner can remove members and revoke
      invites. Member can leave household.

#### 13d: Real-Time Activity Notifications (Optional)

Nice-to-have for household awareness but not required for core sharing to work.
Ship after 13a-13c are proven in daily use.

- [ ] **Server-Sent Events (SSE) endpoint** — `/resources/household-events` SSE
      stream scoped to the user's household. SSE over WebSockets because it's
      simpler (unidirectional, works with HTTP/2, no extra server), and RR7's
      resource routes make it natural. Use explicit event emission in each
      action (not Prisma middleware) for controllable, predictable behavior.
- [ ] **Activity banner / toast** — Client subscribes to the SSE stream.
      Incoming events show as a toast or a subtle banner: "Alex added 3 items to
      the shopping list", "Alex planned Chicken Tikka for Thursday dinner". Tap
      to navigate to the relevant page. Use `useSyncExternalStore` to subscribe
      to the EventSource. Auto-reconnect on disconnect.
- [ ] **Event recording** — Lightweight `HouseholdEvent` table (householdId,
      userId, type, payload JSON, createdAt) to persist recent activity. Powers
      both the SSE stream and an optional "Recent activity" feed on the
      household settings page. Auto-prune events older than 30 days.

#### Scope & Considerations

- **Migration strategy**: 13a adds columns (nullable), 13b swaps queries, 13c
  adds new features. Each sub-phase is independently deployable and
  rollback-safe. A final migration after 13b tightens `householdId` to
  non-nullable.
- **Data on leave**: When a member leaves a household, recipes they created
  (`userId` = them) are **copied** to their new solo household — they keep their
  own work. Shared inventory, meal plans, and shopping lists stay with the
  household. CookingLog entries always belong to the user regardless of
  household. This needs to be decided before 13a ships to ensure the schema
  supports it.
- **Single-instance SSE**: SSE events emitted on one Fly machine won't reach
  clients connected to another. Stay on a single instance until this matters, or
  add a lightweight pub/sub layer (LiteFS broadcast or polling) later.
- **Public recipe sharing** (backlog item): If implemented later, it would need
  to read household-scoped data from a public route. Worth keeping in mind when
  designing the `householdId` access patterns — don't couple authorization too
  tightly to the session.
- **Subscription schema**: ✅ Added in 13a — `Subscription` model with `tier`,
  `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionExpiresAt`,
  `trialEndsAt`. Unique on `userId`. Ready for Phase 14 without a separate schema change
  later. A nullable `Subscription` model (or `tier` + `stripeCustomerId` +
  `subscriptionExpiresAt` on User) costs nothing to add early and saves a
  migration.

The cooking app market is oversaturated and consolidating — Yummly (Whirlpool,
75+ staff) shut down December 2024, PlateJoy discontinued July 2025.
Subscription fatigue is real. But Quartermaster's closed-loop inventory
intelligence pipeline (track → discover → plan → shop → subtract → repeat) is
genuinely differentiated — no mainstream competitor offers this end-to-end.

Ship after Phase 12 is proven in daily use. Phase 12's no-waste meal planning is
the marketing story: "Plan meals that share ingredients, prep once on Sunday,
waste less food, save money." That pitch needs to be real before asking people
to pay for it.

One-time purchase doesn't sustain ongoing development. Pure subscription scares
intelligence layer justifies the upgrade.

A functional recipe manager — enough to build the habit, with natural upgrade
points when the user wants more:

- [ ] Up to 50 recipes (CRUD, search, tags, images, scaling) — enough to be
      useful, low enough to hit the limit once committed. Unlimited on Pro.
- [ ] Manual recipe entry + quick text entry (URL import is Pro — it's the
      power-user feature that drives bulk recipe collection past the free limit)
- [ ] Basic cooking mode (tap-to-cross-off, wake lock)
- [ ] JSON export (data portability builds trust — users burned by Yummly
      shutting down care about this)
- [ ] Cooking log with ratings

is natural: "I have 50 recipes and want to import more" or "I want the shopping
problem, conversion will be low.

Gates the inventory intelligence loop — the closed-loop system that's the actual
differentiator. This is where ongoing development effort goes:

- [ ] Recipe import from URL (JSON-LD scraping with duplicate detection)
- [ ] Inventory tracking (pantry/fridge/freezer with expiration + low-stock)
- [ ] "What can I make?" discovery with fuzzy matching + expiration suggestions
- [ ] Meal planning calendar (weekly view, copy week, servings overrides)
- [ ] Smart shopping list (unit-aware consolidation, inventory subtraction,
      store-section grouping, print layout)
- [ ] Inventory subtraction after cooking (with unit conversion)
- [ ] Kitchen timer
- [ ] Phase 12 features (ingredient overlap, prep lists, efficiency scoring,
      waste alerts)
- [ ] PWA offline access

Natural upgrade for couples/families. Ships after Phase 13:

- [ ] Everything in Pro
- [ ] Shared recipe library, inventory, and meal plan
- [ ] Invite household members
- [ ] Activity notifications (if 13d ships)

#### Competitive Positioning

| ----------------------------------- | ------------------ | --------------- | -------------------- | ---------------- |
| Fuzzy inventory→recipe matching     | 4-level + synonyms | No              | No                   | No               |
| Unit-aware shopping consolidation   | Cross-family       | Basic           | Basic                | Yes              |
| Inventory subtraction after cooking | Yes                | No              | No                   | No               |
| Expiration-based suggestions        | Yes                | No              | No                   | No               |
| Ingredient overlap planning         | Yes (Phase 12)     | No              | No                   | No               |
| Unified prep list                   | Yes (Phase 12)     | No              | No                   | No               |

more. One-time-purchase apps like Paprika lack the intelligence layer entirely.

#### Implementation Considerations

- [ ] **Subscription model** — Add `Subscription` model (or fields on User):
      `tier` (free|pro|household), `stripeCustomerId`, `subscriptionExpiresAt`,
      `trialEndsAt`. If Phase 13 ships first, add these fields in 13a's
      migration to avoid a separate schema change.
- [ ] **Stripe integration** — Subscriptions, webhooks, customer portal for
      self-service plan changes / cancellation. Use Stripe Checkout for the
      payment flow to avoid building card forms.
- [ ] **Tier enforcement middleware** — Route-level guards that check
      subscription status. Free-tier users hitting a Pro route get a paywall
      page, not an error. Keep the check in a single helper
      (`requireProTier(request)`) to avoid scattering subscription logic.
- [ ] **Graceful downgrade** — When a Pro subscription lapses, data is preserved
      but gated features become read-only. User can still export their data.
      Never delete user data on downgrade. Recipes beyond the free-tier limit
      remain visible but new recipes can't be added until under the limit or
      upgraded.
- [ ] **Free trial** — 14-day Pro trial for new signups, no card required.
      remaining.
      page and from paywall interstitials inside the app.

#### "Proven" Gate for Phase 14

at least 4 weeks. Minimum signals that it's working:

- Pairing suggestions are used when building 3+ weekly plans
- Prep list is generated and referenced at least once per week
- Ingredient efficiency scores trend above 50% for planned weeks

Without these signals, the no-waste pitch is aspirational, not real — and that's
a weak foundation for asking people to pay.

#### Risks

- **Small addressable market.** The overlap of "people who track kitchen
  inventory" AND "people who meal plan" AND "people willing to pay" is narrow.
  This is a tool for serious home cooks, not mass market.
- **Self-hosted alternatives.** Mealie and Tandoor are free and open-source.
  Quartermaster's advantage is polish, the intelligence layer, and not requiring
  Docker knowledge.
- **App store economics.** If going native mobile later, Apple/Google take 30%.
  PWA avoids this but limits discoverability. Web-first is the right starting
  point.

### Backlog

Lower-priority items to reconsider later. Items marked ⚡ are quick wins that
can be done between phases without disrupting planned work.

#### Infrastructure

- [ ] **Import from export (data round-trip)** — JSON export exists but there's
      no import-from-export. Users burned by Yummly's shutdown care about data
      portability. A complete round-trip builds trust — especially important if
      asking people to pay. Should be done before or alongside Phase 14.
- [ ] **Automated backups** — The app stores years of recipes in a single SQLite
      file. Fly.io + LiteFS handles replication, but a scheduled backup to S3
      (daily Litestream snapshots or a cron job that copies the DB) would
      provide disaster recovery. Critical infrastructure for a paid product.
- [ ] **Performance baseline at scale** — The discover page loads all recipes +
      all inventory items into memory for matching. Fine at 50 recipes, but at
      500+ this could become slow. Profile with a realistic dataset and
      determine when pagination or server-side pre-filtering is needed.
- [ ] Bulk import (paste-and-parse for Apple Notes at scale)
- [ ] Performance audit (query profiling, lazy load images, bundle analysis)

#### Intelligence & AI

- [ ] **Ingredient parser accuracy** — The normalization pipeline handles ~40
      modifiers and ~25 synonym groups, but real-world imports will surface edge
      cases: nested quantities ("1 (14.5 oz) can diced tomatoes"), brand names
      ("Hellmann's mayonnaise"), compound ingredients ("peanut butter"), and
      non-standard units ("a handful of basil"). Build a test corpus of 100+
      real ingredient strings from imported recipes and track parse accuracy.
      Improvements here compound across matching, shopping lists, and overlap
      scoring — it's foundational infrastructure.
- [ ] **Prep freshness guidance** — Flag ingredients where prep-ahead has
      limits. Avocado or fresh herbs can't be prepped 5 days early. Simple
      heuristic rules (not AI): a small lookup table of ingredients with
      max-prep-ahead days. The prep list already has storage tips (general
      fridge/freezer advice); this would add day-specific warnings based on
      when the meal is planned (e.g., "Prep basil no earlier than Wednesday
      for Friday's dinner").
- [ ] **AI: Receipt scanning → inventory** — Photo of grocery receipt, AI
      extracts items and guesses storage locations. Review/confirm before
      adding.
- [ ] **AI: Ingredient substitutions** — When an ingredient is missing, suggest
      contextual alternatives ("No buttermilk? Use 1 cup milk + 1 tbsp lemon
      juice"). Note: the existing synonym system already handles this implicitly
      for equivalent ingredients — AI would cover non-equivalent substitutions.
- [ ] **Nutrition estimates** — Hit a nutrition API (Nutritionix or Edamam) for
      estimated calories and macros on recipe detail pages.
- [ ] **Monthly cooking summary** — Stats from cooking logs: meals cooked, most-
      made recipes, average rating. Light analytics, not diet tracking.

#### Social & Sharing

- [ ] **Public recipe sharing** — `/r/$recipeId` public read-only route with
      JSON-LD, OG tags, and sitemap. Opt-in per recipe. Design access patterns
      to work with household-scoped data from Phase 13.

#### UX Improvements

- [ ] **UX: Accessibility pass** — Icon-only buttons (favorite, delete, cooked
      toggle) use `title` instead of `aria-label`. Ingredient cross-off uses
      `onClick` on `<li>` without `role="button"` or `tabIndex`. No skip-to-
      content link. Location tabs rely on color alone with no secondary
      is a legal and ethical requirement, not a nice-to-have. Prioritize before
      or alongside Phase 14.
- [ ] ⚡ **UX: Landing page CTA** — "Get Started" links to `/login`, not
      `/signup`. New users land on a login form and must find the signup link.
      Change CTA to point to `/signup`, or add a prominent "New here? Create an
      account" section on the login page.
- [ ] **UX: Unified cooking mode** — Wake lock, cooking timer, tap-to-cross-off,
      and "I Made This" are separate sections scattered across the recipe detail
      page. A dedicated cooking view that puts ingredients + instructions +
      timer in one compact layout would reduce scrolling while actively cooking.
- [ ] **UX: Recipe form length on mobile** — Photo, details, ingredients,
      instructions, and tags all stack vertically. Tags at the bottom are easy
      to forget. Consider collapsible sections or a multi-step form on mobile.
- [ ] ⚡ **UX: Meal plan empty state** — New users see a blank 7-day grid with
      no guidance. Add explanatory text like "Plan your meals for the week — tap
      a slot to assign a recipe" on first visit.
- [ ] **UX: Inventory quick-add quantity** — Quick-add only accepts a name.
      Adding optional inline quantity/unit/location fields would cut the
      add-then-edit workflow in half.
- [ ] ⚡ **UX: Unsplash placeholder images for recipes** — Recipes without a
      user-uploaded image currently show colored gradients, which look generic.
      Use the [Unsplash API](https://unsplash.com/developers) to fetch a
      relevant food photo based on the recipe title. Store the image URL in a
      new `placeholderImageUrl` field on Recipe so the API is only hit once per
      requests/hour, high-quality photos, no attribution required. Fallback to
      the existing gradient if the API is unavailable or returns no results.
      Implementation: server-side fetch in the recipe create/edit action, search
      query = recipe title, pick the top result's `urls.regular`.

---

## Success Metrics

### Product

- [x] Can find any recipe in < 5 seconds
- [x] Discover recipes based on available ingredients
- [x] Weekly meal planning with one-click shopping lists
- [x] App is usable in the kitchen (wake lock, tap-to-cross-off, timer, offline)
- [x] Deployed and accessible on mobile
- [ ] 50+ real recipes imported (replacing Apple Notes as primary store)
- [x] Data is backed up / exportable (JSON export)
- [x] App has its own visual identity (custom color system + typography)
- [ ] Weekly meal plans regularly achieve 60%+ ingredient efficiency
- [ ] Pairing suggestions used when building 3+ weekly plans
- [ ] Prep list generated and referenced at least once per week
- [ ] Household sharing: two people use the same recipe library and meal plan

- [ ] Pro conversion rate >5% of active free users

---

_Document created: February 2026. Last updated: February 9, 2026 — completed
Phase 11 (PWA offline, cooking timer, personal notes, duplicate detection,
shopping→inventory pipeline, inventory subtraction feedback). Compacted Phases
1-11 into "What's Built". Reordered roadmap: Phase 12 is now No-Waste Meal
Planning (lower risk, immediate daily value, builds on existing infrastructure),
Phase 13 is now Household Sharing (split into 4 sub-phases: schema migration,
query migration by feature area, invite flow, optional SSE). Added Phase 14
Reorganized backlog into categories (Infrastructure, Intelligence & AI, Social,
UX) and added data round-trip import, automated backups, performance baseline,
and accessibility prioritization notes. Moved prep freshness guidance and AI
features to backlog. Plan review: Phase 12a reframed to lead with pairing
suggestions UI, waste alerts simplified to skip packaging heuristics. Phase 13a
updated: CookingLog stays user-scoped, householdId kept nullable through 13b,
added data-on-leave policy and subscription schema forward-planning. Phase 14
accuracy to backlog. Added Phase 12 success metrics. Completed Phase 12a:
ingredient overlap analysis engine, pairing suggestions in RecipeSelector
(lazy-loaded via resource route), waste alerts with efficiency scoring on meal
plan page. Completed Phase 12b: unified prep list generation with
serving-scaled quantity aggregation, recipe attribution, staple/synonym
handling, print-friendly layout, cross-navigation between prep list and
shopping list. Completed Phase 12c: plan efficiency dashboard with expanded
stats (total/unique ingredient counts), shared ingredient bridges with recipe
name pills in expandable section. Phase 12 (No-Waste Meal Planning) is now
fully complete. Enhanced Phase 12b prep list: added prep method grouping from
ingredient notes (19 prep verbs), storage tips map (~30 ingredients),
non-preppable filter expansion (sesame seeds, italian seasoning, bay leaves
fix), normalization fixes (leading "of " stripping, meat/processing modifiers,
garlic clove/celery stalk synonyms), shortest display name selection, per-method
line layout for readability. Completed Phase 13a: Household, HouseholdMember, and
Subscription models added. Nullable householdId on Recipe, InventoryItem,
MealPlan, ShoppingList with onDelete:SetNull. Backfill migration creates
per-user households with deterministic IDs. Signup flows wrapped in $transaction
for atomic user+household creation. requireUserWithHousehold helper with
race-safe auto-creation fallback. Seed updated for kody's household. Removed
ENABLE_HOUSEHOLD_INVITES feature flag from 13c (not needed — app not yet
marketed). Completed Phase 13b: query migration from userId → householdId across
~50 queries in 15 route/utility files. READ queries use householdId, WRITE
queries keep userId for attribution + householdId for scoping. Auth checks use
householdId. CookingLog stays user-scoped. All routes migrated from
requireUserId to requireUserWithHousehold (including recipes layout guard).
Updated inventory-subtract utility, 6 recipe routes, 3 inventory routes, 3 meal
plan/shopping list routes, discover route, 4 resource routes, and 4 test files
with household-aware setup helpers. 251 tests across 18 files._
