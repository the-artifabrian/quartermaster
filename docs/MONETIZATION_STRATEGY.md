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

## Free Tier (Feature Gate — decided February 2026, enforced February 2026)

A fully functional recipe manager — enough to build the habit, with a natural
upgrade point when the user wants kitchen intelligence:

- **Unlimited recipes** (CRUD, search, tags, images, scaling)
- Recipe import from URL (JSON-LD scraping with duplicate detection)
- Bulk import (paste, file upload)
- Interactive recipe view (tap-to-cross-off ingredients/steps, inline timers,
  temperature conversion)
- Recipe sharing (public share page + Web Share API)
- Cooking log with notes
- JSON export (data portability builds trust — users burned by Yummly
  shutting down care about this)
- "Surprise me" random recipe picker (basic — without inventory weighting)
- Favorites and search
- Data import (recipes only — Pro-only models are skipped)

The free tier is a **complete recipe manager**. The upgrade trigger is
experiential, not punitive: "I want the app to know what's in my kitchen."
URL import is free because it's a growth lever — users build a big library,
get invested, and then want the intelligence layer to plan around it.

> **Enforcement status:** Tier gating is fully implemented. Pro-only routes
> redirect to `/upgrade`. Mixed-access routes degrade gracefully (no inventory
> matching, no "What Do I Need?", no shopping list integration). New signups
> start on free tier (no auto-trial). Pro access via invite codes (60 days +
> 2 starter codes) or Stripe subscription. **Stripe integration shipped:**
> Checkout (hosted redirect), Customer Portal (self-service manage/cancel),
> webhook-driven lifecycle (`checkout.session.completed`, `invoice.paid`,
> `customer.subscription.updated/deleted`). Both access paths coexist — user
> has Pro if either invite-code trial or Stripe subscription is active.
> Currently running against Stripe **test mode**; flipping to live requires
> only swapping API keys and verifying the PFA.

> **Why feature gate over recipe count?** A 50-recipe limit assumes URL import
> drives bulk collection past it, but users who manually enter recipes plateau
> at 15-30. The count gate risks feeling punitive ("you have too many recipes").
> Feature gating aligns the paywall with the actual differentiator (the
> inventory loop) and lets free users build switching costs through a large
> library.

## Pro Tier (~$49/year or ~$5/month, see early-adopter note)

Gates the inventory intelligence loop — the closed-loop system that's the actual
differentiator. Everything above plus:

- **Inventory tracking** (pantry/fridge/freezer with expiration + low-stock)
- **"What can I make?" discovery** with fuzzy matching + expiration suggestions
- **Meal planning calendar** (weekly view, copy week, servings overrides,
  templates, "Up next" banner, waste alerts, efficiency dashboard)
- **Smart shopping list** (generate from meal plan, unit-aware consolidation,
  inventory subtraction, store-section grouping, low-stock nudges, print layout)
- **Inventory subtraction after cooking** (with unit conversion)
- **Ingredient overlap planning**, efficiency scoring, pairing suggestions
- **"What Do I Need?"** checklist on recipe detail
- **"I Made This"** cook logging with inventory impact preview
- AI features (planned): substitution hints, recipe generation from inventory,
  smart meal plan auto-fill

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

> **Early-adopter pricing:** Consider launching at $35/year for the first year
> or first 100 users (annual-only). $49/yr is competitive on paper but
> Quartermaster has zero brand recognition at launch. A lower introductory price
> reduces friction for early adopters who are taking a bet on an unknown product.
> Raise to $49 once there's social proof (reviews, word of mouth). The $20
> Household uplift stays the same either way.

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

Don't start monetization until the no-waste planning features (pairing
suggestions, efficiency scoring, waste alerts) have been used in real meal
planning for at least 4 weeks. Minimum signals:

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
      with Stripe, connect PFA bank account for payouts. Test-mode integration
      is fully built (Checkout, Portal, webhooks) — no code changes needed
- [ ] Stripe Dashboard setup -- Create Products/Prices (Pro monthly/yearly,
      Household monthly/yearly), configure Customer Portal (plan switching,
      cancellation), create webhook endpoint, set env vars (`STRIPE_SECRET_KEY`,
      `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_MONTHLY_PRICE_ID`,
      `STRIPE_PRO_YEARLY_PRICE_ID`, `STRIPE_HOUSEHOLD_MONTHLY_PRICE_ID`,
      `STRIPE_HOUSEHOLD_YEARLY_PRICE_ID`)
- [ ] VAT setup -- Enable Stripe Tax and/or register for OSS depending on
      accountant's recommendation

---

## Distribution & First Users

No product survives without users finding it. The daily driver gate validates
the workflow; the next step validates that _other people_ can find, understand,
and adopt the app. **3 external users onboarded** (girlfriend as household
co-user, plus a friend and his girlfriend as a separate household). Tracking
whether they reach the inventory loop. Aiming for 5+ total before launch.

### Built-in growth loops

- **Public recipe sharing** (`/share/$recipeId`) -- Already has JSON-LD
  structured data and OG meta tags. Every shared recipe is a landing page with
  an "Import to Quartermaster" CTA. This is the primary organic growth vector.
  Optimize: make sharing frictionless (it already is via Web Share API), ensure
  share pages rank for recipe names.
- **Data portability as trust signal** -- JSON export prominently shown in
  settings. Position in marketing: "Your recipes, your data. Export anytime.
  Self-host if you want." Directly addresses the post-Yummly trust gap.
- **Self-hosting option** -- Standard Node.js app (no Docker required).
  Differentiated vs. Mealie/Tandoor/KitchenOwl which all require Docker.
  Worth mentioning on the landing page and in r/selfhosted posts.

### Launch channels

- **r/selfhosted, r/mealprepsunday, r/Cooking** -- "Show HN"-style posts when
  the app has external users and polish. Self-hosted angle for r/selfhosted,
  meal planning angle for the cooking subs.
- **Hacker News** -- "Show HN: I built an inventory-aware meal planner." The
  technical depth (fuzzy matching, normalization pipeline, unit conversion)
  appeals to the HN audience. Time this for when the app is truly ready.
- **Word of mouth** -- Friends and family who cook. The household sharing
  feature means every user is a potential recruiter for their partner.

### What to track

- How do external users discover the app? (Share page, direct link, search)
- Where do they drop off? (Signup, first recipe, inventory, meal planning)
- Do they reach the inventory loop or stop at recipe storage?

### Invite Code Growth Loop

Instead of a 14-day auto-trial, Pro access is exclusively via invite codes.
This creates social currency: the only way to try Pro is if a friend (or an
admin launch post) shares a code.

**Flow:**

1. New user signs up → free tier (recipe manager only)
2. Existing Pro user or admin shares an invite code
3. Free user redeems code on `/upgrade` → gets 60 days of Pro + 2 invite codes
4. New Pro user shares their codes with friends → loop repeats

**Why this works better than auto-trial:**

- Forces organic conversations ("hey, try this app — here's a code")
- New Pro users can immediately share — no friction before participating
  in the growth loop
- Admin codes enable targeted launches (HN, Reddit) without advertising spend
- No wasted trials from drive-by signups who never return

---

## Churn Mitigation

Target is <5% monthly churn on Pro. Strategies to build before launch:

- **Invite-code expiry (first churn point)** -- The 60-day invite-code grant
  is the earliest moment users face a downgrade. This is the highest-risk
  transition because these users never chose to pay — they got access for free.
  Flow: show days remaining in settings + header badge at 7 days, remind at 3
  days, on expiry show "Your Pro access has ended — your data is safe" with
  clear options: subscribe via Stripe, or redeem another invite code. Design
  this before the first codes expire (~mid-April 2026).
- **Graceful downgrade UX** -- When a subscription or invite-code grant lapses,
  show a clear "your data is safe" message. Pro features become read-only, not
  deleted. Recipes remain fully accessible (free tier is unlimited recipes).
  Inventory, meal plans, and shopping lists are preserved but not editable
  until the user re-subscribes or redeems a new code.
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
- **Inventory loop may be too high-friction.** The entire value proposition
  rests on users maintaining inventory. If daily driving reveals that inventory
  drifts too fast or the tracking overhead isn't worth the discovery/subtraction
  benefits, the monetization pitch breaks. **Fallback:** a "light inventory"
  mode where inventory is populated passively (shopping list check-offs +
  "I have this" taps only, no manual entry or expiration tracking). Discovery
  becomes fuzzy suggestions rather than precise matching. This is still
  differentiated -- no competitor connects shopping check-off to recipe
  discovery -- but requires adjusting the marketing pitch from "closed-loop
  intelligence" to "the shopping list that learns your kitchen."
- **App store economics.** If going native mobile later, Apple/Google take 30%.
  PWA avoids this but limits discoverability. Web-first is the right starting
  point -- validated by the indie/self-hosted segment's preference for
  web-based tools.
