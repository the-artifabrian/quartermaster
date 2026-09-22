import { RouterContextProvider } from 'react-router'
import { expect, test } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { getCurrentWeekStart, serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { loader } from './shopping-plan.tsx'
import '#tests/setup/db-setup.ts'

const PATH = '/resources/shopping-plan'
const ARGS_BASE = {
	params: {},
	context: new RouterContextProvider(),
	pattern: PATH,
	url: new URL(`${BASE_URL}${PATH}`),
}

async function setupHousehold(name: string) {
	return prisma.$transaction(async (tx) => {
		const session = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: { create: createUser() },
			},
			select: { id: true, userId: true },
		})
		const household = await tx.household.create({
			data: {
				name,
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		return { ...session, householdId: household.id }
	})
}

async function loadWeek(session: { id: string }, weekStart?: Date) {
	const cookie = await getSessionCookieHeader(session)
	const url = new URL(`${BASE_URL}${PATH}`)
	if (weekStart) url.searchParams.set('weekStart', serializeDate(weekStart))
	return loader({
		request: new Request(url, { headers: { cookie } }),
		...ARGS_BASE,
		url,
	})
}

test('the Plan picker requires an authenticated household', async () => {
	await expect(
		loader({ request: new Request(`${BASE_URL}${PATH}`), ...ARGS_BASE }),
	).rejects.toMatchObject({ status: 302 })
})

test('default ticks skip a Staple, a pantry line and a line already on the list', async () => {
	const session = await setupHousehold('Picker household')
	await prisma.householdIngredient.create({
		data: {
			householdId: session.householdId,
			displayName: 'Olives',
			canonicalKey: 'olives',
			isStaple: true,
		},
	})
	const list = await ensureShoppingList(prisma, {
		userId: session.userId,
		householdId: session.householdId,
	})
	await prisma.shoppingListItem.create({
		data: { listId: list.id, name: 'Feta', source: 'manual' },
	})
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Greek salad',
			userId: session.userId,
			householdId: session.householdId,
			ingredients: {
				create: [
					{ name: 'cucumber', amount: '2', order: 0 },
					{ name: 'olives', amount: '1', unit: 'cup', order: 1 },
					{ name: 'salt', order: 2 },
					{ name: 'feta', amount: '200', unit: 'g', order: 3 },
				],
			},
		},
	})
	const weekStart = getCurrentWeekStart()
	await prisma.mealPlan.create({
		data: {
			householdId: session.householdId,
			weekStart,
			meals: {
				create: {
					date: weekStart,
					order: 0,
					label: 'dinner',
					recipeItems: {
						create: {
							order: 0,
							recipeId: recipe.id,
							recipeTitle: recipe.title,
							scaleMultiplier: 1,
						},
					},
				},
			},
		},
	})

	const result = await loadWeek(session, weekStart)

	const meal = result.data.days[0]!.meals[0]!
	// A single-Recipe Meal is named after its Recipe, with the label beside it.
	expect(meal).toMatchObject({ title: 'Greek salad', label: 'Dinner' })
	expect(
		Object.fromEntries(
			meal.lines.map((line) => [line.canonicalName, line.status]),
		),
	).toEqual({
		cucumber: 'needed',
		// A saved household Staple: assumed on hand.
		olive: 'on-hand',
		// The plain-basics heuristic, which the picker keeps for its defaults.
		salt: 'on-hand',
		// Already a row on the list.
		feta: 'on-list',
	})
})

test('an unsaved ingredient is needed, and cooked items are never offered', async () => {
	const session = await setupHousehold('Tapenade household')
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Tapenade',
			userId: session.userId,
			householdId: session.householdId,
			ingredients: { create: [{ name: 'olives', amount: '1', order: 0 }] },
		},
	})
	const cooked = await prisma.recipe.create({
		data: {
			title: 'Toast',
			userId: session.userId,
			householdId: session.householdId,
			ingredients: { create: [{ name: 'sourdough', order: 0 }] },
		},
	})
	const weekStart = getCurrentWeekStart()
	await prisma.mealPlan.create({
		data: {
			householdId: session.householdId,
			weekStart,
			meals: {
				create: [
					{
						date: weekStart,
						order: 0,
						recipeItems: {
							create: [
								{
									order: 0,
									recipeId: recipe.id,
									recipeTitle: recipe.title,
									scaleMultiplier: 1,
								},
								{
									order: 1,
									recipeId: cooked.id,
									recipeTitle: cooked.title,
									scaleMultiplier: 1,
									cooked: true,
								},
							],
						},
					},
					// Text-only Meals and Meals with nothing left to buy drop out.
					{ date: weekStart, order: 1, genericText: 'Leftovers' },
				],
			},
		},
	})

	const result = await loadWeek(session, weekStart)

	expect(result.data.days).toHaveLength(1)
	expect(result.data.days[0]!.meals).toHaveLength(1)
	// The picker row reads like the Plan card: every Recipe card on the Meal,
	// cooked ones included, even though only the uncooked lines are offered.
	expect(result.data.days[0]!.meals[0]).toMatchObject({
		title: '2-recipe Meal',
		recipeTitles: ['Tapenade', 'Toast'],
	})
	expect(
		result.data.days[0]!.meals[0]!.lines.map((line) => [
			line.canonicalName,
			line.status,
		]),
	).toEqual([['olive', 'needed']])
})

test('note-card Shopping lines are offered alongside Recipe lines', async () => {
	const session = await setupHousehold('Menu household')
	const weekStart = getCurrentWeekStart()
	await prisma.mealPlan.create({
		data: {
			householdId: session.householdId,
			weekStart,
			meals: {
				create: {
					date: weekStart,
					order: 0,
					label: 'lunch',
					noteItems: {
						create: {
							order: 0,
							text: 'Bread from the bakery',
							shoppingLines: {
								create: [{ name: 'sourdough loaf', quantity: '1', order: 0 }],
							},
						},
					},
				},
			},
		},
	})

	const result = await loadWeek(session, weekStart)

	const meal = result.data.days[0]!.meals[0]!
	// No Recipe card to name it after, so the familiar label is the title.
	expect(meal.title).toBe('Lunch')
	expect(meal.label).toBeNull()
	expect(meal.lines.map((line) => [line.name, line.status])).toEqual([
		['sourdough loaf', 'needed'],
	])
})

test('a week with no Plan is an empty picker, not an error', async () => {
	const session = await setupHousehold('Empty household')

	const result = await loadWeek(session)

	expect(result.data.days).toEqual([])
	expect(result.init?.headers).toEqual({ 'Cache-Control': 'private, no-store' })
})
