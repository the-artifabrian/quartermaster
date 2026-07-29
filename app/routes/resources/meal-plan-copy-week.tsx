import { invariantResponse } from '@epic-web/invariant'
import { redirect } from 'react-router'
import {
	addDaysUTC,
	getWeekStart,
	getNextWeek,
	parseDate,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	ensureMealPlan,
	ensureMealPlanEntry,
} from '#app/utils/meal-plan.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/meal-plan-copy-week.ts'

export async function action({ request }: Route.ActionArgs) {
	const { householdId } = await requireProTier(request)
	const formData = await request.formData()

	const weekStartStr = formData.get('weekStart')
	invariantResponse(typeof weekStartStr === 'string', 'Week start is required')

	const weekStart = getWeekStart(parseDate(weekStartStr))
	const mealPlan = await prisma.mealPlan.findUnique({
		where: { householdId_weekStart: { householdId, weekStart } },
		include: { entries: true },
	})
	invariantResponse(
		mealPlan && mealPlan.entries.length > 0,
		'No entries to copy',
	)

	const nextWeekStart = getNextWeek(weekStart)

	const nextMealPlan = await ensureMealPlan(prisma, {
		householdId,
		weekStart: nextWeekStart,
	})

	// Duplicate entries with dates shifted +7 days
	for (const entry of mealPlan.entries) {
		const newDate = addDaysUTC(new Date(entry.date), 7)
		await ensureMealPlanEntry(prisma, {
			mealPlanId: nextMealPlan.id,
			date: newDate,
			mealType: entry.mealType,
			recipeId: entry.recipeId,
			servings: entry.servings,
		})
	}

	return redirect(`/plan?weekStart=${serializeDate(nextWeekStart)}`)
}
