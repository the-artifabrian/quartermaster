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

Phases 1-13e, a 10-phase UI redesign, Daily Use Polish, and the Smarter UX batch
are complete. The app is feature-complete for solo and shared daily use. See
[FEATURES.md](./FEATURES.md) for the full catalog.

---

## Architecture Notes

- **Household migration strategy**: 13a added columns (nullable), 13b swapped
  queries, 13c added invite flow, 13d/13e added real-time notifications. Each
  sub-phase was independently deployable and rollback-safe.
- **Single-instance SSE**: In-memory EventEmitter means SSE events only reach
  clients on the same Fly machine. Blocking for Household tier. See **SSE
  multi-instance fix** in Pre-Monetization prerequisites for details and
  options.
- **Public recipe sharing**: Shipped at `/share/$recipeId`. Public read-only
  route with OG meta tags, recipe scaling, and "Import to Quartermaster" CTA.
  Reads household-scoped data without requiring a session.
- **Subscription schema**: Added in 13a -- `Subscription` model with `tier`,
  `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionExpiresAt`,
  `trialEndsAt`. Tier enforcement infrastructure now active -- new signups get a
  free Subscription with 14-day trial; existing production users need manual
  promotion via admin page (`/admin/subscriptions`).
- **Infrastructure seed split**: `prisma/seed-infrastructure.ts` (permissions,
  roles, tags) runs on every production deploy via `litefs.yml` exec chain.
  `prisma/seed.ts` imports the infrastructure seed and adds test users (dev
  only). Eliminates the need for manual role/permission setup in production.

---

## Phase Now: Daily Driver

Daily driving started **February 12, 2026**. The app is being used for real
cooking and meal planning. Active app usage is ~2-3 hours/day (shopping every
2-3 days, cooking daily or every other day), with the remaining dev time spent
building features. Early friction has already been addressed -- the daily driver
phase is now an ongoing evaluation running in parallel with feature development,
not a gate that blocks forward progress.

### Current Reality

- Feature-complete for solo and shared daily use (Phases 1-13e + UI redesign)
- ~135 recipes bulk-imported from Apple Notes
- Daily driving in progress -- core workflow is solid, initial friction points
  have been fixed, continuing to track inventory accuracy
- **Active dev time available**: real-world app usage takes a small fraction of
  the day, so feature work proceeds in parallel
- **Smarter UX batch shipped**: shelf-life auto-suggest on inventory intake
  (shopping list → inventory and "I have this"), low-stock → shopping list nudge
  chips, weeknight-aware recipe sorting in meal plan
- **First external users onboarded**: girlfriend added to household (real
  co-user), plus 1 friend and his girlfriend testing as a separate household
  with their own recipes and workflow. 3 external users total, validating
  onboarding and learnability in parallel with daily driving

### Critical Path

1. ~~**Bulk import from Apple Notes**~~ -- Done.
2. ~~**"Up next" banner on meal plan**~~ -- Done.
3. ~~**Smooth the post-import ramp**~~ -- Done. Three targeted fixes shipped:
   - Post-import nudge: dismissable CTA card after bulk import linking to
     `/plan` and `/recipes`
   - Import quality flags: amber banner on recipe list auto-detecting recipes
     with no ingredients, no instructions, or duplicate titles; filterable via
     `?quality=flagged`
   - "I have this" on recipe cards: per-ingredient inventory add button on
     missing ingredient pills (recipe cards + "almost there" banner), canonical
     name dedup, auto-revalidating match percentages. Match data always-on when
     inventory exists (no separate discover page or sort mode)
4. ~~**Get partner and external users on the app**~~ -- Done. Girlfriend is a
   real co-user in the household. Friend + his girlfriend testing as a separate
   household with their own recipes and flow.
5. **Daily drive for 4+ weeks** -- Use the app for real cooking: plan the week,
   shop from the list, cook from the app. Fix friction as it surfaces.
6. **Stress-test inventory** -- Track inventory honestly for a month. Measure
   how fast it drifts. Determine whether the overhead is justified by the
   discovery and subtraction benefits, or whether inventory needs to be more
   passive (e.g., auto-populate from shopping list check-offs only). The "I have
   this" button on recipe cards and shopping list → inventory pipeline should be
   the primary inventory input methods -- if these keep inventory accurate
   enough without manual entry, that's the answer.

### Gate

The app has **fully replaced Apple Notes** as the primary recipe store and
**weekly meal planning happens in-app** for at least 4 consecutive weeks before
monetization activates. Feature development is **not blocked** by this gate --
the daily driver evaluation runs in the background while new features ship. If
daily driving reveals fundamental workflow friction, that takes priority over
new features.

---

## Future Roadmap

Feature work proceeds in parallel with daily driving. Priority is driven by real
friction discovered during daily use and by readiness for monetization. Items
may be reprioritized or cut based on what actually matters in practice.

### Pre-Monetization Prerequisites

Table stakes for charging money. Previously completed: accessibility pass, data
import/export round-trip, full data export, usage analytics, security hardening,
landing page CTA, new user onboarding. See [FEATURES.md](./FEATURES.md) for
details on all shipped items.

Remaining:

- [ ] **SSE multi-instance fix** -- SSE events emitted on one Fly machine won't
      reach clients on another. Fine for solo use, but if charging for the
      Household tier, two users on different machines won't see each other's
      real-time events. Options: polling fallback, LiteFS broadcast, or Redis
      pub/sub. Must be resolved before Household tier launches.
- [x] **First external users** -- 3 external users onboarded: girlfriend
      (co-user in household), plus a friend and his girlfriend testing as a
      separate household with their own recipes and workflow. Tracking whether
      they reach the inventory loop or stop at recipe storage. Still aiming for
      5+ total before launch.
- [x] **Free-tier gate decision** -- Decided: **feature gate** (Option A). Free
      = unlimited recipes + import + cooking view. Pro = inventory, meal
      planning, shopping list, discovery matching, AI features. Paywall at the
      intelligence loop boundary. See
      [MONETIZATION_STRATEGY.md](./MONETIZATION_STRATEGY.md) for details.
- [x] **Tier enforcement infrastructure** -- `requireProTier()` route guard,
      `getUserTier()` utility, root loader `tierInfo`, client hooks, lock icons
      in nav, `/upgrade` pricing page. See Phase 14 implementation tasks for
      details.
- [x] **Admin subscription management** -- Admin page at `/admin/subscriptions`
      for managing user tiers (promote/demote) and invite code generation. Lists
      all users with current tier, household, trial status. Per-row dropdown to
      change tier (upsert, clears trial/expiry). Admin-role gated.
- [x] **Invite code system** -- Replaced 14-day auto-trial with invite-code
      growth model. `InviteCode` model, `invite-codes.server.ts` with code
      generation (`QM-XXXXXX`), redemption with 2 starter codes granted
      immediately. Redemption on `/upgrade`, Pro-only settings page at
      `/settings/profile/invite-codes`, nav badge for available codes.

### AI Integration

AI enhancements to existing flows. Not a separate "AI feature" -- outputs land
in existing UI patterns (recipe cards, ingredient pills, meal plan slots), never
in a chat window. Activates after the daily driver gate is met. Each item is a
standalone improvement that can ship incrementally.

**Principles**: integrated not bolted on (no chat UI, no "AI" branding); user
stays in control (generated content is always an editable draft); cost-aware
(gate on user action, cache aggressively, never call LLMs in loaders).

#### Features

- [ ] **Ingredient substitutions** -- Contextual hints on missing-ingredient
      pills ("No buttermilk? Use 1 cup milk + 1 tbsp lemon juice"). Server-side
      LLM call on demand, cached per ingredient pair. Seed a static database for
      the ~50 most common substitutions to reduce API calls.
- [ ] **Recipe generation from inventory** -- "Create something from what I
      have" CTA when discover has no strong matches or items are expiring.
      Single LLM call → structured recipe → standard recipe form for review.
      AI-generated indicator so user knows to pay attention on first cook.
- [ ] **Smart meal plan generation** -- "Fill my week" button. Algorithmic first
      (constraint-satisfaction using overlap engine, matching, cooking logs,
      favorites, cook times). Only reach for LLM if rules-based approach can't
      handle preference nuance. Output is an editable draft.
- [ ] **Receipt scanning → inventory** -- Photo upload, OCR + AI extracts items,
      review list before bulk-adding. Higher complexity -- ship after the above
      features prove out.
- [ ] **Voice inventory updates** -- Web Speech API transcription (free,
      client-side) → LLM structures into items → editable preview. Useful with
      messy hands or unpacking groceries.

> **Prioritization note:** The features above are ordered by shipping
> complexity, not by impact. If daily driving reveals that inventory _input_
> friction (not output quality) is the main bottleneck, receipt scanning and
> voice updates should be re-prioritized ahead of substitutions and recipe
> generation -- they directly reduce the overhead of keeping inventory accurate.

#### Cost notes

Rough estimate: ~$0.03/month per active Pro user (5 substitutions/week + 2
recipe generations/month at Haiku-class pricing). Static substitution database +
caching reduces this further. Meal plan generation is algorithmic (no LLM cost).
Receipt scanning is more expensive per call (~$0.01-0.05) but low-frequency. AI
features are natural Pro-tier differentiators.

### Phase 14: Monetization

For the full business model, pricing tiers, competitive positioning, and go-live
requirements, see [MONETIZATION_STRATEGY.md](./MONETIZATION_STRATEGY.md).

Ship after the no-waste planning story (Phase 12) is proven in daily use. The
marketing pitch -- "Plan meals that share ingredients, prep once on Sunday,
waste less food, save money" -- needs to be real before asking people to pay for
it.

#### Implementation Tasks (Stripe test mode)

- [x] **Subscription model** -- Schema added in Phase 13a migration.
- [x] **Tier enforcement infrastructure** -- Shipped. `getUserTier(userId)`
      queries subscription status; `requireProTier(request)` is a drop-in
      replacement for `requireUserWithHousehold` on Pro-only routes that
      redirects free users to `/upgrade`. Root loader exposes `tierInfo` for
      client-side gating. See details below.
- [x] **Free trial** -- 14-day Pro trial for new signups, no card required.
      Created automatically in signup transaction. Converts to free tier when
      `trialEndsAt` passes (no cron — checked on each request).
- [x] **Pricing page** -- `/upgrade` with three-tier comparison (Free / Pro /
      Household). "Coming Soon" where payment buttons will go. Accessible to all
      users (no auth guard).
- [x] **Admin subscription management** -- Shipped. Admin page at
      `/admin/subscriptions` for managing user tiers. Lists all users with
      current tier, household, trial status. Per-row dropdown to change tier
      (upsert, clears trial/expiry for clean admin override). Admin-role gated.
- [ ] **Stripe integration** -- Subscriptions, webhooks, customer portal for
      self-service plan changes / cancellation. Use Stripe Checkout for the
      payment flow to avoid building card forms.
- [ ] **Graceful downgrade** -- When a Pro subscription lapses, data is
      preserved but gated features become read-only. User can still export their
      data. Never delete user data on downgrade.
- [ ] **Trial expiry UI** -- Show trial status and days remaining in the app
      (header banner or settings). Nudge to upgrade as trial ends.

##### Tier enforcement details (shipped)

**Pro-only routes** (redirect to `/upgrade` for free users): `/inventory/*`,
`/plan`, `/shopping`, `/resources/discover-actions`,
`/resources/meal-plan-pairing`

**Mixed-access routes** (free users get reduced functionality):

- `/recipes` — skips inventory query + match data for free users; checklist
  shows only "Add your first recipe" step
- `/recipes/$recipeId` — hides "What Do I Need?" button, inventory impact
  section in "I Made This" modal, and `add-to-shopping-list` / inventory
  subtraction intents
- `/resources/surprise-me` — random selection without inventory weighting
- `/settings/profile/import` — free users can import recipes; Pro-only models
  (inventory, meal plans, shopping lists, templates) are skipped

**Navigation** — lock icons on Inventory/Plan/Shopping in desktop nav and bottom
nav for free users. Links still navigate (server redirects to `/upgrade`).

**Client-side hooks** — `useSubscriptionTier()` and `useIsProActive()` read
`tierInfo` from root loader data.

---

## Technical Debt

Known issues to address before or alongside monetization:

- **SSE single-instance limitation** -- See **SSE multi-instance fix** in
  Pre-Monetization prerequisites.
- **Fire-and-forget event emission** -- `emitHouseholdEvent()` wraps DB writes
  in try/catch and runs async without awaiting. Risk of SQLite concurrency
  issues under load. Tests already need `vi.mock()` for this. Consider queueing
  or awaiting in non-critical paths.
- **In-memory matching at scale** -- Recipes page loads all recipes + all
  inventory items into memory for matching. Fine at ~135 recipes, but may need
  pagination or pre-filtering at 500+. See **Performance audit** in Backlog.
- **Image endpoint unauthenticated** -- `/resources/images` serves any
  `objectKey` without auth. Object keys are CUIDs (not guessable), but exposed
  in OG meta tags. Acceptable for sharing use case; revisit if private recipes
  are added.
- **Profile photo S3 orphans** -- Photo updates/deletes remove the DB record but
  never call `deleteProfileImage()` to clean up S3. Leaks storage over time.

---

## Backlog

Lower-priority items to reconsider later.

> **Triage note:** Items graduate from the backlog when (1) they directly
> unblock a roadmap item, (2) daily use reveals them as friction points, or (3)
> user feedback requests them. Otherwise they stay here to avoid scope creep.

#### Infrastructure

- [ ] **Automated backups** -- The app stores years of recipes in a single
      SQLite file. Fly.io + LiteFS handles replication, but a scheduled backup
      to S3 (daily Litestream snapshots or a cron job that copies the DB) would
      provide disaster recovery. Critical infrastructure for a paid product.
- [ ] **Performance audit** -- Query profiling, lazy load images, bundle
      analysis. The recipes page loads all recipes + inventory into memory for
      matching -- fine at ~135 recipes, but profile at 500+ to determine when
      pagination or server-side pre-filtering is needed.

#### Intelligence & AI

AI substitutions, recipe generation, meal plan generation, receipt scanning, and
voice inventory have been promoted to the **AI Integration** section above.

- [ ] **Dashboard homepage** -- A central landing page (`/`) for logged-in users
      that aggregates the most actionable information: today's meals from the
      plan (reuse "Up next" banner), top inventory-matched recipes ("What can I
      make?"), expiring items, low-stock nudges, and quick-nav to
      plan/shopping/inventory. Validates during daily driving: if users
      consistently go to `/plan` or `/recipes` first, that's a signal this would
      help. Risk: becomes stale UI that duplicates individual pages — must add
      value through aggregation, not just links.
- [ ] **Nutrition estimates** -- Hit a nutrition API (Nutritionix or Edamam) for
      estimated calories and macros on recipe detail pages.
- [ ] **Monthly cooking summary** -- Stats from cooking logs: meals cooked,
      most-made recipes. Light analytics, not diet tracking.
- [ ] **Leftovers/batch tracking** -- After cooking 6 servings for 2, the 4
      leftover portions aren't tracked. Would affect meal planning ("I already
      have chili for 2 more meals"). Needs schema design and UX thought.

---

## Success Metrics

### Daily Driver (current focus)

- [x] All Apple Notes recipes imported into the app (~135 bulk imported)
- [ ] Apple Notes is no longer used for recipes
- [ ] Flagged recipes reviewed and fixed (import quality flags live)
- [ ] Weekly meal planning happens in-app for 4+ consecutive weeks
- [x] Partner uses the app as a real co-user (not just testing)
- [ ] Inventory accuracy assessed after 4 weeks of real tracking
- [ ] "I have this" on recipe cards is the primary way inventory gets corrected
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

### Pre-Monetization

- [~] 3-5 external users with real recipes (3 onboarded, tracking progress)
- [ ] External users reach the inventory loop (not just recipe storage)
- [x] Free-tier gate decision made (feature gate — Pro gates inventory loop)
- [x] Invite code growth model (replaces auto-trial — codes are only path to Pro)

### Adoption & Monetization (future)

See [MONETIZATION_STRATEGY.md](./MONETIZATION_STRATEGY.md) for detailed targets.

- [ ] 5+ external users with 10+ recipes each
- [ ] Pairing suggestions used when building 3+ weekly plans
- [ ] Weekly meal plans regularly achieve 60%+ ingredient efficiency
- [ ] Pro conversion rate >5% of active free users

---

_Last updated: February 16, 2026._
