# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository. For the full feature catalog see
[docs/FEATURES.md](docs/FEATURES.md). For the roadmap see
[docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md).

## Commands

### Development

```bash
npm run dev              # Start dev server with mocks enabled (http://localhost:3000)
npm run dev:no-mocks     # Start dev server without MSW mocks
npm run build            # Build for production
npm run start            # Run production server
npm run typecheck        # Run TypeScript type checking
npm run lint             # Run ESLint
npm run format           # Format code with Prettier
```

### Testing

```bash
npm test                 # Run Vitest unit tests in watch mode
npm run coverage         # Run tests with coverage report
npm run test:e2e:dev     # Run Playwright tests in UI mode
npm run test:e2e:run     # Run Playwright tests in CI mode
npm run validate         # Run all checks: tests, lint, typecheck, e2e
```

### Database

```bash
npx prisma studio        # Open Prisma Studio GUI for database browsing
npx prisma migrate dev   # Create and apply new migration
npx prisma db seed       # Seed database (infrastructure + test users, dev only)
npx prisma generate      # Regenerate Prisma client after schema changes
```

### Development Scripts

```bash
npm run setup            # Full setup: build, migrate, generate, seed, install Playwright
```

## Architecture Overview

Quartermaster is a recipe management and meal planning app built on the **Epic
Stack** (React Router v7 / Remix). It uses a **file-based routing system** where
each route file can export `loader` (data fetching), `action` (mutations), and a
React component. All data is scoped to **households** (not individual users) for
shared access.

### Tech Stack

- **Framework**: React Router v7 with React 19
- **Database**: SQLite with Prisma ORM
- **Styling**: Tailwind CSS v4 + shadcn/ui components
- **Forms**: Conform + Zod for validation
- **Auth**: Session-based with Epic Stack auth system + household scoping
- **Real-time**: Server-Sent Events for household activity notifications
- **Testing**: Vitest (unit) + Playwright (e2e)
- **Deployment**: Fly.io with LiteFS for multi-region SQLite

### Directory Structure

```
app/
├── routes/
│   ├── recipes/         # Recipe CRUD, search, import, always-on inventory matching
│   ├── inventory/       # Inventory tracking (pantry/fridge/freezer)
│   ├── discover/        # Redirect → /recipes
│   ├── plan/            # Meal planning calendar
│   ├── shopping.tsx     # Standalone shopping list
│   ├── household/       # Household join flow
│   ├── settings/        # User profile, password, 2FA, household management, data
│   ├── resources/       # API-only routes (images, exports, notifications, SSE, etc.)
│   ├── _auth/           # Login, signup, verification, onboarding
│   ├── _marketing/      # Landing page, about, privacy, ToS
│   ├── _seo/            # robots.txt
│   └── share.$recipeId.tsx  # Public recipe sharing page
├── components/
│   ├── ui/              # shadcn/ui primitives
│   ├── recipe-*.tsx     # Recipe cards, form, match cards, selector
│   ├── inventory-*.tsx  # Item cards, quick-add, location tabs
│   ├── meal-*.tsx       # Calendar, slot cards
│   ├── shopping-list-*.tsx  # Shopping list items, inventory pipeline
│   ├── inline-temperature.tsx # Temperature conversion tooltip (F↔C)
│   ├── cooking-timer.tsx    # Timer provider + alarm sound
│   ├── timer-widget.tsx     # Floating timer display
│   ├── notification-bell.tsx    # Header notification dropdown
│   ├── household-activity-notifier.tsx  # SSE client + toast notifications
│   ├── getting-started-checklist.tsx    # New user onboarding
│   ├── pantry-staples-onboarding.tsx   # Empty inventory onboarding
│   ├── template-modal.tsx   # Meal plan template save/apply
│   ├── today-banner.tsx     # "Up next" meal banner
│   └── forms.tsx            # Form field wrappers
├── utils/
│   ├── db.server.ts             # Prisma client singleton
│   ├── auth.server.ts           # Auth helpers (getUserId, requireUserId, login, signup)
│   ├── household.server.ts      # Household auth, invite/join/leave, data transfer
│   ├── household-events.server.ts   # SSE event emission + pruning
│   ├── household-event-messages.ts  # Event formatting + priority classification
│   ├── recipe-matching.server.ts    # 4-level fuzzy ingredient matching
│   ├── recipe-validation.ts         # Recipe Zod schemas
│   ├── ingredient-parser.server.ts  # Ingredient string parsing (amounts, units, notes)
│   ├── ingredient-overlap.server.ts # Pairwise ingredient overlap scoring
│   ├── inventory-subtract.server.ts # Post-cooking inventory subtraction
│   ├── shopping-list.server.ts      # Shopping list generation from meal plan
│   ├── unit-conversion.ts          # Unit conversion + best-unit selection
│   ├── bulk-recipe-parser.ts       # Plain-text recipe parsing (Apple Notes format)
│   ├── surprise-scoring.server.ts  # Weighted random recipe selection
│   ├── time-detection.ts           # Instruction text → timer pill detection
│   ├── temperature-detection.ts    # Instruction text → temperature conversion tooltips
│   ├── storage.server.ts           # S3-compatible image upload
│   ├── pantry-staples.ts           # Staple ingredient definitions
│   ├── category-location-map.ts    # Ingredient → store section mapping
│   ├── shelf-life.ts              # Shelf-life lookup → auto-suggest expiry dates
│   ├── relative-time.ts            # Human-readable relative timestamps
│   ├── fractions.ts                # Fraction display (1.5 → "1½")
│   ├── usage-tracking.server.ts   # Fire-and-forget usage event tracking
│   └── usage-stats.server.ts      # Shared usage stats query logic
├── styles/              # Global CSS and Tailwind config
└── root.tsx             # Root layout with theme, toaster, timer provider, SSE

prisma/
├── schema.prisma        # Database schema (see below)
├── migrations/          # Migration history
├── seed.ts              # Dev seed: infrastructure + test users (kody, kody2)
├── seed-infrastructure.ts   # Permissions, roles (runs in prod via litefs)
└── run-seed-infrastructure.ts  # Standalone runner for litefs exec chain

tests/
├── e2e/                 # Playwright end-to-end tests
├── mocks/               # MSW mock handlers for external services
└── setup/               # Vitest configuration and global setup
```

## Core Systems

### Recipe System

**Data Model**: Recipe → Ingredients[] + Instructions[] + RecipeImage?

**Key Files**:

- `app/routes/recipes/index.tsx` - Recipe list with search, cook-time filter,
  sort, favorites, makeable-only toggle, `?quality=flagged` support
- `app/routes/recipes/new.tsx` - Create recipe (manual, URL import, bulk
  text/file import)
- `app/routes/recipes/$recipeId.tsx` - View with interactive cooking mode
  (ingredient checkboxes, instruction cross-off, inline timers, temperature
  conversion tooltips, "I Made This", "What Do I Need?")
- `app/routes/recipes/$recipeId.edit.tsx` - Edit recipe form
- `app/components/recipe-form.tsx` - Shared form with drag-and-drop ingredients
  (`@dnd-kit/sortable`), collapsible sections
- `app/utils/recipe-validation.ts` - Zod schemas
- `app/utils/bulk-recipe-parser.ts` - Plain-text/markdown recipe parsing

**Import**: URL import (JSON-LD scraping with text fallback — when extraction
fails, user can paste recipe text for parsing via `parseRecipeText()`), quick
text entry, bulk paste (with `---` separators for multiple recipes), file upload
(.md/.txt). Duplicate detection by title. Sub-section headers in ingredients
become heading rows (`isHeading: true`).

**Ingredient Headings**: Ingredients with `isHeading: true` are section dividers
(e.g., "Gremolata Topping"). They have only a `name`, no amount/unit/notes.
**Always skip heading rows** when iterating ingredients for matching, shopping
list, subtraction, or JSON-LD.

### Inventory System

**Data Model**: InventoryItem with free-text name, location
(pantry/fridge/freezer), optional quantity/unit/expiresAt/lowStock

**Key Files**:

- `app/routes/inventory/index.tsx` - Inventory list with location tabs, search
- `app/routes/inventory/new.tsx` - Add inventory item
- `app/routes/inventory/$id.edit.tsx` - Edit/delete inventory item
- `app/utils/inventory-validation.ts` - Zod schemas
- `app/utils/inventory-subtract.server.ts` - Post-cooking inventory subtraction

**Normalization Pipeline** (`recipe-matching.server.ts`): ~40 modifier
strippers, ~25 synonym groups, pluralization, compound ingredient protection
(green onion, brown sugar preserved), non-equivalent exclusions (rice ≠ rice
vinegar). Powers matching, shopping consolidation, and inventory subtraction.

### Recipe Matching & Discovery

**Location**: `app/utils/recipe-matching.server.ts`

Matches inventory against recipe ingredients with 4-level fuzzy matching: exact
(post-normalization) → synonym lookup → core word → multi-word containment.
Calculates match percentage per recipe. Always-on when the user has inventory
items — recipe cards show subtle match progress rings, default sort is by match
percentage (when no explicit sort chosen), and "Almost There" banner displays as
a contextual section. Also used by the "What Do I Need?" checklist on recipe
detail. The `/discover` route redirects to
`/recipes`.

### Meal Planning & Shopping

**Key Files**:

- `app/routes/plan/index.tsx` - Weekly calendar (Mon-Sun, 4 meal types/day),
  per-entry serving overrides, cook toggle, "Up next" banner, copy week,
  templates, pairing suggestions, waste alerts, efficiency dashboard
- `app/routes/shopping.tsx` - Standalone shopping list with generate from meal
  plan, collapsible quick add with duplicate/inventory warnings, low-stock nudge
  chips, household item category, flat item list, check-off → inventory pipeline
  (with shelf-life auto-suggest expiry dates), print layout
- `app/routes/plan/shopping-list.tsx` - Redirect to `/shopping`
- `app/utils/shopping-list.server.ts` - Shopping list generation logic
- `app/utils/ingredient-overlap.server.ts` - Pairwise overlap scoring for
  pairing suggestions and efficiency stats
- `app/utils/unit-conversion.ts` - Unit conversion across merged US/metric
  families (volume: ml↔tsp↔tbsp↔cup↔l, weight: g↔oz↔lb↔kg)

### Household Sharing

All data (recipes, inventory, meal plans, shopping lists) is scoped to a
**household**, not a user. Every user belongs to exactly one household
(auto-created on signup). Users within a household share all data.

**Key Files**:

- `app/utils/household.server.ts` - `requireUserWithHousehold(request)` (primary
  auth helper), invite/accept/leave logic, data transfer on join/leave
- `app/utils/household-events.server.ts` - Fire-and-forget event emission via
  in-memory EventEmitter, persisted to `HouseholdEvent` table
- `app/utils/household-event-messages.ts` - 24 event types, two-tier priority
  (notify = badge+toast, silent = activity feed only)
- `app/routes/resources/household-events.tsx` - SSE endpoint
- `app/routes/resources/notifications.tsx` - GET/POST for notification dropdown
- `app/routes/settings/profile/household.tsx` - Household management, invite,
  activity feed
- `app/routes/household/join.tsx` - Accept invite flow

**Data ownership pattern**: Write queries include both `userId` (attribution)
and `householdId` (scoping). Read queries use `where: { householdId }`.
CookingLog stays user-scoped.

### Authentication & Authorization

**Pattern**: Session-based authentication with httpOnly cookies.

**Key Functions** (in `app/utils/auth.server.ts`):

- `getUserId(request)` → userId | null (checks session)
- `requireUserId(request)` → userId | throws redirect to /login

**Household Auth** (in `app/utils/household.server.ts`):

- `requireUserWithHousehold(request)` → `{ userId, householdId }` — **use this
  for most routes** (all household-scoped data)
- Only use `requireUserId` for user-scoped routes: `me.tsx`,
  `resources/download-user-data.tsx`, `settings/` routes

**New User Flow**: Signup creates user + household + membership atomically.
Empty recipe library shows a "Getting Started" checklist. Empty inventory shows
pantry staples onboarding.

**Admin Role**: The `admin` role is created by the infrastructure seed
(`prisma/seed-infrastructure.ts`), which runs automatically on every deploy via
`litefs.yml`. In development, the `kody` test user gets admin automatically. In
production, promote a user to admin via Fly SSH (one-time):

```bash
fly ssh console -C "sqlite3 \$DATABASE_PATH \"
  INSERT INTO _RoleToUser (A, B)
  SELECT Role.id, User.id
  FROM Role, User
  WHERE Role.name = 'admin' AND User.username = 'YOUR_USERNAME';
\""
```

Admin routes: `/admin/cache` (cache management), `/admin/subscriptions` (tier
management + invite code generation).

### Invite Code System

**Growth model**: Open signup gives free tier. Pro access via invite codes,
Stripe subscription, or admin override (no auto-trial on signup). When a user
redeems an invite code and becomes Pro, they immediately receive 2 starter
invite codes to share with friends. Admins can also generate codes for launches.

**Key Files**:

- `app/utils/invite-codes.server.ts` — Code generation (`QM-XXXXXX` format),
  redemption with concurrent-use guard, starter code granting on redemption
- `app/utils/invite-code-status.ts` — Shared `RedeemCodeSchema` (Zod) and
  `getCodeStatus()` UI helper (used by settings and admin pages)
- `app/routes/resources/redeem-invite-code.tsx` — POST resource route for code
  redemption (used by `/upgrade` and potentially other pages via `useFetcher`)
- `app/routes/upgrade.tsx` — Pricing page with invite code input, Stripe
  checkout buttons, billing period toggle
- `app/routes/settings/profile/invite-codes.tsx` — Pro-only settings page
  showing user's codes
- `app/routes/admin/subscriptions.tsx` — Admin code generation + management

### Stripe Integration

**Pattern**: Stripe Checkout (hosted redirect) + Customer Portal (self-service).
Webhooks are authoritative; success redirect is optimistic. Invite codes and
Stripe subscriptions coexist — user has Pro if either `trialEndsAt` or
`subscriptionExpiresAt` is in the future.

**Key Files**:

- `app/utils/stripe.server.ts` — Stripe client singleton, Checkout/Portal
  session creation, webhook handlers (`handleCheckoutCompleted`,
  `handleInvoicePaid`, `handleSubscriptionUpdated`,
  `handleSubscriptionDeleted`), price-to-tier mapping
- `app/routes/resources/stripe-webhook.tsx` — Webhook endpoint (POST only, no
  session auth, Stripe signature verification). Always returns 200 after valid
  signature to prevent retries
- `app/routes/resources/stripe-portal.tsx` — Customer Portal redirect
  (authenticated, POST only)

**Env vars** (all optional — app runs without Stripe in invite-code-only mode):
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_MONTHLY_PRICE_ID`,
`STRIPE_PRO_YEARLY_PRICE_ID`, `STRIPE_HOUSEHOLD_MONTHLY_PRICE_ID`,
`STRIPE_HOUSEHOLD_YEARLY_PRICE_ID`

### Ingredient Substitutions (AI Integration)

**Architecture**: Static database first, LLM fallback, cached aggressively.
Pro-tier feature — free users see no substitution indicators.

**Key Files**:

- `app/utils/ingredient-substitutions.ts` — Static database of ~50 common
  substitutions (zero API cost). Keyed by normalized name, substring matching.
  Also exports `stripDescriptors()` to clean quantity/size prefixes from
  ingredient names before lookup and for popover header display
- `app/utils/substitution-lookup.server.ts` — Orchestrates static → cache → LLM
  cascade. Cross-references substitutions against user's inventory
- `app/utils/substitution-llm.server.ts` — Direct HTTP fetch to Anthropic
  Messages API (Claude Haiku). Accepts optional `RecipeContext` (title +
  ingredients) for dish-appropriate suggestions. Returns null on any error
  (graceful degradation). Prompt enforces culinary-function matching
  (liquid→liquid, fat→fat), allergen flagging, and no non-food suggestions
- `app/routes/resources/substitutions.tsx` — POST-only resource route (Pro-gated
  via `requireProTier`). Accepts optional `recipeId`; when present, looks up
  recipe title + ingredients to pass as LLM context. Never called in loaders
- `app/components/ingredient-substitution.tsx` — `SubstitutionHint` Popover
  component wrapping missing-ingredient pills. Optional `recipeId` prop for
  recipe-context-aware LLM suggestions. Optional `onApply` callback makes
  substitution items clickable ("Use this") and auto-closes popover on select.
  Shows "AI suggestion" badge for LLM-sourced results and allergen/flavor
  disclaimer footer on all results. Uses `stripDescriptors()` for clean header
- `app/components/ui/popover.tsx` — Radix Popover primitive (shadcn pattern)

**Integration points**: Recipe detail ingredient list (`recipes/$recipeId.tsx`),
missing ingredient pills on recipe cards (`recipe-match-card.tsx`), "Almost
There" banner pills (`recipes/index.tsx`), "What Do I Need?" modal
(`recipes/$recipeId.tsx`). Recipe detail, recipe cards, and What Do I Need pass
`recipeId` for contextual LLM results; Almost There banner omits it (ingredients
are deduplicated across multiple recipes). Recipe detail passes `onApply` to
enable temporary ingredient swaps (client-side
`Map<ingredientId, AppliedSubstitution>` state in `RecipeDetail`); instruction
text preprocessed via `applySubstitutionsToText()` with word-boundary regex.
Other integration points (cards, banner, What Do I Need modal) omit `onApply` —
read-only.

**Env vars**: `ANTHROPIC_API_KEY` (optional — app works with static
substitutions only when unset). LLM results cached 30 days in SQLite via
`cachified()`. Negative results (no subs found) are also cached to prevent
repeated API calls. Cache key is per-ingredient when no recipe context, or
per-ingredient-per-recipe-title when context is provided. Ingredient list in
prompt capped at 30 items. 8-second timeout on API calls.

### Image Handling

**Storage**: S3-compatible storage (configured in `app/utils/storage.server.ts`)

**Upload Flow**:

1. Form submitted with `multipart/form-data`
2. `@mjackson/form-data-parser` extracts files
3. `uploadRecipeImage(userId, recipeId, file)` uploads to storage
4. Returns `objectKey` stored in `RecipeImage.objectKey`
5. `getImageUrl(objectKey, {h, w, fit})` generates optimized URLs

**Validation**: Max 3MB, JPEG/PNG/WebP only. Stream-level size enforcement.

### Form Handling Pattern

**Stack**: Conform (form state) + Zod (validation)

**Typical Pattern**:

```tsx
// In route action
export async function action({ request }: Route.ActionArgs) {
	const formData = await request.formData()
	const submission = parseWithZod(formData, { schema: RecipeSchema })

	if (submission.status !== 'success') {
		return { result: submission.reply() }
	}

	// Create/update database record
	await prisma.recipe.create({ data: submission.value })
	return redirect(`/recipes/${recipeId}`)
}

// In component
const [form, fields] = useForm({
	lastResult,
	onValidate({ formData }) {
		return parseWithZod(formData, { schema: RecipeSchema })
	},
})
```

**Dynamic Arrays**: Recipe form uses `fields.ingredients.getFieldList()` and
`fields.instructions.getFieldList()` to render dynamic ingredient/instruction
fields.

## React Guidelines

### Avoid useEffect

Per `.cursor/rules/avoid-use-effect.mdc`, prefer alternatives to `useEffect`:

- Use event handlers instead of effects for user interactions
- Use ref callbacks for DOM measurements
- Use `useSyncExternalStore` for external subscriptions
- Only use `useEffect` for true external system synchronization (e.g.,
  addEventListener with cleanup)

## Database Schema

### Core Models

**Recipe**: title, description, servings, prepTime, cookTime, isFavorite,
sourceUrl?, rawText?, notes?, userId, householdId? → Ingredient[],
Instruction[], RecipeImage?, MealPlanEntry[], CookingLog[],
MealPlanTemplateEntry[]

**Ingredient**: name, amount?, unit?, notes?, isHeading, order, recipeId

**Instruction**: content, order, recipeId

**RecipeImage**: altText, objectKey, recipeId (1-to-1)

**InventoryItem**: name, location (pantry|fridge|freezer), quantity?, unit?,
expiresAt?, lowStock, userId, householdId?

**MealPlan**: weekStart, userId, householdId? → MealPlanEntry[]

**MealPlanEntry**: date, mealType (breakfast|lunch|dinner|snack), servings?,
cooked, mealPlanId, recipeId

**ShoppingList**: name, userId, householdId? → ShoppingListItem[]

**ShoppingListItem**: name, quantity?, unit?, category?
(produce|dairy|meat|pantry|frozen|bakery|household|other), checked, source
(manual|generated|recipe|discover), listId

**CookingLog**: cookedAt, notes?, recipeId, userId (user-scoped, not household)

**Household**: name → HouseholdMember[], HouseholdInvite[], HouseholdEvent[],
Recipe[], InventoryItem[], MealPlan[], ShoppingList[], MealPlanTemplate[]

**HouseholdMember**: role (owner|member), notificationsLastSeenAt?, householdId,
userId

**HouseholdInvite**: token, expiresAt, usedAt?, householdId, createdById

**HouseholdEvent**: type, payload (JSON string), householdId, userId

**MealPlanTemplate**: name, userId, householdId? → MealPlanTemplateEntry[]

**MealPlanTemplateEntry**: dayOfWeek (0-6, Mon-Sun), mealType, servings?,
templateId, recipeId

**UsageEvent**: type, payload (JSON string), createdAt, userId, householdId?
(long-term analytics, separate from HouseholdEvent notification system)

**Subscription**: tier, stripeCustomerId?, stripeSubscriptionId?,
subscriptionExpiresAt?, trialEndsAt?, userId (1-to-1)

**InviteCode**: code (unique, "QM-XXXXXX"), type ("admin"|"earned"), grantsDays,
expiresAt?, redeemedAt?, createdById, redeemedById?

**User**: Epic Stack default model with roles, permissions, connections (OAuth),
sessions, passkeys

### Key Relationships

- Household has many: Recipe, InventoryItem, MealPlan, ShoppingList,
  MealPlanTemplate, HouseholdMember, HouseholdInvite, HouseholdEvent, UsageEvent
- User has many: Recipe, InventoryItem, MealPlan, ShoppingList, CookingLog,
  MealPlanTemplate, HouseholdMember, UsageEvent, InviteCode (created + redeemed)
- Recipe has many: Ingredient, Instruction, MealPlanEntry, CookingLog,
  MealPlanTemplateEntry; has one: RecipeImage
- MealPlan has many MealPlanEntry; ShoppingList has many ShoppingListItem
- All household-scoped models have both `userId` (attribution) and `householdId`
  (data scoping)

## Testing

### Unit Tests (Vitest)

- Test files: `app/**/*.test.ts(x)`
- Run: `npm test` (watch mode) or `npm run coverage`
- Uses jsdom for React component testing
- MSW mocks for HTTP requests

### E2E Tests (Playwright)

- Test files: `tests/e2e/*.test.ts`
- Run: `npm run test:e2e:dev` (UI mode) or `npm run test:e2e:run` (headless)
- Uses Chromium by default
- Per-test database isolation via `tests/setup/db-setup.ts`

### Test Gotchas

- Tests that call route actions directly must
  `vi.mock('#app/utils/household-events.server.ts')` to avoid SQLite concurrency
  issues from fire-and-forget event DB writes
- `skipDuplicates: true` on `createMany` doesn't work with SQLite — must
  check+create individually
- Tests require `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="yes"` env var for
  Prisma migrate reset

### Mocking

- External services mocked via MSW in `tests/mocks/`
- Enable in dev with `MOCKS=true` (default in `npm run dev`)
- Includes: GitHub OAuth, email service, storage API

## Import Aliases

```typescript
#app/*   → ./app/*       // Use #app/utils/db.server.ts
#tests/* → ./tests/*     // Use #tests/db-utils.ts
```

## Common Patterns

### Household-Scoped Route Guard (most routes)

```tsx
export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const recipes = await prisma.recipe.findMany({
		where: { householdId },
	})
	return { recipes }
}
```

### Household-Scoped Write (include both userId and householdId)

```tsx
await prisma.recipe.create({
	data: { ...submission.value, userId, householdId },
})
```

### Household Event Emission (fire-and-forget after mutations)

```tsx
void emitHouseholdEvent(householdId, userId, 'RECIPE_CREATED', {
	recipeId: recipe.id,
	recipeTitle: recipe.title,
})
```

### Form Action with Validation

```tsx
export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const formData = await request.formData()
	const submission = parseWithZod(formData, { schema: MySchema })

	if (submission.status !== 'success') {
		return { result: submission.reply() }
	}

	await prisma.myModel.create({
		data: { ...submission.value, userId, householdId },
	})
	return redirect('/success')
}
```

### Dynamic Form Arrays (Ingredients/Instructions)

```tsx
const [form, fields] = useForm({ ... })

{fields.ingredients.getFieldList().map((ingredient, index) => (
  <div key={ingredient.key}>
    <input {...getInputProps(ingredient.fields.name, { type: 'text' })} />
    <input {...getInputProps(ingredient.fields.amount, { type: 'text' })} />
    <button {...form.remove.getButtonProps({ name: fields.ingredients.name, index })}>
      Remove
    </button>
  </div>
))}

<button {...form.insert.getButtonProps({ name: fields.ingredients.name })}>
  Add Ingredient
</button>
```

## Deployment

Configured for **Fly.io** with `fly.toml`:

- Multi-region support with LiteFS (distributed SQLite)
- Health checks at `/resources/healthcheck`
- Automatic HTTPS
- Environment variables managed via Fly secrets
- LiteFS exec chain (`other/litefs.yml`): `prisma migrate deploy` →
  `run-seed-infrastructure.ts` (permissions, roles) → WAL pragma →
  `npm start`. Infrastructure seed runs on every deploy (idempotent upserts)

For self-hosting, standard Node.js app:

```bash
npm run build
npm run start
```

Requires: `DATABASE_URL` and `SESSION_SECRET` environment variables.
