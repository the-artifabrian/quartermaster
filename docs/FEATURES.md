# Quartermaster - Feature Reference

Built to replace 100+ recipes scattered across Apple Notes. Track what's in your
kitchen, see what you can cook, plan the week, generate a shopping list, and
watch inventory update as you cook. The whole loop — from "what do I have?" to
"what should I make?" to "what do I need to buy?" — in one app.

Complete feature catalog. For the roadmap, see
[DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md). For business strategy, see

---

## Recipe Management

- Full CRUD with title, description, servings, prep/cook time, ingredients,
  instructions, personal notes
- Image uploads (S3-compatible, max 3MB, JPEG/PNG/WebP)
- Full-text search across title, ingredients, and description
- Sort (5 options), cook-time filter, favorites filter, makeable-only toggle
- Recipe scaling with +/- servings controls and fraction display
- Cooking mode: interactive ingredient checkboxes and instruction cross-off,
  auto-detected inline timer buttons ("simmer for 15 minutes" -> one-tap start,
  up to 5 concurrent timers with floating widget, alarm sound, wake lock),
  auto-detected temperature conversion tooltips (F<->C on hover/tap)
- Print-friendly recipe layout
- Share via Web Share API (clipboard fallback). Public share page
  (`/share/$recipeId`) with OG meta tags, JSON-LD, recipe scaling, "Save to My
  Recipes" for logged-in users, sign-up CTA for non-users
- Import from URL (JSON-LD scraping with text fallback), quick text entry, JSON
  export
- Bulk import: paste plain-text recipes or upload `.md`/`.txt` files. `---`
  separator for multiple recipes per batch (max 50). Handles checkbox format and
  sub-section headers (become ingredient heading rows). Post-import nudge CTA
- Import quality flags: filterable via `?quality=flagged` (missing ingredients,
  missing instructions, or duplicate titles) — computed from main query, no
  persistent banner
- AI recipe generation from inventory (Pro): "Generate Recipe" button on recipes
  page. Pick optional meal type and quick-meal toggle, single LLM call (Claude
  Haiku) generates a full recipe from current inventory items (prioritizing
  expiring items). Preview with ingredients and instructions before saving. Saved recipes marked `isAiGenerated` with violet "AI Generated"
  badge on detail page, share page, and recipe cards
- "I Made This" cook logging with inventory impact preview
- Inline inventory status on recipe detail ingredient list: summary footer shows
  "You have X/Y ingredients" with "Add N missing to Shopping List" button
- "Last cooked" stats on recipe cards (cook count + relative time)
- Ingredient headings: section dividers within ingredient lists displayed as
  styled headers. Skipped by shopping list, matching, subtraction, and JSON-LD
- Drag-and-drop ingredient reordering (`@dnd-kit/sortable`)
- AI recipe enhance (Pro): one-click "Enhance with AI" button on recipe detail
  page. Sends recipe to Claude Haiku to infer missing metadata (description,
  servings, prep/cook times). Before/after modal with per-field checkboxes —
  missing fields pre-checked, existing fields opt-in. 10/day rate limit.
  Sparkles button in desktop and mobile action bars (violet, spinner while
  loading). No-changes case handled gracefully
- Ingredient substitution hints (Pro): click missing-ingredient pills to see
  substitutions. ~50 common static entries + Claude Haiku LLM fallback (cached
  30 days). Inventory-aware (highlights substitutes you have), recipe-context-
  aware (LLM receives recipe title + ingredients for dish-appropriate suggestions).
  Appears on recipe detail, recipe cards, and "Almost There" banner. "Use this"
  temporarily swaps ingredient in both list and instruction text (client-side,
  revertible). Safety: culinary-function matching, allergen flagging, no non-food
  suggestions. "AI suggestion" badge for LLM-sourced results

## Inventory System

- Three locations: Pantry, Fridge, Freezer with compact inline status badges
  expiry countdowns
- Items with optional quantity, unit, expiration, and low-stock flag
- Client-side search/filter across all items and location tabs
- Quick-add with optional inline quantity/unit fields + 33 common ingredient
  shortcuts
- Ingredient normalization pipeline: ~40 modifier strippers, ~25 synonym groups,
  pluralization, compound ingredient protection, non-equivalent exclusions.
  Powers matching, shopping consolidation, overlap scoring, and waste detection
- Ingredient parser: nested parenthetical quantities, "to taste", ranges
- "What can I make?" always-on when inventory exists -- recipe cards show SVG
  match progress rings, default sort by match percentage, 4-level fuzzy matching
  (exact, synonym, core word, multi-word containment)
- "Almost there" banner for near-miss recipes (1-3 missing): ingredient pills
  with "Add to shopping list" and "I have this" (smart location + auto-suggested
  expiry from shelf-life lookup)
- Per-card missing ingredient pills with "I have this" buttons (up to 4 visible,
  overflow count) plus "add all missing to shopping list"
- "Use these up soon" callout for items expiring within 3 days: meal plan
  coverage detection (checks upcoming 2 weeks of uncooked meals for ingredient
  matches — covered items shown muted with recipe name, day, and meal type;
  uncovered items shown prominently with "Find recipes" CTA). Per-item dismiss
  via localStorage (keyed by item ID + expiry date, resets if expiry changes)
- Automatic inventory subtraction after cooking (cross-system unit conversion,
  feedback toast). Incompatible unit types flag as low stock

## Meal Planning & Shopping

- Weekly calendar view (Monday-start, two-row 4+3 layout, today emphasis, 4 meal
  types per day)
- Click-to-assign recipes to meal slots, multiple recipes per slot
- Per-entry serving size overrides with +/- controls
- Mark meals as "cooked" with optimistic toggle; quick "I made this" one-tap
  action (logs cook + subtracts inventory)
- Uncooked meal reminders: site-wide amber banner for planned-but-uncooked meals
  from today or yesterday. Time-of-day gated — breakfast after 11am, lunch after
  3pm, dinner/snack after 9pm (yesterday's meals always show). Shows one meal at
  a time with linked recipe name (1-tap navigation), "Yes, I made it" (triggers
  cook log + inventory subtraction with toast summary), and "Skip" (session-only
  dismiss). Pro-only, self-loads via resource route fetcher
- "Up next" banner (current week): next chronological meal to cook today with
  time-of-day awareness. Empty state suggests a favorite with one-tap add
- Copy week to next week (preserves servings, skips duplicates)
- Meal plan templates: save/apply/delete named templates, household-scoped
- Pairing suggestions when adding recipes: ranked by ingredient overlap with
  planned recipes, weeknight-aware sorting (Mon-Thu quick-cook recipes first),
  inventory match indicators (X/Y ingredients in stock, green at 100%)
- Single-use ingredient waste alerts with recipe suggestions
- Standalone shopping list at `/shopping` with:
  - Generate from meal plan (week picker for prev/current/next week) with
    dedup against existing manual/recipe items
  - Quick add (open by default, collapsible) with smart duplicate/inventory
    warnings and "Add Anyway" bypass
  - Auto-categorization (produce, dairy, meat, pantry, frozen, bakery,
    household, other) with section headers in the list
  - Inline item editing (name, quantity, unit)
  - Client-side search/filter (headers hidden during search), print-friendly
    layout
  - Inventory-aware: subtracts items already in stock and staple ingredients
  - Check-off -> inventory pipeline: pre-filled name, location, quantity, and
    auto-suggested expiry (shelf-life lookup, ~60 entries). Household items
    cleared but not added to inventory
  - Low-stock nudge: amber chip banner for low-stock items not already on list,
    one-tap add or "Add All"

## Household Sharing

- One household per user (auto-created on signup), owner/member roles
- All data scoped to household (recipes, inventory, meal plans, shopping lists).
  CookingLog stays user-scoped
- Invite system: token-based links with 7-day expiry, concurrent-accept guard
- Member management: rename household, remove members, revoke invites, leave
- Data on leave: sole members move all data; multi-member leaves deep-copy
  recipes
- Real-time activity via SSE + 30s database polling fallback: 24 event types
  with two-tier priority — **notify** (shopping list generated, meal plan
  changes, member join/leave) triggers toast + badge; **silent** (edits,
  deletes, inventory CRUD) appears in activity feed only. Client-side dedup
- Notification bell in header with unread badge, dropdown with formatted
  messages, "mark as read", and "View all activity" link
- Activity feed on household settings page (last 20 events)
- Auto-prune events older than 30 days

## Onboarding

- "Getting Started" checklist on `/recipes`: tracks 3 steps (add recipe, stock
  inventory, plan a meal) with progress bar. Free users see recipe + inventory
  steps. Dismissible, auto-hides on completion
- Pantry staples onboarding on empty inventory
- Planned: inventory-first AI recipe path, post-action contextual nudges (see
  [Backlog in DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md#backlog))

- Two-tier model: Free (unlimited recipes, up to 15 inventory items, smart
  Stripe coexist — user has Pro if either is active
  redemption. Admins generate codes at `/admin/subscriptions`
- Pro-only routes redirect to `/upgrade` with lock icons in nav. Free users get
  inventory (up to 15 items) and recipe matching; meal planning, shopping lists,
  and AI features require Pro
- Pro expiry awareness: days-remaining badge (color-coded), toast nudges at
  7d/3d, graceful downgrade with data preservation
- Admin pages: `/admin/users` (analytics), `/admin/subscriptions` (tier
  management + code generation)

## UI & Infrastructure

- Custom color system (sage green + peach accent, OKLch), Fraunces/DM Sans
  typography
- Landing page with serif hero, 4-step feature story, dual CTAs
- Warm empty states with serif headings across all pages
- Mobile-first responsive layout with bottom nav (sliding pill indicator)
- 44px minimum touch targets across all interactive elements (Apple HIG),
  `touch-action: manipulation` to eliminate 300ms tap delay
- Accessibility: skip-to-content, navigation landmarks, modal focus trapping,
  aria-labels on icon-only buttons, `prefers-reduced-motion` support
- SEO: descriptive titles, canonical URLs, OG/Twitter meta, JSON-LD (Recipe,
  WebApplication, FAQPage), sitemap, robots.txt
- PWA with service worker for offline access, iOS standalone meta tags, and
  `apple-touch-startup-image` splash screens for all device sizes (light + dark,
  generated by `other/generate-splash-screens.mjs`)
- Full data export (JSON) + import round-trip with duplicate detection and
  per-section error isolation
- Security: CSP (nonce-based), streaming upload size enforcement, MIME
  validation, Zod on all bulk ops, SSRF protection, input length limits
- Usage analytics via `UsageEvent` model: pairing selections, discovery stats.
  Stats page at Settings > Data
- Vitest unit/integration tests + Playwright e2e tests
- Deployed on Fly.io with LiteFS, custom domain, HTTPS
