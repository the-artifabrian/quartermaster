import { prisma } from './db.server.ts'

export async function getUsageStats(userId: string, householdId: string) {
	const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

	const [
		recipeCount,
		cookCount,
		mealPlanWeekCount,
		eventCounts,
		pairingCount,
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
		prisma.usageEvent.count({
			where: {
				householdId,
				type: 'pairing_recipe_assigned',
				createdAt: { gte: ninetyDaysAgo },
			},
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

	// Count distinct weeks from pairing events
	const pairingEvents = await prisma.usageEvent.findMany({
		where: {
			householdId,
			type: 'pairing_recipe_assigned',
			createdAt: { gte: ninetyDaysAgo },
		},
		select: { createdAt: true },
	})
	const pairingWeeks = new Set(
		pairingEvents.map((e) => {
			const d = new Date(e.createdAt)
			const jan1 = new Date(d.getFullYear(), 0, 1)
			const weekNum = Math.ceil(
				((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7,
			)
			return `${d.getFullYear()}-W${weekNum}`
		}),
	)

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
		pairingAssignments: pairingCount,
		weeksWithPairings: pairingWeeks.size,
		eventCounts: eventCountMap,
	}
}
