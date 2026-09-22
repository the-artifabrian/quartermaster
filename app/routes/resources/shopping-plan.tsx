import { data } from 'react-router'
import {
	formatMonthDay,
	formatWeekRange,
	formatWeekdayName,
	getCurrentWeekStart,
	getWeekStart,
	MEAL_TYPE_LABELS,
	parseDate,
	serializeDate,
	type MealType,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { loadMealShoppingDemand } from '#app/utils/meal-shopping.server.ts'
import { isStapleIngredient } from '#app/utils/recipe-matching.server.ts'
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
 * rows already on the list — still appear, unticked and with the reason,
 * because only the household knows when the usual assumption is wrong.
 */
export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const weekStartParam = new URL(request.url).searchParams.get('weekStart')
	const weekStart = weekStartParam
		? getWeekStart(parseDate(weekStartParam))
		: getCurrentWeekStart()

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
	const demandByMeal = await loadMealShoppingDemand(prisma, {
		mealIds: meals.map((meal) => meal.id),
		includeCooked: false,
	})
	const listedIdentities = new Set(
		listedRows.map((row) => demandIdentity(row.name)),
	)
	// Once the household has recorded a Staple, its state is authoritative:
	// a normal one is already gone at the availability seam, and an Out one is
	// needed however ordinary the hardcoded heuristic thinks the item is.
	const recordedStapleIdentities = new Set(
		availability.kind === 'household-staples'
			? availability.staples.map((staple) => demandIdentity(staple.displayName))
			: [],
	)

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
				label: `${formatWeekdayName(meal.date)} · ${formatMonthDay(meal.date)}`,
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
			lines: lines.map((line) => ({
				canonicalName: line.canonicalName,
				name: line.name,
				quantity: line.quantity,
				unit: line.unit,
				status: planPickerLineStatus({
					canonicalName: line.canonicalName,
					listedIdentities,
					keptByAvailability,
					// Explicit note Shopping text is deliberate, so the heuristic
					// stays off it — the same exception the availability seam makes.
					pantryStaple:
						!line.fromNote &&
						!recordedStapleIdentities.has(line.canonicalName) &&
						isStapleIngredient({ name: line.name }),
				}),
			})),
		})
	}

	return data(
		{
			weekStart: serializeDate(weekStart),
			weekLabel: formatWeekRange(weekStart),
			days,
		},
		{ headers: { 'Cache-Control': 'private, no-store' } },
	)
}
