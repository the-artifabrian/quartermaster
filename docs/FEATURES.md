# Quartermaster - Feature Reference

Everything built across Phases 1-13e and the UI Redesign. For the forward-looking
roadmap, see [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md). For business strategy,
see [MONETIZATION_STRATEGY.md](./MONETIZATION_STRATEGY.md).

---

## Recipe Management

- Full CRUD with title, description, servings, prep/cook time, ingredients,
  instructions
- Image uploads (S3-compatible storage, max 3MB)
- 16 predefined tags across cuisine, meal-type, and dietary categories
- Full-text search across title, ingredients, and description
- Tag filtering and cook time filtering with bookmarkable URL params
- Recipe scaling with +/- servings controls and fraction display
- Cooking assistance: always-interactive ingredients (checkbox cross-off) and
  instructions (tap-to-complete with step number → checkmark transition),
  inline timer pill buttons on time references in instruction text ("simmer
  for 15 minutes" → one-tap timer start), multiple concurrent timer support
  (up to 5 named timers, global floating widget with pause/resume/dismiss,
  localStorage persistence across navigation, alarm sound + wake lock).
  Auto-detected time references support minutes/hours/seconds, ranges
  (upper bound), fractions, combined times ("1 hour 30 minutes"), with
  temperature false positive avoidance
- Favorite/bookmark recipes with filter toggle
- Print-friendly recipe layout (hides nav, actions, raw text, cooking history;
  single-column grid, flat cards)
- Share button with Web Share API (native mobile sharing) and clipboard
  fallback with toast confirmation
- Import from URL (JSON-LD scraping) with duplicate detection and text fallback
  (when structured data extraction fails, paste recipe text for parsing via the
  bulk-import parser), quick text entry, JSON export
- Bulk import: paste plain-text recipes (Apple Notes format) or upload multiple
  `.md`/`.txt` files via file picker or drag & drop. Client-side preview with
  `---` separator for multiple recipes per batch (max 50), session counter,
  auto-clear and refocus for rapid paste-import-paste workflow. Handles
  `- [ ]`/`- [x]` checkbox format and sub-section headers within ingredients
  (e.g., "Gremolata Topping", "Polenta") — sub-headers become ingredient
  heading rows (`isHeading: true`). Post-import nudge CTA: after a successful import,
  a dismissable card prompts "Ready to plan your week?" with links to `/plan`
  and `/recipes`
- "Surprise me" weighted random recipe picker (scores by inventory match,
  favorites, exploration bonus for uncooked recipes, recency penalty
  for recently cooked)
- "I Made This" cook logging with inventory impact preview (shows what
  will be subtracted/removed/flagged before confirming)
- "What Do I Need?" on recipe detail page (ingredients card header): checks
  inventory against recipe ingredients and shows missing/insufficient items
  with amounts in an interactive checklist. Items not in inventory show full
  recipe amounts (scaled by servings); items with insufficient stock show the
  deficit. Cross off items as you gather them, with progress counter and
  completion state. Reuses the existing `previewSubtraction` infrastructure
- "Last cooked" stats on recipe cards (cook count + relative time ago)
- Personal notes field per recipe ("always double the garlic", "kids don't like
  this")
- Ingredient headings: section dividers within ingredient lists (e.g.,
  "Gremolata Topping", "Polenta") displayed as styled headers on the recipe
  detail page. Heading rows are skipped by shopping list, matching, subtraction,
  and JSON-LD
- Drag-and-drop ingredient reordering in the recipe form (`@dnd-kit/sortable`)

## Inventory System

- Three locations: Pantry, Fridge, Freezer
- Items with optional quantity, unit, expiration, and low-stock flag
- Client-side search/filter across all items and location tabs
- Quick-add with optional inline quantity and unit fields
- Quick-add shortcuts for 30 common ingredients
- Ingredient normalization pipeline: ~40 modifier strippers, ~25 synonym groups,
  pluralization handling, compound ingredient protection (green onion, brown
  sugar, etc. preserved through modifier stripping), non-equivalent compound
  exclusions (rice != rice vinegar, coconut != coconut milk). Powers matching,
  shopping consolidation, overlap scoring, and waste detection across the
  entire app
- Ingredient parser: handles nested parenthetical quantities ("1 (14.5 oz) can
  diced tomatoes"), "to taste" extraction, tilde/approximate amounts, ranges
- "What can I make?" discovery page with 4-level fuzzy ingredient matching
  (exact, synonym, core word, multi-word containment)
- Match percentage scoring and missing ingredient highlighting
- "Almost there" banner for near-miss recipes (1-3 missing ingredients):
  shows deduplicated ingredient pills with one-click "Add to shopping list"
  (items added with `source: 'discover'`, auto-categorized, skip duplicates).
  Each ingredient pill has an "I have this" button that adds it to inventory
  with one tap (canonical name dedup, auto-revalidates match percentages)
- Per-card missing ingredient pills with individual "I have this" buttons
  (up to 4 visible, overflow count) plus "add all missing to shopping list"
- Expiration-based recipe suggestions ("Use It Before You Lose It")
- Automatic inventory subtraction after cooking (with unit conversion and
  feedback toast showing what changed)

## Meal Planning & Shopping

- Weekly calendar view (Monday-start, 4 meal types per day)
- Click-to-assign recipes to meal slots, multiple recipes per slot
- Per-entry serving size overrides with +/- controls
- Mark meals as "cooked" with optimistic toggle UI; quick "I made this"
  one-tap action (logs cook + subtracts inventory)

- "Up next" banner (current week only): shows the next chronological meal to
  cook today (breakfast before 11am, lunch 11am-3pm, dinner 3pm-9pm, snack
  after 9pm) with recipe image, cook time, servings, remaining meal count,
  and "View Recipe" link. Empty state suggests a favorite recipe with
  one-tap "Add to Today" (excludes already-planned recipes)
- Copy week to next week (preserves servings, skips duplicates)
- Meal plan templates: save a week as a named template ("Weeknight Easy",
  "Entertaining Week"), apply templates to any week (skips duplicate slots),
  delete templates. Household-scoped with real-time event notifications
- Auto-generated shopping list with unit-aware ingredient consolidation,
  week picker for generating from prev/current/next week's meal plan
- Grouped by store section (produce, dairy, meat, pantry, frozen, bakery, other)
- Inventory-aware: subtracts items already in stock and staple ingredients
- Shopping list -> inventory pipeline: check off items to add them to inventory
  with pre-filled name, location, and quantity
- Client-side search/filter within categories (hides empty categories, preserves
  progress bar, hidden on print)
- Manual item addition, check-off while shopping, clear checked items
- Print-friendly layout
- Ingredient overlap analysis engine: pairwise overlap using normalization
  pipeline (normalizeIngredient, synonym lookup, core word matching), efficiency
  scoring (unique-to-total ingredient ratio)
- Pairing suggestions when adding recipes to meal plan: ranked by ingredient
  overlap with already-planned recipes (inverted matching engine), sorted by
  shared ingredient count with green badges
- Single-use ingredient waste alerts with recipe suggestions to reduce waste
  ("You're only using parsley in one recipe -- add Tabbouleh?")
- Plan efficiency dashboard: total/unique ingredient stats, expandable shared
  ingredient bridges with recipe name pills

## Household Sharing

- Household model (`Household`, `HouseholdMember` join table) with owner/member
  roles, one household per user
- `householdId` on Recipe, InventoryItem, MealPlan, ShoppingList alongside
  `userId` (kept for attribution). CookingLog stays user-scoped (personal
  notes)
- ~50 queries migrated from `where: { userId }` to `where: { householdId }`
  across 15 route/utility files. Auth via `requireUserWithHousehold()` helper
  with race-safe auto-creation fallback
- Signup flows atomically create user + household + membership in transaction
- Invite system: `HouseholdInvite` model with token-based links, 7-day expiry,
  accept/decline flow, concurrent-accept guard
- Member management: rename household, remove members, revoke invites, leave
- Data on leave: sole members move all data (updateMany); multi-member leaves
  deep-copy recipes (ingredients, instructions, tags, image)
- Real-time activity via Server-Sent Events: in-memory EventEmitter singleton
  (`@epic-web/remember`) for SSE broadcasting, `HouseholdEvent` table for
  persistence. SSE endpoint with auth, 30s keepalive, self-event filtering,
  abort cleanup. Client EventSource with auto-reconnect (3-5s jitter)
- 24 event types: recipe CRUD/import/bulk-import/favorite, cook logged,
  inventory add/bulk-add/update/delete, meal plan assign/remove/cook/copy-week/
  template-saved/template-applied, shopping list generate/add-item/clear/
  to-inventory, member join/leave, data imported
- Two-tier notification priority: **notify** tier (11 types: shopping list
  generated/to-inventory, meal plan assigned/template-applied/week-copied,
  recipe created/imported, bulk imports, data imported, member join/leave)
  triggers toast + badge; **silent** tier (13 types: recipe edits/deletes/
  favorites, cook logs, inventory CRUD, meal plan removes/cooked, shopping list
  single-item adds/clears, template saves) appears in activity feed only.
  Reduces notification noise while keeping the full audit trail
- Sonner toast notifications with "View" action navigation (notify tier only)
- Activity feed on household settings page (last 20 events, relative timestamps,
  all event types)
- Auto-prune events older than 30 days (lazy, on SSE connect)
- Notification bell in header with unread badge count (server-loaded COUNT query
  filtered to notify-tier events + real-time SSE client-side increments)
- Notification dropdown: fetches last 20 events on open via resource route,
  marks as read via POST (updates `notificationsLastSeenAt`), shows formatted
  messages with relative timestamps, unread highlighting for notify-tier events
  only, clickable links, and "View all activity" link. Badge clears
  optimistically

## Onboarding

- "Getting Started" checklist on `/recipes` for new users: tracks 3 steps (add
  a recipe, stock inventory, plan a meal) with progress bar
- Steps auto-complete based on household data (recipe/inventory/meal-plan counts
  queried in loader)
- Dismissible via X button (persisted to localStorage), auto-hides when all 3
  steps are complete
- Works correctly when joining an existing household (steps reflect shared data)

## UI, SEO & Infrastructure

- Custom color system (sage green + peach accent, OKLch) and Fraunces/DM Sans
  typography
- Descriptive `<title>`, canonical URLs, Open Graph / Twitter Card meta tags
- JSON-LD Recipe structured data, marketing pages with sitemap
- PWA with service worker: offline access for viewed recipes and meal plan
- Full data export: comprehensive JSON download of all user/household data
  (recipes, inventory, meal plans, shopping lists, cooking logs, meal templates)
  plus recipe-only JSON export
- Import from export: complete data round-trip supporting both full exports and
  recipe-only exports. Client-side file validation with preview (item counts per
  section), server-side Zod validation with bounded string/array limits.
  Duplicate detection: recipes matched by title (case-insensitive), inventory by
  name+location. Meal plans find-or-create by week, entries skip on unique
  constraint conflicts. Partial success preserved (per-section error isolation).
  Results summary shows created/skipped/errored counts per section
- Security hardening: Content Security Policy enforced (nonce-based script-src,
  style-src, font-src for Google Fonts, object-src: none, form-action, base-uri,
  upgrade-insecure-requests), streaming file size enforcement on uploads,
  server-side MIME validation, Zod validation on all bulk operations, SSRF
  protection on URL import, input length limits on all text fields, open redirect
  fix, JSON-LD injection prevention
- Usage analytics: lightweight `UsageEvent` model (separate from HouseholdEvent
  notification system) tracks pairing recipe selections, efficiency snapshots
  (deduplicated per week), discover page visits, "Surprise Me" uses, and "What
  Do I Need?" uses. Stats page at Settings > Data > Usage stats with cooking
  activity, meal planning metrics, and discovery stats. JSON API at
  `GET /resources/usage-stats`. Events transferred on household join (sole
  member)
- Comprehensive unit/integration test suite (Vitest) and e2e tests (Playwright)
- Deployed on Fly.io with custom domain, HTTPS, and email
- Mobile-first responsive layout with bottom navigation

## UI Redesign

Transformed the app from "developer CRUD tool" to "daily cookbook":

- **Recipe detail overhaul**: compact header with meta card, sticky ingredients
  sidebar with interactive checkboxes, crossable instruction steps with inline
  timer pill buttons, "I Made This" button with inventory impact preview modal,
  "What Do I Need?" interactive checklist for missing ingredients
- **Discover page**: hero card for top match ("Tonight's Pick"), SVG progress
  rings for match percentage, expiring-item urgency pills
- **Meal plan**: two-row calendar layout (4+3 columns), today emphasis, compact
  cards, ingredient overlap summary with pairing suggestions
- **Inventory dashboard**: summary strip (expiring/low-stock/total), expiring
  callout card with "Find recipes" CTA, location section tints, human-readable
  expiry countdowns
- **Recipe list**: sort dropdown (5 options), grid/list view toggle, tag
  category colors (cuisine/meal-type/dietary), cook-time filter, import
  quality flags (amber banner detecting recipes with missing ingredients,
  missing instructions, or duplicate titles; filterable via `?quality=flagged`)
- **Shopping list**: visual progress bar, collapsible category sections with
  auto-collapse for checked sections
- **Recipe form**: collapsible `<details>` sections with completion summaries,
  mobile-friendly grid, improved ingredient row layout
- **Navigation**: sliding pill indicator on mobile bottom nav, household name
  in user dropdown
- **Landing page**: hero with serif typography and warm gradient, 4-step
  alternating feature story with mock UI visuals, dual CTAs
- **Empty states**: warm personality messages with serif headings and contextual
  illustrations across all pages
- **Accessibility**: skip-to-content link (WCAG 2.4.1), navigation landmarks
  with `aria-label` and `aria-current="page"`, modal focus trapping with focus
  return, aria-labels on icon-only buttons and interactive controls, aria-pressed
  on toggle buttons
- **Mobile touch target pass**: systematic improvements across all critical
  paths for in-kitchen and in-store use (44px minimum tap areas per Apple HIG).
  Recipe detail: larger ingredient checkboxes, servings +/- buttons, instruction
  step padding, timer pill touch targets (min 44px), iOS zoom prevention on modal
  inputs. Meal plan: larger cook checkboxes and servings controls, tappable empty
  slots. Shopping list: larger checkbox tap areas (~44px effective). Recipe list:
  wrapping filter controls, larger tag buttons and view toggles. Discover: larger
  "I have this" and "add to shopping list" buttons
