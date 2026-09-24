import { RouterContextProvider } from 'react-router'
import { describe, expect, test, vi } from 'vitest'

vi.mock('#app/utils/household-events.server.ts', () => ({
	emitHouseholdEvent: vi.fn(),
}))
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { menuTitleKey } from '#app/utils/menu-validation.ts'
import { servingWallTime } from '#app/utils/serving-time.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { action, loader } from './index.tsx'
import { createPlanAction } from './plan-action.server.ts'
import '#tests/setup/db-setup.ts'

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
			ingredients: {
				create: [{ name: 'flour', amount: '2', unit: 'cups', order: 0 }],
			},
		},
	})
}

async function setupMenu(
	userId: string,
	householdId: string,
	title = 'Friday Supper',
) {
	const [first, second] = await Promise.all([
		setupRecipe(userId, householdId, 'Herb Salad'),
		setupRecipe(userId, householdId, 'Garlic Flatbread'),
	])
	const menu = await prisma.menu.create({
		data: {
			title,
			titleKey: menuTitleKey(title),
			defaultGuestCount: 4,
			householdId,
			sections: {
				create: {
					name: null,
					order: 0,
					items: {
						create: [
							{
								kind: 'recipe',
								order: 0,
								recipeId: first.id,
								recipeTitle: first.title,
								scaleMultiplier: 1,
							},
							{
								kind: 'recipe',
								order: 1,
								recipeId: second.id,
								recipeTitle: second.title,
								scaleMultiplier: 1.5,
							},
						],
					},
				},
			},
		},
	})
	return { menu, first, second }
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

describe('moving a Meal through Edit details', () => {
	async function setupTextMeal(date = '2026-02-02') {
		const session = await setupUser()
		await act(session, {
			intent: 'addTextMeal',
			date,
			text: 'Leftovers',
		})
		const [meal] = await findHouseholdMeals(session.householdId)
		return { session, meal: meal! }
	}

	test('moves the existing Menu snapshot and preserves every child and Shopping relationship', async () => {
		const session = await setupUser()
		const { menu } = await setupMenu(session.userId, session.householdId)
		const section = await prisma.menuSection.findFirstOrThrow({
			where: { menuId: menu.id },
		})
		await prisma.menuItem.create({
			data: {
				sectionId: section.id,
				kind: 'note',
				order: 2,
				note: 'Serve with sparkling water',
				shoppingLines: {
					create: {
						name: 'sparkling water',
						quantity: '2',
						unit: 'bottles',
						order: 0,
					},
				},
			},
		})
		await act(session, {
			intent: 'addMenu',
			date: '2026-02-02',
			menuId: menu.id,
		})
		const [meal] = await findHouseholdMeals(session.householdId)
		await prisma.mealRecipeItem.update({
			where: { id: meal!.recipeItems[0]!.id },
			data: { cooked: true, note: 'Chill first' },
		})
		await act(session, { intent: 'addMealToShopping', mealId: meal!.id })
		const readMeal = () =>
			prisma.meal.findUniqueOrThrow({
				where: { id: meal!.id },
				include: {
					recipeItems: { orderBy: { id: 'asc' } },
					sections: { orderBy: { id: 'asc' } },
					noteItems: { include: { shoppingLines: true } },
					shoppingContributions: { orderBy: { id: 'asc' } },
				},
			})
		const readShopping = () =>
			prisma.shoppingListItem.findMany({
				where: { list: { householdId: session.householdId } },
				orderBy: { id: 'asc' },
			})
		const before = await readMeal()
		const shopping = await readShopping()
		expect(shopping.length).toBeGreaterThan(0)
		expect(before.shoppingContributions.length).toBeGreaterThan(0)

		const response = await act(session, {
			intent: 'updateMealDetails',
			mealId: meal!.id,
			date: '2026-02-13',
			label: 'dinner',
			guestCount: '6',
		})
		expect(response).toBeInstanceOf(Response)
		expect((response as Response).headers.get('Location')).toBe(
			`/plan?weekStart=2026-02-09&mealId=${meal!.id}`,
		)
		const after = await readMeal()
		expect(after).toEqual({
			...before,
			date: new Date('2026-02-13'),
			mealPlanId: expect.any(String),
			updatedAt: expect.any(Date),
			label: 'dinner',
			guestCount: 6,
		})
		expect(after.mealPlanId).not.toBe(before.mealPlanId)
		expect(
			await prisma.mealPlan.findUniqueOrThrow({
				where: { id: after.mealPlanId },
			}),
		).toMatchObject({
			householdId: session.householdId,
			weekStart: new Date('2026-02-09'),
		})
		expect(await readShopping()).toEqual(shopping)
		expect(
			(
				await loader({
					request: await makeLoaderRequest(session, '2026-02-02'),
					...ACTION_ARGS_BASE,
				})
			).meals,
		).toEqual([])
		expect(
			(
				await loader({
					request: await makeLoaderRequest(session, '2026-02-09'),
					...ACTION_ARGS_BASE,
				})
			).meals.map((m) => m.id),
		).toEqual([meal!.id])
	})

	test.each(['2026-02-04', '2026-02-13'])(
		'appends to %s, keeps same-date order, and saves text and completion together',
		async (date) => {
			const { session, meal } = await setupTextMeal()
			await prisma.meal.update({
				where: { id: meal.id },
				data: { completed: true, order: 3 },
			})
			await act(session, {
				intent: 'addTextMeal',
				date,
				text: 'Already planned',
			})
			const destination = (await findHouseholdMeals(session.householdId)).find(
				(m) => m.id !== meal.id,
			)!
			// Recovered rows can use INTEGER dates. Append must still see their order.
			await prisma.$executeRaw`UPDATE "Meal" SET "date" = ${new Date(date).getTime()}, "order" = 7 WHERE "id" = ${destination.id}`
			const fields = {
				intent: 'updateMealDetails',
				mealId: meal.id,
				date,
				text: 'Takeout instead',
				label: 'dinner',
			}
			await act(session, fields)
			let updated = await prisma.meal.findUniqueOrThrow({
				where: { id: meal.id },
			})
			expect(updated).toMatchObject({
				date: new Date(date),
				order: 8,
				mealPlanId: destination.mealPlanId,
				completed: true,
				genericText: 'Takeout instead',
				servingAt: null,
				servingTimeZone: null,
			})
			// An unchanged date must not append again even after another Meal is added.
			await act(session, {
				intent: 'addTextMeal',
				date,
				text: 'Later addition',
			})
			expect(await act(session, { ...fields, label: 'lunch' })).toEqual({
				status: 'success',
			})
			updated = await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } })
			expect(updated).toMatchObject({
				order: 8,
				label: 'lunch',
				completed: true,
			})
		},
	)

	test('unchanged dates preserve the displayed order of recovered Meals', async () => {
		const { session, meal } = await setupTextMeal()
		await act(session, {
			intent: 'addTextMeal',
			date: '2026-02-02',
			text: 'Later Meal',
		})
		// Recovery can leave dates in SQLite's older INTEGER-ms format.
		await prisma.$executeRaw`UPDATE "Meal" SET "date" = ${new Date('2026-02-02').getTime()} WHERE "mealPlanId" = ${meal.mealPlanId}`
		const readOrder = async () =>
			(
				await loader({
					request: await makeLoaderRequest(session, '2026-02-02'),
					...ACTION_ARGS_BASE,
				})
			).meals.map((m) => m.id)
		const before = await readOrder()
		expect(before).toHaveLength(2)
		expect(before[0]).toBe(meal.id)

		await act(session, {
			intent: 'updateMealDetails',
			mealId: meal.id,
			date: '2026-02-02',
			guestCount: '4',
		})

		expect(await readOrder()).toEqual(before)
		expect(
			await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } }),
		).toMatchObject({ order: 0, guestCount: 4 })
	})

	test.each<Record<string, string>>([
		{ date: '' },
		{ date: '2026-02-30' },
		{ date: 'not-a-date' },
		{ date: '2026-02-13T18:00:00Z' },
		{ guestCount: '1000' },
		{ time: '39:99', timeZone: 'Europe/Berlin' },
		{ time: '18:30', timeZone: 'invalid-zone' },
	])('invalid details leave no partial move: %j', async (invalid) => {
		const { session, meal } = await setupTextMeal()
		const result = await act(session, {
			intent: 'updateMealDetails',
			mealId: meal.id,
			date: '2026-02-13',
			text: 'Changed',
			...invalid,
		})
		expect(result).toMatchObject({ status: 'error' })
		expect(await findHouseholdMeals(session.householdId)).toEqual([meal])
		expect(
			await prisma.mealPlan.count({
				where: { householdId: session.householdId },
			}),
		).toBe(1)
	})

	test('denied and missing Meals create no destination plan or partial edits', async () => {
		const { session, meal } = await setupTextMeal()
		const outsider = await setupUser()
		for (const mealId of [meal.id, 'missing-meal']) {
			await expect(
				act(outsider, {
					intent: 'updateMealDetails',
					mealId,
					date: '2026-02-13',
					text: 'Changed',
				}),
			).rejects.toMatchObject({ status: 404 })
		}
		expect(await findHouseholdMeals(session.householdId)).toEqual([meal])
		expect(
			await prisma.mealPlan.count({
				where: { householdId: outsider.householdId },
			}),
		).toBe(0)
	})

	test('a failed write rolls back destination creation and all details', async () => {
		const { session, meal } = await setupTextMeal()
		await prisma.$executeRawUnsafe(
			`CREATE TRIGGER fail_meal_move BEFORE UPDATE ON "Meal" BEGIN SELECT RAISE(ABORT, 'injected move failure'); END`,
		)
		try {
			await expect(
				act(session, {
					intent: 'updateMealDetails',
					mealId: meal.id,
					date: '2026-02-13',
					label: 'dinner',
					text: 'Changed',
					time: '18:30',
					timeZone: 'Europe/Berlin',
					guestCount: '6',
				}),
			).rejects.toThrow()
		} finally {
			await prisma.$executeRawUnsafe('DROP TRIGGER fail_meal_move')
		}
		expect(await findHouseholdMeals(session.householdId)).toEqual([meal])
		expect(
			await prisma.mealPlan.count({
				where: { householdId: session.householdId },
			}),
		).toBe(1)
	})

	test.each([
		[
			'Europe/Berlin',
			'2026-03-29',
			'18:30',
			'2026-03-29T16:30:00.000Z',
			'18:30',
		],
		[
			'Europe/Berlin',
			'2026-03-29',
			'02:30',
			'2026-03-29T01:30:00.000Z',
			'03:30',
		],
		[
			'Europe/Berlin',
			'2026-10-25',
			'02:30',
			'2026-10-25T01:30:00.000Z',
			'02:30',
		],
		[
			'America/New_York',
			'2026-03-08',
			'02:30',
			'2026-03-08T06:30:00.000Z',
			'01:30',
		],
		[
			'America/New_York',
			'2026-11-01',
			'01:30',
			'2026-11-01T05:30:00.000Z',
			'01:30',
		],
		[
			'Pacific/Auckland',
			'2026-02-13',
			'00:30',
			'2026-02-12T11:30:00.000Z',
			'00:30',
		],
	])(
		'reuses stored-zone conversion: %s on %s at %s',
		async (zone, date, time, instant, displayed) => {
			const { session, meal } = await setupTextMeal()
			await act(session, {
				intent: 'updateMealDetails',
				mealId: meal.id,
				date: '2026-02-02',
				time,
				timeZone: zone,
			})
			// A browser in another zone must not reinterpret an existing serving time.
			await act(session, {
				intent: 'updateMealDetails',
				mealId: meal.id,
				date,
				time,
				timeZone: 'Asia/Tokyo',
			})
			const updated = await prisma.meal.findUniqueOrThrow({
				where: { id: meal.id },
			})
			expect(updated.servingTimeZone).toBe(zone)
			expect(updated.servingAt?.toISOString()).toBe(instant)
			expect(servingWallTime(updated.servingAt!, zone)).toBe(displayed)
		},
	)

	test('unchanged details preserve either occurrence of an overlapping serving time', async () => {
		const { session, meal } = await setupTextMeal('2026-10-25')
		for (const instant of [
			'2026-10-25T00:30:00.000Z',
			'2026-10-25T01:30:00.000Z',
		]) {
			await prisma.meal.update({
				where: { id: meal.id },
				data: {
					servingAt: new Date(instant),
					servingTimeZone: 'Europe/Berlin',
				},
			})
			await act(session, {
				intent: 'updateMealDetails',
				mealId: meal.id,
				date: '2026-10-25',
				time: '02:30',
				timeZone: 'Asia/Tokyo',
				label: 'lunch',
			})
			expect(
				(
					await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } })
				).servingAt?.toISOString(),
			).toBe(instant)
		}
	})
})

describe('meal plan actions', () => {
	test('addMeal keeps a 1× manual batch when Recipe yield is unknown', async () => {
		const session = await setupUser()
		const recipe = await setupRecipe(session.userId, session.householdId)

		const result = await act(session, {
			intent: 'addMeal',
			date: '2026-02-02', // Monday
			recipeId: recipe.id,
		})
		expect(result).toMatchObject({
			status: 'success',
			meal: { created: true, scaleMultiplier: 1 },
		})

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

	// #236: the action reports which Meal now holds the Recipe and the
	// multiplier that Meal actually carries, so neither caller can imply a
	// re-submitted scale was applied.
	describe('addMeal feedback', () => {
		test('a new Meal reports created with the requested multiplier and a link to itself', async () => {
			const session = await setupUser()
			const recipe = await setupRecipe(session.userId, session.householdId)

			const result = await act(session, {
				intent: 'addMeal',
				date: '2026-02-04', // Wednesday of the 2026-02-02 week
				recipeId: recipe.id,
				label: 'dinner',
				multiplier: '3',
			})

			const [meal] = await findHouseholdMeals(session.householdId)
			expect(result).toEqual({
				status: 'success',
				meal: {
					id: meal!.id,
					created: true,
					scaleMultiplier: 3,
					href: `/plan?weekStart=2026-02-02&mealId=${meal!.id}`,
				},
			})
			expect(meal!.recipeItems[0]!.scaleMultiplier).toBe(3)
		})

		test('re-adding a planned Recipe reports the existing Meal and keeps its multiplier', async () => {
			const session = await setupUser()
			const recipe = await setupRecipe(session.userId, session.householdId)
			const fields = {
				intent: 'addMeal',
				date: '2026-02-02',
				recipeId: recipe.id,
				label: 'dinner',
			}

			const first = await act(session, fields)
			const second = await act(session, { ...fields, multiplier: '3' })

			const meals = await findHouseholdMeals(session.householdId)
			expect(meals).toHaveLength(1)
			// Both submissions name the same Meal.
			expect(first).toMatchObject({
				meal: { id: meals[0]!.id, created: true },
			})
			expect(second).toEqual({
				status: 'success',
				meal: {
					id: meals[0]!.id,
					created: false,
					// The planned 1x stands; the requested 3x was not applied.
					scaleMultiplier: 1,
					href: `/plan?weekStart=2026-02-02&mealId=${meals[0]!.id}`,
				},
			})
			expect(meals[0]!.recipeItems[0]!.scaleMultiplier).toBe(1)
		})

		test('the same Recipe on another day or under another label is a new Meal', async () => {
			const session = await setupUser()
			const recipe = await setupRecipe(session.userId, session.householdId)

			const dinner = await act(session, {
				intent: 'addMeal',
				date: '2026-02-02',
				recipeId: recipe.id,
				label: 'dinner',
			})
			const lunch = await act(session, {
				intent: 'addMeal',
				date: '2026-02-02',
				recipeId: recipe.id,
				label: 'lunch',
			})
			const nextDay = await act(session, {
				intent: 'addMeal',
				date: '2026-02-03',
				recipeId: recipe.id,
				label: 'dinner',
			})

			for (const result of [dinner, lunch, nextDay]) {
				expect(result).toMatchObject({ meal: { created: true } })
			}
			expect(await findHouseholdMeals(session.householdId)).toHaveLength(3)
		})

		test('overlapping adds leave one Meal and report the multiplier it really has', async () => {
			const session = await setupUser()
			const recipe = await setupRecipe(session.userId, session.householdId)
			const fields = {
				intent: 'addMeal',
				date: '2026-02-02',
				recipeId: recipe.id,
				label: 'dinner',
			}

			const results = await Promise.all([
				act(session, { ...fields, multiplier: '1' }),
				act(session, { ...fields, multiplier: '3' }),
			])

			const meals = await findHouseholdMeals(session.householdId)
			expect(meals).toHaveLength(1)
			// Which request wins the race is not fixed; what matters is that the
			// loser never creates an equivalent duplicate, never overwrites the
			// winner's multiplier, and is told the multiplier actually stored.
			const planned = meals[0]!.recipeItems[0]!.scaleMultiplier
			expect([1, 3]).toContain(planned)
			const href = `/plan?weekStart=2026-02-02&mealId=${meals[0]!.id}`
			expect(results).toEqual(
				expect.arrayContaining([
					{
						status: 'success',
						meal: {
							id: meals[0]!.id,
							created: true,
							scaleMultiplier: planned,
							href,
						},
					},
					{
						status: 'success',
						meal: {
							id: meals[0]!.id,
							created: false,
							scaleMultiplier: planned,
							href,
						},
					},
				]),
			)
		})
	})

	test('addMenu plans one frozen Meal on the chosen day with Menu defaults', async () => {
		const session = await setupUser()
		const { menu, first, second } = await setupMenu(
			session.userId,
			session.householdId,
		)

		const result = await act(session, {
			intent: 'addMenu',
			date: '2026-02-03',
			menuId: menu.id,
			label: 'dinner',
		})

		expect(result).toEqual({ status: 'success' })
		const meal = await prisma.meal.findFirstOrThrow({
			where: { sourceMenuId: menu.id },
			include: {
				sections: true,
				recipeItems: { orderBy: { order: 'asc' } },
			},
		})
		expect(meal).toMatchObject({
			date: new Date('2026-02-03T00:00:00.000Z'),
			label: 'dinner',
			guestCount: 4,
			sourceMenuId: menu.id,
		})
		expect(meal.sections).toHaveLength(1)
		expect(meal.recipeItems).toMatchObject([
			{ recipeId: first.id, recipeTitle: 'Herb Salad', scaleMultiplier: 1 },
			{
				recipeId: second.id,
				recipeTitle: 'Garlic Flatbread',
				scaleMultiplier: 1.5,
			},
		])
	})

	test('addMenu reports a Menu that became empty before selection', async () => {
		const session = await setupUser()
		const menu = await prisma.menu.create({
			data: {
				title: 'Emptied Menu',
				titleKey: menuTitleKey('Emptied Menu'),
				householdId: session.householdId,
				sections: { create: { name: null, order: 0 } },
			},
		})

		const result = await act(session, {
			intent: 'addMenu',
			date: '2026-02-03',
			menuId: menu.id,
		})

		expect(result).toEqual({
			status: 'error',
			menuError:
				'This Menu has nothing to plan yet—add a Recipe or note first.',
		})
		expect(await prisma.meal.count({ where: { sourceMenuId: menu.id } })).toBe(
			0,
		)
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

		expect(results).toMatchObject(
			Array.from({ length: 7 }, () => ({
				status: 'fulfilled',
				value: { status: 'success', meal: { created: true } },
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
		const { menu } = await setupMenu(session.userId, session.householdId)
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
			{ intent: 'addMenu', date: '2026-02-02', menuId: menu.id },
			{ intent: 'setMealCooked', mealId: meal!.id, cooked: 'true' },
			{ intent: 'setItemCooked', itemId: item.id, cooked: 'true' },
			{ intent: 'setItemMultiplier', itemId: item.id, multiplier: '2' },
			{ intent: 'removeItem', itemId: item.id },
			{ intent: 'removeMeal', mealId: meal!.id },
			{ intent: 'moveMeal', mealId: meal!.id, direction: 'up' },
			{ intent: 'addRecipeToMeal', mealId: meal!.id, recipeId: recipe.id },
			{ intent: 'updateMealDetails', mealId: meal!.id, date: '2026-02-02' },
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
		// The rejected value is never written.
		expect(
			(
				await prisma.mealRecipeItem.findUniqueOrThrow({
					where: { id: item.id },
				})
			).scaleMultiplier,
		).toBe(2.5)
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
			date: '2026-02-02',
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
			date: '2026-02-02',
			mealId: meal!.id,
			time: '39:99',
			timeZone: 'Europe/Berlin',
		})
		expect(forged).toMatchObject({ status: 'error' })
		updated = await prisma.meal.findUniqueOrThrow({ where: { id: meal!.id } })
		expect(updated.servingAt?.toISOString()).toBe('2026-02-02T17:30:00.000Z')

		// The form always submits every field, so absence clears.
		await act(session, {
			intent: 'updateMealDetails',
			mealId: meal!.id,
			date: '2026-02-02',
		})
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
			date: '2026-02-02',
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
			date: '2026-02-03',
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
