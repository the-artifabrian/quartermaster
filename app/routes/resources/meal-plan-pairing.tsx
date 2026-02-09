import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { scoreRecipePairings } from '#app/utils/ingredient-overlap.server.ts'
import { type Route } from './+types/meal-plan-pairing.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const url = new URL(request.url)
	const weekStart = url.searchParams.get('weekStart')

	if (!weekStart) {
		return { pairings: {} }
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
		return { pairings: {} }
	}

	// Load all user recipes with ingredients
	const allRecipes = await prisma.recipe.findMany({
		where: { householdId },
		include: { ingredients: true },
	})

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

	return { pairings }
}
