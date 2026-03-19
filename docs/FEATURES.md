# Quartermaster - Feature Reference

Track what's in your kitchen, see what you can cook, plan the week, and generate
a shopping list. The whole loop, from "what do I have?" to "what should I make?"
to "what do I need to buy?", in one app.

### What makes this different

1. **Inventory-aware recipe matching.** 4-level fuzzy matching with match rings
   on every recipe card.
2. **The full loop.** Plan, shop, check off, restock inventory, discover
   recipes, plan again.
3. **Cookbook-quality design without photos.** Warm serif typography treats the
   recipe text as the main event.

---

## Recipes

- Full CRUD, image uploads, full-text search, sort/filter, favorites
- Serving scaling with fraction display, metric/imperial toggle with ingredient
  density table (~70 ingredients)
- Cooking mode: ingredient checkboxes, instruction cross-off, auto-scroll,
  localStorage persistence with 7-day expiry
- Inline timers auto-detected from instruction text, up to 5 concurrent with
  floating widget, alarm sound, wake lock
- Temperature conversion tooltips (F/C), print layout
- Public share pages with OG tags, JSON-LD, full cooking mode
- Import: URL (JSON-LD scraping), quick text entry, bulk import (.md/.txt, max
  50 per batch), import quality flags
- AI recipe extraction: paste text or upload screenshot, Claude Sonnet for
  images (1024px downscale), Haiku for text. 10/day rate limit
- AI recipe generation: create recipes from current inventory with meal-type
  filters and quick-meal toggle
- AI recipe enhance: infer missing metadata (description, servings, times)
- Voice-to-text: Groq Whisper transcription with hallucination detection, Claude
  Haiku structured parsing with regex fallback
- Per-ingredient actions on recipe detail: "I have this" (quick inventory
  correction) and "Add to shopping list" (single-item add) for missing ingredients
- Add to meal plan from recipe detail, cook logging, ingredient headings, linked
  ingredients (cross-recipe hyperlinks), optional ingredient detection
- Drag-and-drop ingredient reordering

## Inventory

- Flat alphabetical list, no categories, no quantities, no expiry
- Item age labels, stale item review (30-day threshold)
- Inline editing, swipe-to-delete, quick-add with duplicate detection
- Bulk add (staples onboarding), canonical name dedup
- Normalization pipeline: ~40 modifier strippers, ~25 synonym groups,
  pluralization, compound ingredient protection
- "What can I make?": SVG match rings on recipe cards, default sort by match %,
  4-level fuzzy matching (exact, synonym, core word, containment)

## Meal Planning & Shopping

- Weekly calendar (Mon-start, 4 meal types/day), per-entry serving overrides
- Cooked/uncooked tracking, uncooked meal reminders, "up next" banner
- Copy week, suggest meals (favorites + inventory match scoring, variety
  enforcement, meal-type classification, Jaccard overlap filtering)
- Recipe selector: favorites-first, weeknight-aware sorting, cook stats
- Single-use ingredient waste alerts

**Shopping list:**

- Generate from meal plan (week picker, skips cooked, dedup, inventory-aware)
- Quick add with duplicate/inventory warnings
- Auto-categorization, inline editing, checked counter, search/filter, print
- Inventory-aware: in-stock items pre-checked, staples/optionals filtered out
- Optimistic UI, live-refresh via SSE (debounced 500ms)
- Check-off to inventory pipeline with canonical name matching

## Household Sharing

- One household per user (auto-created), owner/member roles
- All data household-scoped, CookingLog user-scoped
- Token-based invites (7-day expiry), member management, data-on-leave handling
- Real-time shopping sync via SSE + 30s polling fallback
- Activity dot on Shop tab, auto-prune events after 30 days

## Onboarding & Subscriptions

- Getting Started checklist (3 steps), pantry staples onboarding
- Progressive nudges through the core loop (4 contextual banners)
- Optional Stripe subscription (Free/Pro tiers) with graceful downgrade
- Admin pages for user analytics and tier management

## UI & Infrastructure

- Custom color system (sage/peach, OKLch), Young Serif + DM Sans typography
- Mobile-first with bottom nav, 44px touch targets, PWA with offline support
- Accessibility: skip-to-content, semantic landmarks, aria-labels, focus
  management, `prefers-reduced-motion`
- SEO: OG/Twitter meta, JSON-LD, sitemap, canonical URLs
- Security: nonce-based CSP, SSRF protection, Zod validation, magic-byte MIME
  checks, PwnedPasswords, user enumeration prevention
- Full data export/import with duplicate detection
- 857 Vitest tests + Playwright e2e, deployed on Fly.io with LiteFS

---

_Last updated: March 18, 2026._
