import { invariantResponse } from '@epic-web/invariant'
import { data } from 'react-router'
import {
	addDaysUTC,
	getWeekStart,
	parseDate,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { activeLegacyPantryWhere } from '#app/utils/legacy-pantry.server.ts'
import { MealLabelSchema } from '#app/utils/meal-plan-validation.ts'
import { ensureMealPlan } from '#app/utils/meal-plan.server.ts'
import {
	MIN_FIT_THRESHOLD,
	createVarietyState,
	isTooSimilar,
	recordSelection,
	scoreMealTypeFit,
} from '#app/utils/meal-suggestion.server.ts'
import { createRecipeMeal } from '#app/utils/meal.server.ts'
import { MEAL_PLAN_SUGGESTED } from '#app/utils/posthog-events.ts'
import { captureServerEvent } from '#app/utils/posthog.server.ts'
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

	const [existingPlan, allRecipes, inventoryItems] = await Promise.all([
		// 1. Existing Meals for the target week (to exclude already-planned
		// recipes). Suggestions read/write Meal parents (#105); the slot concept
		// survives only as the optional label a suggested Meal is filed under.
		prisma.mealPlan.findUnique({
			where: { householdId_weekStart: { householdId, weekStart } },
			include: {
				meals: {
					select: {
						date: true,
						label: true,
						recipeItems: { select: { recipeId: true } },
					},
				},
			},
		}),
		// 2. All household recipes with ingredients (for matching)
		prisma.recipe.findMany({
			where: { householdId },
			include: {
				ingredients: true,
				image: { select: { objectKey: true } },
			},
		}),
		// 3. Household inventory items (for matching)
		prisma.inventoryItem.findMany({
			where: activeLegacyPantryWhere(householdId),
			select: { name: true },
		}),
	])
	const plannedRecipeIds = new Set(
		existingPlan?.meals.flatMap((meal) =>
			meal.recipeItems.flatMap((item) => item.recipeId ?? []),
		) ?? [],
	)

	// Get match results for all recipes
	const matchResults = matchRecipesWithInventory(allRecipes, inventoryItems)

	// Build a match lookup for quick access
	const matchByRecipeId = new Map(matchResults.map((m) => [m.recipe.id, m]))

	// Composite scoring helper
	function compositeScore(
		recipeId: string,
		title: string,
		ingredients: { isHeading: boolean }[],
	) {
		const matchPct = (matchByRecipeId.get(recipeId)?.matchPercentage ?? 0) / 100
		const ingredientCount = ingredients.filter((i) => !i.isHeading).length
		const fit = scoreMealTypeFit(title, ingredientCount, mealType)
		return { composite: matchPct * fit, fit }
	}

	// Build suggestion pools
	const suggestions: Suggestion[] = []
	const usedRecipeIds = new Set<string>()
	const varietyState = createVarietyState()

	// Seed variety state from Meals already labeled with this meal type
	// so suggestions don't duplicate proteins/ingredients already planned
	const recipeById = new Map(allRecipes.map((r) => [r.id, r]))
	if (existingPlan) {
		for (const meal of existingPlan.meals) {
			if (meal.label !== mealType) continue
			for (const item of meal.recipeItems) {
				const recipe = item.recipeId ? recipeById.get(item.recipeId) : null
				if (recipe) {
					recordSelection(recipe.ingredients, varietyState)
				}
			}
		}
	}

	// Pool 1: Favorites
	if (suggestions.length < 7) {
		const favoriteRecipes = allRecipes
			.filter(
				(r) =>
					r.isFavorite &&
					!plannedRecipeIds.has(r.id) &&
					!usedRecipeIds.has(r.id),
			)
			.map((r) => ({
				recipe: r,
				...compositeScore(r.id, r.title, r.ingredients),
			}))
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

	// Determine which days already have a Meal labeled with this meal type
	const filledDays = new Set<number>()
	if (existingPlan) {
		for (const meal of existingPlan.meals) {
			if (meal.label !== mealType) continue
			const dayOffset = Math.round(
				(new Date(meal.date).getTime() - weekStart.getTime()) / 86_400_000,
			)
			if (dayOffset >= 0 && dayOffset < 7) {
				filledDays.add(dayOffset)
			}
		}
	}

	captureServerEvent(userId, MEAL_PLAN_SUGGESTED, {
		suggestion_count: suggestions.length,
		meal_type: mealType,
	})

	return data({
		suggestions,
		filledDays: [...filledDays],
	})
}

export async function action({ request }: Route.ActionArgs) {
	const { householdId } = await requireProTier(request)
	const formData = await request.formData()

	const weekStartStr = formData.get('weekStart')
	invariantResponse(typeof weekStartStr === 'string', 'weekStart is required')
	// The suggested Meals are filed under this familiar label; anything but the
	// four known labels falls back to dinner rather than minting new ones.
	const mealType = MealLabelSchema.catch('dinner').parse(
		formData.get('mealType') ?? 'dinner',
	)

	const weekStart = getWeekStart(parseDate(weekStartStr))

	// Parse recipeIds — JSON array where index = day offset, null for empty days
	const recipeIdsJson = formData.get('recipeIds')
	invariantResponse(typeof recipeIdsJson === 'string', 'recipeIds is required')
	const parsed: unknown = JSON.parse(recipeIdsJson)
	invariantResponse(Array.isArray(parsed), 'recipeIds must be an array')
	const recipeIds = parsed as Array<string | null>

	const mealPlan = await ensureMealPlan(prisma, { householdId, weekStart })

	let created = 0
	for (let i = 0; i < recipeIds.length && i < 7; i++) {
		const recipeId = recipeIds[i]
		if (!recipeId) continue

		const recipe = await prisma.recipe.findFirst({
			where: { id: recipeId, householdId },
			select: { id: true, title: true },
		})
		if (!recipe) continue

		// One labeled Meal per accepted day; createRecipeMeal dedupes on
		// (plan, day, label, Recipe) so re-submits don't stack duplicates.
		const result = await createRecipeMeal(prisma, {
			mealPlanId: mealPlan.id,
			date: addDaysUTC(weekStart, i),
			label: mealType,
			recipe,
		})

		if (result.created) {
			created++
		}
	}

	return data({
		status: 'success' as const,
		count: created,
		weekStart: serializeDate(weekStart),
	})
}
