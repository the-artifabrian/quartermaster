/**
 * Failure list for bulk add (the Staples picker and multi-item voice add):
 * - An item that isn't an object with a string name (a number, null, a
 *   missing name) answers 400, not a 500, and adds nothing.
 * - A name longer than any caller sends, or a quantity or unit longer than
 *   single add allows, answers 400.
 * - More items than the cap answers 400.
 * - What the callers really send still adds: names only (Staples), and
 *   empty-string quantity and unit (voice).
 * - A refused bulk add answers with a message the page shows, not a thrown
 *   error that replaces Shopping with the error page.
 *
 * Failure list for Edit:
 * - A row named by a long Staple (101 to 200 characters) can be edited and
 *   keep its name; longer names are refused.
 *
 * Failure list for an intent the page no longer sends (a tab still holding a
 * page from before Undo, whose deletes now go to resources/undo-delete):
 * - An old `delete` or `clear-checked` gets a 400 the page reads as data,
 *   nothing is deleted, and the other member hears nothing. Never a 200 that
 *   saved nothing (the page would take it as done), a thrown error (the
 *   error page) or a 500.
 * - A form posted to /plan/shopping-list, Shopping's old address, gets a 405
 *   rather than a redirect that drops its body (tests/e2e/shopping-list.test.ts,
 *   since only the built router answers a route with no action).
 */
import { RouterContextProvider } from 'react-router'
import { describe, expect, test, vi } from 'vitest'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { getWeekStart } from '#app/utils/date.ts'
import { createPrismaClient, prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { action as shoppingCheckAction } from '../resources/shopping-check.tsx'
import { loader as shoppingStaplesLoader } from '../resources/shopping-staples.tsx'
import { action, loader } from '../shopping.tsx'
import '#tests/setup/db-setup.ts'

const ACTION_ARGS_BASE = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/shopping',
	url: new URL(`${BASE_URL}/shopping`),
}

const STAPLE_RESOURCE_ARGS_BASE = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/resources/shopping-staples',
	url: new URL(`${BASE_URL}/resources/shopping-staples`),
}

async function setupUser() {
	return prisma.$transaction(async (tx) => {
		const session = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: {
					create: {
						...createUser(),
						subscription: { create: { tier: 'pro' } },
					},
				},
			},
			select: { id: true, userId: true },
		})
		const household = await tx.household.create({
			data: {
				name: 'Test Household',
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		return { ...session, householdId: household.id }
	})
}

async function setupMealPlanWithRecipe(userId: string, householdId: string) {
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Test Recipe',
			userId,
			householdId,
			ingredients: {
				create: [
					{ name: 'chicken', amount: '2', unit: 'lbs', order: 0 },
					{ name: 'rice', amount: '1', unit: 'cup', order: 1 },
				],
			},
		},
	})

	const weekStart = getWeekStart(new Date())
	const mealPlan = await prisma.mealPlan.create({
		data: {
			householdId,
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

	return { recipe, mealPlan }
}

async function makeRequest(
	session: { id: string },
	formFields: Record<string, string>,
) {
	const cookie = await getSessionCookieHeader(session)
	const formData = new URLSearchParams(formFields)
	return new Request(`${BASE_URL}/shopping`, {
		method: 'POST',
		headers: {
			cookie,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: formData.toString(),
	})
}

// Checks go through the resource route the Shopping page posts to.
async function checkItem(session: { id: string }, itemId: string) {
	const { checkVersion } = await prisma.shoppingListItem.findUniqueOrThrow({
		where: { id: itemId },
	})
	const response = await shoppingCheckAction({
		request: new Request(`${BASE_URL}/resources/shopping-check`, {
			method: 'POST',
			headers: {
				cookie: await getSessionCookieHeader(session),
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				itemId,
				checked: 'true',
				observedVersion: String(checkVersion),
				mutationId: `check-${itemId}`,
			}).toString(),
		}),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/resources/shopping-check',
		url: new URL(`${BASE_URL}/resources/shopping-check`),
	})
	expect(await response.json()).toMatchObject({ status: 'success' })
}

async function makeLoaderRequest(session: { id: string }) {
	const cookie = await getSessionCookieHeader(session)
	return new Request(`${BASE_URL}/shopping`, {
		headers: { cookie },
	})
}

describe('shopping list actions', () => {
	test('a household cannot own a second shopping list', async () => {
		const session = await setupUser()
		await prisma.shoppingList.create({
			data: {
				userId: session.userId,
				householdId: session.householdId,
			},
		})

		await expect(
			prisma.shoppingList.create({
				data: {
					userId: session.userId,
					householdId: session.householdId,
				},
			}),
		).rejects.toMatchObject({ code: 'P2002' })
	})

	test('concurrent first additions remain visible on the household list', async () => {
		const session = await setupUser()
		const [applesRequest, bananasRequest] = await Promise.all([
			makeRequest(session, { intent: 'add', name: 'Apples' }),
			makeRequest(session, { intent: 'add', name: 'Bananas' }),
		])

		await Promise.all([
			action({ request: applesRequest, ...ACTION_ARGS_BASE }),
			action({ request: bananasRequest, ...ACTION_ARGS_BASE }),
		])

		const result = await loader({
			request: await makeLoaderRequest(session),
			...ACTION_ARGS_BASE,
		})
		expect(result.shoppingList.items.map((item) => item.name).sort()).toEqual([
			'Apples',
			'Bananas',
		])
	})

	test('concurrent database clients share one household shopping list', async () => {
		const session = await setupUser()
		const clients = [createPrismaClient(), createPrismaClient()]
		await Promise.all(clients.map((client) => client.$connect()))
		await Promise.all(
			clients.map((client) =>
				client.$queryRawUnsafe('PRAGMA busy_timeout = 100'),
			),
		)

		try {
			const results = await Promise.allSettled(
				clients.map((client) =>
					ensureShoppingList(client, {
						userId: session.userId,
						householdId: session.householdId,
					}),
				),
			)

			expect(results.every((result) => result.status === 'fulfilled')).toBe(
				true,
			)
			const listIds = results.flatMap((result) =>
				result.status === 'fulfilled' ? [result.value.id] : [],
			)
			expect(new Set(listIds).size).toBe(1)
		} finally {
			await Promise.all(clients.map((client) => client.$disconnect()))
		}
	})

	test('loader offers only weeks whose Meals can contribute Shopping demand', async () => {
		const session = await setupUser()
		const weekStart = getWeekStart(new Date())
		const mealPlan = await prisma.mealPlan.create({
			data: {
				householdId: session.householdId,
				weekStart,
				meals: {
					create: [{ date: weekStart, order: 0, genericText: 'Leftovers' }],
				},
			},
		})

		// A week of only text-only Meals has nothing to offer the picker.
		const before = await loader({
			request: await makeLoaderRequest(session),
			...ACTION_ARGS_BASE,
		})
		expect(before.hasMealPlan).toBe(false)
		expect(before.weeksWithPlans).toEqual([])

		const recipe = await prisma.recipe.create({
			data: {
				title: 'Stew',
				userId: session.userId,
				householdId: session.householdId,
				ingredients: { create: [{ name: 'beef', order: 0 }] },
			},
		})
		await prisma.meal.create({
			data: {
				mealPlanId: mealPlan.id,
				date: weekStart,
				order: 1,
				recipeItems: {
					create: {
						order: 0,
						recipeId: recipe.id,
						recipeTitle: recipe.title,
						scaleMultiplier: 1,
					},
				},
			},
		})

		const after = await loader({
			request: await makeLoaderRequest(session),
			...ACTION_ARGS_BASE,
		})
		expect(after.hasMealPlan).toBe(true)
		expect(after.weeksWithPlans.map((week) => week.isCurrent)).toEqual([true])
	})

	test('a picked Meal writes through the Meal-add path, and picking it again changes nothing', async () => {
		const session = await setupUser()
		await setupMealPlanWithRecipe(session.userId, session.householdId)
		const meal = await prisma.meal.findFirstOrThrow({
			where: { mealPlan: { householdId: session.householdId } },
		})

		const first = (await action({
			request: await makeRequest(session, {
				intent: 'add-from-plan',
				picks: JSON.stringify([
					{ mealId: meal.id, lines: ['chicken', 'rice'] },
				]),
			}),
			...ACTION_ARGS_BASE,
		})) as { status: string; createdRowCount: number }
		expect(first).toMatchObject({ status: 'success', createdRowCount: 2 })

		const list = await prisma.shoppingList.findFirstOrThrow({
			where: { householdId: session.householdId },
		})
		const rowsAfterFirst = await prisma.shoppingListItem.findMany({
			where: { listId: list.id },
			orderBy: { name: 'asc' },
			select: {
				name: true,
				quantity: true,
				unit: true,
				source: true,
				horizon: true,
				checked: true,
			},
		})
		// Rows the Meal-add path creates, not week-generated ones.
		expect(rowsAfterFirst).toEqual([
			{
				name: 'chicken',
				quantity: '2',
				unit: 'lbs',
				source: 'meal',
				horizon: 'next',
				checked: false,
			},
			{
				name: 'rice',
				quantity: '1',
				unit: 'cup',
				source: 'meal',
				horizon: 'next',
				checked: false,
			},
		])
		expect(
			await prisma.mealShoppingContribution.count({
				where: { mealId: meal.id },
			}),
		).toBe(2)

		// Idempotent: the same pick records no new demand and adds no rows.
		const second = (await action({
			request: await makeRequest(session, {
				intent: 'add-from-plan',
				picks: JSON.stringify([
					{ mealId: meal.id, lines: ['chicken', 'rice'] },
				]),
			}),
			...ACTION_ARGS_BASE,
		})) as {
			status: string
			createdRowCount: number
			alreadyContributedCount: number
		}
		expect(second).toMatchObject({
			status: 'success',
			createdRowCount: 0,
			alreadyContributedCount: 2,
		})
		expect(
			await prisma.shoppingListItem.findMany({
				where: { listId: list.id },
				orderBy: { name: 'asc' },
				select: { name: true },
			}),
		).toEqual([{ name: 'chicken' }, { name: 'rice' }])
	})

	test('a usually-on-hand line still lands when the household ticks it', async () => {
		const session = await setupUser()
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Brine',
				userId: session.userId,
				householdId: session.householdId,
				ingredients: {
					create: [{ name: 'salt', amount: '100', unit: 'g', order: 0 }],
				},
			},
		})
		const weekStart = getWeekStart(new Date())
		const mealPlan = await prisma.mealPlan.create({
			data: {
				householdId: session.householdId,
				weekStart,
				meals: {
					create: {
						date: weekStart,
						order: 0,
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
			include: { meals: true },
		})

		// The picker unticks salt by default; the tick set is what decides, so
		// an explicit tick overrides the usual assumption.
		await action({
			request: await makeRequest(session, {
				intent: 'add-from-plan',
				picks: JSON.stringify([
					{ mealId: mealPlan.meals[0]!.id, lines: ['salt'] },
				]),
			}),
			...ACTION_ARGS_BASE,
		})

		expect(
			await prisma.shoppingListItem.findMany({
				where: { list: { householdId: session.householdId } },
				select: { name: true, quantity: true, unit: true, source: true },
			}),
		).toEqual([{ name: 'salt', quantity: '100', unit: 'g', source: 'meal' }])
	})

	test('picks cannot reach cooked items, missing cards, text-only Meals or another household', async () => {
		const session = await setupUser()
		const outsider = await setupUser()
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Kofta',
				userId: session.userId,
				householdId: session.householdId,
				ingredients: {
					create: [{ name: 'ground lamb', amount: '500', unit: 'g', order: 0 }],
				},
			},
		})
		const cookedRecipe = await prisma.recipe.create({
			data: {
				title: 'Salad',
				userId: session.userId,
				householdId: session.householdId,
				ingredients: { create: [{ name: 'cucumber', amount: '2', order: 0 }] },
			},
		})
		const weekStart = getWeekStart(new Date())
		const mealPlan = await prisma.mealPlan.create({
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
									// 2× batches — the stored multiplier scales directly.
									{
										order: 0,
										recipeId: recipe.id,
										recipeTitle: recipe.title,
										scaleMultiplier: 2,
									},
									// Cooked: already made, never offered.
									{
										order: 1,
										recipeId: cookedRecipe.id,
										recipeTitle: cookedRecipe.title,
										scaleMultiplier: 1,
										cooked: true,
									},
									// Missing card (Recipe deleted): no fresh demand.
									{
										order: 2,
										recipeId: null,
										recipeTitle: 'Retired Recipe',
										scaleMultiplier: 1,
									},
								],
							},
						},
						{ date: weekStart, order: 1, genericText: 'Leftovers' },
					],
				},
			},
			include: { meals: { orderBy: { order: 'asc' } } },
		})
		const [recipeMeal, textMeal] = mealPlan.meals
		// The outsider's Meal has real demand, so only the household check
		// keeps its line off this list.
		const outsiderRecipe = await prisma.recipe.create({
			data: {
				title: 'Paella',
				userId: outsider.userId,
				householdId: outsider.householdId,
				ingredients: {
					create: [{ name: 'saffron', amount: '1', unit: 'g', order: 0 }],
				},
			},
		})
		const outsiderPlan = await prisma.mealPlan.create({
			data: {
				householdId: outsider.householdId,
				weekStart,
				meals: {
					create: {
						date: weekStart,
						order: 0,
						recipeItems: {
							create: {
								order: 0,
								recipeId: outsiderRecipe.id,
								recipeTitle: outsiderRecipe.title,
								scaleMultiplier: 1,
							},
						},
					},
				},
			},
			include: { meals: true },
		})

		await action({
			request: await makeRequest(session, {
				intent: 'add-from-plan',
				picks: JSON.stringify([
					{
						mealId: recipeMeal!.id,
						lines: ['ground lamb', 'cucumber', 'retired recipe'],
					},
					{ mealId: textMeal!.id, lines: ['leftovers'] },
					{ mealId: outsiderPlan.meals[0]!.id, lines: ['saffron'] },
				]),
			}),
			...ACTION_ARGS_BASE,
		})

		expect(
			await prisma.shoppingListItem.findMany({
				where: { list: { householdId: session.householdId } },
				select: { name: true, quantity: true, unit: true },
			}),
		).toEqual([{ name: 'ground lamb', quantity: '1000', unit: 'g' }])
		expect(
			await prisma.shoppingListItem.count({
				where: { list: { householdId: outsider.householdId } },
			}),
		).toBe(0)
	})

	test('picked demand promotes an unchecked Later match and adds beside a checked purchase', async () => {
		const session = await setupUser()
		await setupMealPlanWithRecipe(session.userId, session.householdId)
		const meal = await prisma.meal.findFirstOrThrow({
			where: { mealPlan: { householdId: session.householdId } },
		})
		const list = await ensureShoppingList(prisma, {
			userId: session.userId,
			householdId: session.householdId,
		})
		await prisma.shoppingListItem.createMany({
			data: [
				{
					name: 'chicken',
					quantity: 'family pack',
					listId: list.id,
					horizon: 'later',
					source: 'manual',
				},
				{
					name: 'rice',
					listId: list.id,
					horizon: 'later',
					checked: true,
					source: 'manual',
				},
			],
		})

		await action({
			request: await makeRequest(session, {
				intent: 'add-from-plan',
				picks: JSON.stringify([
					{ mealId: meal.id, lines: ['chicken', 'rice'] },
				]),
			}),
			...ACTION_ARGS_BASE,
		})

		expect(
			await prisma.shoppingListItem.findMany({
				where: { listId: list.id },
				orderBy: [{ name: 'asc' }, { checked: 'asc' }],
				select: {
					name: true,
					quantity: true,
					horizon: true,
					checked: true,
					source: true,
				},
			}),
		).toEqual([
			{
				name: 'chicken',
				quantity: 'family pack',
				horizon: 'next',
				checked: false,
				source: 'manual',
			},
			{
				name: 'rice',
				quantity: '1',
				horizon: 'next',
				checked: false,
				source: 'meal',
			},
			{
				name: 'rice',
				quantity: null,
				horizon: 'later',
				checked: true,
				source: 'manual',
			},
		])
	})

	test('legacy generated rows still display and check', async () => {
		const session = await setupUser()
		const list = await ensureShoppingList(prisma, {
			userId: session.userId,
			householdId: session.householdId,
		})
		// Rows From Plan wrote before #288 are ordinary rows now; nothing reads
		// their source value any more.
		const legacy = await prisma.shoppingListItem.create({
			data: {
				listId: list.id,
				name: 'Leeks',
				quantity: '3',
				source: 'generated',
				horizon: 'next',
			},
		})

		const seen = await loader({
			request: await makeLoaderRequest(session),
			...ACTION_ARGS_BASE,
		})
		const row = seen.shoppingList.items.find((item) => item.id === legacy.id)!
		expect(row.display).toMatchObject({ quantity: '3', unit: null })

		await checkItem(session, legacy.id)
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: legacy.id },
			}),
		).toMatchObject({ checked: true })
	})

	test('the choice resource exposes only Staples while Shopping owns current identities', async () => {
		const session = await setupUser()
		await prisma.householdIngredient.createMany({
			data: [
				{
					householdId: session.householdId,
					displayName: 'Banana',
					canonicalKey: 'banana',
					isStaple: true,
				},
				{
					householdId: session.householdId,
					displayName: 'Milk',
					canonicalKey: 'milk',
					isStaple: true,
				},
				{
					householdId: session.householdId,
					displayName: 'Not a Staple',
					canonicalKey: 'not a staple',
					isStaple: false,
				},
			],
		})

		await action({
			request: await makeRequest(session, {
				intent: 'add',
				name: 'Bananas',
			}),
			...ACTION_ARGS_BASE,
		})

		const shopping = await loader({
			request: await makeLoaderRequest(session),
			...ACTION_ARGS_BASE,
		})
		const choices = await shoppingStaplesLoader({
			request: await makeLoaderRequest(session),
			...STAPLE_RESOURCE_ARGS_BASE,
		})
		expect(shopping.shoppingIdentities).toEqual(['banana'])
		expect(choices.data.staples).toEqual([
			{
				id: expect.any(String),
				displayName: 'Banana',
				shoppingIdentity: 'banana',
			},
			{
				id: expect.any(String),
				displayName: 'Milk',
				shoppingIdentity: 'milk',
			},
		])
	})

	test('typed entry keeps checked purchases separate and still warns about unchecked duplicates (#226)', async () => {
		const session = await setupUser()
		const list = await ensureShoppingList(prisma, session)
		const purchased = await prisma.shoppingListItem.create({
			data: {
				listId: list.id,
				name: 'rice',
				quantity: '200',
				unit: 'g',
				checked: true,
			},
		})
		const add = async () =>
			action({
				request: await makeRequest(session, {
					intent: 'add',
					name: '400 g rice',
				}),
				...ACTION_ARGS_BASE,
			})
		expect(await add()).toMatchObject({ status: 'success' })
		const items = await prisma.shoppingListItem.findMany({
			where: { listId: list.id },
		})
		expect(items).toHaveLength(2)
		expect(items.find((item) => item.id === purchased.id)).toEqual(purchased)
		expect(items.find((item) => item.id !== purchased.id)).toMatchObject({
			name: 'rice',
			quantity: '400',
			unit: 'g',
			checked: false,
			source: 'manual',
		})
		expect(await add()).toMatchObject({
			status: 'warning',
			warningType: 'already_on_list',
		})
		expect(
			await prisma.shoppingListItem.count({ where: { listId: list.id } }),
		).toBe(2)
	})

	test('manual cross-section matches offer an explicit move and moves preserve checked state', async () => {
		const session = await setupUser()
		await action({
			request: await makeRequest(session, {
				intent: 'add',
				name: 'Candles',
				quantity: '2 boxes',
				horizon: 'later',
			}),
			...ACTION_ARGS_BASE,
		})

		const warning = (await action({
			request: await makeRequest(session, {
				intent: 'add',
				name: 'candles',
				horizon: 'next',
			}),
			...ACTION_ARGS_BASE,
		})) as Record<string, unknown>
		expect(warning).toMatchObject({
			status: 'warning',
			warningType: 'move_to_section',
			existingHorizon: 'later',
			targetHorizon: 'next',
		})

		await action({
			request: await makeRequest(session, {
				intent: 'move',
				itemId: warning.itemId as string,
				horizon: 'next',
			}),
			...ACTION_ARGS_BASE,
		})
		await checkItem(session, warning.itemId as string)
		await action({
			request: await makeRequest(session, {
				intent: 'move',
				itemId: warning.itemId as string,
				horizon: 'later',
			}),
			...ACTION_ARGS_BASE,
		})

		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: warning.itemId as string },
				select: { horizon: true, checked: true, quantity: true },
			}),
		).toEqual({ horizon: 'later', checked: true, quantity: '2 boxes' })
		expect(
			await prisma.shoppingListItem.count({
				where: { list: { householdId: session.householdId } },
			}),
		).toBe(1)
	})

	test('manual add dedup uses the shared fallback demand identity', async () => {
		const session = await setupUser()

		const first = (await action({
			request: await makeRequest(session, {
				intent: 'add',
				name: 'medium/small peaches',
			}),
			...ACTION_ARGS_BASE,
		})) as { status: string }
		const second = (await action({
			request: await makeRequest(session, {
				intent: 'add',
				name: 'large/small plums',
			}),
			...ACTION_ARGS_BASE,
		})) as { status: string }

		expect(first.status).toBe('success')
		expect(second.status).toBe('success')
		expect(
			await prisma.shoppingListItem.count({
				where: { list: { householdId: session.householdId } },
			}),
		).toBe(2)
	})

	test('bulk-add normalizes note lines: trims, dedups by canonical identity, keeps explicit staples', async () => {
		const session = await setupUser()

		const result = (await action({
			request: await makeRequest(session, {
				intent: 'bulk-add',
				items: JSON.stringify([
					{ name: '  pita bread ', quantity: ' 12 ' },
					// Same canonical identity — deduped within the batch.
					{ name: 'pita bread' },
					{ name: '   ' },
					// Explicit manual intent: staples are NOT stripped here.
					{ name: 'salt' },
				]),
			}),
			...ACTION_ARGS_BASE,
		})) as { status: string; addedCount: number }

		expect(result.status).toBe('success')
		expect(result.addedCount).toBe(2)
		const list = await prisma.shoppingList.findFirst({
			where: { userId: session.userId },
			include: { items: true },
		})
		expect(
			list!.items.map((i) => [i.name, i.quantity, i.source]).sort(),
		).toEqual([
			['pita bread', '12', 'manual'],
			['salt', null, 'manual'],
		])
	})

	test('bulk-add refuses malformed or oversized items and adds nothing', async () => {
		const session = await setupUser()
		const bulkAdd = async (items: unknown) =>
			action({
				request: await makeRequest(session, {
					intent: 'bulk-add',
					items: JSON.stringify(items),
				}),
				...ACTION_ARGS_BASE,
			})

		for (const items of [
			{ name: 'milk' },
			[{ name: 42 }],
			[null],
			[{ quantity: '2' }],
			[{ name: 'x'.repeat(201) }],
			[{ name: 'milk', quantity: '1'.repeat(51) }],
			[{ name: 'milk', unit: 'g'.repeat(21) }],
			Array.from({ length: 201 }, (_, i) => ({ name: `item ${i}` })),
		]) {
			const result = (await bulkAdd(items)) as {
				data: unknown
				init: { status: number } | null
			}
			expect(result.init?.status).toBe(400)
			expect(result.data).toEqual({
				status: 'error',
				message: 'Couldn’t add these items. Try fewer, or shorter names.',
			})
		}
		expect(
			await prisma.shoppingListItem.count({
				where: { list: { userId: session.userId } },
			}),
		).toBe(0)
	})

	test('bulk-add takes what voice and the Staples picker send', async () => {
		const session = await setupUser()
		const result = (await action({
			request: await makeRequest(session, {
				intent: 'bulk-add',
				items: JSON.stringify([
					{ name: 'eggs', quantity: '12', unit: '' },
					{ name: 'milk', quantity: '', unit: '' },
					{ name: 'x'.repeat(200) },
					...Array.from({ length: 197 }, (_, i) => ({ name: `staple ${i}` })),
				]),
			}),
			...ACTION_ARGS_BASE,
		})) as { status: string; addedCount: number }
		expect(result).toMatchObject({ status: 'success', addedCount: 200 })
	})

	test('Edit keeps a name as long as a Staple’s, and refuses a longer one', async () => {
		const session = await setupUser()
		const list = await ensureShoppingList(prisma, {
			userId: session.userId,
			householdId: session.householdId,
		})
		const row = await prisma.shoppingListItem.create({
			data: { listId: list.id, name: 'x'.repeat(150), source: 'manual' },
		})
		const edit = async (name: string, observedVersion: number) =>
			action({
				request: await makeRequest(session, {
					intent: 'edit',
					itemId: row.id,
					observedVersion: String(observedVersion),
					name,
					quantity: '2',
				}),
				...ACTION_ARGS_BASE,
			})

		expect(await edit('y'.repeat(200), row.checkVersion)).toEqual({
			status: 'success',
		})
		const saved = await prisma.shoppingListItem.findUniqueOrThrow({
			where: { id: row.id },
		})
		expect(saved).toMatchObject({ name: 'y'.repeat(200), quantity: '2' })
		expect(await edit('z'.repeat(201), saved.checkVersion)).toMatchObject({
			status: 'error',
		})
	})

	test('bulk-add dedups against existing rows by canonical identity', async () => {
		const session = await setupUser()
		await action({
			request: await makeRequest(session, { intent: 'add', name: 'Bananas' }),
			...ACTION_ARGS_BASE,
		})

		const result = (await action({
			request: await makeRequest(session, {
				intent: 'bulk-add',
				items: JSON.stringify([{ name: 'banana' }, { name: 'milk' }]),
			}),
			...ACTION_ARGS_BASE,
		})) as { status: string; addedCount: number }

		expect(result.addedCount).toBe(1)
		const list = await prisma.shoppingList.findFirst({
			where: { userId: session.userId },
			include: { items: true },
		})
		expect(list!.items.map((i) => i.name).sort()).toEqual(['Bananas', 'milk'])
	})
})

test('an old page that deletes a row gets a 400, and the row stays', async () => {
	const session = await setupUser()
	const list = await ensureShoppingList(prisma, session)
	const row = await prisma.shoppingListItem.create({
		data: { listId: list.id, name: 'milk' },
	})

	await expect(
		action({
			request: await makeRequest(session, { intent: 'delete', itemId: row.id }),
			...ACTION_ARGS_BASE,
		}),
	).resolves.toMatchObject({
		data: { status: 'error' },
		init: { status: 400 },
	})
	expect(await prisma.shoppingListItem.count({ where: { id: row.id } })).toBe(1)
	expect(emitHouseholdEvent).not.toHaveBeenCalledWith(
		expect.objectContaining({ householdId: session.householdId }),
	)
})
