import { describe, expect, test, vi } from 'vitest'
import { type AppLoadContext } from 'react-router'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { prisma } from '#app/utils/db.server.ts'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { getWeekStart, parseDate, serializeDate } from '#app/utils/date.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { action as planAction } from './index.tsx'
import { action as copyWeekAction } from '../resources/meal-plan-copy-week.tsx'
import { action as templateAction } from '../resources/meal-plan-templates.tsx'

const PLAN_ACTION_ARGS = {
	params: {},
	context: {} as AppLoadContext,
	unstable_pattern: '/plan',
}

const COPY_WEEK_ARGS = {
	params: {},
	context: {} as AppLoadContext,
	unstable_pattern: '/resources/meal-plan-copy-week',
}

const TEMPLATE_ARGS = {
	params: {},
	context: {} as AppLoadContext,
	unstable_pattern: '/resources/meal-plan-templates',
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

	test('save template snapshots current week entries', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const weekStart = '2026-02-02'

		// Assign Tuesday lunch and Wednesday dinner
		await planAction({
			request: await makeRequest(session, '/plan', {
				intent: 'assign',
				date: '2026-02-03', // Tuesday (dayOfWeek=1)
				mealType: 'lunch',
				recipeId: recipe.id,
				servings: '6',
			}),
			...PLAN_ACTION_ARGS,
		})
		await planAction({
			request: await makeRequest(session, '/plan', {
				intent: 'assign',
				date: '2026-02-04', // Wednesday (dayOfWeek=2)
				mealType: 'dinner',
				recipeId: recipe.id,
			}),
			...PLAN_ACTION_ARGS,
		})

		const result = await templateAction({
			request: await makeRequest(session, '/resources/meal-plan-templates', {
				intent: 'saveTemplate',
				name: 'Test Template',
				weekStart,
			}),
			...TEMPLATE_ARGS,
		})
		expect(result).toEqual({ status: 'success' })

		const template = await prisma.mealPlanTemplate.findFirst({
			where: { householdId: session.householdId },
			include: { entries: { orderBy: { dayOfWeek: 'asc' } } },
		})
		expect(template).toBeTruthy()
		expect(template!.name).toBe('Test Template')
		expect(template!.entries).toHaveLength(2)
		expect(template!.entries[0]!.dayOfWeek).toBe(1) // Tuesday
		expect(template!.entries[0]!.mealType).toBe('lunch')
		expect(template!.entries[0]!.servings).toBe(6)
		expect(template!.entries[1]!.dayOfWeek).toBe(2) // Wednesday
		expect(template!.entries[1]!.mealType).toBe('dinner')
	})

	test('apply template creates entries on correct days', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)

		// Create a template manually
		const template = await prisma.mealPlanTemplate.create({
			data: {
				name: 'Apply Test',
				userId: session.userId,
				householdId: session.householdId,
				entries: {
					create: [
						{
							dayOfWeek: 0,
							mealType: 'breakfast',
							recipeId: recipe.id,
							servings: 2,
						},
						{
							dayOfWeek: 4,
							mealType: 'dinner',
							recipeId: recipe.id,
						},
					],
				},
			},
		})

		const targetWeekStart = '2026-02-09' // Monday
		const result = await templateAction({
			request: await makeRequest(session, '/resources/meal-plan-templates', {
				intent: 'applyTemplate',
				templateId: template.id,
				weekStart: targetWeekStart,
			}),
			...TEMPLATE_ARGS,
		})
		expect(result).toEqual({ status: 'success' })

		const mealPlan = await prisma.mealPlan.findFirst({
			where: {
				householdId: session.householdId,
				weekStart: getWeekStart(parseDate(targetWeekStart)),
			},
			include: { entries: { orderBy: { date: 'asc' } } },
		})
		expect(mealPlan!.entries).toHaveLength(2)
		// Monday breakfast
		expect(serializeDate(new Date(mealPlan!.entries[0]!.date))).toBe(
			'2026-02-09',
		)
		expect(mealPlan!.entries[0]!.mealType).toBe('breakfast')
		expect(mealPlan!.entries[0]!.servings).toBe(2)
		// Friday dinner
		expect(serializeDate(new Date(mealPlan!.entries[1]!.date))).toBe(
			'2026-02-13',
		)
		expect(mealPlan!.entries[1]!.mealType).toBe('dinner')
	})

	test('apply template skips existing entries', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const weekStart = '2026-02-16'

		// First assign an entry to the week
		await planAction({
			request: await makeRequest(session, '/plan', {
				intent: 'assign',
				date: '2026-02-16', // Monday dinner
				mealType: 'dinner',
				recipeId: recipe.id,
			}),
			...PLAN_ACTION_ARGS,
		})

		// Save as template
		await templateAction({
			request: await makeRequest(session, '/resources/meal-plan-templates', {
				intent: 'saveTemplate',
				name: 'Dup Test',
				weekStart,
			}),
			...TEMPLATE_ARGS,
		})

		const template = await prisma.mealPlanTemplate.findFirst({
			where: { householdId: session.householdId },
		})

		// Apply the same template back to the same week — should not duplicate
		await templateAction({
			request: await makeRequest(session, '/resources/meal-plan-templates', {
				intent: 'applyTemplate',
				templateId: template!.id,
				weekStart,
			}),
			...TEMPLATE_ARGS,
		})

		const mealPlan = await prisma.mealPlan.findFirst({
			where: {
				householdId: session.householdId,
				weekStart: getWeekStart(parseDate(weekStart)),
			},
			include: { entries: true },
		})
		expect(mealPlan!.entries).toHaveLength(1)
	})

	test('delete template removes it with cascade', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)

		const template = await prisma.mealPlanTemplate.create({
			data: {
				name: 'To Delete',
				userId: session.userId,
				householdId: session.householdId,
				entries: {
					create: [{ dayOfWeek: 0, mealType: 'dinner', recipeId: recipe.id }],
				},
			},
		})

		const result = await templateAction({
			request: await makeRequest(session, '/resources/meal-plan-templates', {
				intent: 'deleteTemplate',
				templateId: template.id,
			}),
			...TEMPLATE_ARGS,
		})
		expect(result).toEqual({ status: 'success' })

		const deleted = await prisma.mealPlanTemplate.findUnique({
			where: { id: template.id },
		})
		expect(deleted).toBeNull()

		const entries = await prisma.mealPlanTemplateEntry.findMany({
			where: { templateId: template.id },
		})
		expect(entries).toHaveLength(0)
	})
})
