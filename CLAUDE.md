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

**Routing conventions**: `app/routes/recipes/index.tsx` → `/recipes`,
`app/routes/recipes/$recipeId.tsx` → `/recipes/:recipeId`. `_` prefix on folder
or file name = layout route, no URL segment (e.g., `_auth/login.tsx` →
`/login`). `resources/` = API-only routes (no UI).

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
├── components/          # shadcn/ui primitives in ui/, feature components named by domain
├── utils/               # Server utilities (.server.ts) and shared helpers
├── styles/              # Global CSS and Tailwind config
└── root.tsx             # Root layout with theme, toaster, timer provider, SSE

prisma/
├── schema.prisma        # Database schema (source of truth)
├── migrations/          # Migration history
├── seed.ts              # Dev seed: infrastructure + test users (kody, kody2)
├── seed-infrastructure.ts   # Permissions, roles (runs in prod via litefs)
└── run-seed-infrastructure.ts  # Standalone runner for litefs exec chain

tests/
├── e2e/                 # Playwright end-to-end tests
├── mocks/               # MSW mock handlers for external services
└── setup/               # Vitest configuration and global setup
```

**Icon pipeline**: Drop SVGs in `other/svg-icons/` → auto-generated sprite via
`vite-plugin-icons-spritesheet` → use `<Icon name="..." />` component.

## Core Systems

### Recipe System

**Key Files**: `routes/recipes/index.tsx` (list + search + matching),
`routes/recipes/new.tsx` (create, URL import, bulk text/file import),
`routes/recipes/$recipeId.tsx` (view + cooking mode, delegates to `recipe-*.tsx`
sub-components), `routes/recipes/$recipeId.edit.tsx`,
`components/recipe-form.tsx` (shared form with `@dnd-kit/sortable` ingredients),
`utils/recipe-validation.ts`, `utils/bulk-recipe-parser.ts`,
`utils/recipe-detail.ts` (shared types + pure helpers).

**Import**: URL import (JSON-LD scraping with text fallback via
`parseRecipeText()`), bulk paste (`---` separators), file upload (.md/.txt).
Duplicate detection by title. Sub-section headers become heading rows
(`isHeading: true`).

**Ingredient Headings**: Ingredients with `isHeading: true` are section
dividers. They have only a `name`, no amount/unit/notes. **Always skip heading
rows** when iterating ingredients for matching, shopping list, subtraction, or
JSON-LD.

### Inventory System

**Key Files**: `routes/inventory/` (CRUD), `utils/inventory-subtract.server.ts`
(post-cooking subtraction with skip tracking),
`routes/resources/inventory-remove.tsx` (POST-only delete for post-cook review).

**Normalization Pipeline** (`recipe-matching.server.ts`): ~40 modifier
strippers, ~25 synonym groups, pluralization, compound ingredient protection
(green onion, brown sugar preserved), non-equivalent exclusions (rice ≠ rice
vinegar). Powers matching, shopping consolidation, and inventory subtraction.

### Recipe Matching

`app/utils/recipe-matching.server.ts` — Matches inventory against recipe
ingredients with 4-level fuzzy matching: exact (post-normalization) → synonym
lookup → core word → multi-word containment. Calculates match percentage per
recipe. Always-on when user has inventory items.

### Meal Planning & Shopping

**Key Files**: `routes/plan/index.tsx` (weekly calendar, 5 action intents),
`routes/resources/meal-plan-copy-week.tsx`,
`routes/resources/meal-plan-templates.tsx`, `routes/shopping.tsx` (standalone
shopping list + generate + check-off → inventory),
`routes/resources/shopping-to-inventory.tsx`, `utils/shopping-list.server.ts`,
`utils/ingredient-overlap.server.ts`, `utils/unit-conversion.ts`.

### Household Sharing

All data is scoped to a **household**, not a user. Every user belongs to exactly
one household (auto-created on signup).

**Key Files**: `utils/household.server.ts` (`requireUserWithHousehold(request)`,
invite/accept/leave, data transfer), `utils/household-events.server.ts`
(fire-and-forget event emission), `utils/household-event-messages.ts` (event
formatting + two-tier priority), `routes/resources/household-events.tsx` (SSE),
`routes/resources/notifications.tsx`, `routes/settings/profile/household.tsx`,
`routes/household/join.tsx`.

**Data ownership**: Write queries include both `userId` (attribution) and
`householdId` (scoping). Read queries use `where: { householdId }`. CookingLog
stays user-scoped.

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

**Admin Role**: Created by infrastructure seed
(`prisma/seed-infrastructure.ts`), runs on every deploy. `kody` gets admin in
dev. In production, promote via Fly SSH:

```bash
fly ssh console -C "sqlite3 \$DATABASE_PATH \"
  INSERT INTO _RoleToUser (A, B)
  SELECT Role.id, User.id
  FROM Role, User
  WHERE Role.name = 'admin' AND User.username = 'YOUR_USERNAME';
\""
```

**New User Flow**: Signup creates user + household + membership atomically.
Empty recipe library shows `getting-started-checklist.tsx`. Empty inventory
shows `pantry-staples-onboarding.tsx`.

Admin routes: `/admin/cache`, `/admin/subscriptions`.

### Invite Codes & Stripe

**Invite codes**: `utils/invite-codes.server.ts` (generation `QM-XXXXXX`,
redemption, starter code granting), `utils/invite-code-status.ts` (shared Zod
schema + UI helper), `routes/resources/redeem-invite-code.tsx`. Pro access via
invite codes, Stripe subscription, or admin override. Redemption grants 2
starter codes.

**Stripe**: `utils/stripe.server.ts` (Checkout/Portal/webhooks),
`routes/resources/stripe-webhook.tsx` (signature verification, always returns
200), `routes/resources/stripe-portal.tsx`. Webhooks are authoritative; success
redirect is optimistic. Env vars (all optional): `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_YEARLY_PRICE_ID`.

### Ingredient Substitutions (AI)

Static database first (`utils/ingredient-substitutions.ts`, ~50 entries), LLM
fallback (`utils/substitution-llm.server.ts`, Claude Haiku), cached 30 days.
Orchestrated by `utils/substitution-lookup.server.ts`. POST resource route at
`routes/resources/substitutions.tsx` (Pro-gated). UI: `SubstitutionHint` popover
in `components/ingredient-substitution.tsx`. Env: `ANTHROPIC_API_KEY` (optional
— app works with static substitutions only when unset).

### Image Handling

**Storage**: S3-compatible (configured in `app/utils/storage.server.ts`)

**Upload Flow**: `multipart/form-data` → `@mjackson/form-data-parser` →
`uploadRecipeImage()` → `objectKey` in `RecipeImage` → `getImageUrl()` for
optimized URLs. Max 3MB, JPEG/PNG/WebP only.

## React Guidelines

### Avoid useEffect

Per `.cursor/rules/avoid-use-effect.mdc`, prefer alternatives to `useEffect`:

- Use event handlers instead of effects for user interactions
- Use ref callbacks for DOM measurements
- Use `useSyncExternalStore` for external subscriptions
- Only use `useEffect` for true external system synchronization (e.g.,
  addEventListener with cleanup)

## Database Schema

Source of truth: `prisma/schema.prisma`. Key patterns:

- **Household scoping**: All shared models have `userId` (attribution) +
  `householdId` (data scoping). Reads use `where: { householdId }`.
- **CookingLog** is user-scoped, not household-scoped
- **Ingredient `isHeading`**: Boolean flag for section dividers — skip when
  iterating for matching/shopping/subtraction/JSON-LD
- **Key relationships**: Household → Recipe, InventoryItem, MealPlan,
  ShoppingList, MealPlanTemplate. Recipe → Ingredient[], Instruction[],
  RecipeImage?, MealPlanEntry[], CookingLog[]

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

## Gotchas

- **Adding Recipe fields** → also update test `makeRecipe` helpers in
  `recipe-matching.server.test.ts` and `shopping-list.server.test.ts`
- **Adding `HouseholdEventType` values** → also update `formatEventMessage` in
  `household-event-messages.ts` + its test, and classify in `NOTIFY_EVENT_TYPES`
- **Iterating `recipe.ingredients`** → always
  `if (ingredient.isHeading) continue`
- **Synonym keys** must use post-normalization names (e.g., "sugar" not
  "powdered sugar" since modifiers are stripped)
- **`emitHouseholdEvent()`** is fire-and-forget (`void`) — never await it
- **Adding household-scoped models** → also update `acceptInvite` sole-member
  data transfer in `household.server.ts`
- **Meal template dates**: `z.coerce.date()` creates UTC midnight vs local
  midnight — normalize with `new Date(serializeDate(addDays(...)))` for
  consistent storage
- **Shopping list `guessCategory()`**: household check must come BEFORE pantry —
  "toilet" contains "oil"

## Deployment

Configured for **Fly.io** with `fly.toml`:

- Multi-region support with LiteFS (distributed SQLite)
- Health checks at `/resources/healthcheck`
- Automatic HTTPS
- Environment variables managed via Fly secrets
- LiteFS exec chain (`other/litefs.yml`): `prisma migrate deploy` →
  `run-seed-infrastructure.ts` (permissions, roles) → WAL pragma → `npm start`.
  Infrastructure seed runs on every deploy (idempotent upserts)

For self-hosting, standard Node.js app:

```bash
npm run build
npm run start
```

Requires: `DATABASE_URL` and `SESSION_SECRET` environment variables.

## Response Style

- Don't narrate tool calls ("Let me read..." / "Now I'll edit..."). Just do it.
- Keep explanations proportional to complexity. Simple changes need one
  sentence.
- Don't echo back file contents just read — the user can see them.
- Markdown tables: use minimum separator (`|-|-|`). Never use box-drawing
  characters (┌─│└ etc.).

## Subagent Discipline

- Under ~50k context: prefer inline work for tasks under ~5 tool calls.
- Over ~50k context: prefer subagents for self-contained tasks — the per-call
  token tax adds up.
- Include output constraints for subagents: "Final response under 2000 chars.
  List outcomes, not process."
