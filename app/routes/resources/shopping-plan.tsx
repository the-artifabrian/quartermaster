import { data } from 'react-router'
import {
	formatWeekRange,
	formatShortDay,
	MEAL_TYPE_LABELS,
	serializeDate,
	type MealType,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	getRequestToday,
	getRequestWeekStart,
} from '#app/utils/today.server.ts'
import { loadMealShoppingDemand } from '#app/utils/meal-shopping.server.ts'
import { isStapleIngredient } from '#app/utils/recipe-matching.server.ts'
import { holdsSameAmount } from '#app/utils/shopping-contribution.server.ts'
import { LATER } from '#app/utils/shopping-horizon.ts'
import { demandIdentity } from '#app/utils/shopping-demand.server.ts'
import {
	annotateShoppingDemand,
	loadShoppingAvailability,
} from '#app/utils/shopping-list.server.ts'
import {
	planPickerLineStatus,
	type PlanPickerDay,
} from '#app/utils/shopping-plan-picker.ts'
import { type Route } from './+types/shopping-plan.ts'

/** The Meal's name in the picker, matching how the Plan card names it. */
function mealTitle({
	label,
	recipeTitles,
}: {
	label: string | null
	recipeTitles: string[]
}) {
	if (recipeTitles.length === 1) return recipeTitles[0]!
	if (label) return MEAL_TYPE_LABELS[label as MealType] ?? label
	if (recipeTitles.length > 1) return `${recipeTitles.length}-recipe Meal`
	return 'Meal'
}

/**
 * The Plan picker's choices for one week (#288). From Plan opens this instead
 * of generating a whole week: the household sees each Meal with the lines it
 * would contribute and ticks what it actually wants to buy.
 *
 * Cooked Recipe items are left out, as From Plan always left them out;
 * headings and optional ingredients never reach demand at all. Lines the
 * household would normally skip — Staple matches, plain pantry basics, and
 * names already on the list — still appear, unticked and with the reason,
 * because only the household knows when the usual assumption is wrong. A
 * Staple is the whole of that first reason since #289: there is no Out state
 * that could make one needed on its own.
 *
 * A line whose amount this Meal already put on Shopping is different: it
 * shows as on the list and can't be ticked, since adding it again would
 * change nothing. That reads the Meal's contributions the way the Meal-add
 * writer does, by Meal and stored canonical name, so the two always agree.
 */
export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	// The picker folds Meals on days before this, so it is the browser's day.
	const today = getRequestToday(request)
	const weekStart = getRequestWeekStart(request, today)

	const [mealPlan, availability, listedRows] = await Promise.all([
		prisma.mealPlan.findUnique({
			where: { householdId_weekStart: { householdId, weekStart } },
			select: {
				meals: {
					// Text-only Meals have no Shopping behavior (#98 story 43).
					where: { genericText: null },
					orderBy: [{ date: 'asc' }, { order: 'asc' }, { id: 'asc' }],
					select: {
						id: true,
						date: true,
						label: true,
						recipeItems: {
							orderBy: [{ order: 'asc' }, { id: 'asc' }],
							select: { recipeTitle: true },
						},
					},
				},
			},
		}),
		loadShoppingAvailability(prisma, householdId),
		prisma.shoppingListItem.findMany({
			where: { list: { householdId } },
			select: { name: true },
		}),
	])

	const meals = mealPlan?.meals ?? []
	const mealIds = meals.map((meal) => meal.id)
	const [demandByMeal, contributions] = await Promise.all([
		loadMealShoppingDemand(prisma, { mealIds }),
		prisma.mealShoppingContribution.findMany({
			where: { mealId: { in: mealIds } },
			select: {
				mealId: true,
				canonicalName: true,
				name: true,
				quantity: true,
				unit: true,
				item: { select: { checked: true, horizon: true } },
			},
		}),
	])
	const listedIdentities = new Set(
		listedRows.map((row) => demandIdentity(row.name)),
	)
	const contributedByMeal = new Map<
		string,
		Map<string, (typeof contributions)[number]>
	>()
	for (const contribution of contributions) {
		if (!contribution.mealId) continue
		const byIdentity =
			contributedByMeal.get(contribution.mealId) ??
			new Map<string, (typeof contributions)[number]>()
		byIdentity.set(contribution.canonicalName, contribution)
		contributedByMeal.set(contribution.mealId, byIdentity)
	}

	const days: PlanPickerDay[] = []
	for (const meal of meals) {
		const lines = demandByMeal.get(meal.id)?.lines ?? []
		if (lines.length === 0) continue
		const keptByAvailability = new Set(
			annotateShoppingDemand(lines, availability).lines.map(
				(line) => line.canonicalName,
			),
		)
		const date = serializeDate(meal.date)
		let day = days.find((entry) => entry.date === date)
		if (!day) {
			day = {
				date,
				label: formatShortDay(meal.date),
				meals: [],
			}
			days.push(day)
		}
		const label = meal.label
			? (MEAL_TYPE_LABELS[meal.label as MealType] ?? meal.label)
			: null
		const recipeTitles = meal.recipeItems.map((item) => item.recipeTitle)
		const title = mealTitle({ label: meal.label, recipeTitles })
		day.meals.push({
			id: meal.id,
			title,
			// A multi-Recipe Meal is named "4-recipe Meal", which says nothing
			// about the lines beneath it. The Plan card answers that by listing
			// the Recipe cards; the picker carries the same list.
			recipeTitles,
			// Two Meals on one day can share a Recipe title; the familiar label
			// is what tells them apart. Never repeated as its own title.
			label: label === title ? null : label,
			lines: lines.map((line) => {
				const contributed = contributedByMeal
					.get(meal.id)
					?.get(line.canonicalName)
				const status = planPickerLineStatus({
					canonicalName: line.canonicalName,
					contribution: contributed && {
						sameAmount: holdsSameAmount(contributed, line),
						onLater:
							!contributed.item.checked && contributed.item.horizon === LATER,
					},
					listedIdentities,
					keptByAvailability,
					// Explicit note Shopping text is deliberate, so the heuristic
					// stays off it: a household that wrote "olive oil" on a note
					// card meant to buy some.
					pantryStaple:
						!line.fromNote && isStapleIngredient({ name: line.name }),
				})
				return {
					canonicalName: line.canonicalName,
					name: line.name,
					quantity: line.quantity,
					unit: line.unit,
					status,
					...(status === 'changed' && contributed
						? {
								contributed: {
									quantity: contributed.quantity,
									unit: contributed.unit,
								},
							}
						: {}),
				}
			}),
		})
	}

	return data(
		{
			weekStart: serializeDate(weekStart),
			weekLabel: formatWeekRange(weekStart, today),
			today,
			days,
		},
		{ headers: { 'Cache-Control': 'private, no-store' } },
	)
}
