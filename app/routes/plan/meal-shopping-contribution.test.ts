import { RouterContextProvider } from 'react-router'
import { describe, expect, test, vi } from 'vitest'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { getWeekStart } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createSignedInHousehold } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { action as shoppingCheckAction } from '../resources/shopping-check.tsx'
import { loader as planPickerLoader } from '../resources/shopping-plan.tsx'
import { action as undoDeleteAction } from '../resources/undo-delete.tsx'
import {
	action as shoppingAction,
	loader as shoppingLoader,
} from '../shopping.tsx'
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

async function setupUser() {
	const user = await createSignedInHousehold({ tier: 'pro' })
	// The availability seam knows only what the household saved, so the
	// fixture's salt is a Staple.
	await prisma.householdIngredient.create({
		data: {
			householdId: user.householdId,
			displayName: 'salt',
			canonicalKey: 'salt',
			isStaple: true,
		},
	})
	return user
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

// Deletes go through the Undo route, as JSON, the way the pages send them.
async function runUndoDelete(
	session: { id: string },
	body: Record<string, unknown>,
) {
	const response = await undoDeleteAction({
		request: new Request(`${BASE_URL}/resources/undo-delete`, {
			method: 'POST',
			headers: {
				cookie: await getSessionCookieHeader(session),
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		}),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/resources/undo-delete',
		url: new URL(`${BASE_URL}/resources/undo-delete`),
	})
	return (await response.json()) as { status: string }
}

// Checks go through the resource route the Shopping page posts to.
async function runShoppingCheck(
	session: { id: string },
	formFields: Record<string, string>,
) {
	const response = await shoppingCheckAction({
		request: await makeRequest(
			session,
			'/resources/shopping-check',
			formFields,
		),
		params: {},
		context: new RouterContextProvider(),
		pattern: '/resources/shopping-check',
		url: new URL(`${BASE_URL}/resources/shopping-check`),
	})
	return response.json()
}

async function runPlanPickerLoader(session: { id: string }) {
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
 * matching Staples.
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
	const weekStart = getWeekStart(new Date())
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

describe('Meal addedToShopping', () => {
	test('reports whether the Meal has contributions, whatever changed since the add', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		expect((await runPlanLoader(session)).meals[0]!.addedToShopping).toBe(false)

		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		expect((await runPlanLoader(session)).meals[0]!.addedToShopping).toBe(true)

		const item = await prisma.mealRecipeItem.findFirstOrThrow({
			where: { mealId: meal.id },
		})
		await runPlanAction(session, {
			intent: 'setItemMultiplier',
			itemId: item.id,
			multiplier: '2',
		})
		expect((await runPlanLoader(session)).meals[0]!.addedToShopping).toBe(true)
	})

	test('stays false when every demand line is a Staple', async () => {
		const session = await setupUser()
		const salty = await prisma.recipe.create({
			data: {
				title: 'Salt crust',
				userId: session.userId,
				householdId: session.householdId,
				ingredients: { create: [{ name: 'salt', order: 0 }] },
			},
		})
		const meal = await setupMeal(session.householdId, salty)
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		expect((await runPlanLoader(session)).meals[0]!.addedToShopping).toBe(false)
	})
})

describe('refreshMealShopping: one-Meal replacement', () => {
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
	})

	test('picks up an added Recipe and note line', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		await runPlanAction(session, {
			intent: 'addMealToShopping',
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
		await addNoteLines(meal.id, [{ name: 'lemons', quantity: '6' }])
		await runPlanAction(session, {
			intent: 'refreshMealShopping',
			mealId: meal.id,
		})

		const rows = await getShoppingRows(session.householdId)
		expect(rows.map((row) => row.name)).toEqual([
			'chicken stock',
			'flour',
			'ground lamb',
			'lemons',
		])
		expect(rows.find((row) => row.name === 'flour')).toMatchObject({
			quantity: '500',
			unit: 'g',
		})
		expect(rows.find((row) => row.name === 'lemons')).toMatchObject({
			quantity: '6',
		})
	})

	test("drops a deleted Recipe's lines and keeps the rest of the Meal", async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		await addNoteLines(meal.id, [{ name: 'lemons', quantity: '6' }])
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})

		await prisma.recipe.delete({ where: { id: recipe.id } })
		// Deleting the Recipe alone leaves Shopping as it was.
		expect(
			(await getShoppingRows(session.householdId)).map((row) => row.name),
		).toEqual(['chicken stock', 'ground lamb', 'lemons'])

		await expect(
			runPlanAction(session, {
				intent: 'refreshMealShopping',
				mealId: meal.id,
			}),
		).resolves.toMatchObject({ status: 'success' })
		expect(
			(await getShoppingRows(session.householdId)).map((row) => row.name),
		).toEqual(['lemons'])
		expect(
			(await getContributions(session.householdId)).map(
				(row) => row.canonicalName,
			),
		).toEqual(['lemon'])
		expect((await runPlanLoader(session)).meals[0]!.addedToShopping).toBe(true)
	})
	test('with no demand left, clears the Meal from Shopping', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		await prisma.mealNoteItem.create({
			data: { mealId: meal.id, order: 1, text: 'Light the grill early' },
		})
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})

		const item = await prisma.mealRecipeItem.findFirstOrThrow({
			where: { mealId: meal.id },
		})
		expect(
			await runUndoDelete(session, {
				intent: 'delete-meal-item',
				itemId: item.id,
			}),
		).toMatchObject({ status: 'deleted' })
		// Still on Shopping, so the card keeps offering an update.
		expect((await runPlanLoader(session)).meals[0]!.addedToShopping).toBe(true)

		await expect(
			runPlanAction(session, {
				intent: 'refreshMealShopping',
				mealId: meal.id,
			}),
		).resolves.toMatchObject({ status: 'success' })
		expect(await getContributions(session.householdId)).toEqual([])
		expect(await getShoppingRows(session.householdId)).toEqual([])
		expect((await runPlanLoader(session)).meals[0]!.addedToShopping).toBe(false)
	})
})

describe('Shopping generated-group conversion', () => {
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
			observedVersion: String(lamb.checkVersion),
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
			observedVersion: String(lamb.checkVersion),
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

		const edited = await prisma.shoppingListItem.findUniqueOrThrow({
			where: { id: lamb.id },
		})
		await runShoppingAction(session, {
			intent: 'removeGeneratedAmount',
			itemId: lamb.id,
			observedVersion: String(edited.checkVersion),
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

describe('Shopping row Edit and Remove generated amount answer a changed row', () => {
	// The route's side of the version check, meaning the status codes the
	// Shopping page acts on. The write rules themselves are covered next to
	// shopping-contribution.server.ts.
	async function setupMixedRow() {
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
		return { session, recipe, lamb }
	}
	const status = (result: unknown) =>
		(result as { init?: { status?: number } }).init?.status

	test('a stale version answers 409 with the row as it is now and saves nothing', async () => {
		const { session, recipe, lamb } = await setupMixedRow()
		const otherMeal = await setupMeal(session.householdId, recipe, {
			scaleMultiplier: 2,
		})
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: otherMeal.id,
		})
		const now = await prisma.shoppingListItem.findUniqueOrThrow({
			where: { id: lamb.id },
		})

		const edit = await runShoppingAction(session, {
			intent: 'edit',
			itemId: lamb.id,
			observedVersion: String(lamb.checkVersion),
			name: 'ground lamb',
			quantity: '300',
			unit: 'g',
		})
		expect(status(edit)).toBe(409)
		expect((edit as { data: unknown }).data).toEqual({
			status: 'conflict',
			item: {
				checkVersion: now.checkVersion,
				checked: false,
				display: { quantity: '1.75', unit: 'kg', combined: true },
				mealShare: { quantity: '1.5', unit: 'kg' },
			},
		})

		const remove = await runShoppingAction(session, {
			intent: 'removeGeneratedAmount',
			itemId: lamb.id,
			observedVersion: String(lamb.checkVersion),
		})
		expect(status(remove)).toBe(409)
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: lamb.id },
			}),
		).toEqual(now)
		expect(
			await prisma.mealShoppingContribution.count({
				where: { itemId: lamb.id },
			}),
		).toBe(2)
	})

	test('a page that sends no version is asked to reload', async () => {
		const { session, lamb } = await setupMixedRow()
		const edit = await runShoppingAction(session, {
			intent: 'edit',
			itemId: lamb.id,
			name: 'ground lamb',
			quantity: '300',
			unit: 'g',
		})
		expect(status(edit)).toBe(400)
		const remove = await runShoppingAction(session, {
			intent: 'removeGeneratedAmount',
			itemId: lamb.id,
		})
		expect(status(remove)).toBe(400)
		expect(
			await prisma.mealShoppingContribution.count({
				where: { itemId: lamb.id },
			}),
		).toBe(1)
	})

	test("another Household's row is not found", async () => {
		const { lamb } = await setupMixedRow()
		const stranger = await setupUser()
		await expect(
			runShoppingAction(stranger, {
				intent: 'edit',
				itemId: lamb.id,
				observedVersion: String(lamb.checkVersion),
				name: 'ground lamb',
				quantity: '300',
				unit: 'g',
			}),
		).rejects.toMatchObject({ status: 404 })
		await expect(
			runShoppingAction(stranger, {
				intent: 'removeGeneratedAmount',
				itemId: lamb.id,
				observedVersion: String(lamb.checkVersion),
			}),
		).rejects.toMatchObject({ status: 404 })
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: lamb.id },
			}),
		).toEqual(lamb)
	})
})

describe('addMealToShopping: one-Meal demand and provenance', () => {
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

		const weekStart = getWeekStart(new Date())
		const result = (await runPlanAction(session, {
			intent: 'addMeal',
			date: weekStart.toISOString().slice(0, 10),
			recipeId: recipe.id,
		})) as { status: string }
		expect(result.status).toBe('success')

		expect(await getShoppingRows(session.householdId)).toHaveLength(0)
		expect(await prisma.mealShoppingContribution.count()).toBe(0)
	})

	test('one-Meal demand is equivalent at every entry point that adds it', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe, {
			scaleMultiplier: 2,
		})
		// One Staple, so the availability seam's omission is compared too.
		await prisma.householdIngredient.create({
			data: {
				displayName: 'chicken stock',
				canonicalKey: 'chicken stock',
				isStaple: true,
				householdId: session.householdId,
			},
		})

		// Rows are what the household sees; contributions are where each line
		// came from, which Meal deletion and refresh depend on.
		const project = async () => ({
			rows: (await getShoppingRows(session.householdId)).map((row) => [
				row.name,
				row.quantity,
				row.unit,
				row.category,
				row.checked,
			]),
			contributions: (await getContributions(session.householdId)).map((c) => [
				c.mealId,
				c.canonicalName,
				c.quantity,
				c.unit,
			]),
		})

		// Reference flow: the explicit one-Meal add from Plan.
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		const trusted = await project()
		expect(trusted.rows.length).toBeGreaterThan(0)
		expect(trusted.contributions).toHaveLength(trusted.rows.length)
		await prisma.shoppingListItem.deleteMany({})
		await prisma.mealShoppingContribution.deleteMany({})

		// From Plan's picker at its default ticks reconciles the same demand
		// through the same path.
		const choices = await runPlanPickerLoader(session)
		await runShoppingAction(session, {
			intent: 'add-from-plan',
			picks: JSON.stringify([
				{
					mealId: meal.id,
					lines: choices.data.days[0]!.meals[0]!.lines.filter(
						(line) => line.status === 'needed',
					).map((line) => line.canonicalName),
				},
			]),
		})
		expect(await project()).toEqual(trusted)
	})

	test('a text-only Meal has no Shopping behavior', async () => {
		const session = await setupUser()
		const weekStart = getWeekStart(new Date())
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
		const weekStart = getWeekStart(new Date())
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

		// Existing contribution and rows stay. Deleting a Recipe must not rewrite a
		// list that may be in use.
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
		expect(
			await runUndoDelete(session, {
				intent: 'delete-meal',
				mealId: meal.id,
				removeShoppingContributions: false,
			}),
		).toMatchObject({ status: 'deleted' })

		// Keeping Shopping is the default.
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

		expect(
			await runUndoDelete(session, {
				intent: 'delete-meal',
				mealId: meal.id,
				removeShoppingContributions: true,
			}),
		).toMatchObject({ status: 'deleted' })

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

		expect(
			await runUndoDelete(session, {
				intent: 'delete-shopping',
				itemIds: [row.id],
			}),
		).toMatchObject({ status: 'deleted' })

		expect(
			await prisma.mealShoppingContribution.count({
				where: { itemId: row.id },
			}),
		).toBe(0)
		// The other contribution is untouched.
		expect(await getContributions(session.householdId)).toHaveLength(1)
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

		// From Plan finds it under the same identity and shows it as on the
		// list, with no box to tick.
		const choices = await runPlanPickerLoader(session)
		const line = choices.data.days[0]!.meals[0]!.lines[0]!
		expect(line.status).toBe('added')

		// A request that names it anyway changes nothing.
		const rowsBefore = await getShoppingRows(session.householdId)
		const contributionsBefore = await getContributions(session.householdId)
		const repick = await runShoppingAction(session, {
			intent: 'add-from-plan',
			picks: JSON.stringify([{ mealId: meal.id, lines: [line.canonicalName] }]),
		})
		expect(repick).toMatchObject({
			status: 'success',
			createdRowCount: 0,
			attachedCount: 0,
			alreadyContributedCount: 1,
		})
		expect(await getShoppingRows(session.householdId)).toEqual(rowsBefore)
		expect(await getContributions(session.householdId)).toEqual(
			contributionsBefore,
		)
	})

	test('picking a line the Meal already has on a Later row moves that row to Next shop', async () => {
		const session = await setupUser()
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Lemon tart',
				userId: session.userId,
				householdId: session.householdId,
				ingredients: { create: [{ name: 'lemons', amount: '3', order: 0 }] },
			},
		})
		const meal = await setupMeal(session.householdId, recipe)
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		await prisma.shoppingListItem.updateMany({
			where: { list: { householdId: session.householdId } },
			data: { horizon: 'later' },
		})

		const choices = await runPlanPickerLoader(session)
		const line = choices.data.days[0]!.meals[0]!.lines[0]!
		expect(line.status).toBe('later')
		const moved = await runShoppingAction(session, {
			intent: 'add-from-plan',
			picks: JSON.stringify([{ mealId: meal.id, lines: [line.canonicalName] }]),
		})

		expect(moved).toMatchObject({
			status: 'success',
			createdRowCount: 0,
			attachedCount: 0,
			promotedRowCount: 1,
		})
		const rows = await getShoppingRows(session.householdId)
		expect(rows.map((row) => [row.name, row.quantity, row.horizon])).toEqual([
			['lemons', '3', 'next'],
		])
		expect(await getContributions(session.householdId)).toHaveLength(1)
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

describe('addMealToShopping: multi-Recipe and note-line aggregation', () => {
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
		const weekStart = getWeekStart(new Date())
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

	test('a note line is judged by the household Staples, not the heuristic', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		// 'olive oil' is one of the plain basics the ingredient heuristic knows,
		// but this household never saved it, so nothing removes it. 'salt' is a
		// saved Staple, and a Staple is omitted wherever the demand came from.
		await addNoteLines(meal.id, [
			{ name: 'olive oil', quantity: '1', unit: 'bottle' },
			{ name: 'salt', quantity: '1', unit: 'box' },
		])

		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		const rows = await getShoppingRows(session.householdId)
		expect(rows.filter((row) => row.name === 'olive oil')).toMatchObject([
			{ quantity: '1', unit: 'bottle' },
		])
		expect(rows.filter((row) => row.name === 'salt')).toHaveLength(0)
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

describe('Shopping display grouping: combined totals without rewriting identities', () => {
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

	test('new Meals leave checked purchases separate and stale checks cannot swallow added demand', async () => {
		const session = await setupUser()
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Rice supper',
				userId: session.userId,
				householdId: session.householdId,
				ingredients: {
					create: { name: 'rice', amount: '400', unit: 'g', order: 0 },
				},
			},
		})
		const mealA = await setupMeal(session.householdId, recipe, {
			scaleMultiplier: 0.5,
		})
		const mealB = await setupMeal(session.householdId, recipe)
		const mealC = await setupMeal(session.householdId, recipe, {
			scaleMultiplier: 0.5,
		})
		const add = (mealId: string) =>
			runPlanAction(session, { intent: 'addMealToShopping', mealId })
		const check = (
			item: { id: string; checkVersion: number },
			checked: boolean,
		) =>
			runShoppingCheck(session, {
				itemId: item.id,
				checked: String(checked),
				observedVersion: String(item.checkVersion),
				mutationId: `check-${item.id}-${item.checkVersion}`,
			})
		await add(mealA.id)
		const [first] = await getDisplayedItems(session)
		expect(await check(first!, true)).toMatchObject({ status: 'success' })
		const [purchased] = await getDisplayedItems(session)
		const originalContribution = await getContributions(session.householdId)

		await add(mealB.id)
		let items = await getDisplayedItems(session)
		expect(items).toHaveLength(2)
		expect(items.find((item) => item.id === purchased!.id)).toEqual(purchased)
		const outstanding = items.find((item) => item.id !== purchased!.id)!
		expect(outstanding).toMatchObject({
			checked: false,
			display: { quantity: '400', unit: 'g' },
		})
		expect(await getContributions(session.householdId)).toEqual(
			expect.arrayContaining(originalContribution),
		)

		// Repeating either represented Meal does not create another purchase.
		await add(mealA.id)
		await add(mealB.id)
		expect(await getDisplayedItems(session)).toEqual(items)

		// Only the outstanding portion absorbs another new Meal.
		await add(mealC.id)
		expect(await check(outstanding, true)).toMatchObject({ status: 'conflict' })
		items = await getDisplayedItems(session)
		expect(items.find((item) => item.id === purchased!.id)).toEqual(purchased)
		const combined = items.find((item) => item.id === outstanding.id)!
		expect(combined).toMatchObject({
			checked: false,
			display: { quantity: '600', unit: 'g' },
		})
		expect(await check(combined, true)).toMatchObject({ status: 'success' })
		const checkedCombined = (await getDisplayedItems(session)).find(
			(item) => item.id === combined.id,
		)!
		expect(await check(checkedCombined, false)).toMatchObject({
			status: 'success',
		})
		// Clear checked sends the rows it shows as checked.
		expect(
			await runUndoDelete(session, {
				intent: 'delete-shopping',
				itemIds: (await getDisplayedItems(session))
					.filter((item) => item.checked)
					.map((item) => item.id),
				checkedOnly: true,
			}),
		).toMatchObject({ status: 'deleted' })
		const remaining = await getDisplayedItems(session)
		expect(remaining).toHaveLength(1)
		expect(remaining[0]).toMatchObject({
			id: combined.id,
			checked: false,
			display: { quantity: '600', unit: 'g' },
		})
		expect(
			(await getContributions(session.householdId)).map((c) => c.mealId).sort(),
		).toEqual([mealB.id, mealC.id].sort())
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

describe('Meal Shopping contributions across horizons', () => {
	test('generated demand promotes an unchecked Later row in place and refresh promotes it again after a manual move', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		await runShoppingAction(session, {
			intent: 'add',
			name: 'ground lamb',
			quantity: '250',
			unit: 'g',
			horizon: 'later',
		})
		const manualRow = (await getShoppingRows(session.householdId)).find(
			(row) => row.name === 'ground lamb',
		)!

		const added = (await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})) as { shopping: { promotedRowCount: number } }
		expect(added.shopping.promotedRowCount).toBe(1)
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: manualRow.id },
				select: { horizon: true, quantity: true, source: true },
			}),
		).toEqual({ horizon: 'next', quantity: '250', source: 'manual' })
		const contribution = await prisma.mealShoppingContribution.findFirstOrThrow(
			{
				where: { mealId: meal.id, itemId: manualRow.id },
			},
		)

		await runShoppingAction(session, {
			intent: 'move',
			itemId: manualRow.id,
			horizon: 'later',
		})
		const refreshed = (await runPlanAction(session, {
			intent: 'refreshMealShopping',
			mealId: meal.id,
		})) as { shopping: { promotedRowCount: number } }
		expect(refreshed.shopping.promotedRowCount).toBe(1)

		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: manualRow.id },
				select: { horizon: true, quantity: true },
			}),
		).toEqual({ horizon: 'next', quantity: '250' })
		expect(
			await prisma.mealShoppingContribution.findUniqueOrThrow({
				where: { id: contribution.id },
				select: { itemId: true, mealId: true },
			}),
		).toEqual({ itemId: manualRow.id, mealId: meal.id })
	})

	test('refresh and contribution removal leave a checked Later row in its chosen horizon', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const meal = await setupMeal(session.householdId, recipe)
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		const lamb = (await getShoppingRows(session.householdId)).find((row) =>
			row.name.includes('lamb'),
		)!
		await runShoppingCheck(session, {
			itemId: lamb.id,
			checked: 'true',
			observedVersion: String(lamb.checkVersion),
			mutationId: 'check-lamb',
		})
		await runShoppingAction(session, {
			intent: 'move',
			itemId: lamb.id,
			horizon: 'later',
		})

		await runPlanAction(session, {
			intent: 'refreshMealShopping',
			mealId: meal.id,
		})
		expect(
			await prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: lamb.id },
				select: { horizon: true, checked: true },
			}),
		).toEqual({ horizon: 'later', checked: true })

		expect(
			await runUndoDelete(session, {
				intent: 'delete-meal',
				mealId: meal.id,
				removeShoppingContributions: true,
			}),
		).toMatchObject({ status: 'deleted' })
		expect(
			await prisma.shoppingListItem.findUnique({ where: { id: lamb.id } }),
		).toBeNull()
		expect(
			await prisma.mealShoppingContribution.count({
				where: { itemId: lamb.id },
			}),
		).toBe(0)
	})
})

describe('cooked Recipe items never add Shopping amounts', () => {
	async function setupTwoRecipeMeal(session: {
		userId: string
		householdId: string
	}) {
		const create = (title: string, ingredients: Array<[string, string]>) =>
			prisma.recipe.create({
				data: {
					title,
					userId: session.userId,
					householdId: session.householdId,
					ingredients: {
						create: ingredients.map(([name, amount], order) => ({
							name,
							amount,
							order,
						})),
					},
				},
			})
		const curry = await create('Curry', [
			['onion', '2'],
			['coconut milk', '1'],
		])
		const salad = await create('Salad', [
			['onion', '1'],
			['cucumber', '1'],
		])
		const weekStart = getWeekStart(new Date())
		const mealPlan = await prisma.mealPlan.create({
			data: { householdId: session.householdId, weekStart },
		})
		const meal = await prisma.meal.create({
			data: {
				mealPlanId: mealPlan.id,
				date: weekStart,
				order: 0,
				recipeItems: {
					create: [
						{ order: 0, recipeId: curry.id, recipeTitle: curry.title },
						{ order: 1, recipeId: salad.id, recipeTitle: salad.title },
					],
				},
			},
			include: { recipeItems: { orderBy: { order: 'asc' } } },
		})
		const [curryItem, saladItem] = meal.recipeItems
		return { meal, curryItem: curryItem!, saladItem: saladItem! }
	}
	const amounts = async (householdId: string) =>
		Object.fromEntries(
			(await getContributions(householdId)).map((c) => [
				c.canonicalName,
				c.quantity,
			]),
		)

	test('Add to Shopping leaves out a cooked item', async () => {
		const session = await setupUser()
		const { meal, curryItem } = await setupTwoRecipeMeal(session)
		await prisma.mealRecipeItem.update({
			where: { id: curryItem.id },
			data: { cooked: true },
		})

		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})

		// Only the salad's onion, since the curry has been made.
		expect(await amounts(session.householdId)).toEqual({
			cucumber: '1',
			onion: '1',
		})
	})

	test('Update Shopping keeps what a cooked item already put on Shopping, checked or not', async () => {
		const session = await setupUser()
		const { meal, curryItem } = await setupTwoRecipeMeal(session)
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		const coconut = (await getShoppingRows(session.householdId)).find(
			(row) => row.name === 'coconut milk',
		)!
		await prisma.shoppingListItem.update({
			where: { id: coconut.id },
			data: { checked: true },
		})
		const rowsBefore = await getShoppingRows(session.householdId)
		const before = await getContributions(session.householdId)

		await prisma.mealRecipeItem.update({
			where: { id: curryItem.id },
			data: { cooked: true, scaleMultiplier: 2 },
		})
		await runPlanAction(session, {
			intent: 'refreshMealShopping',
			mealId: meal.id,
		})

		expect(await getContributions(session.householdId)).toEqual(before)
		expect(await getShoppingRows(session.householdId)).toEqual(rowsBefore)
	})

	test('Update Shopping adds nothing for a cooked item that was never added', async () => {
		const session = await setupUser()
		const { meal, curryItem } = await setupTwoRecipeMeal(session)
		await prisma.mealRecipeItem.update({
			where: { id: curryItem.id },
			data: { cooked: true },
		})
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})

		await runPlanAction(session, {
			intent: 'refreshMealShopping',
			mealId: meal.id,
		})

		expect(await amounts(session.householdId)).toEqual({
			cucumber: '1',
			onion: '1',
		})
	})

	test('an ingredient shared with a cooked item keeps its amount, and only the uncooked share is new', async () => {
		const session = await setupUser()
		const { meal, curryItem, saladItem } = await setupTwoRecipeMeal(session)
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		expect(await amounts(session.householdId)).toMatchObject({ onion: '3' })

		// The curry is made; the salad doubles. Onion stays at what is there,
		// and the salad's own cucumber follows the new scale.
		await prisma.mealRecipeItem.update({
			where: { id: curryItem.id },
			data: { cooked: true },
		})
		await prisma.mealRecipeItem.update({
			where: { id: saladItem.id },
			data: { scaleMultiplier: 2 },
		})
		await runPlanAction(session, {
			intent: 'refreshMealShopping',
			mealId: meal.id,
		})
		expect(await amounts(session.householdId)).toEqual({
			'coconut milk': '1',
			cucumber: '2',
			onion: '3',
		})

		// With the onion taken off Shopping, Update adds back only the
		// salad's share.
		const onion = (await getShoppingRows(session.householdId)).find(
			(row) => row.name === 'onion',
		)!
		await prisma.shoppingListItem.delete({ where: { id: onion.id } })
		await runPlanAction(session, {
			intent: 'refreshMealShopping',
			mealId: meal.id,
		})
		expect(await amounts(session.householdId)).toMatchObject({ onion: '2' })
	})

	test('a cooked item whose Recipe was deleted never lowers what the Meal put on Shopping', async () => {
		const session = await setupUser()
		const { meal, curryItem, saladItem } = await setupTwoRecipeMeal(session)
		await runPlanAction(session, {
			intent: 'addMealToShopping',
			mealId: meal.id,
		})
		await prisma.mealRecipeItem.update({
			where: { id: curryItem.id },
			data: { cooked: true },
		})
		await prisma.recipe.delete({ where: { id: curryItem.recipeId! } })
		// The salad doubles and the Meal gains a note line.
		await prisma.mealRecipeItem.update({
			where: { id: saladItem.id },
			data: { scaleMultiplier: 2 },
		})
		await addNoteLines(meal.id, [{ name: 'lemons', quantity: '2' }])

		await runPlanAction(session, {
			intent: 'refreshMealShopping',
			mealId: meal.id,
		})

		// Coconut milk isn't withdrawn and onion (now 2 from the salad) isn't
		// lowered from 3. The cucumber's increase and the new lemons apply.
		expect(await amounts(session.householdId)).toEqual({
			'coconut milk': '1',
			cucumber: '2',
			lemon: '2',
			onion: '3',
		})
	})

	describe('Meal → Shopping events name the device that made them', () => {
		// The client id keeps that device from lighting its own Shopping dot.
		test('Add to Shopping and Update Shopping carry the client id', async () => {
			const session = await setupUser()
			const recipe = await setupRecipe(session.userId, session.householdId)
			const meal = await setupMeal(session.householdId, recipe)
			const item = await prisma.mealRecipeItem.findFirstOrThrow({
				where: { mealId: meal.id },
			})
			vi.mocked(emitHouseholdEvent).mockClear()

			await runPlanAction(session, {
				intent: 'addMealToShopping',
				mealId: meal.id,
				originClientId: 'this-phone',
			})
			await runPlanAction(session, {
				intent: 'setItemMultiplier',
				itemId: item.id,
				multiplier: '2',
			})
			await runPlanAction(session, {
				intent: 'refreshMealShopping',
				mealId: meal.id,
				originClientId: 'this-phone',
			})

			const calls = vi
				.mocked(emitHouseholdEvent)
				.mock.calls.map(([event]) => event)
			expect(calls).toHaveLength(2)
			for (const event of calls) {
				expect(event).toMatchObject({
					type: 'shopping_list_generated',
					originClientId: 'this-phone',
				})
			}
		})
	})
})
