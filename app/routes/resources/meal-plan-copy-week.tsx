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
	groupSnapshotEntries,
	type SnapshotSectionSeed,
} from '#app/utils/menu-snapshot.ts'
import {
	servingInstantFromWallTime,
	servingWallTime,
} from '#app/utils/serving-time.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/meal-plan-copy-week.ts'

type CopyableMeal = {
	label: string | null
	genericText: string | null
	sections: Array<{ id: string; name: string | null }>
	noteItems: Array<{
		sectionId: string | null
		order: number
		text: string
		shoppingLines: Array<{
			name: string
			quantity: string | null
			unit: string | null
		}>
	}>
	recipeItems: Array<{
		sectionId: string | null
		order: number
		recipeId: string | null
		recipeTitle: string
		scaleMultiplier: number
		note: string | null
	}>
}

const MEAL_SNAPSHOT_INCLUDE = {
	recipeItems: { orderBy: { order: 'asc' } },
	sections: {
		orderBy: { order: 'asc' },
		select: { id: true, name: true },
	},
	noteItems: {
		orderBy: { order: 'asc' },
		select: {
			sectionId: true,
			order: true,
			text: true,
			shoppingLines: {
				orderBy: { order: 'asc' },
				select: { name: true, quantity: true, unit: true },
			},
		},
	},
} as const

/**
 * The frozen snapshot structure (#107) as section seeds — what Copy Week
 * recreates on the target Meal and what identifies "the same content" below.
 */
function snapshotSections(meal: CopyableMeal): SnapshotSectionSeed[] {
	return groupSnapshotEntries(
		meal.sections,
		meal.recipeItems.filter((item) => item.sectionId != null),
		meal.noteItems,
	).map((group) => ({
		name: group.name,
		items: group.entries.map((entry) =>
			entry.kind === 'recipe'
				? {
						kind: 'recipe' as const,
						recipeId: entry.item.recipeId,
						recipeTitle: entry.item.recipeTitle,
						scaleMultiplier: entry.item.scaleMultiplier,
						note: entry.item.note,
					}
				: {
						kind: 'note' as const,
						text: entry.item.text,
						shoppingLines: entry.item.shoppingLines.map((line) => ({
							name: line.name,
							quantity: line.quantity,
							unit: line.unit,
						})),
					},
		),
	}))
}

/** What makes a copied Meal "already there" on the target day — label, text,
 * the ordered unsectioned Recipe identities with multipliers and notes, and
 * the full frozen snapshot structure. Lets Copy Week be pressed twice without
 * stacking duplicates (the legacy unique constraint used to give this for
 * free). */
function mealContentKey(dateStr: string, meal: CopyableMeal) {
	return JSON.stringify([
		dateStr,
		meal.label,
		meal.genericText,
		meal.recipeItems
			.filter((item) => item.sectionId == null)
			.map((item) => [
				item.recipeId,
				item.recipeTitle,
				item.scaleMultiplier,
				item.note,
			]),
		snapshotSections(meal),
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
				include: MEAL_SNAPSHOT_INCLUDE,
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
		include: MEAL_SNAPSHOT_INCLUDE,
	})
	const existingKeys = new Set(
		existingMeals.map((meal) => mealContentKey(serializeDate(meal.date), meal)),
	)

	// Duplicate Meals with dates shifted +7 days — snapshot sections, notes,
	// and note Shopping lines included, still frozen at their source Menu
	// revision. Cooked/completed state does not copy — next week starts fresh.
	// A serving time re-anchors as the same wall-clock time in its originating
	// zone (a flat +7d of the instant would drift an hour across a DST
	// boundary).
	for (const meal of mealPlan.meals) {
		const newDate = addDaysUTC(meal.date, 7)
		const key = mealContentKey(serializeDate(newDate), meal)
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
			sourceMenuId: meal.sourceMenuId,
			sourceMenuRevision: meal.sourceMenuRevision,
			items: meal.recipeItems
				.filter((item) => item.sectionId == null)
				.map((item) => ({
					recipeId: item.recipeId,
					recipeTitle: item.recipeTitle,
					scaleMultiplier: item.scaleMultiplier,
					note: item.note,
				})),
			sections: snapshotSections(meal),
		})
	}

	return redirect(`/plan?weekStart=${serializeDate(nextWeekStart)}`)
}
