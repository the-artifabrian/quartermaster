import { type AppLoadContext } from 'react-router'
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
	context: {} as AppLoadContext,
	unstable_pattern: '/plan',
	unstable_url: new URL(`${BASE_URL}/plan`),
}

const COPY_WEEK_ARGS = {
	params: {},
	context: {} as AppLoadContext,
	unstable_pattern: '/resources/meal-plan-copy-week',
	unstable_url: new URL(`${BASE_URL}/resources/meal-plan-copy-week`),
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
	test('copy week duplicates entries +7 days and preserves servings', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const weekStart = '2026-02-02'

		await planAction({
			request: await makeRequest(session, '/plan', {
				intent: 'assign',
				date: '2026-02-03', // Tuesday
				mealType: 'lunch',
				recipeId: recipe.id,
				servings: '6',
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

		// Check next week has the copied entry
		const nextWeekPlan = await prisma.mealPlan.findFirst({
			where: { userId: session.userId },
			orderBy: { weekStart: 'desc' },
			include: { entries: true },
		})
		expect(nextWeekPlan!.entries).toHaveLength(1)
		expect(nextWeekPlan!.entries[0]!.mealType).toBe('lunch')
		expect(nextWeekPlan!.entries[0]!.servings).toBe(6)
		expect(serializeDate(new Date(nextWeekPlan!.entries[0]!.date))).toBe(
			'2026-02-10', // Tuesday + 7
		)
	})

	test('copy week skips existing entries', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const weekStart = '2026-02-02'

		// Set up source week
		await planAction({
			request: await makeRequest(session, '/plan', {
				intent: 'assign',
				date: '2026-02-03',
				mealType: 'lunch',
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
			where: { userId: session.userId },
			orderBy: { weekStart: 'desc' },
			include: { entries: true },
		})
		expect(nextWeekPlan!.entries).toHaveLength(1) // Not duplicated
	})
})
