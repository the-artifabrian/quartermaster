import { redirect } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { matchRecipesWithInventory } from '#app/utils/recipe-matching.server.ts'
import {
	scoreRecipe,
	weightedRandomSelect,
	type CookingLogSummary,
} from '#app/utils/surprise-scoring.server.ts'
import { type Route } from './+types/surprise-me.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)

	// Load all recipes with ingredients, favorites, and cooking logs
	const recipes = await prisma.recipe.findMany({
		where: { householdId },
		select: {
			id: true,
			title: true,
			description: true,
			prepTime: true,
			cookTime: true,
			servings: true,
			isFavorite: true,
			sourceUrl: true,
			rawText: true,
			notes: true,
			householdId: true,
			createdAt: true,
			updatedAt: true,
			userId: true,
			ingredients: {
				select: {
					id: true,
					name: true,
					amount: true,
					unit: true,
					notes: true,
					isHeading: true,
					order: true,
					recipeId: true,
				},
				orderBy: { order: 'asc' },
			},
		},
	})

	if (recipes.length === 0) {
		return redirect('/recipes')
	}

	// Load inventory for match scoring
	const inventoryItems = await prisma.inventoryItem.findMany({
		where: { householdId },
	})

	// Calculate match percentages
	const matches = matchRecipesWithInventory(recipes, inventoryItems)
	const matchByRecipeId = new Map(
		matches.map((m) => [m.recipe.id, m.matchPercentage]),
	)

	// Load cooking logs for the current user (personal, not household-scoped)
	const cookingLogs = await prisma.cookingLog.findMany({
		where: { userId, recipeId: { in: recipes.map((r) => r.id) } },
		select: { recipeId: true, cookedAt: true },
	})

	// Build cooking log summaries per recipe
	const logsByRecipe = new Map<string, Array<{ cookedAt: Date }>>()
	for (const log of cookingLogs) {
		const existing = logsByRecipe.get(log.recipeId) ?? []
		existing.push(log)
		logsByRecipe.set(log.recipeId, existing)
	}

	const scoredRecipes = recipes.map((recipe) => {
		const matchPercentage = matchByRecipeId.get(recipe.id) ?? 0
		const logs = logsByRecipe.get(recipe.id) ?? []

		const lastCookedAt =
			logs.length > 0
				? new Date(
						Math.max(...logs.map((l) => l.cookedAt.getTime())),
					)
				: null

		const summary: CookingLogSummary = { lastCookedAt }

		return {
			recipeId: recipe.id,
			score: scoreRecipe(matchPercentage, recipe.isFavorite, summary),
		}
	})

	const winnerId = weightedRandomSelect(scoredRecipes)

	if (!winnerId) {
		return redirect('/recipes')
	}

	return redirect(`/recipes/${winnerId}`)
}
