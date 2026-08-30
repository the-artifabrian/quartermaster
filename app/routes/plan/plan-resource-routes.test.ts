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

	test('copy week carries a Menu snapshot whole — sections, notes, lines, source revision — resetting cooked state', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const menu = await prisma.menu.create({
			data: {
				title: 'Feast',
				titleKey: 'feast',
				householdId: session.householdId,
				sections: { create: { name: null, order: 0 } },
			},
		})
		const plan = await prisma.mealPlan.create({
			data: {
				householdId: session.householdId,
				weekStart: new Date('2026-02-02T00:00:00.000Z'),
			},
		})
		const revision = new Date('2026-02-01T09:00:00.000Z')
		const meal = await prisma.meal.create({
			data: {
				mealPlanId: plan.id,
				date: new Date('2026-02-03T00:00:00.000Z'),
				order: 0,
				label: 'dinner',
				guestCount: 8,
				sourceMenuId: menu.id,
				sourceMenuRevision: revision,
			},
		})
		const section = await prisma.mealSection.create({
			data: { mealId: meal.id, name: 'Mains', order: 0 },
		})
		await prisma.mealRecipeItem.create({
			data: {
				mealId: meal.id,
				sectionId: section.id,
				order: 0,
				recipeId: recipe.id,
				recipeTitle: 'Test Recipe',
				scaleMultiplier: 2.5,
				note: 'Two batches',
				cooked: true,
			},
		})
		await prisma.mealNoteItem.create({
			data: {
				mealId: meal.id,
				sectionId: section.id,
				order: 1,
				text: 'Drinks',
				shoppingLines: {
					create: [{ name: 'Lemonade', quantity: '2', unit: 'l', order: 0 }],
				},
			},
		})

		// Twice — the second press must recognize the copied snapshot.
		for (let i = 0; i < 2; i++) {
			await copyWeekAction({
				request: await makeRequest(session, '/resources/meal-plan-copy-week', {
					weekStart: '2026-02-02',
				}),
				...COPY_WEEK_ARGS,
			})
		}

		const copied = await prisma.meal.findMany({
			where: {
				mealPlan: {
					householdId: session.householdId,
					weekStart: new Date('2026-02-09T00:00:00.000Z'),
				},
			},
			include: {
				sections: { orderBy: { order: 'asc' } },
				noteItems: {
					orderBy: { order: 'asc' },
					include: { shoppingLines: { orderBy: { order: 'asc' } } },
				},
				recipeItems: { orderBy: { order: 'asc' } },
			},
		})
		expect(copied).toHaveLength(1)
		const copy = copied[0]!
		expect(copy).toMatchObject({
			label: 'dinner',
			guestCount: 8,
			sourceMenuId: menu.id,
		})
		expect(copy.sourceMenuRevision?.getTime()).toBe(revision.getTime())
		expect(serializeDate(new Date(copy.date))).toBe('2026-02-10')
		expect(copy.sections.map((s) => s.name)).toEqual(['Mains'])
		expect(copy.recipeItems).toMatchObject([
			{
				sectionId: copy.sections[0]!.id,
				order: 0,
				recipeId: recipe.id,
				recipeTitle: 'Test Recipe',
				scaleMultiplier: 2.5,
				note: 'Two batches',
				cooked: false, // next week starts fresh
			},
		])
		expect(copy.noteItems).toMatchObject([
			{ sectionId: copy.sections[0]!.id, order: 1, text: 'Drinks' },
		])
		expect(copy.noteItems[0]!.shoppingLines).toMatchObject([
			{ name: 'Lemonade', quantity: '2', unit: 'l' },
		])
	})
})
