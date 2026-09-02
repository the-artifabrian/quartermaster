import { RouterContextProvider } from 'react-router'
import { describe, expect, test, vi } from 'vitest'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { getCurrentWeekStart } from '#app/utils/date.ts'
import { createPrismaClient, prisma } from '#app/utils/db.server.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { action, loader } from '../shopping.tsx'

const ACTION_ARGS_BASE = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/shopping',
	url: new URL(`${BASE_URL}/shopping`),
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

	const weekStart = getCurrentWeekStart()
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

	test('generate from meal plan creates items', async () => {
		const session = await setupUser()
		await setupMealPlanWithRecipe(session.userId, session.householdId)

		const request = await makeRequest(session, { intent: 'generate' })
		const result = (await action({ request, ...ACTION_ARGS_BASE })) as {
			status: string
		}
		expect(result.status).toBe('success')

		const list = await prisma.shoppingList.findFirst({
			where: { userId: session.userId },
			include: { items: true },
		})
		expect(list!.items.length).toBeGreaterThan(0)
		expect(list!.items.every((i) => i.source === 'generated')).toBe(true)
	})

	test('generate reads Meal items: multipliers scale, cooked items and missing cards contribute nothing', async () => {
		const session = await setupUser()
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
				ingredients: {
					create: [{ name: 'cucumber', amount: '2', order: 0 }],
				},
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
									// 2× batches — the stored multiplier scales directly,
									// no serving-denominator arithmetic.
									{
										order: 0,
										recipeId: recipe.id,
										recipeTitle: recipe.title,
										scaleMultiplier: 2,
									},
									// Cooked: no demand.
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
						// Text-only Meal: no Shopping behavior.
						{
							date: weekStart,
							order: 1,
							genericText: 'Leftovers',
						},
					],
				},
			},
		})

		const request = await makeRequest(session, { intent: 'generate' })
		const result = (await action({ request, ...ACTION_ARGS_BASE })) as {
			status: string
		}
		expect(result.status).toBe('success')

		const list = await prisma.shoppingList.findFirst({
			where: { userId: session.userId },
			include: { items: true },
		})
		expect(
			list!.items.map((item) => [item.name, item.quantity, item.unit]),
		).toEqual([['ground lamb', '1000', 'g']])
	})

	test('loader offers only weeks whose Meals hold Recipe items', async () => {
		const session = await setupUser()
		const weekStart = getCurrentWeekStart()
		const mealPlan = await prisma.mealPlan.create({
			data: {
				householdId: session.householdId,
				weekStart,
				meals: {
					create: [{ date: weekStart, order: 0, genericText: 'Leftovers' }],
				},
			},
		})

		// A week of only text-only Meals has nothing to generate from.
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

	test('loader exposes only active Staples and marks Shopping matches by shared identity', async () => {
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

		const beforeCutover = await loader({
			request: await makeLoaderRequest(session),
			...ACTION_ARGS_BASE,
		})
		expect(beforeCutover.staples).toEqual([])

		await prisma.household.update({
			where: { id: session.householdId },
			data: { staplesCutoverAt: new Date() },
		})
		await action({
			request: await makeRequest(session, {
				intent: 'add',
				name: 'Bananas',
			}),
			...ACTION_ARGS_BASE,
		})

		const afterCutover = await loader({
			request: await makeLoaderRequest(session),
			...ACTION_ARGS_BASE,
		})
		expect(afterCutover.staples).toEqual([
			{ id: expect.any(String), displayName: 'Banana', onShoppingList: true },
			{ id: expect.any(String), displayName: 'Milk', onShoppingList: false },
		])
	})

	test('generate replaces previous generated items', async () => {
		const session = await setupUser()
		await setupMealPlanWithRecipe(session.userId, session.householdId)

		// Generate twice
		await action({
			request: await makeRequest(session, { intent: 'generate' }),
			...ACTION_ARGS_BASE,
		})
		await action({
			request: await makeRequest(session, { intent: 'generate' }),
			...ACTION_ARGS_BASE,
		})

		const list = await prisma.shoppingList.findFirst({
			where: { userId: session.userId },
			include: { items: true },
		})
		// Should not have duplicates
		const generatedItems = list!.items.filter((i) => i.source === 'generated')
		const uniqueNames = new Set(generatedItems.map((i) => i.name))
		expect(generatedItems).toHaveLength(uniqueNames.size)
	})

	test('add manual item', async () => {
		const session = await setupUser()

		const request = await makeRequest(session, {
			intent: 'add',
			name: 'Bananas',
			quantity: '6',
		})
		const result = (await action({ request, ...ACTION_ARGS_BASE })) as {
			status: string
		}
		expect(result.status).toBe('success')

		const list = await prisma.shoppingList.findFirst({
			where: { userId: session.userId },
			include: { items: true },
		})
		const item = list!.items.find((i) => i.name === 'Bananas')
		expect(item).toBeDefined()
		expect(item!.source).toBe('manual')
		expect(item!.quantity).toBe('6')
		expect(item!.horizon).toBe('next')
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
		await action({
			request: await makeRequest(session, {
				intent: 'toggle',
				itemId: warning.itemId as string,
			}),
			...ACTION_ARGS_BASE,
		})
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

	test('toggle checked', async () => {
		const session = await setupUser()

		// Add an item first
		await action({
			request: await makeRequest(session, {
				intent: 'add',
				name: 'Eggs',
			}),
			...ACTION_ARGS_BASE,
		})

		const list = await prisma.shoppingList.findFirst({
			where: { userId: session.userId },
			include: { items: true },
		})
		const item = list!.items[0]!
		expect(item.checked).toBe(false)

		// Toggle
		await action({
			request: await makeRequest(session, {
				intent: 'toggle',
				itemId: item.id,
			}),
			...ACTION_ARGS_BASE,
		})

		const updated = await prisma.shoppingListItem.findUnique({
			where: { id: item.id },
		})
		expect(updated!.checked).toBe(true)
	})

	test('delete item', async () => {
		const session = await setupUser()

		await action({
			request: await makeRequest(session, {
				intent: 'add',
				name: 'Milk',
			}),
			...ACTION_ARGS_BASE,
		})

		const list = await prisma.shoppingList.findFirst({
			where: { userId: session.userId },
			include: { items: true },
		})
		const item = list!.items[0]!

		const result = (await action({
			request: await makeRequest(session, {
				intent: 'delete',
				itemId: item.id,
			}),
			...ACTION_ARGS_BASE,
		})) as { status: string }
		expect(result.status).toBe('success')

		const deleted = await prisma.shoppingListItem.findUnique({
			where: { id: item.id },
		})
		expect(deleted).toBeNull()
	})

	test('clear checked items', async () => {
		const session = await setupUser()

		// Add two items
		await action({
			request: await makeRequest(session, {
				intent: 'add',
				name: 'Milk',
			}),
			...ACTION_ARGS_BASE,
		})
		await action({
			request: await makeRequest(session, {
				intent: 'add',
				name: 'Bread',
			}),
			...ACTION_ARGS_BASE,
		})

		const list = await prisma.shoppingList.findFirst({
			where: { userId: session.userId },
			include: { items: true },
		})

		// Check the first item
		await action({
			request: await makeRequest(session, {
				intent: 'toggle',
				itemId: list!.items[0]!.id,
			}),
			...ACTION_ARGS_BASE,
		})

		// Clear checked
		const result = (await action({
			request: await makeRequest(session, {
				intent: 'clear-checked',
			}),
			...ACTION_ARGS_BASE,
		})) as { status: string }
		expect(result.status).toBe('success')

		const updated = await prisma.shoppingList.findFirst({
			where: { userId: session.userId },
			include: { items: true },
		})
		expect(updated!.items).toHaveLength(1) // Only unchecked remains
	})

	test('clear checked is scoped to its requested section', async () => {
		const session = await setupUser()
		const list = await ensureShoppingList(prisma, {
			userId: session.userId,
			householdId: session.householdId,
		})
		await prisma.shoppingListItem.createMany({
			data: [
				{
					name: 'Milk',
					listId: list.id,
					checked: true,
					horizon: 'next',
				},
				{
					name: 'Candles',
					listId: list.id,
					checked: true,
					horizon: 'later',
				},
			],
		})

		await action({
			request: await makeRequest(session, {
				intent: 'clear-checked',
				horizon: 'next',
			}),
			...ACTION_ARGS_BASE,
		})

		expect(
			await prisma.shoppingListItem.findMany({
				where: { listId: list.id },
				select: { name: true, horizon: true, checked: true },
			}),
		).toEqual([{ name: 'Candles', horizon: 'later', checked: true }])
	})

	test('generated Plan demand promotes unchecked Later matches but leaves checked Later matches bought', async () => {
		const session = await setupUser()
		await setupMealPlanWithRecipe(session.userId, session.householdId)
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
			request: await makeRequest(session, { intent: 'generate' }),
			...ACTION_ARGS_BASE,
		})

		expect(
			await prisma.shoppingListItem.findMany({
				where: { listId: list.id },
				orderBy: { name: 'asc' },
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
				quantity: null,
				horizon: 'later',
				checked: true,
				source: 'manual',
			},
		])
	})

	test('generate without meal plan returns 404', async () => {
		const session = await setupUser()

		const request = await makeRequest(session, { intent: 'generate' })
		const response = action({ request, ...ACTION_ARGS_BASE })
		await expect(response).rejects.toEqual(
			expect.objectContaining({ status: 404 }),
		)
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

	test('add item auto-categorizes household items', async () => {
		const session = await setupUser()

		const request = await makeRequest(session, {
			intent: 'add',
			name: 'Toilet Paper',
		})
		await action({ request, ...ACTION_ARGS_BASE })

		const list = await prisma.shoppingList.findFirst({
			where: { userId: session.userId },
			include: { items: true },
		})
		const item = list!.items.find((i) => i.name === 'Toilet Paper')
		expect(item).toBeDefined()
		expect(item!.category).toBe('household')
	})
})
