# Quartermaster - Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application built to
replace 100+ recipes scattered across Apple Notes. It provides searchable recipe
storage, kitchen inventory tracking, meal planning, and smart shopping list
generation.

Built in ~3 weeks (starting February 6, 2026) using Claude Code as an AI coding
assistant for rapid iteration.

> For the full feature catalog, see [FEATURES.md](./FEATURES.md). For design
> system details, see [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).

---

## Current Status: Personal Tool (March 2026)

The app is feature-complete and in maintenance mode. Daily-driven since
February 12, 2026, fully replacing Apple Notes for recipe management, meal
planning, and shopping.

### Retrospective

Beta testers import recipes and stock inventory but don't commit to the full
plan→shop→restock loop. The core differentiator — inventory-aware matching and
the closed-loop pipeline — requires weekly discipline that most people won't
sustain. There's a genuine gap in the self-hosted space (no app combines good
cooking UX + inventory intelligence + the full pipeline), but serving that
audience would require Docker packaging, community management, and ongoing
support.

**Current posture:** Personal/household tool. Fix friction as it surfaces;
don't build new features speculatively. Subscription system is implemented
but not actively marketed.

### Inventory Mode: Rough Signal

Inventory as rough signal — no quantities, no auto-subtraction. Two purposes:
match rings (do you have the ingredient?) and advisory shopping deductions
(pre-checked not omitted). Input flows in via shopping check-off → inventory
pipeline.

---

## Technical Debt

- **Fire-and-forget event emission** — `emitHouseholdEvent()` runs async without
  awaiting. Risk of SQLite concurrency under load. Tests need `vi.mock()`
- **In-memory matching at scale** — loads all recipes + inventory for matching.
  Fine at ~135 recipes, profile at 500+

---

## Infrastructure (Nice-to-Have)

- [ ] **Automated backups** — scheduled SQLite backup to S3 (Litestream or
      cron)
- [ ] **Monitoring & alerting** — uptime monitoring, error rate alerts

---

## Backlog

Personal-use wishlist. Build only if friction surfaces during daily use.

- [ ] **Value recap panel** — lightweight summary of user benefit (meals cooked,
      plan completion, recipes added this week)
- [ ] **Defrost & prep-ahead reminders** — "You're cooking Chicken Tikka
      tomorrow — the chicken is in your freezer." Also supports user-editable
      prep-ahead notes (marinating, soaking, dough rising)
- [ ] **Quick restock** — after shopping, show recently removed inventory items
      for one-tap re-add
- [ ] **Leftovers/batch awareness** — if a recipe serves 6 and you're 2 people,
      that's 3 meals not 1
- [ ] **Social media recipe import** — save recipes from TikTok, Instagram
      Reels, YouTube Shorts (video parsing / OCR / LLM extraction)
- [ ] **Receipt scanning → inventory** — camera capture of grocery receipts

---

## Deferred

Ideas evaluated and set aside. Revisit if circumstances change.

- **Step-by-step cooking mode** — current cooking view already has checkboxes,
  timers, wake lock, and temp tooltips
- **Fuzzy/typo-tolerant search** — at 135 recipes, users know the names
- **Ingredient-based recipe search** — the matching system already does this via
  inventory
- **Offline mutations** — massive complexity on a server-rendered form app.
  Service worker caches pages for reading; optimistic UI is the 80/20 solution
- **Collections/cookbooks** — tags were built and removed as overengineered.
  Revisit at 300+ recipes
- **Nutrition estimates** — large effort (API integration, per-ingredient lookup)
- **Push notifications** — SSE covers the active-use case
- **Preventive `React.memo()` / pagination** — no performance problem exists.
  Profile when there's a problem

---

_Last updated: March 2026._
