import { RouterContextProvider } from 'react-router'
import { describe, expect, test, vi } from 'vitest'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { action, loader } from './index.tsx'
import { createPlanAction } from './plan-action.server.ts'

const ACTION_ARGS_BASE = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/plan',
	url: new URL(`${BASE_URL}/plan`),
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

async function setupHouseholdMember(householdId: string) {
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
		await tx.householdMember.create({
			data: { householdId, userId: session.userId, role: 'member' },
		})
		return { ...session, householdId }
	})
}

async function setupRecipe(
	userId: string,
	householdId: string,
	title = 'Test Recipe',
) {
	return prisma.recipe.create({
		data: {
			title,
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

async function act(session: { id: string }, fields: Record<string, string>) {
	return action({
		request: await makeRequest(session, fields),
		...ACTION_ARGS_BASE,
	})
}

async function makeLoaderRequest(session: { id: string }, weekStart: string) {
	const cookie = await getSessionCookieHeader(session)
	return new Request(`${BASE_URL}/plan?weekStart=${weekStart}`, {
		headers: { cookie },
	})
}

function findHouseholdMeals(householdId: string) {
	return prisma.meal.findMany({
		where: { mealPlan: { householdId } },
		orderBy: [{ date: 'asc' }, { order: 'asc' }],
		include: { recipeItems: { orderBy: { order: 'asc' } } },
	})
}

describe('meal plan actions', () => {
	test('addMeal fast path creates an ordered Meal with one item', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)

		const result = await act(session, {
			intent: 'addMeal',
			date: '2026-02-02', // Monday
			recipeId: recipe.id,
		})
		expect(result).toEqual({ status: 'success' })

		const meals = await findHouseholdMeals(session.householdId)
		expect(meals).toHaveLength(1)
		const meal = meals[0]!
		expect(meal).toMatchObject({
			label: null,
			order: 0,
			genericText: null,
			completed: false,
		})
		expect(meal.recipeItems).toHaveLength(1)
		expect(meal.recipeItems[0]).toMatchObject({
			recipeId: recipe.id,
			recipeTitle: 'Test Recipe',
			scaleMultiplier: 1,
			cooked: false,
			order: 0,
		})
	})

	test('duplicate addMeal (same day, label, recipe) is idempotent', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		const fields = {
			intent: 'addMeal',
			date: '2026-02-02',
			recipeId: recipe.id,
			label: 'dinner',
		}

		await act(session, fields)
		await act(session, fields)

		expect(await findHouseholdMeals(session.householdId)).toHaveLength(1)
	})

	test('addMeal stores label and multiplier', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)

		await act(session, {
			intent: 'addMeal',
			date: '2026-02-02',
			recipeId: recipe.id,
			label: 'lunch',
			multiplier: '1.5',
		})

		const [meal] = await findHouseholdMeals(session.householdId)
		expect(meal).toMatchObject({ label: 'lunch' })
		expect(meal!.recipeItems[0]!.scaleMultiplier).toBe(1.5)
	})

	test('concurrent household members adding to a fresh week share one plan', async () => {
		const owner = await setupUser()
		const member = await setupHouseholdMember(owner.householdId)
		const [ownerRecipe, memberRecipe] = await Promise.all([
			setupRecipe(owner.userId, owner.householdId, 'Owner Recipe'),
			setupRecipe(member.userId, member.householdId, 'Member Recipe'),
		])

		// Seven in-flight requests through the one shared client — production
		// concurrency (one Node process on the LiteFS writer). The pre-#105
		// version of this test hammered seven separate libsql connections, which
		// single-statement legacy inserts tolerated; Meal creation is a
		// transaction now, and cross-process writers are a scenario the deploy
		// target cannot produce. The ensureMealPlan upsert race this test exists
		// for is unchanged raw SQL and still asserted below (one plan row).
		const requests = await Promise.all(
			Array.from({ length: 7 }, (_, index) => {
				const session = index % 2 === 0 ? owner : member
				return makeRequest(session, {
					intent: 'addMeal',
					date: `2026-02-${String(index + 2).padStart(2, '0')}`,
					recipeId: index % 2 === 0 ? ownerRecipe.id : memberRecipe.id,
				})
			}),
		)
		const results = await Promise.allSettled(
			requests.map((request, index) =>
				createPlanAction(prisma, async () =>
					index % 2 === 0 ? owner : member,
				)({
					request,
					...ACTION_ARGS_BASE,
				}),
			),
		)

		expect(results).toEqual(
			Array.from({ length: 7 }, () => ({
				status: 'fulfilled',
				value: { status: 'success' },
			})),
		)
		const plans = await prisma.mealPlan.findMany({
			where: {
				householdId: owner.householdId,
				weekStart: new Date('2026-02-02T00:00:00.000Z'),
			},
			include: { meals: true },
		})
		expect(plans).toHaveLength(1)
		expect(plans[0]!.meals).toHaveLength(7)
	})

	test('another household cannot see, modify, or plan with foreign data', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		await act(session, {
			intent: 'addMeal',
			date: '2026-02-02',
			recipeId: recipe.id,
		})
		const [meal] = await findHouseholdMeals(session.householdId)
		const item = meal!.recipeItems[0]!

		const outsider = await setupUser()

		// Their Meals do not load for the outsider…
		const loaderResult = await loader({
			request: await makeLoaderRequest(outsider, '2026-02-02'),
			...ACTION_ARGS_BASE,
		})
		expect(loaderResult.meals).toEqual([])

		// …and every submitted id re-resolves through the household: foreign
		// Meals, items, and Recipes all 404 without a write.
		const denied: Array<Record<string, string>> = [
			{ intent: 'addMeal', date: '2026-02-02', recipeId: recipe.id },
			{ intent: 'setMealCooked', mealId: meal!.id, cooked: 'true' },
			{ intent: 'setItemCooked', itemId: item.id, cooked: 'true' },
			{ intent: 'setItemMultiplier', itemId: item.id, multiplier: '2' },
			{ intent: 'removeItem', itemId: item.id },
			{ intent: 'removeMeal', mealId: meal!.id },
			{ intent: 'moveMeal', mealId: meal!.id, direction: 'up' },
			{ intent: 'addRecipeToMeal', mealId: meal!.id, recipeId: recipe.id },
			{ intent: 'updateMealDetails', mealId: meal!.id },
		]
		for (const fields of denied) {
			await expect(act(outsider, fields)).rejects.toEqual(
				expect.objectContaining({ status: 404 }),
			)
		}

		const [unchanged] = await findHouseholdMeals(session.householdId)
		expect(unchanged!.recipeItems[0]).toMatchObject({ cooked: false })
	})

	test('addTextMeal creates a text-only Meal with no items; completion lives on the Meal', async () => {
		const session = await setupUser()

		await act(session, {
			intent: 'addTextMeal',
			date: '2026-02-02',
			text: 'Leftovers',
			label: 'dinner',
		})

		const [meal] = await findHouseholdMeals(session.householdId)
		expect(meal).toMatchObject({
			genericText: 'Leftovers',
			label: 'dinner',
			completed: false,
		})
		expect(meal!.recipeItems).toHaveLength(0)

		await act(session, {
			intent: 'setMealCooked',
			mealId: meal!.id,
			cooked: 'true',
		})
		const [completed] = await findHouseholdMeals(session.householdId)
		expect(completed!.completed).toBe(true)
	})

	test('addRecipeToMeal appends an ordered item; duplicates no-op; text Meals refuse', async () => {
		const session = await setupUser()
		const first = await setupRecipe(
			session.userId,
			session.householdId,
			'First',
		)
		const second = await setupRecipe(
			session.userId,
			session.householdId,
			'Second',
		)
		await act(session, {
			intent: 'addMeal',
			date: '2026-02-02',
			recipeId: first.id,
		})
		const [meal] = await findHouseholdMeals(session.householdId)

		await act(session, {
			intent: 'addRecipeToMeal',
			mealId: meal!.id,
			recipeId: second.id,
		})
		// Adding the same Recipe again is a no-op, not a duplicate card.
		await act(session, {
			intent: 'addRecipeToMeal',
			mealId: meal!.id,
			recipeId: second.id,
		})

		const [updated] = await findHouseholdMeals(session.householdId)
		expect(
			updated!.recipeItems.map((item) => [item.order, item.recipeTitle]),
		).toEqual([
			[0, 'First'],
			[1, 'Second'],
		])

		await act(session, {
			intent: 'addTextMeal',
			date: '2026-02-03',
			text: 'Out',
		})
		const textMeal = (await findHouseholdMeals(session.householdId)).find(
			(m) => m.genericText === 'Out',
		)
		await expect(
			act(session, {
				intent: 'addRecipeToMeal',
				mealId: textMeal!.id,
				recipeId: first.id,
			}),
		).rejects.toEqual(expect.objectContaining({ status: 400 }))
	})

	test('setItemCooked updates the item; repeats are idempotent', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		await act(session, {
			intent: 'addMeal',
			date: '2026-02-02',
			recipeId: recipe.id,
		})
		const [meal] = await findHouseholdMeals(session.householdId)
		const item = meal!.recipeItems[0]!

		await act(session, {
			intent: 'setItemCooked',
			itemId: item.id,
			cooked: 'true',
		})
		await act(session, {
			intent: 'setItemCooked',
			itemId: item.id,
			cooked: 'true',
		})

		const toggled = await prisma.mealRecipeItem.findUniqueOrThrow({
			where: { id: item.id },
		})
		expect(toggled.cooked).toBe(true)

		await act(session, {
			intent: 'setItemCooked',
			itemId: item.id,
			cooked: 'false',
		})
		expect(
			(
				await prisma.mealRecipeItem.findUniqueOrThrow({
					where: { id: item.id },
				})
			).cooked,
		).toBe(false)
	})

	test('setMealCooked on a Recipe Meal updates every item explicitly', async () => {
		const session = await setupUser()
		const first = await setupRecipe(
			session.userId,
			session.householdId,
			'First',
		)
		const second = await setupRecipe(
			session.userId,
			session.householdId,
			'Second',
		)
		await act(session, {
			intent: 'addMeal',
			date: '2026-02-02',
			recipeId: first.id,
		})
		const [meal] = await findHouseholdMeals(session.householdId)
		await act(session, {
			intent: 'addRecipeToMeal',
			mealId: meal!.id,
			recipeId: second.id,
		})

		await act(session, {
			intent: 'setMealCooked',
			mealId: meal!.id,
			cooked: 'true',
		})

		const [updated] = await findHouseholdMeals(session.householdId)
		expect(updated!.recipeItems.map((item) => item.cooked)).toEqual([
			true,
			true,
		])
		// Derived completion stays on items — the Meal row is not marked.
		expect(updated!.completed).toBe(false)
	})

	test('setItemMultiplier persists the batch multiplier', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		await act(session, {
			intent: 'addMeal',
			date: '2026-02-02',
			recipeId: recipe.id,
		})
		const [meal] = await findHouseholdMeals(session.householdId)
		const item = meal!.recipeItems[0]!

		const result = await act(session, {
			intent: 'setItemMultiplier',
			itemId: item.id,
			multiplier: '2,5',
		})
		expect(result).toEqual({ status: 'success' })
		expect(
			(
				await prisma.mealRecipeItem.findUniqueOrThrow({
					where: { id: item.id },
				})
			).scaleMultiplier,
		).toBe(2.5)

		const invalid = await act(session, {
			intent: 'setItemMultiplier',
			itemId: item.id,
			multiplier: '0',
		})
		expect(invalid).toMatchObject({ status: 'error' })
	})

	test('quantity proposal is transient, receives visible Meal context without legacy servings, and re-run does not overwrite accepted values', async () => {
		const session = await setupUser()
		const first = await setupRecipe(
			session.userId,
			session.householdId,
			'Flexible stew',
		)
		const second = await setupRecipe(
			session.userId,
			session.householdId,
			'Whole orange cake',
		)
		await prisma.recipe.update({
			where: { id: first.id },
			data: {
				description: 'A shared main course',
				instructions: { create: { content: 'Simmer in one pot.', order: 0 } },
			},
		})
		await act(session, {
			intent: 'addMeal',
			date: '2026-02-02',
			recipeId: first.id,
		})
		let [meal] = await findHouseholdMeals(session.householdId)
		await act(session, {
			intent: 'addRecipeToMeal',
			mealId: meal!.id,
			recipeId: second.id,
		})
		await act(session, {
			intent: 'updateMealDetails',
			mealId: meal!.id,
			guestCount: '8',
		})
		;[meal] = await findHouseholdMeals(session.householdId)
		const [firstItem, secondItem] = meal!.recipeItems

		const propose = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true as const,
				data: {
					status: 'proposal' as const,
					assumptions: ['Side dishes are also served.'],
					items: [
						{
							itemKey: firstItem!.id,
							scaleMultiplier: 2,
							scalingMode: 'flexible' as const,
							rationale: 'Scale the stew.',
							assumptions: [],
						},
						{
							itemKey: secondItem!.id,
							scaleMultiplier: 1,
							scalingMode: 'fixed' as const,
							rationale: 'Keep one whole cake.',
							assumptions: [],
						},
					],
				},
			})
			.mockResolvedValueOnce({
				ok: true as const,
				data: {
					status: 'proposal' as const,
					assumptions: [],
					items: [
						{
							itemKey: firstItem!.id,
							scaleMultiplier: 3,
							scalingMode: 'flexible' as const,
							rationale: 'A fresh draft.',
							assumptions: [],
						},
						{
							itemKey: secondItem!.id,
							scaleMultiplier: 2,
							scalingMode: 'fixed' as const,
							rationale: 'A fresh whole-dish draft.',
							assumptions: [],
						},
					],
				},
			})
		const usageRemaining = vi.fn().mockResolvedValue(10)
		const recordUsage = vi
			.fn()
			.mockResolvedValue({ allowed: true, remaining: 9 })
		const quantityAction = createPlanAction(
			prisma,
			async () => ({ ...session, isProActive: true }),
			{ propose, usageRemaining, recordUsage },
		)
		const submitQuantity = async (fields: Record<string, string>) =>
			quantityAction({ request: await makeRequest(session, fields) })

		const firstDraft = await submitQuantity({
			intent: 'proposeMealQuantities',
			mealId: meal!.id,
		})
		expect(firstDraft).toMatchObject({
			status: 'success',
			quantityProposal: { status: 'proposal' },
		})
		const planningInput = propose.mock.calls[0]![0]
		expect(planningInput).toMatchObject({
			context: 'planned-meal',
			guestCount: 8,
			sections: [
				{
					name: null,
					items: [
						expect.objectContaining({
							itemKey: firstItem!.id,
							recipe: expect.objectContaining({
								title: 'Flexible stew',
								description: 'A shared main course',
								currentScaleMultiplier: 1,
								instructions: [{ content: 'Simmer in one pot.' }],
							}),
						}),
						expect.objectContaining({ itemKey: secondItem!.id }),
					],
				},
			],
		})
		expect(planningInput.sections[0].items[0].recipe).not.toHaveProperty(
			'servings',
		)
		expect(recordUsage).toHaveBeenCalledTimes(1)
		expect(
			(await findHouseholdMeals(session.householdId))[0]!.recipeItems.map(
				(item) => item.scaleMultiplier,
			),
		).toEqual([1, 1])

		// Accept/edit the first proposal and reject the cake. Only the explicit
		// apply writes, and the rejected item stays manual.
		const apply = await submitQuantity({
			intent: 'applyMealQuantities',
			mealId: meal!.id,
			quantitySelections: JSON.stringify([
				{ itemKey: firstItem!.id, scaleMultiplier: 2.5 },
			]),
		})
		expect(apply).toEqual({ status: 'success', quantitiesApplied: 1 })
		expect(
			(await findHouseholdMeals(session.householdId))[0]!.recipeItems.map(
				(item) => item.scaleMultiplier,
			),
		).toEqual([2.5, 1])
		await submitQuantity({
			intent: 'addMealToShopping',
			mealId: meal!.id,
		})
		expect(
			await prisma.mealShoppingContribution.findFirst({
				where: { mealId: meal!.id, name: 'flour' },
				select: { quantity: true, unit: true },
			}),
		).toEqual({ quantity: '7', unit: 'cups' })

		await submitQuantity({
			intent: 'proposeMealQuantities',
			mealId: meal!.id,
		})
		expect(
			(await findHouseholdMeals(session.householdId))[0]!.recipeItems.map(
				(item) => item.scaleMultiplier,
			),
		).toEqual([2.5, 1])
		expect(propose).toHaveBeenCalledTimes(2)
		expect(recordUsage).toHaveBeenCalledTimes(2)
	})

	test('quantity provider, entitlement, rate-limit, and forged-apply failures never mutate Meal data', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		await act(session, {
			intent: 'addMeal',
			date: '2026-02-02',
			recipeId: recipe.id,
		})
		const [meal] = await findHouseholdMeals(session.householdId)
		await act(session, {
			intent: 'updateMealDetails',
			mealId: meal!.id,
			guestCount: '4',
		})
		const item = meal!.recipeItems[0]!
		const propose = vi.fn().mockResolvedValue({
			ok: false as const,
			error: 'Provider failed. Manual multipliers are unchanged.',
		})
		const recordUsage = vi.fn()

		const failedAction = createPlanAction(
			prisma,
			async () => ({ ...session, isProActive: true }),
			{
				propose,
				usageRemaining: vi.fn().mockResolvedValue(10),
				recordUsage,
			},
		)
		const providerFailure = await failedAction({
			request: await makeRequest(session, {
				intent: 'proposeMealQuantities',
				mealId: meal!.id,
			}),
		})
		expect(providerFailure).toMatchObject({ status: 'error' })
		expect(recordUsage).not.toHaveBeenCalled()

		const freeAction = createPlanAction(
			prisma,
			async () => ({ ...session, isProActive: false }),
			{
				propose,
				usageRemaining: vi.fn(),
				recordUsage,
			},
		)
		expect(
			await freeAction({
				request: await makeRequest(session, {
					intent: 'proposeMealQuantities',
					mealId: meal!.id,
				}),
			}),
		).toMatchObject({ status: 'error', requiresPro: true })

		const rateLimitedAction = createPlanAction(
			prisma,
			async () => ({ ...session, isProActive: true }),
			{
				propose,
				usageRemaining: vi.fn().mockResolvedValue(0),
				recordUsage,
			},
		)
		expect(
			await rateLimitedAction({
				request: await makeRequest(session, {
					intent: 'proposeMealQuantities',
					mealId: meal!.id,
				}),
			}),
		).toMatchObject({ status: 'error' })

		await expect(
			act(session, {
				intent: 'applyMealQuantities',
				mealId: meal!.id,
				quantitySelections: JSON.stringify([
					{ itemKey: 'forged-item', scaleMultiplier: 9 },
				]),
			}),
		).rejects.toEqual(expect.objectContaining({ status: 400 }))
		expect(
			(
				await prisma.mealRecipeItem.findUniqueOrThrow({
					where: { id: item.id },
				})
			).scaleMultiplier,
		).toBe(1)
	})

	test('removeItem deletes the item; removing the last item removes the Meal', async () => {
		const session = await setupUser()
		const first = await setupRecipe(
			session.userId,
			session.householdId,
			'First',
		)
		const second = await setupRecipe(
			session.userId,
			session.householdId,
			'Second',
		)
		await act(session, {
			intent: 'addMeal',
			date: '2026-02-02',
			recipeId: first.id,
		})
		const [meal] = await findHouseholdMeals(session.householdId)
		await act(session, {
			intent: 'addRecipeToMeal',
			mealId: meal!.id,
			recipeId: second.id,
		})

		let [current] = await findHouseholdMeals(session.householdId)
		await act(session, {
			intent: 'removeItem',
			itemId: current!.recipeItems[1]!.id,
		})
		;[current] = await findHouseholdMeals(session.householdId)
		expect(current!.recipeItems).toHaveLength(1)

		await act(session, {
			intent: 'removeItem',
			itemId: current!.recipeItems[0]!.id,
		})
		expect(await findHouseholdMeals(session.householdId)).toHaveLength(0)
	})

	test('removeMeal deletes the Meal and its items', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		await act(session, {
			intent: 'addMeal',
			date: '2026-02-02',
			recipeId: recipe.id,
		})
		const [meal] = await findHouseholdMeals(session.householdId)

		const result = await act(session, {
			intent: 'removeMeal',
			mealId: meal!.id,
		})
		expect(result).toEqual({ status: 'success' })
		expect(await findHouseholdMeals(session.householdId)).toHaveLength(0)
		expect(
			await prisma.mealRecipeItem.count({
				where: { meal: { mealPlan: { householdId: session.householdId } } },
			}),
		).toBe(0)
	})

	test('moveMeal swaps explicit day order and no-ops at the edges', async () => {
		const session = await setupUser()
		const first = await setupRecipe(
			session.userId,
			session.householdId,
			'First',
		)
		const second = await setupRecipe(
			session.userId,
			session.householdId,
			'Second',
		)
		await act(session, {
			intent: 'addMeal',
			date: '2026-02-02',
			recipeId: first.id,
		})
		await act(session, {
			intent: 'addMeal',
			date: '2026-02-02',
			recipeId: second.id,
		})

		let meals = await findHouseholdMeals(session.householdId)
		expect(
			meals.map((meal) => [meal.order, meal.recipeItems[0]!.recipeTitle]),
		).toEqual([
			[0, 'First'],
			[1, 'Second'],
		])

		await act(session, {
			intent: 'moveMeal',
			mealId: meals[1]!.id,
			direction: 'up',
		})
		meals = await findHouseholdMeals(session.householdId)
		expect(
			meals.map((meal) => [meal.order, meal.recipeItems[0]!.recipeTitle]),
		).toEqual([
			[0, 'Second'],
			[1, 'First'],
		])

		// Already first: moving up again changes nothing.
		await act(session, {
			intent: 'moveMeal',
			mealId: meals[0]!.id,
			direction: 'up',
		})
		expect(
			(await findHouseholdMeals(session.householdId)).map(
				(meal) => meal.recipeItems[0]!.recipeTitle,
			),
		).toEqual(['Second', 'First'])
	})

	test('updateMealDetails stores label, serving instant with its zone, and guest count — and clears them', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		await act(session, {
			intent: 'addMeal',
			date: '2026-02-02',
			recipeId: recipe.id,
		})
		const [meal] = await findHouseholdMeals(session.householdId)

		await act(session, {
			intent: 'updateMealDetails',
			mealId: meal!.id,
			label: 'dinner',
			time: '18:30',
			timeZone: 'Europe/Berlin',
			guestCount: '6',
		})

		let updated = await prisma.meal.findUniqueOrThrow({
			where: { id: meal!.id },
		})
		expect(updated).toMatchObject({
			label: 'dinner',
			servingTimeZone: 'Europe/Berlin',
			guestCount: 6,
		})
		// 18:30 CET on the Meal's semantic day = 17:30 UTC.
		expect(updated.servingAt?.toISOString()).toBe('2026-02-02T17:30:00.000Z')

		// A forged non-clock time is rejected, not rolled over into later days.
		const forged = await act(session, {
			intent: 'updateMealDetails',
			mealId: meal!.id,
			time: '39:99',
			timeZone: 'Europe/Berlin',
		})
		expect(forged).toMatchObject({ status: 'error' })
		updated = await prisma.meal.findUniqueOrThrow({ where: { id: meal!.id } })
		expect(updated.servingAt?.toISOString()).toBe('2026-02-02T17:30:00.000Z')

		// The form always submits every field, so absence clears.
		await act(session, { intent: 'updateMealDetails', mealId: meal!.id })
		updated = await prisma.meal.findUniqueOrThrow({ where: { id: meal!.id } })
		expect(updated).toMatchObject({
			label: null,
			servingAt: null,
			servingTimeZone: null,
			guestCount: null,
		})
	})

	test('updateMealDetails edits text on a text-only Meal but never adds it to a Recipe Meal', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)
		await act(session, {
			intent: 'addTextMeal',
			date: '2026-02-02',
			text: 'Leftovers',
		})
		await act(session, {
			intent: 'addMeal',
			date: '2026-02-03',
			recipeId: recipe.id,
		})
		const meals = await findHouseholdMeals(session.householdId)
		const textMeal = meals.find((m) => m.genericText != null)!
		const recipeMeal = meals.find((m) => m.genericText == null)!

		await act(session, {
			intent: 'updateMealDetails',
			mealId: textMeal.id,
			text: 'Takeout instead',
		})
		expect(
			(await prisma.meal.findUniqueOrThrow({ where: { id: textMeal.id } }))
				.genericText,
		).toBe('Takeout instead')

		// Generic text and Recipe items stay mutually exclusive (#98).
		await act(session, {
			intent: 'updateMealDetails',
			mealId: recipeMeal.id,
			text: 'Sneaky text',
		})
		expect(
			(await prisma.meal.findUniqueOrThrow({ where: { id: recipeMeal.id } }))
				.genericText,
		).toBeNull()
	})

	test('member can open the same week after moving to another household', async () => {
		const session = await setupUser()
		await prisma.mealPlan.create({
			data: {
				householdId: session.householdId,
				weekStart: new Date('2026-02-02T00:00:00.000Z'),
			},
		})
		const nextHousehold = await prisma.$transaction(async (tx) => {
			await tx.householdMember.delete({
				where: {
					householdId_userId: {
						householdId: session.householdId,
						userId: session.userId,
					},
				},
			})
			return tx.household.create({
				data: {
					name: 'Next Household',
					members: {
						create: { userId: session.userId, role: 'owner' },
					},
				},
			})
		})

		const result = await loader({
			request: await makeLoaderRequest(session, '2026-02-02'),
			...ACTION_ARGS_BASE,
		})

		expect(result.meals).toEqual([])
		await expect(
			prisma.mealPlan.findUniqueOrThrow({
				where: {
					householdId_weekStart: {
						householdId: nextHousehold.id,
						weekStart: new Date('2026-02-02T00:00:00.000Z'),
					},
				},
			}),
		).resolves.toEqual(
			expect.objectContaining({ householdId: nextHousehold.id }),
		)
	})

	test('meal not found returns 404', async () => {
		const session = await setupUser()

		const response = act(session, {
			intent: 'setMealCooked',
			mealId: 'nonexistent-id',
			cooked: 'true',
		})
		await expect(response).rejects.toEqual(
			expect.objectContaining({ status: 404 }),
		)
	})
})
