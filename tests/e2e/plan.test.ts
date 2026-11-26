import { type Locator, type Page } from '@playwright/test'
import {
	addDaysUTC,
	formatMonthDay,
	formatWeekdayName,
	formatWeekRange,
	getWeekDays,
	getWeekStart,
	isToday,
	parseDate,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { menuTitleKey } from '#app/utils/menu-validation.ts'
import { SHELL_UA, setShellSafeArea } from '#tests/native-shell.ts'
import {
	animationsFinished,
	browserToday,
	expect,
	expectThumbSized,
	expectThumbTall,
	hydrated,
	tapUntil,
	test,
} from '#tests/playwright-utils.ts'

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
		// Cooked after its Shopping was added, since a cooked item adds
		// nothing. The move must keep the cooked state too.
		await prisma.mealRecipeItem.updateMany({
			where: { mealId: meal.id },
			data: { cooked: true },
		})
		const recipeItems = await prisma.mealRecipeItem.findMany({
			where: { mealId: meal.id },
		})

		// The closed menu hands focus back to its trigger; reopening before then
		// lets that late focus close the new menu as a click outside.
		await expect(mealActions).toBeFocused()
		await mealActions.click()
		await page.getByRole('menuitem', { name: 'Edit details' }).click()
		// On a phone Edit details is a sheet over the Plan.
		const details = page.getByRole('dialog', { name: 'Edit details' })
		await expect(details.getByLabel('Date', { exact: true })).toHaveValue(
			'2026-10-23',
		)
		await expect(details.getByLabel('Serving time')).toHaveValue('18:30')
		await details.getByLabel('Date', { exact: true }).fill('2026-10-30')
		await details.getByLabel('Guests').fill('4')
		await details.getByRole('button', { name: 'Save', exact: true }).click()
		await expect(details).toBeHidden()
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
			movedCard.getByRole('button', { name: 'Mark Lemon Pasta not cooked' }),
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
			recipeItems,
		})
		expect(await readShopping()).toEqual(shopping)
		await page.reload()
		await expect(movedCard).toBeVisible()
		// Hydration focuses the linked card and scrolls it to the middle; wait
		// for that, or the scroll can move the page under the click below.
		await expect(movedCard).toBeFocused()
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

	// Seed one planned Meal in the database. The planner reads Meal parents.
	const weekStart = getWeekStart(browserToday())
	const weekDays = getWeekDays(weekStart)
	const plannedDay =
		weekDays.find((date) => isToday(date, serializeDate(browserToday()))) ??
		weekDays[0]!
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
				.getByText(
					isToday(date, serializeDate(browserToday()))
						? 'Today'
						: formatWeekdayName(date),
					{
						exact: true,
					},
				)
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
			page.getByPlaceholder('Search Recipes and Menus…').first(),
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
	const planSearch = page.getByPlaceholder('Search Recipes and Menus…').first()
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
		.getByRole('button', { name: 'Mark Test Stir Fry cooked' })
		.click()

	// 6. Verify cooked state (toggle label flips optimistically)
	await expect(
		desktopPlan.getByRole('button', {
			name: 'Mark Test Stir Fry not cooked',
		}),
	).toBeVisible()

	// 7. Reload to confirm the state persisted — the optimistic flip above
	// would pass even if the server action failed
	await page.reload()
	await expect(
		desktopPlan.getByRole('button', {
			name: 'Mark Test Stir Fry not cooked',
		}),
	).toBeVisible()

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)
		if (viewport.width === 390) {
			const mobileDayButtonLocator = page
				.locator('[data-slot="mobile-week-days"]')
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

// Adding a Recipe that is already planned must report the Meal that
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
				page.getByPlaceholder('Search Recipes and Menus…').first(),
			).toBeVisible({ timeout: 2000 })
		}).toPass()
		await page.getByRole('button', { name: /herb salad/i }).click()

		// The picker still closes at once, and the failure follows as a toast.
		await expect(
			page.getByPlaceholder('Search Recipes and Menus…'),
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

test('Narrowing the phone Plan picker keeps the sheet height, so the input stays above the keyboard', async ({
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
	// On a phone the composer is a sheet over the page.
	const composer = page.getByRole('dialog', { name: 'Add Meal' })
	await expect(async () => {
		if (!(await composer.isVisible())) {
			await page.getByRole('button', { name: /^Add Meal to/ }).click()
		}
		await expect(composer).toBeVisible({ timeout: 1000 })
	}).toPass()
	const search = composer.getByPlaceholder('Search Recipes and Menus…')
	await expect(search).toBeVisible()
	await expect(
		composer.getByRole('button', { name: /Herb Omelette/ }),
	).toBeVisible()
	// The sheet slides up; take the baseline once it has settled.
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
	const sheetHeight = async () =>
		Math.round((await composer.boundingBox())!.height)
	const openedHeight = await pageHeight()
	const openedSheetHeight = await sheetHeight()
	const openedSearchBox = await searchBox()

	// Playwright has no phone keyboard, so the test holds the invariant iOS
	// Safari needs: while the results narrow, the sheet keeps its height and
	// the input stays where the keyboard was raised around it. A shorter
	// sheet drops the input down behind the keyboard.
	await search.fill('coq')
	await expect(
		composer.getByRole('button', { name: /Coq au Vin/ }),
	).toBeVisible()
	await expect(
		composer.getByRole('button', { name: /Herb Omelette/ }),
	).toHaveCount(0)
	expect(await pageHeight()).toBe(openedHeight)
	expect(await sheetHeight()).toBe(openedSheetHeight)
	expect(await searchBox()).toEqual(openedSearchBox)

	await search.fill('zzzz')
	await expect(composer.getByText('No Recipes or Menus found')).toBeVisible()
	expect(await pageHeight()).toBe(openedHeight)
	expect(await sheetHeight()).toBe(openedSheetHeight)
	expect(await searchBox()).toEqual(openedSearchBox)

	await search.fill('coq')
	await composer.getByRole('button', { name: /Coq au Vin/ }).click()
	await expect(composer).toBeHidden()
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
	const weekStart = addDaysUTC(getWeekStart(browserToday()), -14)
	const [, tuesday, wednesday, thursday] = getWeekDays(weekStart) as [
		Date,
		Date,
		Date,
		Date,
	]
	const weekUrl = `/plan?weekStart=${serializeDate(weekStart)}`
	const dayUrl = (date: Date) => `${weekUrl}&day=${serializeDate(date)}`

	function dayButton(page: Page, date: Date) {
		return page.locator('[data-slot="mobile-week-days"]').getByRole('button', {
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

/** "Thursday, Nov 19", as the Plan names a day. */
function dayName(date: Date) {
	return `${formatWeekdayName(date)}, ${formatMonthDay(date)}`
}

/**
 * Drags one finger across a locator's middle, from `fromX` to `toX` (as
 * fractions of its width), moving `dy` px down on the way. CDP touch events
 * arrive ~40ms apart, so a few big moves make the drag.
 */
async function drag(
	page: Page,
	target: Locator,
	{ fromX, toX, dy = 0 }: { fromX: number; toX: number; dy?: number },
) {
	const box = (await target.boundingBox())!
	const y = box.y + box.height / 2
	const cdp = await page.context().newCDPSession(page)
	const steps = 6
	const point = (i: number) => [
		{
			x: box.x + box.width * (fromX + ((toX - fromX) * i) / steps),
			y: y + (dy * i) / steps,
			id: 1,
		},
	]
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: point(0),
	})
	for (let i = 1; i <= steps; i++) {
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: point(i),
		})
		await page.waitForTimeout(30)
	}
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	})
	await cdp.detach()
}

/**
 * How far a control's tap area reaches, probed with elementFromPoint along
 * the lines through its drawn middle: the height and width over which a
 * finger still lands on it, and the rectangle that spans.
 */
async function hitArea(control: Locator) {
	return control.evaluate((element) => {
		const box = element.getBoundingClientRect()
		const cx = box.left + box.width / 2
		const cy = box.top + box.height / 2
		const lands = (x: number, y: number) => {
			const hit = document.elementFromPoint(x, y)
			if (!hit) return false
			// A tap on a control's label is the control's.
			const owner =
				hit === element ||
				element.contains(hit) ||
				(hit instanceof HTMLLabelElement && hit.control === element) ||
				hit.contains(element)
			return owner && hit.closest('a, button, label, input') != null
		}
		let top = cy
		while (lands(cx, top - 1)) top--
		let bottom = cy
		while (lands(cx, bottom + 1)) bottom++
		let left = cx
		while (lands(left - 1, cy)) left--
		let right = cx
		while (lands(right + 1, cy)) right++
		return {
			top,
			bottom,
			left,
			right,
			height: bottom - top + 1,
			width: right - left + 1,
		}
	})
}

async function box(locator: Locator) {
	await expect(locator).toBeVisible()
	const rect = (await locator.boundingBox())!
	return {
		left: Math.round(rect.x),
		right: Math.round(rect.x + rect.width),
		top: Math.round(rect.y),
		bottom: Math.round(rect.y + rect.height),
	}
}

/**
 * Fourteen one-dish Dinners, "Dish 1" to "Dish 14", on the Monday of last
 * week, a day far taller than the screen. Returns that week's start.
 */
async function seedLongDay(user: { id: string; householdId: string }) {
	const weekStart = addDaysUTC(getWeekStart(browserToday()), -7)
	const recipes = await Promise.all(
		Array.from({ length: 14 }, (_, index) =>
			prisma.recipe.create({
				data: {
					title: `Dish ${index + 1}`,
					userId: user.id,
					householdId: user.householdId,
				},
			}),
		),
	)
	await prisma.mealPlan.create({
		data: {
			householdId: user.householdId,
			weekStart,
			meals: {
				create: recipes.map((recipe, order) => ({
					date: weekStart,
					order,
					label: 'dinner',
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
	return weekStart
}

/** Waits for the offline notice to settle, and returns its box. */
async function offlineNotice(page: Page) {
	const notice = page
		.locator('[data-sonner-toast]')
		.filter({ hasText: "You're offline" })
	await expect(notice).toBeVisible()
	await animationsFinished(page)
	return box(notice)
}

/** Within a pixel: glyph boxes land on half pixels. */
function expectNear(actual: number, expected: number) {
	expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1)
}

/** The seeded week, named: bare /plan picks its week by the UTC date. */
function planWeek(today: Date) {
	return `/plan?weekStart=${serializeDate(getWeekStart(today))}`
}

test.describe('in the iOS app on a phone', () => {
	test.use({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		userAgent: SHELL_UA,
	})

	test('Recipes, Staples and Plan put one + beside the title; Plan’s adds a Meal to the day showing', async ({
		page,
		login,
	}) => {
		const user = await login()
		await prisma.recipe.create({
			data: {
				title: 'Miso Soup',
				userId: user.id,
				householdId: user.householdId,
			},
		})

		type Look = {
			width: number
			height: number
			rightGap: number
			afterTitle: boolean
			centerOffset: number
		}
		async function titlePlus(path: string, name: string | RegExp) {
			await page.goto(path)
			const plus = page.getByRole('button', { name })
			await expect(plus).toBeVisible()
			const h1 = page.getByRole('heading', { level: 1 })
			const titleBox = (await h1.boundingBox())!
			const box = (await plus.boundingBox())!
			return {
				width: box.width,
				height: box.height,
				// At the right end of the title's row, past the title.
				// The row is the title's closest ancestor that holds the + too
				// (Recipes' title sits in a nav of its two libraries).
				rightGap: await h1.evaluate(
					(title, plusElement) => {
						let row = title.parentElement!
						while (!row.contains(plusElement!)) row = row.parentElement!
						const padding = Number.parseFloat(
							getComputedStyle(row).paddingRight,
						)
						return Math.round(
							row.getBoundingClientRect().right -
								padding -
								plusElement!.getBoundingClientRect().right,
						)
					},
					await plus.elementHandle(),
				),
				afterTitle: box.x > titleBox.x + titleBox.width,
				centerOffset: Math.round(
					Math.abs(box.y + box.height / 2 - (titleBox.y + titleBox.height / 2)),
				),
			} satisfies Look
		}

		const recipes = await titlePlus('/recipes', 'New Recipe')
		const staples = await titlePlus('/staples', 'Add Staple')
		const plan = await titlePlus('/plan', /^Add Meal to /)
		expect(recipes).toMatchObject({
			width: 44,
			height: 44,
			rightGap: 0,
			afterTitle: true,
			centerOffset: 0,
		})
		expect(staples).toEqual(recipes)
		expect(plan).toEqual(recipes)

		// Plan's + follows the day showing: pick a day that is neither today
		// (shown first) nor the first of the week.
		const today = browserToday()
		const weekStart = getWeekStart(today)
		const other =
			serializeDate(today) === serializeDate(addDaysUTC(weekStart, 2))
				? addDaysUTC(weekStart, 3)
				: addDaysUTC(weekStart, 2)
		const otherName = dayName(other)
		await page
			.getByRole('button', { name: new RegExp(`^Show ${otherName}`) })
			.tap()
		const plus = page.getByRole('button', { name: `Add Meal to ${otherName}` })
		await expect(plus).toBeVisible()
		// The title's + is the one named for the day; the day's own Add Meal
		// is named by what it shows.
		await expect(
			page.getByRole('button', { name: /^Add Meal to/ }),
		).toHaveCount(1)
		await expect(
			page
				.getByTestId('mobile-plan')
				.getByRole('button', { name: 'Add Meal', exact: true }),
		).toBeVisible()

		// The empty day points at the +.
		await expect(
			page.getByText('Tap + to plan a Recipe, Menu, or note.'),
		).toBeVisible()

		await plus.tap()
		const sheet = page.getByRole('dialog', { name: 'Add Meal' })
		await expect(sheet).toBeVisible()
		await sheet.getByRole('button', { name: /Miso Soup/ }).tap()
		await expect(sheet).toBeHidden()
		await expect(
			page.getByTestId('mobile-plan').getByRole('link', { name: 'Miso Soup' }),
		).toBeVisible()
		await expect
			.poll(() =>
				prisma.meal.findMany({
					where: { mealPlan: { householdId: user.householdId } },
					select: {
						date: true,
						recipeItems: { select: { recipeTitle: true } },
					},
				}),
			)
			.toEqual([{ date: other, recipeItems: [{ recipeTitle: 'Miso Soup' }] }])
	})

	test('after a week swipe, Plan’s + adds to the day showing in the new week', async ({
		page,
		login,
	}) => {
		const user = await login()
		await prisma.recipe.create({
			data: {
				title: 'Miso Soup',
				userId: user.id,
				householdId: user.householdId,
			},
		})
		const weekStart = getWeekStart(browserToday())
		const nextWeek = addDaysUTC(weekStart, 7)
		await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
		const strip = page.locator('[data-slot="mobile-week-days"]')
		await hydrated(strip)
		await drag(page, strip, { fromX: 0.8, toX: 0.2 })
		await expect(page).toHaveURL(
			new RegExp(`weekStart=${serializeDate(nextWeek)}`),
		)

		// Not the week's first day, so a + stuck on a default day shows.
		const wednesday = addDaysUTC(nextWeek, 2)
		await page
			.getByRole('button', { name: new RegExp(`^Show ${dayName(wednesday)}`) })
			.tap()
		const plus = page.getByRole('button', {
			name: `Add Meal to ${dayName(wednesday)}`,
		})
		await expect(plus).toBeVisible()
		await expect(
			page.getByRole('button', { name: /^Add Meal to/ }),
		).toHaveCount(1)
		await plus.tap()
		const sheet = page.getByRole('dialog', { name: 'Add Meal' })
		await expect(sheet).toBeVisible()
		await sheet.getByRole('button', { name: /Miso Soup/ }).tap()
		await expect(sheet).toBeHidden()
		await expect
			.poll(() =>
				prisma.meal.findMany({
					where: { mealPlan: { householdId: user.householdId } },
					select: { date: true },
				}),
			)
			.toEqual([{ date: wednesday }])
	})

	test('a Plan Meal’s Recipe link and scale field each take a 44px tap area, side by side', async ({
		page,
		login,
	}) => {
		const user = await login()
		const [miso, rice] = await Promise.all(
			['Miso Soup', 'Steamed Rice'].map((title) =>
				prisma.recipe.create({
					data: { title, userId: user.id, householdId: user.householdId },
				}),
			),
		)
		const today = browserToday()
		const weekStart = getWeekStart(today)
		await prisma.mealPlan.create({
			data: {
				householdId: user.householdId,
				weekStart,
				meals: {
					create: {
						date: today,
						order: 0,
						label: 'dinner',
						recipeItems: {
							create: [
								{ recipeId: miso!.id, recipeTitle: miso!.title, order: 0 },
								{ recipeId: rice!.id, recipeTitle: rice!.title, order: 1 },
							],
						},
					},
				},
			},
		})
		await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
		const mobile = page.getByTestId('mobile-plan')
		const links = mobile.getByRole('link', { name: /Miso Soup|Steamed Rice/ })
		const scales = mobile.getByRole('textbox', { name: 'Scale multiplier' })
		await expect(links).toHaveCount(2)
		await expect(scales).toHaveCount(2)
		// Measured in the serif, which sets the rows' heights.
		await hydrated(scales.nth(0))
		await page.evaluate(() => document.fonts.ready)

		const areas = []
		for (const i of [0, 1]) {
			const link = await hitArea(links.nth(i))
			const scale = await hitArea(scales.nth(i))
			expect(link.height).toBeGreaterThanOrEqual(44)
			expect(link.width).toBeGreaterThanOrEqual(44)
			expect(scale.height).toBeGreaterThanOrEqual(44)
			expect(scale.width).toBeGreaterThanOrEqual(44)
			areas.push(link, scale)
		}
		// No two tap areas overlap, within a Recipe or across the two.
		for (const [i, a] of areas.entries()) {
			for (const b of areas.slice(i + 1)) {
				const overlap =
					a.left <= b.right &&
					b.left <= a.right &&
					a.top <= b.bottom &&
					b.top <= a.bottom
				expect(overlap).toBe(false)
			}
		}
		// Each Recipe stays one 44px line.
		const rowHeight = await links
			.nth(0)
			.evaluate(
				(element) =>
					element.closest('.flex.items-center')!.getBoundingClientRect().height,
			)
		expect(rowHeight).toBeLessThanOrEqual(50)

		// A tap just under the drawn field still focuses it.
		const field = scales.nth(0)
		const box = (await field.boundingBox())!
		await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height + 6)
		await expect(field).toBeFocused()
		await field.blur()
		// A tap just above the drawn link text, inside its area, opens the Recipe.
		const misoLink = links.nth(0)
		const text = (await misoLink.locator('span').boundingBox())!
		await page.touchscreen.tap(text.x + 4, text.y - 8)
		await expect(page).toHaveURL(new RegExp(`/recipes/${miso!.id}$`))
	})

	test('a long Recipe word wraps inside a Plan row, and a tap in the scale field edits it', async ({
		page,
		login,
	}) => {
		const user = await login()
		const titles = [
			'Rindfleischsuppeneinlage',
			'Donaudampfschifffahrtsgesellschaftskap',
		]
		const recipes = await Promise.all(
			titles.map((title) =>
				prisma.recipe.create({
					data: { title, userId: user.id, householdId: user.householdId },
				}),
			),
		)
		const today = browserToday()
		const weekStart = getWeekStart(today)
		await prisma.mealPlan.create({
			data: {
				householdId: user.householdId,
				weekStart,
				meals: {
					create: {
						date: today,
						order: 0,
						recipeItems: {
							create: recipes.map((recipe, order) => ({
								recipeId: recipe.id,
								recipeTitle: recipe.title,
								order,
								scaleMultiplier: order === 0 ? 12.5 : 1.5,
							})),
						},
					},
				},
			},
		})
		await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
		const mobile = page.getByTestId('mobile-plan')
		const scales = mobile.getByRole('textbox', { name: 'Scale multiplier' })
		await expect(scales).toHaveCount(2)
		await expect(scales.nth(0)).toHaveValue('12.5')

		// The page does not widen, and both fields stay on screen.
		const { scrollWidth, clientWidth } = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		}))
		expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
		for (const i of [0, 1]) {
			const box = (await scales.nth(i).boundingBox())!
			expect(box.x).toBeGreaterThanOrEqual(0)
			expect(box.x + box.width).toBeLessThanOrEqual(clientWidth)
		}

		// The field itself takes a tap in it, not the label's larger area.
		const field = scales.nth(0)
		const box = (await field.boundingBox())!
		const hits = await page.evaluate(
			(points) =>
				points.map(([x, y]) => document.elementFromPoint(x!, y!)?.tagName),
			[
				[box.x + box.width / 2, box.y + box.height / 2],
				[box.x + box.width - 3, box.y + box.height / 2],
			],
		)
		expect(hits).toEqual(['INPUT', 'INPUT'])
		// A tap at its right end puts the caret after the value, so Backspace
		// edits it.
		await page.touchscreen.tap(box.x + box.width - 3, box.y + box.height / 2)
		await expect(field).toBeFocused()
		await page.keyboard.press('Backspace')
		await expect(field).toHaveValue('12.')
	})

	test('the pinned title row and strip sit under the status bar inset while the day scrolls', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipes = await Promise.all(
			['Porridge', 'Miso Soup', 'Apple', 'Pasta alla Norma', 'Tea'].map(
				(title) =>
					prisma.recipe.create({
						data: { title, userId: user.id, householdId: user.householdId },
					}),
			),
		)
		const weekStart = addDaysUTC(getWeekStart(browserToday()), -7)
		await prisma.mealPlan.create({
			data: {
				householdId: user.householdId,
				weekStart,
				meals: {
					create: recipes.map((recipe, order) => ({
						date: weekStart,
						order,
						label: 'dinner',
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
		await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
		const header = page.locator('[data-plan-header]')
		await hydrated(header)
		// The app sets the inset on <html> before the first paint.
		await page.evaluate(() =>
			document.documentElement.style.setProperty('--qm-shell-safe-top', '47px'),
		)
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
		await expect
			.poll(() => page.evaluate(() => window.scrollY))
			.toBeGreaterThan(50)
		expect((await box(header)).top).toBe(47)
		expect((await box(page.locator('[data-status-bar-backdrop]'))).bottom).toBe(
			47,
		)
	})

	test('the offline notice opens below the pinned title row and strip, under the status bar inset', async ({
		page,
		login,
	}) => {
		const user = await login()
		const weekStart = await seedLongDay(user)
		await setShellSafeArea(page, { top: 47, bottom: 34 })
		await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
		const header = page.locator('[data-plan-header]')
		await hydrated(header)
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
		await expect
			.poll(() => page.evaluate(() => window.scrollY))
			.toBeGreaterThan(500)
		await page.context().setOffline(true)
		const notice = await offlineNotice(page)
		const pinned = await box(header)
		expect(pinned.top).toBe(47)
		expect(notice.top).toBeGreaterThanOrEqual(pinned.bottom)
	})
})

test.describe('with a keyboard', () => {
	test.use({
		viewport: { width: 1024, height: 768 },
		hasTouch: false,
		userAgent: undefined,
	})

	test('Next week keeps focus while the week turns', async ({
		page,
		login,
	}) => {
		await login()
		await page.goto('/plan')
		const next = page.getByRole('link', { name: 'Next week' })
		const weekStart = getWeekStart(browserToday())
		await next.focus()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(
			new RegExp(`weekStart=${serializeDate(addDaysUTC(weekStart, 7))}`),
		)
		await expect(next).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(
			new RegExp(`weekStart=${serializeDate(addDaysUTC(weekStart, 14))}`),
		)
		await expect(next).toBeFocused()
	})
})

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

	test('Add a meal names its label chips as Add to Plan does, at thumb size', async ({
		page,
		login,
	}) => {
		await login()
		await page.goto('/plan')
		const addMeal = page.getByRole('button', { name: /^Add Meal to/ }).first()
		await expectThumbTall(addMeal)
		const label = page
			.getByRole('dialog', { name: 'Add Meal' })
			.getByRole('group', { name: 'Label (optional)' })
		await tapUntil(addMeal, () => expect(label).toBeVisible({ timeout: 2000 }))
		const lunch = label.getByRole('button', { name: 'Lunch' })
		await expectThumbTall(lunch)
		await lunch.tap()
		await expect(lunch).toHaveAttribute('aria-pressed', 'true')
	})

	test('Plan turns the week with chevrons a thumb can hit', async ({
		page,
		login,
	}) => {
		await login()
		await page.goto('/plan')
		for (const name of ['Previous week', 'Next week']) {
			const control = page.getByRole('link', { name })
			await expectThumbSized(control)
			await expect(control.locator('use')).toHaveAttribute(
				'href',
				name === 'Previous week' ? /#chevron-left$/ : /#chevron-right$/,
			)
		}
	})

	// On a phone a Plan day's rows line up on the page's edges: the label and
	// the dish names start on the content edge, and the cooked circles and the
	// dots end on it. 44px tap areas reach into the gutter instead of pushing
	// the glyphs in.

	test('a Plan day lines its rows up on the page edges, with the cooked circles at the right', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = (title: string) =>
			prisma.recipe.create({
				data: { title, userId: user.id, householdId: user.householdId },
			})
		const [soup, rice, pasta] = [
			await recipe('Miso Soup'),
			await recipe('Steamed Rice'),
			await recipe('Pasta alla Norma'),
		]
		const today = browserToday()
		const plan = await prisma.mealPlan.create({
			data: { householdId: user.householdId, weekStart: getWeekStart(today) },
		})
		await prisma.meal.create({
			data: {
				mealPlanId: plan.id,
				date: today,
				order: 0,
				label: 'dinner',
				recipeItems: {
					create: [
						{ recipeId: soup.id, recipeTitle: soup.title, order: 0 },
						{ recipeId: rice.id, recipeTitle: rice.title, order: 1 },
					],
				},
			},
		})
		await prisma.meal.create({
			data: {
				mealPlanId: plan.id,
				date: today,
				order: 1,
				recipeItems: {
					create: { recipeId: pasta.id, recipeTitle: pasta.title, order: 0 },
				},
			},
		})

		await page.goto(planWeek(today))
		const mobile = page.getByTestId('mobile-plan')
		const heading = await box(
			page.getByRole('heading', { name: 'Plan', level: 1 }),
		)
		const add = await box(page.getByRole('button', { name: /^Add Meal to / }))
		const [left, right] = [heading.left, add.right]

		// Leading: the label and every dish name on the content edge.
		expectNear(
			(await box(mobile.getByText('Dinner', { exact: true }))).left,
			left,
		)
		for (const title of ['Miso Soup', 'Steamed Rice', 'Pasta alla Norma']) {
			expectNear(
				(await box(mobile.getByRole('link', { name: title }))).left,
				left,
			)
			// Trailing: each cooked circle ends on the content edge.
			const circle = mobile
				.getByRole('button', { name: `Mark ${title} cooked` })
				.locator('span')
				.first()
			expectNear((await box(circle)).right, right)
		}

		// The scale fields form one column, whether or not a dish has a trash.
		const fields = mobile.getByRole('textbox', { name: 'Scale multiplier' })
		await expect(fields).toHaveCount(3)
		const fieldEdges = await Promise.all(
			[0, 1, 2].map(async (index) => (await box(fields.nth(index))).right),
		)
		for (const edge of fieldEdges) expectNear(edge, fieldEdges[0]!)
		await expect(
			mobile.getByRole('button', { name: 'Remove Miso Soup from this Meal' }),
		).toBeVisible()
		await expect(
			mobile.getByRole('button', { name: /^Remove Pasta alla Norma/ }),
		).toHaveCount(0)

		// Each Meal's line ends with Add Recipe and the dots, whose glyph ends
		// on the content edge; a Meal with no label still has the line.
		for (const name of ['Dinner', 'Pasta alla Norma']) {
			const dots = mobile.getByRole('button', {
				name: `Meal actions for ${name}`,
			})
			const plus = mobile.getByRole('button', { name: `Add Recipe to ${name}` })
			expectNear((await box(dots.locator('svg'))).right, right)
			const [dotsBox, plusBox] = [await box(dots), await box(plus)]
			expect(plusBox.right).toBeLessThanOrEqual(dotsBox.left + 1)
			expectNear(plusBox.top, dotsBox.top)
			await expectThumbSized(dots)
			await expectThumbSized(plus)
		}
		const pastaLine = await box(
			mobile.getByRole('button', { name: 'Meal actions for Pasta alla Norma' }),
		)
		const pastaTitle = await box(
			mobile.getByRole('link', { name: 'Pasta alla Norma' }),
		)
		expect(pastaLine.bottom).toBeLessThanOrEqual(pastaTitle.top + 6)

		// Each Meal sits under a hairline, the first one too.
		const groups = mobile.locator('[data-slot="meal-group"]')
		await expect(groups).toHaveCount(2)
		for (const index of [0, 1]) {
			expect(
				await groups
					.nth(index)
					.evaluate((group) => getComputedStyle(group).borderTopWidth),
			).toBe('1px')
		}
	})

	test('a Dinner shows its first Recipe’s photo above its dishes, set larger', async ({
		page,
		login,
	}) => {
		const user = await login()
		const objectKey = 'users/fixture-user/recipes/fixture-recipe/images/0.png'
		const recipe = (title: string, photo: boolean) =>
			prisma.recipe.create({
				data: {
					title,
					userId: user.id,
					householdId: user.householdId,
					...(photo ? { image: { create: { objectKey } } } : {}),
				},
			})
		const roast = await recipe('Roast Chicken', true)
		const salad = await recipe('Green Salad', false)
		const shakshuka = await recipe('Shakshuka', true)
		const today = browserToday()
		const plan = await prisma.mealPlan.create({
			data: { householdId: user.householdId, weekStart: getWeekStart(today) },
		})
		const meal = (
			order: number,
			label: string,
			items: Array<{ id: string; title: string }>,
		) =>
			prisma.meal.create({
				data: {
					mealPlanId: plan.id,
					date: today,
					order,
					label,
					recipeItems: {
						create: items.map((item, index) => ({
							recipeId: item.id,
							recipeTitle: item.title,
							order: index,
						})),
					},
				},
			})
		await meal(0, 'lunch', [shakshuka])
		await meal(1, 'dinner', [roast, salad])

		await page.goto(planWeek(today))
		const mobile = page.getByTestId('mobile-plan')
		const dinner = mobile
			.locator('[data-meal-id]')
			.filter({ has: page.getByRole('link', { name: 'Roast Chicken' }) })
		const lunch = mobile
			.locator('[data-meal-id]')
			.filter({ has: page.getByRole('link', { name: 'Shakshuka' }) })

		const photo = dinner.locator('img')
		await expect(photo).toHaveCount(1)
		await expect(photo).toHaveAttribute('alt', '')
		await expect(photo).toHaveAttribute('src', /objectKey=users/)
		const photoBox = await box(photo)
		expect(photoBox.bottom - photoBox.top).toBe(152)
		const heading = await box(
			page.getByRole('heading', { name: 'Plan', level: 1 }),
		)
		const plus = await box(page.getByRole('button', { name: /^Add Meal to / }))
		expectNear(photoBox.left, heading.left)
		expectNear(photoBox.right, plus.right)
		// Above its dishes, which are set larger than another Meal's.
		const roastBox = await box(
			dinner.getByRole('link', { name: 'Roast Chicken' }),
		)
		expect(roastBox.top).toBeGreaterThanOrEqual(photoBox.bottom)
		// Compared, not named: the sizes are tokens in tailwind.css.
		const size = (locator: Locator) =>
			locator.evaluate((element) =>
				parseFloat(getComputedStyle(element.closest('h4')!).fontSize),
			)
		const plain = await size(lunch.getByRole('link', { name: 'Shakshuka' }))
		const withPhoto = await size(
			dinner.getByRole('link', { name: 'Roast Chicken' }),
		)
		expect(withPhoto).toBeGreaterThan(plain)
		expect(await size(dinner.getByRole('link', { name: 'Green Salad' }))).toBe(
			withPhoto,
		)
		// Only a Dinner shows one.
		await expect(lunch.locator('img')).toHaveCount(0)

		// Its first Recipe without a photo shows none, though the second has
		// one.
		await prisma.mealRecipeItem.updateMany({
			where: { recipeId: roast.id },
			data: { order: 1 },
		})
		await prisma.mealRecipeItem.updateMany({
			where: { recipeId: salad.id },
			data: { order: 0 },
		})
		await page.reload()
		await expect(
			dinner.getByRole('link', { name: 'Green Salad' }),
		).toBeVisible()
		await expect(dinner.locator('img')).toHaveCount(0)
		expect(await size(dinner.getByRole('link', { name: 'Green Salad' }))).toBe(
			plain,
		)
		// The desktop agenda shows no photos.
		await expect(page.getByTestId('desktop-plan').locator('img')).toHaveCount(0)
	})

	test('the Add Meal at the foot of the day adds a typed Meal to the day showing', async ({
		page,
		login,
	}) => {
		const user = await login()
		await page.goto('/plan?weekStart=2026-11-16&day=2026-11-18')
		const mobile = page.getByTestId('mobile-plan')
		await expect(
			mobile.getByText('Tap + to plan a Recipe, Menu, or note.'),
		).toBeVisible()
		const addMeal = mobile.getByRole('button', {
			name: 'Add Meal',
			exact: true,
		})
		await expectThumbTall(addMeal)
		const sheet = page.getByRole('dialog', { name: 'Add Meal' })
		await tapUntil(addMeal, () => expect(sheet).toBeVisible({ timeout: 2000 }))
		await expect(sheet.getByText('Wednesday · Nov 18')).toBeVisible()
		await sheet.getByRole('button', { name: 'Lunch' }).tap()
		await sheet.getByRole('button', { name: /^Add text instead/ }).tap()
		await sheet.getByRole('textbox', { name: 'Meal text' }).fill('Leftovers')
		await sheet.getByRole('button', { name: 'Add', exact: true }).tap()
		await expect(sheet).toBeHidden()

		// Typed Meals are upright, in muted text.
		const typed = mobile.getByText('Leftovers', { exact: true })
		await expect(typed).toBeVisible()
		expect(await typed.evaluate((el) => getComputedStyle(el).fontStyle)).toBe(
			'normal',
		)
		await expect(typed).toHaveCSS('color', 'rgb(105, 102, 94)')
		await expect(addMeal).toBeFocused()
		await expect
			.poll(() =>
				prisma.meal.findMany({
					where: { mealPlan: { householdId: user.householdId } },
					select: { date: true, label: true, genericText: true },
				}),
			)
			.toEqual([
				{
					date: parseDate('2026-11-18'),
					label: 'lunch',
					genericText: 'Leftovers',
				},
			])
	})

	test('the title row and the strip stay pinned while a long day scrolls', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipes = await Promise.all(
			['Porridge', 'Miso Soup', 'Apple', 'Pasta alla Norma', 'Tea'].map(
				(title) =>
					prisma.recipe.create({
						data: { title, userId: user.id, householdId: user.householdId },
					}),
			),
		)
		// Two long days in a past week, the first two.
		const weekStart = addDaysUTC(getWeekStart(browserToday()), -7)
		await prisma.mealPlan.create({
			data: {
				householdId: user.householdId,
				weekStart,
				meals: {
					create: [weekStart, addDaysUTC(weekStart, 1)].flatMap((date) =>
						recipes.map((recipe, order) => ({
							date,
							order,
							label: ['breakfast', 'lunch', 'snack', 'dinner', null][order],
							recipeItems: {
								create: {
									recipeId: recipe.id,
									recipeTitle: recipe.title,
									order: 0,
								},
							},
						})),
					),
				},
			},
		})
		await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
		const header = page.locator('[data-plan-header]')
		const strip = page.locator('[data-slot="mobile-week-days"]')
		// Before hydration the day is barely taller than the window, so a
		// scroll then stops short.
		await hydrated(header)
		const before = await box(header)
		expect(before.top).toBe(0)

		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
		await expect
			.poll(() => page.evaluate(() => window.scrollY))
			.toBeGreaterThan(50)
		expect(await box(header)).toEqual(before)
		await expect(strip).toBeInViewport()
		await expect(
			page.getByRole('heading', { name: 'Plan', level: 1 }),
		).toBeInViewport()

		// What the header and the tab bar leave for the day.
		const tabBar = await box(
			page.getByRole('navigation', { name: 'Main' }).last(),
		)
		expect(tabBar.top - before.bottom).toBeGreaterThanOrEqual(540)
		// The last Meal and the day's Add Meal clear the tab bar.
		const foot = await box(
			page
				.getByTestId('mobile-plan')
				.getByRole('button', { name: 'Add Meal', exact: true }),
		)
		expect(foot.bottom).toBeLessThanOrEqual(tabBar.top)

		// Another long day, picked while scrolled, starts at its heading. A
		// tap at the button's place, so nothing scrolls it into view first.
		expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(50)
		const tuesday = await box(
			strip.getByRole('button', {
				name: new RegExp(`^Show ${dayName(addDaysUTC(weekStart, 1))},`),
			}),
		)
		await page.touchscreen.tap(
			(tuesday.left + tuesday.right) / 2,
			(tuesday.top + tuesday.bottom) / 2,
		)
		await expect(
			page.getByTestId('mobile-plan').getByRole('heading', { level: 2 }),
		).toHaveText(formatMonthDay(addDaysUTC(weekStart, 1)))
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
	})

	test('“This week” heads the day, under the strip, only on another week', async ({
		page,
		login,
	}) => {
		await login()
		const weekStart = getWeekStart(browserToday())
		await page.goto(planWeek(browserToday()))
		const mobile = page.getByTestId('mobile-plan')
		await expect(
			page.getByRole('heading', { name: 'Plan', level: 1 }),
		).toBeVisible()
		await expect(mobile.getByRole('link', { name: 'This week' })).toHaveCount(0)

		await page.getByRole('link', { name: 'Next week' }).tap()
		const thisWeek = mobile.getByRole('link', { name: 'This week' })
		await expect(thisWeek).toBeVisible()
		const strip = await box(page.locator('[data-slot="mobile-week-days"]'))
		const link = await box(thisWeek)
		expect(link.top).toBeGreaterThanOrEqual(strip.bottom)
		expect(link.bottom).toBeLessThanOrEqual(
			(await box(mobile.getByRole('heading', { level: 2 }))).top,
		)
		await expectThumbTall(thisWeek)
		await thisWeek.tap()
		await expect(page).toHaveURL(/\/plan$/)
		await expect(
			page.getByText(formatWeekRange(weekStart, serializeDate(browserToday()))),
		).toBeVisible()
	})

	test('focusing Next week or a strip day from the keyboard while a long day scrolls moves nothing', async ({
		page,
		login,
	}) => {
		const user = await login()
		const weekStart = await seedLongDay(user)
		await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
		const next = page.getByRole('link', { name: 'Next week' })
		await hydrated(next)
		const scrollY = () => page.evaluate(() => window.scrollY)
		await page.evaluate(() => window.scrollTo(0, 933))
		await expect.poll(scrollY).toBe(933)

		await next.focus()
		expect(await scrollY()).toBe(933)
		// The round + comes before the strip.
		await page.keyboard.press('Tab')
		const days = page
			.locator('[data-slot="mobile-week-days"]')
			.getByRole('button')
		for (const index of [0, 1, 2]) {
			await page.keyboard.press('Tab')
			await expect(days.nth(index)).toBeFocused()
			expect(await scrollY()).toBe(933)
		}
	})

	test('a control in the day that takes focus under the pinned rows comes out below them', async ({
		page,
		login,
	}) => {
		const user = await login()
		const weekStart = await seedLongDay(user)
		await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
		const header = page.locator('[data-plan-header]')
		await hydrated(header)
		const dish = page
			.getByTestId('mobile-plan')
			.getByRole('link', { name: 'Dish 6', exact: true })
		// Scroll the dish under the strip, still inside the viewport.
		await dish.evaluate((element) =>
			window.scrollBy(0, element.getBoundingClientRect().top - 60),
		)
		await expect.poll(async () => (await box(dish)).top).toBe(60)
		const pinned = await box(header)
		expect(pinned.top).toBe(0)

		await dish.focus()
		await expect(dish).toBeFocused()
		expect((await box(dish)).top).toBeGreaterThanOrEqual(pinned.bottom)
	})

	test('the offline notice opens below the title row and the strip while a long day scrolls', async ({
		page,
		login,
	}) => {
		const user = await login()
		const weekStart = await seedLongDay(user)
		await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
		const header = page.locator('[data-plan-header]')
		await hydrated(header)
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
		await expect
			.poll(() => page.evaluate(() => window.scrollY))
			.toBeGreaterThan(500)
		await page.context().setOffline(true)
		const notice = await offlineNotice(page)
		const pinned = await box(header)
		expect(pinned.top).toBe(0)
		expect(notice.top).toBeGreaterThanOrEqual(pinned.bottom)
	})

	test('with the demo banner, the offline notice opens below the title row and the strip at the top of the page', async ({
		page,
		login,
	}) => {
		const user = await login()
		await prisma.user.update({
			where: { id: user.id },
			data: { demoExpiresAt: new Date(Date.now() + 60 * 60 * 1000) },
		})
		await page.goto('/plan')
		const header = page.locator('[data-plan-header]')
		await hydrated(header)
		await expect(page.getByRole('region', { name: 'Demo' })).toBeVisible()
		await page.context().setOffline(true)
		const notice = await offlineNotice(page)
		const block = await box(header)
		expect(block.top).toBeGreaterThan(40)
		expect(notice.top).toBeGreaterThanOrEqual(block.bottom)
	})

	test('in the picker a Recipe’s photo ends its row, and a Recipe without one shows none', async ({
		page,
		login,
	}) => {
		const user = await login()
		const objectKey = 'users/fixture-user/recipes/fixture-recipe/images/0.png'
		await prisma.recipe.create({
			data: {
				title: 'Roast Chicken',
				userId: user.id,
				householdId: user.householdId,
				image: { create: { objectKey } },
			},
		})
		await prisma.recipe.create({
			data: {
				title: 'Green Salad',
				userId: user.id,
				householdId: user.householdId,
			},
		})
		await page.goto('/plan')
		const sheet = page.getByRole('dialog', { name: 'Add Meal' })
		await tapUntil(page.getByRole('button', { name: /^Add Meal to/ }), () =>
			expect(sheet).toBeVisible({ timeout: 2000 }),
		)
		const roast = sheet.getByRole('button', { name: /Roast Chicken/ })
		const salad = sheet.getByRole('button', { name: /Green Salad/ })
		const photo = roast.locator('img').filter({ visible: true })
		await expect(photo).toHaveCount(1)
		const title = await box(roast.getByText('Roast Chicken', { exact: true }))
		expect((await box(photo)).left).toBeGreaterThan(title.right)
		// Nothing leads the row, a photo or a letter.
		await expect(salad.locator('img')).toHaveCount(0)
		await expect(salad.getByText('G', { exact: true })).toBeHidden()
		const saladTitle = await box(
			salad.getByText('Green Salad', { exact: true }),
		)
		expect(saladTitle.left - (await box(salad)).left).toBeLessThanOrEqual(9)
		await expectThumbTall(salad)
	})
})

test.describe('a 320px phone', () => {
	test.use({
		viewport: { width: 320, height: 640 },
		isMobile: true,
		hasTouch: true,
	})

	test('keeps the title row, the strip and a dish row whole, with nothing clipped', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = (title: string) =>
			prisma.recipe.create({
				data: { title, userId: user.id, householdId: user.householdId },
			})
		const [tikka, raita] = [
			await recipe('Chicken tikka masala with saffron rice'),
			await recipe('Cucumber raita'),
		]
		// The longest range: across a new year.
		const day = parseDate('2027-01-01')
		await prisma.mealPlan.create({
			data: {
				householdId: user.householdId,
				weekStart: getWeekStart(day),
				meals: {
					create: {
						date: day,
						order: 0,
						label: 'dinner',
						recipeItems: {
							create: [
								{
									recipeId: tikka.id,
									recipeTitle: tikka.title,
									order: 0,
									scaleMultiplier: 12.5,
								},
								{ recipeId: raita.id, recipeTitle: raita.title, order: 1 },
							],
						},
					},
				},
			},
		})
		await page.goto('/plan?weekStart=2026-12-28&day=2027-01-01')
		const header = page.locator('[data-plan-header]')
		await expect(header.getByText('Dec 28 – Jan 3, 2027')).toBeVisible()
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth),
		).toBeLessThanOrEqual(320)

		// One row: the title, the chevrons around the range, and the +.
		const title = await box(
			page.getByRole('heading', { name: 'Plan', level: 1 }),
		)
		const previous = header.getByRole('link', { name: 'Previous week' })
		const next = header.getByRole('link', { name: 'Next week' })
		const plus = header.getByRole('button', { name: /^Add Meal to/ })
		for (const control of [previous, next, plus]) {
			await expectThumbSized(control)
			const control_ = await box(control)
			expectNear(
				(control_.top + control_.bottom) / 2,
				(title.top + title.bottom) / 2,
			)
		}
		const [prev, nxt, add] = [
			await box(previous),
			await box(next),
			await box(plus),
		]
		// The chevron's tap area may reach under the title; its glyph doesn't.
		expect((await box(previous.locator('svg'))).left).toBeGreaterThan(
			title.right,
		)
		expect(nxt.left).toBeGreaterThan(prev.right)
		expect(add.left).toBeGreaterThanOrEqual(nxt.right)
		expect(add.right).toBeLessThanOrEqual(320 - 16 + 1)
		// The range sits between the chevrons' glyphs, whole, on two lines at
		// most.
		const range = header.locator('p').filter({ hasText: '–' })
		const fit = await range.evaluate((element) => ({
			clipped: element.scrollWidth > element.clientWidth + 1,
			lines: Math.round(
				element.getBoundingClientRect().height /
					parseFloat(getComputedStyle(element).lineHeight),
			),
		}))
		expect(fit).toEqual({ clipped: false, lines: 2 })
		const rangeBox = await box(range)
		expect(rangeBox.left).toBeGreaterThanOrEqual(
			(await box(previous.locator('svg'))).right,
		)
		expect(rangeBox.right).toBeLessThanOrEqual(
			(await box(next.locator('svg'))).left,
		)

		// The strip: seven columns, each wide enough for its 38px circle.
		const cells = page
			.locator('[data-slot="mobile-week-days"]')
			.getByRole('button')
		await expect(cells).toHaveCount(7)
		for (const cell of await cells.all()) {
			const cellBox = await box(cell)
			const circle = await box(cell.locator('span').nth(1))
			expect(circle.right - circle.left).toBe(38)
			expect(circle.left).toBeGreaterThanOrEqual(cellBox.left)
			expect(circle.right).toBeLessThanOrEqual(cellBox.right)
		}

		// A dish row: the name, the trash, the scale field and the cooked
		// circle side by side, none overlapping, the circle on the edge.
		const mobile = page.getByTestId('mobile-plan')
		for (const name of [tikka.title, raita.title]) {
			const areas = [
				await hitArea(
					mobile.getByRole('button', { name: `Remove ${name} from this Meal` }),
				),
				await hitArea(
					mobile
						.locator('h4', { hasText: name })
						.locator('xpath=..')
						.getByRole('textbox', { name: 'Scale multiplier' }),
				),
				await hitArea(
					mobile.getByRole('button', { name: `Mark ${name} cooked` }),
				),
			]
			for (const area of areas) {
				expect(area.width).toBeGreaterThanOrEqual(44)
				expect(area.height).toBeGreaterThanOrEqual(44)
			}
			const parts = [await box(mobile.getByRole('link', { name })), ...areas]
			for (const [i, part] of parts.entries()) {
				expect(part.left).toBeGreaterThanOrEqual(0)
				expect(part.right).toBeLessThanOrEqual(320)
				const following = parts[i + 1]
				if (following) expect(part.right).toBeLessThanOrEqual(following.left)
			}
			const circle = await box(
				mobile
					.getByRole('button', { name: `Mark ${name} cooked` })
					.locator('span')
					.first(),
			)
			expectNear(circle.right, 320 - 16)
		}
		// Neither the name nor the field is cut short.
		const clipped = await mobile.evaluate((day) =>
			[...day.querySelectorAll('h4 span, input')].some(
				(element) =>
					element.scrollWidth > element.clientWidth + 1 ||
					element.scrollHeight > element.clientHeight + 1,
			),
		)
		expect(clipped).toBe(false)
	})
})

test.describe('a wide touch screen', () => {
	// An iPad, or a phone on its side, gets the wide agenda but is touched:
	// its Meal controls stay 44px.
	test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true })

	test('keeps the Meal row controls 44px', async ({ page, login }) => {
		const user = await login()
		const soup = await prisma.recipe.create({
			data: {
				title: 'Miso Soup',
				userId: user.id,
				householdId: user.householdId,
			},
		})
		const today = browserToday()
		await prisma.mealPlan.create({
			data: {
				householdId: user.householdId,
				weekStart: getWeekStart(today),
				meals: {
					create: {
						date: today,
						order: 0,
						label: 'dinner',
						recipeItems: {
							create: { recipeId: soup.id, recipeTitle: soup.title, order: 0 },
						},
					},
				},
			},
		})

		await page.goto(planWeek(today))
		const agenda = page.getByTestId('desktop-plan')
		expect(
			await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
		).toBe(true)
		for (const control of [
			agenda.getByRole('button', { name: 'Mark Miso Soup cooked' }),
			agenda.getByRole('button', { name: 'Add Recipe to Miso Soup' }),
			agenda.getByRole('link', { name: 'Miso Soup' }),
		]) {
			expect(
				(await box(control)).bottom - (await box(control)).top,
			).toBeGreaterThanOrEqual(44)
		}
		const toggle = await box(
			agenda.getByRole('button', { name: 'Mark Miso Soup cooked' }),
		)
		expect(toggle.right - toggle.left).toBeGreaterThanOrEqual(44)
		// The dots are 32px to the eye; a pseudo-element takes taps around them.
		const dots = agenda.getByRole('button', {
			name: 'Meal actions for Miso Soup',
		})
		const hit = await dots.evaluate((element) => {
			const before = getComputedStyle(element, '::before')
			return { display: before.display, inset: before.top }
		})
		expect(hit.display).not.toBe('none')
		// So does the scale field: 28px to the eye, 44px to the thumb.
		const scale = await agenda
			.getByRole('textbox', { name: 'Scale multiplier' })
			.evaluate(
				(input) => getComputedStyle(input.closest('label')!, '::before').height,
			)
		expect(parseFloat(scale)).toBeGreaterThanOrEqual(44)
	})
})

test.describe('the desktop agenda', () => {
	test.use({ viewport: { width: 1280, height: 900 }, hasTouch: false })

	test('closes Edit details after a save that adds or removes the header line', async ({
		page,
		login,
	}) => {
		const user = await login()
		const soup = await prisma.recipe.create({
			data: {
				title: 'Miso Soup',
				userId: user.id,
				householdId: user.householdId,
			},
		})
		const today = browserToday()
		await prisma.mealPlan.create({
			data: {
				householdId: user.householdId,
				weekStart: getWeekStart(today),
				meals: {
					create: {
						date: today,
						order: 0,
						recipeItems: {
							create: { recipeId: soup.id, recipeTitle: soup.title, order: 0 },
						},
					},
				},
			},
		})

		await page.goto(planWeek(today))
		const agenda = page.getByTestId('desktop-plan')
		const label = agenda.getByLabel('Label')
		for (const choice of ['dinner', '']) {
			await agenda
				.getByRole('button', { name: /^Meal actions for (Miso Soup|Dinner)$/ })
				.click()
			await page.getByRole('menuitem', { name: 'Edit details' }).click()
			await label.selectOption(choice)
			await agenda.getByRole('button', { name: 'Save' }).click()
			await expect(label).toHaveCount(0)
			const meal = await prisma.meal.findFirstOrThrow({
				where: { mealPlan: { householdId: user.householdId } },
			})
			expect(meal.label).toBe(choice || null)
		}
	})
})
