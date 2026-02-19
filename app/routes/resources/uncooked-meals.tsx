import { data } from 'react-router'
import { type Route } from './+types/uncooked-meals.ts'
import { prisma } from '#app/utils/db.server.ts'
import { getUserId } from '#app/utils/auth.server.ts'
import { getUserTier } from '#app/utils/subscription.server.ts'
import { serializeDate } from '#app/utils/date.ts'

const MEAL_TYPE_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'] as const

// Only show "did you make X?" after the meal would reasonably be done
const MEAL_REMINDER_AFTER_HOUR: Record<string, number> = {
	breakfast: 11, // 11am
	lunch: 15, // 3pm
	dinner: 21, // 9pm
	snack: 21, // 9pm
}

export async function loader({ request }: Route.LoaderArgs) {
	// Gracefully return empty when not authenticated — this is a fetcher-only
	// route, so redirecting to /login would cause the browser to navigate to
	// /login?redirectTo=/resources/uncooked-meals (a resource route with no UI).
	const userId = await getUserId(request)
	if (!userId) return data({ entries: [] })

	const tierInfo = await getUserTier(userId)
	if (!tierInfo.isProActive) return data({ entries: [] })

	const member = await prisma.householdMember.findFirst({
		where: { userId },
		select: { householdId: true },
	})
	if (!member) return data({ entries: [] })

	const householdId = member.householdId

	const now = new Date()
	const currentHour = now.getHours()
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

	// Filter out today's meals where it's too early to remind
	const filtered = entries.filter((entry) => {
		const entryDate = new Date(entry.date)
		const isToday = entryDate.getTime() === today.getTime()
		if (!isToday) return true // yesterday's meals always show
		const threshold = MEAL_REMINDER_AFTER_HOUR[entry.mealType] ?? 21
		return currentHour >= threshold
	})

	// Sort by yesterday first, then by meal type order
	const sorted = filtered.sort((a, b) => {
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
