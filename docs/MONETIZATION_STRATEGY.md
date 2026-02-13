# Quartermaster - Monetization Strategy

Business model, pricing, competitive positioning, and go-live requirements for
Quartermaster. For the implementation roadmap, see
[DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md). For a full feature list, see
[FEATURES.md](./FEATURES.md).

---

## Why Freemium

The cooking app market is consolidating -- Yummly (Whirlpool, 75+ staff) shut
down December 2024, PlateJoy (RVO Health) discontinued July 2025, Crouton
pulled from the App Store January 2026. Meanwhile, well-funded entrants like Ollie and Samsung Food are raising
expectations with AI-powered meal planning and pantry scanning.
Subscription fatigue is real -- one-time purchase apps (Paprika, Mela) are
gaining mindshare specifically because users are tired of recurring fees.

But Quartermaster's closed-loop inventory intelligence pipeline (track ->
discover -> plan -> shop -> subtract -> repeat) remains genuinely differentiated
-- no competitor offers this end-to-end. The shutdowns have also created a trust
gap: users care about data portability and self-hostability more than ever.

One-time purchase doesn't sustain ongoing development. Pure subscription scares
users post-Yummly. Freemium with a generous free tier and JSON export builds
trust, and the intelligence layer justifies the upgrade.

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

## Pro Tier (~$49/year or ~$5/month)

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
- Ingredient overlap planning, efficiency scoring, waste alerts
- AI features (planned): substitution hints, recipe generation from inventory,
  smart meal plan auto-fill
- PWA offline access

## Household Tier (~$69/year)

Natural upgrade for couples/families:

- Everything in Pro
- Shared recipe library, inventory, and meal plan
- Invite household members
- Real-time activity notifications

> **Pricing rationale:** $49 Pro → $69 Household is a $20 uplift for multi-user
> sync + real-time notifications -- features with real infrastructure cost (SSE,
> multi-instance). Still well under Ollie ($84/yr) and comparable to Plan to Eat
> ($49/yr) plus a second account.

---

## Competitive Positioning

### Intelligence features (Quartermaster's moat)

|                                     | Quartermaster Pro   | Paprika ($5-30) | Plan to Eat ($49/yr) | Mealime (~$36/yr) | Ollie ($84/yr) |
| ----------------------------------- | ------------------- | --------------- | -------------------- | ------------------ | -------------- |
| Fuzzy inventory->recipe matching    | 4-level + synonyms  | No              | No                   | No                 | No             |
| Unit-aware shopping consolidation   | Cross-family        | Basic           | Basic                | Yes                | Basic          |
| Inventory subtraction after cooking | Yes                 | No              | No                   | No                 | No             |
| Expiration-based suggestions        | Yes                 | No              | No                   | No                 | Partial        |
| Ingredient overlap planning         | Yes                 | No              | No                   | No                 | No             |
| AI substitution hints               | Planned             | No              | No                   | No                 | Yes            |
| AI recipe generation from inventory | Planned             | No              | No                   | No                 | Yes            |
| Smart meal plan auto-fill           | Planned             | No              | No                   | No                 | Yes            |
| Household sharing + real-time sync  | Yes                 | No              | No                   | No                 | No             |

The top 5 rows are shipped today and represent Quartermaster's core
differentiator -- the closed-loop inventory intelligence pipeline. No competitor
offers this end-to-end. Ollie has AI features that Quartermaster plans to build,
but lacks the inventory tracking depth (no subtraction, no overlap planning, no
fuzzy matching). At $49/yr, Quartermaster undercuts Ollie ($84/yr) significantly
while offering a more complete inventory loop.

### Broader landscape

The competitive field has widened since 2024. Key players by segment:

- **Traditional recipe managers** (Paprika $5-30, Mela $5-10, Plan to Eat
  $49/yr): No AI, no inventory intelligence. Compete on reliability and
  anti-subscription positioning. Paprika and Mela are one-time purchase,
  gaining mindshare from subscription fatigue.
- **AI-first meal planners** (Ollie $84/yr, DishGen freemium): AI-generated
  meal plans, pantry photo scanning, dietary substitutions. Ollie is the
  closest competitor to Quartermaster's vision but approaches it from AI-first
  rather than inventory-first. Higher price, less depth on inventory tracking.
- **Corporate-backed** (Samsung Food, free tier + Plus at $60/yr): 240K+
  recipes, Vision AI pantry scanning, personalized meal plans on the paid tier.
  SmartThings integration. Free tier is basic recipe search; the AI intelligence
  features that compete with Quartermaster are behind the $60/yr paywall. Lacks
  inventory subtraction, ingredient overlap, and household collaboration.
- **Self-hosted open source** (Mealie, Tandoor, KitchenOwl): Free, require
  Docker. Mealie added OpenAI integration in v3.10 (Feb 2026) for recipe
  import and ingredient parsing. KitchenOwl has household collaboration.
  None offer the full inventory intelligence loop.
- **Social-first** (Honeydew, OnlyRecipe): Focus on importing recipes from
  TikTok, Instagram, YouTube. Different audience -- recipe collectors, not
  meal planners.

Quartermaster's positioning: **inventory intelligence for serious home cooks**,
priced between the traditional managers and the AI-first premium apps. The
closed-loop pipeline (track → discover → plan → shop → subtract → repeat)
remains the primary differentiator -- competitors have pieces of this but none
connect them end-to-end.

---

## "Proven" Gate

Don't start monetization until the no-waste planning features (Phase 12) have
been used in real meal planning for at least 4 weeks. Minimum signals:

- Pairing suggestions are used when building 3+ weekly plans
- Ingredient efficiency scores trend above 50% for planned weeks

Without these signals, the no-waste pitch is aspirational, not real -- and that's
a weak foundation for asking people to pay.

> **Note:** These signals are now tracked via the `UsageEvent` model. Events
> tracked: `pairing_recipe_assigned`, `efficiency_snapshot` (deduplicated per
> week), `discover_viewed`, `surprise_me`, `what_do_i_need`. Stats viewable at
> Settings > Data > Usage stats, and programmatically via
> `GET /resources/usage-stats`.

> **Gate check: March 12, 2026.** Daily driving started February 12. After 4
> weeks, review usage stats to evaluate whether pairing suggestions and
> efficiency scores meet the thresholds above. If not, identify what's
> preventing adoption (UX friction? features not discoverable?) and fix that
> first. Don't defer indefinitely -- evaluate concretely on the date.

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
- **AI-first competitors moving fast.** Ollie already ships pantry scanning,
  AI meal plans, and substitutions at $84/yr with Washington Post coverage
  (August 2025). If AI meal planning becomes table stakes, Quartermaster's
  planned AI features need to ship to stay competitive. The inventory
  intelligence loop is the moat -- but it only matters if users get far enough
  to experience it.
- **Corporate-backed competition.** Samsung Food has 240K+ recipes with a free
  basic tier and AI features at $60/yr (Samsung Food Plus). Not free for the
  features that compete with Quartermaster's intelligence loop, but the brand
  recognition and SmartThings ecosystem integration give it distribution
  advantages that an indie app can't match.
- **Self-hosted alternatives gaining features.** Mealie now has OpenAI
  integration (recipe import, ingredient parsing, translation). KitchenOwl has
  household collaboration. The gap between Quartermaster and free self-hosted
  options is narrower than in 2024. Advantage remains: polish, the full
  inventory loop, and no Docker requirement.
- **Subscription fatigue is real.** One-time purchase apps (Paprika $5-30,
  Mela $5-10) are actively gaining mindshare. Users need to see clear ongoing
  value (AI features, inventory intelligence, real-time sync) to justify a
  recurring fee. Data portability (JSON export) and a generous free tier help
  mitigate "trapped data" anxiety.
- **App store economics.** If going native mobile later, Apple/Google take 30%.
  PWA avoids this but limits discoverability. Web-first is the right starting
  point -- validated by the indie/self-hosted segment's preference for
  web-based tools.
