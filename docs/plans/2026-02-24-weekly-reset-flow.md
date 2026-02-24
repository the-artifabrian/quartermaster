# Weekly Reset Flow — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Add a guided "Plan Your Week" page at `/plan/new-week` with curated
recipe suggestions (expiring inventory, favorites, high-match) and a weekend
nudge banner on `/plan`.

**Architecture:** New route `app/routes/plan/new-week.tsx` with a loader that
aggregates existing data (inventory, recipes, cooking logs, match percentages)
into three suggestion categories. UI is a single scrollable page: suggestion
cards in horizontal-scroll rows → day/meal picker popover → mini week calendar
→ finish actions. Mutations reuse existing `/plan` assign/remove actions via
`useFetcher`. No new database models.

**Tech Stack:** React Router (Remix), Prisma, Tailwind CSS, existing
`recipe-matching.server.ts`, existing `date.ts` utilities, `useFetcher` for
mutations.

**Design doc:** `docs/plans/2026-02-24-weekly-reset-flow-design.md`

---

## Task 1: Suggestion Engine (Server Utility)

Pure server function that computes the three suggestion categories. This is the
core logic — testable without UI.

**Files:**
- Create: `app/utils/week-suggestions.server.ts`
- Create: `app/utils/week-suggestions.server.test.ts`

### Step 1: Write the failing test for `getUseTheseUpSuggestions`

This function takes recipes with match data + expiring inventory items and
returns recipes that match expiring ingredients, sorted by soonest expiry.

```typescript
// app/utils/week-suggestions.server.test.ts
import { describe, expect, test } from 'vitest'
import {
	getUseTheseUpSuggestions,
	getFavoriteSuggestions,
	getReadyToCookSuggestions,
} from './week-suggestions.server.ts'

function makeIngredient(name: string) {
	return {
		id: `ing-${name}`,
		name,
		amount: null,
		unit: null,
		notes: null,
		isHeading: false,
		order: 0,
		recipeId: 'r1',
	}
}

function makeRecipe(
	id: string,
	title: string,
	ingredients: string[],
	extra?: { isFavorite?: boolean },
) {
	return {
		id,
		title,
		description: null,
		prepTime: null,
		cookTime: null,
		servings: 4,
		isFavorite: extra?.isFavorite ?? false,
		image: null,
		ingredients: ingredients.map((name) => makeIngredient(name)),
	}
}

const now = new Date('2026-03-01T12:00:00Z')

describe('getUseTheseUpSuggestions', () => {
	test('returns recipes matching expiring inventory, sorted by soonest', () => {
		const recipes = [
			makeRecipe('r1', 'Salmon Bowl', ['salmon', 'rice', 'avocado']),
			makeRecipe('r2', 'Chicken Tikka', ['chicken', 'yogurt', 'spices']),
			makeRecipe('r3', 'Avocado Toast', ['avocado', 'bread']),
		]
		const expiringItems = [
			{ name: 'avocado', expiresAt: new Date('2026-03-03T00:00:00Z') }, // 2d
			{ name: 'salmon', expiresAt: new Date('2026-03-04T00:00:00Z') }, // 3d
		]

		const result = getUseTheseUpSuggestions(recipes, expiringItems, now)

		// Avocado expires soonest — recipes using it should come first
		expect(result[0]!.recipe.id).toBe('r3') // avocado only (2d)
		expect(result[0]!.expiringIngredient).toBe('avocado')
		expect(result[0]!.daysLeft).toBe(2)
		// Then salmon (3d), but r1 also has avocado (2d) so it sorts by soonest match
		expect(result[1]!.recipe.id).toBe('r1') // salmon + avocado
		expect(result[1]!.daysLeft).toBe(2) // soonest = avocado at 2d
		expect(result).toHaveLength(2) // chicken tikka doesn't match
	})

	test('caps at 6 results', () => {
		const recipes = Array.from({ length: 10 }, (_, i) =>
			makeRecipe(`r${i}`, `Recipe ${i}`, ['tomato']),
		)
		const expiringItems = [
			{ name: 'tomato', expiresAt: new Date('2026-03-02T00:00:00Z') },
		]

		const result = getUseTheseUpSuggestions(recipes, expiringItems, now)
		expect(result).toHaveLength(6)
	})

	test('returns empty array when no expiring items', () => {
		const recipes = [makeRecipe('r1', 'Salmon Bowl', ['salmon'])]
		const result = getUseTheseUpSuggestions(recipes, [], now)
		expect(result).toHaveLength(0)
	})

	test('skips heading ingredients', () => {
		const recipe = makeRecipe('r1', 'Salmon Bowl', ['salmon'])
		recipe.ingredients.push({
			...makeIngredient('For the sauce'),
			isHeading: true,
		})
		const expiringItems = [
			{
				name: 'For the sauce',
				expiresAt: new Date('2026-03-02T00:00:00Z'),
			},
		]
		const result = getUseTheseUpSuggestions([recipe], expiringItems, now)
		// Should not match the heading
		expect(result).toHaveLength(0)
	})
})
```

### Step 2: Run test to verify it fails

Run: `npx vitest run app/utils/week-suggestions.server.test.ts`
Expected: FAIL — module not found

### Step 3: Implement `getUseTheseUpSuggestions`

```typescript
// app/utils/week-suggestions.server.ts
import {
	normalizeIngredientName,
	getCanonicalIngredientName,
	type MatchableRecipe,
} from './recipe-matching.server.ts'

type ExpiringItem = {
	name: string
	expiresAt: Date
}

export type UseTheseUpSuggestion = {
	recipe: MatchableRecipe
	expiringIngredient: string
	daysLeft: number
}

export type FavoriteSuggestion = {
	recipe: MatchableRecipe
	daysSinceLastCook: number | null
}

export type ReadyToCookSuggestion = {
	recipe: MatchableRecipe
	matchedCount: number
	totalCount: number
	matchPercentage: number
}

const MS_PER_DAY = 1000 * 60 * 60 * 24

/**
 * Recipes that use ingredients expiring within 7 days.
 * Sorted by soonest expiry of matched ingredient. Cap at 6.
 */
export function getUseTheseUpSuggestions(
	recipes: MatchableRecipe[],
	expiringItems: ExpiringItem[],
	now: Date = new Date(),
): UseTheseUpSuggestion[] {
	if (expiringItems.length === 0) return []

	// Build lookup: canonical name → soonest expiry
	const expiryByName = new Map<string, { name: string; expiresAt: Date }>()
	for (const item of expiringItems) {
		const canonical = getCanonicalIngredientName(item.name)
		const existing = expiryByName.get(canonical)
		if (!existing || item.expiresAt < existing.expiresAt) {
			expiryByName.set(canonical, item)
		}
	}

	const results: UseTheseUpSuggestion[] = []

	for (const recipe of recipes) {
		let soonestExpiry: Date | null = null
		let soonestName: string | null = null

		for (const ing of recipe.ingredients) {
			if (ing.isHeading) continue
			const canonical = getCanonicalIngredientName(ing.name)
			const expiring = expiryByName.get(canonical)
			if (expiring && (!soonestExpiry || expiring.expiresAt < soonestExpiry)) {
				soonestExpiry = expiring.expiresAt
				soonestName = expiring.name
			}
		}

		if (soonestExpiry && soonestName) {
			results.push({
				recipe,
				expiringIngredient: soonestName,
				daysLeft: Math.max(
					0,
					Math.ceil((soonestExpiry.getTime() - now.getTime()) / MS_PER_DAY),
				),
			})
		}
	}

	results.sort((a, b) => a.daysLeft - b.daysLeft)
	return results.slice(0, 6)
}
```

### Step 4: Run test to verify it passes

Run: `npx vitest run app/utils/week-suggestions.server.test.ts`
Expected: All `getUseTheseUpSuggestions` tests PASS

### Step 5: Write the failing test for `getFavoriteSuggestions`

Add to the same test file:

```typescript
describe('getFavoriteSuggestions', () => {
	test('returns favorites sorted by least-recently-cooked', () => {
		const recipes = [
			makeRecipe('r1', 'Tikka', ['chicken'], { isFavorite: true }),
			makeRecipe('r2', 'Pasta', ['pasta'], { isFavorite: true }),
			makeRecipe('r3', 'Salad', ['lettuce'], { isFavorite: false }),
			makeRecipe('r4', 'Risotto', ['rice'], { isFavorite: true }),
		]
		const cookDates: Record<string, Date> = {
			r1: new Date('2026-02-10T00:00:00Z'), // 19 days ago
			r2: new Date('2026-02-20T00:00:00Z'), // 9 days ago
			// r4 never cooked
		}

		const result = getFavoriteSuggestions(recipes, cookDates, [], now)

		expect(result).toHaveLength(3) // only favorites
		expect(result[0]!.recipe.id).toBe('r4') // never cooked → first
		expect(result[0]!.daysSinceLastCook).toBeNull()
		expect(result[1]!.recipe.id).toBe('r1') // 19 days ago
		expect(result[2]!.recipe.id).toBe('r2') // 9 days ago
	})

	test('excludes recipes cooked within last 7 days', () => {
		const recipes = [
			makeRecipe('r1', 'Tikka', ['chicken'], { isFavorite: true }),
			makeRecipe('r2', 'Pasta', ['pasta'], { isFavorite: true }),
		]
		const cookDates: Record<string, Date> = {
			r1: new Date('2026-02-25T00:00:00Z'), // 4 days ago
		}

		const result = getFavoriteSuggestions(recipes, cookDates, [], now)

		expect(result).toHaveLength(1)
		expect(result[0]!.recipe.id).toBe('r2')
	})

	test('excludes recipe IDs in the exclude list', () => {
		const recipes = [
			makeRecipe('r1', 'Tikka', ['chicken'], { isFavorite: true }),
			makeRecipe('r2', 'Pasta', ['pasta'], { isFavorite: true }),
		]
		const result = getFavoriteSuggestions(recipes, {}, ['r1'], now)

		expect(result).toHaveLength(1)
		expect(result[0]!.recipe.id).toBe('r2')
	})

	test('caps at 6 results', () => {
		const recipes = Array.from({ length: 10 }, (_, i) =>
			makeRecipe(`r${i}`, `Recipe ${i}`, ['a'], { isFavorite: true }),
		)
		const result = getFavoriteSuggestions(recipes, {}, [], now)
		expect(result).toHaveLength(6)
	})
})
```

### Step 6: Run test to verify it fails

Run: `npx vitest run app/utils/week-suggestions.server.test.ts`
Expected: FAIL — `getFavoriteSuggestions` not exported

### Step 7: Implement `getFavoriteSuggestions`

Add to `app/utils/week-suggestions.server.ts`:

```typescript
/**
 * Favorite recipes sorted by least-recently-cooked.
 * Excludes recipes cooked in the last 7 days. Cap at 6.
 */
export function getFavoriteSuggestions(
	recipes: MatchableRecipe[],
	lastCookDates: Record<string, Date>,
	excludeIds: string[],
	now: Date = new Date(),
): FavoriteSuggestion[] {
	const excludeSet = new Set(excludeIds)
	const sevenDaysAgo = new Date(now.getTime() - 7 * MS_PER_DAY)

	return recipes
		.filter((r) => {
			if (!r.isFavorite) return false
			if (excludeSet.has(r.id)) return false
			const lastCooked = lastCookDates[r.id]
			if (lastCooked && lastCooked > sevenDaysAgo) return false
			return true
		})
		.map((recipe) => {
			const lastCooked = lastCookDates[recipe.id]
			return {
				recipe,
				daysSinceLastCook: lastCooked
					? Math.floor((now.getTime() - lastCooked.getTime()) / MS_PER_DAY)
					: null,
			}
		})
		.sort((a, b) => {
			// Never cooked comes first (null → Infinity for sorting)
			const aDays = a.daysSinceLastCook ?? Infinity
			const bDays = b.daysSinceLastCook ?? Infinity
			return bDays - aDays // higher = longer ago = first
		})
		.slice(0, 6)
}
```

### Step 8: Run test to verify it passes

Run: `npx vitest run app/utils/week-suggestions.server.test.ts`
Expected: All `getFavoriteSuggestions` tests PASS

### Step 9: Write the failing test for `getReadyToCookSuggestions`

Add to the same test file:

```typescript
describe('getReadyToCookSuggestions', () => {
	test('returns recipes sorted by match percentage, excluding given IDs', () => {
		const matchResults = [
			{ recipeId: 'r1', matchPercentage: 90, matchedCount: 9, totalCount: 10 },
			{ recipeId: 'r2', matchPercentage: 70, matchedCount: 7, totalCount: 10 },
			{ recipeId: 'r3', matchPercentage: 50, matchedCount: 5, totalCount: 10 },
		]
		const recipesById = new Map([
			['r1', makeRecipe('r1', 'Recipe 1', ['a'])],
			['r2', makeRecipe('r2', 'Recipe 2', ['a'])],
			['r3', makeRecipe('r3', 'Recipe 3', ['a'])],
		])

		const result = getReadyToCookSuggestions(matchResults, recipesById, ['r1'])

		expect(result).toHaveLength(2)
		expect(result[0]!.recipe.id).toBe('r2')
		expect(result[0]!.matchPercentage).toBe(70)
		expect(result[1]!.recipe.id).toBe('r3')
	})

	test('excludes recipes with 0% match', () => {
		const matchResults = [
			{ recipeId: 'r1', matchPercentage: 80, matchedCount: 8, totalCount: 10 },
			{ recipeId: 'r2', matchPercentage: 0, matchedCount: 0, totalCount: 5 },
		]
		const recipesById = new Map([
			['r1', makeRecipe('r1', 'Recipe 1', ['a'])],
			['r2', makeRecipe('r2', 'Recipe 2', ['a'])],
		])

		const result = getReadyToCookSuggestions(matchResults, recipesById, [])
		expect(result).toHaveLength(1)
		expect(result[0]!.recipe.id).toBe('r1')
	})

	test('caps at 6 results', () => {
		const matchResults = Array.from({ length: 10 }, (_, i) => ({
			recipeId: `r${i}`,
			matchPercentage: 90 - i,
			matchedCount: 9 - i,
			totalCount: 10,
		}))
		const recipesById = new Map(
			matchResults.map((m) => [
				m.recipeId,
				makeRecipe(m.recipeId, `Recipe ${m.recipeId}`, ['a']),
			]),
		)

		const result = getReadyToCookSuggestions(matchResults, recipesById, [])
		expect(result).toHaveLength(6)
	})
})
```

### Step 10: Run test to verify it fails

Run: `npx vitest run app/utils/week-suggestions.server.test.ts`
Expected: FAIL — `getReadyToCookSuggestions` not exported

### Step 11: Implement `getReadyToCookSuggestions`

Add to `app/utils/week-suggestions.server.ts`:

```typescript
type MatchResult = {
	recipeId: string
	matchPercentage: number
	matchedCount: number
	totalCount: number
}

/**
 * Recipes with highest inventory match, excluding already-suggested recipes.
 * Sorted by match % descending. Excludes 0% matches. Cap at 6.
 */
export function getReadyToCookSuggestions(
	matchResults: MatchResult[],
	recipesById: Map<string, MatchableRecipe>,
	excludeIds: string[],
): ReadyToCookSuggestion[] {
	const excludeSet = new Set(excludeIds)

	return matchResults
		.filter((m) => m.matchPercentage > 0 && !excludeSet.has(m.recipeId))
		.sort((a, b) => b.matchPercentage - a.matchPercentage)
		.slice(0, 6)
		.map((m) => ({
			recipe: recipesById.get(m.recipeId)!,
			matchedCount: m.matchedCount,
			totalCount: m.totalCount,
			matchPercentage: m.matchPercentage,
		}))
		.filter((s) => s.recipe) // guard against missing recipe
}
```

### Step 12: Run all tests to verify they pass

Run: `npx vitest run app/utils/week-suggestions.server.test.ts`
Expected: All tests PASS

### Step 13: Commit

```bash
git add app/utils/week-suggestions.server.ts app/utils/week-suggestions.server.test.ts
git commit -m "feat: add week suggestion engine (use-up, favorites, ready-to-cook)"
```

---

## Task 2: Route Loader (`/plan/new-week`)

Wire up the loader that aggregates data for the suggestions page.

**Files:**
- Create: `app/routes/plan/new-week.tsx` (loader + placeholder component)
- Reference: `app/utils/week-suggestions.server.ts` (Task 1)
- Reference: `app/utils/recipe-matching.server.ts` (existing)
- Reference: `app/utils/subscription.server.ts` (`requireProTier`)

### Step 1: Create route with loader

```typescript
// app/routes/plan/new-week.tsx
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	formatWeekRange,
	getCurrentWeekStart,
	getNextWeek,
	getWeekDays,
	getWeekStart,
	parseDate,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	matchRecipesWithInventory,
	type MatchableRecipe,
} from '#app/utils/recipe-matching.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import {
	getUseTheseUpSuggestions,
	getFavoriteSuggestions,
	getReadyToCookSuggestions,
} from '#app/utils/week-suggestions.server.ts'
import { type Route } from './+types/new-week.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Plan Your Week | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireProTier(request)
	const url = new URL(request.url)
	const weekParam = url.searchParams.get('week')

	// Default to next week's Monday
	const defaultWeek = getNextWeek(getCurrentWeekStart())
	const weekStart = weekParam
		? getWeekStart(parseDate(weekParam))
		: defaultWeek

	// Parallel queries
	const [allRecipes, inventoryItems, cookingLogs, mealPlan] =
		await Promise.all([
			// All recipes with ingredients (needed for matching)
			prisma.recipe.findMany({
				where: { householdId },
				include: {
					ingredients: true,
					image: { select: { objectKey: true } },
				},
			}),
			// Inventory for matching + expiry detection
			prisma.inventoryItem.findMany({
				where: { householdId },
			}),
			// Last cook date per recipe (most recent log per recipe)
			prisma.cookingLog.findMany({
				where: { userId },
				orderBy: { cookedAt: 'desc' },
				select: { recipeId: true, cookedAt: true },
			}),
			// Existing entries for this week's calendar
			prisma.mealPlan.findFirst({
				where: { householdId, weekStart },
				include: {
					entries: {
						include: {
							recipe: {
								select: {
									id: true,
									title: true,
									image: { select: { objectKey: true } },
								},
							},
						},
					},
				},
			}),
		])

	const now = new Date()
	const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

	// Expiring inventory items (next 7 days)
	const expiringItems = inventoryItems
		.filter(
			(item) =>
				item.expiresAt &&
				new Date(item.expiresAt) >= now &&
				new Date(item.expiresAt) <= sevenDaysFromNow,
		)
		.map((item) => ({
			name: item.name,
			expiresAt: new Date(item.expiresAt!),
		}))

	// Last cook date per recipe (deduplicate — first entry is most recent)
	const lastCookDates: Record<string, Date> = {}
	for (const log of cookingLogs) {
		if (!lastCookDates[log.recipeId]) {
			lastCookDates[log.recipeId] = new Date(log.cookedAt)
		}
	}

	// Inventory matching
	const matchResults = matchRecipesWithInventory(allRecipes, inventoryItems)

	// Build suggestions
	const useTheseUp = getUseTheseUpSuggestions(allRecipes, expiringItems, now)
	const useTheseUpIds = useTheseUp.map((s) => s.recipe.id)

	const favorites = getFavoriteSuggestions(
		allRecipes,
		lastCookDates,
		useTheseUpIds,
		now,
	)
	const favIds = favorites.map((s) => s.recipe.id)

	const recipesById = new Map(allRecipes.map((r) => [r.id, r]))
	const readyToCook = getReadyToCookSuggestions(
		matchResults.map((m) => ({
			recipeId: m.recipe.id,
			matchPercentage: m.matchPercentage,
			matchedCount: m.matchedIngredientsCount,
			totalCount: m.totalIngredientsCount,
		})),
		recipesById,
		[...useTheseUpIds, ...favIds],
	)

	// Entries for mini calendar
	const entries = (mealPlan?.entries ?? []).map((e) => ({
		id: e.id,
		date: serializeDate(new Date(e.date)),
		mealType: e.mealType,
		recipeId: e.recipe.id,
		recipeTitle: e.recipe.title,
		recipeImage: e.recipe.image?.objectKey ?? null,
	}))

	// Lightweight recipe list for recipe picker (same shape as /plan loader)
	const recipesForPicker = allRecipes.map((r) => ({
		id: r.id,
		title: r.title,
		description: r.description,
		prepTime: r.prepTime,
		cookTime: r.cookTime,
		servings: r.servings,
		isFavorite: r.isFavorite,
		image: r.image,
	}))

	return {
		weekStart: serializeDate(weekStart),
		weekDays: getWeekDays(weekStart).map(serializeDate),
		useTheseUp: useTheseUp.map((s) => ({
			recipeId: s.recipe.id,
			title: s.recipe.title,
			image: s.recipe.image?.objectKey ?? null,
			expiringIngredient: s.expiringIngredient,
			daysLeft: s.daysLeft,
		})),
		favorites: favorites.map((s) => ({
			recipeId: s.recipe.id,
			title: s.recipe.title,
			image: s.recipe.image?.objectKey ?? null,
			daysSinceLastCook: s.daysSinceLastCook,
		})),
		readyToCook: readyToCook.map((s) => ({
			recipeId: s.recipe.id,
			title: s.recipe.title,
			image: s.recipe.image?.objectKey ?? null,
			matchedCount: s.matchedCount,
			totalCount: s.totalCount,
		})),
		entries,
		recipes: recipesForPicker,
	}
}
```

### Step 2: Add placeholder component

In the same file, add a minimal component so the route renders:

```typescript
export default function NewWeekPage({ loaderData }: Route.ComponentProps) {
	const { weekStart, useTheseUp, favorites, readyToCook, entries } = loaderData

	return (
		<div className="container-grid pb-20 md:pb-6">
			<div className="py-4">
				<Link
					to={`/plan?weekStart=${weekStart}`}
					className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
				>
					<Icon name="arrow-left" size="sm" />
					Back to plan
				</Link>
				<h1 className="font-serif mt-2 text-2xl">Plan Your Week</h1>
				<p className="text-muted-foreground text-sm">
					{formatWeekRange(parseDate(weekStart))}
				</p>
			</div>

			{/* Suggestions placeholder */}
			<p className="text-muted-foreground text-sm">
				{useTheseUp.length} use-up suggestions,{' '}
				{favorites.length} favorites,{' '}
				{readyToCook.length} ready-to-cook
			</p>

			{/* Actions */}
			<div className="mt-8 flex flex-col gap-3 sm:flex-row">
				<Button asChild>
					<Link to={`/plan?weekStart=${weekStart}`}>
						Go to your week
						<Icon name="arrow-right" size="sm" />
					</Link>
				</Button>
			</div>
		</div>
	)
}
```

### Step 3: Verify the route loads

Run: `npx vite build 2>&1 | tail -5` (should build without errors)
Then manual check: navigate to `/plan/new-week` in dev mode.

### Step 4: Commit

```bash
git add app/routes/plan/new-week.tsx
git commit -m "feat: add /plan/new-week route with loader and placeholder UI"
```

---

## Task 3: Suggestion Cards UI

Horizontal-scroll rows of compact recipe cards with [+ Add] buttons.

**Files:**
- Create: `app/components/suggestion-card.tsx`
- Modify: `app/routes/plan/new-week.tsx`

### Step 1: Create `SuggestionCard` component

A compact card designed for horizontal scroll — narrower than the full
`RecipeCard`, with a reason tag and [+ Add] button instead of a link.

```typescript
// app/components/suggestion-card.tsx
import { Img } from 'openimg/react'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { getRecipePlaceholder } from '#app/utils/recipe-placeholder.ts'
import { cn } from '#app/utils/misc.tsx'

type SuggestionCardProps = {
	recipeId: string
	title: string
	imageObjectKey: string | null
	tag: string
	tagVariant?: 'warning' | 'muted' | 'accent'
	assigned?: boolean
	onAdd: () => void
}

export function SuggestionCard({
	recipeId,
	title,
	imageObjectKey,
	tag,
	tagVariant = 'muted',
	assigned,
	onAdd,
}: SuggestionCardProps) {
	const placeholder = !imageObjectKey ? getRecipePlaceholder(title) : null

	return (
		<div
			className={cn(
				'relative flex w-40 shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-warm transition-all snap-start',
				assigned && 'ring-2 ring-primary/40',
			)}
		>
			{/* Image or placeholder */}
			<div className="relative aspect-[4/3] w-full overflow-hidden">
				{imageObjectKey ? (
					<Img
						src={`/resources/images?objectKey=${encodeURIComponent(imageObjectKey)}`}
						alt={title}
						className="h-full w-full object-cover"
						width={160}
						height={120}
					/>
				) : (
					<div
						className={cn(
							'flex h-full w-full items-center justify-center',
							placeholder!.bgClass,
						)}
					>
						<span
							className={cn(
								'font-serif text-2xl',
								placeholder!.letterColorClass,
							)}
						>
							{placeholder!.letter}
						</span>
					</div>
				)}
				{assigned && (
					<div className="absolute inset-0 flex items-center justify-center bg-black/30">
						<Icon name="check" className="size-6 text-white" />
					</div>
				)}
			</div>

			{/* Content */}
			<div className="flex flex-1 flex-col gap-1.5 p-2.5">
				<h3 className="line-clamp-2 text-sm font-medium leading-tight">
					{title}
				</h3>
				<span
					className={cn(
						'inline-block self-start rounded-full px-2 py-0.5 text-[10px] font-medium',
						tagVariant === 'warning' &&
							'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
						tagVariant === 'muted' &&
							'bg-muted text-muted-foreground',
						tagVariant === 'accent' &&
							'bg-primary/10 text-primary',
					)}
				>
					{tag}
				</span>
				<Button
					size="sm"
					variant={assigned ? 'outline' : 'default'}
					className="mt-auto w-full text-xs"
					onClick={onAdd}
					disabled={assigned}
				>
					{assigned ? 'Added' : '+ Add'}
				</Button>
			</div>
		</div>
	)
}

export function SuggestionRow({
	title,
	children,
}: {
	title: string
	children: React.ReactNode
}) {
	return (
		<section className="mb-6">
			<h2 className="font-serif mb-3 text-lg">{title}</h2>
			<div className="scrollbar-hide -mx-4 flex gap-3 overflow-x-auto px-4 snap-x snap-mandatory md:mx-0 md:px-0">
				{children}
			</div>
		</section>
	)
}
```

### Step 2: Wire suggestion cards into the page

Update `app/routes/plan/new-week.tsx` component to render the three suggestion
sections using `SuggestionCard` + `SuggestionRow`. Each [+ Add] button opens
the day picker (Task 4). For now, wire `onAdd` to a state setter that tracks
which card is being assigned.

Replace the placeholder `<p>` with:

```typescript
import {
	SuggestionCard,
	SuggestionRow,
} from '#app/components/suggestion-card.tsx'

// In the component:
const [pickingRecipe, setPickingRecipe] = useState<{
	recipeId: string
	title: string
} | null>(null)

// Track which recipes have been assigned (from entries)
const assignedRecipeIds = new Set(entries.map((e) => e.recipeId))

// Render:
{useTheseUp.length > 0 && (
	<SuggestionRow title="Use these up">
		{useTheseUp.map((s) => (
			<SuggestionCard
				key={s.recipeId}
				recipeId={s.recipeId}
				title={s.title}
				imageObjectKey={s.image}
				tag={`${s.expiringIngredient} ${s.daysLeft}d`}
				tagVariant="warning"
				assigned={assignedRecipeIds.has(s.recipeId)}
				onAdd={() => setPickingRecipe({ recipeId: s.recipeId, title: s.title })}
			/>
		))}
	</SuggestionRow>
)}

{favorites.length > 0 && (
	<SuggestionRow title="Favorites">
		{favorites.map((s) => (
			<SuggestionCard
				key={s.recipeId}
				recipeId={s.recipeId}
				title={s.title}
				imageObjectKey={s.image}
				tag={
					s.daysSinceLastCook != null
						? `${s.daysSinceLastCook}d ago`
						: 'Never cooked'
				}
				tagVariant="muted"
				assigned={assignedRecipeIds.has(s.recipeId)}
				onAdd={() => setPickingRecipe({ recipeId: s.recipeId, title: s.title })}
			/>
		))}
	</SuggestionRow>
)}

{readyToCook.length > 0 && (
	<SuggestionRow title="Ready to cook">
		{readyToCook.map((s) => (
			<SuggestionCard
				key={s.recipeId}
				recipeId={s.recipeId}
				title={s.title}
				imageObjectKey={s.image}
				tag={`${s.matchedCount}/${s.totalCount} ingredients`}
				tagVariant="accent"
				assigned={assignedRecipeIds.has(s.recipeId)}
				onAdd={() => setPickingRecipe({ recipeId: s.recipeId, title: s.title })}
			/>
		))}
	</SuggestionRow>
)}

{useTheseUp.length === 0 && favorites.length === 0 && readyToCook.length === 0 && (
	<div className="bg-card shadow-warm rounded-2xl p-6 text-center">
		<h2 className="font-serif text-xl">No suggestions right now</h2>
		<p className="text-muted-foreground mt-1 text-sm">
			Add favorites or stock your inventory to get personalized picks.
		</p>
		<Button asChild className="mt-4">
			<Link to="/recipes">Browse recipes</Link>
		</Button>
	</div>
)}
```

### Step 3: Verify suggestion cards render

Run: dev mode, navigate to `/plan/new-week`. Should see horizontal-scroll
rows of cards with [+ Add] buttons. Tapping [+ Add] should set
`pickingRecipe` state (visible in React DevTools, or add a temporary debug
`<pre>`).

### Step 4: Commit

```bash
git add app/components/suggestion-card.tsx app/routes/plan/new-week.tsx
git commit -m "feat: add suggestion card components and wire into new-week page"
```

---

## Task 4: Day/Meal Picker + Assign Action

Popover for picking which day + meal type when adding a recipe.

**Files:**
- Create: `app/components/day-meal-picker.tsx`
- Modify: `app/routes/plan/new-week.tsx` (add action, wire picker)

### Step 1: Create day/meal picker component

```typescript
// app/components/day-meal-picker.tsx
import { useState } from 'react'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { MEAL_TYPES, parseDate } from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type DayMealPickerProps = {
	weekDays: string[] // serialized dates
	recipeTitle: string
	onSelect: (date: string, mealType: string) => void
	onClose: () => void
}

export function DayMealPicker({
	weekDays,
	recipeTitle,
	onSelect,
	onClose,
}: DayMealPickerProps) {
	const [mealType, setMealType] = useState('dinner')

	return (
		<div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/40"
				onClick={onClose}
				aria-hidden
			/>

			{/* Sheet */}
			<div className="relative w-full max-w-sm rounded-t-2xl bg-card p-5 shadow-xl sm:rounded-2xl">
				<div className="mb-4 flex items-center justify-between">
					<h3 className="font-serif text-lg">
						{recipeTitle}
					</h3>
					<button
						type="button"
						onClick={onClose}
						className="text-muted-foreground hover:text-foreground"
						aria-label="Close"
					>
						<Icon name="cross-1" size="sm" />
					</button>
				</div>

				{/* Day grid */}
				<div className="mb-4 grid grid-cols-7 gap-1.5">
					{weekDays.map((date, i) => (
						<button
							key={date}
							type="button"
							onClick={() => onSelect(date, mealType)}
							className="flex flex-col items-center gap-0.5 rounded-lg border border-border/60 px-1 py-2 text-xs transition-colors hover:border-primary hover:bg-primary/5"
						>
							<span className="font-medium">{DAY_LABELS[i]}</span>
							<span className="text-muted-foreground">
								{parseDate(date).getUTCDate()}
							</span>
						</button>
					))}
				</div>

				{/* Meal type selector */}
				<div className="flex gap-1.5">
					{MEAL_TYPES.map((type) => (
						<button
							key={type}
							type="button"
							onClick={() => setMealType(type)}
							className={cn(
								'flex-1 rounded-lg px-2 py-1.5 text-xs font-medium capitalize transition-colors',
								mealType === type
									? 'bg-primary text-primary-foreground'
									: 'bg-muted text-muted-foreground hover:bg-muted/80',
							)}
						>
							{type}
						</button>
					))}
				</div>
			</div>
		</div>
	)
}
```

### Step 2: Add assign action to `new-week.tsx`

The action POSTs to `/plan`'s existing `assign` intent. Use `useFetcher` to
submit without navigation.

In `app/routes/plan/new-week.tsx`, add to the component:

```typescript
import { useFetcher, useRevalidator } from 'react-router'
import { DayMealPicker } from '#app/components/day-meal-picker.tsx'

// Inside the component:
const fetcher = useFetcher()
const revalidator = useRevalidator()

function handleAssign(date: string, mealType: string) {
	if (!pickingRecipe) return
	fetcher.submit(
		{
			intent: 'assign',
			recipeId: pickingRecipe.recipeId,
			date,
			mealType,
		},
		{ method: 'POST', action: '/plan' },
	)
	setPickingRecipe(null)
	// Revalidate to refresh entries
	revalidator.revalidate()
}

// Render the picker when active:
{pickingRecipe && (
	<DayMealPicker
		weekDays={weekDays}
		recipeTitle={pickingRecipe.title}
		onSelect={handleAssign}
		onClose={() => setPickingRecipe(null)}
	/>
)}
```

### Step 3: Verify assign flow works

In dev mode: tap [+ Add] on a suggestion → day picker appears → tap a day →
recipe should appear in `/plan?weekStart=...` for that week. The suggestion
card should show checkmark overlay after revalidation.

### Step 4: Commit

```bash
git add app/components/day-meal-picker.tsx app/routes/plan/new-week.tsx
git commit -m "feat: add day/meal picker and wire assign action via fetcher"
```

---

## Task 5: Mini Week Calendar

Compact calendar strip at the bottom showing what's been assigned so far.

**Files:**
- Modify: `app/routes/plan/new-week.tsx`

### Step 1: Add mini calendar component inline

This is small enough to live in the route file. Shows a 7-column strip with
assigned recipe names. Tapping an empty slot opens the recipe picker (from
the existing `RecipeSelector` component used on `/plan`). Tapping an assigned
recipe removes it.

Add to `app/routes/plan/new-week.tsx`:

```typescript
import { RecipeSelector } from '#app/components/recipe-selector.tsx'
import { MEAL_TYPES } from '#app/utils/date.ts'

// Inside the component, after the suggestion sections:

const [selectorSlot, setSelectorSlot] = useState<{
	date: string
	mealType: string
} | null>(null)

function handleRemove(entryId: string) {
	fetcher.submit(
		{ intent: 'remove', entryId },
		{ method: 'POST', action: '/plan' },
	)
	revalidator.revalidate()
}

function handleSelectorAssign(recipeId: string) {
	if (!selectorSlot) return
	fetcher.submit(
		{
			intent: 'assign',
			recipeId,
			date: selectorSlot.date,
			mealType: selectorSlot.mealType,
		},
		{ method: 'POST', action: '/plan' },
	)
	setSelectorSlot(null)
	revalidator.revalidate()
}

// JSX for the mini calendar:
<section className="mt-2">
	<h2 className="font-serif mb-3 text-lg">Your week</h2>
	<div className="grid grid-cols-7 gap-1.5">
		{weekDays.map((date, i) => {
			const dayEntries = entries.filter((e) => e.date === date)
			return (
				<div key={date} className="flex flex-col gap-1">
					<span className="text-center text-[10px] font-medium text-muted-foreground">
						{DAY_LABELS[i]}
					</span>
					{dayEntries.length > 0 ? (
						dayEntries.map((entry) => (
							<button
								key={entry.id}
								type="button"
								onClick={() => handleRemove(entry.id)}
								className="group relative flex h-14 flex-col items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-card p-1 text-center transition-colors hover:border-destructive/40"
								title={`${entry.recipeTitle} — tap to remove`}
							>
								<span className="line-clamp-2 text-[10px] leading-tight">
									{entry.recipeTitle}
								</span>
								<span className="absolute inset-0 hidden items-center justify-center bg-destructive/10 group-hover:flex">
									<Icon
										name="cross-1"
										size="xs"
										className="text-destructive"
									/>
								</span>
							</button>
						))
					) : (
						<button
							type="button"
							onClick={() =>
								setSelectorSlot({ date, mealType: 'dinner' })
							}
							className="flex h-14 items-center justify-center rounded-lg border border-dashed border-border/60 text-muted-foreground/40 transition-colors hover:border-primary/40 hover:text-primary"
						>
							<Icon name="plus" size="xs" />
						</button>
					)}
				</div>
			)
		})}
	</div>

	{/* Planned count + actions */}
	<div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<p className="text-muted-foreground text-sm">
			{entries.length} meal{entries.length !== 1 ? 's' : ''} planned
		</p>
		<div className="flex gap-3">
			<Button asChild variant="outline">
				<Link to={`/plan?weekStart=${weekStart}`}>
					Go to your week
					<Icon name="arrow-right" size="sm" />
				</Link>
			</Button>
			{entries.length > 0 && (
				<Button asChild>
					<Link to={`/shopping?generate=true&week=${weekStart}`}>
						Generate shopping list
						<Icon name="arrow-right" size="sm" />
					</Link>
				</Button>
			)}
		</div>
	</div>
</section>

{/* Recipe selector modal for empty slot tap */}
{selectorSlot && (
	<RecipeSelector
		recipes={recipes}
		onSelect={handleSelectorAssign}
		onClose={() => setSelectorSlot(null)}
	/>
)}
```

Note: `DAY_LABELS` should be imported from `day-meal-picker.tsx` or extracted
to a shared constant. Move it to the picker file and export it:
`export const DAY_LABELS = ['Mon', 'Tue', ...]`

### Step 2: Verify mini calendar works

In dev mode: assigned recipes appear in the day columns. Tapping an assigned
recipe removes it. Tapping an empty [+] slot opens the recipe selector.
"Generate shopping list" and "Go to your week" links work.

### Step 3: Commit

```bash
git add app/routes/plan/new-week.tsx app/components/day-meal-picker.tsx
git commit -m "feat: add mini week calendar with remove + recipe selector"
```

---

## Task 6: Weekend Nudge Banner + Persistent Link

Add entry points to `/plan` that direct users to the new-week flow.

**Files:**
- Modify: `app/routes/plan/index.tsx`

### Step 1: Add next-week-empty check to the loader

In `app/routes/plan/index.tsx` loader, after the existing template query,
check if next week has entries:

```typescript
// After the templates query (~line 203):
const nextWeekStart = getNextWeek(weekStart)
const nextWeekEntryCount = await prisma.mealPlanEntry.count({
	where: {
		mealPlan: { householdId, weekStart: nextWeekStart },
	},
})

// Add to the return object:
return {
	// ...existing fields
	nextWeekEmpty: nextWeekEntryCount === 0,
	nextWeekStart: serializeDate(nextWeekStart),
}
```

### Step 2: Add weekend nudge banner to the component

In the component, after the page header and before the week navigation:

```typescript
// State for nudge dismiss (localStorage-backed)
const [nudgeDismissed, setNudgeDismissed] = useState(() => {
	if (typeof window === 'undefined') return true
	return localStorage.getItem(`plan-nudge-${loaderData.nextWeekStart}`) === '1'
})

function dismissNudge() {
	localStorage.setItem(`plan-nudge-${loaderData.nextWeekStart}`, '1')
	setNudgeDismissed(true)
}

// Check if today is Saturday (6) or Sunday (0)
const isWeekend = [0, 6].includes(new Date().getDay())

// Render nudge — inside the container-grid div, after the header flex div:
{isWeekend && loaderData.nextWeekEmpty && !nudgeDismissed && (
	<div className="bg-card border-border shadow-warm relative mt-4 rounded-2xl border p-5">
		<button
			type="button"
			onClick={dismissNudge}
			className="text-muted-foreground hover:text-foreground absolute top-3 right-3"
			aria-label="Dismiss"
		>
			<Icon name="cross-1" size="sm" />
		</button>
		<div className="flex items-start gap-3">
			<Icon
				name="calendar"
				className="text-primary mt-0.5 size-6 shrink-0"
			/>
			<div>
				<h3 className="font-semibold">Ready to plan next week?</h3>
				<p className="text-muted-foreground mt-1 text-sm">
					Pick a few recipes and you're set for the week.
				</p>
				<div className="mt-3 flex flex-wrap items-center gap-3">
					<Button asChild>
						<Link
							to={`/plan/new-week?week=${loaderData.nextWeekStart}`}
						>
							Plan your week
							<Icon name="arrow-right" size="sm" />
						</Link>
					</Button>
					<Link
						to="/recipes"
						className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-2"
					>
						Browse recipes first
					</Link>
				</div>
			</div>
		</div>
	</div>
)}
```

### Step 3: Add persistent "Plan next week" link

In the week navigation area (after the "Next" button, ~line 503), add a
conditional link:

```typescript
// After the week nav div, still inside container-grid:
{loaderData.nextWeekEmpty && weekStart <= serializeDate(getCurrentWeekStart()) && (
	<div className="mt-2 text-center">
		<Button asChild variant="link" size="sm">
			<Link to={`/plan/new-week?week=${loaderData.nextWeekStart}`}>
				<Icon name="plus" size="sm" />
				Plan next week
			</Link>
		</Button>
	</div>
)}
```

### Step 4: Verify both entry points

Dev mode:
- On Saturday/Sunday with next week empty: nudge banner appears. Dismiss
  persists across page reloads. Tapping "Plan your week" navigates correctly.
- On any day: "Plan next week" link appears below week nav when viewing
  current/past week and next week is empty.

### Step 5: Commit

```bash
git add app/routes/plan/index.tsx
git commit -m "feat: add weekend nudge banner and persistent plan-next-week link"
```

---

## Task 7: Polish + Edge Cases

Final cleanup pass.

**Files:**
- Modify: `app/routes/plan/new-week.tsx`
- Modify: `app/components/suggestion-card.tsx`
- Modify: `app/components/day-meal-picker.tsx`

### Step 1: Handle past-week redirect

In the `new-week.tsx` loader, after computing `weekStart`, add:

```typescript
import { redirect } from 'react-router'

// After weekStart is computed:
const currentWeekStart = getCurrentWeekStart()
if (weekStart < currentWeekStart) {
	const defaultNext = getNextWeek(currentWeekStart)
	throw redirect(`/plan/new-week?week=${serializeDate(defaultNext)}`)
}
```

### Step 2: Add keyboard escape to day picker

In `day-meal-picker.tsx`, add an effect:

```typescript
import { useEffect } from 'react'

// Inside DayMealPicker:
useEffect(() => {
	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose()
	}
	document.addEventListener('keydown', handleKey)
	return () => document.removeEventListener('keydown', handleKey)
}, [onClose])
```

### Step 3: Add `scrollbar-hide` utility check

The `scrollbar-hide` class is used in `SuggestionRow`. Verify it exists in
the project's Tailwind config or CSS. Check:
`grep -r "scrollbar-hide" app/` — if missing, add to
`app/styles/tailwind.css`:

```css
@layer utilities {
	.scrollbar-hide {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	.scrollbar-hide::-webkit-scrollbar {
		display: none;
	}
}
```

### Step 4: Test full flow end-to-end manually

1. Navigate to `/plan/new-week` — suggestions load
2. Tap [+ Add] on a suggestion → day picker opens
3. Pick a day → recipe appears in mini calendar, card shows checkmark
4. Tap empty [+] in mini calendar → recipe selector opens → assign
5. Tap assigned recipe in mini calendar → removes it
6. Tap "Generate shopping list" → navigates to `/shopping`
7. Tap "Go to your week" → navigates to `/plan` for that week
8. On `/plan`: nudge banner appears on weekends, "Plan next week" link shows

### Step 5: Commit

```bash
git add -A
git commit -m "polish: edge cases, keyboard escape, scrollbar-hide, past-week redirect"
```

---

## Task 8: Update Development Plan

**Files:**
- Modify: `docs/DEVELOPMENT_PLAN.md`

### Step 1: Mark weekly reset flow as done in the backlog

In `docs/DEVELOPMENT_PLAN.md`, change the backlog entry from `[ ]` to `[x]`:

```
- [x] **Weekly reset flow** — ...
```

### Step 2: Commit

```bash
git add docs/DEVELOPMENT_PLAN.md
git commit -m "docs: mark weekly reset flow as done in backlog"
```
