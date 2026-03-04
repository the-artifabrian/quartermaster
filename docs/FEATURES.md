# Quartermaster - Feature Reference

Built to replace 100+ recipes scattered across Apple Notes. Track what's in your
kitchen, see what you can cook, plan the week, and generate a shopping list. The
whole loop — from "what do I have?" to "what should I make?" to "what do I need
to buy?" — in one app.

High-level feature reference (not exhaustive). For the roadmap, see
[DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md). For business strategy, see

### What makes this different

Most of the features below are table stakes for a recipe app. Three things
aren't:

1. **Inventory-aware recipe matching** — "What can I make?" with 4-level fuzzy
   matching, match rings on every recipe card. No competitor offers this.
2. **Closed-loop pipeline** — Plan → shop → check off → restock inventory →
   discover recipes → plan again. The shopping list feeds inventory, inventory
   feeds recipe discovery, discovery feeds planning. One loop, not disconnected
   features.
3. **Cookbook-quality design without photos** — Most recipes don't have images.
   The app is designed around that reality with warm serif typography, not
   around it.

Everything else (cooking timers, scaling, household sharing, AI features) is
execution quality, not differentiation.

---

## Recipe Management

- Full CRUD with title, description, servings, prep/cook time, ingredients,
  instructions, personal notes
- Image uploads (S3-compatible, max 3MB, JPEG/PNG/WebP)
- Full-text search across title, ingredients, and description
- Sort (5 options), cook-time filter, favorites filter, ready-to-cook toggle
- Recipe scaling with +/- servings controls and fraction display
- Metric/imperial toggle: one-tap weight conversion for ingredients. All
  volume units (cups, fl oz, pints, quarts, gallons) convert to grams via
  ingredient density table (~70 ingredients); unknown ingredients fall back to
  ml (marked approximate). Weight units (oz, lb) convert to g/kg; oz
  auto-detects fluid ounces for known liquids. Temperature conversion in
  instructions (°F→°C). Composes with serving scaling. Persists via
  localStorage
- Cooking mode: interactive ingredient checkboxes and instruction cross-off with
  localStorage persistence (keyed by recipeId, 7-day auto-expiry, cleared on
  cook log). Auto-scrolls to next unchecked step when checking off a step.
  Instructions separated by subtle dividers for scannability
- Inline timers: auto-detected from instruction text ("simmer for 15 minutes" →
  one-tap start), up to 5 concurrent timers with floating widget that persists
  across navigation, alarm sound, wake lock
- Auto-detected temperature conversion tooltips (F↔C on hover/tap)
- Print-friendly recipe layout
- Recipe share button copies a public link to clipboard (`/share/$recipeId`)
  with explicit "public link" warning in tooltip and toast
- Public share page (`/share/$recipeId`) with OG meta tags, JSON-LD, recipe
  scaling, interactive cooking mode (checkboxes, cross-off, auto-scroll,
  dividers), inline timers, collapsible ingredients on mobile, "Save to My
  Recipes" for logged-in users, sign-up CTA for non-users. Shares components
  with recipe detail page (`RecipeMetadataCard`, `IngredientList`,
  `RecipeInstructionsList`) for consistent UX
- Import from URL (JSON-LD scraping with text fallback, follows redirects),
  quick text entry, JSON export. AI recipe extraction (Pro): paste informal
  text (social media captions, blog posts) or upload a screenshot and extract
  a structured recipe via LLM vision (Claude Sonnet for images with sharp
  downscaling to 1024px JPEG for cost control, Haiku for text). Same import
  preview/save flow. 10/day rate limit
- Bulk import: paste plain-text recipes or upload `.md`/`.txt` files. `---`
  separator for multiple recipes per batch (max 50). Handles checkbox format and
  sub-section headers (become ingredient heading rows). Post-import nudge CTA
- Import quality flags: filterable via `?quality=flagged` (missing ingredients,
  missing instructions, or duplicate titles) — computed from main query, no
  persistent banner
- AI recipe generation from inventory (Pro): prompt-first UI with optional
  meal-type filter chips and quick-meal toggle. Generates a recipe from current
  inventory. Metric units by default (except tsp/tbsp). Preview before saving, subtle
  sparkles icon on recipe cards for AI-generated recipes. Feature-specific error messages (rate limit, timeout,
  parse failure) instead of generic toasts
- Add to meal plan from recipe detail: calendar icon in action bar opens a
  popover with 7-day date picker (Today + next 6 days) and meal type selector.
  Submits to `/plan` assign intent, success toast confirms day and meal
- "I Made This" cook logging with success toast
- Inline inventory status on recipe detail ingredient list: summary footer shows
  "You have X/Y ingredients" with "Add N missing to Shopping List" button
- "Last cooked" stats on recipe cards: desktop shows cook count + relative time;
  mobile shows compact "Made Nx" badge in the metadata row
- Ingredient headings: section dividers within ingredient lists displayed as
  styled headers. Created via "+ Heading" button and positioned with
  drag-and-drop. Skipped by shopping list, matching, and JSON-LD
- Optional ingredient detection: ingredients with "optional" in their notes
  field are excluded from inventory matching, match percentage rings, X/Y
  ingredient counts, shopping list generation, meal suggestions, and
  ingredient overlap scoring — same treatment as staples and headings
- Drag-and-drop ingredient reordering (`@dnd-kit/sortable`). Collapsed rows
  show a one-line summary; expanded rows show a controls toolbar (drag, collapse,
  remove) above full-width name/amount/unit/notes inputs
- Voice-to-text input (Pro): one-tap mic button records audio, auto-stops on
  silence (~1.5s), transcribes via Groq-hosted Whisper (whisper-large-v3-turbo)
  with auto language detection (multi-language support), and parses structured
  qty/unit/name via Claude Haiku LLM with regex fallback. Single item populates
  the input for review; multiple items (comma or "and" separated) are bulk-added
  directly with ephemeral highlight (subtle background + mic icon) so
  bulk-added items are easy to spot for review — auto-clears after 60s.
  LLM parsing handles conversational sentences, numbers in product names, and
  any language naturally; the system prompt instructs Haiku to return an empty
  array for gibberish/unintelligible transcripts rather than guessing, and the
  regex fallback only activates on LLM API failure (not when Haiku deliberately
  returns no items). Pre-LLM quality gate rejects known Whisper hallucination
  artifacts ("thank you", "subscribe", "see you next time", etc.) and
  low-quality transcripts (too short or mostly non-letter characters). Whisper
  prompt hint includes grocery vocabulary and common units for better
  transcription accuracy. Transcript feedback: single-item results show an info
  toast with the raw transcript ("Heard: …"); multi-item bulk-adds show the
  transcript (truncated at 60 chars) alongside the item count in the success
  toast. Regex fallback handles word numbers 1-20 ("two pounds", "fifteen
  eggs"), compound numbers ("a dozen", "half a dozen", "a couple", "three
  hundred"), mixed fractions ("1 1/2 cups"), unit normalization aligned with
  unit-conversion canonical forms (pounds→lb, liters→l, cups→cup), vague
  quantifier stripping ("some", "a few", "a lot of"), Whisper comma cleanup,
  instructional prefix stripping ("I need", "we need", "get", "add", "buy",
  "grab"), repeatable filler word stripping (handles chains like "um yeah I need
  like some garlic"), and compound grocery name protection ("mac and cheese" not
  split on "and"). Available on shopping list (desktop + mobile FAB) and
  inventory (desktop quick-add + mobile FAB). 30s max recording safety net, iOS
  Safari AudioContext handling
- AI recipe enhance (Pro): one-click metadata inference (description, servings,
  prep/cook times) with before/after review modal. Feature-specific error
  messages. Primarily for cleaning up bulk-imported recipes
- Ingredient substitution hints (Pro): click missing-ingredient pills to see
  substitutions. Static DB + LLM fallback (cached, errors bypass cache).
  Inventory-aware (highlights substitutes you have), recipe-context-aware.
  Distinguishes "no substitutions found" from "AI unavailable" in the UI.
  "Use this" temporarily swaps ingredient in both list and instruction text
  (client-side, revertible)

## Inventory System

- Flat alphabetical list of items. No locations/categories — inventory is just
- No quantities or expiry — inventory is a rough signal of what you have, not a
  ledger of how much
- Item age labels: every item shows a compact relative age next to its name
  ("today", "3 days", "2 weeks", "1 month") — subtle metadata, not competing
  with the name
- Stale items review: when 5+ items are older than 30 days, an amber banner
  nudges the user to review. "Review" filters the list to stale items only for
  quick swipe-to-delete cleanup; count updates in real-time. "All caught up!"
  empty state when done. Dismisses for 7 days via localStorage, then reappears
  if stale items remain
- Inline editing: tap item name to rename in-place (save on blur/Enter, cancel
  on Escape). Dedup check prevents renaming to a name that already exists
- Card actions: swipe-left-to-delete (mobile, tap revealed button to confirm),
  overflow menu ("Add to shopping list" with success toast, delete with two-tap
  confirmation). Optimistic updates for all actions
- Client-side search/filter across all items
- Quick-add with duplicate detection via canonical name matching — warns with
  "Update existing" / "Add anyway" choice
- Full add form (`/inventory/new`) also detects duplicates with update/add-anyway
  banner
- Bulk add (staples onboarding) silently skips duplicates
- Ingredient normalization pipeline: ~40 modifier strippers, ~25 synonym groups,
  pluralization, compound ingredient protection, non-equivalent exclusions.
  Powers matching, shopping consolidation, overlap scoring, and waste detection
- Ingredient parser: nested parenthetical quantities, "to taste", ranges,
  written-out numbers, "juice/zest of", fl oz, period-tolerant unit
  abbreviations, JSON-LD cleanup (broken/double/orphaned parens, approx.
  markers, comma-wrapped parens), descriptor-aware comma splitting (keeps
  "boneless, skinless" together)
- "What can I make?" always-on when inventory exists -- recipe cards show SVG
  match progress rings, default sort by match percentage, 4-level fuzzy matching
  (exact, synonym, core word, multi-word containment)
## Meal Planning & Shopping

- Weekly calendar view (Monday-start, two-row 4+3 layout, today emphasis, 4 meal
  types per day)
- Click-to-assign recipes to meal slots (inline dropdown with search),
  multiple recipes per slot
- Per-entry serving size overrides with +/- controls (clamped 1-999);
  passthrough to recipe detail via `?servings=N` query param
- Mark meals as "cooked" with optimistic toggle; quick "I made this" one-tap
  action (logs cook, simple toast)
- Uncooked meal reminders: plan page banner for planned-but-uncooked meals from
  today or yesterday (time-of-day gated). 1-tap "Yes, I made it" (logs cook)
  or "Skip" (session dismiss)
- "Up next" banner (current week): next chronological meal to cook today with
  time-of-day awareness. Empty state suggests a favorite with one-tap add
- Copy week to next week (preserves servings, skips duplicates)
- Suggest Meals (Pro): fills the week with smart suggestions. Two pools —
  favorites not recently cooked, then highest inventory match — scored by
  composite (inventory match % × meal type fit). Title-based recipe
  classification (main/dessert/breakfast/side/condiment/beverage) with priority
  chain (protein words override head-noun, so "Chicken with Cream Sauce" is a
  main course not a condiment). Condiments and beverages hard-filtered; desserts
  deprioritized for dinner, promoted for snack. Variety enforcement: max 2 of
  same protein per week, Jaccard ingredient overlap > 0.5 rejected. Existing
  planned entries seed the variety state. Recently cooked recipes (14 days)
  excluded. Past days and past meal types (time-of-day aware) skipped in modal.
  Button hidden for fully past weeks. Meal type selector (dinner, lunch,
  breakfast, snack) with per-type slot detection. Review modal shows day rows
  with reason badges (Favorite/Good match), inline recipe picker for swaps, and
  "Fill Plan" confirm. Post-confirm toast links to shopping list generation
- Recipe selector dropdown (floating overlay, doesn't break calendar grid):
  favorites-first partition with section headers ("Favorites" / "All Recipes"),
  weeknight-aware sorting (Mon-Thu quick-cook recipes first) within each group,
  heart icon on favorites, cook count badge, cook time display
- Single-use ingredient waste alerts with recipe suggestions
- Standalone shopping list at `/shopping` with:
  - Generate from meal plan (week picker for prev/current/next week, skips
    cooked meals) with dedup against existing manual/recipe items
  - Quick add (open by default, collapsible) with smart duplicate/inventory
    warnings and "Add Anyway" bypass
  - Auto-categorization (produce, dairy, meat, pantry, frozen, bakery,
    household, other) for inventory pipeline and household item filtering.
    Flat alphabetical list — no category headers (intentional: category
    grouping was tried and removed as it added visual noise without
    helping real shopping trips)
  - Inline item editing (name, quantity, unit)
  - Checked/total counter in the page header (e.g. "Shopping List (3/10)")
  - Client-side search/filter, print-friendly layout
  - Inventory-aware: items already in stock are pre-checked instead of omitted
    — users can uncheck any they actually need. Staple ingredients
    (salt, pepper, water, oil), optional ingredients, and ingredient headings
    are filtered out entirely
  - Optimistic UI on checkbox toggle and delete (instant response via
    `useFetcher`)
  - Live-refresh via SSE for all shopping list events (generate, add, clear,
    to-inventory, toggle, edit, delete; debounced 500ms)
  - Check-off -> inventory pipeline: select all/deselect all, checkbox per item.
    "Already in inventory" indicator for items matching existing inventory
    (canonical name match) — pre-deselected with muted styling.
    Household items cleared but not added to inventory

## Household Sharing

- One household per user (auto-created on signup), owner/member roles
- All data scoped to household (recipes, inventory, meal plans, shopping lists).
  CookingLog stays user-scoped
- Invite system: token-based links with 7-day expiry, concurrent-accept guard
- Member management: rename household, remove members, revoke invites, leave
- Data on leave: sole members move all data; multi-member leaves deep-copy
  recipes
- Real-time shopping list sync via SSE + 30s database polling fallback:
  shopping list events and member join/leave trigger toasts. Client-side dedup.
  Copper activity dot on Shop bottom-nav tab when shopping events arrive from
  household members — auto-clears when visiting `/shopping` (session-scoped,
  Pro-only)
- Auto-prune events older than 30 days

## Onboarding

- "Getting Started" checklist on `/recipes`: tracks 3 steps (add recipe, stock
  inventory, plan a meal) with progress bar. All users see all 3 steps.
  Dismissible, auto-hides on completion
- Pantry staples onboarding on empty inventory with post-add success CTA
  (browse recipes or view inventory)
- Progressive post-action nudges: contextual banners that guide users through
  the core loop (recipe → inventory → meal plan → shopping list). Each nudge
  appears only when the prior milestone is complete and the next is not.
  Dismissible per-user via localStorage. 4 nudges: "Stock your kitchen" on
  recipe detail, "Plan your week" on inventory, "Generate shopping list"
  on meal plan, "Check items off" on shopping list

- Free: unlimited recipes, up to 50 inventory items, smart matching, basic meal
  planning calendar, basic shopping list generation, household sharing. Pro:
  unlimited inventory, planning intelligence (suggest meals, copy week,
  waste alerts), full shopping pipeline (live-refresh,
  days Pro, grants 2 starter codes) coexist with Stripe and trial
  redeemed a code (localStorage dismiss, inline redeem form)
- Pro-only features gated inline (buttons/panels hidden for free users). Graceful
  downgrade with data preservation, expiry nudges at 7d/3d
- Admin pages: `/admin/users` (analytics), `/admin/subscriptions` (codes +
  tiers)

## UI & Infrastructure

- Custom color system (sage green + peach accent, OKLch), Young Serif/DM Sans
  typography
- Landing page with serif hero, 4-step feature story, dual CTAs. Shared
  marketing footer (About, Support, Privacy, Terms) on all public pages
  via `_marketing.tsx` layout route. Secondary pages (about, privacy, tos,
  support) use Young Serif headings and back-nav links
- Warm empty states with serif headings across all pages
- Mobile-first responsive layout with bottom nav (sliding pill indicator)
- 44px minimum touch targets across all interactive elements (Apple HIG),
  `touch-action: manipulation` to eliminate 300ms tap delay
- Accessibility: skip-to-content link, semantic HTML landmarks (`<header>`,
  `<main>`), aria-labels on all interactive controls, focus-visible ring
  indicators on custom checkbox lists, consistent modal keyboard behavior (focus
  trap, focus restore, Escape to close via shared `useModal` hook),
  `prefers-reduced-motion` CSS support
- SEO: descriptive titles, canonical URLs, OG/Twitter meta, JSON-LD (Recipe,
  WebApplication, FAQPage), sitemap, robots.txt
- PWA with service worker for offline access, iOS standalone meta tags, and
  `apple-touch-startup-image` splash screens for all device sizes (light + dark,
  generated by `other/generate-splash-screens.mjs`)
- Full data export (JSON) + import round-trip with duplicate detection and
  per-section error isolation
- Security: CSP (nonce-based), streaming upload size enforcement, MIME
  validation, Zod on all bulk ops, SSRF protection (including post-redirect
  validation), input length limits, production sourcemaps disabled by default
  (only generated when Sentry is configured), error message sanitization on
  public-facing pages, user enumeration prevention on forgot-password
- Usage analytics via `UsageEvent` model (recipe actions, event counts). Stats
  page at Settings > Data (cooking activity, meal planning)
- Vitest unit/integration tests + Playwright e2e tests (including shopping →
  inventory pipeline end-to-end coverage)
- Deployed on Fly.io with LiteFS, custom domain, HTTPS

---

_Last updated: March 4, 2026._
