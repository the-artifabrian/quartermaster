import { requireProTier } from '#app/utils/subscription.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { scoreRecipePairings } from '#app/utils/ingredient-overlap.server.ts'
import { matchRecipesWithInventory } from '#app/utils/recipe-matching.server.ts'
import { type Route } from './+types/meal-plan-pairing.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireProTier(request)
	const url = new URL(request.url)
	const weekStart = url.searchParams.get('weekStart')

	// Load all recipes with ingredients + inventory (needed for both pairing and matching)
	const [allRecipes, inventoryItems] = await Promise.all([
		prisma.recipe.findMany({
			where: { householdId },
			include: { ingredients: true },
		}),
		prisma.inventoryItem.findMany({
			where: { householdId },
			select: { name: true, quantity: true },
		}),
	])

	// Match data: how many ingredients does the user have for each recipe?
	const matches = matchRecipesWithInventory(allRecipes, inventoryItems)
	const matchData: Record<string, { matched: number; total: number }> = {}
	for (const match of matches) {
		if (match.totalIngredientsCount > 0) {
			matchData[match.recipe.id] = {
				matched: match.matchedIngredientsCount,
				total: match.totalIngredientsCount,
			}
		}
	}

	if (!weekStart) {
		return { pairings: {}, matchData }
	}

	// Load meal plan entries for this week with recipe ingredients
	const mealPlan = await prisma.mealPlan.findFirst({
		where: {
			householdId,
			weekStart: new Date(weekStart),
		},
		include: {
			entries: {
				include: {
					recipe: {
						include: { ingredients: true },
					},
				},
			},
		},
	})

	// Deduplicate in case the same recipe is in multiple meal slots
	const plannedRecipes = [
		...new Map(
			(mealPlan?.entries ?? []).map((e) => [e.recipe.id, e.recipe]),
		).values(),
	]

	if (plannedRecipes.length === 0) {
		return { pairings: {}, matchData }
	}

	const scores = scoreRecipePairings(plannedRecipes, allRecipes)

	// Convert to a lookup by recipeId
	const pairings: Record<
		string,
		{ overlapCount: number; overlapIngredients: string[]; score: number }
	> = {}
	for (const score of scores) {
		if (score.overlapCount > 0) {
			pairings[score.recipeId] = {
				overlapCount: score.overlapCount,
				overlapIngredients: score.overlapIngredients,
				score: score.score,
			}
		}
	}

	return { pairings, matchData }
}
