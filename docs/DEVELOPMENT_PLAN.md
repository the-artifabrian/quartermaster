# Quartermaster - Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application built to
replace 100+ recipes scattered across Apple Notes. It provides searchable recipe
storage, kitchen inventory tracking, meal planning, and smart shopping list
generation.

> For tech stack, architecture, commands, database schema, and route structure,
> see [CLAUDE.md](../CLAUDE.md). For the full feature catalog, see
> [FEATURES.md](./FEATURES.md). For business strategy, see
> [MONETIZATION_STRATEGY.md](./MONETIZATION_STRATEGY.md). For public beta
> must-fix work, see [Public Beta Action List](#public-beta-action-list).

---

## What's Built

The app is feature-complete for solo and shared daily use.

| Phase          | Summary                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1-4            | Recipe CRUD, inventory tracking, meal planning calendar, shopping list generation                                                                         |
| 5-8            | Inventory matching ("What can I make?"), cooking logs, inventory subtraction, unit conversion                                                             |
| 9-12           | Recipe scaling, cooking mode (timers, temps), ingredient headings, bulk import                                                                            |
| 13a-e          | Household sharing, SSE real-time events, notification bell                                                                                                |
| Polish + UX    | Color system, mobile-first layout, print/share, meal templates, shelf-life, pairing/waste, cooking progress, card streamlining                            |
| Monetization   | Stripe, invite codes, free tier (15-item inventory limit), admin dashboard, graceful downgrade                                                            |
| AI             | Ingredient substitutions (static DB + LLM), recipe generation, metadata enhance                                                                           |
| Beta hardening | Dead code cleanup, a11y (focus traps, aria-labels, focus rings), render-time setState fixes, SSRF + sourcemap + error sanitization, shopping live-refresh |

---

## Phase Now: Iterate and Refine

The core loop is complete — plan, shop, cook, subtract, repeat. The app doesn't
need more features; it needs the existing ones to be smooth enough for daily
use. New ideas come from the friction log, not a roadmap. New AI surface-area
work is frozen until core-loop reliability items are closed and daily-driver
retention is stable.

Daily driving started **February 12, 2026**. The app is being used for real
cooking and meal planning. 3 external users onboarded (girlfriend as household
co-user, plus a friend and his girlfriend as a separate household).

**After one week:** recipe management and cooking features are clearly validated
— daily use, fully replaced Apple Notes. Shopping list is used at the store
(generated from plan + manual additions). All 3 AI features (substitutions,
generation, enhance) used for real cooking decisions. Meal planning is partial
(2-3 days ahead, not full-week commitment). Household sharing is light (partner
uses occasionally, not a habit). Inventory sustainability and expiry/low-stock
value are the open questions — see
[Inventory Mode](#inventory-mode-active-evaluation) below.

### Critical Path

1. **Daily drive for 4+ weeks** — Plan the week, shop from the list, cook from
   the app. Fix friction as it surfaces.
2. **Stress-test inventory** — Track inventory honestly for a month. Measure
   drift. Determine whether overhead is justified or whether inventory needs to
   be more passive (auto-populate from shopping list check-offs only). Track
   weekly: how many manual inventory updates? What percentage of items are
   accurate? Does it feel like homework?
3. **Find 2-3 non-friend testers** — Friendly users won't surface what's
   confusing. Find people who meal plan (colleagues, online communities) and ask
   them to try it for 2 weeks. This isn't a launch — it's learning whether the
   app makes sense to someone who didn't watch you build it.

### Proven Gate

The app has **fully replaced Apple Notes** and **meal planning happens in-app**
for 4+ consecutive weeks before monetization activates. Feature development is
**not blocked** by this gate.

**Personal criteria:**

- Am I using the app every week? Has it fully replaced Apple Notes?
- Is inventory tracking sustainable, or does light mode need to ship?
- Do the testers find it useful without prompting?
- Is the 15-item inventory limit the right Pro gate? Do free users reach 15
  items and want more, or do they bounce before experiencing the "aha"?
- What do real users actually use vs. ignore? Which features does the household
  co-user touch daily? What does the friend's household never open?
- Does the pitch work on strangers? If non-friend testers don't get past
  inventory onboarding, the pitch needs rework — not more features.

> **Check-in: March 12, 2026.** Assess daily driving progress. If the app isn't
> sticking, identify UX friction and fix it. Don't defer indefinitely.

### Inventory Mode: Active Evaluation

After one week of daily driving, inventory tracking is **tolerable but not
natural** — it works but requires conscious effort. The entire value proposition
(matching, subtraction, the "full loop" pitch) rests on this being sustainable.

**What's valued in practice:** match rings on recipe cards, shopping list
generation (subtracting what you have), post-cook inventory subtraction. All
three power the core loop. **What's not valued:** expiry dates, low-stock flags,
shelf-life auto-suggest, "use these up soon" callout — significant feature
investment with no daily-use payoff.

**Key insight:** all three valued features work with less precise input. Match
rings just need to know you _have_ an ingredient. Shopping generation can
subtract "you have flour" instead of "you have 2 cups flour." The heavy
maintenance (quantities, units, expiry) adds precision that isn't paying for
itself.

**The test:** the shopping check-off → inventory pipeline (untested — built
after the last shopping trip). If checking off groceries at the store and
flowing them into inventory feels natural, the lifecycle becomes mostly passive:
shopping check-offs add items, post-cook subtraction removes them, "I have this"
buttons handle the rest. No manual inventory page visits needed.

**Decision criteria** (assess at March 12 gate check):

- Shopping → inventory pipeline feels natural → keep inventory, shift to passive
  input model
- Pipeline feels like overhead, or inventory updates < 2x/week → simplify to
  boolean have/don't-have
- Users actively avoid the inventory page → reconsider whether persistent
  tracking is the right model

Track weekly: update frequency, accuracy spot-checks, subjective friction.

### Friction Log

Issues discovered during daily driving and UX review. Format: date, area,
observation, status.

Status: `open` = confirmed friction, needs fix. `watch` = potential issue,
monitor during daily driving before building. `fixed` = resolved. Actionable
items graduate to the [Public Beta Action List](#public-beta-action-list).

| Date       | Area       | Observation                                                                                                         | Status |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------- | ------ |
| 2026-02-19 | a11y       | Inventory "Location" label isn't properly associated with the select on `/inventory/new`                            | open   |
| 2026-02-19 | AI         | LLM error messages are generic toasts — paid Pro features should say what happened, not just "Something went wrong" | open   |
| 2026-02-19 | auth       | Forgot password leaks user existence — returns "No user exists" instead of a generic success message                | watch  |
| 2026-02-19 | cooking    | `UncookedMealReminder` loads once on mount — may miss newly-created uncooked entries later in-session               | watch  |
| 2026-02-19 | navigation | Pro lock icons have no tooltip or aria-label — free users see unexplained locks with no context                     | watch  |
| 2026-02-19 | shopping   | Quick Add form is keyed by total items and can remount on count changes, dropping in-progress input                 | watch  |
| 2026-02-19 | shopping   | "Clear checked items" has no confirmation — plain form POST, no double-check, no undo                               | watch  |
| 2026-02-19 | onboarding | Pantry staples onboarding has no "next step" CTA — user stays on `/inventory` with no guidance forward              | watch  |
| 2026-02-19 | onboarding | Getting Started dismissal uses one localStorage key shared across users on same device                              | watch  |

> 14 items fixed Feb 18-19 (shopping UX, live-refresh, inline editing,
> optimistic UI, recipe selector search, loading indicator, sourcemaps, invite
> token, error sanitization). Add entries as friction surfaces. Resolve `open`
> items promptly; promote `watch` to `open` if they cause real friction.

### Public Beta Action List

13 must-fix items completed (household event coverage, render-time setState
fixes, inventory validation, recipe import redirects, modal keyboard behavior,
a11y focus rings + aria-labels, sourcemap config, dead code cleanup, share
warning, join page error sanitization). Detail in git history.

#### Should fix soon

- [x] Pick one timezone/date strategy for meal-plan write/read/query paths and
      apply it consistently.
- [ ] Add error feedback and rollback path for post-cook "used up"
      fire-and-forget actions.
- [ ] Fix `/inventory/new` location label/select association.
- [ ] Refresh uncooked meal reminders after relevant plan changes during long
      sessions.
- [ ] Reduce heavy fetch patterns on recipe index, inventory index, and
      meal-plan pairing for larger datasets.

#### Watch

- [ ] Keep shopping quick-add mounted while list count changes so in-progress
      input is not dropped.
- [ ] Scope getting-started dismissal per user, not just one browser-level
      localStorage key.

---

## Technical Debt

- **Fire-and-forget event emission** — `emitHouseholdEvent()` runs async without
  awaiting. Risk of SQLite concurrency under load. Tests need `vi.mock()`
- **In-memory matching at scale** — loads all recipes + inventory for matching.
  Fine at ~135 recipes, profile at 500+
- **Profile photo S3 orphans** — photo updates never clean up old S3 objects
- **`shopping.tsx` is 1,021 lines** — last remaining mega-file. Combines
  generation, CRUD, check-off, SSE, and inventory pipeline in one route. Extract
  sub-components following the recipe detail pattern (1,640 → 590 lines)
- **Service worker caches stale URL** — `sw.js` line 113 caches
  `/plan/shopping-list` (old URL), should cache `/shopping`
- **Subscription state complexity** — `trialEndsAt` is active and intentional
  (invite codes + entitlement checks). Keep it, but document invariants and
  simplify only if the trial/invite model changes
- **No E2E test for shopping → inventory pipeline** — this is the feature being
  evaluated to determine inventory viability. If it breaks silently during daily
  driving, the evaluation is invalid

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

Items directly tied to the cooking loop. Graduate when daily use reveals
friction. Everything else (nutrition APIs, subscription management, email
digests, dashboards) is premature — revisit after monetization is live and
there's user feedback to act on.

- [ ] **Weekly reset flow** — one-tap prefill next week from favorites +
      low-stock + expiring items, then generate shopping draft. Targets the
      "what should I cook this week?" moment
- [ ] **Value recap panel** — lightweight summary of user benefit (items used
      before expiry, planned meals cooked, checked shopping items). Makes the
      app's value visible rather than invisible
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
- [ ] **Google OAuth (replace GitHub)** — GitHub login signals "developer tool"
      on a consumer recipe app. Swap to Google OAuth for non-technical tester
      onboarding. Epic Stack's `remix-auth` provider pattern makes this a swap,
      not a rebuild. Requires Google Cloud Console project + OAuth consent
      screen (unverified apps show a warning, fine under 100 users). Do before
      inviting non-friend testers, after the March 12 check-in
- [ ] **Progressive onboarding** — post-action contextual nudges (next-best
      action prompts) for non-friend testers. Build when they are actively
      signing up, not before
- [ ] **Receipt scanning → inventory** — camera capture of grocery receipts to
      auto-populate inventory. Build only if inventory input remains the main
      friction point after the shopping pipeline is proven
- [ ] **Voice inventory input** — dictate updates like "add 2 pounds chicken
      breast to the fridge." Cloud STT is accurate and cheap (Deepgram Nova-3 is
      the top pick), but parsing transcripts into structured actions adds
      complexity. Deferred pending the shopping → inventory pipeline test: if
      the pipeline makes input mostly passive, voice may be unnecessary

---

## Deferred / Rejected

Ideas evaluated and deliberately set aside. Documented here to prevent
relitigating.

- **Step-by-step cooking mode** — current cooking view already has checkboxes,
  timers, wake lock, progress persistence, and temp tooltips. A separate
  step-by-step UI is a substantial new feature. Revisit only if daily driving
  reveals the current view is insufficient for actual cooking (hasn't surfaced
  in friction log)
- **Fuzzy/typo-tolerant search** — at 135 personal recipes, users know the
  names. No search-miss complaints. Revisit if library scale or user feedback
  demands it
- **Ingredient-based recipe search** — the matching system already does this via
  inventory. A separate search UI is a second path to the same destination
- **Offline mutations** — background sync with conflict resolution on a
  server-rendered form app is massive complexity. Service worker caches pages
  for reading. Optimistic UI (already on shopping checkboxes) is the 80/20
  solution for slow connections
- **Collections/cookbooks** — tags were built and removed as overengineered.
  Same risk. Revisit at 300+ recipes if users can't find things
- **Nutrition estimates** — large effort (API integration, per-ingredient
  lookup, serving math). No user demand. Revisit post-launch
- **Public profiles / social features** — growth lever but massive scope for a
  "passive income, not a startup" product. Revisit post-launch with user base
- **Multi-store shopping lists** — niche. Most users have one primary store
- **Push notifications** — SSE covers the active-use case. iOS web push is
  possible but adds complexity for marginal value
- **Preventive `React.memo()` / pagination** — no performance problem exists at
  135 recipes. Profile when there's a problem, not before

---

## Success Metrics

### Daily Driver (current focus)

- [x] All Apple Notes recipes imported (~135 bulk imported)
- [x] Partner uses the app as a real co-user
- [ ] Apple Notes no longer used for recipes
- [ ] Weekly meal planning in-app for 4+ consecutive weeks
- [ ] Inventory tracking feels sustainable (not a chore)
- [ ] Testers use the app without prompting
- [ ] 2-3 non-friend testers used the app for 2+ weeks

### Monetization (future)

- [ ] Someone paid for it

---

_Last updated: February 19, 2026._
