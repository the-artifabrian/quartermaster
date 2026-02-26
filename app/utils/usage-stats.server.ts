import { prisma } from './db.server.ts'

export async function getUsageStats(userId: string, householdId: string) {
	const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

	const [
		recipeCount,
		cookCount,
		mealPlanWeekCount,
		eventCounts,
		mostCookedRaw,
		uniqueRecipesCooked,
	] = await Promise.all([
		prisma.recipe.count({ where: { householdId } }),
		prisma.cookingLog.count({ where: { userId } }),
		prisma.mealPlan.count({
			where: { householdId, entries: { some: {} } },
		}),
		prisma.usageEvent.groupBy({
			by: ['type'],
			where: { householdId, createdAt: { gte: ninetyDaysAgo } },
			_count: { id: true },
		}),
		prisma.cookingLog.groupBy({
			by: ['recipeId'],
			where: { userId },
			_count: { id: true },
			orderBy: { _count: { id: 'desc' } },
			take: 1,
		}),
		prisma.cookingLog.groupBy({
			by: ['recipeId'],
			where: { userId },
		}),
	])

	// Most cooked recipe title
	let mostCookedRecipe: { title: string; count: number } | null = null
	if (mostCookedRaw.length > 0) {
		const recipe = await prisma.recipe.findUnique({
			where: { id: mostCookedRaw[0]!.recipeId },
			select: { title: true },
		})
		if (recipe) {
			mostCookedRecipe = {
				title: recipe.title,
				count: mostCookedRaw[0]!._count.id,
			}
		}
	}

	const eventCountMap = Object.fromEntries(
		eventCounts.map((e) => [e.type, e._count.id]),
	) as Record<string, number>

	return {
		recipeCount,
		cookCount,
		uniqueRecipesCooked: uniqueRecipesCooked.length,
		mostCookedRecipe,
		mealPlanWeekCount,
		eventCounts: eventCountMap,
	}
}
