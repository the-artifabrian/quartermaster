import { invariantResponse } from '@epic-web/invariant'
import { data } from 'react-router'
import {
	addDaysUTC,
	getWeekStart,
	parseDate,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import {
	getCanonicalIngredientName,
	isStapleIngredient,
	matchRecipesWithInventory,
} from '#app/utils/recipe-matching.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/meal-plan-suggest.ts'

type SuggestionReason = 'expiring' | 'favorite' | 'match'

type Suggestion = {
	recipe: {
		id: string
		title: string
		image: { objectKey: string } | null
	}
	reason: SuggestionReason
	expiringItems?: string[]
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

	// 4. Household inventory items (for matching + expiry check)
	const inventoryItems = await prisma.inventoryItem.findMany({
		where: { householdId },
		select: {
			name: true,
			expiresAt: true,
		},
	})

	// Build expiring items set: items expiring within 7 days
	const now = new Date()
	const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
	const expiringItems = inventoryItems.filter(
		(item) =>
			item.expiresAt &&
			item.expiresAt > now &&
			item.expiresAt <= sevenDaysFromNow,
	)
	const expiringCanonicalNames = new Set(
		expiringItems.map((item) => getCanonicalIngredientName(item.name)),
	)

	// Get match results for all recipes
	const matchResults = matchRecipesWithInventory(allRecipes, inventoryItems)

	// Build suggestion pools
	const suggestions: Suggestion[] = []
	const usedRecipeIds = new Set<string>()

	// Pool 1: Recipes using expiring items (2+ non-staple expiring ingredients)
	if (expiringCanonicalNames.size > 0) {
		const expiringRecipes: Array<{
			recipe: (typeof allRecipes)[number]
			expiringIngredients: string[]
		}> = []

		for (const recipe of allRecipes) {
			if (plannedRecipeIds.has(recipe.id)) continue
			const expiringIngredients: string[] = []
			for (const ing of recipe.ingredients) {
				if (ing.isHeading) continue
				if (isStapleIngredient(ing)) continue
				const canonical = getCanonicalIngredientName(ing.name)
				if (expiringCanonicalNames.has(canonical)) {
					expiringIngredients.push(ing.name)
				}
			}
			if (expiringIngredients.length >= 2) {
				expiringRecipes.push({ recipe, expiringIngredients })
			}
		}

		// Sort by expiring ingredient count desc
		expiringRecipes.sort(
			(a, b) => b.expiringIngredients.length - a.expiringIngredients.length,
		)

		for (const { recipe, expiringIngredients } of expiringRecipes) {
			if (suggestions.length >= 7) break
			if (usedRecipeIds.has(recipe.id)) continue
			usedRecipeIds.add(recipe.id)
			suggestions.push({
				recipe: {
					id: recipe.id,
					title: recipe.title,
					image: recipe.image,
				},
				reason: 'expiring',
				expiringItems: expiringIngredients,
			})
		}
	}

	// Pool 2: Favorites not recently cooked
	if (suggestions.length < 7) {
		const favoriteRecipes = allRecipes
			.filter(
				(r) =>
					r.isFavorite &&
					!plannedRecipeIds.has(r.id) &&
					!recentlyCookedIds.has(r.id) &&
					!usedRecipeIds.has(r.id),
			)
			// Sort favorites by match percentage (use matchResults)
			.sort((a, b) => {
				const matchA =
					matchResults.find((m) => m.recipe.id === a.id)?.matchPercentage ?? 0
				const matchB =
					matchResults.find((m) => m.recipe.id === b.id)?.matchPercentage ?? 0
				return matchB - matchA
			})

		for (const recipe of favoriteRecipes) {
			if (suggestions.length >= 7) break
			usedRecipeIds.add(recipe.id)
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

	// Pool 3: High match percentage (not already in expiring or favorites)
	if (suggestions.length < 7) {
		for (const match of matchResults) {
			if (suggestions.length >= 7) break
			if (usedRecipeIds.has(match.recipe.id)) continue
			if (plannedRecipeIds.has(match.recipe.id)) continue
			if (match.matchPercentage === 0) continue
			usedRecipeIds.add(match.recipe.id)
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

		// Skip if this exact recipe is already assigned to this dinner slot
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

	if (created > 0) {
		void emitHouseholdEvent({
			type: 'meal_plan_weekly_reset',
			payload: { count: created },
			userId,
			householdId,
		})
	}

	return data({
		status: 'success' as const,
		count: created,
		weekStart: serializeDate(weekStart),
	})
}
