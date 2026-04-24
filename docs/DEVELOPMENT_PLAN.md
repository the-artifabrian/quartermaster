# Development Plan

## Status

Feature-complete and daily-driven since February 2026. Built in ~3 weeks using
Claude Code for rapid iteration.

For the full feature catalog, see [FEATURES.md](./FEATURES.md). For
architecture, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Product Direction

Quartermaster is a personal cookbook that turns saved recipes into a weekly
cooking plan and shopping list. The primary repeated behavior is:

```
import recipes → plan meals → generate shopping list → cook
```

The app should optimize for reducing recipe-to-shopping friction. If a feature
does not reduce setup effort, clarify what needs buying, or make cooking easier
once a recipe is chosen, it should be secondary, hidden until relevant, or cut.

The product should still support "what can I cook tonight?", but weekly planning
and shopping-list generation are the dominant flow.

---

## Design Decisions

**Pantry, not inventory accounting.** The database still uses `InventoryItem`,
but the user-facing model should be "things I usually keep on hand." The app is
not a pantry ledger and should not ask users to maintain exact current stock.
Pantry can include fridge-door condiments, sauces, freezer staples, and dry
goods; the name is a product shorthand, not a literal cupboard boundary. Pantry
data exists to reduce mental load when planning meals and generating shopping
lists.

**Show what needs buying.** Pantry-aware matching should answer "what do I need
to buy?" more than "can I cook this right now?" Percent match rings can stay
where they clarify, but concrete labels such as "needs 3 things" or "usually on
hand" are more honest for planning.

**No quantities, no expiry dates, no auto-subtraction.** This keeps the mental
overhead low. Users are answering "do we usually keep rice around?" not "do we
currently have 325g of rice?" Any feature that makes the pantry feel like a
warehouse-management system is suspect.

**Avoid maintenance guilt.** Stale review, post-cook cleanup, uncooked meal
reminders, waste alerts, and repeated nudges can all be useful in isolation, but
together they risk making the app feel like it assigns chores. Prefer quiet,
contextual prompts that remove work immediately.

**Shopping-list markings must be transparent.** Items usually on hand may be
pre-checked or visually separated, but they should not silently disappear in a
way that makes users distrust the list. Copy should make clear: "usually on
hand, double-check before shopping."

**No category grouping on shopping list.** Was built, tried, and removed. Flat
alphabetical list works better for real shopping trips than produce/dairy/meat
sections.

**No recipe photos required.** Most home cooks don't photograph their food. The
UI is designed around that reality with typography-first cards instead of image
placeholders.

**AI as accelerator, not promise.** AI import/extraction helps users reach the
20-30 recipe threshold where the app becomes useful. AI recipe generation and
voice features are nice-to-have accelerators, not the core product identity.

---

## Implementation Priorities

1. **Reframe language without schema churn.** _Shipped._ User-facing copy
   now uses Pantry and "usually on hand" throughout. The `InventoryItem` model
   is unchanged.
2. **Make what needs buying primary.** _Partial._ The "Nothing to buy" filter
   is live on recipe lists and the landing-page demo. Match rings and
   percentages still appear on recipe cards; next step is replacing them with
   concrete "needs X things" labels.
3. **Soften bookkeeping flows.** _Partial._ Stale-review banner removed.
   Post-cook Pantry review is still a default prompt. Shopping check-off is now
   framed as "remember for next time."
4. **Protect the setup path.** _Pending._ Early UX should push users toward
   importing a small recipe library, planning a few meals, and generating one
   useful list. Full Pantry setup should improve the list, not block the
   payoff.
5. **Gate features by attention cost.** _Ongoing._ Quiet features can stay.
   Features that prompt, nag, or demand maintenance need stronger
   justification.

---

## Product Questions To Revisit

- Should the `/inventory` route eventually become `/pantry`?
- Should recipe cards drop the percentage ring in favor of a concrete
  "needs X things" label, or keep both?
- Should post-cook Pantry review remain a default prompt, become opt-in, or
  move behind a "keep Pantry updated" setting?
- Is Pro primarily selling convenience, household collaboration, AI, or
  unlimited scale? The pricing page should lead with the strongest proven value.

---

## Known Technical Debt

- **Fire-and-forget event emission.** `emitHouseholdEvent()` runs async without
  awaiting. Risk of SQLite write contention under heavy concurrent use.
- **In-memory matching at scale.** Loads all recipes + ingredients for matching.
  Fine for hundreds of recipes, may need profiling at 500+.
- **Terminology mismatch.** Code and database names still say inventory while
  the product direction is Pantry. This is acceptable short-term, but
  user-facing copy should be made consistent first.

---

## Infrastructure Wishlist

- [ ] Automated SQLite backups to S3 (Litestream or cron)
- [ ] Uptime monitoring and error rate alerts

---

## Backlog

Ideas for future development. Contributions welcome.

- [ ] **Defrost & prep-ahead reminders:** "You're cooking Chicken Tikka
      tomorrow, the chicken is in your freezer." Supports prep-ahead notes
      (marinating, soaking, dough rising)
- [ ] **Leftovers/batch awareness:** if a recipe serves 6 and you cook for 2,
      that's 3 meals not 1
- [ ] **Video recipe import:** save recipes from TikTok/Instagram/YouTube via
      video parsing or LLM extraction

### Risky / Probably Not Unless Proven

These ideas pull the product back toward inventory accounting. Do not prioritize
them unless actual usage shows Pantry is too weak without them.

- [ ] **Quick restock:** after shopping, show recently removed Pantry items for
      one-tap re-add
- [ ] **Receipt scanning to Pantry:** camera capture of grocery receipts

---

## Deferred (and why)

Ideas evaluated and intentionally set aside.

- **Step-by-step cooking mode:** the existing cooking view already has
  checkboxes, inline timers, wake lock, and temperature tooltips
- **Fuzzy/typo-tolerant search:** not needed when you know your recipe names.
  Revisit if the recipe count grows significantly
- **Offline mutations:** massive complexity for a server-rendered app. Service
  worker handles read caching; optimistic UI covers the rest
- **Collections/tags:** was built and removed as overengineered at current
  scale. Revisit at 300+ recipes
- **Nutrition estimates:** large effort (API integration, per-ingredient lookup)
  for uncertain value
- **Push notifications:** SSE covers the active-use case; push adds
  platform-specific complexity
- **Exact inventory tracking:** intentionally avoided. It adds maintenance cost
  and pushes the product toward pantry accounting instead of meal planning

---

_Last updated: April 24, 2026._
