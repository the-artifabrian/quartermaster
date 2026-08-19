import { RouterContextProvider } from 'react-router'
import { describe, expect, test, vi } from 'vitest'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { action as copyWeekAction } from '../resources/meal-plan-copy-week.tsx'
import { action as planAction } from './index.tsx'

const PLAN_ACTION_ARGS = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/plan',
	url: new URL(`${BASE_URL}/plan`),
}

const COPY_WEEK_ARGS = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/resources/meal-plan-copy-week',
	url: new URL(`${BASE_URL}/resources/meal-plan-copy-week`),
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
	url: string,
	formFields: Record<string, string>,
) {
	const cookie = await getSessionCookieHeader(session)
	const formData = new URLSearchParams(formFields)
	return new Request(`${BASE_URL}${url}`, {
		method: 'POST',
		headers: {
			cookie,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: formData.toString(),
	})
}

describe('meal plan resource routes', () => {
	test('copy week duplicates Meals +7 days, preserving label, multiplier, and text, resetting cooked state', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const weekStart = '2026-02-02'

		await planAction({
			request: await makeRequest(session, '/plan', {
				intent: 'addMeal',
				date: '2026-02-03', // Tuesday
				label: 'lunch',
				recipeId: recipe.id,
				multiplier: '1.5',
			}),
			...PLAN_ACTION_ARGS,
		})
		await planAction({
			request: await makeRequest(session, '/plan', {
				intent: 'addTextMeal',
				date: '2026-02-03',
				text: 'Leftovers',
			}),
			...PLAN_ACTION_ARGS,
		})
		// Cooked state does not travel to next week.
		const sourceItem = await prisma.mealRecipeItem.findFirstOrThrow({
			where: { meal: { mealPlan: { householdId: session.householdId } } },
		})
		await planAction({
			request: await makeRequest(session, '/plan', {
				intent: 'setItemCooked',
				itemId: sourceItem.id,
				cooked: 'true',
			}),
			...PLAN_ACTION_ARGS,
		})

		const response = await copyWeekAction({
			request: await makeRequest(session, '/resources/meal-plan-copy-week', {
				weekStart,
			}),
			...COPY_WEEK_ARGS,
		}).catch((e: Response) => e)

		// Should redirect to next week
		expect(response).toBeInstanceOf(Response)
		const location = (response as Response).headers.get('location')
		expect(location).toContain('weekStart=2026-02-09')

		// Check next week has the copied Meals
		const nextWeekPlan = await prisma.mealPlan.findFirst({
			where: { householdId: session.householdId },
			orderBy: { weekStart: 'desc' },
			include: {
				meals: {
					orderBy: { order: 'asc' },
					include: { recipeItems: true },
				},
			},
		})
		expect(nextWeekPlan!.meals).toHaveLength(2)
		const [recipeMeal, textMeal] = nextWeekPlan!.meals
		expect(recipeMeal).toMatchObject({ label: 'lunch', genericText: null })
		expect(serializeDate(new Date(recipeMeal!.date))).toBe('2026-02-10')
		expect(recipeMeal!.recipeItems[0]).toMatchObject({
			recipeId: recipe.id,
			scaleMultiplier: 1.5,
			cooked: false,
		})
		expect(textMeal).toMatchObject({
			genericText: 'Leftovers',
			completed: false,
		})
	})

	test('copy week pressed twice does not duplicate Meals', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const weekStart = '2026-02-02'

		// Set up source week
		await planAction({
			request: await makeRequest(session, '/plan', {
				intent: 'addMeal',
				date: '2026-02-03',
				label: 'lunch',
				recipeId: recipe.id,
			}),
			...PLAN_ACTION_ARGS,
		})

		// Copy twice — second should be a no-op for existing entries
		await copyWeekAction({
			request: await makeRequest(session, '/resources/meal-plan-copy-week', {
				weekStart,
			}),
			...COPY_WEEK_ARGS,
		}).catch(() => {}) // redirect throws

		await copyWeekAction({
			request: await makeRequest(session, '/resources/meal-plan-copy-week', {
				weekStart,
			}),
			...COPY_WEEK_ARGS,
		}).catch(() => {})

		const nextWeekPlan = await prisma.mealPlan.findFirst({
			where: { householdId: session.householdId },
			orderBy: { weekStart: 'desc' },
			include: { meals: { include: { recipeItems: true } } },
		})
		expect(nextWeekPlan!.meals).toHaveLength(1) // Not duplicated
		expect(nextWeekPlan!.meals[0]!.recipeItems).toHaveLength(1)
	})
})
