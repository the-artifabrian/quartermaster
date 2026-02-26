import { invariantResponse } from '@epic-web/invariant'
import { data } from 'react-router'
import {
	addDaysUTC,
	getWeekStart,
	parseDate,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	MIN_FIT_THRESHOLD,
	createVarietyState,
	isTooSimilar,
	recordSelection,
	scoreMealTypeFit,
} from '#app/utils/meal-suggestion.server.ts'
import { matchRecipesWithInventory } from '#app/utils/recipe-matching.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/meal-plan-suggest.ts'

type SuggestionReason = 'favorite' | 'match'

type Suggestion = {
	recipe: {
		id: string
		title: string
		image: { objectKey: string } | null
	}
	reason: SuggestionReason
}

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireProTier(request)
	const url = new URL(request.url)
	const weekStartStr = url.searchParams.get('weekStart')
	invariantResponse(weekStartStr, 'weekStart is required')
	const mealType = url.searchParams.get('mealType') ?? 'dinner'

	const weekStart = getWeekStart(parseDate(weekStartStr))

	// 1. Existing entries for target week (to exclude already-planned recipes)
	const existingPlan = await prisma.mealPlan.findFirst({
		where: { householdId, weekStart },
		include: { entries: { select: { recipeId: true, date: true, mealType: true } } },
	})
	const plannedRecipeIds = new Set(
		existingPlan?.entries.map((e) => e.recipeId) ?? [],
	)

	// 2. Recently cooked recipes (CookingLog in last 14 days — user-scoped)
	const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
	const recentCookingLogs = await prisma.cookingLog.findMany({
		where: { userId, cookedAt: { gte: fourteenDaysAgo } },
		select: { recipeId: true },
	})
	const recentlyCookedIds = new Set(recentCookingLogs.map((l) => l.recipeId))

	// 3. All household recipes with ingredients (for matching)
	const allRecipes = await prisma.recipe.findMany({
		where: { householdId },
		include: {
			ingredients: true,
			image: { select: { objectKey: true } },
		},
	})

	// 4. Household inventory items (for matching)
	const inventoryItems = await prisma.inventoryItem.findMany({
		where: { householdId },
		select: { name: true },
	})

	// Get match results for all recipes
	const matchResults = matchRecipesWithInventory(allRecipes, inventoryItems)

	// Build a match lookup for quick access
	const matchByRecipeId = new Map(
		matchResults.map((m) => [m.recipe.id, m]),
	)

	// Composite scoring helper
	function compositeScore(recipeId: string, title: string, ingredients: { isHeading: boolean }[]) {
		const matchPct = (matchByRecipeId.get(recipeId)?.matchPercentage ?? 0) / 100
		const ingredientCount = ingredients.filter((i) => !i.isHeading).length
		const fit = scoreMealTypeFit(title, ingredientCount, mealType)
		return { composite: matchPct * fit, fit }
	}

	// Build suggestion pools
	const suggestions: Suggestion[] = []
	const usedRecipeIds = new Set<string>()
	const varietyState = createVarietyState()

	// Seed variety state from existing entries for this meal type
	// so suggestions don't duplicate proteins/ingredients already planned
	const recipeById = new Map(allRecipes.map((r) => [r.id, r]))
	if (existingPlan) {
		for (const entry of existingPlan.entries) {
			if (entry.mealType !== mealType) continue
			const recipe = recipeById.get(entry.recipeId)
			if (recipe) {
				recordSelection(recipe.ingredients, varietyState)
			}
		}
	}

	// Pool 1: Favorites not recently cooked
	if (suggestions.length < 7) {
		const favoriteRecipes = allRecipes
			.filter(
				(r) =>
					r.isFavorite &&
					!plannedRecipeIds.has(r.id) &&
					!recentlyCookedIds.has(r.id) &&
					!usedRecipeIds.has(r.id),
			)
			.map((r) => ({ recipe: r, ...compositeScore(r.id, r.title, r.ingredients) }))
			// Filter poor meal-type fits (condiments, beverages, wrong-category recipes)
			.filter((r) => r.fit >= MIN_FIT_THRESHOLD)
			// Sort by composite score desc, then fit as tiebreaker
			.sort((a, b) => b.composite - a.composite || b.fit - a.fit)

		for (const { recipe } of favoriteRecipes) {
			if (suggestions.length >= 7) break
			if (isTooSimilar(recipe.ingredients, varietyState)) continue
			usedRecipeIds.add(recipe.id)
			recordSelection(recipe.ingredients, varietyState)
			suggestions.push({
				recipe: {
					id: recipe.id,
					title: recipe.title,
					image: recipe.image,
				},
				reason: 'favorite',
			})
		}
	}

	// Pool 2: High match percentage (not already in favorites)
	if (suggestions.length < 7) {
		const scored = matchResults
			.filter(
				(m) =>
					!usedRecipeIds.has(m.recipe.id) &&
					!plannedRecipeIds.has(m.recipe.id) &&
					!recentlyCookedIds.has(m.recipe.id) &&
					m.matchPercentage > 0,
			)
			.map((m) => ({
				match: m,
				...compositeScore(m.recipe.id, m.recipe.title, m.recipe.ingredients),
			}))
			.filter((r) => r.fit >= MIN_FIT_THRESHOLD)
			.sort((a, b) => b.composite - a.composite || b.fit - a.fit)

		for (const { match } of scored) {
			if (suggestions.length >= 7) break
			if (isTooSimilar(match.recipe.ingredients, varietyState)) continue
			usedRecipeIds.add(match.recipe.id)
			recordSelection(match.recipe.ingredients, varietyState)
			suggestions.push({
				recipe: {
					id: match.recipe.id,
					title: match.recipe.title,
					image: match.recipe.image ?? null,
				},
				reason: 'match',
			})
		}
	}

	// Determine which days already have entries for the requested meal type
	const filledDays = new Set<number>()
	if (existingPlan) {
		for (const entry of existingPlan.entries) {
			if (entry.mealType !== mealType) continue
			const entryDate = new Date(entry.date)
			const dayOffset = Math.round(
				(entryDate.getTime() - weekStart.getTime()) / 86_400_000,
			)
			if (dayOffset >= 0 && dayOffset < 7) {
				filledDays.add(dayOffset)
			}
		}
	}

	return data({
		suggestions,
		filledDays: [...filledDays],
	})
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireProTier(request)
	const formData = await request.formData()

	const weekStartStr = formData.get('weekStart')
	invariantResponse(
		typeof weekStartStr === 'string',
		'weekStart is required',
	)
	const mealType =
		(formData.get('mealType') as string | null) ?? 'dinner'

	const weekStart = getWeekStart(parseDate(weekStartStr))

	// Parse recipeIds — JSON array where index = day offset, null for empty days
	const recipeIdsJson = formData.get('recipeIds')
	invariantResponse(
		typeof recipeIdsJson === 'string',
		'recipeIds is required',
	)
	const parsed: unknown = JSON.parse(recipeIdsJson)
	invariantResponse(Array.isArray(parsed), 'recipeIds must be an array')
	const recipeIds = parsed as Array<string | null>

	// Get or create MealPlan for the week
	let mealPlan = await prisma.mealPlan.findFirst({
		where: { householdId, weekStart },
	})

	if (!mealPlan) {
		mealPlan = await prisma.mealPlan.create({
			data: { userId, householdId, weekStart },
		})
	}

	let created = 0
	for (let i = 0; i < recipeIds.length && i < 7; i++) {
		const recipeId = recipeIds[i]
		if (!recipeId) continue

		const entryDate = addDaysUTC(weekStart, i)

		// Skip if this exact recipe is already assigned to this slot
		const existing = await prisma.mealPlanEntry.findUnique({
			where: {
				mealPlanId_date_mealType_recipeId: {
					mealPlanId: mealPlan.id,
					date: entryDate,
					mealType,
					recipeId,
				},
			},
		})

		if (!existing) {
			await prisma.mealPlanEntry.create({
				data: {
					mealPlanId: mealPlan.id,
					date: entryDate,
					mealType,
					recipeId,
				},
			})
			created++
		}
	}

	return data({
		status: 'success' as const,
		count: created,
		weekStart: serializeDate(weekStart),
	})
}
