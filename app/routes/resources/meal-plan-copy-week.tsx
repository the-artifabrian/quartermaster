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
import { ensureMealPlan } from '#app/utils/meal-plan.server.ts'
import { createMealWithItems } from '#app/utils/meal.server.ts'
import {
	servingInstantFromWallTime,
	servingWallTime,
} from '#app/utils/serving-time.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/meal-plan-copy-week.ts'

/** What makes a copied Meal "already there" on the target day — label, text,
 * and the ordered Recipe identities with their multipliers. Lets Copy Week be
 * pressed twice without stacking duplicates (the legacy unique constraint used
 * to give this for free). */
function mealContentKey(meal: {
	dateStr: string
	label: string | null
	genericText: string | null
	items: Array<{
		recipeId: string | null
		recipeTitle: string
		scaleMultiplier: number
	}>
}) {
	return JSON.stringify([
		meal.dateStr,
		meal.label,
		meal.genericText,
		meal.items.map((item) => [
			item.recipeId,
			item.recipeTitle,
			item.scaleMultiplier,
		]),
	])
}

export async function action({ request }: Route.ActionArgs) {
	const { householdId } = await requireProTier(request)
	const formData = await request.formData()

	const weekStartStr = formData.get('weekStart')
	invariantResponse(typeof weekStartStr === 'string', 'Week start is required')

	const weekStart = getWeekStart(parseDate(weekStartStr))
	const mealPlan = await prisma.mealPlan.findUnique({
		where: { householdId_weekStart: { householdId, weekStart } },
		include: {
			meals: {
				orderBy: [{ date: 'asc' }, { order: 'asc' }],
				include: { recipeItems: { orderBy: { order: 'asc' } } },
			},
		},
	})
	invariantResponse(mealPlan && mealPlan.meals.length > 0, 'No meals to copy')

	const nextWeekStart = getNextWeek(weekStart)

	const nextMealPlan = await ensureMealPlan(prisma, {
		householdId,
		weekStart: nextWeekStart,
	})
	const existingMeals = await prisma.meal.findMany({
		where: { mealPlanId: nextMealPlan.id },
		include: { recipeItems: { orderBy: { order: 'asc' } } },
	})
	const existingKeys = new Set(
		existingMeals.map((meal) =>
			mealContentKey({
				dateStr: serializeDate(meal.date),
				label: meal.label,
				genericText: meal.genericText,
				items: meal.recipeItems,
			}),
		),
	)

	// Duplicate Meals with dates shifted +7 days. Cooked/completed state does
	// not copy — next week starts fresh. A serving time re-anchors as the same
	// wall-clock time in its originating zone (a flat +7d of the instant would
	// drift an hour across a DST boundary).
	for (const meal of mealPlan.meals) {
		const newDate = addDaysUTC(meal.date, 7)
		const key = mealContentKey({
			dateStr: serializeDate(newDate),
			label: meal.label,
			genericText: meal.genericText,
			items: meal.recipeItems,
		})
		if (existingKeys.has(key)) continue
		existingKeys.add(key)

		const servingAt =
			meal.servingAt && meal.servingTimeZone
				? servingInstantFromWallTime(
						newDate,
						servingWallTime(meal.servingAt, meal.servingTimeZone),
						meal.servingTimeZone,
					)
				: null

		await createMealWithItems(prisma, {
			mealPlanId: nextMealPlan.id,
			date: newDate,
			label: meal.label,
			genericText: meal.genericText,
			servingAt,
			servingTimeZone: servingAt ? meal.servingTimeZone : null,
			guestCount: meal.guestCount,
			items: meal.recipeItems.map((item) => ({
				recipeId: item.recipeId,
				recipeTitle: item.recipeTitle,
				scaleMultiplier: item.scaleMultiplier,
			})),
		})
	}

	return redirect(`/plan?weekStart=${serializeDate(nextWeekStart)}`)
}
