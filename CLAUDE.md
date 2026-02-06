# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

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
npx prisma db seed       # Seed database (permissions, tags, roles, admin user)
npx prisma generate      # Regenerate Prisma client after schema changes
```

### Development Scripts

```bash
npm run setup            # Full setup: build, migrate, generate, seed, install Playwright
```

## Architecture Overview

Quartermaster is a recipe management app built on the **Epic Stack** (React
Router v7 / Remix). It uses a **file-based routing system** where each route
file can export `loader` (data fetching), `action` (mutations), and a React
component.

### Tech Stack

- **Framework**: React Router v7 with React 19
- **Database**: SQLite with Prisma ORM
- **Styling**: Tailwind CSS v4 + shadcn/ui components
- **Forms**: Conform + Zod for validation
- **Auth**: Session-based with Epic Stack auth system
- **Testing**: Vitest (unit) + Playwright (e2e)
- **Deployment**: Fly.io-ready with LiteFS for multi-region SQLite

### Directory Structure

```
app/
├── routes/              # File-based routing (auto-routed with react-router-auto-routes)
│   ├── recipes/         # Recipe CRUD, search, discovery
│   ├── inventory/       # Inventory tracking (pantry/fridge/freezer)
│   ├── discover/        # Recipe matching with inventory
│   ├── settings/        # User profile, password, 2FA
│   └── _auth/           # Login, signup, verification
├── components/          # Shared React components
│   ├── ui/              # shadcn/ui primitives
│   ├── recipe-*.tsx     # Recipe-specific components
│   ├── inventory-*.tsx  # Inventory-specific components
│   └── forms.tsx        # Form field wrappers
├── utils/               # Utilities and server-side logic
│   ├── *.server.ts      # Server-only code (auto-excluded from client)
│   ├── *.client.tsx     # Client-only code (auto-excluded from server)
│   ├── db.server.ts     # Prisma client singleton
│   ├── auth.server.ts   # Auth helpers (getUserId, requireUserId, login, signup)
│   └── recipe-matching.server.ts  # Core ingredient matching algorithm
├── styles/              # Global CSS and Tailwind config
└── root.tsx             # Root layout with theme provider, toaster, etc.

prisma/
├── schema.prisma        # Database schema (Recipe, InventoryItem, User, etc.)
├── migrations/          # Migration history
└── seed.ts              # Main seed file (permissions, tags, roles, admin user)

tests/
├── e2e/                 # Playwright end-to-end tests
├── mocks/               # MSW mock handlers for external services
└── setup/               # Vitest configuration and global setup
```

## Core Systems

### Recipe System

**Data Model**: Recipe → Ingredients[] + Instructions[] + Tags[] + RecipeImage
(optional)

**Key Files**:

- `app/routes/recipes/index.tsx` - Recipe list with search and tag filtering
- `app/routes/recipes/new.tsx` - Create recipe form
- `app/routes/recipes/$recipeId.tsx` - View recipe details
- `app/routes/recipes/$recipeId.edit.tsx` - Edit recipe form
- `app/components/recipe-form.tsx` - Shared form component with dynamic
  ingredient/instruction fields
- `app/utils/recipe-validation.ts` - Zod schemas for recipe validation
- `app/utils/storage.server.ts` - Image upload handling (S3-compatible)

**Search**: Full-text search across recipe title, description, and ingredient
names. Uses URL search params (`?search=...&tags=...`) for bookmarkable
searches.

**Tags**: Predefined tags in three categories: cuisine (Italian, Mexican, Asian,
etc.), meal-type (breakfast, lunch, dinner, etc.), and dietary (vegetarian,
vegan, gluten-free, etc.).

### Inventory System

**Data Model**: InventoryItem with free-text name, location
(pantry/fridge/freezer), optional quantity/unit/expiresAt/lowStock

**Key Files**:

- `app/routes/inventory/index.tsx` - Inventory list with location tabs
- `app/routes/inventory/new.tsx` - Add inventory item
- `app/routes/inventory/$id.edit.tsx` - Edit/delete inventory item
- `app/components/inventory-*.tsx` - UI components for inventory cards,
  quick-add, location tabs
- `app/utils/inventory-validation.ts` - Zod schemas for inventory items

**Features**: Location-based filtering, low-stock flagging, expiration tracking,
quick-add shortcuts.

### Recipe Matching Algorithm

**Location**: `app/utils/recipe-matching.server.ts`

This is the core intelligence of the discovery feature. It matches user's
inventory against recipe ingredients using:

1. **Ingredient Normalization**: Lowercases, removes modifiers ("fresh",
   "chopped"), handles pluralization
2. **Synonym Database**: Maps equivalent ingredients (cilantro ↔ coriander,
   scallion ↔ green onion)
3. **Multi-level Matching**:
   - Exact match after normalization
   - Synonym lookup (bidirectional)
   - Core word match (first significant word)
   - Multi-word containment (all words present)
4. **Match Scoring**: Calculates percentage of ingredients user has for each
   recipe
5. **Sorting**: By match percentage (desc), then by total ingredients (asc)

**Usage**: Called in `/discover` loader to show recipes sorted by "makeable"
percentage.

### Authentication & Authorization

**Pattern**: Session-based authentication with httpOnly cookies.

**Key Functions** (in `app/utils/auth.server.ts`):

- `getUserId(request)` → userId | null (checks session)
- `requireUserId(request)` → userId | throws redirect to /login (route guard)
- `login({username, password})` → creates session
- `signup({email, username, password})` → creates user + session
- `logout({request, redirectTo})` → destroys session
- `requireUserWithPermission(request, permission)` → enforces RBAC

**New User Flow**: New users start with an empty library. The inventory page
shows a recommended pantry staples onboarding checklist when the inventory is
empty, letting users select common items they have on hand.

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

### Image Handling

**Storage**: S3-compatible storage (configured in `app/utils/storage.server.ts`)

**Upload Flow**:

1. Form submitted with `multipart/form-data`
2. `@mjackson/form-data-parser` extracts files
3. `uploadRecipeImage(userId, recipeId, file)` uploads to storage
4. Returns `objectKey` stored in `RecipeImage.objectKey`
5. `getImageUrl(objectKey, {h, w, fit})` generates optimized URLs

**Validation**: Max 3MB, JPEG/PNG/WebP only.

## React Guidelines

### Avoid useEffect

Per `.cursor/rules/avoid-use-effect.mdc`, prefer alternatives to `useEffect`:

- Use event handlers instead of effects for user interactions
- Use ref callbacks for DOM measurements
- Use `useSyncExternalStore` for external subscriptions
- Only use `useEffect` for true external system synchronization (e.g.,
  addEventListener with cleanup)

**Good**:

```tsx
function handleSubmit() {
	saveData()
	showNotification('Saved!')
}
```

**Avoid**:

```tsx
useEffect(() => {
	if (savedSuccessfully) {
		showNotification('Saved!')
	}
}, [savedSuccessfully])
```

## Database Schema

### Core Models

**Recipe**: title, description, servings, prepTime, cookTime, userId →
Ingredient[], Instruction[], Tag[], RecipeImage?

**Ingredient**: name, amount, unit, notes, order, recipeId

**Instruction**: content, order, recipeId

**Tag**: name, category (cuisine|meal-type|dietary) → Recipe[] (many-to-many)

**RecipeImage**: altText, objectKey, recipeId (1-to-1)

**InventoryItem**: name, location (pantry|fridge|freezer), quantity?, unit?,
expiresAt?, lowStock, userId

**User**: Epic Stack default user model with roles, permissions, connections
(OAuth), sessions

### Relationships

- User has many Recipes (cascade delete)
- User has many InventoryItems (cascade delete)
- Recipe has many Ingredients (cascade delete)
- Recipe has many Instructions (cascade delete)
- Recipe has many Tags (many-to-many)
- Recipe has one RecipeImage (cascade delete)

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

### Route Guard

```tsx
export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request) // Throws redirect if not logged in
	// ... fetch user-specific data
}
```

### Form Action with Validation

```tsx
export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const submission = parseWithZod(formData, { schema: MySchema })

	if (submission.status !== 'success') {
		return { result: submission.reply() }
	}

	await prisma.myModel.create({ data: { ...submission.value, userId } })
	return redirect('/success')
}
```

### Search with URL Params

```tsx
export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL(request.url)
	const search = url.searchParams.get('search') ?? ''
	const tags = url.searchParams.getAll('tags')

	const recipes = await prisma.recipe.findMany({
		where: {
			AND: [
				search
					? {
							OR: [
								{ title: { contains: search } },
								{ ingredients: { some: { name: { contains: search } } } },
							],
						}
					: {},
				tags.length > 0 ? { tags: { some: { id: { in: tags } } } } : {},
			],
		},
	})

	return { recipes }
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

For self-hosting, standard Node.js app:

```bash
npm run build
npm run start
```

Requires: `DATABASE_URL` and `SESSION_SECRET` environment variables.
