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
import { action as shoppingAction } from '../shopping.tsx'
import { action as planAction } from './index.tsx'

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
			servings: 4,
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
