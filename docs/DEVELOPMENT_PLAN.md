# Quartermaster - Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application built to
replace 100+ recipes scattered across Apple Notes. It provides searchable recipe
storage, kitchen inventory tracking, meal planning, and smart shopping list
generation.

> For tech stack, architecture, commands, database schema, and route structure,
> see [CLAUDE.md](../CLAUDE.md). For the full feature catalog, see
> [FEATURES.md](./FEATURES.md). For business strategy, see
> [MONETIZATION_STRATEGY.md](./MONETIZATION_STRATEGY.md).

---

## What's Built

The app is feature-complete for solo and shared daily use.

| Phase              | Summary                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| 1-4                | Recipe CRUD, inventory tracking, meal planning calendar, shopping list generation        |
| 5-8                | Discovery ("What can I make?"), cooking logs, inventory subtraction, unit conversion     |
| 9-12               | Recipe scaling, cooking mode (timers, temps), ingredient headings, bulk import           |
| 13a-e              | Household sharing, SSE real-time events, notification bell                               |
| UI + Polish        | Custom color system, mobile-first layout, recipe print/share, meal templates             |
| Smarter UX         | Shelf-life auto-suggest, low-stock nudges, pairing/waste/efficiency                     |
| Monetization infra | Subscription tiers, Stripe integration, invite codes, admin dashboard, graceful downgrade |
| AI integration     | Ingredient substitutions (static DB + LLM), recipe generation from inventory, recipe metadata enhance |
| Inventory drift    | Uncooked meal reminders, smarter expiring-items callout                                  |
| UX review          | Recipes page simplification — match stats in filter bar, grid visible without scrolling  |

---

## Phase Now: Iterate and Refine

The core loop is complete — plan, shop, cook, subtract, repeat. The app doesn't
need more features; it needs the existing ones to be smooth enough for daily use.
New ideas come from the friction log, not a roadmap.

Daily driving started **February 12, 2026**. The app is being used for real
cooking and meal planning. 3 external users onboarded (girlfriend as household
co-user, plus a friend and his girlfriend as a separate household).

### Critical Path

1. **Daily drive for 4+ weeks** — Plan the week, shop from the list, cook from
   the app. Fix friction as it surfaces.
2. **Stress-test inventory** — Track inventory honestly for a month. Measure
   drift. Determine whether overhead is justified or whether inventory needs to
   be more passive (auto-populate from shopping list check-offs only).

### Proven Gate

The app has **fully replaced Apple Notes** and **weekly meal planning happens
in-app** for 4+ consecutive weeks before monetization activates. Feature
development is **not blocked** by this gate.

**Personal criteria:**

- Am I using the app every week? Has it fully replaced Apple Notes?
- Is inventory tracking sustainable, or does light mode need to ship?
- Do the testers find it useful without prompting?

> **Check-in: March 12, 2026.** Assess daily driving progress. If the app isn't
> sticking, identify UX friction and fix it. Don't defer indefinitely.

### Contingency: Light Inventory Mode

The entire value proposition rests on users maintaining inventory. If daily
driving reveals that inventory tracking feels like a chore, the fallback is a
**passive "light inventory" mode** that removes the maintenance burden.

**Trigger criteria** (assess at March 12 gate check):

- Inventory updates happen less than 2x/week despite regular cooking
- Inventory drift > 30% (items marked in-stock that are actually gone, or items
  in stock that were never tracked)
- Qualitative: you or external users actively avoid opening the inventory page

**What changes:**

- **Input becomes passive** — inventory is populated exclusively through:
  - Shopping list check-offs (already built)
  - "I have this" buttons on recipe cards and detail pages (already built)
  - Post-cooking subtraction (already built)
  - No manual entry page; the current add/edit flow becomes optional "power mode"
- **Boolean instead of quantities** — items are "have" or "don't have," no
  amount/unit tracking. Eliminates the hardest maintenance task (updating
  quantities after partial use)
- **Auto-expire aggressively** — items auto-expire based on shelf-life lookup
  (already built, ~60 entries). No manual expiry management. Expired items
  silently drop off rather than requiring user action
- **Match rings become suggestions** — "You might be able to make this" instead
  of "You can make 8/10 ingredients." Fuzzy confidence rather than precise counts

**Affected files/systems:**

- `app/routes/inventory/index.tsx` — simplified view, hide quantity/unit columns,
  prominent "populated from your shopping" messaging
- `app/routes/inventory/new.tsx` — hide or gate behind "detailed mode" toggle
- `app/utils/recipe-matching.server.ts` — boolean matching (have/don't have)
  instead of quantity-aware. Scoring becomes binary per-ingredient
- `app/routes/shopping.tsx` — check-off pipeline becomes the primary inventory
  input path, emphasized in UI
- `app/components/recipe-match-card.tsx` — softer language ("likely makeable"
  vs "8/10 ingredients")
- `app/utils/inventory-subtract.server.ts` — boolean subtract (remove item
  entirely) instead of quantity math
- User setting toggle: full vs. light inventory mode, persisted in DB

**What stays the same:** Recipe matching still works (just fuzzier), shopping
list generation still works, meal planning still works. The core loop survives
— it's just less precise.

> This is a contingency, not a plan. Build it only if the trigger criteria are
> met. The goal is to have a clear fallback so that inventory friction doesn't
> kill the product.

### Friction Log

Issues discovered during daily driving. Format: date, area, observation, status.

| Date       | Area      | Observation                                          | Status   |
| ---------- | --------- | ---------------------------------------------------- | -------- |
| 2026-02-17 | _example_ | _Shopping list: hard to tell which items are checked_ | _open_   |
| 2026-02-17 | _example_ | _Meal plan: "Up next" banner flickers on page load_   | _fixed_  |

> Add entries as friction surfaces. Resolve or promote to Strategic Priorities.

---

## Strategic Priorities

Identified during a full-app UX and strategy review (February 2026). Highest-
impact changes before monetization, ordered by priority (High before Medium).

### 1. Free tier taste of inventory

**Impact:** High — makes the app better for everyone.

Free users see 3/4 nav tabs locked and can't experience match rings or discovery.
Let free users add 10-15 inventory items — enough for the "aha" moment. Upgrade
trigger becomes "I want more than 15 items" rather than "I have to pay to try."

**Affected files/systems:**

- `app/utils/subscription.server.ts` — add `FREE_INVENTORY_LIMIT` constant,
  `canAddInventoryItem(userId)` check
- `app/routes/inventory/index.tsx` — show items up to limit, upgrade CTA when
  near/at limit
- `app/routes/inventory/new.tsx` — enforce limit in action, show upgrade nudge
- `app/routes/recipes/index.tsx` — enable match rings and "Almost There" banner
  for free users who have inventory items
- `app/components/getting-started-checklist.tsx` — unlock inventory step for
  free users (currently hidden)
- `app/routes/upgrade.tsx` — update copy to emphasize "unlock unlimited
  inventory"
- `app/components/nav-links.tsx` — unlock inventory tab for free tier (keep
  lock on plan/shopping until upgrade)

### 2. UX debt cleanup

**Impact:** High — affects daily use quality.

These affect every session. More impactful than onboarding nudges for testers
who are already past onboarding.

- **Shopping list Quick Add collapsed by default** — adding items is the primary
  action but requires a click to access
- **Recipe detail is 1500+ lines** — modal, ingredient list, cooking history,
  and mobile action bar all inline. Extract to components
- **Large action handlers** — `shopping.tsx` and `plan/index.tsx` each have 9
  intents. Consider extracting to resource routes

### 3. Implement merged single tier

**Impact:** Medium — resolved decision, just needs implementation.

Collapse Pro + Household into one paid tier. Annual-only at launch.

**Files:**

- `prisma/schema.prisma` — remove `household` tier enum value
- `app/utils/subscription.server.ts` — simplify tier checks
- `app/routes/upgrade.tsx` — single pricing card, remove billing toggle
- `app/routes/admin/subscriptions.tsx` — update admin UI
- Stripe Dashboard — archive Household prices, remove monthly Price IDs

---

### AI Integration

AI enhancements integrated into existing flows. The bar for AI features is "would
I actually use this while cooking?" — not "is this technically possible." The
inventory loop is the moat, not AI. Principles: no chat UI, user stays in
control (editable drafts), cost-aware (gate on action, cache, never in loaders).

- [x] **Ingredient substitutions** — static DB + LLM fallback, inventory-aware.
      Strongest AI feature — solves a real in-the-moment cooking problem
- [x] **Recipe generation from inventory** — Claude Haiku, preview before save.
      Useful occasionally for inspiration, but the matching system is the real
      answer to "what can I make?"
- [x] **Recipe enhance** — one-click metadata inference (description, times,
      servings) with review modal. 10/day rate limit. Primarily a one-time
      cleanup tool for bulk-imported recipes
- [ ] **Receipt scanning → inventory** — photo upload, OCR + AI extraction,
      review before bulk-adding. Build only if daily driving reveals inventory
      input as the main friction point

> ~~Smart meal plan generation~~ — deprioritized. Pairing suggestions already
> handle the smart part (ingredient overlap, weeknight-aware sorting). Full
> auto-generation removes the personal judgment that makes meal planning work —
> you pick meals based on what you feel like, what happened this week, what's in
> season. An algorithm can't know you want something light tonight.

#### Cost notes

~$0.05/month per active Pro user. Well under 2% of a $35/yr subscription.
Details: substitution ~$0.001/call (cached 30 days), generation ~$0.003/call
(daily limit of 10), enhance ~$0.0014/call (daily limit of 10, max ~$0.42/month
if maxed daily).

### Monetization

Infrastructure is complete (Stripe, invite codes, tier enforcement, graceful
downgrade). See [MONETIZATION_STRATEGY.md](./MONETIZATION_STRATEGY.md) for
strategy, pricing, and go-live requirements.

Ship after the no-waste planning features (pairing, efficiency, waste alerts)
are proven in daily use — the marketing pitch needs to be real first.

---

## Debt

### UX

Promoted to [Strategic Priority #2](#2-ux-debt-cleanup).

### Technical

- **Fire-and-forget event emission** — `emitHouseholdEvent()` runs async without
  awaiting. Risk of SQLite concurrency under load. Tests need `vi.mock()`
- **In-memory matching at scale** — loads all recipes + inventory for matching.
  Fine at ~135 recipes, profile at 500+
- **Profile photo S3 orphans** — photo updates never clean up old S3 objects

---

## Pre-Monetization Requirements

Must be operational before charging users. These aren't features — they're
infrastructure that a paid product can't launch without. For the full go-live
checklist (business registration, Stripe, legal), see
[MONETIZATION_STRATEGY.md § Checklist](./MONETIZATION_STRATEGY.md#checklist).

- [ ] **Automated backups** — scheduled SQLite backup to S3 (Litestream or
      cron). Non-negotiable for a paid product; data loss = refunds + reputation
      damage. Also cross-referenced in the
      [go-live checklist](./MONETIZATION_STRATEGY.md#checklist)
- [ ] **Monitoring & alerting** — uptime monitoring, error rate alerts, and
      basic dashboard. Know about outages before users do

---

## Backlog

Lower-priority items. Graduate when daily use reveals friction or user feedback
requests them.

- [ ] **Defrost & prep-ahead reminders** — "You're cooking Chicken Tikka
      tomorrow — the chicken is in your freezer." Connects meal plan entries +
      recipe ingredients + inventory locations. Also supports user-editable
      prep-ahead notes on recipes (marinating, soaking, dough rising) that
      surface the day before a planned cook
- [ ] **Quick restock** — after shopping, show recently depleted/subtracted
      inventory items for one-tap re-add. Targets the exact moment inventory
      maintenance feels like overhead — items bought off-list that aren't
      covered by the shopping list → inventory pipeline
- [ ] **Leftovers/batch awareness** — if a recipe serves 6 and you're 2 people,
      that's 3 meals not 1. The meal plan has no concept of this — you plan 7
      dinners when you really only need to cook 4-5. Watch for friction signal
      during daily driving before building
- [ ] **Progressive onboarding & contextual nudges** — post-action milestone
      nudges (e.g., "Generate a shopping list from your plan" after first meal
      planned). Inventory-first AI recipe path for users with no recipes.
      Build when strangers are signing up, not while testers are past onboarding
- [ ] **Dashboard homepage** — aggregates today's meals, top matches, expiring
      items, low-stock nudges. Risk: becomes stale UI that duplicates individual
      pages. Build only if user feedback requests it post-launch
- [ ] **Performance audit** — query profiling, lazy load images, bundle analysis
- [ ] **Nutrition estimates** — Nutritionix or Edamam API
- [ ] **Subscription pause** — 1-3 month pause option instead of cancel (Stripe
      supports this via `pause_collection`)
- [ ] **Cancel flow** — show what they'll lose, offer "switch to annual" before
      confirming. Proactive JSON export in cancel flow
- [ ] **Monthly cooking summary** — email digest of cooking stats (requires
      transactional email infrastructure)

---

## Success Metrics

### Daily Driver (current focus)

- [x] All Apple Notes recipes imported (~135 bulk imported)
- [x] Partner uses the app as a real co-user
- [ ] Apple Notes no longer used for recipes
- [ ] Weekly meal planning in-app for 4+ consecutive weeks
- [ ] Inventory tracking feels sustainable (not a chore)
- [ ] Testers use the app without prompting

### Monetization (future)

- [ ] A few strangers tried it and found it useful
- [ ] Someone paid for it

---

_Last updated: February 17, 2026._
