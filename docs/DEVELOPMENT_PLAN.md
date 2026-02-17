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

The app is feature-complete for solo and shared daily use. See
[FEATURES.md](./FEATURES.md) for the full catalog.

| Phase              | Summary                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1-4                | Recipe CRUD, inventory tracking, meal planning calendar, shopping list generation                                                            |
| 5                  | Recipe discovery ("What can I make?"), fuzzy matching, favorites, URL import                                                                 |
| 6                  | Pantry staples onboarding, removed sample data seeding                                                                                       |
| 7                  | Cooking logs, servings overrides, ingredient auto-suggest, shopping list consolidation                                                       |
| 8                  | Post-cooking inventory subtraction, unit conversion, print-friendly shopping list                                                            |
| 9-10               | Recipe scaling, inline timers, temperature conversion tooltips, cooking mode                                                                 |
| 11                 | Personal recipe notes, ingredient headings, drag-and-drop reordering                                                                         |
| 12                 | Bulk import (paste/file), import quality flags, "Surprise me" picker                                                                         |
| 13a-e              | Household sharing: data scoping, invite/join/leave, SSE real-time events, notification bell                                                  |
| UI redesign        | Custom color system, mobile-first layout, warm empty states, accessibility pass                                                              |
| Daily Use Polish   | Recipe print/share, quick cook from meal plan, meal templates, "Up next" banner                                                              |
| Smarter UX         | Shelf-life auto-suggest, low-stock nudge chips, weeknight-aware sorting, pairing/waste/efficiency                                            |
| Monetization infra | Subscription tiers, tier enforcement, invite code system, admin dashboard, pricing page, Stripe integration, Pro expiry + graceful downgrade |
| AI integration     | Ingredient substitutions (static DB + LLM fallback), recipe generation from inventory (LLM → preview → save)                                |

---

## Architecture Notes

- **SSE + polling hybrid**: In-memory EventEmitter delivers instant SSE events
  on the same Fly machine. A 30s database poll
  (`/resources/household-events-poll`) catches cross-machine events via
  LiteFS-replicated `HouseholdEvent` rows. Client-side dedup (bounded ID set,
  500 entries) prevents duplicate delivery.
- **Subscription model**: `Subscription` with `tier`, Stripe fields
  (`stripeCustomerId`, `stripeSubscriptionId`, both `@unique`),
  `subscriptionExpiresAt`, `trialEndsAt`. Pro access if either Stripe
  subscription or invite-code trial is active. Stripe webhook handlers are
  authoritative for subscription lifecycle; success redirect is optimistic.
- **Infrastructure seed**: `prisma/seed-infrastructure.ts` (permissions, roles,
  tags) runs on every production deploy via `litefs.yml`. Dev seed adds test
  users.

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

Completed: bulk import from Apple Notes, "Up next" banner, post-import ramp
(quality flags, "I have this" buttons, always-on matching), partner and external
users onboarded.

Remaining:

1. **Daily drive for 4+ weeks** -- Use the app for real cooking: plan the week,
   shop from the list, cook from the app. Fix friction as it surfaces.
2. **Stress-test inventory** -- Track inventory honestly for a month. Measure
   how fast it drifts. Determine whether the overhead is justified by the
   discovery and subtraction benefits, or whether inventory needs to be more
   passive (e.g., auto-populate from shopping list check-offs only).

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

Table stakes for charging money. Completed: accessibility pass, data
import/export round-trip, usage analytics, security hardening, landing page CTA,
new user onboarding, free-tier gate decision (feature gate), tier enforcement
infrastructure, admin subscription management, invite code system, first
external users (3 onboarded, aiming for 5+). See [FEATURES.md](./FEATURES.md).

Remaining: None -- all pre-monetization prerequisites are complete.

### AI Integration

AI enhancements to existing flows. Not a separate "AI feature" -- outputs land
in existing UI patterns (recipe cards, ingredient pills, meal plan slots), never
in a chat window. Activates after the daily driver gate is met. Each item is a
standalone improvement that can ship incrementally.

**Principles**: integrated not bolted on (no chat UI, no "AI" branding); user
stays in control (generated content is always an editable draft); cost-aware
(gate on user action, cache aggressively, never call LLMs in loaders).

#### Features

- [x] **Ingredient substitutions** -- Contextual hints on missing-ingredient
      pills ("No buttermilk? Use 1 cup milk + 1 tbsp lemon juice"). Static
      database of ~50 common substitutions + Claude Haiku LLM fallback (cached
      30 days). Inventory-aware — highlights substitutes you already have.
      Recipe-context-aware — LLM receives recipe title and ingredient list for
      dish-appropriate suggestions. Integrated into recipe detail ingredient
      list (missing items only), recipe cards, and "Almost There" banner. On
      recipe detail, "Use this" temporarily swaps the ingredient in both
      ingredient list and instruction text (client-side, revertible). Pro-tier
      feature. Ingredient list shows inline inventory summary and "Add N missing
      to Shopping List" button for all users.
- [x] **Recipe generation from inventory** -- "Generate Recipe" top-level
      button on recipes page (Pro + inventory required). Optional meal type
      and quick-meal preferences. Single LLM call (Claude Haiku, 15s timeout)
      → structured recipe → preview with save. `isAiGenerated` flag on Recipe
      model with violet badge on detail/share/cards. Replaces "Surprise Me"
      as the primary discovery action.
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

Per-call estimates (Haiku 4.5: $1/MTok input, $5/MTok output):

- **Ingredient substitution**: ~$0.001/call. Cached 30 days, so repeat lookups
  are free. No daily limit (cache is the rate limiter).
- **Recipe generation**: ~$0.003/call (~400-500 input tokens, ~400-600 output
  tokens). Not cached (inventory changes constantly). Daily limit of 10
  generations per user.

Rough per-user estimate: ~$0.05/month per active Pro user (5 substitution cache
misses/week × $0.001 + 8 recipe generations/month × $0.003). Well under 1% of a
$5/month subscription. Meal plan generation is algorithmic (no LLM cost). Receipt
scanning is more expensive per call (~$0.01-0.05) but low-frequency. AI features
are natural Pro-tier differentiators.

### Monetization

For the full business model, pricing tiers, competitive positioning, and go-live
requirements, see [MONETIZATION_STRATEGY.md](./MONETIZATION_STRATEGY.md).

Ship after the no-waste planning features (pairing suggestions, efficiency
scoring, waste alerts) are proven in daily use. The marketing pitch needs to be
real before asking people to pay.

Shipped: subscription model, tier enforcement (`requireProTier` route guard,
mixed-access degradation, lock icons, client hooks), invite code system (no
auto-trial, codes are only path to Pro), pricing page (`/upgrade`), admin
subscription management (`/admin/subscriptions`), Stripe integration (Checkout,
Customer Portal, webhooks, coexists with invite codes), Pro expiry + graceful
downgrade (days-remaining in header/settings, toast nudges at 7d/3d, lapsed
redirect with "data is safe" toast, reassurance banner on `/upgrade`, lapsed
state in settings subscription card).

---

## Technical Debt

Known issues to address before or alongside monetization:

- **SSE single-instance limitation** -- Resolved via 30s polling fallback. SSE
  still only reaches same-machine clients, but polling catches the rest.
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
- [ ] Inventory correction happens naturally (via "I have this", shopping list
      check-off, or post-cook subtraction — track which paths get used most)
- [ ] "Up next" banner used as the daily cooking entry point

### Pre-Monetization

- [~] 3-5 external users with real recipes (3 onboarded, tracking progress)
- [ ] External users reach the inventory loop (not just recipe storage)
- [x] Free-tier gate decision made (feature gate — Pro gates inventory loop)
- [x] Invite code growth model (replaces auto-trial — codes are only path to
      Pro)

### Adoption & Monetization (future)

See [MONETIZATION_STRATEGY.md](./MONETIZATION_STRATEGY.md) for detailed targets.

- [ ] 5+ external users with 10+ recipes each
- [ ] Pairing suggestions used when building 3+ weekly plans
- [ ] Weekly meal plans regularly achieve 60%+ ingredient efficiency
- [ ] Pro conversion rate >5% of active free users

---

_Last updated: February 17, 2026._
