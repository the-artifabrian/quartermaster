import { type Page } from '@playwright/test'
import {
	addDaysUTC,
	formatMonthDay,
	formatWeekdayName,
	getCurrentWeekStart,
	getWeekDays,
	isToday,
	serializeDate,
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
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Lemon Pasta',
				userId: user.id,
				householdId: user.householdId,
				ingredients: {
					create: { name: 'pasta', amount: '200', unit: 'g', order: 0 },
				},
			},
		})
		const plan = await prisma.mealPlan.create({
			data: {
				householdId: user.householdId,
				weekStart: new Date('2026-10-19'),
			},
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
				householdId: user.householdId,
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
					name: 'Add to Shopping',
					exact: true,
				}),
			).toBeVisible({ timeout: 2000 })
		}).toPass()
		await page
			.getByRole('menuitem', { name: 'Add to Shopping', exact: true })
			.click()
		const readShopping = () =>
			prisma.shoppingListItem.findMany({
				where: { list: { householdId: user.householdId } },
				include: { mealContributions: true },
			})
		await expect(page.getByText('Added 1 item to Shopping')).toBeVisible()
		const shopping = await readShopping()
		expect(shopping).toHaveLength(1)

		// The closed menu hands focus back to its trigger; reopening before then
		// lets that late focus close the new menu as a click outside.
		await expect(mealActions).toBeFocused()
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

test('Update Shopping puts a rescaled Meal on Shopping at its new amount', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Tomato Pasta',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: { name: 'pasta', amount: '200', unit: 'g', order: 0 },
			},
		},
	})
	const plan = await prisma.mealPlan.create({
		data: { householdId: user.householdId, weekStart: new Date('2026-10-19') },
	})
	const meal = await prisma.meal.create({
		data: {
			mealPlanId: plan.id,
			date: new Date('2026-10-21'),
			order: 0,
			recipeItems: {
				create: { recipeId: recipe.id, recipeTitle: recipe.title, order: 0 },
			},
		},
		include: { recipeItems: true },
	})
	const readPasta = () =>
		prisma.shoppingListItem.findFirstOrThrow({
			where: { list: { householdId: user.householdId }, name: 'pasta' },
		})

	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/plan?weekStart=2026-10-19')
	const card = page
		.getByTestId('mobile-plan')
		.locator(`[data-meal-id="${meal.id}"]`)
	const mealActions = card.getByRole('button', {
		name: 'Meal actions for Tomato Pasta',
	})
	async function chooseMenuItem(name: string) {
		await expect(async () => {
			await mealActions.click()
			await expect(
				page.getByRole('menuitem', { name, exact: true }),
			).toBeVisible({ timeout: 2000 })
		}).toPass()
		await page.getByRole('menuitem', { name, exact: true }).click()
	}

	await chooseMenuItem('Add to Shopping')
	await expect(page.getByText('Added 1 item to Shopping')).toBeVisible()
	expect(await readPasta()).toMatchObject({ quantity: '200', unit: 'g' })
	// The closed menu hands focus back to its trigger; reopening before then
	// lets that late focus close the new menu as a click outside.
	await expect(mealActions).toBeFocused()

	await card.getByLabel('Scale multiplier').fill('2')
	await card.getByLabel('Scale multiplier').press('Enter')
	await expect
		.poll(async () => {
			const item = await prisma.mealRecipeItem.findUniqueOrThrow({
				where: { id: meal.recipeItems[0]!.id },
			})
			return item.scaleMultiplier
		})
		.toBe(2)
	// Rescaling alone leaves Shopping as it was.
	expect(await readPasta()).toMatchObject({ quantity: '200', unit: 'g' })

	await chooseMenuItem('Update Shopping')
	await expect(page.getByText('Shopping updated')).toBeVisible()
	expect(await readPasta()).toMatchObject({ quantity: '400', unit: 'g' })

	await page.goto('/shopping')
	await expect(page.getByLabel('pasta shopping item')).toContainText('400 g')
})

test('Meal plan: view Meals, add one fast, and mark as cooked', async ({
	page,
	login,
}) => {
	const user = await login()

	// Create recipes via DB
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Test Stir Fry',
			userId: user.id,
			householdId: user.householdId,
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
			householdId: user.householdId,
		},
	})
	const menuRecipe = await prisma.recipe.create({
		data: {
			title: 'Garlic Flatbread',
			userId: user.id,
			householdId: user.householdId,
		},
	})
	const menu = await prisma.menu.create({
		data: {
			title: 'Friday Supper',
			titleKey: menuTitleKey('Friday Supper'),
			defaultGuestCount: 4,
			householdId: user.householdId,
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
			householdId: user.householdId,
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
	await expect(
		page.getByRole('heading', { level: 1, name: 'Plan', exact: true }),
	).toBeVisible()
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
	await expect(
		desktopPlan.getByRole('button', { name: 'Add Recipe to Test Stir Fry' }),
	).toBeVisible()
	await expect(page.getByRole('button', { name: /copy week/i })).toHaveCount(0)
	await expect(
		page.getByRole('button', { name: /suggest meals/i }),
	).toHaveCount(0)

	// An empty day stacks its Add Meal link under "Nothing planned", like a
	// day with Meals puts it on its own row.
	const emptyDay = desktopPlan
		.getByRole('button', { name: /^Add Meal to/ })
		.filter({ hasText: 'Nothing planned' })
		.first()
	const nothingPlannedBox = await emptyDay
		.getByText('Nothing planned', { exact: true })
		.boundingBox()
	const emptyDayAddBox = await emptyDay
		.getByText('Add Meal', { exact: true })
		.boundingBox()
	expect(nothingPlannedBox).not.toBeNull()
	expect(emptyDayAddBox).not.toBeNull()
	expect(emptyDayAddBox!.y).toBeGreaterThan(
		nothingPlannedBox!.y + nothingPlannedBox!.height / 2,
	)

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
					mealPlan: { householdId: user.householdId },
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
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Miso Soup',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: { name: 'miso', amount: '2', unit: 'tbsp', order: 0 },
			},
		},
	})

	// Plan it once at 1× from the Recipe page — the picker opens on Today
	// Dinner, which is the ordinary one-tap add.
	await page.goto(`/recipes/${recipe.id}`)
	await page.getByRole('button', { name: 'Add to Plan' }).click()
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Add to Plan' })
		.click()
	await expect(page.getByText('Added to Today Dinner')).toBeVisible()

	// Submitting the same Recipe at 3× leaves the planned Meal alone.
	await page.goto(`/recipes/${recipe.id}?scale=3`)
	await page.getByRole('button', { name: 'Add to Plan' }).click()
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Add to Plan' })
		.click()
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
			where: { meal: { mealPlan: { householdId: user.householdId } } },
			select: { scaleMultiplier: true },
		}),
	).toEqual([{ scaleMultiplier: 1 }])
})

test.describe('Plan quick-add failure', () => {
	// page.route cannot see requests a service worker answers.
	test.use({ serviceWorkers: 'block' })

	test('A Recipe the server fails to add is named in an error toast', async ({
		page,
		login,
	}) => {
		const user = await login()
		await prisma.recipe.create({
			data: {
				title: 'Herb Salad',
				userId: user.id,
				householdId: user.householdId,
			},
		})
		await page.route('**/plan.data*', (route) =>
			route.request().method() === 'POST'
				? route.fulfill({ status: 500, body: 'Unexpected Server Error' })
				: route.continue(),
		)

		await page.goto('/plan')
		const desktopPlan = page.getByTestId('desktop-plan')
		await expect(async () => {
			await desktopPlan
				.getByRole('button', { name: /add meal/i })
				.first()
				.click()
			await expect(
				page.getByPlaceholder('Search Recipes and Menus...').first(),
			).toBeVisible({ timeout: 2000 })
		}).toPass()
		await page.getByRole('button', { name: /herb salad/i }).click()

		// The picker still closes at once, and the failure follows as a toast.
		await expect(
			page.getByPlaceholder('Search Recipes and Menus...'),
		).toHaveCount(0)
		const announcements = page.getByRole('region', { name: /Notifications/ })
		await expect(
			announcements.getByText('Could not add Herb Salad to Plan'),
		).toBeVisible()
		await expect(
			page.getByRole('heading', { level: 1, name: 'Plan', exact: true }),
		).toBeVisible()
		await expect(
			desktopPlan.getByText('Herb Salad', { exact: true }),
		).toHaveCount(0)
		expect(
			await prisma.meal.count({
				where: { mealPlan: { householdId: user.householdId } },
			}),
		).toBe(0)
	})

	test('A Recipe page add the server fails says so and keeps the page', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Miso Soup',
				userId: user.id,
				householdId: user.householdId,
			},
		})
		await page.route('**/plan.data*', (route) =>
			route.request().method() === 'POST'
				? route.fulfill({ status: 500, body: 'Unexpected Server Error' })
				: route.continue(),
		)

		await page.goto(`/recipes/${recipe.id}`)
		await page.getByRole('button', { name: 'Add to Plan' }).click()
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Add to Plan' })
			.click()
		const announcements = page.getByRole('region', { name: /Notifications/ })
		await expect(
			announcements.getByText('Could not add Miso Soup to Plan'),
		).toBeVisible()
		await expect(page.getByRole('heading', { name: 'Miso Soup' })).toBeVisible()
		expect(
			await prisma.meal.count({
				where: { mealPlan: { householdId: user.householdId } },
			}),
		).toBe(0)
	})
})

test('Narrowing the phone Plan picker keeps the page height, so the input stays above the keyboard', async ({
	page,
	login,
}) => {
	await page.setViewportSize({ width: 390, height: 844 })
	const user = await login()
	// Enough Recipes to overflow the picker's 300px list, the case where a
	// narrowing search shrinks the page the most.
	const titles = [
		'Anchor Pasta',
		'Barley Soup',
		'Coq au Vin',
		'Crisp Salad',
		'Dal Makhani',
		'Fish Tacos',
		'Garlic Flatbread',
		'Herb Omelette',
	]
	const recipes = await Promise.all(
		titles.map((title) =>
			prisma.recipe.create({
				data: { title, userId: user.id, householdId: user.householdId },
			}),
		),
	)
	const coqAuVin = recipes.find((recipe) => recipe.title === 'Coq au Vin')!

	await page.goto('/plan')
	const mobile = page.getByTestId('mobile-plan')
	const composer = mobile.getByRole('region', { name: /^Add Meal for/ })
	await expect(async () => {
		if (!(await composer.isVisible())) {
			await mobile.getByRole('button', { name: /^Add Meal to/ }).click()
		}
		await expect(composer).toBeVisible({ timeout: 1000 })
	}).toPass()
	const search = composer.getByPlaceholder('Search Recipes and Menus...')
	await expect(search).toBeVisible()
	await expect(
		composer.getByRole('button', { name: /Herb Omelette/ }),
	).toBeVisible()
	// The composer slides in over 280ms; take the baseline once it has settled.
	await composer.evaluate((section) =>
		Promise.all(
			section
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished),
		).then(() => undefined),
	)
	await page.evaluate(() => document.fonts.ready.then(() => undefined))
	const pageHeight = () =>
		page.evaluate(() => document.documentElement.scrollHeight)
	const searchBox = async () => {
		const box = await search.boundingBox()
		return (
			box && {
				x: Math.round(box.x),
				y: Math.round(box.y),
				width: Math.round(box.width),
				height: Math.round(box.height),
			}
		)
	}
	const openedHeight = await pageHeight()
	const openedSearchBox = await searchBox()

	// Playwright has no phone keyboard, so the test holds the invariant iOS
	// Safari needs: while the results narrow, the page keeps its height and
	// the input stays where the keyboard was raised around it. A shorter page
	// makes iOS clamp its scroll and drop the input behind the keyboard.
	await search.fill('coq')
	await expect(
		composer.getByRole('button', { name: /Coq au Vin/ }),
	).toBeVisible()
	await expect(
		composer.getByRole('button', { name: /Herb Omelette/ }),
	).toHaveCount(0)
	expect(await pageHeight()).toBe(openedHeight)
	expect(await searchBox()).toEqual(openedSearchBox)

	await search.fill('zzzz')
	await expect(composer.getByText('No Recipes or Menus found')).toBeVisible()
	expect(await pageHeight()).toBe(openedHeight)
	expect(await searchBox()).toEqual(openedSearchBox)

	await search.fill('coq')
	await composer.getByRole('button', { name: /Coq au Vin/ }).click()
	await expect(mobile.getByText('Coq au Vin', { exact: true })).toBeVisible()
	await expect
		.poll(() =>
			prisma.meal.count({
				where: {
					mealPlan: { householdId: user.householdId },
					recipeItems: { some: { recipeId: coqAuVin.id } },
				},
			}),
		)
		.toBe(1)
})

test.describe('Picked day', () => {
	// page.route cannot see requests a service worker answers.
	test.use({ serviceWorkers: 'block' })

	// A past week, so today is never in it and Plan opens on its first day
	// with Meals.
	const weekStart = addDaysUTC(getCurrentWeekStart(), -14)
	const [, tuesday, wednesday, thursday] = getWeekDays(weekStart) as [
		Date,
		Date,
		Date,
		Date,
	]
	const weekUrl = `/plan?weekStart=${serializeDate(weekStart)}`
	const dayUrl = (date: Date) => `${weekUrl}&day=${serializeDate(date)}`

	function dayButton(page: Page, date: Date) {
		return page.getByTestId('mobile-plan').getByRole('button', {
			name: new RegExp(
				`^Show ${formatWeekdayName(date)}, ${formatMonthDay(date)},`,
			),
		})
	}

	async function seedWeek(userId: string, householdId: string) {
		const [soup, risotto] = await Promise.all(
			['Lentil Soup', 'Pea Risotto'].map((title) =>
				prisma.recipe.create({ data: { title, userId, householdId } }),
			),
		)
		return prisma.mealPlan.create({
			data: {
				householdId,
				weekStart,
				meals: {
					create: [
						{ date: tuesday, recipe: soup! },
						{ date: thursday, recipe: risotto! },
					].map(({ date, recipe }) => ({
						date,
						order: 0,
						recipeItems: {
							create: {
								recipeId: recipe.id,
								recipeTitle: recipe.title,
								order: 0,
							},
						},
					})),
				},
			},
		})
	}

	/**
	 * Holds Plan's own .data requests until `release`, noting where the page
	 * was and what it showed when each left. Root's pass: single fetch reloads
	 * root before a back navigation shows the page.
	 */
	async function holdPlanData(page: Page) {
		let release = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const requests: Array<{ href: string; heading: string | null }> = []
		await page.route('**/plan.data*', async (route) => {
			const { searchParams } = new URL(route.request().url())
			if (
				!(searchParams.get('_routes') ?? '')
					.split(',')
					.includes('routes/plan/index')
			) {
				return route.continue()
			}
			requests.push(
				await page.evaluate(() => ({
					href: window.location.pathname + window.location.search,
					heading:
						document.querySelector('[data-testid="mobile-plan"] h2')
							?.textContent ?? null,
				})),
			)
			await gate
			// A navigation may have aborted the request meanwhile.
			await route.continue().catch(() => {})
		})
		return { requests, release }
	}

	/** Taps a day, retrying until the page has hydrated and takes the tap. */
	async function tapDay(page: Page, date: Date) {
		await expect(async () => {
			await dayButton(page, date).click()
			await expect(dayButton(page, date)).toHaveAttribute(
				'aria-pressed',
				'true',
				{ timeout: 1000 },
			)
		}).toPass()
	}

	test('The phone Plan keeps the picked day through a Recipe visit and a reload, without reloading the week', async ({
		page,
		login,
	}) => {
		const user = await login()
		const plan = await seedWeek(user.id, user.householdId)
		const mobile = page.getByTestId('mobile-plan')
		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto(weekUrl)
		await expect(
			mobile.getByRole('heading', { name: formatMonthDay(tuesday) }),
		).toBeVisible()

		const loaderRequests: string[] = []
		page.on('request', (request) => {
			if (new URL(request.url()).pathname.endsWith('.data')) {
				loaderRequests.push(request.url())
			}
		})
		const historyLength = await page.evaluate(() => history.length)
		await tapDay(page, thursday)
		await expect(page).toHaveURL(dayUrl(thursday))
		await expect(
			mobile.getByRole('heading', { name: formatMonthDay(thursday) }),
		).toBeVisible()
		// The router runs loaders before it commits the URL, so any reload of
		// the week would have been requested by now. The tap replaced the entry.
		expect(loaderRequests).toEqual([])
		expect(await page.evaluate(() => history.length)).toBe(historyLength)
		// Tapping the picked day again is not a reload either. The next tap's
		// URL change shows the router has handled it.
		await dayButton(page, thursday).click()
		await dayButton(page, wednesday).click()
		await expect(page).toHaveURL(dayUrl(wednesday))
		await dayButton(page, thursday).click()
		await expect(page).toHaveURL(dayUrl(thursday))
		expect(loaderRequests).toEqual([])
		expect(await page.evaluate(() => history.length)).toBe(historyLength)

		await mobile.getByRole('link', { name: 'Pea Risotto', exact: true }).click()
		await expect(page).toHaveURL(/\/recipes\//)

		// Someone plans leftovers for Thursday while the Recipe is open.
		await prisma.meal.create({
			data: {
				mealPlanId: plan.id,
				date: thursday,
				order: 1,
				genericText: 'Leftovers',
			},
		})
		const held = await holdPlanData(page)

		// Back shows the week from memory on the picked day at once; the one
		// Plan request is the revalidation behind it.
		await page.goBack()
		await expect(page).toHaveURL(dayUrl(thursday))
		await expect(dayButton(page, thursday)).toHaveAttribute(
			'aria-pressed',
			'true',
		)
		await expect(
			mobile.getByRole('link', { name: 'Pea Risotto', exact: true }),
		).toBeVisible()
		await expect(mobile.getByText('Leftovers')).toHaveCount(0)
		await expect.poll(() => held.requests.length).toBe(1)
		expect(held.requests[0]).toEqual({
			href: dayUrl(thursday),
			heading: formatMonthDay(thursday),
		})
		held.release()
		await expect(mobile.getByText('Leftovers')).toBeVisible()
		await expect(dayButton(page, thursday)).toHaveAttribute(
			'aria-pressed',
			'true',
		)
		await page.unroute('**/plan.data*')

		await page.reload()
		await expect(dayButton(page, thursday)).toHaveAttribute(
			'aria-pressed',
			'true',
		)
		await expect(
			mobile.getByRole('heading', { name: formatMonthDay(thursday) }),
		).toBeVisible()
		await expect(
			mobile.getByRole('link', { name: 'Lentil Soup', exact: true }),
		).toHaveCount(0)
	})

	test('A day tap during the revalidation behind a remembered Plan still brings the fresh week', async ({
		page,
		login,
	}) => {
		const user = await login()
		const plan = await seedWeek(user.id, user.householdId)
		const mobile = page.getByTestId('mobile-plan')
		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto(weekUrl)
		await tapDay(page, thursday)
		await mobile.getByRole('link', { name: 'Pea Risotto', exact: true }).click()
		await expect(page).toHaveURL(/\/recipes\//)

		await prisma.meal.create({
			data: {
				mealPlanId: plan.id,
				date: wednesday,
				order: 0,
				genericText: 'Leftovers',
			},
		})
		const held = await holdPlanData(page)
		await page.goBack()
		await expect(
			mobile.getByRole('link', { name: 'Pea Risotto', exact: true }),
		).toBeVisible()
		await expect.poll(() => held.requests.length).toBe(1)

		// The tap is a navigation: it aborts the held revalidation and loads
		// nothing itself, so the page asks again.
		await dayButton(page, wednesday).click()
		await expect(page).toHaveURL(dayUrl(wednesday))
		await expect.poll(() => held.requests.length).toBe(2)
		expect(held.requests[1]).toEqual({
			href: dayUrl(wednesday),
			heading: formatMonthDay(wednesday),
		})
		held.release()
		await expect(mobile.getByText('Leftovers')).toBeVisible()
		await expect(dayButton(page, wednesday)).toHaveAttribute(
			'aria-pressed',
			'true',
		)
	})
})
