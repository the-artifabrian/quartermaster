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

Phases 1-13e, a 10-phase UI redesign, and the Daily Use Polish batch are
complete. The app is feature-complete for solo and shared daily use. See
[FEATURES.md](./FEATURES.md) for the full catalog.

---

## Architecture Notes

- **Household migration strategy**: 13a added columns (nullable), 13b swapped
  queries, 13c added invite flow, 13d/13e added real-time notifications. Each
  sub-phase was independently deployable and rollback-safe.
- **Single-instance SSE**: In-memory EventEmitter means SSE events only reach
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

1. ~~**Bulk import from Apple Notes**~~ -- Done.
2. ~~**"Up next" banner on meal plan**~~ -- Done.
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

features -- they're table stakes for charging money. Not urgent until the daily
driver gate is met and real user adoption exists.

Previously completed: landing page CTA (UI redesign Phase 10), new user
onboarding flow (getting started checklist on `/recipes`).

- [~] **Accessibility pass** -- Partially done in UI redesign: aria-labels on
      select elements, aria-pressed on toggle buttons (tag filters, view
      toggles, favorites). Remaining: skip-to-content link, comprehensive
      screen reader audit, focus management in cooking mode. Legal and ethical
      requirement for a paid product.
- [ ] **Import from export (data round-trip)** -- JSON export exists but there's
      no import-from-export. Users burned by Yummly care about portability.
      Complete round-trip builds trust before asking people to pay.
- [x] **Full data export** -- Comprehensive JSON export of all user/household
      data: recipes (with ingredients, instructions, tags, image refs, notes),
      inventory, meal plans (with entries), shopping lists (with items), cooking
      logs, and meal plan templates. Available at Settings > Data > "Export all
      data". Recipe-only export kept as a separate option.
      requires usage signals (pairing suggestion usage, efficiency scores)
      that aren't currently tracked. Add basic event counters
      so the gate can be evaluated concretely. Without this, the gate will be
      deferred indefinitely.
- [x] **Security hardening** -- Comprehensive audit and fixes:
      - Image uploads: `maxFileSize` enforced at stream level (not post-buffer)
        for recipe images; server-side MIME allowlist on profile photos blocking
        SVG/HTML uploads
      - Input validation: `.max()` limits on all recipe/ingredient/instruction
        string fields and arrays (200 items); inventory bulk-create validated
      - URL import: `redirect: 'manual'` to prevent SSRF via redirect,
        5MB response size limit (Content-Length + body length)
      - Open redirect fixed in theme-switch (now uses `safeRedirect()`)
      - JSON-LD `</script>` breakout prevented via `\u003c` escaping
      - User data export no longer leaks session IDs
      - Bulk import string fields and arrays bounded to match recipe schema
- [ ] **SSE multi-instance fix** -- SSE events emitted on one Fly machine won't
      reach clients on another. Fine for solo use, but if charging for the
      real-time events. Options: polling fallback, LiteFS broadcast, or Redis

### Daily Use Polish

All shipped. See [FEATURES.md](./FEATURES.md) for details on: recipe print
view, recipe sharing (Web Share API), quick "I made this" from meal plan, meal
templates, better low-match discovery ("almost there" banner), "up next" banner.

(now shipped).

Ship after the no-waste planning story (Phase 12) is proven in daily use. The
marketing pitch -- "Plan meals that share ingredients, prep once on Sunday, waste
less food, save money" -- needs to be real before asking people to pay for it.

#### Implementation Tasks (Stripe test mode)

- [x] **Subscription model** -- Schema added in Phase 13a migration.
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
      remaining.
      landing page and from paywall interstitials inside the app.

---

## Technical Debt

- **SSE single-instance limitation** -- See **SSE multi-instance fix** in
- **Fire-and-forget event emission** -- `emitHouseholdEvent()` wraps DB writes
  in try/catch and runs async without awaiting. Risk of SQLite concurrency
  issues under load. Tests already need `vi.mock()` for this. Consider
  queueing or awaiting in non-critical paths.
- **In-memory matching at scale** -- Discover page loads all recipes + all
  inventory items into memory for matching. Fine at 50-100 recipes, but at
  500+ this could become slow. Profile with a realistic dataset and determine
  when pagination or server-side pre-filtering is needed.
- **No analytics/tracking infrastructure** -- See **Usage analytics for
- **CSP report-only** -- Content Security Policy is configured but
  `reportOnly: true` in `entry.server.tsx`. Provides no actual XSS protection.
- **Image endpoint unauthenticated** -- `/resources/images` serves any
  `objectKey` without auth. Object keys are CUIDs (not guessable), but exposed
  in OG meta tags. Acceptable for sharing use case; revisit if private recipes
  are added.
- **Profile photo S3 orphans** -- Photo updates/deletes remove the DB record
  but never call `deleteProfileImage()` to clean up S3. Leaks storage over time.

---

## Backlog

Lower-priority items to reconsider later.

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
      to work with household-scoped data from Phase 13.

#### UX Improvements

Previously completed: landing page CTA, unified cooking mode, recipe form
collapsible sections, meal plan empty state. Unsplash placeholders tried and
reverted (warm-color deterministic placeholders used instead).

- [~] **Accessibility pass** -- _Promoted to Pre-Phase 14 prerequisites._
      Partially done in UI redesign. See above.
- [x] **Inventory quick-add quantity** -- Quick-add now accepts optional inline
      quantity and unit fields alongside the name. Compact layout wraps
      gracefully on mobile.

---

## Success Metrics

### Daily Driver (current focus)

- [ ] All 140 Apple Notes recipes imported into the app
- [ ] Apple Notes is no longer used for recipes
- [ ] Weekly meal planning happens in-app for 4+ consecutive weeks
- [ ] Partner uses the app as a real co-user (not just testing)
- [ ] Inventory accuracy assessed after 4 weeks of real tracking
- [ ] "Up next" banner used as the daily cooking entry point

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

- [ ] Pro conversion rate >5% of active free users

---

_Last updated: February 11, 2026. Refocused around daily driver adoption as
app is proven in daily use. Three-doc structure:
[FEATURES.md](./FEATURES.md) (what's built),
and this file (roadmap)._
