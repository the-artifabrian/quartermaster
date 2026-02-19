# Quartermaster - Monetization Strategy

Quartermaster is a personal tool first — built by a developer who cooks to
replace Apple Notes and actually manage what's in the kitchen. Monetization is
secondary: passive income potential, not a startup. The goal is a great daily-use
app that happens to be worth paying for. Business infrastructure ships when there
are actual paying users, not before.

For the roadmap, see [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md). For features,
see [FEATURES.md](./FEATURES.md).

---

## Scope Note

Internal strategy document for planning. Market and competitor statements are
working assumptions as of February 2026 and should be re-verified before any
external use.

---

## Why Freemium

The cooking app market is consolidating — Yummly shut down (Dec 2024), PlateJoy
discontinued (Jul 2025), Crouton pulled (Jan 2026). Meanwhile subscription
fatigue is real — one-time purchase apps (Paprika, Mela) are gaining mindshare.

Quartermaster's closed-loop pipeline (track → discover → plan → shop → subtract
→ repeat) remains genuinely differentiated. One-time purchase doesn't sustain
development. Pure subscription scares users post-Yummly. Freemium with a
generous free tier and JSON export builds trust; the intelligence layer justifies
the upgrade.

---

## Tiers

### Free ($0)

A complete recipe manager with a taste of inventory — enough to build the habit
and experience the "aha" moment:

- Unlimited recipes (CRUD, search, images, scaling)
- Import from URL, bulk import, JSON export
- Interactive cooking view (timers, temperature tooltips, checkboxes)
- Recipe sharing, cooking log, favorites
- Up to 15 inventory items (enough for match rings and discovery)

Meal planning, shopping lists, AI features, and unlimited inventory require
Pro. Household sharing is currently available to all beta users.

The upgrade trigger is experiential: "I want more than 15 items in my kitchen."
URL import is free because it's a growth lever — users build a library, get
invested, then want the full intelligence layer.

> **Why feature gate over recipe count?** Manual enterers plateau at 15-30
> recipes and would never hit a limit. Feature gating aligns the paywall with
> the actual differentiator (the inventory loop).

### Pro ($35/yr early-adopter, $49/yr standard)

Everything. Annual-only. One tier, no complexity.

- Unlimited inventory tracking (pantry/fridge/freezer, expiration, low-stock)
- "What can I make?" discovery with 4-level fuzzy matching
- Meal planning calendar (weekly view, templates, waste alerts, efficiency)
- Smart shopping list (generate from plan, unit-aware consolidation, print)
- Post-cooking inventory subtraction with unit conversion
- Ingredient overlap planning, pairing suggestions
- AI substitution hints, recipe generation from inventory, recipe metadata
  enhance
- Household sharing + real-time activity notifications (currently also available
  on Free during beta)

> **Early-adopter pricing:** Launch at $35/yr for the first year or first 100
> users. Raise to $49 once there's social proof. Add monthly pricing later when
> there's volume to optimize conversion.

---

## Competitive Positioning

Quartermaster is an inventory-intelligence layer for serious home cooks. No
competitor offers the full loop: fuzzy matching → discovery → overlap planning →
shopping consolidation → post-cooking subtraction. Ollie ($84/yr) has AI but
lacks subtraction, overlap planning, and fuzzy matching. Traditional managers
(Paprika, Mela, Plan to Eat) have no AI and no inventory intelligence. At
$49/yr, Quartermaster undercuts the AI-first tier and outfeatures the
traditional tier.

### Broader landscape

- **Traditional** (Paprika, Mela, Plan to Eat): No AI, no inventory
  intelligence. Compete on reliability and anti-subscription positioning
- **AI-first** (Ollie $84/yr, DishGen): AI meal plans, pantry scanning. Closest
  competitor but approaches from AI-first, not inventory-first
- **Corporate** (Samsung Food, free + $60/yr Plus): 240K+ recipes, Vision AI.
  Lacks subtraction, overlap, household collaboration
- **Self-hosted** (Mealie, Tandoor, KitchenOwl): Free, require Docker. None
  offer the full inventory loop
- **Social-first** (Honeydew, OnlyRecipe): TikTok/Instagram recipe import.
  Different audience

---

## "Proven" Gate

Defined in [DEVELOPMENT_PLAN.md § Proven Gate](./DEVELOPMENT_PLAN.md#proven-gate).
In short: 4+ weeks of daily use with planning features, gate check on
**March 12, 2026**. Don't monetize until the pitch is real.

---

## Go-Live Requirements

### Business Registration

Register a PFA (Persoana Fizica Autorizata) with ONRC under CAEN code 6201 or
6209. Takes a few weeks — start in parallel. Romanian bank account required.
Consult accountant for CAEN code and VAT strategy (OSS for EU cross-border).

### Checklist

- [ ] Register PFA (ONRC, bank account, CAEN code)
- [ ] VAT setup (Stripe Tax and/or OSS)
- [ ] Stripe live mode (swap test keys, verify business, connect payouts)
- [ ] Stripe Dashboard (create Products/Prices, configure Portal, webhook)
- [ ] Refund policy defined and documented
- [ ] Terms of Service updated for paid tier
- [ ] Automated backups operational (Litestream or cron → S3)
- [ ] Monitoring & alerting operational
- [ ] GDPR: verify Prisma `onDelete: Cascade` chains delete all user data
  (HouseholdEvents, InviteCodes, UsageEvents, etc.). Confirm Sentry doesn't
  set non-essential cookies (would require consent banner)

---

## Distribution

3 external users onboarded. Aiming for 5+ **actively using** (have real recipes
and used the app in the past 2 weeks) before launch — onboarded but dormant
doesn't count.

### Growth loops

- **Recipe sharing** — `/share/$recipeId` with JSON-LD and OG tags. Every shared
  recipe is a landing page with import CTA
- **Data portability** — JSON export as trust signal ("Your recipes, your data")
- **Self-hosting** — Standard Node.js, no Docker. Differentiator vs. Mealie et al
- **Invite codes** — QM-XXXXXX format, 60 days Pro + 2 starter codes. Social
  currency: "try this app — here's a code"
- **Public recipe pages** — every `/share/$recipeId` is already SEO-indexed with
  JSON-LD. Scales with usage — more users sharing = more landing pages, zero
  effort

### Launch channels

- r/selfhosted, r/mealprepsunday, r/Cooking — angle by subreddit. Note:
  r/selfhosted users resist SaaS pricing — lead with self-hosting option and
  data portability, not the subscription
- Hacker News — "Show HN: inventory-aware meal planner" (technical depth appeals)
- Word of mouth — household sharing makes every user a recruiter

---

## Risks

- **Small addressable market** — "people who track inventory AND meal plan AND
  pay" is narrow. Tool for serious home cooks, not mass market
- **AI competitors moving fast** — Ollie already ships pantry scanning and AI
  meal plans at $84/yr. The inventory loop is the moat but users need to get
  far enough to experience it
- **Subscription fatigue** — one-time purchase apps gaining mindshare. Users need
  clear ongoing value to justify recurring fees
- **Inventory loop friction** — the entire value proposition rests on users
  maintaining inventory. Contingency plan in
  [DEVELOPMENT_PLAN.md § Inventory Mode](./DEVELOPMENT_PLAN.md#inventory-mode-active-evaluation)
- **No native app (PWA)** — some users expect a native app for a paid
  subscription. PWA is intentional: avoids app store cuts, enables self-hosting,
  allows rapid iteration, works on all platforms. iOS supports web push since
  16.4 (home-screen PWAs only) but Quartermaster uses SSE for active-session
  updates; no background sync is the main platform trade-off. No app store
  discoverability — offset by SEO, community posts, and word of mouth

---

_Last updated: February 19, 2026._
