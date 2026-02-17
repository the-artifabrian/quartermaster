# Quartermaster - Monetization Strategy

Business model, pricing, competitive positioning, and go-live requirements. For
the roadmap, see [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md). For features,
see [FEATURES.md](./FEATURES.md).

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

A complete recipe manager — enough to build the habit:

- Unlimited recipes (CRUD, search, tags, images, scaling)
- Import from URL, bulk import, JSON export
- Interactive cooking view (timers, temperature tooltips, checkboxes)
- Recipe sharing, cooking log, favorites, "Surprise me"

The upgrade trigger is experiential: "I want the app to know what's in my
kitchen." URL import is free because it's a growth lever — users build a library,
get invested, then want the intelligence layer.

> **Why feature gate over recipe count?** Manual enterers plateau at 15-30
> recipes and would never hit a limit. Feature gating aligns the paywall with
> the actual differentiator (the inventory loop).

### Pro (~$49/yr or ~$5/mo)

The inventory intelligence loop. Everything above plus:

- Inventory tracking (pantry/fridge/freezer, expiration, low-stock)
- "What can I make?" discovery with 4-level fuzzy matching
- Meal planning calendar (weekly view, templates, waste alerts, efficiency)
- Smart shopping list (generate from plan, unit-aware consolidation, print)
- Post-cooking inventory subtraction with unit conversion
- Ingredient overlap planning, pairing suggestions
- AI substitution hints and recipe generation from inventory

### Household (~$69/yr)

Everything in Pro + shared recipe library, inventory, and meal plan. Invite
household members. Real-time activity notifications.

> **Pricing rationale:** $20 uplift for multi-user sync + real-time
> notifications. Still under Ollie ($84/yr) and comparable to Plan to Eat
> ($49/yr) plus a second account.

> **Early-adopter pricing:** Launch at $35/yr for the first year or first 100
> users (annual-only). Raise to $49 once there's social proof.

---

## Open Questions (February 2026 review)

Decisions needed before monetization goes live.

### Merge Pro + Household into one tier?

The $20/yr gap may not justify a separate tier. Most target users cook for a
household. One paid tier at $49/yr including sharing simplifies the pricing page
and eliminates "penalty for having a partner" perception. Revisit per-seat only
if multi-household use cases emerge.

### Add a free trial alongside invite codes?

The invite-code-only model is a conversion barrier for organic discovery (HN,
Reddit, search). Options:

- **14-day free trial** on signup (alongside invite codes, not replacing them)
- **Limited inventory** on free tier: 10-15 items permanently, enough for match
  rings and the "aha" moment. Recommended — simpler than time-limited trial,
  creates natural upgrade trigger

### Annual-only at launch?

Monthly pricing ($5/mo) invites churn after one month. Annual ($35/yr early,
$49/yr standard) filters for committed users. Add monthly later when there's
volume to optimize conversion.

### Landing page honesty

"Free to use. No credit card required." but 3/4 featured steps are Pro-only.
Either adjust CTA ("Free recipe manager. Upgrade for kitchen intelligence.") or
expand the free tier. Add social proof once available.

---

## Competitive Positioning

### Intelligence features (Quartermaster's moat)

|                                     | Quartermaster | Paprika ($5-30) | Plan to Eat ($49/yr) | Mealime (~$36/yr) | Ollie ($84/yr) |
| ----------------------------------- | ------------- | --------------- | -------------------- | ----------------- | -------------- |
| Fuzzy inventory→recipe matching     | 4-level       | No              | No                   | No                | No             |
| Unit-aware shopping consolidation   | Cross-family  | Basic           | Basic                | Yes               | Basic          |
| Inventory subtraction after cooking | Yes           | No              | No                   | No                | No             |
| Expiration-based suggestions        | Yes           | No              | No                   | No                | Partial        |
| Ingredient overlap planning         | Yes           | No              | No                   | No                | No             |
| AI substitution hints               | Yes           | No              | No                   | No                | Yes            |
| AI recipe generation from inventory | Yes           | No              | No                   | No                | Yes            |
| Smart meal plan auto-fill           | Planned       | No              | No                   | No                | Yes            |
| Household sharing + real-time sync  | Yes           | No              | No                   | No                | No             |

7 of 9 rows are shipped. No competitor offers the full inventory intelligence
loop. Ollie has AI features but lacks subtraction, overlap planning, and fuzzy
matching. At $49/yr, Quartermaster undercuts Ollie ($84/yr) significantly.

### Broader landscape

- **Traditional** (Paprika, Mela, Plan to Eat): No AI, no inventory intelligence.
  Compete on reliability and anti-subscription positioning
- **AI-first** (Ollie $84/yr, DishGen): AI meal plans, pantry scanning. Closest
  competitor but approaches from AI-first, not inventory-first
- **Corporate** (Samsung Food, free + $60/yr Plus): 240K+ recipes, Vision AI.
  Lacks subtraction, overlap, household collaboration
- **Self-hosted** (Mealie, Tandoor, KitchenOwl): Free, require Docker. Mealie
  added OpenAI (Feb 2026). None offer the full inventory loop
- **Social-first** (Honeydew, OnlyRecipe): TikTok/Instagram recipe import.
  Different audience

**Positioning:** Inventory intelligence for serious home cooks, priced between
traditional managers and AI-first premium apps.

---

## "Proven" Gate

Don't monetize until no-waste planning features have been used for 4+ weeks.
Minimum signals:

- Pairing suggestions used when building 3+ weekly plans
- Efficiency scores trend above 50%

Tracked via `UsageEvent` model. Stats at Settings > Data.

> **Gate check: March 12, 2026.** If thresholds aren't met, identify UX friction
> and fix it. Don't defer indefinitely.

---

## Go-Live Requirements

### Business Registration

Register a PFA (Persoana Fizica Autorizata) with ONRC under CAEN code 6201 or
6209. Takes a few weeks — start in parallel. Romanian bank account required.
Consult accountant for CAEN code and VAT strategy (OSS for EU cross-border).

### Checklist

- [ ] Register PFA (ONRC, bank account, CAEN code)
- [ ] Stripe live mode (swap test keys, verify business, connect payouts)
- [ ] Stripe Dashboard (create Products/Prices, configure Portal, webhook)
- [ ] VAT setup (Stripe Tax and/or OSS)

---

## Distribution

3 external users onboarded. Aiming for 5+ before launch.

### Growth loops

- **Recipe sharing** — `/share/$recipeId` with JSON-LD and OG tags. Every shared
  recipe is a landing page with import CTA
- **Data portability** — JSON export as trust signal ("Your recipes, your data")
- **Self-hosting** — Standard Node.js, no Docker. Differentiator vs. Mealie et al
- **Invite codes** — QM-XXXXXX format, 60 days Pro + 2 starter codes. Social
  currency: "try this app — here's a code"

### Launch channels

- r/selfhosted, r/mealprepsunday, r/Cooking — angle by subreddit
- Hacker News — "Show HN: inventory-aware meal planner" (technical depth appeals)
- Word of mouth — household sharing makes every user a recruiter

---

## Churn Mitigation

Target: <5% monthly churn.

- **Pro expiry awareness** (shipped): days-remaining badge, toast nudges at 7d/3d,
  "data is safe" messaging on lapse, graceful downgrade with data preservation
- **Pause option** (planned): 1-3 month pause instead of cancel
- **Cancel flow** (planned): show what they'll lose, "switch to annual" offer
- **Data export on cancel** (planned): proactive JSON export in cancel flow

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
  maintaining inventory. **Fallback:** passive "light inventory" mode (shopping
  check-offs + "I have this" only, no manual entry). Discovery becomes fuzzy
  suggestions rather than precise matching
- **App store economics** — PWA avoids 30% cut but limits discoverability.
  Web-first is right for the indie/self-hosted audience
