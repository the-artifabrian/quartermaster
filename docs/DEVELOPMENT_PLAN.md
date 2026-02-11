# Quartermaster - Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application built to
replace 100+ recipes scattered across Apple Notes. It provides searchable recipe
storage, kitchen inventory tracking, meal planning, and smart shopping list
generation.

> For tech stack, architecture, commands, database schema, and route structure,
> see [CLAUDE.md](../CLAUDE.md).

---

## What's Built

Phases 1-13e and a 10-phase UI redesign are complete. The app is
feature-complete for solo and shared daily use. See [FEATURES.md](./FEATURES.md)
for the full catalog.

---

## Architecture Notes

- **Household migration strategy**: 13a added columns (nullable), 13b swapped
  queries, 13c added invite flow, 13d/13e added real-time notifications. Each
  sub-phase was independently deployable and rollback-safe.
- **Single-instance SSE**: In-memory EventEmitter means SSE events only reach
  clients on the same Fly machine. Blocking for Household tier. See **SSE
  multi-instance fix** in Pre-Monetization prerequisites for details and options.
- **Public recipe sharing** (backlog item): Would need to read household-scoped
  data from a public route. Don't couple authorization too tightly to the
  session.
- **Subscription schema**: Added in 13a -- `Subscription` model with `tier`,
  `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionExpiresAt`,
  `trialEndsAt`. Ready for Phase 14 without a separate schema change.

---

## Phase Now: Daily Driver

The app is feature-rich but not habit-forming yet. 140 recipes are still in
Apple Notes. No one -- including the creator -- uses it as their daily cooking
tool. Until that changes, no roadmap item matters.

### Current Reality

- Feature-complete for solo and shared daily use (Phases 1-13e + UI redesign)
- 140 structured recipes still in Apple Notes waiting to be imported
- A few testers have tried the app with promising reactions, but no habitual
  daily users yet
- Inventory tracking is untested in sustained real-world use -- the biggest
  open question is how fast accuracy decays and whether the overhead is worth it
- The app has no daily touchpoint -- nothing pulls a user back at 5pm to decide
  what to cook

### Critical Path

1. ~~**Bulk import from Apple Notes**~~ -- **Done.** Paste-and-import flow at
   `/recipes/bulk-import` with client-side parsing, instant preview, `---`
   multi-recipe separator, session counter, and auto-clear/refocus for rapid
   batch import.
2. ~~**"Tonight" banner on meal plan**~~ -- **Done.** Warm accent banner on the
   meal plan page (current week only) showing today's uncooked meals with
   recipe image, cook time, servings, and a "Start Cooking" link to cooking
   mode. Empty state suggests a favorite recipe with one-tap "Add to Today".
   Excludes recipes already planned this week from suggestions.
3. **Daily drive for 4+ weeks** -- Use the app for real cooking: plan the week,
   shop from the list, cook from the app. Fix friction as it surfaces. Get
   partner using it as a real co-user, not a tester.
4. **Stress-test inventory** -- Track inventory honestly for a month. Measure
   how fast it drifts. Determine whether the overhead is justified by the
   discovery and subtraction benefits, or whether inventory needs to be more
   passive (e.g., auto-populate from shopping list check-offs only).

### Gate

The app has **fully replaced Apple Notes** as the primary recipe store and
**weekly meal planning happens in-app** for at least 4 consecutive weeks. Only
then does the rest of the roadmap activate. If daily driving reveals that the
core workflow has fundamental friction, fix that first -- don't layer more
features on top.

---

## Future Roadmap

Everything below activates after the daily driver gate is met. Priority is
driven by real friction discovered during daily use, not theoretical roadmap
planning. Items may be reprioritized or cut based on what actually matters in
practice.

### Pre-Monetization Prerequisites

These items should ship before or in parallel with monetization. They're not
features -- they're table stakes for charging money. Not urgent until the daily
driver gate is met and real user adoption exists.

- [x] **Landing page CTA fix** -- Landing page redesigned with "Start
      Cooking -- It's Free" CTA linking to `/signup`. Done in UI redesign
      Phase 10.
- [~] **Accessibility pass** -- Partially done in UI redesign: aria-labels on
      select elements, aria-pressed on toggle buttons (tag filters, view
      toggles, favorites). Remaining: skip-to-content link, comprehensive
      screen reader audit, focus management in cooking mode. Legal and ethical
      requirement for a paid product.
- [ ] **Import from export (data round-trip)** -- JSON export exists but there's
      no import-from-export. Users burned by Yummly care about portability.
      Complete round-trip builds trust before asking people to pay.
- [ ] **New user onboarding flow** -- No guided path from signup -> first
      recipes -> discovering features. Pantry staples onboarding exists for
      inventory, but nothing guides a user through adding their first 5 recipes
      or exploring meal planning. Consider: welcome checklist, contextual
      tooltips, or a "getting started" card on the dashboard. Retention before
      monetization matters -- users who don't build the habit in week 1 won't
      convert.
- [ ] **Full data export** -- Current download endpoint only exports the user
      profile, not recipes, inventory, or meal plans. Add comprehensive JSON
      export of all user data (recipes with ingredients/instructions/tags,
      inventory items, meal plans, cooking logs). Trust issue -- people won't
      invest time entering 50+ recipes if they can't get their data out.
- [ ] **Usage analytics for "proven" gate** -- The monetization "proven gate"
      requires usage signals (pairing suggestion usage, prep list generation,
      efficiency scores) that aren't currently tracked. Add basic event counters
      so the gate can be evaluated concretely. Without this, the gate will be
      deferred indefinitely.
- [ ] **SSE multi-instance fix** -- SSE events emitted on one Fly machine won't
      reach clients on another. Fine for solo use, but if charging for the
      Household tier, two users on different machines won't see each other's
      real-time events. Options: polling fallback, LiteFS broadcast, or Redis
      pub/sub. Must be resolved before Household tier launches.

### Daily Use Polish

These aren't new "phases" -- they're targeted improvements that make the app
more useful for people who cook daily. Prioritized by impact on the core
workflow: plan -> shop -> cook -> repeat.

> **Size legend**: `[S]` = a few hours, single file. `[M]` = a day or two,
> multiple files. `[L]` = multiple days, new models or significant refactoring.

#### High Impact

- [x] **"Today/Tonight" banner on meal plan** `[M]` -- _Moved to Phase Now:
      Daily Driver._ Done. See Critical Path #2 above.
- [ ] **Recipe sharing** `[M]` -- Add a "Share" button on recipe detail using
      the Web Share API (`navigator.share()`) for native mobile sharing (copy
      link, SMS, email). Fallback to clipboard copy on desktop. Currently
      recipes have OG meta tags but no way to share them from the UI. Consider:
      public read-only recipe URLs (opt-in per recipe) so shared links actually
      work for non-users.
- [ ] **Full data export** `[S]` -- _Promoted to Pre-Phase 14 prerequisites._
      See above.

#### Medium Impact

- [ ] **Recipe print view** `[S]` -- Shopping list has `print:` styles but
      recipes don't. Add a clean print layout for recipe detail (hide nav,
      actions, compact ingredients + instructions). People still print recipes
      and tape them to cabinets.
- [ ] **Meal templates / recurring meals** `[L]` -- "Copy to Next Week" exists
      but most families have a rotation, not a repeat. Save a week as a named
      template ("Weeknight Easy" vs "Entertaining Week") or mark individual
      meals as recurring ("Taco Tuesday"). Reduces weekly planning friction
      significantly.
- [ ] **Quick "I made this" from meal plan** `[S]` -- When cooking outside of
      cooking mode (most meals), there's no fast way to log a cook and subtract
      inventory. A quick action on the meal plan card (not just the "cooked"
      checkbox) that logs the cook + subtracts ingredients in one tap would help
      keep inventory accurate with less effort.
- [x] **Better low-match discovery** `[M]` -- **Done.** "Almost there" banner
      on Discover page shows near-miss recipes (missing 1-3 ingredients) with
      deduplicated ingredient pills and one-click "Add to shopping list".
      Per-card add button on each recipe match card. Server-side re-computation
      of matching ensures accuracy; canonical name deduplication avoids
      shopping list duplicates.

### Phase 14: Monetization

For the full business model, pricing tiers, competitive positioning, and go-live
requirements, see [MONETIZATION_STRATEGY.md](./MONETIZATION_STRATEGY.md).

Ship after the no-waste planning story (Phase 12) is proven in daily use. The
marketing pitch -- "Plan meals that share ingredients, prep once on Sunday, waste
less food, save money" -- needs to be real before asking people to pay for it.

#### Implementation Tasks (Stripe test mode)

- [x] **Subscription model** -- `Subscription` model with `tier`,
      `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionExpiresAt`,
      `trialEndsAt` was added in Phase 13a's migration. No additional schema
      change needed.
- [ ] **Stripe integration** -- Subscriptions, webhooks, customer portal for
      self-service plan changes / cancellation. Use Stripe Checkout for the
      payment flow to avoid building card forms.
- [ ] **Tier enforcement middleware** -- Route-level guards that check
      subscription status. Free-tier users hitting a Pro route get a paywall
      page, not an error. Keep the check in a single helper
      (`requireProTier(request)`) to avoid scattering subscription logic.
- [ ] **Graceful downgrade** -- When a Pro subscription lapses, data is preserved
      but gated features become read-only. User can still export their data.
      Never delete user data on downgrade. Recipes beyond the free-tier limit
      remain visible but new recipes can't be added until under the limit or
      upgraded.
- [ ] **Free trial** -- 14-day Pro trial for new signups, no card required.
      Converts to free tier automatically. Trial status shown in UI with days
      remaining.
- [ ] **Pricing page** -- Clear feature comparison table. Accessible from
      landing page and from paywall interstitials inside the app.

---

## Technical Debt

Known issues to address before or alongside monetization:

- **SSE single-instance limitation** -- See **SSE multi-instance fix** in
  Pre-Monetization prerequisites.
- **Fire-and-forget event emission** -- `emitHouseholdEvent()` wraps DB writes
  in try/catch and runs async without awaiting. Risk of SQLite concurrency
  issues under load. Tests already need `vi.mock()` for this. Consider
  queueing or awaiting in non-critical paths.
- **In-memory matching at scale** -- Discover page loads all recipes + all
  inventory items into memory for matching. Fine at 50-100 recipes, but at
  500+ this could become slow. Profile with a realistic dataset and determine
  when pagination or server-side pre-filtering is needed.
- **No analytics/tracking infrastructure** -- See **Usage analytics for
  "proven" gate** in Pre-Monetization prerequisites.

---

## Backlog

Lower-priority items to reconsider later. Items marked with a lightning bolt are
quick wins that can be done between phases without disrupting planned work.

> **Triage note:** Items graduate from the backlog when (1) they directly
> unblock a roadmap item, (2) daily use reveals them as friction points, or
> (3) user feedback requests them. Otherwise they stay here to avoid scope
> creep.

#### Infrastructure

- [ ] **Import from export (data round-trip)** -- _Promoted to Pre-Phase 14
      prerequisites._ See above.
- [ ] **Automated backups** -- The app stores years of recipes in a single
      SQLite file. Fly.io + LiteFS handles replication, but a scheduled backup
      to S3 (daily Litestream snapshots or a cron job that copies the DB) would
      provide disaster recovery. Critical infrastructure for a paid product.
- [ ] **Performance baseline at scale** -- The discover page loads all recipes +
      all inventory items into memory for matching. Fine at 50 recipes, but at
      500+ this could become slow. Profile with a realistic dataset and
      determine when pagination or server-side pre-filtering is needed.
- [x] Bulk import (paste-and-parse for Apple Notes at scale) -- **Done.**
      `/recipes/bulk-import` with client-side parser, `---` separator, max 50
      per batch.
- [ ] Performance audit (query profiling, lazy load images, bundle analysis)

#### Intelligence & AI

- [ ] **Ingredient parser accuracy** -- The normalization pipeline handles ~40
      modifiers and ~25 synonym groups, but real-world imports will surface edge
      cases: nested quantities ("1 (14.5 oz) can diced tomatoes"), brand names
      ("Hellmann's mayonnaise"), compound ingredients ("peanut butter"), and
      non-standard units ("a handful of basil"). Build a test corpus of 100+
      real ingredient strings from imported recipes and track parse accuracy.
      Improvements here compound across matching, shopping lists, and overlap
      scoring -- it's foundational infrastructure.
- [ ] **Prep freshness guidance** -- Flag ingredients where prep-ahead has
      limits. Avocado or fresh herbs can't be prepped 5 days early. Simple
      heuristic rules (not AI): a small lookup table of ingredients with
      max-prep-ahead days. The prep list already has storage tips (general
      fridge/freezer advice); this would add day-specific warnings based on
      when the meal is planned (e.g., "Prep basil no earlier than Wednesday
      for Friday's dinner").
- [ ] **AI: Receipt scanning -> inventory** -- Photo of grocery receipt, AI
      extracts items and guesses storage locations. Review/confirm before
      adding.
- [ ] **AI: Ingredient substitutions** -- When an ingredient is missing, suggest
      contextual alternatives ("No buttermilk? Use 1 cup milk + 1 tbsp lemon
      juice"). Note: the existing synonym system already handles this implicitly
      for equivalent ingredients -- AI would cover non-equivalent substitutions.
- [ ] **Nutrition estimates** -- Hit a nutrition API (Nutritionix or Edamam) for
      estimated calories and macros on recipe detail pages.
- [ ] **Monthly cooking summary** -- Stats from cooking logs: meals cooked,
      most-made recipes, average rating. Light analytics, not diet tracking.

#### Social & Sharing

- [ ] **Public recipe sharing** -- `/r/$recipeId` public read-only route with
      JSON-LD, OG tags, and sitemap. Opt-in per recipe. Design access patterns
      to work with household-scoped data from Phase 13. See also "Recipe
      sharing" in Daily Use Polish above.

#### UX Improvements

- [~] **Accessibility pass** -- _Promoted to Pre-Phase 14 prerequisites._
      Partially done in UI redesign. See above.
- [x] **Landing page CTA** -- Done in UI redesign Phase 10.
- [x] **Unified cooking mode** -- Done in UI redesign Phase 1. Dedicated
      cooking view with step paginator, sticky ingredients, floating timer, and
      "Done Cooking" modal.
- [x] **Recipe form length on mobile** -- Done in UI redesign Phase 8.
      Collapsible `<details>` sections with completion summaries.
- [x] **Meal plan empty state** -- Done in UI redesign Phase 9. Warm card with
      "Plan Your Week" heading and dual CTAs.
- [ ] **Inventory quick-add quantity** -- Quick-add only accepts a name. Adding
      optional inline quantity/unit/location fields would cut the add-then-edit
      workflow in half.
- ~~**Unsplash placeholder images for recipes**~~ -- Tried and reverted.
  Deterministic warm-color placeholders implemented in UI redesign instead
  (6 themes based on title hash).

---

## Success Metrics

### Daily Driver (current focus)

- [ ] All 140 Apple Notes recipes imported into the app
- [ ] Apple Notes is no longer used for recipes
- [ ] Weekly meal planning happens in-app for 4+ consecutive weeks
- [ ] Partner uses the app as a real co-user (not just testing)
- [ ] Inventory accuracy assessed after 4 weeks of real tracking
- [ ] "Tonight" banner used as the daily cooking entry point

### Shipped (features)

- [x] Can find any recipe in < 5 seconds
- [x] Discover recipes based on available ingredients
- [x] Weekly meal planning with one-click shopping lists
- [x] App is usable in the kitchen (wake lock, tap-to-cross-off, timer, offline)
- [x] Deployed and accessible on mobile
- [x] Data is backed up / exportable (JSON export)
- [x] App has its own visual identity (custom color system + typography)
- [x] Household sharing: two people use the same recipe library and meal plan

### Adoption (future)

- [ ] 5+ external users with 10+ recipes each
- [ ] Weekly meal plans regularly achieve 60%+ ingredient efficiency
- [ ] Pairing suggestions used when building 3+ weekly plans
- [ ] Prep list generated and referenced at least once per week

### Monetization (distant future)

- [ ] Free tier retains users (>50% of signups add 5+ recipes)
- [ ] Pro conversion rate >5% of active free users
- [ ] Churn rate <5% monthly on Pro tier
- [ ] Household tier adopted by >30% of Pro users with a partner

---

_Last updated: February 11, 2026. Refocused around daily driver adoption as
the immediate priority. Monetization and feature expansion deferred until the
app is proven in daily use. Three-doc structure:
[FEATURES.md](./FEATURES.md) (what's built),
[MONETIZATION_STRATEGY.md](./MONETIZATION_STRATEGY.md) (business strategy),
and this file (roadmap)._
