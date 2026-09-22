import { RouterContextProvider } from 'react-router'
import { describe, expect, test, vi } from 'vitest'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))

import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { getCurrentWeekStart } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { BASE_URL, getSessionCookieHeader } from '#tests/utils.ts'
import { action as recipeAction } from '../recipes/$recipeId.tsx'
import { loader as planPickerLoader } from '../resources/shopping-plan.tsx'
import { action as shoppingAction } from '../shopping.tsx'
import { action as planAction, loader as planLoader } from './index.tsx'
import '#tests/setup/db-setup.ts'

const PLAN_ARGS = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/plan',
	url: new URL(`${BASE_URL}/plan`),
}

const SHOPPING_ARGS = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/shopping',
	url: new URL(`${BASE_URL}/shopping`),
}

type TestSession = {
	id: string
	userId: string
	householdId: string
}

async function setupHousehold(stapleNames: string[]): Promise<TestSession> {
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
				name: 'Staples test household',
				members: { create: { userId: session.userId, role: 'owner' } },
				householdIngredients: {
					create: stapleNames.map((displayName) => ({
						displayName,
						canonicalKey: displayName.toLowerCase(),
						isStaple: true,
					})),
				},
			},
		})
		return { ...session, householdId: household.id }
	})
}

async function makeRequest(
	session: Pick<TestSession, 'id'>,
	path: string,
	formFields: Record<string, string>,
) {
	const cookie = await getSessionCookieHeader(session)
	return new Request(`${BASE_URL}${path}`, {
		method: 'POST',
		headers: {
			cookie,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams(formFields).toString(),
	})
}

async function runShoppingAction(
	session: TestSession,
	formFields: Record<string, string>,
) {
	return shoppingAction({
		request: await makeRequest(session, '/shopping', formFields),
		...SHOPPING_ARGS,
	})
}

async function runPlanAction(
	session: TestSession,
	formFields: Record<string, string>,
) {
	return planAction({
		request: await makeRequest(session, '/plan', formFields),
		...PLAN_ARGS,
	})
}

async function runPlanPickerLoader(session: TestSession) {
	const cookie = await getSessionCookieHeader(session)
	const url = new URL(`${BASE_URL}/resources/shopping-plan`)
	return planPickerLoader({
		request: new Request(url, { headers: { cookie } }),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/resources/shopping-plan',
		url,
	})
}

async function runPlanLoader(session: TestSession) {
	const cookie = await getSessionCookieHeader(session)
	return planLoader({
		request: new Request(`${BASE_URL}/plan`, { headers: { cookie } }),
		...PLAN_ARGS,
	})
}

async function setupRecipe(session: TestSession, title: string) {
	return prisma.recipe.create({
		data: {
			title,
			userId: session.userId,
			householdId: session.householdId,
			ingredients: {
				create: [
					{ name: 'salt', amount: '1', unit: 'tsp', order: 0 },
					{ name: 'chicken', amount: '500', unit: 'g', order: 1 },
					{ name: 'medium/small peaches', amount: '3', order: 2 },
				],
			},
		},
	})
}

async function setupMeal(
	session: TestSession,
	recipe: { id: string; title: string },
) {
	const weekStart = getCurrentWeekStart()
	const mealPlan = await prisma.mealPlan.create({
		data: { householdId: session.householdId, weekStart },
	})
	return prisma.meal.create({
		data: {
			mealPlanId: mealPlan.id,
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
	})
}

async function getRows(householdId: string) {
	return prisma.shoppingListItem.findMany({
		where: { list: { householdId } },
		orderBy: { name: 'asc' },
	})
}

describe('household Staple annotation at explicit Shopping actions (#116)', () => {
	test('the Plan picker unticks each household\u2019s own Staples', async () => {
		const stocked = await setupHousehold(['chicken'])
		const unstocked = await setupHousehold([])
		const stockedRecipe = await setupRecipe(stocked, 'Chicken supper')
		const unstockedRecipe = await setupRecipe(unstocked, 'Also chicken supper')
		const stockedMeal = await setupMeal(stocked, stockedRecipe)
		const unstockedMeal = await setupMeal(unstocked, unstockedRecipe)

		// Each household's own picker defaults, then the ticked lines.
		for (const [session, meal] of [
			[stocked, stockedMeal],
			[unstocked, unstockedMeal],
		] as const) {
			const choices = await runPlanPickerLoader(session)
			const lines = choices.data.days[0]!.meals[0]!.lines
			await runShoppingAction(session, {
				intent: 'add-from-plan',
				picks: JSON.stringify([
					{
						mealId: meal.id,
						lines: lines
							.filter((line) => line.status === 'needed')
							.map((line) => line.canonicalName),
					},
				]),
			})
		}

		expect((await getRows(stocked.householdId)).map((row) => row.name)).toEqual(
			['medium/small peaches'],
		)
		expect(
			(await getRows(unstocked.householdId)).map((row) => row.name),
		).toEqual(['chicken', 'medium/small peaches'])
		// Neither household saved salt, and neither is asked to untick it every
		// week: the plain-basics heuristic still supplies the picker default.
		expect(
			(await getRows(unstocked.householdId)).every(
				(row) => row.source === 'meal' && !row.checked,
			),
		).toBe(true)
	})

	test('a Staple change leaves an active list untouched until the next explicit Recipe add', async () => {
		const session = await setupHousehold(['salt'])
		const recipe = await setupRecipe(session, 'Chicken and peaches')

		await recipeAction({
			request: await makeRequest(session, `/recipes/${recipe.id}`, {
				intent: 'add-to-shopping-list',
				servingRatio: '1',
			}),
			params: { recipeId: recipe.id },
			context: new RouterContextProvider(),
			pattern: '/recipes/:recipeId',
			url: new URL(`${BASE_URL}/recipes/${recipe.id}`),
		})
		expect((await getRows(session.householdId)).map((row) => row.name)).toEqual(
			['chicken', 'medium/small peaches'],
		)

		// Removing the Staple: the household no longer assumes it is in.
		await prisma.householdIngredient.update({
			where: {
				householdId_canonicalKey: {
					householdId: session.householdId,
					canonicalKey: 'salt',
				},
			},
			data: { isStaple: false },
		})
		// Changing the Staples never mutates the current Shopping rows itself.
		expect((await getRows(session.householdId)).map((row) => row.name)).toEqual(
			['chicken', 'medium/small peaches'],
		)

		await recipeAction({
			request: await makeRequest(session, `/recipes/${recipe.id}`, {
				intent: 'add-to-shopping-list',
				servingRatio: '1',
			}),
			params: { recipeId: recipe.id },
			context: new RouterContextProvider(),
			pattern: '/recipes/:recipeId',
			url: new URL(`${BASE_URL}/recipes/${recipe.id}`),
		})
		expect((await getRows(session.householdId)).map((row) => row.name)).toEqual(
			['chicken', 'medium/small peaches', 'salt'],
		)
	})

	test('Meal refresh applies a later Staple change while preserving a colliding manual row', async () => {
		const session = await setupHousehold([])
		const recipe = await setupRecipe(session, 'Refreshable supper')
		const meal = await setupMeal(session, recipe)
		await runShoppingAction(session, {
			intent: 'add',
			name: 'salt',
			quantity: '1',
			unit: 'box',
		})
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})

		const manualSalt = await prisma.shoppingListItem.findFirstOrThrow({
			where: { list: { householdId: session.householdId }, name: 'salt' },
		})
		expect(manualSalt).toMatchObject({
			source: 'manual',
			quantity: '1',
			unit: 'box',
		})
		expect(
			await prisma.mealShoppingContribution.count({
				where: { mealId: meal.id, canonicalName: 'salt' },
			}),
		).toBe(1)

		await prisma.householdIngredient.create({
			data: {
				householdId: session.householdId,
				displayName: 'salt',
				canonicalKey: 'salt',
				isStaple: true,
			},
		})
		// The Staples write only marks fresh demand stale; rows and
		// contributions stay byte-for-byte present until explicit refresh.
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: manualSalt.id },
			}),
		).toEqual(manualSalt)
		expect(
			await prisma.mealShoppingContribution.count({
				where: { mealId: meal.id, canonicalName: 'salt' },
			}),
		).toBe(1)
		expect((await runPlanLoader(session)).meals[0]!.shoppingDemandStatus).toBe(
			'stale',
		)

		await runPlanAction(session, {
			intent: 'refreshMealShopping',
			mealId: meal.id,
		})
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: manualSalt.id },
			}),
		).toEqual({ ...manualSalt, checkVersion: manualSalt.checkVersion + 1 })
		expect(
			await prisma.mealShoppingContribution.count({
				where: { mealId: meal.id, canonicalName: 'salt' },
			}),
		).toBe(0)
		expect((await runPlanLoader(session)).meals[0]!.shoppingDemandStatus).toBe(
			'current',
		)

		await prisma.householdIngredient.update({
			where: {
				householdId_canonicalKey: {
					householdId: session.householdId,
					canonicalKey: 'salt',
				},
			},
			data: { isStaple: false },
		})
		expect(
			await prisma.mealShoppingContribution.count({
				where: { mealId: meal.id, canonicalName: 'salt' },
			}),
		).toBe(0)

		await runPlanAction(session, {
			intent: 'refreshMealShopping',
			mealId: meal.id,
		})
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: manualSalt.id },
			}),
		).toEqual({ ...manualSalt, checkVersion: manualSalt.checkVersion + 2 })
		expect(
			await prisma.mealShoppingContribution.count({
				where: { mealId: meal.id, canonicalName: 'salt' },
			}),
		).toBe(1)
	})
})
