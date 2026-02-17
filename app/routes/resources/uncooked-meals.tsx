import { data } from 'react-router'
import { type Route } from './+types/uncooked-meals.ts'
import { prisma } from '#app/utils/db.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { serializeDate } from '#app/utils/date.ts'

const MEAL_TYPE_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'] as const

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireProTier(request)

	const now = new Date()
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)

	const entries = await prisma.mealPlanEntry.findMany({
		where: {
			cooked: false,
			date: { gte: yesterday, lte: today },
			mealPlan: { householdId },
		},
		select: {
			id: true,
			date: true,
			mealType: true,
			servings: true,
			recipe: { select: { id: true, title: true } },
		},
	})

	// Sort by yesterday first, then by meal type order
	const sorted = entries.sort((a, b) => {
		const dateA = new Date(a.date).getTime()
		const dateB = new Date(b.date).getTime()
		if (dateA !== dateB) return dateA - dateB
		const orderA = MEAL_TYPE_ORDER.indexOf(
			a.mealType as (typeof MEAL_TYPE_ORDER)[number],
		)
		const orderB = MEAL_TYPE_ORDER.indexOf(
			b.mealType as (typeof MEAL_TYPE_ORDER)[number],
		)
		return orderA - orderB
	})

	return data({
		entries: sorted.map((entry) => ({
			entryId: entry.id,
			recipeId: entry.recipe.id,
			recipeTitle: entry.recipe.title,
			date: serializeDate(new Date(entry.date)),
			mealType: entry.mealType,
			servings: entry.servings,
		})),
	})
}
