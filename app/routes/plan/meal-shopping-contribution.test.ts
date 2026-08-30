import { RouterContextProvider } from 'react-router'
import { describe, expect, test, vi } from 'vitest'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { getCurrentWeekStart } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { action as recipeAction } from '../recipes/$recipeId.tsx'
import {
	action as shoppingAction,
	loader as shoppingLoader,
} from '../shopping.tsx'
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

async function makeRequest(
	session: { id: string },
	path: string,
	formFields: Record<string, string>,
) {
	const cookie = await getSessionCookieHeader(session)
	const formData = new URLSearchParams(formFields)
	return new Request(`${BASE_URL}${path}`, {
		method: 'POST',
		headers: {
			cookie,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: formData.toString(),
	})
}

async function runPlanAction(
	session: { id: string },
	formFields: Record<string, string>,
) {
	return planAction({
		request: await makeRequest(session, '/plan', formFields),
		...PLAN_ARGS,
	})
}

async function runShoppingAction(
	session: { id: string },
	formFields: Record<string, string>,
) {
	return shoppingAction({
		request: await makeRequest(session, '/shopping', formFields),
		...SHOPPING_ARGS,
	})
}

async function runPlanLoader(session: { id: string }) {
	const cookie = await getSessionCookieHeader(session)
	return planLoader({
		request: new Request(`${BASE_URL}/plan`, { headers: { cookie } }),
		...PLAN_ARGS,
	})
}

/**
 * A recipe whose ingredients exercise every availability path: a normal
 * line, a scalable line, a staple (stripped), an optional (excluded), a
 * heading (excluded), and one usually-in-stock line when the test seeds
 * matching Inventory.
 */
async function setupRecipe(
	userId: string,
	householdId: string,
	title = 'Kofta Platter',
) {
	return prisma.recipe.create({
		data: {
			title,
			userId,
			householdId,
			ingredients: {
				create: [
					{ name: 'For the kofta:', isHeading: true, order: 0 },
					{ name: 'ground lamb', amount: '500', unit: 'g', order: 1 },
					{ name: 'chicken stock', amount: '2', unit: 'cups', order: 2 },
					{ name: 'salt', order: 3 },
					{ name: 'sesame seeds', notes: 'optional', order: 4 },
				],
			},
		},
	})
}

async function setupMeal(
	householdId: string,
	recipe: { id: string; title: string },
	{ scaleMultiplier = 1 }: { scaleMultiplier?: number } = {},
) {
	const weekStart = getCurrentWeekStart()
	const mealPlan = await prisma.mealPlan.upsert({
		where: { householdId_weekStart: { householdId, weekStart } },
		create: { householdId, weekStart },
		update: {},
	})
	const order = await prisma.meal.count({
		where: { mealPlanId: mealPlan.id, date: weekStart },
	})
	return prisma.meal.create({
		data: {
			mealPlanId: mealPlan.id,
			date: weekStart,
			order,
			recipeItems: {
				create: {
					order: 0,
					recipeId: recipe.id,
					recipeTitle: recipe.title,
					scaleMultiplier,
				},
			},
		},
	})
}

async function getShoppingRows(householdId: string) {
	const rows = await prisma.shoppingListItem.findMany({
		where: { list: { householdId } },
		orderBy: { name: 'asc' },
	})
	return rows
}

async function getContributions(householdId: string) {
	return prisma.mealShoppingContribution.findMany({
		where: { item: { list: { householdId } } },
		orderBy: { canonicalName: 'asc' },
	})
}

describe('Meal Shopping demand status (#110)', () => {
	test('accepted multiplier changes mark demand stale while cooked and label edits do not', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})

		const current = await runPlanLoader(session)
		expect(current.meals[0]!.shoppingDemandStatus).toBe('current')

		const item = await prisma.mealRecipeItem.findFirstOrThrow({
			where: { mealId: meal.id },
		})
		await runPlanAction(session, {
			intent: 'setItemCooked',
			itemId: item.id,
			cooked: 'true',
		})
		await prisma.meal.update({
			where: { id: meal.id },
			data: { label: 'dinner' },
		})
		expect((await runPlanLoader(session)).meals[0]!.shoppingDemandStatus).toBe(
			'current',
		)

		await runPlanAction(session, {
			intent: 'setItemMultiplier',
			itemId: item.id,
			multiplier: '2',
		})
		expect((await runPlanLoader(session)).meals[0]!.shoppingDemandStatus).toBe(
			'stale',
		)
	})

	test('ingredient, Meal-composition, and note-line changes each mark only current demand stale', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})

		await prisma.recipe.update({
			where: { id: recipe.id },
			data: { description: 'A display-only description' },
		})
		expect((await runPlanLoader(session)).meals[0]!.shoppingDemandStatus).toBe(
			'current',
		)
		const lamb = await prisma.ingredient.findFirstOrThrow({
			where: { recipeId: recipe.id, name: 'ground lamb' },
		})
		await prisma.ingredient.update({
			where: { id: lamb.id },
			data: { amount: '600' },
		})
		expect((await runPlanLoader(session)).meals[0]!.shoppingDemandStatus).toBe(
			'stale',
		)
		await runPlanAction(session, {
			intent: 'refreshMealShopping',
			mealId: meal.id,
		})

		const side = await prisma.recipe.create({
			data: {
				title: 'Flatbread',
				userId: session.userId,
				householdId: session.householdId,
				ingredients: {
					create: [{ name: 'flour', amount: '500', unit: 'g', order: 0 }],
				},
			},
		})
		await runPlanAction(session, {
			intent: 'addRecipeToMeal',
			mealId: meal.id,
			recipeId: side.id,
		})
		expect((await runPlanLoader(session)).meals[0]!.shoppingDemandStatus).toBe(
			'stale',
		)
		await runPlanAction(session, {
			intent: 'refreshMealShopping',
			mealId: meal.id,
		})

		const note = await addNoteLines(meal.id, [
			{ name: 'lemons', quantity: '6' },
		])
		expect((await runPlanLoader(session)).meals[0]!.shoppingDemandStatus).toBe(
			'stale',
		)
		await runPlanAction(session, {
			intent: 'refreshMealShopping',
			mealId: meal.id,
		})
		await prisma.mealNoteItem.update({
			where: { id: note.id },
			data: { text: 'Display text only' },
		})
		expect((await runPlanLoader(session)).meals[0]!.shoppingDemandStatus).toBe(
			'current',
		)
		await prisma.mealShoppingLine.updateMany({
			where: { noteItemId: note.id },
			data: { quantity: '8' },
		})
		expect((await runPlanLoader(session)).meals[0]!.shoppingDemandStatus).toBe(
			'stale',
		)
	})
})

describe('refreshMealShopping — one-Meal replacement (#110)', () => {
	test('refreshes only the chosen Meal and preserves its display groups, manual row, and checked state', async () => {
		const session = await setupUser()
		const recipeA = await setupRecipe(
			session.userId,
			session.householdId,
			'Kofta A',
		)
		const recipeB = await prisma.recipe.create({
			data: {
				title: 'Kofta B',
				userId: session.userId,
				householdId: session.householdId,
				ingredients: {
					create: [
						{ name: 'ground lamb', amount: '300', unit: 'g', order: 0 },
						{ name: 'carrots', amount: '2', order: 1 },
					],
				},
			},
		})
		const mealA = await setupMeal(session.householdId, recipeA)
		const mealB = await setupMeal(session.householdId, recipeB)

		await runShoppingAction(session, {
			intent: 'add',
			name: 'ground lamb',
			quantity: '250',
			unit: 'g',
		})
		const manualLamb = (await getShoppingRows(session.householdId)).find(
			(row) => row.name === 'ground lamb',
		)!
		await prisma.shoppingListItem.update({
			where: { id: manualLamb.id },
			data: { checked: true },
		})
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: mealA.id,
		})
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: mealB.id,
		})
		const mealBBefore = await prisma.mealShoppingContribution.findMany({
			where: { mealId: mealB.id },
			orderBy: { canonicalName: 'asc' },
		})

		const itemA = await prisma.mealRecipeItem.findFirstOrThrow({
			where: { mealId: mealA.id },
		})
		await runPlanAction(session, {
			intent: 'setItemMultiplier',
			itemId: itemA.id,
			multiplier: '2',
		})
		const stock = await prisma.ingredient.findFirstOrThrow({
			where: { recipeId: recipeA.id, name: 'chicken stock' },
		})
		await prisma.ingredient.update({
			where: { id: stock.id },
			data: { name: 'yogurt', amount: '1', unit: 'cup' },
		})
		await prisma.inventoryItem.create({
			data: {
				name: 'yogurt',
				userId: session.userId,
				householdId: session.householdId,
			},
		})

		const result = (await runPlanAction(session, {
			intent: 'refreshMealShopping',
			mealId: mealA.id,
		})) as {
			status: string
			shopping: {
				createdRowCount: number
				updatedContributionCount: number
				removedContributionCount: number
			}
		}
		expect(result).toMatchObject({
			status: 'success',
			shopping: {
				createdRowCount: 1,
				updatedContributionCount: 1,
				removedContributionCount: 1,
			},
		})

		const lambAfter = await prisma.shoppingListItem.findUniqueOrThrow({
			where: { id: manualLamb.id },
		})
		expect(lambAfter).toMatchObject({
			name: 'ground lamb',
			quantity: '250',
			unit: 'g',
			checked: true,
			source: 'manual',
		})
		expect(
			await prisma.mealShoppingContribution.findMany({
				where: { mealId: mealB.id },
				orderBy: { canonicalName: 'asc' },
			}),
		).toEqual(mealBBefore)

		const rows = await getShoppingRows(session.householdId)
		expect(rows.some((row) => row.name === 'chicken stock')).toBe(false)
		expect(rows.find((row) => row.name === 'yogurt')).toMatchObject({
			quantity: '2',
			unit: 'cup',
			checked: false,
			source: 'meal',
		})
		expect((await runPlanLoader(session)).meals[0]!.shoppingDemandStatus).toBe(
			'current',
		)
	})

	test('a missing Recipe blocks refresh and leaves its existing contribution untouched', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		const before = await getContributions(session.householdId)

		await prisma.recipe.delete({ where: { id: recipe.id } })
		expect((await runPlanLoader(session)).meals[0]!.shoppingDemandStatus).toBe(
			'blocked',
		)
		await expect(
			runPlanAction(session, {
				intent: 'refreshMealShopping',
				mealId: meal.id,
			}),
		).rejects.toEqual(expect.objectContaining({ status: 400 }))
		expect(await getContributions(session.householdId)).toEqual(before)
	})
})

describe('Shopping generated-group conversion (#110)', () => {
	test('editing a generated-only group materializes one manual total and a later refresh recreates only the chosen Meal', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const mealA = await setupMeal(session.householdId, recipe)
		const mealB = await setupMeal(session.householdId, recipe, {
			scaleMultiplier: 2,
		})
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: mealA.id,
		})
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: mealB.id,
		})
		const before = await runShoppingLoader(session)
		const lamb = before.shoppingList.items.find((item) =>
			item.name.includes('lamb'),
		)!
		expect(lamb.display).toMatchObject({ quantity: '1.5', unit: 'kg' })

		await runShoppingAction(session, {
			intent: 'edit',
			itemId: lamb.id,
			name: 'ground lamb',
			quantity: '1600',
			unit: 'g',
		})
		const materialized = await prisma.shoppingListItem.findUniqueOrThrow({
			where: { id: lamb.id },
		})
		expect(materialized).toMatchObject({
			source: 'manual',
			quantity: '1600',
			unit: 'g',
		})
		expect(
			await prisma.mealShoppingContribution.count({
				where: { itemId: lamb.id },
			}),
		).toBe(0)

		await runPlanAction(session, {
			intent: 'refreshMealShopping',
			mealId: mealA.id,
		})
		const recreated = await prisma.mealShoppingContribution.findMany({
			where: { itemId: lamb.id },
		})
		expect(recreated).toHaveLength(1)
		expect(recreated[0]!.mealId).toBe(mealA.id)
		expect(
			(await runShoppingLoader(session)).shoppingList.items.find(
				(item) => item.id === lamb.id,
			)!.display,
		).toMatchObject({ quantity: '2.1', unit: 'kg', combined: true })
	})

	test('editing a mixed group changes only manual demand and removing generated amount leaves it protected', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		await runShoppingAction(session, {
			intent: 'add',
			name: 'ground lamb',
			quantity: '250',
			unit: 'g',
		})
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		const lamb = (await getShoppingRows(session.householdId)).find((row) =>
			row.name.includes('lamb'),
		)!

		await runShoppingAction(session, {
			intent: 'edit',
			itemId: lamb.id,
			name: 'ground lamb',
			quantity: '300',
			unit: 'g',
		})
		expect(
			await prisma.mealShoppingContribution.findFirst({
				where: { itemId: lamb.id },
			}),
		).toMatchObject({ quantity: '500', unit: 'g' })
		expect(
			(await runShoppingLoader(session)).shoppingList.items.find(
				(item) => item.id === lamb.id,
			)!.display,
		).toMatchObject({ quantity: '800', unit: 'g', combined: true })

		await runShoppingAction(session, {
			intent: 'removeGeneratedAmount',
			itemId: lamb.id,
		})
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: lamb.id },
			}),
		).toMatchObject({ source: 'manual', quantity: '300', unit: 'g' })
		expect(
			await prisma.mealShoppingContribution.count({
				where: { itemId: lamb.id },
			}),
		).toBe(0)
	})
})

describe('addMealToShopping — one-Meal demand and provenance (#108)', () => {
	test('the explicit action puts one Recipe Meal on Shopping with current-state contributions', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe, {
			scaleMultiplier: 2,
		})

		const result = (await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})) as { status: string; shopping: { createdRowCount: number } }
		expect(result.status).toBe('success')
		expect(result.shopping.createdRowCount).toBe(2)

		const rows = await getShoppingRows(session.householdId)
		// Staple, optional, and heading excluded; multiplier scales quantities.
		expect(
			rows.map((row) => [row.name, row.quantity, row.unit, row.source]),
		).toEqual([
			['chicken stock', '4', 'cups', 'meal'],
			['ground lamb', '1000', 'g', 'meal'],
		])
		expect(rows.every((row) => !row.checked)).toBe(true)

		const contributions = await getContributions(session.householdId)
		expect(contributions).toHaveLength(2)
		expect(contributions.every((c) => c.mealId === meal.id)).toBe(true)
		// Each contribution links the Meal to the displayed row it feeds and
		// records the normalized demand that was added.
		const rowIds = new Set(rows.map((row) => row.id))
		expect(contributions.every((c) => rowIds.has(c.itemId))).toBe(true)
		expect(contributions.map((c) => [c.name, c.quantity, c.unit])).toEqual([
			['chicken stock', '4', 'cups'],
			['ground lamb', '1000', 'g'],
		])
	})

	test('planning a Meal never touches Shopping — demand is added only by the explicit action', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)

		const weekStart = getCurrentWeekStart()
		const result = (await runPlanAction(session, {
			intent: 'addMeal',
			date: weekStart.toISOString().slice(0, 10),
			recipeId: recipe.id,
		})) as { status: string }
		expect(result.status).toBe('success')

		expect(await getShoppingRows(session.householdId)).toHaveLength(0)
		expect(await prisma.mealShoppingContribution.count()).toBe(0)
	})

	test('one-Recipe demand is equivalent to the trusted generate-from-Plan flow', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe, {
			scaleMultiplier: 2,
		})
		// One usually-on-hand ingredient so the pre-check path is compared too.
		await prisma.inventoryItem.create({
			data: {
				name: 'chicken stock',
				userId: session.userId,
				householdId: session.householdId,
			},
		})

		const project = (rows: Awaited<ReturnType<typeof getShoppingRows>>) =>
			rows.map((row) => [
				row.name,
				row.quantity,
				row.unit,
				row.category,
				row.checked,
			])

		// Trusted flow: week-wide generation.
		await runShoppingAction(session, { intent: 'generate' })
		const trusted = project(await getShoppingRows(session.householdId))
		expect(trusted.length).toBeGreaterThan(0)
		await prisma.shoppingListItem.deleteMany({})

		// New flow: explicit one-Meal add.
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		expect(project(await getShoppingRows(session.householdId))).toEqual(trusted)
		await prisma.shoppingListItem.deleteMany({})

		// Unified entry point: add Recipe from its page at the same ratio —
		// in-stock lines arrive pre-checked instead of silently dropped (#76).
		await recipeAction({
			request: await makeRequest(session, `/recipes/${recipe.id}`, {
				intent: 'add-to-shopping-list',
				servingRatio: '2',
			}),
			params: { recipeId: recipe.id },
			context: new RouterContextProvider(),
			pattern: '/recipes/:recipeId',
			url: new URL(`${BASE_URL}/recipes/${recipe.id}`),
		})
		expect(project(await getShoppingRows(session.householdId))).toEqual(trusted)
	})

	test('a text-only Meal has no Shopping behavior', async () => {
		const session = await setupUser()
		const weekStart = getCurrentWeekStart()
		const mealPlan = await prisma.mealPlan.create({
			data: { householdId: session.householdId, weekStart },
		})
		const meal = await prisma.meal.create({
			data: {
				mealPlanId: mealPlan.id,
				date: weekStart,
				order: 0,
				genericText: 'Leftovers',
			},
		})

		await expect(
			runPlanAction(session, { intent: 'addMealToShopping', mealId: meal.id }),
		).rejects.toEqual(expect.objectContaining({ status: 400 }))
		expect(await getShoppingRows(session.householdId)).toHaveLength(0)
		expect(await prisma.mealShoppingContribution.count()).toBe(0)
	})

	test('a missing planned Recipe fabricates no fresh demand', async () => {
		const session = await setupUser()
		const weekStart = getCurrentWeekStart()
		const mealPlan = await prisma.mealPlan.create({
			data: { householdId: session.householdId, weekStart },
		})
		const meal = await prisma.meal.create({
			data: {
				mealPlanId: mealPlan.id,
				date: weekStart,
				order: 0,
				recipeItems: {
					create: {
						order: 0,
						recipeId: null,
						recipeTitle: 'Retired Recipe',
						scaleMultiplier: 1,
					},
				},
			},
		})

		const result = (await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})) as { status: string; shopping: { createdRowCount: number } }
		expect(result.status).toBe('success')
		expect(result.shopping.createdRowCount).toBe(0)
		expect(await getShoppingRows(session.householdId)).toHaveLength(0)
	})

	test('deleting the referenced Recipe keeps the existing contribution and produces nothing new', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)

		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		const before = await getContributions(session.householdId)
		expect(before).toHaveLength(2)

		await prisma.recipe.delete({ where: { id: recipe.id } })

		// Existing contribution and rows stay — deletion must not rewrite a
		// list that may be in use (#98 story 51).
		expect(await getContributions(session.householdId)).toEqual(before)
		expect(await getShoppingRows(session.householdId)).toHaveLength(2)

		// The card is now missing (recipeId null): re-adding contributes nothing.
		const result = (await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})) as { status: string; shopping: { createdRowCount: number } }
		expect(result.shopping.createdRowCount).toBe(0)
		expect(await getContributions(session.householdId)).toEqual(before)
	})

	test('re-adding the same Meal is idempotent — no duplicate rows, no history', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)

		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		const result = (await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})) as {
			status: string
			shopping: { createdRowCount: number; alreadyContributedCount: number }
		}

		expect(result.shopping.createdRowCount).toBe(0)
		expect(result.shopping.alreadyContributedCount).toBe(2)
		expect(await getShoppingRows(session.householdId)).toHaveLength(2)
		expect(await getContributions(session.householdId)).toHaveLength(2)
	})

	test('demand matching an existing manual row attaches provenance without duplicating or rewriting it', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)

		await runShoppingAction(session, {
			intent: 'add',
			name: 'ground lamb',
			quantity: '250',
			unit: 'g',
		})
		const manualRow = (await getShoppingRows(session.householdId))[0]!
		expect(manualRow.source).toBe('manual')

		const result = (await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})) as {
			status: string
			shopping: { createdRowCount: number; attachedCount: number }
		}
		expect(result.shopping.createdRowCount).toBe(1) // chicken stock only
		expect(result.shopping.attachedCount).toBe(1) // lamb → manual row

		// The manual row is untouched — durable manual rows are never rewritten.
		const lambRows = (await getShoppingRows(session.householdId)).filter(
			(row) => row.name.includes('lamb'),
		)
		expect(lambRows).toHaveLength(1)
		expect(lambRows[0]).toMatchObject({
			id: manualRow.id,
			quantity: '250',
			unit: 'g',
			source: 'manual',
		})

		// But the Meal's demand identity is recorded separately against it.
		const lambContribution = (await getContributions(session.householdId)).find(
			(c) => c.itemId === manualRow.id,
		)
		expect(lambContribution).toMatchObject({
			mealId: meal.id,
			name: 'ground lamb',
			quantity: '500',
			unit: 'g',
		})
	})

	test('deleting a Meal keeps its Shopping rows and safely orphans the contribution', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)

		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		await runPlanAction(session, { intent: 'removeMeal', mealId: meal.id })

		// Default is keeping Shopping (#98 story 70); the ask-dialog is #110.
		expect(await getShoppingRows(session.householdId)).toHaveLength(2)
		const contributions = await getContributions(session.householdId)
		expect(contributions).toHaveLength(2)
		expect(contributions.every((c) => c.mealId === null)).toBe(true)
	})

	test('choosing removal on Meal deletion drops only its generated component and empty Meal rows', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		await runShoppingAction(session, {
			intent: 'add',
			name: 'ground lamb',
			quantity: '250',
			unit: 'g',
		})
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})

		await runPlanAction(session, {
			intent: 'removeMeal',
			mealId: meal.id,
			removeShoppingContributions: 'true',
		})

		expect(await prisma.meal.findUnique({ where: { id: meal.id } })).toBeNull()
		expect(await getContributions(session.householdId)).toHaveLength(0)
		expect(
			(await getShoppingRows(session.householdId)).map((row) => [
				row.name,
				row.quantity,
				row.source,
			]),
		).toEqual([['ground lamb', '250', 'manual']])
	})

	test('deleting a generated row removes its current contribution', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)

		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		const row = (await getShoppingRows(session.householdId))[0]!

		await runShoppingAction(session, { intent: 'delete', itemId: row.id })

		expect(
			await prisma.mealShoppingContribution.count({
				where: { itemId: row.id },
			}),
		).toBe(0)
		// The other contribution is untouched.
		expect(await getContributions(session.householdId)).toHaveLength(1)
	})

	test('week-wide regenerate preserves Meal-contributed rows and provenance', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)

		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		const before = await getShoppingRows(session.householdId)

		await runShoppingAction(session, { intent: 'generate' })

		// Canonical dedup keeps the contributed rows as the displayed rows —
		// no duplicates, and the contributions survive regeneration.
		const after = await getShoppingRows(session.householdId)
		expect(after.map((row) => [row.id, row.name])).toEqual(
			before.map((row) => [row.id, row.name]),
		)
		expect(await getContributions(session.householdId)).toHaveLength(2)
	})

	test('a fallback-identity ingredient still matches its existing row on re-add', async () => {
		const session = await setupUser()
		// 'medium/small peaches' defeats canonicalization — its demand identity
		// falls back to the display name and must keep matching the stored row.
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Peach Galette',
				userId: session.userId,
				householdId: session.householdId,
				ingredients: {
					create: [{ name: 'medium/small peaches', amount: '3', order: 0 }],
				},
			},
		})
		const meal = await setupMeal(session.householdId, recipe)

		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		const result = (await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})) as {
			status: string
			shopping: { createdRowCount: number; alreadyContributedCount: number }
		}

		expect(result.shopping.createdRowCount).toBe(0)
		expect(result.shopping.alreadyContributedCount).toBe(1)
		expect(await getShoppingRows(session.householdId)).toHaveLength(1)

		// Week-wide regenerate must not duplicate it either.
		await runShoppingAction(session, { intent: 'generate' })
		expect(await getShoppingRows(session.householdId)).toHaveLength(1)
	})

	test('a Meal in another household is not reachable', async () => {
		const owner = await setupUser()
		const stranger = await setupUser()
		const recipe = await setupRecipe(owner.userId, owner.householdId)
		const meal = await setupMeal(owner.householdId, recipe)

		await expect(
			runPlanAction(stranger, {
				intent: 'addMealToShopping',
				mealId: meal.id,
			}),
		).rejects.toEqual(expect.objectContaining({ status: 404 }))
		expect(await getShoppingRows(owner.householdId)).toHaveLength(0)
	})
})

/** Attach one snapshot note card with ordinary Shopping lines to a Meal. */
async function addNoteLines(
	mealId: string,
	lines: Array<{ name: string; quantity?: string; unit?: string }>,
) {
	return prisma.mealNoteItem.create({
		data: {
			mealId,
			order: 99,
			text: 'To buy',
			shoppingLines: {
				create: lines.map((line, index) => ({ ...line, order: index })),
			},
		},
	})
}

async function runShoppingLoader(session: { id: string }) {
	const cookie = await getSessionCookieHeader(session)
	return shoppingLoader({
		request: new Request(`${BASE_URL}/shopping`, { headers: { cookie } }),
		...SHOPPING_ARGS,
	})
}

describe('addMealToShopping — multi-Recipe and note-line aggregation (#109)', () => {
	test('note-card Shopping lines contribute on explicit add', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		await addNoteLines(meal.id, [
			{ name: 'pita bread', quantity: '12' },
			{ name: 'candles' },
		])

		const result = (await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})) as { status: string; shopping: { createdRowCount: number } }
		expect(result.status).toBe('success')
		expect(result.shopping.createdRowCount).toBe(4)

		const rows = await getShoppingRows(session.householdId)
		expect(rows.map((row) => [row.name, row.quantity])).toEqual([
			['candles', null],
			['chicken stock', '2'],
			['ground lamb', '500'],
			['pita bread', '12'],
		])
		// Note lines need no canonical ingredient identity — the fallback
		// identity still gets a durable contribution.
		const contributions = await getContributions(session.householdId)
		expect(contributions).toHaveLength(4)
		expect(contributions.every((c) => c.mealId === meal.id)).toBe(true)
	})

	test('a note-only snapshot Meal is a valid contributor', async () => {
		const session = await setupUser()
		const weekStart = getCurrentWeekStart()
		const mealPlan = await prisma.mealPlan.create({
			data: { householdId: session.householdId, weekStart },
		})
		const meal = await prisma.meal.create({
			data: { mealPlanId: mealPlan.id, date: weekStart, order: 0 },
		})
		await addNoteLines(meal.id, [{ name: 'good bread', quantity: '2' }])

		const result = (await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})) as { status: string; shopping: { createdRowCount: number } }
		expect(result.shopping.createdRowCount).toBe(1)
		expect(
			(await getShoppingRows(session.householdId)).map((row) => row.name),
		).toEqual(['good bread'])
	})

	test('a staple-looking note line is explicit intent and still contributes', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		// The Recipe's own 'salt' ingredient stays stripped; the note line lands.
		await addNoteLines(meal.id, [{ name: 'salt', quantity: '1', unit: 'box' }])

		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		const salt = (await getShoppingRows(session.householdId)).filter(
			(row) => row.name === 'salt',
		)
		expect(salt).toHaveLength(1)
		expect(salt[0]!.quantity).toBe('1')
	})

	test('a note line and Recipe demand for the same ingredient become one row with one honest total', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		await addNoteLines(meal.id, [
			{ name: 'ground lamb', quantity: '250', unit: 'g' },
		])

		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		const lamb = (await getShoppingRows(session.householdId)).filter((row) =>
			row.name.includes('lamb'),
		)
		expect(lamb).toHaveLength(1)
		expect(lamb[0]!.quantity).toBe('750')
		expect(lamb[0]!.unit).toBe('g')
		// One demand identity → one contribution carrying the combined value.
		const contributions = (await getContributions(session.householdId)).filter(
			(c) => c.itemId === lamb[0]!.id,
		)
		expect(contributions).toHaveLength(1)
		expect(contributions[0]!.quantity).toBe('750')
	})

	test('re-adding a Meal with note lines stays idempotent', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		await addNoteLines(meal.id, [{ name: 'pita bread', quantity: '12' }])

		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		const result = (await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})) as {
			status: string
			shopping: { createdRowCount: number; alreadyContributedCount: number }
		}
		expect(result.shopping.createdRowCount).toBe(0)
		expect(result.shopping.alreadyContributedCount).toBe(3)
		expect(await getShoppingRows(session.householdId)).toHaveLength(3)
	})
})

describe('Shopping display grouping — combined totals without rewriting identities (#109)', () => {
	async function getDisplayedItems(session: {
		id: string
		householdId: string
	}) {
		const { shoppingList } = await runShoppingLoader(session)
		return shoppingList.items
	}

	test('a compatible manual row and Meal demand display one combined total; both identities survive', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		await runShoppingAction(session, {
			intent: 'add',
			name: 'ground lamb',
			quantity: '250',
			unit: 'g',
		})

		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})

		const lamb = (await getDisplayedItems(session)).find((item) =>
			item.name.includes('lamb'),
		)!
		// Displayed: 250 g manual + 500 g Meal demand, grouped for display only.
		expect(lamb.display).toEqual({
			quantity: '750',
			unit: 'g',
			combined: true,
		})
		// Stored identities are untouched: the manual row still says 250 g and
		// the contribution still records 500 g.
		expect(lamb.quantity).toBe('250')
		expect(lamb.unit).toBe('g')
		const contribution = await prisma.mealShoppingContribution.findFirst({
			where: { itemId: lamb.id },
		})
		expect(contribution).toMatchObject({ quantity: '500', unit: 'g' })
	})

	test('incompatible manual and generated demand stays visibly separate', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		await runShoppingAction(session, {
			intent: 'add',
			name: 'ground lamb',
			quantity: '1',
			unit: 'pack',
		})

		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})

		const lamb = (await getDisplayedItems(session)).find((item) =>
			item.name.includes('lamb'),
		)!
		expect(lamb.display).toEqual({
			quantity: '1 pack + 500 g',
			unit: null,
			combined: true,
		})
		expect(lamb.quantity).toBe('1')
		expect(lamb.unit).toBe('pack')
	})

	test('two Meals feeding one generated row display their summed demand', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const mealA = await setupMeal(session.householdId, recipe)
		const mealB = await setupMeal(session.householdId, recipe, {
			scaleMultiplier: 2,
		})

		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: mealA.id,
		})
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: mealB.id,
		})

		const lamb = (await getDisplayedItems(session)).find((item) =>
			item.name.includes('lamb'),
		)!
		// 500 g + 1000 g across the two Meals — the row's stored quantity (the
		// first Meal's 500 g) is not double-counted.
		expect(lamb.source).toBe('meal')
		expect(lamb.quantity).toBe('500')
		expect(lamb.display).toEqual({
			quantity: '1.5',
			unit: 'kg',
			combined: true,
		})
	})

	test('a row without contributions displays exactly its stored values', async () => {
		const session = await setupUser()
		await runShoppingAction(session, {
			intent: 'add',
			name: 'dish soap',
			quantity: '1',
		})
		const soap = (await getDisplayedItems(session)).find(
			(item) => item.name === 'dish soap',
		)!
		expect(soap.display).toEqual({ quantity: '1', unit: null, combined: false })
	})
})
