# Quartermaster - Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application built to
replace 100+ recipes scattered across Apple Notes. It provides searchable recipe
storage, kitchen inventory tracking, meal planning, and smart shopping list
generation.

> For tech stack, architecture, commands, database schema, and route structure,
> see [CLAUDE.md](../CLAUDE.md). For the full feature catalog, see
> [FEATURES.md](./FEATURES.md). For business strategy, see

---

## What's Built

The app is feature-complete for solo and shared daily use.

| Phase          | Summary                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1-4            | Recipe CRUD, inventory tracking, meal planning calendar, shopping list generation                                                                         |
| 5-8            | Inventory matching ("What can I make?"), cooking logs, unit conversion                                                                                    |
| 9-12           | Recipe scaling, cooking mode (timers, temps), ingredient headings, bulk import                                                                            |
| 13a-e          | Household sharing, SSE real-time events, notification bell                                                                                                |
| Polish + UX    | Color system, mobile-first layout, print/share, meal templates, shelf-life, pairing/waste, cooking progress, card streamlining, weekly inventory sweep    |
| AI             | Ingredient substitutions (static DB + LLM), recipe generation, metadata enhance                                                                           |
| Beta hardening | Dead code cleanup, a11y (focus traps, aria-labels, focus rings), render-time setState fixes, SSRF + sourcemap + error sanitization, shopping live-refresh |

onboarding nudges, weekly inventory sweep, suggest meals with meal type picker,
free inventory limit bumped to 50, copy/UX polish pass across all pages.

---

## Phase Now: Iterate and Refine

The core loop is complete — plan, shop, cook, review, repeat. Inventory is
treated as a rough signal rather than a source of truth: no auto-subtraction,
advisory shopping deductions (pre-checked not omitted), and a weekly inventory
sweep for drift correction. Priority is making the existing flow smooth enough for
daily use, but that doesn't mean new work only comes from friction. UX
improvements, design system implementation, and ideas that make the app more
pleasant to use are all fair game alongside reliability fixes. New AI
surface-area work is paused until core-loop reliability items are closed and
daily-driver retention is stable.

Daily driving started **February 12, 2026**. The app is being used for real
cooking and meal planning. 3 external users onboarded (girlfriend as household
co-user, plus a friend and his girlfriend as a separate household).

**After one week:** recipe management and cooking features are clearly validated
— daily use, fully replaced Apple Notes. Shopping list is used at the store
(generated from plan + manual additions). All 3 AI features used for real cooking
decisions. Meal planning is partial (2-3 days ahead, not full-week commitment).
Household sharing is light. Inventory sustainability is the open question — see
[Inventory Mode](#inventory-mode-rough-signal) below.

### Critical Path

1. **Daily drive for 4+ weeks** — Plan the week, shop from the list, cook from
   the app. Fix friction as it surfaces.
2. ~~**Stress-test inventory**~~ — Resolved. Shifted to rough-signal model.
3. ~~**Ship Google OAuth**~~ — Code done. **Needs production setup:**
   - Create Google Cloud Console OAuth 2.0 Client ID (Web application)
   - Add authorized redirect URI: `https://<prod-domain>/auth/google/callback`
   - Configure OAuth consent screen (External, unverified fine under 100 users)
   - Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` in
     production env
   codes.
5. **Find 2-3 non-friend testers** — Friendly users won't surface what's
   confusing. Find people who meal plan (colleagues, online communities) and ask
   them to try it for 2 weeks. This isn't a launch — it's learning whether the
   app makes sense to someone who didn't watch you build it.

### Proven Gate

The app has **fully replaced Apple Notes** and **meal planning happens in-app**
**not blocked** by this gate.

**Personal criteria:**

- Am I using the app every week? Has it fully replaced Apple Notes?
- Is the rough-signal inventory model sustainable long-term?
- Do the testers find it useful without prompting?
  items and want more, or do they bounce before experiencing the "aha"?
- What do real users actually use vs. ignore? Which features does the household
  co-user touch daily? What does the friend's household never open?
- Does the pitch work on strangers? If non-friend testers don't get past
  inventory onboarding, the pitch needs rework — not more features.

**Trial-specific questions** (assess after first cohort):

- What % of trial users engage with meal planning?
- What % use shopping list generation?
- What % touch inventory at all?
- What's trial → paid conversion?
- Do trial users invite household members?
  "recipes + planning + basic shopping" (Phase 2 restructure)?

> **Check-in: March 12, 2026.** Assess daily driving progress. If the app isn't
> sticking, identify UX friction and fix it. Don't defer indefinitely.

### Inventory Mode: Rough Signal

Inventory as rough signal — no quantities, no auto-subtraction. Three purposes:
match rings (do you have the ingredient?), advisory shopping deductions
(pre-checked not omitted), and weekly sweep for drift correction. Input flows in
via shopping check-off → inventory pipeline. Monitor whether rough-signal
accuracy is sufficient for match rings and shopping list pre-checks.

### Friction Log

23 items surfaced and fixed during daily driving and beta hardening (a11y,
shopping UX, live-refresh, optimistic UI, error handling, onboarding). Detail in
git history. Add new entries as friction surfaces.

---

## Technical Debt

- **Fire-and-forget event emission** — `emitHouseholdEvent()` runs async without
  awaiting. Risk of SQLite concurrency under load. Tests need `vi.mock()`
- **In-memory matching at scale** — loads all recipes + inventory for matching.
  Fine at ~135 recipes, profile at 500+
- **Profile photo S3 orphans** — photo updates never clean up old S3 objects

---

## Backlog

Daily use and judgment both inform what to pick up next. Larger-scope items
(nutrition APIs, email digests, dashboards) are better suited for

- [ ] **Value recap panel** — lightweight summary of user benefit (meals cooked,
      plan completion, recipes added this week). Lives on a future
      dashboard/homepage
- [ ] **Defrost & prep-ahead reminders** — "You're cooking Chicken Tikka
      tomorrow — the chicken is in your freezer." Also supports user-editable
      prep-ahead notes (marinating, soaking, dough rising)
- [ ] **Quick restock** — after shopping, show recently removed inventory items
      for one-tap re-add. Targets items bought off-list
- [ ] **Leftovers/batch awareness** — if a recipe serves 6 and you're 2 people,
      that's 3 meals not 1. Watch for friction signal before building
- [ ] **Social media recipe import** — save recipes from TikTok, Instagram
      Reels, YouTube Shorts. High-leverage for acquisition but non-trivial
      (video parsing / OCR / LLM extraction). Evaluate build vs. integrate
- [ ] **Receipt scanning → inventory** — camera capture of grocery receipts.
      Build only if inventory input remains the main friction point
- [ ] **Voice inventory input** — dictate updates like "add chicken breast to
      the fridge." Deferred pending shopping → inventory pipeline test

---

## Deferred

Ideas evaluated and set aside. Revisit if circumstances change.

- **Step-by-step cooking mode** — current cooking view already has checkboxes,
  timers, wake lock, and temp tooltips. Revisit if insufficient for actual
  cooking
- **Fuzzy/typo-tolerant search** — at 135 recipes, users know the names. Revisit
  at scale
- **Ingredient-based recipe search** — the matching system already does this via
  inventory
- **Offline mutations** — massive complexity on a server-rendered form app.
  Service worker caches pages for reading; optimistic UI is the 80/20 solution
- **Collections/cookbooks** — tags were built and removed as overengineered.
  Revisit at 300+ recipes
- **Nutrition estimates** — large effort (API integration, per-ingredient
  lookup). No user demand
- **Public profiles / social features** — massive scope for a "passive income,
  not a startup" product
- **Multi-store shopping lists** — niche. Most users have one primary store
- **Push notifications** — SSE covers the active-use case. Marginal value
- **Preventive `React.memo()` / pagination** — no performance problem exists.
  Profile when there's a problem

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

