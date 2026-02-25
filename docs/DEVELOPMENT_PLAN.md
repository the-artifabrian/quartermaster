# Quartermaster - Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application built to
replace 100+ recipes scattered across Apple Notes. It provides searchable recipe
storage, kitchen inventory tracking, meal planning, and smart shopping list
generation.

Built in ~3 weeks (starting February 6, 2026) using Claude Code as an AI coding
assistant for rapid iteration. The scope reflects the development speed that
AI-assisted coding enables, not months of traditional engineering.

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
sweep for drift correction.

**The binding constraint is now validation, not features.** The app has more
features than most mature cooking apps. What it doesn't have is evidence that
strangers find it useful, data on which features drive retention, or a sustained
path to users. Priority is: get the app in front of non-friend testers, instrument
the funnel, and polish the first 5 minutes of the experience.

That said — rapid iteration with an AI coding assistant means the cost of
building is low. Don't stop coding. But let daily-use friction and tester
feedback drive what you build, not the backlog. "I watched a stranger get
confused and fixed it in 20 minutes" is high-value iteration. "I spent a week
on defrost reminders nobody asked for" is not. The test: is this fixing
something a real person hit, or something the backlog says might matter?

Daily driving started **February 12, 2026**. The app is being used for real
cooking and meal planning. 3 external users onboarded (girlfriend as household
co-user, plus a friend and his girlfriend as a separate household).

**After two weeks:** recipe management and cooking features are clearly
validated — daily use, fully replaced Apple Notes. Shopping list is used at the
store (generated from plan + manual additions). All 3 AI features used for real
cooking decisions. Meal planning is partial (2-3 days ahead, not full-week
commitment). Household sharing is light. Usage varies across users — the
developer uses the full loop, but beta testers engage with different subsets.
This is consistent with the dual-audience hypothesis (broad: recipes + planning,
deep: inventory loop) but means the inventory loop is currently validated by one
person. Inventory sustainability is the open question — see
[Inventory Mode](#inventory-mode-rough-signal) below.

### Critical Path

1. **Find 2-3 non-friend testers NOW** — This is the single highest-value
   action before March 12. Friends tolerate friction. Strangers bounce — and
   *where* they bounce tells you what's actually broken. Post in
   r/mealprepsunday or r/Cooking as "looking for beta testers," not a launch.
   The feedback is more valuable than any feature you could build in the next 2
   weeks. Ask them to try it for 2 weeks. Watch where they get confused.
2. **Instrument the funnel** — The trial evaluation criteria are excellent
   questions, but they need actual tracking to answer. Before March 12,
   instrument: signed up → added recipe → opened inventory → created meal plan →
   generated shopping list → checked items off. Also track: inventory decay rate
   (how stale does the average user's inventory get between sweeps?). Without
   this, March 12 is a gut-check, not a data-informed decision.
3. **Polish the first 5 minutes** — Can a stranger sign up, import 3 recipes,
   plan 2 dinners, and generate a shopping list without getting confused? The
   onboarding flow exists but hasn't been tested on anyone who didn't watch you
   build it. Watch non-friend testers and fix what's confusing.
4. **Daily drive for 4+ weeks** — Plan the week, shop from the list, cook from
   the app. Fix friction as it surfaces.
5. ~~**Stress-test inventory**~~ — Resolved. Shifted to rough-signal model.
6. ~~**Ship Google OAuth**~~ — Code done. **Needs production setup:**
   - Create Google Cloud Console OAuth 2.0 Client ID (Web application)
   - Add authorized redirect URI: `https://<prod-domain>/auth/google/callback`
   - Configure OAuth consent screen (External, unverified fine under 100 users)
   - Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` in
     production env
   codes.

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

**Instrumentation required to answer these.** The existing `UsageEvent` model
tracks feature-level actions, but the trial questions need funnel-level
visibility: how far does each user get through the core loop (signup → recipe →
inventory → plan → shop → check off)? Build a simple funnel query before
recruiting non-friend testers so the March 12 check-in has data, not anecdotes.

> **Check-in: March 12, 2026.** Assess daily driving progress with data from
> funnel instrumentation and non-friend tester feedback. If the app isn't
> sticking, identify UX friction and fix it. Don't defer indefinitely.

### If Validation Fails

If non-friend testers bounce hard or the March 12 check-in produces discouraging
data, the project doesn't fail — it changes shape. Options worth having in mind:

  Stop building for scale, keep maintaining for personal use.
- **Open-source.** Let the self-hosting community carry it. Removes the
- **Rethink the value prop.** If inventory doesn't resonate but recipe
  management + planning does, the paid tier should gate something else (AI
  features, advanced import, premium design themes). The inventory loop is the
  current bet, not the only possible one.

None of these are failures — they're different outcomes for a personal tool
that was always about replacing Apple Notes first and making money second.

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

**Backlog items are low priority until March 12.** The app has more features
than most paid competitors. The next 2 weeks should emphasize: finding testers,
watching them use it, and fixing what's confusing. Keep iterating — the
dev-with-AI-assistant loop is fast and cheap — but draw from daily-use friction
and tester feedback, not from this list. None of the items below matter until a
stranger can complete the core loop without getting lost. Larger-scope items
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

