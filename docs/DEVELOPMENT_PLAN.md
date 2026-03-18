# Development Plan

## Status

Feature-complete and daily-driven since February 2026. Built in ~3 weeks
using Claude Code for rapid iteration.

For the full feature catalog, see [FEATURES.md](./FEATURES.md). For
architecture, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Design Decisions

**Inventory as rough signal** — no quantities, no expiry dates, no
auto-subtraction. Inventory serves two purposes: match rings on recipe
cards (do you have the ingredient?) and advisory shopping deductions
(in-stock items are pre-checked, not omitted). This keeps the mental
overhead low — you're answering "do I have chicken?" not "do I have
325g of chicken?"

**No category grouping on shopping list** — was built, tried, and removed.
Flat alphabetical list works better for real shopping trips than
produce/dairy/meat sections.

**No recipe photos required** — most home cooks don't photograph their
food. The UI is designed around that reality with typography-first cards
instead of image placeholders.

---

## Known Technical Debt

- **Fire-and-forget event emission** — `emitHouseholdEvent()` runs async
  without awaiting. Risk of SQLite write contention under heavy concurrent
  use
- **In-memory matching at scale** — loads all recipes + ingredients for
  matching. Fine for hundreds of recipes, may need profiling at 500+

---

## Infrastructure Wishlist

- [ ] Automated SQLite backups to S3 (Litestream or cron)
- [ ] Uptime monitoring and error rate alerts

---

## Backlog

Ideas for future development. Contributions welcome.

- [ ] **Defrost & prep-ahead reminders** — "You're cooking Chicken Tikka
      tomorrow — the chicken is in your freezer." Supports prep-ahead
      notes (marinating, soaking, dough rising)
- [ ] **Quick restock** — after shopping, show recently removed inventory
      items for one-tap re-add
- [ ] **Leftovers/batch awareness** — if a recipe serves 6 and you cook
      for 2, that's 3 meals not 1
- [ ] **Video recipe import** — save recipes from TikTok/Instagram/YouTube
      via video parsing or LLM extraction
- [ ] **Receipt scanning → inventory** — camera capture of grocery receipts

---

## Deferred (and why)

Ideas evaluated and intentionally set aside.

- **Step-by-step cooking mode** — the existing cooking view already has
  checkboxes, inline timers, wake lock, and temperature tooltips
- **Fuzzy/typo-tolerant search** — not needed when you know your recipe
  names. Revisit if the recipe count grows significantly
- **Offline mutations** — massive complexity for a server-rendered app.
  Service worker handles read caching; optimistic UI covers the rest
- **Collections/tags** — was built and removed as overengineered at
  current scale. Revisit at 300+ recipes
- **Nutrition estimates** — large effort (API integration, per-ingredient
  lookup) for uncertain value
- **Push notifications** — SSE covers the active-use case; push adds
  platform-specific complexity

---

_Last updated: March 2026._
