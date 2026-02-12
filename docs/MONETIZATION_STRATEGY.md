# Quartermaster - Monetization Strategy

Business model, pricing, competitive positioning, and go-live requirements for
Quartermaster. For the implementation roadmap, see
[DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md). For a full feature list, see
[FEATURES.md](./FEATURES.md).

---

## Why Freemium

The cooking app market is oversaturated and consolidating -- Yummly (Whirlpool,
75+ staff) shut down December 2024, PlateJoy discontinued July 2025.
Subscription fatigue is real. But Quartermaster's closed-loop inventory
intelligence pipeline (track -> discover -> plan -> shop -> subtract -> repeat)
is genuinely differentiated -- no mainstream competitor offers this end-to-end.

One-time purchase doesn't sustain ongoing development. Pure subscription scares
users post-Yummly. Freemium with a generous free tier builds trust, and the
intelligence layer justifies the upgrade.

---

## Free Tier

A functional recipe manager -- enough to build the habit, with natural upgrade
points when the user wants more:

- Up to 50 recipes (CRUD, search, tags, images, scaling) -- enough to be
  useful, low enough to hit the limit once committed. Unlimited on Pro.
- Manual recipe entry + quick text entry (URL import is Pro -- it's the
  power-user feature that drives bulk recipe collection past the free limit)
- Interactive recipe view (tap-to-cross-off ingredients/steps, inline timers)
- JSON export (data portability builds trust -- users burned by Yummly
  shutting down care about this)
- Cooking log with notes

The free tier should make users _want_ Pro, not _need_ it. The upgrade trigger
is natural: "I have 50 recipes and want to import more" or "I want the shopping
list to know what's already in my kitchen." If the free tier solves 80% of the
problem, conversion will be low.

> **Risk: 50 recipes may be too generous.** Users who manually enter recipes
> tend to plateau well under 50. The recipe-count gate assumes URL import drives
> bulk collection past the limit, but without URL import on free, users may
> never hit 50. Consider whether the primary gate should be features
> (inventory/planning) rather than recipe count -- or lower the limit to 25. The
> upgrade trigger needs to be something users _actually hit_, not a theoretical
> ceiling.

## Pro Tier (~$30-40/year or ~$4/month)

Gates the inventory intelligence loop -- the closed-loop system that's the actual
differentiator. This is where ongoing development effort goes:

- Unlimited recipes (uncapped from free tier's 50 limit)
- Recipe import from URL (JSON-LD scraping with duplicate detection)
- Inventory tracking (pantry/fridge/freezer with expiration + low-stock)
- "What can I make?" discovery with fuzzy matching + expiration suggestions
- Meal planning calendar (weekly view, copy week, servings overrides)
- Smart shopping list (unit-aware consolidation, inventory subtraction,
  store-section grouping, print layout)
- Inventory subtraction after cooking (with unit conversion)
- Kitchen timer
- Phase 12 features (ingredient overlap, efficiency scoring, waste alerts)
- AI features: ingredient substitution hints, recipe generation from inventory
- Smart meal plan generation ("Fill my week" auto-planning)
- PWA offline access

## Household Tier (~$50-60/year)

Natural upgrade for couples/families:

- Everything in Pro
- Shared recipe library, inventory, and meal plan
- Invite household members
- Real-time activity notifications

> **Pricing note:** At $30-40/year for Pro and $50/year for Household, the gap
> is only ~$10-20 for multi-user sync + real-time notifications — features with
> real infrastructure cost. Consider $55-65/year to avoid devaluing the
> household features while staying well under Plan to Eat / Mealime pricing.

---

## Competitive Positioning

|                                     | Quartermaster Pro  | Paprika ($5-30) | Plan to Eat ($50/yr) | Mealime ($50/yr) |
| ----------------------------------- | ------------------ | --------------- | -------------------- | ---------------- |
| Fuzzy inventory->recipe matching    | 4-level + synonyms | No              | No                   | No               |
| Unit-aware shopping consolidation   | Cross-family       | Basic           | Basic                | Yes              |
| Inventory subtraction after cooking | Yes                | No              | No                   | No               |
| Expiration-based suggestions        | Yes                | No              | No                   | No               |
| Ingredient overlap planning         | Yes (Phase 12)     | No              | No                   | No               |
| AI substitution hints               | Yes                | No              | No                   | No               |
| AI recipe generation from inventory | Yes                | No              | No                   | No               |
| Smart meal plan auto-fill           | Yes                | No              | No                   | No               |

$30-40/year is cheaper than Plan to Eat and Mealime ($50/yr each) while offering
more. One-time-purchase apps like Paprika lack the intelligence layer entirely.
AI substitutions and recipe generation further widen this gap -- no competitor
offers contextual substitution hints or inventory-aware recipe generation.

---

## "Proven" Gate

Don't start monetization until the no-waste planning features (Phase 12) have
been used in real meal planning for at least 4 weeks. Minimum signals:

- Pairing suggestions are used when building 3+ weekly plans
- Ingredient efficiency scores trend above 50% for planned weeks

Without these signals, the no-waste pitch is aspirational, not real -- and that's
a weak foundation for asking people to pay.

> **Note:** These signals are not currently tracked. Implementing basic analytics
> or usage counters is a prerequisite for evaluating the gate. See the
> "No analytics/tracking infrastructure" item in the Technical Debt section of
> [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md).

> **Status check (February 2026):** Phase 12 is built and deployed. Are these
> signals being tracked? If the features are in daily use and meeting these
> thresholds, start Phase 14. If not, identify what's preventing adoption (UX
> friction? not enough recipes? features not discoverable?) and fix that first.
> The risk here is indefinite deferral -- "proven" needs a concrete evaluation
> date, not an open-ended "later."

---

## Go-Live Requirements

Stripe provides full **test mode** with test API keys that don't require a
verified business account. All development work can be built and tested against
test mode. The only step that requires a registered business entity (PFA) is
flipping to live mode for real payments.

### Business Registration

Register a PFA (Persoana Fizica Autorizata) with ONRC under a software-related
CAEN code (6201 or 6209). This can take a few weeks, so start the registration
in parallel with development. You'll also need a Romanian bank account linked
to the PFA.

### VAT

Consider OSS (One-Stop Shop) registration for EU cross-border VAT on digital
services. Stripe Tax can handle VAT collection automatically -- enable it from
day one. Consult a Romanian accountant (contabil) for CAEN code selection and
VAT strategy before registering.

### Go-Live Checklist

- [ ] Register PFA -- ONRC registration, bank account, CAEN code
- [ ] Stripe live mode -- Swap test keys for live keys, verify business details
      with Stripe, connect PFA bank account for payouts
- [ ] VAT setup -- Enable Stripe Tax and/or register for OSS depending on
      accountant's recommendation

---

## Churn Mitigation

Target is <5% monthly churn on Pro. Strategies to build before launch:

- **Graceful downgrade UX** -- When a subscription lapses, show a clear
  "your data is safe" message. Pro features become read-only, not deleted.
  Recipes beyond the free limit stay visible but new ones can't be added.
- **Pause option** -- Offer 1-3 month pause instead of cancel. Users who
  stop cooking temporarily (travel, busy season) shouldn't have to re-subscribe.
- **Cancel flow** -- Before completing cancellation, show what they'll lose
  (inventory tracking, X planned meals, shopping lists) with a "switch to
  annual and save" offer if they're on monthly.
- **Data export on cancel** -- Proactively offer a full JSON export during
  the cancel flow. Builds goodwill and reduces "trapped data" anxiety that
  causes angry churn.

---

## Risks

- **Small addressable market.** The overlap of "people who track kitchen
  inventory" AND "people who meal plan" AND "people willing to pay" is narrow.
  This is a tool for serious home cooks, not mass market.
- **Self-hosted alternatives.** Mealie and Tandoor are free and open-source.
  Quartermaster's advantage is polish, the intelligence layer, and not requiring
  Docker knowledge.
- **App store economics.** If going native mobile later, Apple/Google take 30%.
  PWA avoids this but limits discoverability. Web-first is the right starting
  point.
