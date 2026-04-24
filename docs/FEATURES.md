# Quartermaster - Feature Reference

Save the recipes you actually cook, plan the week, and generate a shopping list
that highlights what you need to buy. The whole loop, from "what should I make?"
to "what do I need to buy?" to "what worked?", in one app.

### What makes this different

1. **Recipe-to-shopping friction reduction.** Planned meals turn into a
   deduplicated, pantry-aware shopping list.
2. **Pantry, not inventory.** The app remembers what you usually keep on hand so
   the shopping list can focus on what you may need to buy.
3. **Cookbook-quality design without photos.** Warm serif typography treats the
   recipe text as the main event.

---

## Core Loop

These are the features that make the product useful week after week.

### Recipes

- Full CRUD, image uploads, full-text search, sort/filter, favorites
- Serving scaling with fraction display, metric/imperial toggle with ingredient
  density table (~70 ingredients)
- Cooking mode: ingredient checkboxes, instruction cross-off, auto-scroll,
  localStorage persistence with 7-day expiry
- Inline timers auto-detected from instruction text, up to 5 concurrent with
  floating widget, alarm sound, wake lock, auto-dismiss after 60s
- Temperature conversion tooltips (F/C), print layout
- Public share pages with OG tags, JSON-LD, full cooking mode
- Import: URL (JSON-LD scraping), quick text entry, bulk import (.md/.txt, max
  50 per batch), import quality flags
- Per-ingredient actions on recipe detail: "Usually on hand" and "Add to
  shopping list" for missing ingredients
- Add to meal plan from recipe detail, cook logging, ingredient headings, linked
  ingredients (cross-recipe hyperlinks), optional ingredient detection
- Drag-and-drop ingredient reordering

### Pantry

Pantry means "things I usually keep around," not exact current stock or only dry
cupboard goods. It can include fridge-door condiments, sauces, freezer staples,
and dry goods. Its job is to reduce shopping-list mental load by marking likely
items and making what needs buying easier to scan.

- Flat alphabetical list, no categories, no quantities, no expiry
- Inline editing, swipe-to-delete, quick-add with duplicate detection
- Bulk add through "usually on hand" onboarding, canonical name dedup
- Normalization pipeline: ~40 modifier strippers (incl. ground, smoked,
  diced...), compound prep phrase stripping, ~25 synonym groups, pluralization,
  compound ingredient protection
- Pantry fit indicators on recipe cards/planning surfaces, plus a "Nothing to
  buy" filter on the recipe list that surfaces recipes with no missing
  ingredients. Prefer actionable "needs 3 things" / "usually on hand" language
  over precise "you can make this now" claims
- Avoid recurring stale-review chores. If confidence needs to decay, do it
  quietly or ask contextual confirmation only when it improves a shopping list

### Meal Planning

- Weekly calendar (Mon-start, 4 meal types/day), per-entry serving overrides
- Cooked/uncooked tracking, uncooked meal reminders (time-of-day gated, 2-hour
  grace period for recently added meals), "up next" banner
- Post-cook Pantry review should stay optional and low-pressure. Avoid making
  users feel responsible for maintaining an exact ledger after dinner
- Copy week, suggest meals (favorites + pantry fit scoring, variety enforcement,
  meal-type classification, Jaccard overlap filtering)
- Recipe selector: favorites-first, weeknight-aware sorting, cook stats
- Single-use ingredient waste alerts, if kept, should be quiet and contextual;
  avoid framing the user's plan as a mistake

### Shopping List

- Generate from meal plan (week picker, skips cooked, dedup, pantry-aware)
- Quick add with duplicate and Pantry warnings
- Auto-categorization, inline editing, checked counter, search/filter, print
- Pantry-aware: items usually on hand are marked/pre-checked with clear copy so
  users understand they may still want to double-check before shopping
- Optimistic UI, live-refresh via SSE (debounced 500ms)
- Check-off to Pantry pipeline with canonical name matching. Frame as "remember
  for next time," not exact current-stock synchronization

## Supportive Features

These features support the core loop, but should not compete with it.

### Household Sharing

- One household per user (auto-created), owner/member roles
- All data household-scoped, CookingLog user-scoped
- Token-based invites (7-day expiry), member management, data-on-leave handling
- Real-time shopping sync via SSE + 30s polling fallback
- Activity dot on Shop tab, auto-prune events after 30 days

### Onboarding & Subscriptions

- Getting Started checklist (3 steps), Pantry onboarding
- Progressive nudges through the core loop (4 contextual banners)
- Optional Stripe subscription (Free/Pro tiers) with graceful downgrade
- Admin pages for user analytics and tier management

## Optional / Power User Features

These are useful when they remove work. They should stay secondary unless usage
proves they belong in the main path.

- AI recipe extraction: paste text or upload screenshot, Claude Sonnet for
  images (1024px downscale), Haiku for text. 10/day rate limit. This is an
  import accelerator, not the product's core promise
- AI recipe generation: create recipes from Pantry context with meal-type
  filters and quick-meal toggle
- AI recipe enhance: infer missing metadata (description, servings, times)
- Voice-to-text: Groq Whisper transcription with hallucination detection, Claude
  Haiku structured parsing with regex fallback

## UI & Infrastructure

- Custom color system (sage/copper/clay, OKLch), Young Serif + DM Sans
  typography
- Mobile-first with bottom nav, 44px touch targets, PWA with offline support
- Accessibility: skip-to-content, semantic landmarks, aria-labels, focus
  management, `prefers-reduced-motion`
- SEO: OG/Twitter meta, JSON-LD, sitemap, canonical URLs
- Security: nonce-based CSP, SSRF protection, Zod validation, magic-byte MIME
  checks, PwnedPasswords, user enumeration prevention
- Full data export/import with duplicate detection
- 830+ Vitest tests + Playwright e2e, deployed on Fly.io with LiteFS

---

_Last updated: April 24, 2026._
