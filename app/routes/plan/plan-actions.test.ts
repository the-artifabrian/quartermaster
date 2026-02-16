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

	test('copy week duplicates entries +7 days and preserves servings', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const weekStart = '2026-02-02'

		await action({
			request: await makeRequest(session, {
				intent: 'assign',
				date: '2026-02-03', // Tuesday
				mealType: 'lunch',
				recipeId: recipe.id,
				servings: '6',
			}),
			...ACTION_ARGS_BASE,
		})

		const response = await action({
			request: await makeRequest(session, {
				intent: 'copyWeek',
				weekStart,
			}),
			...ACTION_ARGS_BASE,
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
		await action({
			request: await makeRequest(session, {
				intent: 'assign',
				date: '2026-02-03',
				mealType: 'lunch',
				recipeId: recipe.id,
			}),
			...ACTION_ARGS_BASE,
		})

		// Copy twice — second should be a no-op for existing entries
		await action({
			request: await makeRequest(session, {
				intent: 'copyWeek',
				weekStart,
			}),
			...ACTION_ARGS_BASE,
		}).catch(() => {}) // redirect throws

		await action({
			request: await makeRequest(session, {
				intent: 'copyWeek',
				weekStart,
			}),
			...ACTION_ARGS_BASE,
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
		await action({
			request: await makeRequest(session, {
				intent: 'assign',
				date: '2026-02-03', // Tuesday (dayOfWeek=1)
				mealType: 'lunch',
				recipeId: recipe.id,
				servings: '6',
			}),
			...ACTION_ARGS_BASE,
		})
		await action({
			request: await makeRequest(session, {
				intent: 'assign',
				date: '2026-02-04', // Wednesday (dayOfWeek=2)
				mealType: 'dinner',
				recipeId: recipe.id,
			}),
			...ACTION_ARGS_BASE,
		})

		const result = await action({
			request: await makeRequest(session, {
				intent: 'saveTemplate',
				name: 'Test Template',
				weekStart,
			}),
			...ACTION_ARGS_BASE,
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
		const result = await action({
			request: await makeRequest(session, {
				intent: 'applyTemplate',
				templateId: template.id,
				weekStart: targetWeekStart,
			}),
			...ACTION_ARGS_BASE,
		})
		expect(result).toEqual({ status: 'success' })

		const mealPlan = await prisma.mealPlan.findFirst({
			where: { householdId: session.householdId, weekStart: getWeekStart(parseDate(targetWeekStart)) },
			include: { entries: { orderBy: { date: 'asc' } } },
		})
		expect(mealPlan!.entries).toHaveLength(2)
		// Monday breakfast
		expect(serializeDate(new Date(mealPlan!.entries[0]!.date))).toBe('2026-02-09')
		expect(mealPlan!.entries[0]!.mealType).toBe('breakfast')
		expect(mealPlan!.entries[0]!.servings).toBe(2)
		// Friday dinner
		expect(serializeDate(new Date(mealPlan!.entries[1]!.date))).toBe('2026-02-13')
		expect(mealPlan!.entries[1]!.mealType).toBe('dinner')
	})

	test('apply template skips existing entries', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const weekStart = '2026-02-16'

		// First save a template from a week with one entry
		await action({
			request: await makeRequest(session, {
				intent: 'assign',
				date: '2026-02-16', // Monday dinner
				mealType: 'dinner',
				recipeId: recipe.id,
			}),
			...ACTION_ARGS_BASE,
		})

		await action({
			request: await makeRequest(session, {
				intent: 'saveTemplate',
				name: 'Dup Test',
				weekStart,
			}),
			...ACTION_ARGS_BASE,
		})

		const template = await prisma.mealPlanTemplate.findFirst({
			where: { householdId: session.householdId },
		})

		// Apply the same template back to the same week — should not duplicate
		await action({
			request: await makeRequest(session, {
				intent: 'applyTemplate',
				templateId: template!.id,
				weekStart,
			}),
			...ACTION_ARGS_BASE,
		})

		const mealPlan = await prisma.mealPlan.findFirst({
			where: { householdId: session.householdId, weekStart: getWeekStart(parseDate(weekStart)) },
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
					create: [
						{ dayOfWeek: 0, mealType: 'dinner', recipeId: recipe.id },
					],
				},
			},
		})

		const result = await action({
			request: await makeRequest(session, {
				intent: 'deleteTemplate',
				templateId: template.id,
			}),
			...ACTION_ARGS_BASE,
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
