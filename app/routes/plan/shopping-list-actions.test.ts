import { describe, expect, test, vi } from 'vitest'
import { type AppLoadContext } from 'react-router'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { prisma } from '#app/utils/db.server.ts'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { getCurrentWeekStart } from '#app/utils/date.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { action } from '../shopping.tsx'

const ACTION_ARGS_BASE = {
	params: {},
	context: {} as AppLoadContext,
	unstable_pattern: '/shopping',
}

async function setupUser() {
	const session = await prisma.session.create({
		data: {
			expirationDate: getSessionExpirationDate(),
			user: { create: createUser() },
		},
		select: { id: true, userId: true },
	})
	const household = await prisma.household.create({
		data: {
			name: 'Test Household',
			members: { create: { userId: session.userId, role: 'owner' } },
		},
	})
	await prisma.subscription.create({
		data: { userId: session.userId, tier: 'pro' },
	})
	return { ...session, householdId: household.id }
}

async function setupMealPlanWithRecipe(
	userId: string,
	householdId: string,
) {
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Test Recipe',
			userId,
			householdId,
			servings: 4,
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
			userId,
			householdId,
			weekStart,
			entries: {
				create: {
					date: weekStart,
					mealType: 'dinner',
					recipeId: recipe.id,
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

describe('shopping list actions', () => {
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

	test('generate without meal plan returns 404', async () => {
		const session = await setupUser()

		const request = await makeRequest(session, { intent: 'generate' })
		const response = action({ request, ...ACTION_ARGS_BASE })
		await expect(response).rejects.toEqual(
			expect.objectContaining({ status: 404 }),
		)
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
