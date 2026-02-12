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

Daily driving started **February 12, 2026**. The app is being used for real
cooking and meal planning, with friction notes collected over 2-3 weeks to
inform what gets built next. Feature work continues in parallel -- the daily
driver phase is an ongoing evaluation, not a feature freeze.

### Current Reality

- Feature-complete for solo and shared daily use (Phases 1-13e + UI redesign)
- ~135 recipes bulk-imported from Apple Notes
- Daily driving in progress -- tracking friction points, inventory accuracy,
  and whether the core workflow holds up for real weekly use
- Inventory tracking accuracy under sustained real-world evaluation
- Feature development continues alongside daily use; backlog items that surface
  as friction points get prioritized

### Critical Path

1. ~~**Bulk import from Apple Notes**~~ -- Done.
2. ~~**"Up next" banner on meal plan**~~ -- Done.
3. ~~**Smooth the post-import ramp**~~ -- Done. Three targeted fixes shipped:
   - Post-import nudge: dismissable CTA card after bulk import linking to
     `/plan` and `/recipes`
   - Import quality flags: amber banner on recipe list auto-detecting recipes
     with no ingredients, no instructions, or duplicate titles; filterable
     via `?quality=flagged`
   - "I have this" on discover: per-ingredient inventory add button on
     missing ingredient pills (recipe cards + "almost there" banner),
     canonical name dedup, auto-revalidating match percentages
4. **Daily drive for 4+ weeks** -- Use the app for real cooking: plan the week,
   shop from the list, cook from the app. Fix friction as it surfaces. Get
   partner using it as a real co-user, not a tester.
5. **Stress-test inventory** -- Track inventory honestly for a month. Measure
   how fast it drifts. Determine whether the overhead is justified by the
   discovery and subtraction benefits, or whether inventory needs to be more
   passive (e.g., auto-populate from shopping list check-offs only). The
   "I have this" button on discover and shopping list → inventory pipeline
   should be the primary inventory input methods -- if these keep inventory
   accurate enough without manual entry, that's the answer.

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

Previously completed: landing page CTA (UI redesign Phase 10), new user
onboarding flow (getting started checklist on `/recipes`).

- [~] **Accessibility pass** -- Partially done in UI redesign: aria-labels on
      select elements, aria-pressed on toggle buttons (tag filters, view
      toggles, favorites). Remaining: skip-to-content link, comprehensive
      screen reader audit, focus management in cooking mode. Legal and ethical
      requirement for a paid product.
- [x] **Import from export (data round-trip)** -- Full round-trip: import
      supports both full exports and recipe-only exports. Duplicates auto-skipped
      by title (recipes) and name+location (inventory). Partial success kept on
      errors. Available at Settings > Data > "Import data".
- [x] **Full data export** -- Comprehensive JSON export of all user/household
      data: recipes (with ingredients, instructions, tags, image refs, notes),
      inventory, meal plans (with entries), shopping lists (with items), cooking
      logs, and meal plan templates. Available at Settings > Data > "Export all
      data". Recipe-only export kept as a separate option.
- [ ] **Usage analytics for "proven" gate** -- The monetization "proven gate"
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
        with Zod schema (name, location enum, 200-item cap)
      - URL import: `redirect: 'manual'` to prevent SSRF via redirect,
        5MB response size limit (Content-Length + body length)
      - Open redirect fixed in theme-switch (now uses `safeRedirect()`)
      - JSON-LD `</script>` breakout prevented via `\u003c` escaping
      - User data export no longer leaks session IDs
      - Bulk import string fields and arrays bounded to match recipe schema
- [ ] **SSE multi-instance fix** -- SSE events emitted on one Fly machine won't
      reach clients on another. Fine for solo use, but if charging for the
      Household tier, two users on different machines won't see each other's
      real-time events. Options: polling fallback, LiteFS broadcast, or Redis
      pub/sub. Must be resolved before Household tier launches.

### Daily Use Polish

All shipped. See [FEATURES.md](./FEATURES.md) for details on: recipe print
view, recipe sharing (Web Share API), quick "I made this" from meal plan, meal
templates, better low-match discovery ("almost there" banner), "up next" banner.

Previously promoted to Pre-Monetization prerequisites: **Full data export**
(now shipped).

### AI Integration

AI enhancements to existing flows -- not a separate "AI feature", but invisible
intelligence woven into the discover, meal plan, and cooking experience. Every
AI output lands in an existing UI pattern (recipe card, ingredient pill, meal
plan slot), never in a chat window.

These activate after the daily driver gate is met -- they enhance existing flows,
but the flows need to be proven in real use first. Each item is a standalone
improvement to an existing page and can ship incrementally.

#### Design principles

- **Integrated, not bolted on.** AI outputs appear as native UI elements:
  a tooltip under a missing ingredient, a recipe card in the library, a
  pre-filled meal plan. No chat windows, no "AI" branding, no separate modes.
- **User stays in control.** Generated recipes go through the standard recipe
  form for review before saving. Generated meal plans are editable drafts.
  Substitution hints are suggestions, not automatic replacements.
- **Cost-aware.** LLM calls aren't free. At ~$30-40/year per user, every API
  call matters. Prefer caching (substitutions can be pre-computed per ingredient
  pair), batching (meal plan generation is one call, not seven), and gating
  (only fire on user action, never speculatively in loaders).

#### Features

- [ ] **Ingredient substitutions** -- When the discover page or a recipe detail
      shows a missing ingredient, display a contextual substitution hint inline
      ("No buttermilk? Use 1 cup milk + 1 tbsp lemon juice"). Appears as a
      small expandable line or tooltip on the missing-ingredient pill -- not a
      modal or sidebar. The existing synonym system handles _equivalent_
      ingredients (cilantro = coriander); this covers _non-equivalent_
      substitutions where a different ingredient can fill the same role.
      Implementation: server-side LLM call on demand (user clicks/taps "suggest
      substitute"), cached per ingredient + recipe context pair. Consider
      seeding a static substitution database for the most common ~50
      ingredients to reduce API calls.
- [ ] **Recipe generation from inventory** -- When the discover page has no
      strong matches (e.g., best match is below 50%), show a "Create something
      from what I have" CTA in the empty/low-match state. Also triggers when
      inventory items are expiring soon and no planned meal uses them --
      generates a recipe that prioritizes those ingredients. Takes the user's
      current inventory, sends it to an LLM with cuisine/dietary preferences
      from their existing recipe tags, and generates a structured recipe. The
      result opens in the standard recipe form (pre-filled, editable) for
      review before saving. The user can tweak and save it like any other
      recipe -- it becomes a normal part of their library.
      Implementation: single LLM call with structured output (JSON matching
      the recipe schema). Limit to a reasonable rate (e.g., 5 generations/day)
      to manage cost.
      **Trust note:** AI-generated recipes are unvetted -- proportions or flavor
      combinations may be off. Generated recipes should carry a subtle
      "AI-generated" indicator so the user knows to pay closer attention when
      cooking it the first time. The cooking log prompt for these recipes could
      nudge the user to note adjustments ("How did this turn out? Anything to
      tweak for next time?").
- [ ] **Smart meal plan generation** -- A "Fill my week" button on the meal plan
      page that generates a full or partial weekly plan. Considers: inventory
      (prioritize expiring items), ingredient overlap (the efficiency engine
      already built in Phase 12), variety (avoid repeating cuisines or proteins
      back-to-back), cooking history (favor highly-rated recipes, avoid
      recently cooked ones), and time constraints (quicker meals on weekdays).
      The output is a draft meal plan -- all slots are pre-filled but the user
      can swap, remove, or adjust servings before confirming. Only assigns
      recipes already in the user's library (no generation here).
      Implementation: **algorithmic first.** The inputs (recipe metadata, tags,
      cook times, ratings, inventory, overlap scores) and output (recipe ID →
      day + slot) are all structured -- this is a constraint-satisfaction and
      ranking problem, not a natural language problem. Build it as a
      deterministic algorithm using the existing overlap engine, matching
      engine, and cooking log data. This is cheaper, faster, more predictable,
      and debuggable than an LLM. Only reach for an LLM if the rules-based
      approach can't handle preference nuance well enough (e.g., "I want more
      variety" or "lighter meals midweek").
- [ ] **Receipt scanning → inventory** -- Photo upload of a grocery receipt,
      OCR + AI extracts line items, maps them to ingredient names, and guesses
      storage locations (pantry/fridge/freezer). Presented as a review list
      where the user can edit names, fix locations, and deselect items before
      bulk-adding. Higher implementation complexity (camera UI, OCR pipeline,
      item classification) -- ship after the above features prove out.

#### Cost management

At scale, the main cost concern is LLM API calls. Mitigation strategies:

- **Static seed data** for the most common substitutions (~50-100 ingredients)
  to avoid LLM calls entirely for predictable cases
- **Cache aggressively** -- substitution results are stable and can be cached
  per ingredient pair
- **Gate on user action** -- never call an LLM in a loader or on page load;
  always behind a button click
- **Rate limits per user** -- prevent runaway costs from power users or abuse
- **Track spend** -- log API calls per user per day; alert if costs exceed
  expected thresholds
- **Meal plan generation is algorithmic** -- no LLM cost for the highest-
  frequency AI feature

**Rough cost estimate:** Assuming a Haiku-class model (~$0.001/call for short
prompts), an active Pro user who looks up 5 substitutions/week and generates
2 recipes/month costs roughly $0.03/month in API calls -- well within the
$2.50-3.30/month Pro revenue. The static substitution database and caching
should reduce even this further. Receipt scanning (vision model) would be
more expensive per call (~$0.01-0.05) but is low-frequency (once per grocery
trip). Monitor actual usage before optimizing.

#### Monetization fit

AI features are natural Pro-tier differentiators. The free tier gets the
existing rules-based matching and synonym system. Pro unlocks AI substitutions,
recipe generation, smart meal planning, and receipt scanning. This strengthens
the Pro value proposition beyond just "more recipes" and "inventory tracking."

### Phase 14: Monetization

For the full business model, pricing tiers, competitive positioning, and go-live
requirements, see [MONETIZATION_STRATEGY.md](./MONETIZATION_STRATEGY.md).

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
- **CSP report-only** -- Content Security Policy is configured but
  `reportOnly: true` in `entry.server.tsx`. Provides no actual XSS protection.
  Switch to enforcement before monetization.
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

- [x] **Import from export (data round-trip)** -- _Shipped._ See Pre-Phase 14
      prerequisites above.
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

AI substitutions, recipe generation, meal plan generation, "use it up"
suggestions, and receipt scanning have been promoted to the **AI Integration**
section in the Future Roadmap above.

- [ ] **Ingredient parser accuracy** -- The normalization pipeline handles ~40
      modifiers and ~25 synonym groups, but real-world imports will surface edge
      cases: nested quantities ("1 (14.5 oz) can diced tomatoes"), brand names
      ("Hellmann's mayonnaise"), compound ingredients ("peanut butter"), and
      non-standard units ("a handful of basil"). Build a test corpus of 100+
      real ingredient strings from imported recipes and track parse accuracy.
      Improvements here compound across matching, shopping lists, and overlap
      scoring -- it's foundational infrastructure.
- [ ] **Nutrition estimates** -- Hit a nutrition API (Nutritionix or Edamam) for
      estimated calories and macros on recipe detail pages.
- [ ] **Monthly cooking summary** -- Stats from cooking logs: meals cooked,
      most-made recipes, average rating. Light analytics, not diet tracking.
- [ ] **Timer integration with recipe steps** -- Detect time references in
      instruction text (e.g., "simmer for 15 minutes") and offer an inline
      "start timer" button. Multiple concurrent timers infrastructure is now
      in place (TimerProvider + TimerWidget).
- [ ] **Leftovers/batch tracking** -- After cooking 6 servings for 2, the 4
      leftover portions aren't tracked. Would affect meal planning ("I already
      have chili for 2 more meals"). Needs schema design and UX thought -- more
      ambitious than the other items here.

#### Social & Sharing

- [ ] **Public recipe sharing** -- `/r/$recipeId` public read-only route with
      JSON-LD, OG tags, and sitemap. Opt-in per recipe. Design access patterns
      to work with household-scoped data from Phase 13.

#### UX Improvements

Previously completed: landing page CTA, unified cooking mode, recipe form
collapsible sections, meal plan empty state, multiple concurrent timers,
smarter "Surprise Me", shopping list week picker. Unsplash placeholders tried
and reverted (warm-color deterministic placeholders used instead).

- [~] **Accessibility pass** -- _Promoted to Pre-Phase 14 prerequisites._
      Partially done in UI redesign. See above.
- [x] **Inventory quick-add quantity** -- Quick-add now accepts optional inline
      quantity and unit fields alongside the name. Compact layout wraps
      gracefully on mobile.
- [x] **Inventory and shopping list search** -- Client-side search/filter on
      both pages. Inventory: filters across location tabs, updates header count,
      distinct "no matches" empty state. Shopping list: filters within categories,
      hides empty categories, hides bulk action buttons during search, hidden on
      print.
- [x] **Multiple concurrent timers** -- _Shipped._ Global `TimerProvider`
      context manages up to 5 named timers with localStorage persistence,
      wake lock, and alarm sound. Floating `TimerWidget` pill (collapsed
      countdown + expanded card with pause/resume/dismiss). `CookingTimer`
      refactored to inline creation UI within cooking mode. Timers survive
      page navigation.
- [x] **Smarter "Surprise Me"** -- _Shipped._ Weighted random selection using
      inventory match percentage, favorite status, average rating, exploration
      bonus (never-cooked), and recency penalty. Scoring extracted to
      `surprise-scoring.server.ts` with 18 unit tests.
- [x] **Shopping list generation from any week** -- _Shipped._ Loader queries
      prev/current/next week for meal plans. Week picker `<select>` shown when
      multiple weeks have plans. Action accepts optional `weekStart` param.
- [ ] **Recipe duplicate from detail view** -- No way to fork a recipe for
      variations ("spicy version"). A "Duplicate" action on the recipe detail
      page that copies all fields into the create form.
- [ ] **Non-JSON-LD import fallback** -- URL import only works with JSON-LD
      structured data. Many sites use microdata or none. When JSON-LD extraction
      fails, offer a "paste recipe text" fallback that feeds into the existing
      bulk-import parser. Bridges the gap until AI parsing ships.

---

## Success Metrics

### Daily Driver (current focus)

- [x] All Apple Notes recipes imported into the app (~135 bulk imported)
- [ ] Apple Notes is no longer used for recipes
- [ ] Flagged recipes reviewed and fixed (import quality flags live)
- [ ] Weekly meal planning happens in-app for 4+ consecutive weeks
- [ ] Partner uses the app as a real co-user (not just testing)
- [ ] Inventory accuracy assessed after 4 weeks of real tracking
- [ ] "I have this" on discover is the primary way inventory gets corrected
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

### Monetization (distant future)

- [ ] Free tier retains users (>50% of signups add 5+ recipes)
- [ ] Pro conversion rate >5% of active free users
- [ ] Churn rate <5% monthly on Pro tier
- [ ] Household tier adopted by >30% of Pro users with a partner

---

_Last updated: February 12, 2026. Smarter "Surprise Me", shopping list week
picker, and multiple concurrent timers shipped. Daily driving in progress --
using the app for real cooking with friction notes, feature work continues in
parallel._
