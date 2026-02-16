# Quartermaster - Feature Reference

Complete feature catalog. For the roadmap, see
[DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md). For business strategy, see

---

## Recipe Management

- Full CRUD with title, description, servings, prep/cook time, ingredients,
  instructions, personal notes
- Image uploads (S3-compatible, max 3MB, JPEG/PNG/WebP)
- 16 predefined tags across cuisine, meal-type, and dietary categories
- Full-text search across title, ingredients, and description
- Sort (5 options), grid/list view toggle, cook-time filter, favorites filter
- Recipe scaling with +/- servings controls and fraction display
- Cooking mode: interactive ingredient checkboxes and instruction cross-off,
  auto-detected inline timer buttons ("simmer for 15 minutes" -> one-tap start,
  up to 5 concurrent timers with floating widget, alarm sound, wake lock),
  auto-detected temperature conversion tooltips (F<->C on hover/tap)
- Print-friendly recipe layout
- Share via Web Share API (clipboard fallback). Public share page
  (`/share/$recipeId`) with OG meta tags, JSON-LD, recipe scaling, "Save to My
  Recipes" for logged-in users, sign-up CTA for non-users
- Import from URL (JSON-LD scraping with text fallback), quick text entry,
  JSON export
- Bulk import: paste plain-text recipes or upload `.md`/`.txt` files. `---`
  separator for multiple recipes per batch (max 50). Handles checkbox format and
  sub-section headers (become ingredient heading rows). Post-import nudge CTA
- Import quality flags: amber banner auto-detecting recipes with missing
  ingredients, missing instructions, or duplicate titles; filterable via
  `?quality=flagged`
- "Surprise me" weighted random picker (inventory match, favorites, exploration
  bonus, recency penalty)
- "I Made This" cook logging with inventory impact preview
- "What Do I Need?" checklist on recipe detail: shows missing/insufficient items
  with amounts (scaled by servings), cross-off progress counter
- "Last cooked" stats on recipe cards (cook count + relative time)
- Ingredient headings: section dividers within ingredient lists displayed as
  styled headers. Skipped by shopping list, matching, subtraction, and JSON-LD
- Drag-and-drop ingredient reordering (`@dnd-kit/sortable`)
- Ingredient substitution hints (Pro): click missing-ingredient pills to see
  substitutions. ~50 common static entries + LLM fallback (Claude Haiku, cached
  30 days). Inventory-aware — highlights substitutes you already have.
  Recipe-context-aware — LLM receives recipe title and ingredient list so
  suggestions fit the dish (e.g. won't suggest broth for water in a cake).
  Appears on recipe detail ingredient list, recipe cards, "Almost There" banner,
  and "What Do I Need?" modal

## Inventory System

- Three locations: Pantry, Fridge, Freezer with summary strip
  (expiring/low-stock/total counts), location tints, human-readable expiry
  countdowns
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
- Expiration-based recipe suggestions ("Use It Before You Lose It") with callout
  card and "Find recipes" CTA
- Automatic inventory subtraction after cooking (cross-system unit conversion,
  feedback toast). Incompatible unit types flag as low stock

## Meal Planning & Shopping

- Weekly calendar view (Monday-start, two-row 4+3 layout, today emphasis,
  4 meal types per day)
- Click-to-assign recipes to meal slots, multiple recipes per slot
- Per-entry serving size overrides with +/- controls
- Mark meals as "cooked" with optimistic toggle; quick "I made this" one-tap
  action (logs cook + subtracts inventory)
- "Up next" banner (current week): next chronological meal to cook today with
  time-of-day awareness. Empty state suggests a favorite with one-tap add
- Copy week to next week (preserves servings, skips duplicates)
- Meal plan templates: save/apply/delete named templates, household-scoped
- Pairing suggestions when adding recipes: ranked by ingredient overlap with
  planned recipes, weeknight-aware sorting (Mon-Thu quick-cook recipes first)
- Single-use ingredient waste alerts with recipe suggestions
- Plan efficiency dashboard: total/unique ingredient stats, shared ingredient
  bridges
- Standalone shopping list at `/shopping` with:
  - Generate from meal plan (week picker for prev/current/next week)
  - Collapsible quick add with smart duplicate/inventory warnings and "Add
    Anyway" bypass
  - Auto-categorization (produce, dairy, meat, pantry, frozen, bakery,
    household, other)
  - Inline item editing (name, quantity, unit)
  - Client-side search/filter, print-friendly layout
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
- Real-time activity via Server-Sent Events + 30s database polling fallback:
  24 event types with two-tier priority -- **notify** tier (shopping list
  generated, meal plan changes, recipe created/imported, member join/leave)
  triggers toast + badge; **silent** tier (edits, deletes, favorites, inventory
  CRUD) appears in activity feed only. SSE delivers instant same-machine events;
  polling catches cross-machine events on multi-instance Fly.io deployments.
  Client-side dedup (bounded ID set) prevents duplicate delivery
- Notification bell in header with unread badge, dropdown with formatted
  messages, "mark as read", and "View all activity" link
- Activity feed on household settings page (last 20 events)
- Auto-prune events older than 30 days

## Onboarding

- "Getting Started" checklist on `/recipes`: tracks 3 steps (add recipe, stock
  inventory, plan a meal) with progress bar. Free users see recipe step only.
  Dismissible, auto-hides on completion
- Pantry staples onboarding on empty inventory

  Stripe subscription, or admin override
- **Stripe integration**: Stripe Checkout (hosted redirect, PCI-compliant),
  Customer Portal for self-service plan changes/cancellation, webhook-driven
  subscription lifecycle (checkout completed, invoice paid, subscription
  Pro access if either is active
  Pro access. Redemption grants 2 starter codes to share with friends. Admins
  generate codes for launches at `/admin/subscriptions`
- Pro-only routes (`/inventory`, `/plan`, `/shopping`) redirect free users to
  `/upgrade` with lock icons in nav. Lapsed users get contextual toast ("Your
  data is safe") on redirect
- Mixed-access routes degrade gracefully: recipe list skips match data,
  recipe detail hides inventory features, Surprise Me skips inventory weighting,
  data import skips Pro-only models
  users see reassurance banner ("Your Pro access has ended — your data is safe")
- Pro expiry awareness: days-remaining badge in user dropdown (color-coded:
  muted >7d, amber 3-7d, red <=3d), days-remaining in Settings subscription
  card, client-side toast nudges at 7-day and 3-day thresholds
  (localStorage-gated per expiry date, reset on new code redemption)
- Graceful downgrade: data preserved on lapse (never deleted), lapsed state in
  Settings subscription card with Subscribe/Redeem buttons, "Renew Pro access"
  item in user dropdown
- Subscription status in Settings > Profile with "Manage Subscription" portal
  link for Stripe subscribers
- Admin pages: `/admin/users` (sortable analytics table — engagement signals,
  content counts, subscription source), `/admin/subscriptions` (tier management
  and code generation)
- Client hooks: `useSubscriptionTier()`, `useIsProActive()`,
  `useDaysUntilExpiry()`, `useWasProPreviously()`

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
- PWA with service worker for offline access
- Full data export (JSON) + import round-trip with duplicate detection and
  per-section error isolation
- Security: CSP (nonce-based), streaming upload size enforcement, MIME
  validation, Zod on all bulk ops, SSRF protection, input length limits
- Usage analytics via `UsageEvent` model: pairing selections, efficiency
  snapshots, discovery stats. Stats page at Settings > Data
- Vitest unit/integration tests + Playwright e2e tests
- Deployed on Fly.io with LiteFS, custom domain, HTTPS
