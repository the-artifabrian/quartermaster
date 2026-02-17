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

---

## Phase Now: Daily Driver

Daily driving started **February 12, 2026**. The app is being used for real
cooking and meal planning. 3 external users onboarded (girlfriend as household
co-user, plus a friend and his girlfriend as a separate household).

### Critical Path

1. **Daily drive for 4+ weeks** -- Plan the week, shop from the list, cook from
   the app. Fix friction as it surfaces.
2. **Stress-test inventory** -- Track inventory honestly for a month. Measure
   drift. Determine whether overhead is justified or whether inventory needs to
   be more passive (auto-populate from shopping list check-offs only).

### Gate

The app has **fully replaced Apple Notes** and **weekly meal planning happens
in-app** for 4+ consecutive weeks before monetization activates. Feature
development is **not blocked** by this gate.

---

## Strategic Priorities

Identified during a full-app UX and strategy review (February 2026). Highest-
impact changes before monetization, ordered by priority.

### 1. Recipes page simplification ✅

**Impact:** High — the main entry point is overloaded.

Done. Removed expiring items carousel (~320px), quality flags banner (~52px),
and grid/list view toggle. Merged match stats into filter bar, tightened
spacing. Recipe grid now visible without scrolling. `?quality=flagged` still
works (computed from main query). Progress rings and match sort retained.

### 2. Free tier taste of inventory

**Impact:** High — directly affects conversion.

Free users see 3/4 nav tabs locked and can't experience match rings or discovery.
Let free users add 10-15 inventory items — enough for the "aha" moment. Upgrade
trigger becomes "I want more than 15 items" rather than "I have to pay to try."

### 3. Dashboard homepage

**Impact:** Medium — makes the app feel like a daily companion.

Aggregates today's meals, top matched recipes, expiring items, low-stock nudges.
Currently users always land on `/recipes`. Risk: becomes stale UI that duplicates
individual pages — must add value through aggregation.

### 4. Pricing simplification

**Impact:** Medium — affects conversion clarity. See detailed recommendations in
[MONETIZATION_STRATEGY.md](./MONETIZATION_STRATEGY.md). Key points: consider
merging Pro + Household, annual-only at launch, and a free trial alongside
invite codes.

### 5. Progressive onboarding & contextual nudges

**Impact:** High — reduces overwhelm for new users and drives feature adoption.

The app has many features but the current onboarding is thin: a 3-step getting-
started checklist (add recipe, stock inventory, plan a meal) and pantry staples
on empty inventory. Users who complete those steps have no guidance toward
cooking mode, shopping lists, household sharing, templates, substitutions, etc.

**Principles:**

- **Contextual over comprehensive** — show hints where the user is, not all at
  once. A tip about shopping lists appears after the first meal plan, not on
  signup
- **Progressive disclosure** — don't explain meal templates before the user has
  planned a single meal. Nudges trigger on behavior milestones, not time
- **Never block** — all nudges are dismissible, never modal, never interrupt a
  flow. Banners or inline cards, not popups

**Inventory-first path (no recipes):**

Users who have inventory but no recipes can generate AI recipes immediately.
Surface this prominently on the empty recipes page: "Have ingredients but no
ideas? Generate a recipe from what you have." This gives immediate value with
zero recipe input effort and creates a natural bridge into the full app. The
existing AI recipe generation feature already supports this — it just needs a
more visible entry point for new users.

**Post-action milestone nudges:**

After a user completes a key action for the first time, suggest the natural next
step. Each nudge shows once, is dismissible, and is stored in localStorage (same
pattern as the getting-started checklist).

| After...                    | Suggest...                                              |
| --------------------------- | ------------------------------------------------------- |
| First recipe added          | "Add inventory items to see what you can make"           |
| First inventory items added | "Check your recipes — we'll show what you can cook now"  |
| First meal planned          | "Generate a shopping list from your plan"                |
| First shopping list used    | "Check items off to add them to inventory automatically" |
| First cook logged           | "Add notes to remember how it turned out"                |
| 5+ recipes added            | "Invite someone to share your kitchen" (household)       |
| First meal plan week done   | "Save this as a template to reuse"                       |

**Implementation approach:**

- Track milestones via localStorage flags (`milestone:<name>:seen`)
- `MilestoneNudge` component: renders an inline card/banner, takes `milestoneKey`
  and checks localStorage to show/hide. Dismiss writes the key
- Place nudges in the relevant page (not a global overlay). E.g., the "generate
  shopping list" nudge lives in `plan/index.tsx`, not in root
- No server-side tracking needed — this is purely a UX guide layer

**Not in scope:**

- Guided tours or step-by-step wizards
- Onboarding completion tracking or gamification
- Feature announcement modals

---

### AI Integration

AI enhancements integrated into existing flows. Principles: no chat UI, user
stays in control (editable drafts), cost-aware (gate on action, cache, never in
loaders).

- [x] **Ingredient substitutions** — static DB + LLM fallback, inventory-aware
- [x] **Recipe generation from inventory** — Claude Haiku, preview before save
- [x] **Recipe enhance** — one-click metadata inference (description, times,
      servings) with review modal. 10/day rate limit
- [ ] **Smart meal plan generation** — algorithmic first (constraint-satisfaction),
      LLM only if needed. Output is an editable draft
- [ ] **Receipt scanning → inventory** — photo upload, OCR + AI extraction,
      review before bulk-adding. Ship after above features prove out

> If daily driving reveals inventory _input_ friction is the main bottleneck,
> re-prioritize receipt scanning.

#### Cost notes

~$0.05/month per active Pro user. Well under 1% of a $5/month subscription.
Meal plan generation is algorithmic (no LLM cost). Details: substitution
~$0.001/call (cached 30 days), generation ~$0.003/call (daily limit of 10),
enhance ~$0.0014/call (daily limit of 10, max ~$0.42/month if maxed daily).

### Monetization

Infrastructure is complete (Stripe, invite codes, tier enforcement, graceful
downgrade). See [MONETIZATION_STRATEGY.md](./MONETIZATION_STRATEGY.md) for
strategy, pricing, and go-live requirements.

Ship after the no-waste planning features (pairing, efficiency, waste alerts)
are proven in daily use — the marketing pitch needs to be real first.

---

## Debt

### UX

- **Shopping list Quick Add collapsed by default** — adding items is the primary
  action but requires a click to access
- **Recipe detail is 1500+ lines** — modal, ingredient list, cooking history,
  and mobile action bar all inline. Extract to components
- **Large action handlers** — `shopping.tsx` and `plan/index.tsx` each have 9
  intents. Consider extracting to resource routes

### Technical

- **Fire-and-forget event emission** — `emitHouseholdEvent()` runs async without
  awaiting. Risk of SQLite concurrency under load. Tests need `vi.mock()`
- **In-memory matching at scale** — loads all recipes + inventory for matching.
  Fine at ~135 recipes, profile at 500+
- **Profile photo S3 orphans** — photo updates never clean up old S3 objects

---

## Backlog

Lower-priority items. Graduate when daily use reveals friction or user feedback
requests them.

- [ ] **Automated backups** — scheduled backup to S3 (Litestream or cron).
      Critical for a paid product
- [ ] **Performance audit** — query profiling, lazy load images, bundle analysis
- [ ] **Nutrition estimates** — Nutritionix or Edamam API
- [ ] **Monthly cooking summary** — stats from cooking logs
- [ ] **Leftovers/batch tracking** — leftover portions after cooking

---

## Success Metrics

### Daily Driver (current focus)

- [x] All Apple Notes recipes imported (~135 bulk imported)
- [x] Partner uses the app as a real co-user
- [ ] Apple Notes no longer used for recipes
- [ ] Weekly meal planning in-app for 4+ consecutive weeks
- [ ] Inventory accuracy assessed after 4 weeks of tracking
- [ ] "Up next" banner used as daily cooking entry point

### Pre-Monetization

- [~] 3-5 external users with real recipes (3 onboarded)
- [ ] External users reach the inventory loop
- [ ] Recipes page simplified (#1)
- [ ] Free-tier inventory taste decision made (#2)
- [ ] Pricing simplification decision made (#4)

### Adoption (future)

- [ ] 5+ external users with 10+ recipes each
- [ ] Pro conversion rate >5% of active free users

---

_Last updated: February 17, 2026._
