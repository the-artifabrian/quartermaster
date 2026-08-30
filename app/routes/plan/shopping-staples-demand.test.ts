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
import { action as shoppingAction } from '../shopping.tsx'
import { action as planAction, loader as planLoader } from './index.tsx'

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

async function setupCutoverHousehold(
	staples: Array<{ displayName: string; isOut?: boolean }>,
): Promise<TestSession> {
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
				staplesCutoverAt: new Date(),
				members: { create: { userId: session.userId, role: 'owner' } },
				householdIngredients: {
					create: staples.map((staple) => ({
						displayName: staple.displayName,
						canonicalKey: staple.displayName.toLowerCase(),
						isStaple: true,
						isOut: staple.isOut ?? false,
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
	test('week generation omits normal Staples, includes Out Staples and unresolved non-Staples, and isolates households', async () => {
		const normal = await setupCutoverHousehold([{ displayName: 'salt' }])
		const out = await setupCutoverHousehold([
			{ displayName: 'salt', isOut: true },
		])
		const normalRecipe = await setupRecipe(normal, 'Normal salt supper')
		const outRecipe = await setupRecipe(out, 'Out of salt supper')
		await setupMeal(normal, normalRecipe)
		await setupMeal(out, outRecipe)

		await runShoppingAction(normal, { intent: 'generate' })
		await runShoppingAction(out, { intent: 'generate' })

		expect((await getRows(normal.householdId)).map((row) => row.name)).toEqual([
			'chicken',
			'medium/small peaches',
		])
		expect((await getRows(out.householdId)).map((row) => row.name)).toEqual([
			'chicken',
			'medium/small peaches',
			'salt',
		])
		expect(
			(await getRows(out.householdId)).every(
				(row) => row.source === 'generated' && !row.checked,
			),
		).toBe(true)
	})

	test('a Staple change leaves an active list untouched until the next explicit Recipe add', async () => {
		const session = await setupCutoverHousehold([{ displayName: 'salt' }])
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

		await prisma.householdIngredient.update({
			where: {
				householdId_canonicalKey: {
					householdId: session.householdId,
					canonicalKey: 'salt',
				},
			},
			data: { isOut: true },
		})
		// Changing availability never mutates the current Shopping rows itself.
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

	test('Meal refresh applies later Staple state while preserving a colliding manual row', async () => {
		const session = await setupCutoverHousehold([
			{ displayName: 'salt', isOut: true },
		])
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

		await prisma.householdIngredient.update({
			where: {
				householdId_canonicalKey: {
					householdId: session.householdId,
					canonicalKey: 'salt',
				},
			},
			data: { isOut: false },
		})
		// The availability write only marks fresh demand stale; rows and
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
		).toEqual(manualSalt)
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
			data: { isOut: true },
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
		).toEqual(manualSalt)
		expect(
			await prisma.mealShoppingContribution.count({
				where: { mealId: meal.id, canonicalName: 'salt' },
			}),
		).toBe(1)
	})
})
