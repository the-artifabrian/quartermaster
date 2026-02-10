# Quartermaster - Recipe Management App Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application built to
replace 100+ recipes scattered across Apple Notes. It provides searchable recipe
storage, kitchen inventory tracking, meal planning, and smart shopping list
generation.

> For tech stack, architecture, commands, database schema, and route structure,
> see [CLAUDE.md](../CLAUDE.md).

---

## What's Built (Phases 1-13e + UI Redesign) ✅

The app is feature-complete for solo and shared daily use. Here's a summary of
everything implemented across 13 phases of development plus a comprehensive UI
redesign:

### Recipe Management

- Full CRUD with title, description, servings, prep/cook time, ingredients,
  instructions
- Image uploads (S3-compatible storage, max 3MB)
- 16 predefined tags across cuisine, meal-type, and dietary categories
- Full-text search across title, ingredients, and description
- Tag filtering and cook time filtering with bookmarkable URL params
- Recipe scaling with +/- servings controls and fraction display
- Cooking assistance: tap-to-cross-off ingredients/steps, Wake Lock toggle,
  floating kitchen timer with start/pause/reset
- Favorite/bookmark recipes with filter toggle
- Import from URL (JSON-LD scraping) with duplicate detection, quick text entry,
  JSON export
- "Surprise me" random recipe picker
- Cooking log with star ratings and notes ("I Made This")
- "Last cooked" stats on recipe cards (cook count + relative time ago)
- Personal notes field per recipe ("always double the garlic", "kids don't like
  this")

### Inventory System

- Three locations: Pantry, Fridge, Freezer
- Items with optional quantity, unit, expiration, and low-stock flag
- Quick-add shortcuts for 30 common ingredients
- "What can I make?" discovery page with fuzzy ingredient matching
- Match percentage scoring and missing ingredient highlighting
- Expiration-based recipe suggestions ("Use It Before You Lose It")
- Automatic inventory subtraction after cooking (with unit conversion and
  feedback toast showing what changed)

### Meal Planning & Shopping

- Weekly calendar view (Monday-start, 4 meal types per day)
- Click-to-assign recipes to meal slots, multiple recipes per slot
- Per-entry serving size overrides with +/- controls
- Mark meals as "cooked" with optimistic toggle UI
- Copy week to next week (preserves servings, skips duplicates)
- Auto-generated shopping list with unit-aware ingredient consolidation
- Grouped by store section (produce, dairy, meat, pantry, frozen, bakery, other)
- Inventory-aware: subtracts items already in stock and staple ingredients
- Shopping list → inventory pipeline: check off items to add them to inventory
  with pre-filled name, location, and quantity
- Manual item addition, check-off while shopping, clear checked items
- Print-friendly layout
- Ingredient overlap analysis engine: pairwise overlap using normalization
  pipeline (normalizeIngredient, synonym lookup, core word matching), efficiency
  scoring (unique-to-total ingredient ratio)
- Pairing suggestions when adding recipes to meal plan: ranked by ingredient
  overlap with already-planned recipes (inverted matching engine), sorted by
  shared ingredient count with green badges
- Single-use ingredient waste alerts with recipe suggestions to reduce waste
  ("You're only using parsley in one recipe — add Tabbouleh?")
- Unified prep list: shared ingredients across 2+ recipes aggregated into a
  Sunday prep checklist with per-recipe attribution, serving-scaled amounts,
  prep method grouping (minced, sliced, diced) from ingredient notes, storage
  tips (~30 ingredients), non-preppable filter (90+ shelf-stable items)
- Plan efficiency dashboard: total/unique ingredient stats, expandable shared
  ingredient bridges with recipe name pills

### Household Sharing

- Household model (`Household`, `HouseholdMember` join table) with owner/member
  roles, one household per user
- `householdId` on Recipe, InventoryItem, MealPlan, ShoppingList alongside
  `userId` (kept for attribution). CookingLog stays user-scoped (personal
  ratings/notes)
- ~50 queries migrated from `where: { userId }` to `where: { householdId }`
  across 15 route/utility files. Auth via `requireUserWithHousehold()` helper
  with race-safe auto-creation fallback
- Signup flows atomically create user + household + membership in transaction
- Invite system: `HouseholdInvite` model with token-based links, 7-day expiry,
  accept/decline flow, concurrent-accept guard
- Member management: rename household, remove members, revoke invites, leave
- Data on leave: sole members move all data (updateMany); multi-member leaves
  deep-copy recipes (ingredients, instructions, tags, image)
- Real-time activity via Server-Sent Events: in-memory EventEmitter singleton
  (`@epic-web/remember`) for SSE broadcasting, `HouseholdEvent` table for
  persistence. SSE endpoint with auth, 30s keepalive, self-event filtering,
  abort cleanup. Client EventSource with auto-reconnect (3-5s jitter)
- 20 event types: recipe CRUD/import/favorite, cook logged, inventory
  add/bulk-add/update/delete, meal plan assign/remove/cook/copy-week, shopping
  list generate/add-item/clear/to-inventory, member join/leave
- Sonner toast notifications with "View" action navigation to relevant pages
- Activity feed on household settings page (last 20 events, relative timestamps)
- Auto-prune events older than 30 days (lazy, on SSE connect)
- Notification bell in header with unread badge count (server-loaded COUNT query
  in root loader + real-time SSE client-side increments)
- Notification dropdown: fetches last 20 events on open via resource route,
  marks as read via POST (updates `notificationsLastSeenAt`), shows formatted
  messages with relative timestamps, unread highlighting, clickable links, and
  "View all activity" link. Badge clears optimistically

### UI, SEO & Infrastructure

- Custom color system (sage green + peach accent, OKLch) and Fraunces/DM Sans
  typography
- Descriptive `<title>`, canonical URLs, Open Graph / Twitter Card meta tags
- JSON-LD Recipe structured data, marketing pages with sitemap
- PWA with service worker: offline access for viewed recipes and meal plan
- 291 unit/integration tests across 21 files
- Deployed on Fly.io with custom domain, HTTPS, and email
- Mobile-first responsive layout with bottom navigation

### UI Redesign (10 phases, see `docs/UI_REDESIGN_PLAN.md`)

Transformed the app from "developer CRUD tool" to "daily cookbook":

- **Recipe detail overhaul**: compact header with meta card, sticky ingredients
  sidebar, dedicated cooking mode with mobile step paginator, wake lock,
  floating timer, and "Done Cooking" completion modal
- **Discover page**: hero card for top match ("Tonight's Pick"), SVG progress
  rings for match percentage, expiring-item urgency pills
- **Meal plan**: two-row calendar layout (4+3 columns), today emphasis, compact
  cards, ingredient overlap summary with pairing suggestions
- **Inventory dashboard**: summary strip (expiring/low-stock/total), expiring
  callout card with "Find recipes" CTA, location section tints, human-readable
  expiry countdowns
- **Recipe list**: sort dropdown (5 options), grid/list view toggle, tag
  category colors (cuisine/meal-type/dietary), cook-time filter
- **Shopping list**: visual progress bar, collapsible category sections with
  auto-collapse for checked sections
- **Recipe form**: collapsible `<details>` sections with completion summaries,
  mobile-friendly grid, improved ingredient row layout
- **Navigation**: sliding pill indicator on mobile bottom nav, household name
  in user dropdown
- **Landing page**: hero with serif typography and warm gradient, 4-step
  alternating feature story with mock UI visuals, dual CTAs
- **Empty states**: warm personality messages with serif headings and contextual
  illustrations across all pages
- **Accessibility**: aria-labels on interactive controls, aria-pressed on
  toggle buttons

---

## Roadmap

Priority is driven by daily use — features that remove friction from the core
cooking workflow come first. Phases 1–13 and the UI redesign are complete. Next
up: targeted daily-use polish (Tonight banner, recipe sharing, full data export)
before monetization. Phase 14 (Monetization) ships after the no-waste planning
story is proven in real use — that's the pitch that justifies paying.

### Architecture Notes (from completed phases)

- **Household migration strategy**: 13a added columns (nullable), 13b swapped
  queries, 13c added invite flow, 13d/13e added real-time notifications. Each
  sub-phase was independently deployable and rollback-safe.
- **Single-instance SSE**: SSE events emitted on one Fly machine won't reach
  clients connected to another. This is a **blocking issue for the Household
  tier** — paying household members on different machines won't see each other's
  events. Must be resolved before Household tier launches. See Pre-Phase 14
  prerequisites.
- **Public recipe sharing** (backlog item): Would need to read household-scoped
  data from a public route. Don't couple authorization too tightly to the
  session.
- **Subscription schema**: Added in 13a — `Subscription` model with `tier`,
  `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionExpiresAt`,
  `trialEndsAt`. Ready for Phase 14 without a separate schema change.

### Pre-Phase 14: Monetization Prerequisites

These items from the backlog should ship before or in parallel with Phase 14.
They're not features — they're table stakes for charging money.

- [x] ⚡ **Landing page CTA fix** — Landing page redesigned with "Start
      Cooking — It's Free" CTA linking to `/signup`. Done in UI redesign
      Phase 10.
- [~] **Accessibility pass** — Partially done in UI redesign: aria-labels on
      select elements, aria-pressed on toggle buttons (tag filters, view
      toggles, favorites). Remaining: skip-to-content link, comprehensive
      screen reader audit, focus management in cooking mode. Legal and ethical
      requirement for a paid product.
- [ ] **Import from export (data round-trip)** — JSON export exists but there's
      no import-from-export. Users burned by Yummly care about portability.
      Complete round-trip builds trust before asking people to pay.
- [ ] **New user onboarding flow** — No guided path from signup → first recipes
      → discovering features. Pantry staples onboarding exists for inventory,
      but nothing guides a user through adding their first 5 recipes or
      exploring meal planning. Consider: welcome checklist, contextual tooltips,
      or a "getting started" card on the dashboard. Retention before
      monetization matters — users who don't build the habit in week 1 won't
      convert.
- [ ] **SSE multi-instance fix** — SSE events emitted on one Fly machine won't
      reach clients on another. Fine for solo use, but if charging for the
      Household tier, two users on different machines won't see each other's
      real-time events. Options: polling fallback, LiteFS broadcast, or Redis
      pub/sub. Must be resolved before Household tier launches.

### Daily Use Polish

These aren't new "phases" — they're targeted improvements that make the app
more useful for people who cook daily. Prioritized by impact on the core
workflow: plan → shop → cook → repeat.

#### High Impact

- [ ] **"Tonight" banner on meal plan** — If today's slot has a recipe, show a
      prominent card: "Tonight: Chicken Tikka Masala" with a one-tap "Start
      Cooking" button and a quick ingredient check against inventory. If today's
      slot is empty, show a suggestion from the top Discover match. This turns
      the Plan page into a daily dashboard, not just a weekly planner.
- [ ] **Recipe sharing** — Add a "Share" button on recipe detail using the Web
      Share API (`navigator.share()`) for native mobile sharing (copy link,
      SMS, email). Fallback to clipboard copy on desktop. Currently recipes
      have OG meta tags but no way to share them from the UI. Consider: public
      read-only recipe URLs (opt-in per recipe) so shared links actually work
      for non-users.
- [ ] **Full data export** — Current download endpoint only exports the user
      profile, not recipes, inventory, or meal plans. Add comprehensive JSON
      export of all user data (recipes with ingredients/instructions/tags,
      inventory items, meal plans, cooking logs). Trust issue — people won't
      invest time entering 50+ recipes if they can't get their data out.

#### Medium Impact

- [ ] **Recipe print view** — Shopping list has `print:` styles but recipes
      don't. Add a clean print layout for recipe detail (hide nav, actions,
      compact ingredients + instructions). People still print recipes and tape
      them to cabinets.
- [ ] **Meal templates / recurring meals** — "Copy to Next Week" exists but
      most families have a rotation, not a repeat. Save a week as a named
      template ("Weeknight Easy" vs "Entertaining Week") or mark individual
      meals as recurring ("Taco Tuesday"). Reduces weekly planning friction
      significantly.
- [ ] **Quick "I made this" from meal plan** — When cooking outside of cooking
      mode (most meals), there's no fast way to log a cook and subtract
      inventory. A quick action on the meal plan card (not just the "cooked"
      checkbox) that logs the cook + subtracts ingredients in one tap would
      help keep inventory accurate with less effort.
- [ ] **Better low-match discovery** — When inventory is low, Discover shows
      discouraging low percentages. Reframe as: "You're 2 items away from
      making these 5 recipes" with an "Add missing to shopping list" button.
      Turns low matches into actionable next steps instead of dead ends.

### Phase 14: Monetization

The cooking app market is oversaturated and consolidating — Yummly (Whirlpool,
75+ staff) shut down December 2024, PlateJoy discontinued July 2025.
Subscription fatigue is real. But Quartermaster's closed-loop inventory
intelligence pipeline (track → discover → plan → shop → subtract → repeat) is
genuinely differentiated — no mainstream competitor offers this end-to-end.

Ship after Phase 12 is proven in daily use. Phase 12's no-waste meal planning is
the marketing story: "Plan meals that share ingredients, prep once on Sunday,
waste less food, save money." That pitch needs to be real before asking people
to pay for it.

#### Monetization Model: Freemium

One-time purchase doesn't sustain ongoing development. Pure subscription scares
users post-Yummly. Freemium with a generous free tier builds trust, and the
intelligence layer justifies the upgrade.

#### Free Tier

A functional recipe manager — enough to build the habit, with natural upgrade
points when the user wants more:

- [ ] Up to 50 recipes (CRUD, search, tags, images, scaling) — enough to be
      useful, low enough to hit the limit once committed. Unlimited on Pro.
- [ ] Manual recipe entry + quick text entry (URL import is Pro — it's the
      power-user feature that drives bulk recipe collection past the free limit)
- [ ] Basic cooking mode (tap-to-cross-off, wake lock)
- [ ] JSON export (data portability builds trust — users burned by Yummly
      shutting down care about this)
- [ ] Cooking log with ratings

The free tier should make users _want_ Pro, not _need_ it. The upgrade trigger
is natural: "I have 50 recipes and want to import more" or "I want the shopping
list to know what's already in my kitchen." If the free tier solves 80% of the
problem, conversion will be low.

> **Risk: 50 recipes may be too generous.** Users who manually enter recipes
> tend to plateau well under 50. The recipe-count gate assumes URL import drives
> bulk collection past the limit, but without URL import on free, users may
> never hit 50. Consider whether the primary gate should be features
> (inventory/planning) rather than recipe count — or lower the limit to 25. The
> upgrade trigger needs to be something users _actually hit_, not a theoretical
> ceiling.

#### Pro Tier (~$30–40/year or ~$4/month)

Gates the inventory intelligence loop — the closed-loop system that's the actual
differentiator. This is where ongoing development effort goes:

- [ ] Unlimited recipes (uncapped from free tier's 50 limit)
- [ ] Recipe import from URL (JSON-LD scraping with duplicate detection)
- [ ] Inventory tracking (pantry/fridge/freezer with expiration + low-stock)
- [ ] "What can I make?" discovery with fuzzy matching + expiration suggestions
- [ ] Meal planning calendar (weekly view, copy week, servings overrides)
- [ ] Smart shopping list (unit-aware consolidation, inventory subtraction,
      store-section grouping, print layout)
- [ ] Inventory subtraction after cooking (with unit conversion)
- [ ] Kitchen timer
- [ ] Phase 12 features (ingredient overlap, prep lists, efficiency scoring,
      waste alerts)
- [ ] PWA offline access

#### Household Tier (~$50/year)

Natural upgrade for couples/families. Ships after Phase 13:

- [ ] Everything in Pro
- [ ] Shared recipe library, inventory, and meal plan
- [ ] Invite household members
- [ ] Activity notifications (if 13d ships)

#### Competitive Positioning

|                                     | Quartermaster Pro  | Paprika ($5–30) | Plan to Eat ($50/yr) | Mealime ($50/yr) |
| ----------------------------------- | ------------------ | --------------- | -------------------- | ---------------- |
| Fuzzy inventory→recipe matching     | 4-level + synonyms | No              | No                   | No               |
| Unit-aware shopping consolidation   | Cross-family       | Basic           | Basic                | Yes              |
| Inventory subtraction after cooking | Yes                | No              | No                   | No               |
| Expiration-based suggestions        | Yes                | No              | No                   | No               |
| Ingredient overlap planning         | Yes (Phase 12)     | No              | No                   | No               |
| Unified prep list                   | Yes (Phase 12)     | No              | No                   | No               |

$30–40/year is cheaper than Plan to Eat and Mealime ($50/yr each) while offering
more. One-time-purchase apps like Paprika lack the intelligence layer entirely.

#### Implementation Considerations

Stripe provides full **test mode** with test API keys that don't require a
verified business account. All development work below can be built and tested
against test mode. The only step that requires a registered business entity
(PFA) is flipping to live mode for real payments.

**Go-live dependency:** Register a PFA (Persoană Fizică Autorizată) with ONRC
under a software-related CAEN code (6201 or 6209). This can take a few weeks,
so start the registration in parallel with development. You'll also need a
Romanian bank account linked to the PFA and should consider OSS (One-Stop Shop)
registration for EU cross-border VAT on digital services. Stripe Tax can handle
VAT collection automatically — enable it from day one. Consult a Romanian
accountant (contabil) for CAEN code selection and VAT strategy before
registering.

**Development (can start now, in Stripe test mode):**

- [ ] **Subscription model** — Add `Subscription` model (or fields on User):
      `tier` (free|pro|household), `stripeCustomerId`, `subscriptionExpiresAt`,
      `trialEndsAt`. If Phase 13 ships first, add these fields in 13a's
      migration to avoid a separate schema change.
- [ ] **Stripe integration** — Subscriptions, webhooks, customer portal for
      self-service plan changes / cancellation. Use Stripe Checkout for the
      payment flow to avoid building card forms.
- [ ] **Tier enforcement middleware** — Route-level guards that check
      subscription status. Free-tier users hitting a Pro route get a paywall
      page, not an error. Keep the check in a single helper
      (`requireProTier(request)`) to avoid scattering subscription logic.
- [ ] **Graceful downgrade** — When a Pro subscription lapses, data is preserved
      but gated features become read-only. User can still export their data.
      Never delete user data on downgrade. Recipes beyond the free-tier limit
      remain visible but new recipes can't be added until under the limit or
      upgraded.
- [ ] **Free trial** — 14-day Pro trial for new signups, no card required.
      Converts to free tier automatically. Trial status shown in UI with days
      remaining.
- [ ] **Pricing page** — Clear feature comparison table. Accessible from landing
      page and from paywall interstitials inside the app.

**Go-live (requires PFA registration):**

- [ ] **Register PFA** — ONRC registration, bank account, CAEN code
- [ ] **Stripe live mode** — Swap test keys for live keys, verify business
      details with Stripe, connect PFA bank account for payouts
- [ ] **VAT setup** — Enable Stripe Tax and/or register for OSS depending on
      accountant's recommendation

#### "Proven" Gate for Phase 14

Don't start monetization until Phase 12 has been used in real meal planning for
at least 4 weeks. Minimum signals that it's working:

- Pairing suggestions are used when building 3+ weekly plans
- Prep list is generated and referenced at least once per week
- Ingredient efficiency scores trend above 50% for planned weeks

Without these signals, the no-waste pitch is aspirational, not real — and that's
a weak foundation for asking people to pay.

> **Status check (February 2026):** Phase 12 is built and deployed. Are these
> signals being tracked? If the features are in daily use and meeting these
> thresholds, start Phase 14. If not, identify what's preventing adoption (UX
> friction? not enough recipes? features not discoverable?) and fix that first.
> The risk here is indefinite deferral — "proven" needs a concrete evaluation
> date, not an open-ended "later."

#### Risks

- **Small addressable market.** The overlap of "people who track kitchen
  inventory" AND "people who meal plan" AND "people willing to pay" is narrow.
  This is a tool for serious home cooks, not mass market.
- **Self-hosted alternatives.** Mealie and Tandoor are free and open-source.
  Quartermaster's advantage is polish, the intelligence layer, and not requiring
  Docker knowledge.
- **App store economics.** If going native mobile later, Apple/Google take 30%.
  PWA avoids this but limits discoverability. Web-first is the right starting
  point.

### Backlog

Lower-priority items to reconsider later. Items marked ⚡ are quick wins that
can be done between phases without disrupting planned work.

#### Infrastructure

- [ ] **Import from export (data round-trip)** — _Promoted to Pre-Phase 14
      prerequisites._ See above.
- [ ] **Automated backups** — The app stores years of recipes in a single SQLite
      file. Fly.io + LiteFS handles replication, but a scheduled backup to S3
      (daily Litestream snapshots or a cron job that copies the DB) would
      provide disaster recovery. Critical infrastructure for a paid product.
- [ ] **Performance baseline at scale** — The discover page loads all recipes +
      all inventory items into memory for matching. Fine at 50 recipes, but at
      500+ this could become slow. Profile with a realistic dataset and
      determine when pagination or server-side pre-filtering is needed.
- [ ] Bulk import (paste-and-parse for Apple Notes at scale)
- [ ] Performance audit (query profiling, lazy load images, bundle analysis)

#### Intelligence & AI

- [ ] **Ingredient parser accuracy** — The normalization pipeline handles ~40
      modifiers and ~25 synonym groups, but real-world imports will surface edge
      cases: nested quantities ("1 (14.5 oz) can diced tomatoes"), brand names
      ("Hellmann's mayonnaise"), compound ingredients ("peanut butter"), and
      non-standard units ("a handful of basil"). Build a test corpus of 100+
      real ingredient strings from imported recipes and track parse accuracy.
      Improvements here compound across matching, shopping lists, and overlap
      scoring — it's foundational infrastructure.
- [ ] **Prep freshness guidance** — Flag ingredients where prep-ahead has
      limits. Avocado or fresh herbs can't be prepped 5 days early. Simple
      heuristic rules (not AI): a small lookup table of ingredients with
      max-prep-ahead days. The prep list already has storage tips (general
      fridge/freezer advice); this would add day-specific warnings based on
      when the meal is planned (e.g., "Prep basil no earlier than Wednesday
      for Friday's dinner").
- [ ] **AI: Receipt scanning → inventory** — Photo of grocery receipt, AI
      extracts items and guesses storage locations. Review/confirm before
      adding.
- [ ] **AI: Ingredient substitutions** — When an ingredient is missing, suggest
      contextual alternatives ("No buttermilk? Use 1 cup milk + 1 tbsp lemon
      juice"). Note: the existing synonym system already handles this implicitly
      for equivalent ingredients — AI would cover non-equivalent substitutions.
- [ ] **Nutrition estimates** — Hit a nutrition API (Nutritionix or Edamam) for
      estimated calories and macros on recipe detail pages.
- [ ] **Monthly cooking summary** — Stats from cooking logs: meals cooked, most-
      made recipes, average rating. Light analytics, not diet tracking.

#### Social & Sharing

- [ ] **Public recipe sharing** — `/r/$recipeId` public read-only route with
      JSON-LD, OG tags, and sitemap. Opt-in per recipe. Design access patterns
      to work with household-scoped data from Phase 13. See also "Recipe
      sharing" in Daily Use Polish above.

#### UX Improvements

- [~] **UX: Accessibility pass** — _Promoted to Pre-Phase 14 prerequisites._
      Partially done in UI redesign. See above.
- [x] ⚡ **UX: Landing page CTA** — Done in UI redesign Phase 10.
- [x] **UX: Unified cooking mode** — Done in UI redesign Phase 1. Dedicated
      cooking view with step paginator, sticky ingredients, floating timer, and
      "Done Cooking" modal.
- [x] **UX: Recipe form length on mobile** — Done in UI redesign Phase 8.
      Collapsible `<details>` sections with completion summaries.
- [x] ⚡ **UX: Meal plan empty state** — Done in UI redesign Phase 9. Warm
      card with "Plan Your Week" heading and dual CTAs.
- [ ] **UX: Inventory quick-add quantity** — Quick-add only accepts a name.
      Adding optional inline quantity/unit/location fields would cut the
      add-then-edit workflow in half.
- ~~⚡ **UX: Unsplash placeholder images for recipes**~~ — Tried and reverted.
      Deterministic warm-color placeholders implemented in UI redesign instead
      (6 themes based on title hash).

---

## Success Metrics

### Product

- [x] Can find any recipe in < 5 seconds
- [x] Discover recipes based on available ingredients
- [x] Weekly meal planning with one-click shopping lists
- [x] App is usable in the kitchen (wake lock, tap-to-cross-off, timer, offline)
- [x] Deployed and accessible on mobile
- [ ] 50+ real recipes imported (replacing Apple Notes as primary store)
- [x] Data is backed up / exportable (JSON export)
- [x] App has its own visual identity (custom color system + typography)
- [ ] Weekly meal plans regularly achieve 60%+ ingredient efficiency
- [ ] Pairing suggestions used when building 3+ weekly plans
- [ ] Prep list generated and referenced at least once per week
- [x] Household sharing: two people use the same recipe library and meal plan

### Monetization

- [ ] Free tier retains users (>50% of signups add 5+ recipes)
- [ ] Pro conversion rate >5% of active free users
- [ ] Churn rate <5% monthly on Pro tier
- [ ] Household tier adopted by >30% of Pro users with a partner

---

_Document created: February 2026. Last updated: February 10, 2026 — completed
UI redesign (10 phases, see `docs/UI_REDESIGN_PLAN.md`): recipe detail with
cooking mode, discover hero + progress rings, two-row meal plan, inventory
dashboard, recipe list sort/view/tag colors, shopping list progress bar,
collapsible recipe form, navigation animation, landing page overhaul, warm empty
states. Marked completed backlog items (landing CTA, cooking mode, recipe form,
empty states). Added "Daily Use Polish" section with prioritized improvements
for daily cooking workflow. 291 tests across 21 files._
