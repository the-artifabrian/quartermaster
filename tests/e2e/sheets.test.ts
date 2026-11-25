import { type Locator, type Page } from '@playwright/test'
import { getWeekStart, serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { SAFARI_UA, SHELL_UA } from '#tests/native-shell.ts'
import {
	browserToday,
	expect,
	openShopping,
	tapUntil,
	test,
} from '#tests/playwright-utils.ts'

// On a phone, everything you type or pick in is a bottom sheet: no popover
// and no panel that opens in place. Each flow opens its sheet, saves through
// it, and the sheet goes. Wider screens keep their popover or inline panel.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

/**
 * Waits for a sheet to finish sliding up, then checks it is a real bottom
 * sheet: on the bottom edge and as wide as the screen.
 */
async function expectBottomSheet(page: Page, sheet: Locator) {
	await expect(sheet).toBeVisible()
	await sheet.evaluate((element) =>
		Promise.all(element.getAnimations().map((a) => a.finished)),
	)
	const box = (await sheet.boundingBox())!
	const viewport = page.viewportSize()!
	expect(Math.round(box.y + box.height)).toBe(viewport.height)
	expect(Math.round(box.x)).toBe(0)
	// The page's width (Chromium draws a scrollbar beside it).
	expect(Math.round(box.width)).toBe(await sheetWidth(page))
}

const sheetWidth = (page: Page) =>
	page.evaluate(() => document.body.clientWidth)

/**
 * Counts sheets seen leaving (a panel turning `closed` while on the page),
 * from now on, including a copy that plays the exit for a sheet whose owner
 * went away.
 */
async function recordSheetExits(page: Page) {
	await page.evaluate(() => {
		const record = window as unknown as {
			sheetExits: number
			sheetExitsReachable: boolean[]
		}
		record.sheetExits = 0
		// Whether each leaving sheet could still be reached (taps, Tab,
		// VoiceOver): a copy playing the exit must not be.
		record.sheetExitsReachable = []
		new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				const target = mutation.target as Element
				if (
					target.matches('[data-bottom-sheet-panel]') &&
					target.getAttribute('data-state') === 'closed' &&
					target.isConnected
				) {
					record.sheetExits++
					const root = target.closest<HTMLElement>('[data-bottom-sheet]')!
					record.sheetExitsReachable.push(
						!root.inert && root.getAttribute('aria-hidden') !== 'true',
					)
				}
			}
		}).observe(document.body, {
			subtree: true,
			attributes: true,
			attributeFilter: ['data-state'],
		})
	})
}

const sheetExits = (page: Page) =>
	page.evaluate(() => (window as unknown as { sheetExits: number }).sheetExits)

const sheetExitsReachable = (page: Page) =>
	page.evaluate(
		() =>
			(window as unknown as { sheetExitsReachable: boolean[] })
				.sheetExitsReachable,
	)

/** True when a row draws its inset line (`::before`). */
const drawsInsetLine = (row: Locator) =>
	row.evaluate((element) => {
		const line = getComputedStyle(element, '::before')
		return line.content !== 'none' && line.borderTopWidth === '1px'
	})

/**
 * Slows CSS transitions tenfold, so a sheet's exit lasts until BottomSheet's
 * 500ms fallback: room to act while it leaves. The fallback runs on the
 * clock, not the slowed animations, and a first visit to a page can take
 * longer than that.
 */
async function slowTransitions(page: Page) {
	const cdp = await page.context().newCDPSession(page)
	await cdp.send('Animation.enable')
	await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 })
}

/**
 * Drags one finger down from `fromY` of the way down a locator, the way a
 * phone sends it.
 */
async function pullDown(page: Page, target: Locator, by: number) {
	const box = (await target.boundingBox())!
	const x = box.x + box.width / 2
	const y = box.y + box.height * 0.3
	const cdp = await page.context().newCDPSession(page)
	const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', dy?: number) =>
		cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: dy == null ? [] : [{ x, y: y + dy, id: 1 }],
		})
	await touch('touchStart', 0)
	for (let i = 1; i <= 12; i++) {
		await touch('touchMove', (by * i) / 12)
		await page.waitForTimeout(30)
	}
	await touch('touchEnd')
	await cdp.detach()
}

/**
 * For what waits on a server round trip and a reload (a save landing in the
 * database, the page showing it): a slow CI runner shares one SQLite file
 * between the server and every test worker.
 */
const ROUND_TRIP = { timeout: 15_000 }

/**
 * A database read for `expect.poll` that, while another worker holds SQLite's
 * lock past the busy timeout, counts as not there yet instead of failing the
 * test. Any other error still fails it.
 */
function fromDb<T>(read: () => Promise<T>) {
	return () =>
		read().catch((error: unknown) => {
			if (/timed out|SQLITE_BUSY/.test(String(error))) return 'database busy'
			throw error
		})
}

async function createRecipe(
	user: { id: string; householdId: string },
	title: string,
	data: { yieldAmount?: number; yieldLabel?: string } = {},
) {
	return prisma.recipe.create({
		data: {
			title,
			userId: user.id,
			householdId: user.householdId,
			...data,
			ingredients: {
				create: { name: 'miso', amount: '2', unit: 'tbsp', order: 0 },
			},
		},
	})
}

async function planMeal(
	user: { householdId: string },
	recipe: { id: string; title: string },
) {
	const today = browserToday()
	const weekStart = getWeekStart(today)
	const plan = await prisma.mealPlan.create({
		data: {
			householdId: user.householdId,
			weekStart,
			meals: {
				create: {
					date: today,
					order: 0,
					label: 'dinner',
					recipeItems: {
						create: {
							recipeId: recipe.id,
							recipeTitle: recipe.title,
							order: 0,
						},
					},
				},
			},
		},
		include: { meals: true },
	})
	const meal = plan.meals[0]!
	return { meal, weekStart }
}

test('Add a Meal is a sheet: picking a Recipe plans it and closes the sheet', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createRecipe(user, 'Miso Soup')

	await page.goto('/plan')
	const mobile = page.getByTestId('mobile-plan')
	const sheet = page.getByRole('dialog', { name: 'Add Meal' })
	await tapUntil(page.getByRole('button', { name: /^Add Meal to/ }), () =>
		expect(sheet).toBeVisible({ timeout: 1000 }),
	)
	await expectBottomSheet(page, sheet)
	// Nothing opened in place, in the title row or under the day.
	await expect(page.getByRole('region', { name: /^Add Meal for/ })).toHaveCount(
		0,
	)
	// The sheet's own Close, not a second one from the picker.
	await expect(sheet.getByRole('button', { name: 'Close picker' })).toHaveCount(
		0,
	)

	await sheet.getByRole('button', { name: 'Lunch' }).tap()
	await sheet.getByRole('button', { name: /Miso Soup/ }).tap()
	await expect(sheet).toBeHidden()
	await expect(mobile.getByRole('link', { name: 'Miso Soup' })).toBeVisible()
	await expect
		.poll(
			fromDb(() =>
				prisma.meal.findMany({
					where: { mealPlan: { householdId: user.householdId } },
					select: { label: true, recipeItems: { select: { recipeId: true } } },
				}),
			),
			ROUND_TRIP,
		)
		.toEqual([{ label: 'lunch', recipeItems: [{ recipeId: recipe.id }] }])
})

test('Add a Meal as text saves from the sheet’s full-width Add', async ({
	page,
	login,
}) => {
	const user = await login()

	await page.goto('/plan')
	const mobile = page.getByTestId('mobile-plan')
	const sheet = page.getByRole('dialog', { name: 'Add Meal' })
	await tapUntil(page.getByRole('button', { name: /^Add Meal to/ }), () =>
		expect(sheet).toBeVisible({ timeout: 1000 }),
	)
	await expectBottomSheet(page, sheet)
	await sheet.getByRole('button', { name: /^Add text instead/ }).tap()
	await sheet.getByRole('textbox', { name: 'Meal text' }).fill('Leftovers')
	const add = sheet.getByRole('button', { name: 'Add', exact: true })
	// Full width inside the sheet's 20px side padding.
	expect(Math.round((await add.boundingBox())!.width)).toBe(
		(await sheetWidth(page)) - 40,
	)
	await add.tap()
	await expect(sheet).toBeHidden()
	await expect(mobile.getByText('Leftovers', { exact: true })).toBeVisible()
	await expect
		.poll(
			fromDb(() =>
				prisma.meal.findMany({
					where: { mealPlan: { householdId: user.householdId } },
					select: { genericText: true },
				}),
			),
			ROUND_TRIP,
		)
		.toEqual([{ genericText: 'Leftovers' }])
})

test('Add a Recipe to a Meal is a sheet over the Meal', async ({
	page,
	login,
}) => {
	const user = await login()
	const miso = await createRecipe(user, 'Miso Soup')
	const rice = await createRecipe(user, 'Steamed Rice')
	const { meal, weekStart } = await planMeal(user, miso)

	await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
	const mobile = page.getByTestId('mobile-plan')
	const addRecipe = mobile.getByRole('button', {
		name: 'Add Recipe to Miso Soup',
	})
	const sheet = page.getByRole('dialog', { name: 'Add a Recipe' })
	await tapUntil(addRecipe, () => expect(sheet).toBeVisible({ timeout: 1000 }))
	await expectBottomSheet(page, sheet)
	await sheet.getByRole('button', { name: /Steamed Rice/ }).tap()
	await expect(sheet).toBeHidden()
	await expect(mobile.getByRole('link', { name: 'Steamed Rice' })).toBeVisible()
	await expect
		.poll(
			fromDb(() =>
				prisma.mealRecipeItem.count({
					where: { mealId: meal.id, recipeId: rice.id },
				}),
			),
			ROUND_TRIP,
		)
		.toBe(1)
})

test('Edit details is a sheet: Save stores the change and focus goes back to the Meal’s menu', async ({
	page,
	login,
}) => {
	const user = await login()
	const miso = await createRecipe(user, 'Miso Soup')
	const { meal, weekStart } = await planMeal(user, miso)

	await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
	const mobile = page.getByTestId('mobile-plan')
	const actions = mobile.getByRole('button', {
		name: 'Meal actions for Miso Soup',
	})
	const editDetails = page.getByRole('menuitem', { name: 'Edit details' })
	await tapUntil(actions, () =>
		expect(editDetails).toBeVisible({ timeout: 1000 }),
	)
	await editDetails.tap()
	const sheet = page.getByRole('dialog', { name: 'Edit details' })
	await expectBottomSheet(page, sheet)
	// The closing menu does not take focus back from the sheet.
	await page.waitForTimeout(100)
	await expect(sheet.locator(':focus')).toHaveCount(1)
	// Close is the sheet's; Save is full width with no Cancel beside it.
	await expect(sheet.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
	const save = sheet.getByRole('button', { name: 'Save' })
	expect(Math.round((await save.boundingBox())!.width)).toBe(
		(await sheetWidth(page)) - 40,
	)

	await sheet.getByLabel('Guests').fill('6')
	await save.tap()
	await expect(sheet).toBeHidden(ROUND_TRIP)
	await expect(mobile.getByText('· 6 guests')).toBeVisible(ROUND_TRIP)
	await expect
		.poll(
			fromDb(
				async () =>
					(await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } }))
						.guestCount,
			),
			ROUND_TRIP,
		)
		.toBe(6)
	await expect(actions).toBeFocused(ROUND_TRIP)
})

test('Edit item is a sheet with labelled fields; Save stores it and focus returns to the row', async ({
	page,
	login,
}) => {
	const user = await login()
	const list = await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: { create: { name: 'foil', quantity: '1', unit: 'roll' } },
		},
		include: { items: true },
	})

	await openShopping(page)
	const row = page.getByRole('group', { name: 'foil shopping item' })
	const actions = row.getByRole('button', { name: 'Item actions' })
	await actions.tap()
	await page.getByRole('menuitem', { name: 'Edit', exact: true }).tap()
	const sheet = page.getByRole('dialog', { name: 'Edit item' })
	await expectBottomSheet(page, sheet)
	// The row stays in the list under the sheet.
	await expect(
		row.getByRole('button', { name: 'Check off foil' }),
	).toBeVisible()
	await expect(sheet.getByRole('textbox', { name: 'Name' })).toBeFocused()

	await sheet.getByRole('textbox', { name: 'Quantity' }).fill('2')
	await sheet.getByRole('textbox', { name: 'Unit' }).fill('rolls')
	await expect(sheet.getByRole('textbox', { name: 'Name' })).toHaveValue('foil')
	await expect(sheet.getByRole('textbox', { name: 'Quantity' })).toHaveValue(
		'2',
	)
	await sheet.getByRole('button', { name: 'Save' }).tap()
	await expect(sheet).toBeHidden(ROUND_TRIP)
	await expect(row).toContainText('2 rolls', ROUND_TRIP)
	await expect
		.poll(
			fromDb(() =>
				prisma.shoppingListItem.findUniqueOrThrow({
					where: { id: list.items[0]!.id },
					select: { name: true, quantity: true, unit: true },
				}),
			),
			ROUND_TRIP,
		)
		.toEqual({ name: 'foil', quantity: '2', unit: 'rolls' })
	await expect(actions).toBeFocused(ROUND_TRIP)
})

test('Scale is a sheet; Done keeps a typed multiplier even when the tap leaves the field focused', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createRecipe(user, 'Twelve parcels', {
		yieldAmount: 12,
		yieldLabel: 'pieces',
	})

	await page.goto(`/recipes/${recipe.id}`)
	const sheet = page.getByRole('dialog', { name: 'Scale this Recipe' })
	await tapUntil(page.getByRole('button', { name: 'Scale 1×' }), () =>
		expect(sheet).toBeVisible({ timeout: 1000 }),
	)
	await expectBottomSheet(page, sheet)
	const multiplier = sheet.getByLabel('Scale multiplier')
	await multiplier.fill('2')
	await expect(multiplier).toBeFocused()
	// On iOS a tap on a button does not blur the field, and closing the sheet
	// sends no blur either. No blur reaches the page from here on, and a click
	// event alone is the tap.
	await page.evaluate(() =>
		window.addEventListener(
			'focusout',
			(event) => event.stopImmediatePropagation(),
			true,
		),
	)
	await sheet.getByRole('button', { name: 'Done' }).dispatchEvent('click')
	await expect(sheet).toBeHidden()
	await expect(page).toHaveURL(
		new RegExp(`/recipes/${recipe.id}\\?scale=2$`),
		ROUND_TRIP,
	)
	await expect(page.getByText('Makes 24 pieces')).toBeVisible(ROUND_TRIP)
})

for (const way of ['Escape', 'the backdrop', 'a pull down'] as const) {
	test(`Scale keeps a typed multiplier when closed by ${way}`, async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user, 'Twelve parcels', {
			yieldAmount: 12,
			yieldLabel: 'pieces',
		})

		await page.goto(`/recipes/${recipe.id}`)
		const sheet = page.getByRole('dialog', { name: 'Scale this Recipe' })
		await tapUntil(page.getByRole('button', { name: 'Scale 1×' }), () =>
			expect(sheet).toBeVisible({ timeout: 1000 }),
		)
		await expectBottomSheet(page, sheet)
		await sheet.getByLabel('Scale multiplier').fill('3')
		// As on iOS, no blur reaches the page to save it.
		await page.evaluate(() =>
			window.addEventListener(
				'focusout',
				(event) => event.stopImmediatePropagation(),
				true,
			),
		)
		if (way === 'Escape') await page.keyboard.press('Escape')
		else if (way === 'the backdrop') await page.touchscreen.tap(195, 40)
		else await pullDown(page, sheet.getByRole('heading'), 300)
		await expect(sheet).toBeHidden()
		await expect(page).toHaveURL(
			new RegExp(`/recipes/${recipe.id}\\?scale=3$`),
			ROUND_TRIP,
		)
	})
}

test('From Staples is a sheet: picked Staples go to Next shop', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.householdIngredient.createMany({
		data: ['Milk', 'Yogurt'].map((displayName) => ({
			householdId: user.householdId,
			displayName,
			canonicalKey: displayName.toLowerCase(),
			isStaple: true,
		})),
	})
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: { create: { name: 'foil' } },
		},
	})

	await openShopping(page)
	const sheet = page.getByRole('dialog', {
		name: 'Add from Staples',
	})
	await tapUntil(page.getByRole('button', { name: /^From Staples/ }), () =>
		expect(sheet).toBeVisible({ timeout: 1000 }),
	)
	await expectBottomSheet(page, sheet)
	await sheet.getByRole('button', { name: 'Milk' }).tap()
	await sheet.getByRole('button', { name: 'Add 1 to Next shop' }).tap()
	await expect(sheet).toBeHidden(ROUND_TRIP)
	await expect(
		page.getByRole('group', { name: 'Milk shopping item' }),
	).toBeVisible()
	await expect
		.poll(
			fromDb(() =>
				prisma.shoppingListItem.findMany({
					where: { list: { householdId: user.householdId } },
					select: { name: true, horizon: true },
					orderBy: { name: 'asc' },
				}),
			),
			ROUND_TRIP,
		)
		.toEqual([
			{ name: 'Milk', horizon: 'next' },
			{ name: 'foil', horizon: 'next' },
		])
})

test('Link Recipe is a sheet; Enter in its search sends nothing; a pick leaves and focuses Remove Recipe link', async ({
	page,
	login,
}) => {
	const user = await login()
	const dough = await createRecipe(user, 'Pizza dough')

	await page.goto('/recipes/new')
	// A Recipe ready to save, so an Enter that reached its form would send it.
	await page.getByRole('textbox', { name: 'Title' }).fill('Margherita')
	await page.getByRole('textbox', { name: 'Ingredient 1 name' }).fill('dough')
	await page.getByRole('textbox', { name: 'Step 1' }).fill('Bake hot.')
	const sheet = page.getByRole('dialog', { name: 'Link a Recipe' })
	await tapUntil(page.getByRole('button', { name: 'Link Recipe' }), () =>
		expect(sheet).toBeVisible({ timeout: 1000 }),
	)
	await expectBottomSheet(page, sheet)
	const search = sheet.getByRole('textbox', { name: 'Search Recipes' })
	await expect(search).toBeFocused()
	await search.fill('pizza')
	await expect(sheet.getByRole('button', { name: 'Pizza dough' })).toBeVisible()
	const posts: string[] = []
	page.on('request', (request) => {
		if (request.method() === 'POST') posts.push(request.url())
	})
	await search.press('Enter')
	await page.waitForTimeout(500)
	expect(posts).toEqual([])
	await expect(page).toHaveURL(/\/recipes\/new$/)

	await recordSheetExits(page)
	await sheet.getByRole('button', { name: 'Pizza dough' }).tap()
	await expect(sheet).toBeHidden()
	expect(await sheetExits(page)).toBe(1)
	await expect(page.getByText('Pizza dough', { exact: true })).toBeVisible()
	await expect(
		page.getByRole('button', { name: 'Remove Recipe link' }),
	).toBeFocused()

	await page.getByRole('button', { name: 'Save', exact: true }).tap()
	await expect(page).not.toHaveURL(/\/recipes\/new$/, ROUND_TRIP)
	await expect
		.poll(
			fromDb(() =>
				prisma.ingredient.findMany({
					where: {
						recipe: { title: 'Margherita', householdId: user.householdId },
					},
					select: { name: true, linkedRecipeId: true },
				}),
			),
			ROUND_TRIP,
		)
		.toEqual([{ name: 'dough', linkedRecipeId: dough.id }])
})

test('Add to Plan from a Menu is a sheet and plans the Menu', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createRecipe(user, 'Miso Soup')
	const menu = await prisma.menu.create({
		data: {
			title: 'Weeknight',
			titleKey: 'weeknight',
			householdId: user.householdId,
			sections: {
				create: {
					items: {
						create: {
							kind: 'recipe',
							recipeId: recipe.id,
							recipeTitle: recipe.title,
							scaleMultiplier: 1,
							order: 0,
						},
					},
				},
			},
		},
	})

	await page.goto(`/recipes/menus/${menu.id}`)
	const sheet = page.getByRole('dialog', { name: 'Add to Plan' })
	await tapUntil(page.getByRole('button', { name: 'Add to Plan' }), () =>
		expect(sheet).toBeVisible({ timeout: 1000 }),
	)
	await expectBottomSheet(page, sheet)
	await sheet.getByLabel('Guests').fill('4')
	await sheet.getByRole('button', { name: 'Add to Plan' }).tap()
	await expect(page).toHaveURL(/\/plan/, ROUND_TRIP)
	await expect
		.poll(
			fromDb(() =>
				prisma.meal.findMany({
					where: { mealPlan: { householdId: user.householdId } },
					select: { guestCount: true, sourceMenuId: true },
				}),
			),
			ROUND_TRIP,
		)
		.toEqual([{ guestCount: 4, sourceMenuId: menu.id }])
})

test('a Menu that cannot be planned keeps the Add to Plan sheet open with the reason', async ({
	page,
	login,
}) => {
	const user = await login()
	const menu = await prisma.menu.create({
		data: {
			title: 'Empty',
			titleKey: 'empty',
			householdId: user.householdId,
			sections: { create: {} },
		},
	})

	await page.goto(`/recipes/menus/${menu.id}`)
	const sheet = page.getByRole('dialog', { name: 'Add to Plan' })
	await tapUntil(page.getByRole('button', { name: 'Add to Plan' }), () =>
		expect(sheet).toBeVisible({ timeout: 1000 }),
	)
	await sheet.getByRole('button', { name: 'Add to Plan' }).tap()
	await expect(sheet.getByText(/nothing to plan yet/)).toBeVisible()
	await expect(page).toHaveURL(new RegExp(`/recipes/menus/${menu.id}$`))
	expect(
		await prisma.meal.count({
			where: { mealPlan: { householdId: user.householdId } },
		}),
	).toBe(0)
})

test.describe('on a desktop', () => {
	test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false })

	test('Add a Meal and Edit details still open in place', async ({
		page,
		login,
	}) => {
		const user = await login()
		const miso = await createRecipe(user, 'Miso Soup')
		const { weekStart } = await planMeal(user, miso)

		await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
		const desktop = page.getByTestId('desktop-plan')
		await expect(async () => {
			await desktop
				.getByRole('button', { name: 'Meal actions for Miso Soup' })
				.click()
			await expect(
				page.getByRole('menuitem', { name: 'Edit details' }),
			).toBeVisible({ timeout: 1000 })
		}).toPass()
		await page.getByRole('menuitem', { name: 'Edit details' }).click()
		await expect(desktop.getByLabel('Guests')).toBeVisible()
		await expect(page.getByRole('dialog')).toHaveCount(0)
		await desktop.getByRole('button', { name: 'Cancel' }).click()

		await desktop
			.getByRole('button', { name: /^Add Meal to/ })
			.first()
			.click()
		await expect(
			desktop.getByRole('region', { name: /^Add Meal for/ }),
		).toBeVisible()
		await expect(page.getByRole('dialog')).toHaveCount(0)
	})

	test('an Add Recipe search in progress stays when Edit details opens', async ({
		page,
		login,
	}) => {
		const user = await login()
		const miso = await createRecipe(user, 'Miso Soup')
		await createRecipe(user, 'Steamed Rice')
		const { weekStart } = await planMeal(user, miso)

		await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
		const desktop = page.getByTestId('desktop-plan')
		const search = desktop.getByPlaceholder('Search Recipes…')
		await expect(async () => {
			await desktop
				.getByRole('button', { name: 'Add Recipe to Miso Soup' })
				.click()
			await expect(search).toBeVisible({ timeout: 1000 })
		}).toPass()
		await search.fill('ric')
		await desktop
			.getByRole('button', { name: 'Meal actions for Miso Soup' })
			.click()
		await page.getByRole('menuitem', { name: 'Edit details' }).click()
		await expect(desktop.getByLabel('Guests')).toBeVisible()
		await expect(search).toHaveValue('ric')
	})
})

test.describe('Plan Meals as flat rows', () => {
	test('a Meal has no card border, fill or shadow; a hairline divides Meals and its actions still work', async ({
		page,
		login,
	}) => {
		const user = await login()
		const miso = await createRecipe(user, 'Miso Soup')
		const rice = await createRecipe(user, 'Steamed Rice')
		const { meal, weekStart } = await planMeal(user, miso)
		await prisma.meal.create({
			data: {
				mealPlanId: meal.mealPlanId,
				date: meal.date,
				order: 1,
				recipeItems: {
					create: { recipeId: rice.id, recipeTitle: rice.title, order: 0 },
				},
			},
		})
		// A Meal of two Recipes, divided inside by an inset hairline.
		const salad = await createRecipe(user, 'Cucumber Salad')
		const pair = await prisma.meal.create({
			data: {
				mealPlanId: meal.mealPlanId,
				date: meal.date,
				order: 2,
				recipeItems: {
					create: [
						{ recipeId: rice.id, recipeTitle: rice.title, order: 0 },
						{ recipeId: salad.id, recipeTitle: salad.title, order: 1 },
					],
				},
			},
		})

		for (const [viewport, copy] of [
			[{ width: 390, height: 844 }, 'mobile-plan'],
			[{ width: 1280, height: 800 }, 'desktop-plan'],
		] as const) {
			await page.setViewportSize(viewport)
			await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
			const plan = page.getByTestId(copy)
			const row = plan.locator(`[data-meal-id="${meal.id}"]`)
			await expect(row).toBeVisible()
			const style = await row.evaluate((element) => {
				const css = getComputedStyle(element)
				return {
					border: css.borderTopWidth,
					shadow: css.boxShadow,
					fill: css.backgroundColor,
				}
			})
			expect(style).toEqual({
				border: '0px',
				shadow: 'none',
				fill: 'rgba(0, 0, 0, 0)',
			})
			// The second Meal sits under a hairline in the border colour.
			const groups = plan.locator('[data-slot="meal-group"]')
			await expect(groups).toHaveCount(3)
			const divider = await groups.nth(1).evaluate((element) => {
				const probe = document.createElement('span')
				probe.className = 'border-border border'
				document.body.append(probe)
				const color = getComputedStyle(probe).borderTopColor
				probe.remove()
				const css = getComputedStyle(element)
				return {
					width: css.borderTopWidth,
					matches: css.borderTopColor === color,
				}
			})
			expect(divider).toEqual({ width: '1px', matches: true })
			// Between the two Recipes of one Meal: a hairline that starts where
			// the titles start, past the cooked toggle.
			const salads = plan
				.locator(`[data-meal-id="${pair.id}"]`)
				.getByRole('link', { name: 'Cucumber Salad' })
			await expect(salads).toBeVisible()
			const inner = await salads.evaluate((link) => {
				let row = link.parentElement
				while (row && !row.parentElement?.matches('.space-y-0')) {
					row = row.parentElement
				}
				const line = getComputedStyle(row!, '::before')
				return {
					width: line.borderTopWidth,
					left: Math.round(
						row!.getBoundingClientRect().left + parseFloat(line.left),
					),
					title: Math.round(link.getBoundingClientRect().left),
				}
			})
			expect(inner.width).toBe('1px')
			expect(inner.left).toBe(inner.title)
		}

		// The cooked toggle and the Meal's menu still work on a phone.
		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
		const mobile = page.getByTestId('mobile-plan')
		await expect(async () => {
			await mobile.getByRole('button', { name: 'Mark Miso Soup cooked' }).tap()
			await expect(
				mobile.getByRole('button', { name: 'Mark Miso Soup not cooked' }),
			).toBeVisible({ timeout: 1000 })
		}).toPass()
		await expect
			.poll(
				fromDb(
					async () =>
						(
							await prisma.mealRecipeItem.findFirstOrThrow({
								where: { mealId: meal.id },
							})
						).cooked,
				),
				ROUND_TRIP,
			)
			.toBe(true)
		await mobile
			.getByRole('button', { name: 'Meal actions for Miso Soup' })
			.tap()
		await expect(
			page.getByRole('menuitem', { name: 'Move later' }),
		).toBeVisible()
	})
})

for (const [where, use] of [
	// A mouse, so only the app itself keeps tooltips shut.
	['in the iOS app', { userAgent: SHELL_UA, hasTouch: false }],
	// A finger in Safari: no hover, so no tooltips either.
	['on a touch screen', { userAgent: SAFARI_UA, hasTouch: true }],
] as const) {
	test.describe(`tooltips ${where}`, () => {
		test.use(use)

		test('focus coming back to a Recipe action after a sheet shows no tooltip', async ({
			page,
			login,
		}) => {
			const user = await login()
			const recipe = await createRecipe(user, 'Miso Soup')

			await page.goto(`/recipes/${recipe.id}`)
			const addToPlan = page.getByRole('button', { name: 'Add to Plan' })
			const sheet = page.getByRole('dialog', { name: 'Add to Plan' })
			await expect(async () => {
				await addToPlan.click()
				await expect(sheet).toBeVisible({ timeout: 1000 })
			}).toPass({ timeout: 10_000 })
			await expectBottomSheet(page, sheet)
			await sheet.getByRole('button', { name: 'Close', exact: true }).click()
			await expect(sheet).toBeHidden()
			// The case that showed one: focus back on a button with a tooltip.
			await expect(addToPlan).toBeFocused()
			await page.waitForTimeout(800)
			await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0)
		})
	})
}

async function seedShopping(
	user: { id: string; householdId: string },
	names: string[],
) {
	return prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: {
				create: names.map((name) => ({ name, quantity: '1', unit: 'roll' })),
			},
		},
		include: { items: true },
	})
}

async function openEditItem(page: Page, name: string) {
	const row = page.getByRole('group', { name: `${name} shopping item` })
	await row.getByRole('button', { name: 'Item actions' }).tap()
	await page.getByRole('menuitem', { name: 'Edit', exact: true }).tap()
	return page.getByRole('dialog', { name: 'Edit item' })
}

test.describe('sheets while they come and go', () => {
	test('closing Edit item and opening another row’s menu at once keeps that menu open and focused', async ({
		page,
		login,
	}) => {
		await seedShopping(await login(), ['foil', 'salt'])
		await openShopping(page)
		const sheet = await openEditItem(page, 'foil')
		await expectBottomSheet(page, sheet)
		await slowTransitions(page)
		await sheet.getByRole('button', { name: 'Close', exact: true }).tap()
		await page
			.getByRole('group', { name: 'salt shopping item' })
			.getByRole('button', { name: 'Item actions' })
			.tap()
		const editItem = page.getByRole('menuitem', { name: 'Edit', exact: true })
		await expect(editItem).toBeVisible()
		// Past the leaving sheet's unmount, which once took focus back to foil.
		await page.waitForTimeout(900)
		await expect(editItem).toBeVisible()
		expect(
			await page
				.getByRole('menu')
				.evaluate((menu) => menu.contains(document.activeElement)),
		).toBe(true)
	})

	test('reopening Edit item while it leaves shows the saved values, not what was typed', async ({
		page,
		login,
	}) => {
		await seedShopping(await login(), ['foil'])
		await openShopping(page)
		const actions = page
			.getByRole('group', { name: 'foil shopping item' })
			.getByRole('button', { name: 'Item actions' })
		const sheet = await openEditItem(page, 'foil')
		await expectBottomSheet(page, sheet)
		const trigger = (await actions.boundingBox())!
		await slowTransitions(page)
		await sheet.getByRole('textbox', { name: 'Quantity' }).fill('9')
		await sheet.getByRole('button', { name: 'Close', exact: true }).tap()
		// Reopen at once, before the leaving sheet is gone: no waiting for the
		// slowed menu to hold still.
		await page.mouse.click(
			trigger.x + trigger.width / 2,
			trigger.y + trigger.height / 2,
		)
		await page
			.getByRole('menuitem', { name: 'Edit', exact: true })
			.dispatchEvent('click')
		await expect(sheet).toHaveAttribute('data-state', 'open')
		await expect(sheet.getByRole('textbox', { name: 'Quantity' })).toHaveValue(
			'1',
		)
		await expect(sheet.getByRole('textbox', { name: 'Name' })).toHaveValue(
			'foil',
		)
	})

	test('a closing Add a Meal sheet leaves as it was; the next open starts afresh', async ({
		page,
		login,
	}) => {
		await login()
		await page.goto('/plan')
		const sheet = page.getByRole('dialog', { name: 'Add Meal' })
		await tapUntil(page.getByRole('button', { name: /^Add Meal to/ }), () =>
			expect(sheet).toBeVisible({ timeout: 1000 }),
		)
		await expectBottomSheet(page, sheet)
		await sheet.getByRole('button', { name: 'Lunch' }).tap()
		await sheet.getByRole('button', { name: /^Add text instead/ }).tap()
		await sheet.getByRole('textbox', { name: 'Meal text' }).fill('Leftovers')
		// What the sheet holds the moment it starts to leave.
		await page.evaluate(() => {
			const record = window as unknown as { leavingText?: string | null }
			new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					const target = mutation.target as Element
					if (
						target.matches('[data-bottom-sheet-panel]') &&
						target.getAttribute('data-state') === 'closed'
					) {
						record.leavingText =
							target.querySelector<HTMLInputElement>(
								'input[aria-label="Meal text"]',
							)?.value ?? null
					}
				}
			}).observe(document.body, {
				subtree: true,
				attributes: true,
				attributeFilter: ['data-state'],
			})
		})
		await sheet.getByRole('button', { name: 'Close', exact: true }).tap()
		await expect(sheet).toBeHidden()
		expect(
			await page.evaluate(
				() =>
					(window as unknown as { leavingText?: string | null }).leavingText,
			),
		).toBe('Leftovers')

		await page.getByRole('button', { name: /^Add Meal to/ }).tap()
		await expect(
			sheet.getByPlaceholder('Search Recipes and Menus…'),
		).toBeVisible()
		await expect(sheet.getByRole('button', { name: 'Lunch' })).toHaveAttribute(
			'aria-pressed',
			'false',
		)
	})

	test('a tap on a sheet’s title keeps focus in the sheet, and Tab stays there', async ({
		page,
		login,
	}) => {
		const user = await login()
		const miso = await createRecipe(user, 'Miso Soup')
		const { weekStart } = await planMeal(user, miso)
		await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
		const actions = page
			.getByTestId('mobile-plan')
			.getByRole('button', { name: 'Meal actions for Miso Soup' })
		const editDetails = page.getByRole('menuitem', { name: 'Edit details' })
		await tapUntil(actions, () =>
			expect(editDetails).toBeVisible({ timeout: 1000 }),
		)
		await editDetails.tap()
		const sheet = page.getByRole('dialog', { name: 'Edit details' })
		await expectBottomSheet(page, sheet)
		const title = sheet.getByRole('heading', { name: 'Edit details' })
		await title.tap()
		const focusInSheet = () =>
			sheet.evaluate((dialog) => dialog.contains(document.activeElement))
		expect(await focusInSheet()).toBe(true)
		await page.keyboard.press('Tab')
		await expect(sheet.getByRole('button', { name: 'Close' })).toBeFocused()
		await title.tap()
		await page.keyboard.press('Shift+Tab')
		expect(await focusInSheet()).toBe(true)
		await expect(sheet.getByRole('button', { name: 'Save' })).toBeFocused()
	})

	test('a row deleted elsewhere under its open sheet still sees the sheet leave', async ({
		page,
		login,
	}) => {
		test.setTimeout(45_000)
		const user = await login()
		// Shopping follows other devices live with Pro.
		await prisma.subscription.create({
			data: {
				userId: user.id,
				tier: 'pro',
				trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			},
		})
		await seedShopping(user, ['foil', 'salt'])
		await openShopping(page)
		const sheet = await openEditItem(page, 'foil')
		await expectBottomSheet(page, sheet)
		await recordSheetExits(page)

		// The other member deletes foil on their own device.
		const other = await page.context().newPage()
		await other.setViewportSize({ width: 1280, height: 800 })
		await openShopping(other)
		const foil = other.getByRole('group', { name: 'foil shopping item' })
		await foil.getByRole('button', { name: 'Item actions' }).click()
		// A delete goes at once, with Undo.
		await other.getByRole('menuitem', { name: /^Delete/ }).click()
		await expect(foil).toBeHidden()
		await expect
			.poll(
				fromDb(() =>
					prisma.shoppingListItem.count({
						where: { name: 'foil', list: { householdId: user.householdId } },
					}),
				),
				ROUND_TRIP,
			)
			.toBe(0)

		// Back on this phone, which catches up as it comes to the front.
		await page.bringToFront()
		await expect(
			page.getByRole('group', { name: 'foil shopping item' }),
		).toBeHidden({ timeout: 15_000 })
		await expect(sheet).toBeHidden()
		expect(await sheetExits(page)).toBe(1)
		// The copy that played it was out of reach, and is gone after.
		expect(await sheetExitsReachable(page)).toEqual([false])
		await expect(page.locator('[data-bottom-sheet]')).toHaveCount(0)
		await other.close()
	})

	test('a Date change in Edit details closes the sheet and focuses the moved Meal', async ({
		page,
		login,
	}) => {
		const user = await login()
		const miso = await createRecipe(user, 'Miso Soup')
		const { meal, weekStart } = await planMeal(user, miso)
		// Another day of the same week.
		const today = browserToday()
		const other = new Date(
			weekStart.getTime() +
				(today.getTime() === weekStart.getTime() ? 1 : 0) * 86_400_000,
		)
		await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
		const mobile = page.getByTestId('mobile-plan')
		const editDetails = page.getByRole('menuitem', { name: 'Edit details' })
		await tapUntil(
			mobile.getByRole('button', { name: 'Meal actions for Miso Soup' }),
			() => expect(editDetails).toBeVisible({ timeout: 1000 }),
		)
		await editDetails.tap()
		const sheet = page.getByRole('dialog', { name: 'Edit details' })
		await expectBottomSheet(page, sheet)
		await sheet.getByLabel('Date', { exact: true }).fill(serializeDate(other))
		await sheet.getByRole('button', { name: 'Save' }).tap()
		await expect(sheet).toBeHidden(ROUND_TRIP)
		const moved = mobile.locator(`[data-meal-id="${meal.id}"]`)
		await expect(moved).toBeFocused(ROUND_TRIP)
		await expect
			.poll(
				fromDb(async () =>
					serializeDate(
						(await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } }))
							.date,
					),
				),
				ROUND_TRIP,
			)
			.toBe(serializeDate(other))
		// Still focused once the sheet is long gone.
		await page.waitForTimeout(600)
		await expect(moved).toBeFocused()
	})
})

test.describe('a phone on its side', () => {
	test.use({ viewport: { width: 844, height: 390 }, hasTouch: true })

	/** On the bottom edge with its grabber: a sheet, not a centered dialog. */
	async function expectSheetOnBottomEdge(page: Page, sheet: Locator) {
		await expect(sheet).toBeVisible()
		await sheet.evaluate((element) =>
			Promise.all(element.getAnimations().map((a) => a.finished)),
		)
		const box = (await sheet.boundingBox())!
		expect(Math.round(box.y + box.height)).toBe(page.viewportSize()!.height)
		await expect(sheet.locator('[data-bottom-sheet-grabber]')).toBeVisible()
	}

	test('Edit item is a sheet that a pull down closes', async ({
		page,
		login,
	}) => {
		await seedShopping(await login(), ['foil'])
		await openShopping(page)
		const sheet = await openEditItem(page, 'foil')
		await expectSheetOnBottomEdge(page, sheet)
		await pullDown(page, sheet.getByRole('heading', { name: 'Edit item' }), 250)
		await expect(sheet).toBeHidden()
	})

	test('Add a Meal from the week agenda is a sheet', async ({
		page,
		login,
	}) => {
		await login()
		await page.goto('/plan')
		const desktop = page.getByTestId('desktop-plan')
		const sheet = page.getByRole('dialog', { name: 'Add Meal' })
		await tapUntil(
			desktop.getByRole('button', { name: /^Add Meal to/ }).first(),
			() => expect(sheet).toBeVisible({ timeout: 1000 }),
		)
		await expectSheetOnBottomEdge(page, sheet)
		await expect(
			desktop.getByRole('region', { name: /^Add Meal for/ }),
		).toHaveCount(0)
	})

	test('turning the phone with Add a Meal open keeps the sheet', async ({
		page,
		login,
	}) => {
		await login()
		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto('/plan')
		const sheet = page.getByRole('dialog', { name: 'Add Meal' })
		await tapUntil(page.getByRole('button', { name: /^Add Meal to/ }), () =>
			expect(sheet).toBeVisible({ timeout: 1000 }),
		)
		await expectBottomSheet(page, sheet)
		await page.setViewportSize({ width: 844, height: 390 })
		await expectSheetOnBottomEdge(page, sheet)
		await expect(sheet).toHaveAttribute('data-state', 'open')
	})
})

/**
 * Holds the Plan's reloads, so a row deleted with Undo stays on the page,
 * collapsed, as it does until the Plan next loads.
 */
async function holdPlanReloads(page: Page) {
	await page.route(/\/plan\.data/, (route) =>
		route.request().method() === 'GET' ? undefined : route.continue(),
	)
}

test('removing the first Recipe of a Meal takes the inset line above the next one', async ({
	page,
	login,
}) => {
	const user = await login()
	const dal = await createRecipe(user, 'Dal')
	const rice = await createRecipe(user, 'Rice')
	const { meal, weekStart } = await planMeal(user, dal)
	await prisma.mealRecipeItem.create({
		data: {
			mealId: meal.id,
			recipeId: rice.id,
			recipeTitle: rice.title,
			order: 1,
		},
	})
	await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
	const mobile = page.getByTestId('mobile-plan')
	const riceRow = mobile
		.getByRole('link', { name: 'Rice', exact: true })
		.locator('xpath=ancestor::*[@data-row-collapse][1]')
	expect(await drawsInsetLine(riceRow)).toBe(true)
	await holdPlanReloads(page)
	await tapUntil(
		mobile.getByRole('button', { name: 'Remove Dal from this Meal' }),
		() =>
			expect(mobile.getByRole('link', { name: 'Dal', exact: true })).toBeHidden(
				{ timeout: 1000 },
			),
	)
	await expect.poll(() => drawsInsetLine(riceRow), ROUND_TRIP).toBe(false)
})

test('removing the first Recipe under a Menu heading leaves no line under the heading', async ({
	page,
	login,
}) => {
	const user = await login()
	const dal = await createRecipe(user, 'Dal')
	const rice = await createRecipe(user, 'Rice')
	const { meal, weekStart } = await planMeal(user, dal)
	// A Menu snapshot: a "Mains" heading over Dal and Rice.
	await prisma.mealRecipeItem.deleteMany({ where: { mealId: meal.id } })
	const mains = await prisma.mealSection.create({
		data: { mealId: meal.id, name: 'Mains', order: 0 },
	})
	await prisma.mealRecipeItem.createMany({
		data: [dal, rice].map((recipe, order) => ({
			mealId: meal.id,
			sectionId: mains.id,
			recipeId: recipe.id,
			recipeTitle: recipe.title,
			order,
		})),
	})
	await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
	const mobile = page.getByTestId('mobile-plan')
	await expect(mobile.getByRole('heading', { name: 'Mains' })).toBeVisible()
	const riceRow = mobile
		.getByRole('link', { name: 'Rice', exact: true })
		.locator('xpath=ancestor::*[@data-row-collapse][1]')
	expect(await drawsInsetLine(riceRow)).toBe(true)
	await holdPlanReloads(page)
	await tapUntil(
		mobile.getByRole('button', { name: 'Remove Dal from this Meal' }),
		() =>
			expect(mobile.getByRole('link', { name: 'Dal', exact: true })).toBeHidden(
				{ timeout: 1000 },
			),
	)
	await expect.poll(() => drawsInsetLine(riceRow), ROUND_TRIP).toBe(false)
})

test('reopening Edit details or Add a Recipe while it leaves starts afresh', async ({
	page,
	login,
}) => {
	const user = await login()
	const miso = await createRecipe(user, 'Miso Soup')
	await createRecipe(user, 'Steamed Rice')
	const { weekStart } = await planMeal(user, miso)
	await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
	const mobile = page.getByTestId('mobile-plan')
	const actions = mobile.getByRole('button', {
		name: 'Meal actions for Miso Soup',
	})
	const editDetails = page.getByRole('menuitem', { name: 'Edit details' })
	await tapUntil(actions, () =>
		expect(editDetails).toBeVisible({ timeout: 1000 }),
	)
	await editDetails.tap()
	const details = page.getByRole('dialog', { name: 'Edit details' })
	await expectBottomSheet(page, details)
	const actionsBox = (await actions.boundingBox())!
	await slowTransitions(page)
	await details.getByLabel('Guests').fill('9')
	await details.getByRole('button', { name: 'Close', exact: true }).tap()
	// Back at once, before the leaving sheet is gone.
	await page.mouse.click(
		actionsBox.x + actionsBox.width / 2,
		actionsBox.y + actionsBox.height / 2,
	)
	await editDetails.dispatchEvent('click')
	await expect(details).toHaveAttribute('data-state', 'open')
	await expect(details.getByLabel('Guests')).toHaveValue('')
	await details.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(details).toBeHidden()

	const addRecipe = mobile.getByRole('button', {
		name: 'Add Recipe to Miso Soup',
	})
	const picker = page.getByRole('dialog', { name: 'Add a Recipe' })
	const addBox = (await addRecipe.boundingBox())!
	await addRecipe.click()
	await expect(picker).toHaveAttribute('data-state', 'open')
	await picker.getByPlaceholder('Search Recipes…').fill('ric')
	await picker.getByRole('button', { name: 'Close', exact: true }).click()
	await page.mouse.click(
		addBox.x + addBox.width / 2,
		addBox.y + addBox.height / 2,
	)
	await expect(picker).toHaveAttribute('data-state', 'open')
	await expect(picker.getByPlaceholder('Search Recipes…')).toHaveValue('')
})

test('a sheet still leaving when its page goes plays its exit to the end', async ({
	page,
	login,
}) => {
	await seedShopping(await login(), ['foil'])
	await openShopping(page)
	// The sheet leaves for 500ms at most (BottomSheet's fallback), and a first
	// visit to Plan, which loads its code and its week, takes longer than that
	// on a slow runner. Visiting it first means the visit below comes from
	// memory.
	const plan = page
		.locator('[data-bottom-nav]')
		.getByRole('link', { name: 'Plan' })
	await plan.click()
	await expect(page).toHaveURL(/\/plan/, ROUND_TRIP)
	await page
		.locator('[data-bottom-nav]')
		.getByRole('link', { name: 'Shopping' })
		.click()
	await expect(page).toHaveURL(/\/shopping/, ROUND_TRIP)
	const sheet = await openEditItem(page, 'foil')
	await expectBottomSheet(page, sheet)
	await recordSheetExits(page)
	await slowTransitions(page)
	await sheet.getByRole('button', { name: 'Close', exact: true }).tap()
	// Leave Shopping while the sheet is still on its way out.
	await plan.dispatchEvent('click')
	await expect(page).toHaveURL(/\/plan/, ROUND_TRIP)
	// Its own exit, cut short, then the copy that finishes it.
	await expect.poll(() => sheetExits(page), ROUND_TRIP).toBe(2)
	expect(await sheetExitsReachable(page)).toEqual([true, false])
	await expect(page.locator('[data-bottom-sheet]')).toHaveCount(0)
})

test('Staples picked and added are not picked again after Shopping clears them', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.householdIngredient.create({
		data: {
			householdId: user.householdId,
			displayName: 'Milk',
			canonicalKey: 'milk',
			isStaple: true,
		},
	})
	await seedShopping(user, ['foil'])
	await openShopping(page)
	const sheet = page.getByRole('dialog', {
		name: 'Add from Staples',
	})
	const fromStaples = page.getByRole('button', { name: /^From Staples/ })
	await tapUntil(fromStaples, () =>
		expect(sheet).toBeVisible({ timeout: 1000 }),
	)
	await sheet.getByRole('button', { name: 'Milk' }).tap()
	await sheet.getByRole('button', { name: 'Add 1 to Next shop' }).tap()
	await expect(sheet).toBeHidden(ROUND_TRIP)

	// Bought and cleared.
	const milkRow = page.getByRole('group', { name: 'Milk shopping item' })
	await milkRow.getByRole('button', { name: 'Check off Milk' }).tap()
	await page
		.getByRole('button', { name: 'Clear checked items from Next shop' })
		.tap()
	await expect(milkRow).toBeHidden()
	await expect
		.poll(
			fromDb(() =>
				prisma.shoppingListItem.count({
					where: { name: 'Milk', list: { householdId: user.householdId } },
				}),
			),
			ROUND_TRIP,
		)
		.toBe(0)

	await fromStaples.tap()
	const milk = sheet.getByRole('button', { name: 'Milk' })
	await expect(milk).toBeEnabled()
	await expect(milk).toHaveAttribute('aria-pressed', 'false')
})

test.describe('the Shopping add sheet’s motion', () => {
	// No touch here, unlike the rest of this file.
	test.use({ hasTouch: false })

	test.use({ viewport: { width: 390, height: 844 } })

	async function openShoppingWithList(
		page: Page,
		user: { id: string; householdId: string },
	) {
		await prisma.shoppingList.create({
			data: { userId: user.id, householdId: user.householdId },
		})
		await openShopping(page)
	}

	type Transition = {
		property: string
		duration: number
		from: string | null
		state: string | null
	}

	/**
	 * Opens the add sheet, holds its entrance 40% of the way in, closes it with
	 * Escape, and reports the transitions on the panel at both moments. Holding
	 * the entrance keeps a loaded machine from closing a sheet that has not
	 * moved yet, which has nothing to turn around.
	 */
	function openThenCloseEarly(page: Page) {
		return page.evaluate(async () => {
			const frame = () =>
				new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
			const transitionsOf = (panel: Element): Transition[] =>
				panel.getAnimations().map((animation) => {
					const transition = animation as CSSTransition
					const [first] = transition.effect
						? (transition.effect as KeyframeEffect).getKeyframes()
						: []
					return {
						property: transition.transitionProperty,
						duration: Number(transition.effect?.getTiming().duration),
						from: first ? String(first[transition.transitionProperty]) : null,
						state: panel.getAttribute('data-state'),
					}
				})
			document
				.querySelector<HTMLButtonElement>('button[aria-label="Add item"]')!
				.click()
			await frame()
			const panel = document.querySelector('[data-bottom-sheet-panel]')!
			const entering = transitionsOf(panel)
			for (const animation of panel.getAnimations()) {
				animation.pause()
				animation.currentTime =
					Number(animation.effect?.getTiming().duration) * 0.4
			}
			document.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
			)
			// Read the exit as soon as React has committed the close.
			const startedAt = performance.now()
			while (panel.getAttribute('data-state') !== 'closed') {
				await new Promise((resolve) => setTimeout(resolve, 0))
			}
			const leaving = transitionsOf(panel)
			return {
				entering,
				leaving,
				closeMs: performance.now() - startedAt,
				connected: panel.isConnected,
			}
		})
	}

	/** How far down a keyframe's `translateY(…%)` puts the panel, in percent. */
	function percentDown(transform: string | null) {
		const percent = transform?.match(/^translateY\((-?[\d.]+)%\)$/)?.[1]
		return percent ? Number(percent) : NaN
	}

	test('the add sheet slides up, and a close mid-entrance turns it around', async ({
		page,
		login,
	}) => {
		await openShoppingWithList(page, await login())
		const { entering, leaving, closeMs, connected } =
			await openThenCloseEarly(page)

		// The entrance slides, inside the 350 ms an occasional surface gets.
		const entrance = entering.find((t) => t.property === 'transform')
		expect(entrance).toMatchObject({ state: 'open' })
		expect(entrance!.duration).toBeGreaterThan(0)
		expect(entrance!.duration).toBeLessThanOrEqual(350)
		// The exit starts from where the entrance had got to, not from either end,
		// and is quicker than the entrance (a reversal is shortened further).
		const exit = leaving.find((t) => t.property === 'transform')
		expect(
			leaving.map((t) => t.property),
			JSON.stringify({ entering, leaving, closeMs }),
		).toContain('transform')
		expect(exit!.duration).toBeGreaterThan(0)
		expect(exit!.duration).toBeLessThanOrEqual(250)
		const from = percentDown(exit!.from)
		expect(from, String(exit!.from)).toBeGreaterThan(0)
		expect(from, String(exit!.from)).toBeLessThan(100)
		// The panel is still there while it leaves, then goes.
		expect(connected).toBe(true)
		await expect(
			page.getByRole('dialog', { name: 'Add to Shopping' }),
		).toBeHidden()

		// It opens again from the start.
		await page.getByRole('button', { name: 'Add item' }).click()
		await expect(
			page
				.getByRole('dialog', { name: 'Add to Shopping' })
				.getByPlaceholder('Add an item…'),
		).toBeFocused()
	})

	test('with reduced motion, the add sheet fades in and out without moving', async ({
		page,
		login,
	}) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await openShoppingWithList(page, await login())
		const { entering, leaving } = await openThenCloseEarly(page)

		for (const transitions of [entering, leaving]) {
			expect(transitions.map((t) => t.property)).not.toContain('transform')
		}
		// A short fade both ways.
		for (const transitions of [entering, leaving]) {
			const fade = transitions.find((t) => t.property === 'opacity')
			expect(fade!.duration).toBeGreaterThan(0)
			expect(fade!.duration).toBeLessThanOrEqual(150)
		}
		await expect(
			page.getByRole('dialog', { name: 'Add to Shopping' }),
		).toBeHidden()
	})

	test('Escape, the backdrop and Close each close the add sheet, and focus comes back to Add item', async ({
		page,
		login,
	}) => {
		await openShoppingWithList(page, await login())
		const addItem = page.getByRole('button', { name: 'Add item' })
		const sheet = page.getByRole('dialog', { name: 'Add to Shopping' })

		await addItem.focus()
		await page.keyboard.press('Enter')
		await expect(sheet.getByPlaceholder('Add an item…')).toBeFocused()
		await page.keyboard.press('Escape')
		await expect(sheet).toBeHidden()
		await expect(addItem).toBeFocused()

		await addItem.click()
		await expect(sheet).toBeVisible()
		// The backdrop, above the sheet.
		await page.mouse.click(195, 200)
		await expect(sheet).toBeHidden()
		await expect(addItem).toBeFocused()

		await addItem.click()
		await sheet.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(sheet).toBeHidden()
		await expect(addItem).toBeFocused()
	})

	/** Records each Shopping row as it mounts, with the transitions it starts. */
	async function recordRowMounts(page: Page) {
		await page.evaluate(() => {
			const mounts: Array<{
				name: string | null
				optimistic: boolean
				transitions: string[]
			}> = []
			Object.assign(window, { __rowMounts: mounts })
			new MutationObserver((records) => {
				for (const record of records) {
					for (const node of record.addedNodes) {
						if (!(node instanceof HTMLElement)) continue
						const rows = node.matches('[aria-label$=" shopping item"]')
							? [node]
							: [...node.querySelectorAll('[aria-label$=" shopping item"]')]
						for (const row of rows) {
							mounts.push({
								name: row.getAttribute('aria-label'),
								optimistic: row.hasAttribute('data-optimistic-row'),
								transitions: row
									.getAnimations()
									.map((a) => (a as CSSTransition).transitionProperty)
									.sort(),
							})
						}
					}
				}
			}).observe(document.body, { childList: true, subtree: true })
		})
		return () =>
			page.evaluate(
				() =>
					(
						window as unknown as {
							__rowMounts: Array<{
								name: string | null
								optimistic: boolean
								transitions: string[]
							}>
						}
					).__rowMounts,
			)
	}

	for (const reducedMotion of ['no-preference', 'reduce'] as const) {
		test(`a new Shopping row eases in and the saved row does not (${reducedMotion})`, async ({
			page,
			login,
		}) => {
			await page.emulateMedia({ reducedMotion })
			const user = await login()
			await openShoppingWithList(page, user)
			// Hold the add so the row added just now is on screen for a while.
			await page.route('**/shopping.data**', async (route) => {
				if (route.request().postData()?.includes('intent=add')) {
					await new Promise((resolve) => setTimeout(resolve, 400))
				}
				await route.continue()
			})
			const rowMounts = await recordRowMounts(page)

			await page.getByRole('button', { name: 'Add item' }).click()
			await page
				.getByRole('dialog', { name: 'Add to Shopping' })
				.getByPlaceholder('Add an item…')
				.fill('Bananas')
			await page.keyboard.press('Enter')
			await expect(
				page.locator(
					'[data-optimistic-row][aria-label="Bananas shopping item"]',
				),
			).toBeVisible()
			await expect(
				page.locator(
					'[data-optimistic-row][aria-label="Bananas shopping item"]',
				),
			).toHaveCount(0)
			await expect(
				page.getByRole('group', { name: 'Bananas shopping item' }),
			).toBeVisible()
			await expect
				.poll(() =>
					prisma.shoppingListItem.count({
						where: { name: 'Bananas', list: { householdId: user.householdId } },
					}),
				)
				.toBe(1)

			const mounts = (await rowMounts()).filter(
				(m) => m.name === 'Bananas shopping item',
			)
			expect(mounts).toEqual([
				{
					name: 'Bananas shopping item',
					optimistic: true,
					transitions:
						reducedMotion === 'reduce' ? ['opacity'] : ['opacity', 'transform'],
				},
				{ name: 'Bananas shopping item', optimistic: false, transitions: [] },
			])
		})
	}
})

test.describe('pulling a sheet down', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

	/**
	 * Puts one finger down at `fromY` of the way down a locator. Chromium
	 * dispatches these as touch events, the way a phone sends them.
	 */
	async function fingerDown(page: Page, target: Locator, fromY: number) {
		const box = (await target.boundingBox())!
		const x = box.x + box.width / 2
		const y = box.y + box.height * fromY
		const cdp = await page.context().newCDPSession(page)
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [{ x, y, id: 1 }],
		})
		return {
			/** Moves the finger to `dy` below where it went down. */
			move: (dy: number) =>
				cdp.send('Input.dispatchTouchEvent', {
					type: 'touchMove',
					touchPoints: [{ x, y: y + dy, id: 1 }],
				}),
			lift: async () => {
				await cdp.send('Input.dispatchTouchEvent', {
					type: 'touchEnd',
					touchPoints: [],
				})
				await cdp.detach()
			},
		}
	}

	/**
	 * Drags one finger down (or up, with a negative `by`) from `fromY` of the
	 * way down a locator, over `ms`.
	 */
	async function pull(
		page: Page,
		target: Locator,
		{
			fromY,
			by,
			ms,
			steps = 12,
		}: { fromY: number; by: number; ms: number; steps?: number },
	) {
		const finger = await fingerDown(page, target, fromY)
		for (let i = 1; i <= steps; i++) {
			await finger.move((by * i) / steps)
			await page.waitForTimeout(ms / steps)
		}
		await finger.lift()
	}

	/** The panel's offset from its open spot, as shown now (px). */
	const shownOffset = (panel: Locator) =>
		panel.evaluate(
			(element) => new DOMMatrix(getComputedStyle(element).transform).m42,
		)

	/** The backdrop's opacity as shown now. */
	const shownShade = (page: Page) =>
		page
			.locator('[data-bottom-sheet-backdrop]')
			.evaluate((element) => Number(getComputedStyle(element).opacity))

	/**
	 * Waits for an opening sheet to finish sliding in: until then its box is
	 * still moving, and a finger aimed at it lands somewhere else.
	 */
	async function slidIn(panel: Locator) {
		await expect(panel).toBeVisible()
		await panel.evaluate((element) =>
			Promise.all(element.getAnimations().map((a) => a.finished)),
		)
	}

	/**
	 * Where the panel rests once any settle has run (px from its open spot). A
	 * sheet that is closing fails here rather than being read mid-exit.
	 */
	async function restingOffset(panel: Locator) {
		await expect(panel).toHaveAttribute('data-state', 'open')
		await panel.evaluate((element) =>
			Promise.all(element.getAnimations().map((a) => a.finished)),
		)
		return shownOffset(panel)
	}

	/** Opens Shopping's Add sheet, slid in. */
	async function openAddSheet(
		page: Page,
		user: { id: string; householdId: string },
	) {
		await prisma.shoppingList.create({
			data: { userId: user.id, householdId: user.householdId },
		})
		await openShopping(page)
		const addItem = page.getByRole('button', { name: 'Add item' })
		await addItem.click()
		const sheet = page.getByRole('dialog', { name: 'Add to Shopping' })
		await slidIn(sheet)
		return { addItem, sheet, height: (await sheet.boundingBox())!.height }
	}

	test('pulling the Shopping add sheet down closes it; a short pull or a push up does not', async ({
		page,
		login,
	}) => {
		const { addItem, sheet, height } = await openAddSheet(page, await login())

		// While the finger is down the sheet follows it and the backdrop fades
		// with it; let go short, both go back.
		const finger = await fingerDown(page, sheet, 0.2)
		for (const part of [0.05, 0.15, 0.3]) await finger.move(height * part)
		expect(await shownOffset(sheet)).toBeGreaterThan(height * 0.1)
		expect(await shownShade(page)).toBeLessThan(0.95)
		// Held still before it lifts, so it isn't a flick.
		await page.waitForTimeout(200)
		await finger.lift()
		await expect(sheet).toBeVisible()
		expect(await restingOffset(sheet)).toBe(0)
		await expect.poll(() => shownShade(page)).toBe(1)

		// A push up only stretches it a little, and it goes back.
		const push = await fingerDown(page, sheet, 0.5)
		for (const dy of [-20, -60, -120]) await push.move(dy)
		const stretched = await shownOffset(sheet)
		expect(stretched).toBeLessThan(-5)
		expect(stretched).toBeGreaterThan(-60)
		await page.waitForTimeout(200)
		await push.lift()
		expect(await restingOffset(sheet)).toBe(0)

		// A tap straight after a drag is a tap.
		await pull(page, sheet, { fromY: 0.2, by: height * 0.15, ms: 200 })
		await page.getByRole('button', { name: 'Close' }).tap()
		await expect(sheet).toBeHidden()

		// A long pull closes it, and focus goes back to the button.
		await addItem.click()
		await slidIn(sheet)
		await pull(page, sheet, { fromY: 0.2, by: height * 0.7, ms: 600 })
		await expect(sheet).toBeHidden()
		await expect(addItem).toBeFocused()

		// A quick flick down closes it from a distance too short to close it on its own:
		// the sheet follows only the second move, half the flick.
		await addItem.click()
		await slidIn(sheet)
		await pull(page, sheet, { fromY: 0.2, by: height * 0.5, ms: 0, steps: 2 })
		await expect(sheet).toBeHidden()
	})

	test('a pull that starts in a sideways scroller scrolls it, and a finger lifted off a removed node frees the sheet', async ({
		page,
		login,
	}) => {
		const { sheet } = await openAddSheet(page, await login())
		// Stand-ins: a row of chips that scrolls sideways, and a node the page
		// takes away while a finger is on it.
		await sheet.evaluate((panel) => {
			const row = document.createElement('div')
			row.dataset.testid = 'chips'
			row.style.cssText = 'overflow-x:auto;height:60px;white-space:nowrap'
			row.textContent = 'chip '.repeat(200)
			const doomed = document.createElement('div')
			doomed.dataset.testid = 'doomed'
			doomed.style.cssText = 'height:60px'
			panel.append(row, doomed)
		})
		// Taller now, so a pull long enough to close it is longer too.
		const height = (await sheet.boundingBox())!.height

		await pull(page, sheet.getByTestId('chips'), {
			fromY: 0.5,
			by: height * 0.7,
			ms: 400,
		})
		await expect(sheet).toBeVisible()
		expect(await restingOffset(sheet)).toBe(0)

		const finger = await fingerDown(page, sheet.getByTestId('doomed'), 0.5)
		await finger.move(20)
		await finger.move(60)
		await sheet.getByTestId('doomed').evaluate((node) => node.remove())
		await finger.lift()
		await pull(page, sheet, { fromY: 0.2, by: height * 0.7, ms: 600 })
		await expect(sheet).toBeHidden()
	})

	test('under reduced motion the sheet and backdrop still follow the finger', async ({
		page,
		login,
	}) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		const { sheet, height } = await openAddSheet(page, await login())
		const finger = await fingerDown(page, sheet, 0.2)
		for (const part of [0.05, 0.15, 0.3]) await finger.move(height * part)
		expect(await shownOffset(sheet)).toBeGreaterThan(height * 0.1)
		// Read at once: a backdrop that trails the finger is still near 1 here.
		expect(await shownShade(page)).toBeLessThan(0.9)
		await page.waitForTimeout(200)
		await finger.lift()
		expect(await restingOffset(sheet)).toBe(0)
	})

	test('a pull down on a scrolled Ingredients list scrolls it instead of closing the sheet', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Long Recipe',
				userId: user.id,
				householdId: user.householdId,
				ingredients: {
					create: Array.from({ length: 30 }, (_, index) => ({
						name: `ingredient ${index + 1}`,
						amount: String(index + 1),
						unit: 'g',
						order: index,
					})),
				},
				instructions: {
					create: Array.from({ length: 12 }, (_, index) => ({
						content: `Complete cooking step ${index + 1}.`,
						order: index,
					})),
				},
			},
		})
		await page.goto(`/recipes/${recipe.id}`)
		await page
			.getByRole('heading', { name: 'Instructions' })
			.scrollIntoViewIfNeeded()
		await page.getByRole('button', { name: /^Ingredients · / }).click()
		const sheet = page.getByRole('dialog', { name: 'Ingredients' })
		await slidIn(sheet)
		const list = sheet.locator('.overflow-y-auto')
		await list.evaluate((element) => {
			element.scrollTop = 300
		})

		await pull(page, list, { fromY: 0.3, by: 200, ms: 400 })
		await expect(sheet).toBeVisible()
		expect(await restingOffset(sheet)).toBe(0)
		expect(await list.evaluate((element) => element.scrollTop)).toBeLessThan(
			300,
		)

		// Back at the top, a pull past a third of the sheet closes it.
		await list.evaluate((element) => {
			element.scrollTop = 0
		})
		await pull(page, list, { fromY: 0.3, by: 320, ms: 400 })
		await expect(sheet).toBeHidden()
	})
})
