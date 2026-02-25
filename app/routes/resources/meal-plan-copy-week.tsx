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
import { requireProTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/meal-plan-copy-week.ts'

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireProTier(request)
	const formData = await request.formData()

	const weekStartStr = formData.get('weekStart')
	invariantResponse(typeof weekStartStr === 'string', 'Week start is required')

	const weekStart = getWeekStart(parseDate(weekStartStr))
	const mealPlan = await prisma.mealPlan.findFirst({
		where: { householdId, weekStart },
		include: { entries: true },
	})
	invariantResponse(
		mealPlan && mealPlan.entries.length > 0,
		'No entries to copy',
	)

	const nextWeekStart = getNextWeek(weekStart)

	// Get or create next week's meal plan
	let nextMealPlan = await prisma.mealPlan.findFirst({
		where: { householdId, weekStart: nextWeekStart },
	})

	if (!nextMealPlan) {
		nextMealPlan = await prisma.mealPlan.create({
			data: { userId, householdId, weekStart: nextWeekStart },
		})
	}

	// Duplicate entries with dates shifted +7 days
	for (const entry of mealPlan.entries) {
		const newDate = addDaysUTC(new Date(entry.date), 7)
		const existing = await prisma.mealPlanEntry.findUnique({
			where: {
				mealPlanId_date_mealType_recipeId: {
					mealPlanId: nextMealPlan.id,
					date: newDate,
					mealType: entry.mealType,
					recipeId: entry.recipeId,
				},
			},
		})
		if (!existing) {
			await prisma.mealPlanEntry.create({
				data: {
					mealPlanId: nextMealPlan.id,
					date: newDate,
					mealType: entry.mealType,
					recipeId: entry.recipeId,
					servings: entry.servings,
				},
			})
		}
	}

	return redirect(`/plan?weekStart=${serializeDate(nextWeekStart)}`)
}
