import {
	formatWeekdayName,
	getCurrentWeekStart,
	getWeekDays,
	isToday,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { menuTitleKey } from '#app/utils/menu-validation.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test.describe('Move a Meal', () => {
	test.use({ timezoneId: 'Asia/Tokyo' })

	test('Edit details moves a Meal across weeks and opens it with its contents and Shopping intact', async ({
		page,
		login,
	}) => {
		const user = await login()
		const household = await prisma.household.create({
			data: {
				name: 'Meal move household',
				members: { create: { userId: user.id, role: 'owner' } },
			},
		})
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Lemon Pasta',
				userId: user.id,
				householdId: household.id,
				ingredients: {
					create: { name: 'pasta', amount: '200', unit: 'g', order: 0 },
				},
			},
		})
		const plan = await prisma.mealPlan.create({
			data: { householdId: household.id, weekStart: new Date('2026-10-19') },
		})
		const meal = await prisma.meal.create({
			data: {
				mealPlanId: plan.id,
				date: new Date('2026-10-23'),
				order: 0,
				label: 'dinner',
				guestCount: 2,
				servingAt: new Date('2026-10-23T16:30:00Z'),
				servingTimeZone: 'Europe/Berlin',
				recipeItems: {
					create: {
						recipeId: recipe.id,
						recipeTitle: recipe.title,
						order: 0,
						scaleMultiplier: 1.5,
						cooked: true,
						note: 'Extra lemon at the table',
					},
				},
			},
			include: { recipeItems: true },
		})
		await prisma.mealPlan.create({
			data: {
				householdId: household.id,
				weekStart: new Date('2026-10-26'),
				meals: {
					create: [
						{
							date: new Date('2026-10-26'),
							order: 0,
							genericText: 'Earlier in the week',
						},
						{
							date: new Date('2026-10-30'),
							order: 0,
							genericText: 'Lunch out',
						},
					],
				},
			},
		})
		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto('/plan?weekStart=2026-10-19')
		const mobile = page.getByTestId('mobile-plan')
		const mealActions = mobile.getByRole('button', {
			name: 'Meal actions for Lemon Pasta',
		})
		await expect(async () => {
			await mealActions.click()
			await expect(
				page.getByRole('menuitem', {
					name: 'Add to Shopping List',
					exact: true,
				}),
			).toBeVisible({ timeout: 2000 })
		}).toPass()
		await page
			.getByRole('menuitem', { name: 'Add to Shopping List', exact: true })
			.click()
		const readShopping = () =>
			prisma.shoppingListItem.findMany({
				where: { list: { householdId: household.id } },
				include: { mealContributions: true },
			})
		await expect.poll(async () => (await readShopping()).length).toBe(1)
		const shopping = await readShopping()

		await mealActions.click()
		await page.getByRole('menuitem', { name: 'Edit details' }).click()
		await expect(mobile.getByLabel('Date', { exact: true })).toHaveValue(
			'2026-10-23',
		)
		await expect(mobile.getByLabel('Serving time')).toHaveValue('18:30')
		await mobile.getByLabel('Date', { exact: true }).fill('2026-10-30')
		await mobile.getByLabel('Guests').fill('4')
		await mobile.getByRole('button', { name: 'Save', exact: true }).click()
		await expect(page).toHaveURL(`/plan?weekStart=2026-10-26&mealId=${meal.id}`)
		const movedCard = mobile.locator(`[data-meal-id="${meal.id}"]`)
		await expect(mobile.getByRole('heading', { name: 'Oct 30' })).toBeVisible()
		await expect(movedCard).toBeFocused()
		await expect(movedCard).toBeInViewport()
		await expect(movedCard).toContainText('6:30 PM')
		await expect(movedCard).toContainText('4 guests')
		await expect(movedCard).toContainText('Extra lemon at the table')
		await expect(movedCard.getByLabel('Scale multiplier')).toHaveValue('1.5')
		await expect(
			movedCard.getByRole('button', { name: 'Mark Lemon Pasta as not cooked' }),
		).toBeVisible()
		await expect(mobile.locator('[data-slot="meal-group"]')).toHaveText([
			/Lunch out/,
			/Lemon Pasta/,
		])
		const updated = await prisma.meal.findUniqueOrThrow({
			where: { id: meal.id },
			include: { recipeItems: true },
		})
		expect(updated).toMatchObject({
			date: new Date('2026-10-30'),
			order: 1,
			guestCount: 4,
			servingAt: new Date('2026-10-30T17:30:00Z'),
			servingTimeZone: 'Europe/Berlin',
			recipeItems: meal.recipeItems,
		})
		expect(await readShopping()).toEqual(shopping)
		await page.reload()
		await expect(movedCard).toBeVisible()
		await page.setViewportSize({ width: 1280, height: 800 })
		await expect(
			page.getByTestId('desktop-plan').locator(`[data-meal-id="${meal.id}"]`),
		).toContainText('Lemon Pasta')
		await page.getByRole('link', { name: 'Previous week' }).click()
		await expect(
			page
				.getByTestId('desktop-plan')
				.getByText('Lemon Pasta', { exact: true }),
		).toHaveCount(0)
	})
})

test('Meal plan: view Meals, add one fast, and mark as cooked', async ({
	page,
	login,
}) => {
	const user = await login()

	// The login fixture creates a bare user; the app expects a household
	// because all plan/recipe data is household-scoped.
	const household = await prisma.household.create({
		data: {
			name: 'Test Household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})

	// Create recipes via DB
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Test Stir Fry',
			userId: user.id,
			householdId: household.id,
			ingredients: {
				create: [
					{ name: 'chicken', amount: '1', unit: 'lb', order: 0 },
					{ name: 'rice', amount: '2', unit: 'cups', order: 1 },
				],
			},
			instructions: {
				create: [{ content: 'Stir fry everything', order: 0 }],
			},
		},
	})
	const secondRecipe = await prisma.recipe.create({
		data: {
			title: 'Herb Salad',
			userId: user.id,
			householdId: household.id,
		},
	})
	const menuRecipe = await prisma.recipe.create({
		data: {
			title: 'Garlic Flatbread',
			userId: user.id,
			householdId: household.id,
		},
	})
	const menu = await prisma.menu.create({
		data: {
			title: 'Friday Supper',
			titleKey: menuTitleKey('Friday Supper'),
			defaultGuestCount: 4,
			householdId: household.id,
			sections: {
				create: {
					name: null,
					order: 0,
					items: {
						create: [
							{
								kind: 'recipe',
								order: 0,
								recipeId: secondRecipe.id,
								recipeTitle: secondRecipe.title,
								scaleMultiplier: 1,
							},
							{
								kind: 'recipe',
								order: 1,
								recipeId: menuRecipe.id,
								recipeTitle: menuRecipe.title,
								scaleMultiplier: 1.5,
							},
						],
					},
				},
			},
		},
	})

	// Seed one planned Meal via DB — the planner reads Meal parents (#105)
	const weekStart = getCurrentWeekStart()
	const weekDays = getWeekDays(weekStart)
	const plannedDay = weekDays.find(isToday) ?? weekDays[0]!
	await prisma.mealPlan.create({
		data: {
			householdId: household.id,
			weekStart,
			meals: {
				create: {
					date: plannedDay,
					order: 0,
					label: 'dinner',
					recipeItems: {
						create: {
							order: 0,
							recipeId: recipe.id,
							recipeTitle: recipe.title,
						},
					},
				},
			},
		},
	})

	// 1. Navigate to meal plan
	await page.goto('/plan')
	await expect(page.getByRole('heading', { name: /meal plan/i })).toBeVisible()
	await expect(page.getByRole('link', { name: 'Previous week' })).toBeVisible()
	await expect(page.getByRole('link', { name: 'Next week' })).toBeVisible()
	await expect(page.getByRole('link', { name: 'Prep' })).toHaveCount(0)
	const desktopPlan = page.getByTestId('desktop-plan')
	const dayRailRightEdges = await Promise.all(
		weekDays.map((date) =>
			desktopPlan
				.getByText(isToday(date) ? 'Today' : formatWeekdayName(date), {
					exact: true,
				})
				.evaluate(
					(element) => element.parentElement?.getBoundingClientRect().right,
				),
		),
	)
	expect(
		new Set(dayRailRightEdges.map((edge) => Math.round((edge ?? 0) * 100)))
			.size,
	).toBe(1)

	// 2. Verify the Meal appears in the calendar with its optional label
	await expect(
		desktopPlan.getByText('Test Stir Fry', { exact: true }),
	).toBeVisible()
	await expect(desktopPlan.getByText('Dinner', { exact: true })).toBeVisible()
	await expect(page.getByRole('button', { name: /copy week/i })).toHaveCount(0)
	await expect(
		page.getByRole('button', { name: /suggest meals/i }),
	).toHaveCount(0)

	// 3. Add another Meal through the fast path: Add Meal → pick a Recipe.
	// (Polling the first click instead of networkidle — household-events
	// long-polling never settles.)
	await expect(async () => {
		await desktopPlan
			.getByRole('button', { name: /add meal/i })
			.first()
			.click()
		await expect(
			page.getByPlaceholder('Search Recipes and Menus...').first(),
		).toBeVisible({ timeout: 2000 })
		await expect(page.getByRole('dialog')).toHaveCount(0)
	}).toPass()
	await page.getByRole('button', { name: /herb salad/i }).click()
	await expect(
		desktopPlan.getByText('Herb Salad', { exact: true }),
	).toBeVisible()
	await expect
		.poll(async () =>
			prisma.meal.count({
				where: {
					mealPlan: { householdId: household.id },
					recipeItems: { some: { recipeId: secondRecipe.id } },
				},
			}),
		)
		.toBe(1)

	// 4. Find a saved Menu by one of its contained Recipe titles and add the
	// whole group to the day in one step.
	await desktopPlan
		.getByRole('button', { name: /add meal/i })
		.first()
		.click()
	const planSearch = page
		.getByPlaceholder('Search Recipes and Menus...')
		.first()
	await planSearch.fill('garlic flatbrad')
	await expect(page.getByText('Menus', { exact: true }).first()).toBeVisible()
	await page
		.getByRole('button', { name: /Friday Supper/ })
		.first()
		.click()
	await expect(
		desktopPlan.getByRole('link', { name: 'Friday Supper' }),
	).toBeVisible()
	await expect
		.poll(async () =>
			prisma.meal.findFirst({
				where: { sourceMenuId: menu.id },
				select: {
					guestCount: true,
					_count: { select: { recipeItems: true } },
				},
			}),
		)
		.toEqual({ guestCount: 4, _count: { recipeItems: 2 } })

	// 5. Mark as cooked (plain toggle — no confirmation dialog)
	await desktopPlan
		.getByRole('button', { name: 'Mark Test Stir Fry as cooked' })
		.click()

	// 6. Verify cooked state (toggle label flips optimistically)
	await expect(
		desktopPlan.getByRole('button', {
			name: 'Mark Test Stir Fry as not cooked',
		}),
	).toBeVisible()

	// 7. Reload to confirm the state persisted — the optimistic flip above
	// would pass even if the server action failed
	await page.reload()
	await expect(
		desktopPlan.getByRole('button', {
			name: 'Mark Test Stir Fry as not cooked',
		}),
	).toBeVisible()

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)
		if (viewport.width === 390) {
			const mobileDayButtonLocator = page
				.getByTestId('mobile-plan')
				.getByRole('button', {
					name: /^Show .+, (?:no Meals|\d+ Meals?) planned$/,
				})
			await expect(mobileDayButtonLocator).toHaveCount(7)
			const mobileDayButtons = await mobileDayButtonLocator.all()
			for (const dayButton of mobileDayButtons) {
				const box = await dayButton.boundingBox()
				expect(box).not.toBeNull()
				expect(box!.x).toBeGreaterThanOrEqual(0)
				expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
			}
		}
		for (const control of [
			page
				.getByText('Test Stir Fry', { exact: true })
				.filter({ visible: true }),
			page.getByLabel('Scale multiplier').filter({ visible: true }).first(),
		]) {
			await expect(control).toBeVisible()
			const box = await control.boundingBox()
			expect(box).not.toBeNull()
			expect(box!.x).toBeGreaterThanOrEqual(0)
			expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
		}
	}
})

// #236: adding a Recipe that is already planned must report the Meal that
// exists, not imply the newly requested scale was applied.
test('Recipe already in Plan reports the planned Meal and links to it', async ({
	page,
	login,
}) => {
	const user = await login()
	const household = await prisma.household.create({
		data: {
			name: 'Already planned household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Miso Soup',
			userId: user.id,
			householdId: household.id,
			ingredients: {
				create: { name: 'miso', amount: '2', unit: 'tbsp', order: 0 },
			},
		},
	})

	// Plan it once at 1× from the Recipe page — the picker opens on Today
	// Dinner, which is the ordinary one-tap add.
	await page.goto(`/recipes/${recipe.id}`)
	await page.getByRole('button', { name: 'Add to meal plan' }).click()
	await page.getByRole('button', { name: 'Add to Plan' }).click()
	await expect(page.getByText('Added to Today Dinner')).toBeVisible()

	// Submitting the same Recipe at 3× leaves the planned Meal alone.
	await page.goto(`/recipes/${recipe.id}?scale=3`)
	await page.getByRole('button', { name: 'Add to meal plan' }).click()
	await page.getByRole('button', { name: 'Add to Plan' }).click()
	await expect(page.getByText('Already planned')).toBeVisible()
	await expect(page.getByText('Today Dinner · 1×')).toBeVisible()

	// …and the message leads to that Meal.
	await page.getByRole('button', { name: 'View' }).click()
	await expect(page).toHaveURL(/\/plan\?weekStart=.*mealId=/)
	await expect(
		page
			.getByRole('link', { name: 'Miso Soup', exact: true })
			.filter({ visible: true })
			.first(),
	).toBeVisible()

	expect(
		await prisma.mealRecipeItem.findMany({
			where: { meal: { mealPlan: { householdId: household.id } } },
			select: { scaleMultiplier: true },
		}),
	).toEqual([{ scaleMultiplier: 1 }])
})
