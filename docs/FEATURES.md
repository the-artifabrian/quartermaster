# Quartermaster - Feature Reference

Built to replace 100+ recipes scattered across Apple Notes. Track what's in your
kitchen, see what you can cook, plan the week, generate a shopping list, and
watch inventory update as you cook. The whole loop — from "what do I have?" to
"what should I make?" to "what do I need to buy?" — in one app.

High-level feature reference (not exhaustive). For the roadmap, see
[DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md). For business strategy, see

---

## Recipe Management

- Full CRUD with title, description, servings, prep/cook time, ingredients,
  instructions, personal notes
- Image uploads (S3-compatible, max 3MB, JPEG/PNG/WebP)
- Full-text search across title, ingredients, and description
- Sort (5 options), cook-time filter, favorites filter, makeable-only toggle
- Recipe scaling with +/- servings controls and fraction display
- Metric/imperial toggle: one-tap g/ml conversion for ingredients (cups, oz,
  lb). Density-aware cup→gram conversion (~65 ingredients), volume fallback
  for unknowns (marked approximate). Temperature conversion in instructions
  (°F→°C). Composes with serving scaling. Persists via localStorage
- Cooking mode: interactive ingredient checkboxes and instruction cross-off with
  localStorage persistence (keyed by recipeId, 7-day auto-expiry, cleared on
  cook log)
- Inline timers: auto-detected from instruction text ("simmer for 15 minutes" →
  one-tap start), up to 5 concurrent timers with floating widget that persists
  across navigation, alarm sound, wake lock
- Auto-detected temperature conversion tooltips (F↔C on hover/tap)
- Print-friendly recipe layout
- Recipe share button copies a public link to clipboard (`/share/$recipeId`)
  with explicit "public link" warning in tooltip and toast
- Public share page (`/share/$recipeId`) with OG meta tags, JSON-LD, recipe
  scaling, "Save to My Recipes" for logged-in users, sign-up CTA for non-users
- Import from URL (JSON-LD scraping with text fallback, follows redirects),
  quick text entry, JSON export
- Bulk import: paste plain-text recipes or upload `.md`/`.txt` files. `---`
  separator for multiple recipes per batch (max 50). Handles checkbox format and
  sub-section headers (become ingredient heading rows). Post-import nudge CTA
- Import quality flags: filterable via `?quality=flagged` (missing ingredients,
  missing instructions, or duplicate titles) — computed from main query, no
  persistent banner
- AI recipe generation from inventory (Pro): pick meal type, generates a recipe
  from current inventory (prioritizing expiring items). Preview before saving,
  "AI Generated" badge on saved recipes. Feature-specific error messages
  (rate limit, timeout, parse failure) instead of generic toasts
- "I Made This" cook logging with inventory impact preview (shows what will be
  subtracted, what won't auto-adjust with reasons, and post-cook review step for
  marking skipped items as used up)
- Inline inventory status on recipe detail ingredient list: summary footer shows
  "You have X/Y ingredients" with "Add N missing to Shopping List" button
- "Last cooked" stats on recipe cards (cook count + relative time)
- Ingredient headings: section dividers within ingredient lists displayed as
  styled headers. Skipped by shopping list, matching, subtraction, and JSON-LD
- Drag-and-drop ingredient reordering (`@dnd-kit/sortable`)
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

- Three locations: Pantry, Fridge, Freezer. "All" tab groups items by location
  with section headers; individual tabs show a single location. Status badges
  countdowns
- Items with optional quantity, unit, expiration, and low-stock flag
- Streamlined card actions: pencil (quick edit) + overflow menu (low-stock
  toggle, full edit, delete with two-tap confirmation). Optimistic delete
- Client-side search/filter across all items and location tabs
- Quick-add with optional inline quantity/unit fields + 33 common ingredient
  shortcuts. Duplicate detection via canonical name matching (same location) --
  warns with "Update existing" / "Add anyway" choice
- Full add form (`/inventory/new`) also detects duplicates with merge/add-anyway
  banner
- Bulk add (pantry staples onboarding) silently skips duplicates
- Ingredient normalization pipeline: ~40 modifier strippers, ~25 synonym groups,
  pluralization, compound ingredient protection, non-equivalent exclusions.
  Powers matching, shopping consolidation, overlap scoring, and waste detection
- Ingredient parser: nested parenthetical quantities, "to taste", ranges
- "What can I make?" always-on when inventory exists -- recipe cards show SVG
  match progress rings, default sort by match percentage, 4-level fuzzy matching
  (exact, synonym, core word, multi-word containment)
- "Use these up soon" callout for items expiring within 3 days: meal plan
  coverage detection (checks upcoming 2 weeks of uncooked meals for ingredient
  matches — covered items shown muted with recipe name, day, and meal type;
  uncovered items shown prominently with "Find recipes" CTA). Per-item dismiss
  via localStorage (keyed by item ID + expiry date, resets if expiry changes)
- Automatic inventory subtraction after cooking (cross-system unit conversion,
  feedback toast). Items with no tracked quantity or incompatible units are
  reported as skipped (with reason) — surfaced in toasts and post-cook review

## Meal Planning & Shopping

- Weekly calendar view (Monday-start, two-row 4+3 layout, today emphasis, 4 meal
  types per day)
- Click-to-assign recipes to meal slots with thumbnail previews (or letter
  placeholders), multiple recipes per slot
- Per-entry serving size overrides with +/- controls (clamped 1-999);
  passthrough to recipe detail via `?servings=N` query param
- Mark meals as "cooked" with optimistic toggle; quick "I made this" one-tap
  action (logs cook + subtracts inventory, skipped items shown in toast)
- Uncooked meal reminders: site-wide banner for planned-but-uncooked meals from
  today or yesterday (time-of-day gated). 1-tap "Yes, I made it" (cook log +
  inventory subtraction + skipped item toast) or "Skip" (session dismiss)
- "Up next" banner (current week): next chronological meal to cook today with
  time-of-day awareness. Empty state suggests a favorite with one-tap add
- Copy week to next week (preserves servings, skips duplicates)
- Meal plan templates: save/apply/delete named templates, household-scoped
- Suggest Meals: one-tap "Suggest Meals" button fills the week with dinner
  suggestions ranked by priority — recipes using expiring inventory (2+ matches),
  favorites not recently cooked, then highest inventory match %. Review modal
  shows 7 day rows with reason badges (Expiring/Favorite/Good match), inline
  recipe picker for empty or swapped days, and "Fill Plan" confirm. Post-confirm
  toast links to shopping list generation
- Pairing suggestions when adding recipes: ranked by ingredient overlap with
  planned recipes, weeknight-aware sorting (Mon-Thu quick-cook recipes first),
  inventory match indicators (X/Y ingredients in stock, green at 100%)
- Single-use ingredient waste alerts with recipe suggestions
- Standalone shopping list at `/shopping` with:
  - Generate from meal plan (week picker for prev/current/next week, skips
    cooked meals) with dedup against existing manual/recipe items
  - Quick add (open by default, collapsible) with smart duplicate/inventory
    warnings and "Add Anyway" bypass
  - Auto-categorization (produce, dairy, meat, pantry, frozen, bakery,
    household, other) for inventory pipeline and household item filtering
    (items sort by checked status then name; no visible category headers)
  - Inline item editing (name, quantity, unit)
  - Checked/total counter in the page header (e.g. "Shopping List (3/10)")
  - Client-side search/filter, print-friendly layout
  - Inventory-aware: subtracts items already in stock and staple ingredients
  - Optimistic UI on checkbox toggle and delete (instant response via
    `useFetcher`)
  - Live-refresh via SSE for all shopping list events (generate, add, clear,
    to-inventory, toggle, edit, delete; debounced 500ms)
  - Check-off -> inventory pipeline: compact collapsed rows with location badges
    and short expiry dates, tap to expand controls, select all/deselect all.
    Pre-filled location and auto-suggested expiry (shelf-life lookup, ~60
    entries). Auto-merges with existing inventory items (canonical name match,
    same location) -- clears low-stock flag on merge. Household items cleared
    but not added to inventory
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
- Real-time activity via SSE + 30s database polling fallback: 25+ event types
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
- Pantry staples onboarding on empty inventory with post-add success CTA
  (browse recipes or view inventory)
- Progressive post-action nudges: contextual banners that guide users through
  the core loop (recipe → inventory → meal plan → shopping list). Each nudge
  appears only when the prior milestone is complete and the next is not.
  Dismissible per-user via localStorage. 4 nudges: "Stock your kitchen" on
  recipe detail, "Plan your week" on inventory (Pro), "Generate shopping list"
  on meal plan, "Check items off" on shopping list

- Free: unlimited recipes, up to 50 inventory items, smart matching, household
  days Pro, grants 2 starter codes) coexist with Stripe and trial
- Pro-gated routes redirect to `/upgrade` with lock icons in nav. Graceful
  downgrade with data preservation, expiry nudges at 7d/3d
- Admin pages: `/admin/users` (analytics), `/admin/subscriptions` (codes +
  tiers)

## UI & Infrastructure

- Custom color system (sage green + peach accent, OKLch), Fraunces/DM Sans
  typography
- Landing page with serif hero, 4-step feature story, dual CTAs
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
- Usage analytics via `UsageEvent` model (pairing selections, recipe actions,
  event counts). Stats page at Settings > Data (cooking activity, meal planning,
  event log)
- Vitest unit/integration tests + Playwright e2e tests (including shopping →
  inventory pipeline end-to-end coverage)
- Deployed on Fly.io with LiteFS, custom domain, HTTPS

---

_Last updated: February 24, 2026._
