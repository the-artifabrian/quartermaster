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

| Phase              | Summary                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| 1-4                | Recipe CRUD, inventory tracking, meal planning calendar, shopping list generation        |
| 5-8                | Discovery ("What can I make?"), cooking logs, inventory subtraction, unit conversion     |
| 9-12               | Recipe scaling, cooking mode (timers, temps), ingredient headings, bulk import           |
| 13a-e              | Household sharing, SSE real-time events, notification bell                               |
| UI + Polish        | Custom color system, mobile-first layout, recipe print/share, meal templates             |
| Smarter UX         | Shelf-life auto-suggest, low-stock nudges, pairing/waste/efficiency                     |
| AI integration     | Ingredient substitutions (static DB + LLM), recipe generation from inventory, recipe metadata enhance |
| Inventory drift    | Uncooked meal reminders, smarter expiring-items callout                                  |
| UX review          | Recipes page simplification — match stats in filter bar, grid visible without scrolling  |
| UX debt cleanup    | Recipe detail extraction (1640→590 lines, 7 components), resource route extraction (plan 9→5 intents, shopping 9→8), Quick Add open by default |

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
development is **not blocked** by this gate.

**Personal criteria:**

- Am I using the app every week? Has it fully replaced Apple Notes?
- Is inventory tracking sustainable, or does light mode need to ship?
- Do the testers find it useful without prompting?

> **Check-in: March 12, 2026.** Assess daily driving progress. If the app isn't
> sticking, identify UX friction and fix it. Don't defer indefinitely.

### Contingency: Light Inventory Mode

If inventory tracking feels like a chore, the fallback is a **passive mode**:
input only via shopping check-offs / "I have this" / post-cooking subtraction,
boolean have/don't-have instead of quantities, aggressive auto-expire via
shelf-life lookup. The core loop survives — just less precise.

**Trigger criteria** (assess at March 12 gate check):

- Inventory updates < 2x/week despite regular cooking
- Drift > 30%, or users actively avoid the inventory page

> Contingency, not a plan. Build only if trigger criteria are met.

### Friction Log

Issues discovered during daily driving and UX review. Format: date, area,
observation, status.

Status: `open` = confirmed friction, needs fix. `watch` = potential issue,
monitor during daily driving before building. `fixed` = resolved.

| Date       | Area      | Observation                                                                                                         | Status  |
| ---------- | --------- | ------------------------------------------------------------------------------------------------------------------- | ------- |
| 2026-02-18 | cooking   | `UncookedMealReminder` shows recipe name but doesn't link to it — no 1-tap path to tonight's recipe from any page   | fixed   |
| 2026-02-18 | shopping  | Generate button is icon-only on mobile — new users won't recognize the calendar icon                                | fixed   |
| 2026-02-18 | shopping  | Week selector for generation hidden on mobile (`hidden sm:block`) — can't generate for next week from phone         | fixed   |
| 2026-02-18 | shopping  | Checkbox toggle is blocking `<Form>` POST, no optimistic UI — may lag on cellular, fails offline                    | fixed   |
| 2026-02-18 | planning  | Recipe selector is text-only (no thumbnails) — may cause hesitation scanning 135+ recipes                           | fixed   |
| 2026-02-18 | shopping  | Inventory pipeline review shows all items with location/expiry fields expanded — visual overwhelm may cause skipping | fixed   |
| 2026-02-18 | inventory | No inline editing on inventory cards — requires separate edit page for qty/expiry changes                            | fixed   |
| 2026-02-18 | shopping  | Shopping list doesn't live-refresh when partner adds items — SSE toast fires but data requires manual refresh        | fixed   |

> Add entries as friction surfaces. Resolve `open` items promptly; promote
> `watch` items to `open` if they cause real friction.

---

## Strategic Priorities

Identified during a full-app UX and strategy review (February 2026).

   rings, limit enforcement, upgrade CTA
2. ~~**UX debt cleanup**~~ ✓ — Recipe detail 1,640→590 lines (7 components),
   resource route extraction, Quick Add open by default

---

### AI Integration

Principles: no chat UI, user stays in control, cost-aware (gate on action,

- [x] Ingredient substitutions — static DB + LLM fallback, inventory-aware
- [x] Recipe generation from inventory — preview before save
- [x] Recipe enhance — one-click metadata inference with review modal
- [ ] **Receipt scanning → inventory** — build only if inventory input is the
      main friction point

Ship after the no-waste planning features (pairing, efficiency, waste alerts)
are proven in daily use — the marketing pitch needs to be real first.

---

## Technical Debt

- **Fire-and-forget event emission** — `emitHouseholdEvent()` runs async without
  awaiting. Risk of SQLite concurrency under load. Tests need `vi.mock()`
- **In-memory matching at scale** — loads all recipes + inventory for matching.
  Fine at ~135 recipes, profile at 500+
- **Profile photo S3 orphans** — photo updates never clean up old S3 objects

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

