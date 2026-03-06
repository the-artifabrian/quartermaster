# Quartermaster - Development Plan

## Project Overview

**Quartermaster** is a personal recipe management web application built to
replace 100+ recipes scattered across Apple Notes. It provides searchable recipe
storage, kitchen inventory tracking, meal planning, and smart shopping list
generation.

Built in ~3 weeks (starting February 6, 2026) using Claude Code as an AI coding
assistant for rapid iteration.

> For tech stack, architecture, commands, database schema, and route structure,
> see [CLAUDE.md](../CLAUDE.md). For the full feature catalog, see
> [FEATURES.md](./FEATURES.md).

---

## Current Status: Personal Tool (March 2026)

The app is feature-complete and in maintenance mode. Daily-driven since
February 12, 2026, fully replacing Apple Notes for recipe management, meal
planning, and shopping.

### Validation Outcome

Beta testers (friends/partners) import recipes and stock some inventory but
don't commit to the plan→shop→restock loop. The Reddit post (r/SideProject,
February 25) generated minimal response. The core differentiator —
inventory-aware recipe matching and the closed-loop pipeline — is used daily
by the builder but not adopted by other users.

This is a category problem, not an app problem. Meal planning requires
weekly discipline that most people won't sustain. The self-hosted space has
a genuine gap (no self-hosted app combines good cooking UX + inventory
intelligence + the closed-loop pipeline), but serving that audience would
require Docker, open-source licensing, community management, and ongoing
support — incompatible with the current maintenance posture.

No self-hosted pivot. Fix friction as it surfaces; don't build new features
speculatively.

### Portfolio Value

Full-stack app with AI integration (Claude, Whisper), real-time SSE, Stripe
billing, household sharing, PWA — built in ~3 weeks with AI-assisted
development. Daily-driven for real cooking and meal planning.

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

## Success Metrics

### Achieved

- [x] All Apple Notes recipes imported (~135 bulk imported)
- [x] Partner uses the app as a real co-user
- [x] Apple Notes fully replaced for recipes
- [x] App daily-driven for 4+ weeks

### Ongoing (personal use)

- [ ] Inventory tracking feels sustainable (not a chore)
- [ ] Weekly meal planning in-app remains consistent

---

_Last updated: March 6, 2026. Project transitioned to personal tool /
maintenance mode._
