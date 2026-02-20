import { type AppLoadContext } from 'react-router'
import { describe, expect, test, vi } from 'vitest'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { action } from './index.tsx'

const ACTION_ARGS_BASE = {
	params: {},
	context: {} as AppLoadContext,
	unstable_pattern: '/plan',
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

async function setupRecipe(userId: string, householdId: string) {
	return prisma.recipe.create({
		data: {
			title: 'Test Recipe',
			userId,
			householdId,
			servings: 4,
			ingredients: {
				create: [{ name: 'flour', amount: '2', unit: 'cups', order: 0 }],
			},
		},
	})
}

async function makeRequest(
	session: { id: string },
	formFields: Record<string, string>,
) {
	const cookie = await getSessionCookieHeader(session)
	const formData = new URLSearchParams(formFields)
	return new Request(`${BASE_URL}/plan`, {
		method: 'POST',
		headers: {
			cookie,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: formData.toString(),
	})
}

describe('meal plan actions', () => {
	test('assign recipe to slot', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const date = '2026-02-02' // Monday

		const request = await makeRequest(session, {
			intent: 'assign',
			date,
			mealType: 'dinner',
			recipeId: recipe.id,
		})
		const result = await action({ request, ...ACTION_ARGS_BASE })
		expect(result).toEqual({ status: 'success' })

		const mealPlan = await prisma.mealPlan.findFirst({
			where: { userId: session.userId },
			include: { entries: true },
		})
		expect(mealPlan!.entries).toHaveLength(1)
		expect(mealPlan!.entries[0]!.recipeId).toBe(recipe.id)
		expect(mealPlan!.entries[0]!.mealType).toBe('dinner')
	})

	test('duplicate assignment is idempotent', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const fields = {
			intent: 'assign',
			date: '2026-02-02',
			mealType: 'dinner',
			recipeId: recipe.id,
		}

		await action({
			request: await makeRequest(session, fields),
			...ACTION_ARGS_BASE,
		})
		await action({
			request: await makeRequest(session, fields),
			...ACTION_ARGS_BASE,
		})

		const mealPlan = await prisma.mealPlan.findFirst({
			where: { userId: session.userId },
			include: { entries: true },
		})
		expect(mealPlan!.entries).toHaveLength(1)
	})

	test('assign with servings override', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)

		const request = await makeRequest(session, {
			intent: 'assign',
			date: '2026-02-02',
			mealType: 'dinner',
			recipeId: recipe.id,
			servings: '8',
		})
		await action({ request, ...ACTION_ARGS_BASE })

		const mealPlan = await prisma.mealPlan.findFirst({
			where: { userId: session.userId },
			include: { entries: true },
		})
		expect(mealPlan!.entries[0]!.servings).toBe(8)
	})

	test('update servings', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)

		// First assign
		await action({
			request: await makeRequest(session, {
				intent: 'assign',
				date: '2026-02-02',
				mealType: 'dinner',
				recipeId: recipe.id,
			}),
			...ACTION_ARGS_BASE,
		})

		const entry = await prisma.mealPlanEntry.findFirst({
			where: { mealPlan: { userId: session.userId } },
		})

		const request = await makeRequest(session, {
			intent: 'updateServings',
			entryId: entry!.id,
			servings: '6',
		})
		const result = await action({ request, ...ACTION_ARGS_BASE })
		expect(result).toEqual({ status: 'success' })

		const updated = await prisma.mealPlanEntry.findUnique({
			where: { id: entry!.id },
		})
		expect(updated!.servings).toBe(6)
	})

	test('toggle cooked', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)

		await action({
			request: await makeRequest(session, {
				intent: 'assign',
				date: '2026-02-02',
				mealType: 'dinner',
				recipeId: recipe.id,
			}),
			...ACTION_ARGS_BASE,
		})

		const entry = await prisma.mealPlanEntry.findFirst({
			where: { mealPlan: { userId: session.userId } },
		})
		expect(entry!.cooked).toBe(false)

		await action({
			request: await makeRequest(session, {
				intent: 'toggleCooked',
				entryId: entry!.id,
			}),
			...ACTION_ARGS_BASE,
		})

		const toggled = await prisma.mealPlanEntry.findUnique({
			where: { id: entry!.id },
		})
		expect(toggled!.cooked).toBe(true)
	})

	test('remove entry', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)

		await action({
			request: await makeRequest(session, {
				intent: 'assign',
				date: '2026-02-02',
				mealType: 'dinner',
				recipeId: recipe.id,
			}),
			...ACTION_ARGS_BASE,
		})

		const entry = await prisma.mealPlanEntry.findFirst({
			where: { mealPlan: { userId: session.userId } },
		})

		const result = await action({
			request: await makeRequest(session, {
				intent: 'remove',
				entryId: entry!.id,
			}),
			...ACTION_ARGS_BASE,
		})
		expect(result).toEqual({ status: 'success' })

		const remaining = await prisma.mealPlanEntry.findMany({
			where: { mealPlan: { userId: session.userId } },
		})
		expect(remaining).toHaveLength(0)
	})

	test('entry not found returns 404', async () => {
		const session = await setupUser()

		const request = await makeRequest(session, {
			intent: 'toggleCooked',
			entryId: 'nonexistent-id',
		})
		const response = action({ request, ...ACTION_ARGS_BASE })
		await expect(response).rejects.toEqual(
			expect.objectContaining({ status: 404 }),
		)
	})
})
