# Quartermaster - Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application built to
replace 100+ recipes scattered across Apple Notes. It provides searchable recipe
storage, kitchen inventory tracking, meal planning, and smart shopping list
generation.

> For tech stack, architecture, commands, database schema, and route structure,
> see [CLAUDE.md](../CLAUDE.md). For the full feature catalog, see
> [FEATURES.md](./FEATURES.md). For business strategy, see
> must-fix work, see [Public Beta Action List](#public-beta-action-list).

---

## What's Built

The app is feature-complete for solo and shared daily use.

| Phase          | Summary                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1-4            | Recipe CRUD, inventory tracking, meal planning calendar, shopping list generation                                                                         |
| 5-8            | Inventory matching ("What can I make?"), cooking logs, unit conversion                                                                                    |
| 9-12           | Recipe scaling, cooking mode (timers, temps), ingredient headings, bulk import                                                                            |
| 13a-e          | Household sharing, SSE real-time events, notification bell                                                                                                |
| Polish + UX    | Color system, mobile-first layout, print/share, meal templates, shelf-life, pairing/waste, cooking progress, card streamlining, weekly inventory sweep     |
| AI             | Ingredient substitutions (static DB + LLM), recipe generation, metadata enhance                                                                           |
| Beta hardening | Dead code cleanup, a11y (focus traps, aria-labels, focus rings), render-time setState fixes, SSRF + sourcemap + error sanitization, shopping live-refresh |

---

## Phase Now: Iterate and Refine

The core loop is complete — plan, shop, cook, review, repeat. Inventory is
treated as a rough signal rather than a source of truth: no auto-subtraction,
advisory shopping deductions (pre-checked not omitted), and lightweight post-cook
check-ins. Priority is making the existing flow smooth enough for daily use, but
that doesn't mean new work only comes from friction. UX improvements, design
system implementation, and ideas that make the app more pleasant to use are all
fair game alongside reliability fixes. New AI surface-area work is paused until
core-loop reliability items are closed and daily-driver retention is stable.

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
2. ~~**Stress-test inventory**~~ — Resolved. Auto-subtraction removed; inventory
   shifted to rough-signal model (advisory shopping deductions, post-cook
   check-ins, weekly sweep). Input is mostly passive via shopping check-off →
   inventory pipeline. Monitor whether rough-signal accuracy is sufficient for
   match rings and shopping list pre-checks
3. ~~**Ship Google OAuth**~~ — Code done. Replaced GitHub with Google OAuth
   using `remix-auth-oauth2`. Provider-agnostic routes unchanged; only the
   provider config, registry, mock handlers, and UI references were swapped.
   **Still needs production setup before deploy:**
   - Create Google Cloud Console OAuth 2.0 Client ID (Web application)
   - Add authorized redirect URI: `https://<prod-domain>/auth/google/callback`
   - Configure OAuth consent screen (External, unverified fine under 100 users)
   - Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` in
     production env
4. ~~**Ship 14-day trial**~~ — Done. Every new signup gets 14 days of
   redeem codes (previously blocked). Tests cover signup trial creation and
   `getUserTier` trial detection.
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

### Inventory Mode: Rough Signal (Resolved)

After two weeks of daily driving, inventory tracking proved **tolerable but not
natural** — conscious effort was required, and digital quantities inevitably
drifted from physical reality. The critical asymmetry: an item wrongly excluded
from a shopping list (missed grocery trip) is far worse than an item wrongly
included (mild duplicate).

**Resolution: inventory as rough signal.** Auto-subtraction was removed entirely.
Inventory now serves three advisory purposes:

1. **Match rings** — recipe cards show what percentage of ingredients you have.
   Just needs to know you _have_ an ingredient, not how much
2. **Advisory shopping deductions** — items matching non-low-stock inventory are
   created as pre-checked (appear in the checked section). Users can uncheck any
   they actually need. Staples still filtered entirely
3. **Post-cook check-in** — after "I Made This", matched inventory items are
   shown in a lightweight "Anything running low?" modal with tap-to-cycle UX
   (keep → running low → used up). No quantity math. Quick-cook paths skip the
   check-in entirely

**Weekly sweep** remains the primary drift-correction mechanism: a once-per-week
banner on the plan page opens a "still have these?" modal for batch review.
Priority items (perishables, low-stock, stale 7+ days) shown first; everything
else behind an expand toggle. Items cycle keep → running low → used up.

**Shopping check-off → inventory pipeline** handles the input side: checking off
groceries at the store flows them into inventory. Combined with weekly sweep and
post-cook check-ins, the lifecycle is mostly passive — no manual inventory page
visits needed for routine use.

### Friction Log

Issues discovered during daily driving and UX review. Format: date, area,
observation, status.

Status: `open` = confirmed friction, needs fix. `watch` = potential issue,
monitor during daily driving before building. `fixed` = resolved. Actionable
items graduate to the [Public Beta Action List](#public-beta-action-list).

| Date       | Area       | Observation                                                                                                         | Status |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------- | ------ |
| 2026-02-19 | a11y       | Inventory "Location" label isn't properly associated with the select on `/inventory/new`                            | fixed  |
| 2026-02-19 | AI         | LLM error messages are generic toasts — paid Pro features should say what happened, not just "Something went wrong" | fixed  |
| 2026-02-19 | auth       | Forgot password leaks user existence — returns "No user exists" instead of a generic success message                | fixed  |
| 2026-02-19 | cooking    | `UncookedMealReminder` loads once on mount — may miss newly-created uncooked entries later in-session               | fixed  |
| 2026-02-19 | navigation | Pro lock icons have no tooltip or aria-label — free users see unexplained locks with no context                     | fixed  |
| 2026-02-19 | shopping   | Quick Add form is keyed by total items and can remount on count changes, dropping in-progress input                 | fixed  |
| 2026-02-19 | shopping   | "Clear checked items" has no confirmation — plain form POST, no double-check, no undo                               | fixed  |
| 2026-02-19 | onboarding | Pantry staples onboarding has no "next step" CTA — user stays on `/inventory` with no guidance forward              | fixed  |
| 2026-02-19 | onboarding | Getting Started dismissal uses one localStorage key shared across users on same device                              | fixed  |

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
- [x] Add error feedback and rollback path for post-cook "used up"
      fire-and-forget actions.
- [x] Fix `/inventory/new` location label/select association.
- [x] Refresh uncooked meal reminders after relevant plan changes during long
      sessions.
- [x] Reduce heavy fetch patterns on recipe index (skip ingredient fetch when
      no inventory). Inventory index and meal-plan pairing are fast at current
      scale (~135 recipes) — profile at 500+.

#### Watch

- [x] Keep shopping quick-add mounted while list count changes so in-progress
      input is not dropped.
- [x] Scope getting-started dismissal per user, not just one browser-level
      localStorage key.

---

## Technical Debt

- **Fire-and-forget event emission** — `emitHouseholdEvent()` runs async without
  awaiting. Risk of SQLite concurrency under load. Tests need `vi.mock()`
- **In-memory matching at scale** — loads all recipes + inventory for matching.
  Fine at ~135 recipes, profile at 500+
- **Profile photo S3 orphans** — photo updates never clean up old S3 objects
- ~~**`shopping.tsx` is 1,021 lines**~~ — extracted 4 sub-components
  (MobileFabAdd, ShoppingListLiveRefresh, LowStockNudge, WarningBanner). Route
  file is now ~850 lines (loader + action + main component)
- ~~**Service worker caches stale URL**~~ — fixed, `sw.js` correctly caches
  `/shopping`
- ~~**Subscription state complexity**~~ — resolved. Two trial sources now
  or replaces). `getUserTier()` handles both via the same `trialEndsAt` field.
  (upgrades their trial), only paid Pro users are blocked
- ~~**No E2E test for shopping → inventory pipeline**~~ — added: generate from
  plan, check off, review panel, add to inventory, verify in DB + UI. Also tests
  merge-with-existing-inventory path

---

## Backlog

Items tied to the cooking loop and app experience. Daily use and judgment both
inform what to pick up next — not everything needs a friction log entry to
justify building. Larger-scope items (nutrition APIs, email digests, dashboards)

- [x] **Weekly reset flow** — "Suggest Meals" button on plan page. Ranks
      recipes by expiring inventory matches, favorites, and inventory match %.
      Review modal with reason badges, inline picker, confirm → toast with
      shopping list link
- [ ] **Value recap panel** — lightweight summary of user benefit (meals cooked,
      plan completion, recipes added this week). Makes the app's value visible
      rather than invisible. Lives on a future dashboard/homepage — too much
      vertical space on the recipes page where recipe cards should dominate
- [ ] **Defrost & prep-ahead reminders** — "You're cooking Chicken Tikka
      tomorrow — the chicken is in your freezer." Connects meal plan entries +
      recipe ingredients + inventory locations. Also supports user-editable
      prep-ahead notes on recipes (marinating, soaking, dough rising) that
      surface the day before a planned cook
- [ ] **Quick restock** — after shopping, show recently removed inventory items
      for one-tap re-add. Targets items bought off-list that aren't covered by
      the shopping list → inventory pipeline
- [ ] **Leftovers/batch awareness** — if a recipe serves 6 and you're 2 people,
      that's 3 meals not 1. The meal plan has no concept of this — you plan 7
      dinners when you really only need to cook 4-5. Watch for friction signal
      during daily driving before building
- [x] **14-day full-access trial** — Every new signup gets 14 days of
      can redeem codes to extend. See
- [x] **Bump free inventory limit to 50** — Was 15, which caused a
      bait-and-switch feel: pantry staples onboarding shows 33 items but free
      tier silently truncated at 15. At 50, all 33 staples fit comfortably.
      The real Pro gate is features (planning, shopping, AI), not item count
- [x] **Google OAuth (replace GitHub)** — Replaced GitHub OAuth with Google
      using `remix-auth-oauth2`. Google Cloud Console project + OAuth consent
      screen needed for production (unverified fine under 100 users)
- [ ] **Social media recipe import** — save recipes from TikTok, Instagram
      Reels, and YouTube Shorts. Recipe saving is the universal download
      trigger; social-media import is a major growth trend (Pestle, ReciMe,
      Flavorish are all building on it). Feeds directly into the trial funnel:
      save → plan → shop. Non-trivial (video parsing / OCR / LLM extraction),
      but high-leverage for acquisition. Evaluate build vs. integrate (existing
      services like Pestle's API or a lightweight LLM approach on
      screenshots/transcripts)
- [x] **Progressive onboarding** — post-action contextual nudges (next-best
      action prompts) guiding users through recipe → inventory → meal plan →
      shopping list. Reusable `OnboardingNudge` component, localStorage dismiss,
      no schema changes
- [x] **Weekly inventory sweep** — batch-correct inventory drift from the plan
      page. Priority-filtered modal (perishables, low-stock, stale items first),
      tri-state cycling (keep/low/gone), skip fatigue prevention. Resource route
      with loader + action, household event integration
- [ ] **Receipt scanning → inventory** — camera capture of grocery receipts to
      auto-populate inventory. Build only if inventory input remains the main
      friction point after the shopping pipeline is proven
- [ ] **Voice inventory input** — dictate updates like "add 2 pounds chicken
      breast to the fridge." Cloud STT is accurate and cheap (Deepgram Nova-3 is
      the top pick), but parsing transcripts into structured actions adds
      complexity. Deferred pending the shopping → inventory pipeline test: if
      the pipeline makes input mostly passive, voice may be unnecessary

---

## Deferred

Ideas evaluated and set aside for now. Documented to capture reasoning, not to
close the door — revisit any of these if circumstances or priorities change.

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

