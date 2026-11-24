/**
 * The sample Household builder fills one Household with Recipes, Staples, a
 * Plan for the week of `today` and the Shopping that Plan leads to, through
 * the same writers real use goes through.
 *
 * Failure list:
 * - Running it twice on the same day adds a second copy of the Recipes,
 *   Meals, Staples or Shopping rows, or doubles the Meals' amounts.
 * - Running it again a week later plans a second week and stacks its
 *   amounts on Shopping.
 * - Running it on Monday and again on Thursday ends somewhere a clean
 *   Thursday run doesn't (Meals not cooked, amounts added twice).
 * - A run that stopped partway (some Recipes or Meals saved, Shopping not
 *   built) can't be finished by running it again.
 * - A Shopping row doesn't match its Meal's demand, so Update Shopping on a
 *   seeded Meal changes the list.
 * - A Meal lands outside the week of `today` (a Sunday or Monday edge, or a
 *   day shifted by a timezone), so the Plan opens on an empty week.
 * - Meals before today aren't cooked, or a Meal from today on is.
 * - The cooked state depends on the weekday in a way that changes Shopping:
 *   a Meal marked cooked before its amounts are added adds nothing.
 * - A Recipe line doesn't parse into amount, unit and name ("2 tins
 *   chickpeas" read as an ingredient called "tins chickpeas"), so it can't
 *   scale or combine with the same ingredient elsewhere.
 * - A Staple's ingredient still lands on Shopping, because the Staples were
 *   saved after the Meals were added.
 * - The wrong rows are checked, or a check is made before the Meal amounts
 *   it should cover arrive.
 * - Shopping doesn't read as a week part-way through: a row only Meals up
 *   to the bought day need is left unchecked, a row a later Meal also needs
 *   is checked, the typed rows lose their own checked flags, or the unchecked
 *   list is far from the 8 to 12 rows a real list holds.
 * - On a day after the bought day, Shopping still lists rows only for
 *   Meals already cooked.
 * - The week looks empty on a phone: most days hold one Meal, no dinner has
 *   a side, or a day is crowded past three Meals.
 * - A day has no dinner, or the week loses its touches: Saturday's leftovers
 *   night and the Sunday Meals still to buy.
 * - A fuller week turns Shopping into a list nobody would keep, far more
 *   rows than a week's shop.
 * - The favourites aren't marked, or a run marks others.
 * - The Menu is missing, saved twice on a second run, names a Recipe outside
 *   the Household, loses its note card's Shopping lines, or isn't a shape the
 *   Menu builder can load (no unnamed section, a Recipe card with no
 *   multiplier).
 */
import { expect, test } from 'vitest'
import { createOwnHousehold } from '#app/utils/auth.server.ts'
import { addDaysUTC, getWeekStart, parseDate, serializeDate } from './date.ts'
import { prisma } from './db.server.ts'
import { CONTAINER_START, COMMON_UNITS } from './ingredient-parser.ts'
import { parseAmount } from './fractions.ts'
import {
	SAMPLE_HOUSEHOLD,
	type SampleHouseholdContent,
} from './sample-household-data.ts'
import { fillSampleHousehold } from './sample-household.server.ts'
import { addMealToShopping } from './shopping-adds.server.ts'
import { combineRowDisplay, demandIdentity } from './shopping-demand.server.ts'
import { createUser } from '#tests/db-utils.ts'
import '#tests/setup/db-setup.ts'

// A Thursday, so the week has Meals on both sides of today.
const THURSDAY = '2026-11-26'

async function newHousehold() {
	const user = await prisma.user.create({ data: createUser() })
	const household = await createOwnHousehold(prisma, user)
	return { userId: user.id, householdId: household.id }
}

/** Everything the builder writes, with ids left out so two runs compare. */
async function snapshot(householdId: string) {
	const recipes = await prisma.recipe.findMany({
		where: { householdId },
		orderBy: { title: 'asc' },
		select: {
			title: true,
			isFavorite: true,
			activeTime: true,
			totalTime: true,
			yieldAmount: true,
			yieldLabel: true,
			ingredients: {
				orderBy: { order: 'asc' },
				select: { name: true, amount: true, unit: true, notes: true },
			},
			instructions: { orderBy: { order: 'asc' }, select: { content: true } },
			metadataAssignments: {
				select: { value: { select: { dimension: true, name: true } } },
				orderBy: { value: { nameKey: 'asc' } },
			},
		},
	})
	const meals = await prisma.meal.findMany({
		where: { mealPlan: { householdId } },
		orderBy: [{ date: 'asc' }, { order: 'asc' }],
		select: {
			date: true,
			label: true,
			genericText: true,
			completed: true,
			recipeItems: {
				orderBy: { order: 'asc' },
				select: { recipeTitle: true, cooked: true, scaleMultiplier: true },
			},
		},
	})
	const staples = await prisma.householdIngredient.findMany({
		where: { householdId },
		orderBy: { canonicalKey: 'asc' },
		select: { displayName: true, isStaple: true },
	})
	const rows = await prisma.shoppingListItem.findMany({
		where: { list: { householdId } },
		orderBy: [{ name: 'asc' }, { horizon: 'asc' }],
		select: {
			name: true,
			quantity: true,
			unit: true,
			checked: true,
			horizon: true,
			source: true,
			mealContributions: {
				orderBy: { canonicalName: 'asc' },
				select: {
					canonicalName: true,
					quantity: true,
					unit: true,
					meal: { select: { date: true, label: true } },
				},
			},
		},
	})
	const menus = await prisma.menu.findMany({
		where: { householdId },
		orderBy: { title: 'asc' },
		select: {
			title: true,
			titleKey: true,
			description: true,
			sections: {
				orderBy: { order: 'asc' },
				select: {
					name: true,
					order: true,
					items: {
						orderBy: { order: 'asc' },
						select: {
							kind: true,
							order: true,
							note: true,
							recipeTitle: true,
							scaleMultiplier: true,
							recipe: { select: { title: true } },
							shoppingLines: {
								orderBy: { order: 'asc' },
								select: { name: true, quantity: true, unit: true },
							},
						},
					},
				},
			},
		},
	})
	return { recipes, meals, staples, rows, menus }
}

test('a second run on the same day adds nothing', async () => {
	const { userId, householdId } = await newHousehold()
	await fillSampleHousehold(prisma, { userId, householdId, today: THURSDAY })
	const first = await snapshot(householdId)
	await fillSampleHousehold(prisma, { userId, householdId, today: THURSDAY })

	expect(await snapshot(householdId)).toEqual(first)
	expect(first.recipes).toHaveLength(SAMPLE_HOUSEHOLD.recipes.length)
	expect(first.meals).toHaveLength(SAMPLE_HOUSEHOLD.plan.length)
})

test('a run a week later leaves the Plan and Shopping as they were', async () => {
	const { userId, householdId } = await newHousehold()
	await fillSampleHousehold(prisma, { userId, householdId, today: THURSDAY })
	const first = await snapshot(householdId)
	const weekLater = serializeDate(addDaysUTC(parseDate(THURSDAY), 7))
	await fillSampleHousehold(prisma, { userId, householdId, today: weekLater })

	expect(await snapshot(householdId)).toEqual(first)
})

test('a run on Monday and another on Thursday end where a Thursday run does', async () => {
	const clean = await newHousehold()
	await fillSampleHousehold(prisma, { ...clean, today: THURSDAY })

	const twice = await newHousehold()
	await fillSampleHousehold(prisma, { ...twice, today: '2026-11-23' })
	await fillSampleHousehold(prisma, { ...twice, today: THURSDAY })

	expect(await snapshot(twice.householdId)).toEqual(
		await snapshot(clean.householdId),
	)
})

test('running it again finishes a run that stopped partway', async () => {
	const clean = await newHousehold()
	await fillSampleHousehold(prisma, { ...clean, today: THURSDAY })
	const expected = await snapshot(clean.householdId)

	const nothingAfter: SampleHouseholdContent = {
		...SAMPLE_HOUSEHOLD,
		staples: [],
		menus: [],
		plan: [],
		shopping: { manual: [], boughtThroughDay: -1 },
	}
	// The builder writes Recipes, then Staples, then Menus, then Meals, then
	// Shopping, so these are the places a run can stop.
	const stops: SampleHouseholdContent[] = [
		{ ...nothingAfter, recipes: SAMPLE_HOUSEHOLD.recipes.slice(0, 6) },
		{ ...nothingAfter, recipes: SAMPLE_HOUSEHOLD.recipes },
		// Stopped after three Meals, before any row was checked.
		{
			...SAMPLE_HOUSEHOLD,
			plan: SAMPLE_HOUSEHOLD.plan.slice(0, 3),
			shopping: { ...SAMPLE_HOUSEHOLD.shopping, boughtThroughDay: -1 },
		},
		{
			...SAMPLE_HOUSEHOLD,
			shopping: { ...SAMPLE_HOUSEHOLD.shopping, boughtThroughDay: -1 },
		},
	]
	for (const content of stops) {
		const interrupted = await newHousehold()
		await fillSampleHousehold(prisma, {
			...interrupted,
			today: THURSDAY,
			content,
		})
		await fillSampleHousehold(prisma, { ...interrupted, today: THURSDAY })
		expect(await snapshot(interrupted.householdId)).toEqual(expected)
	}
})

/**
 * Shopping's amounts as the page shows them. A row Add to Shopping made
 * keeps a copy of the first Meal line that fed it, and Update Shopping
 * rewrites that copy with the line of the Meal it updates. The amount shown
 * comes from the Meals and doesn't change, but a row two Meals share can
 * change its name ("red onion" to "red onions"). Real use does the same, so
 * rows are compared by ingredient and amount, not by that name.
 */
async function shoppingAsShown(householdId: string) {
	const { rows } = await snapshot(householdId)
	return rows
		.map((row) => ({
			ingredient: demandIdentity(row.name),
			shown: combineRowDisplay({
				...row,
				contributions: row.mealContributions,
			}),
			checked: row.checked,
			horizon: row.horizon,
			source: row.source,
			mealContributions: row.mealContributions,
		}))
		.sort((a, b) => a.ingredient.localeCompare(b.ingredient))
}

test('Update Shopping on every seeded Meal changes nothing', async () => {
	const { userId, householdId } = await newHousehold()
	await fillSampleHousehold(prisma, { userId, householdId, today: THURSDAY })
	const before = await shoppingAsShown(householdId)
	const list = await prisma.shoppingList.findUniqueOrThrow({
		where: { householdId },
	})
	const meals = await prisma.meal.findMany({
		where: { mealPlan: { householdId }, genericText: null },
		select: { id: true },
	})

	for (const meal of meals) {
		const result = await addMealToShopping(prisma, {
			mealId: meal.id,
			householdId,
			listId: list.id,
			refresh: true,
		})
		expect(result).toMatchObject({
			createdRowCount: 0,
			attachedCount: 0,
			updatedContributionCount: 0,
			removedContributionCount: 0,
			promotedRowCount: 0,
			skippedCheckedNames: [],
		})
	}
	expect(await shoppingAsShown(householdId)).toEqual(before)
})

test('every Meal lands in the week of today, cooked only before today, and Shopping is the same whatever the weekday', async () => {
	const monday = parseDate('2026-11-23')
	const shoppingByDay: unknown[] = []
	for (let day = 0; day < 7; day++) {
		const today = serializeDate(addDaysUTC(monday, day))
		const { userId, householdId } = await newHousehold()
		await fillSampleHousehold(prisma, { userId, householdId, today })

		// What the Plan page reads for this week.
		const weekStart = getWeekStart(parseDate(today))
		const plans = await prisma.mealPlan.findMany({
			where: { householdId },
			select: { weekStart: true, meals: { select: { date: true } } },
		})
		expect(plans.map((plan) => serializeDate(plan.weekStart))).toEqual([
			serializeDate(weekStart),
		])

		const { meals, rows } = await snapshot(householdId)
		expect(meals).toHaveLength(SAMPLE_HOUSEHOLD.plan.length)
		for (const meal of meals) {
			const date = serializeDate(meal.date)
			expect(meal.date.getTime()).toBe(parseDate(date).getTime())
			expect(date >= serializeDate(weekStart)).toBe(true)
			expect(date <= serializeDate(addDaysUTC(weekStart, 6))).toBe(true)
			const cooked =
				meal.genericText != null
					? meal.completed
					: meal.recipeItems.every((item) => item.cooked)
			expect({ date, cooked }).toEqual({ date, cooked: date < today })
		}

		// Nothing left to buy is only for a Meal that's already cooked.
		for (const row of rows) {
			if (row.checked || row.source === 'manual') continue
			const days = row.mealContributions.map((c) => serializeDate(c.meal!.date))
			expect({
				row: row.name,
				forTodayOrLater: days.some((d) => d >= today),
			}).toEqual({
				row: row.name,
				forTodayOrLater: true,
			})
		}

		const shopping = rows.map(({ mealContributions, ...row }) => ({
			...row,
			mealContributions: mealContributions.map(({ meal, ...rest }) => ({
				...rest,
				weekday: meal ? (meal.date.getUTCDay() + 6) % 7 : null,
				label: meal?.label,
			})),
		}))
		shoppingByDay.push(shopping)
	}
	for (const shopping of shoppingByDay) {
		expect(shopping).toEqual(shoppingByDay[0])
	}
})

test('every Recipe line is read as amount, unit and name', async () => {
	const { userId, householdId } = await newHousehold()
	await fillSampleHousehold(prisma, { userId, householdId, today: THURSDAY })

	const ingredients = await prisma.ingredient.findMany({
		where: { recipe: { householdId }, isHeading: false },
		select: { name: true, amount: true, unit: true },
	})
	const lineCount = SAMPLE_HOUSEHOLD.recipes
		.flatMap((recipe) => recipe.ingredients)
		.filter((line) => typeof line === 'string').length
	expect(ingredients).toHaveLength(lineCount)

	const misread = ingredients.filter(({ name, amount, unit }) => {
		const firstWord = name.split(/\s+/)[0]!.toLowerCase()
		return (
			/^[\d½¼¾⅓⅔]/.test(name) ||
			COMMON_UNITS.has(firstWord) ||
			CONTAINER_START.test(name) ||
			(amount !== null && parseAmount(amount) === null) ||
			(unit !== null && !COMMON_UNITS.has(unit.toLowerCase()))
		)
	})
	expect(misread).toEqual([])
})

test('Staples stay off Shopping, and the start of the week is bought', async () => {
	const { userId, householdId } = await newHousehold()
	await fillSampleHousehold(prisma, { userId, householdId, today: THURSDAY })
	const { staples, rows } = await snapshot(householdId)

	expect(staples.map((staple) => staple.displayName).sort()).toEqual(
		[...SAMPLE_HOUSEHOLD.staples].sort(),
	)
	expect(staples.every((staple) => staple.isStaple)).toBe(true)

	const stapleIds = new Set(SAMPLE_HOUSEHOLD.staples.map(demandIdentity))
	expect(rows.filter((row) => stapleIds.has(demandIdentity(row.name)))).toEqual(
		[],
	)

	// Monday is 0. A Meal row is bought when every Meal it feeds is on
	// boughtThroughDay or before.
	const { boughtThroughDay } = SAMPLE_HOUSEHOLD.shopping
	const weekday = (date: Date) => (date.getUTCDay() + 6) % 7
	const mealRows = rows.filter((row) => row.source !== 'manual')
	for (const row of mealRows) {
		const days = row.mealContributions.map((c) => weekday(c.meal!.date))
		expect(days.length).toBeGreaterThan(0)
		expect({ row: row.name, checked: row.checked }).toEqual({
			row: row.name,
			checked: days.every((day) => day <= boughtThroughDay),
		})
	}
	// Both kinds are there: a row only the early Meals need, and one an early
	// and a late Meal share.
	expect(mealRows.some((row) => row.checked)).toBe(true)
	expect(
		mealRows.some(
			(row) =>
				!row.checked &&
				row.mealContributions.some(
					(c) => weekday(c.meal!.date) <= boughtThroughDay,
				),
		),
	).toBe(true)

	const manualRows = rows.filter((row) => row.source === 'manual')
	expect(
		manualRows.map((row) => [row.name, row.horizon, row.checked]).sort(),
	).toEqual(
		SAMPLE_HOUSEHOLD.shopping.manual
			.map((row) => [row.name, row.horizon, row.checked ?? false])
			.sort(),
	)

	// What the Next shop shows still to buy.
	const toBuy = rows.filter((row) => !row.checked && row.horizon === 'next')
	expect(toBuy.length).toBeGreaterThanOrEqual(8)
	expect(toBuy.length).toBeLessThanOrEqual(12)
	// Bought and still to buy together stay the size of a week's shop.
	expect(rows.length).toBeLessThanOrEqual(70)
})

test('the week has two or three Meals on most days, and sides at a few dinners', async () => {
	const { userId, householdId } = await newHousehold()
	await fillSampleHousehold(prisma, { userId, householdId, today: THURSDAY })
	const { meals, rows } = await snapshot(householdId)
	const weekday = (date: Date) => (date.getUTCDay() + 6) % 7

	const byDay = Array.from({ length: 7 }, (_, day) =>
		meals.filter((meal) => weekday(meal.date) === day),
	)
	for (const [day, dayMeals] of byDay.entries()) {
		expect(dayMeals.length, `Meals on day ${day}`).toBeLessThanOrEqual(3)
		expect(
			dayMeals.filter((meal) => meal.label === 'dinner'),
			`dinners on day ${day}`,
		).toHaveLength(1)
	}
	expect(
		byDay.filter((dayMeals) => dayMeals.length >= 2).length,
	).toBeGreaterThanOrEqual(5)

	const dinnersWithASide = meals.filter(
		(meal) => meal.label === 'dinner' && meal.recipeItems.length >= 2,
	)
	expect(dinnersWithASide.length).toBeGreaterThanOrEqual(3)

	// Saturday is leftovers night.
	const saturdayDinner = byDay[5]!.find((meal) => meal.label === 'dinner')
	expect(saturdayDinner?.genericText).toMatch(/leftover/i)

	// Sunday is still to buy: nothing a Sunday Meal needs is checked.
	const sundayRows = rows.filter((row) =>
		row.mealContributions.some((c) => weekday(c.meal!.date) === 6),
	)
	expect(sundayRows.length).toBeGreaterThan(0)
	expect(sundayRows.filter((row) => row.checked)).toEqual([])
})

test('three Recipes are favourites, and the Menu is saved once in a shape the builder loads', async () => {
	const { userId, householdId } = await newHousehold()
	await fillSampleHousehold(prisma, { userId, householdId, today: THURSDAY })
	await fillSampleHousehold(prisma, { userId, householdId, today: THURSDAY })
	const { recipes, menus } = await snapshot(householdId)

	expect(
		recipes.filter((recipe) => recipe.isFavorite).map((r) => r.title),
	).toEqual(['Banana bread', 'Lemon chicken traybake', 'Red lentil soup'])

	expect(menus).toEqual([
		{
			title: 'Friday taco night',
			titleKey: 'friday taco night',
			description: SAMPLE_HOUSEHOLD.menus[0]!.description,
			sections: [
				{
					name: null,
					order: 0,
					items: [
						{
							kind: 'recipe',
							order: 0,
							note: null,
							recipeTitle: 'Black bean tacos',
							scaleMultiplier: 1,
							recipe: { title: 'Black bean tacos' },
							shoppingLines: [],
						},
						{
							kind: 'recipe',
							order: 1,
							note: null,
							recipeTitle: 'Greek salad',
							scaleMultiplier: 1,
							recipe: { title: 'Greek salad' },
							shoppingLines: [],
						},
						{
							kind: 'note',
							order: 2,
							note: 'Tortilla chips and salsa',
							recipeTitle: null,
							scaleMultiplier: null,
							recipe: null,
							shoppingLines: [
								{ name: 'tortilla chips', quantity: '1', unit: 'bag' },
								{ name: 'salsa', quantity: '1', unit: 'jar' },
							],
						},
					],
				},
			],
		},
	])
})
