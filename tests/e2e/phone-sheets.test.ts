import { type Locator, type Page } from '@playwright/test'
import { getWeekStart, serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { SAFARI_UA, SHELL_UA } from '#tests/native-shell.ts'
import { expect, openShopping, test } from '#tests/playwright-utils.ts'

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
 * 500ms fallback: room to act while it leaves.
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

/** Taps until a tap lands on a hydrated page and `then` holds. */
async function tapUntil(control: Locator, then: () => Promise<void>) {
	await expect(async () => {
		await control.tap()
		await then()
	}).toPass({ timeout: 10_000 })
}

function todayUTC() {
	const today = new Date()
	return new Date(
		Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
	)
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
	const today = todayUTC()
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
	const sheet = page.getByRole('dialog', { name: 'Add a Meal' })
	await tapUntil(mobile.getByRole('button', { name: /^Add Meal to/ }), () =>
		expect(sheet).toBeVisible({ timeout: 1000 }),
	)
	await expectBottomSheet(page, sheet)
	// Nothing opened in place under the day.
	await expect(
		mobile.getByRole('region', { name: /^Add Meal for/ }),
	).toHaveCount(0)
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
	const sheet = page.getByRole('dialog', { name: 'Add a Meal' })
	await tapUntil(mobile.getByRole('button', { name: /^Add Meal to/ }), () =>
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
	await page.getByRole('menuitem', { name: 'Edit item' }).tap()
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
		name: 'What do you need this trip?',
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

test('Link recipe is a sheet; Enter in its search sends nothing; a pick leaves and focuses Remove recipe link', async ({
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
	await tapUntil(page.getByRole('button', { name: 'Link recipe' }), () =>
		expect(sheet).toBeVisible({ timeout: 1000 }),
	)
	await expectBottomSheet(page, sheet)
	const search = sheet.getByRole('textbox', { name: 'Search recipes' })
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
		page.getByRole('button', { name: 'Remove recipe link' }),
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
		const search = desktop.getByPlaceholder('Search recipes...')
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

		for (const [viewport, copy, inset] of [
			[{ width: 390, height: 844 }, 'mobile-plan', 44],
			[{ width: 1280, height: 800 }, 'desktop-plan', 32],
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
			// Between the two Recipes of one Meal: a hairline that starts past
			// the cooked toggle, not at the row's edge.
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
					left: Math.round(parseFloat(line.left)),
				}
			})
			expect(inner).toEqual({ width: '1px', left: inset })
		}

		// The cooked toggle and the Meal's menu still work on a phone.
		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
		const mobile = page.getByTestId('mobile-plan')
		await expect(async () => {
			await mobile
				.getByRole('button', { name: 'Mark Miso Soup as cooked' })
				.tap()
			await expect(
				mobile.getByRole('button', { name: 'Mark Miso Soup as not cooked' }),
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
	await page.getByRole('menuitem', { name: 'Edit item' }).tap()
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
		const editItem = page.getByRole('menuitem', { name: 'Edit item' })
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
			.getByRole('menuitem', { name: 'Edit item' })
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
		const mobile = page.getByTestId('mobile-plan')
		const sheet = page.getByRole('dialog', { name: 'Add a Meal' })
		await tapUntil(mobile.getByRole('button', { name: /^Add Meal to/ }), () =>
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

		await mobile.getByRole('button', { name: /^Add Meal to/ }).tap()
		await expect(
			sheet.getByPlaceholder('Search Recipes and Menus...'),
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
		const today = todayUTC()
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
		const sheet = page.getByRole('dialog', { name: 'Add a Meal' })
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
		const sheet = page.getByRole('dialog', { name: 'Add a Meal' })
		await tapUntil(
			page
				.getByTestId('mobile-plan')
				.getByRole('button', { name: /^Add Meal to/ }),
			() => expect(sheet).toBeVisible({ timeout: 1000 }),
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
		mobile.getByRole('button', { name: 'Remove Dal from this meal' }),
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
		mobile.getByRole('button', { name: 'Remove Dal from this meal' }),
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
	await picker.getByPlaceholder('Search recipes...').fill('ric')
	await picker.getByRole('button', { name: 'Close', exact: true }).click()
	await page.mouse.click(
		addBox.x + addBox.width / 2,
		addBox.y + addBox.height / 2,
	)
	await expect(picker).toHaveAttribute('data-state', 'open')
	await expect(picker.getByPlaceholder('Search recipes...')).toHaveValue('')
})

test('a sheet still leaving when its page goes plays its exit to the end', async ({
	page,
	login,
}) => {
	await seedShopping(await login(), ['foil'])
	await openShopping(page)
	const sheet = await openEditItem(page, 'foil')
	await expectBottomSheet(page, sheet)
	await recordSheetExits(page)
	await slowTransitions(page)
	await sheet.getByRole('button', { name: 'Close', exact: true }).tap()
	// Leave Shopping while the sheet is still on its way out.
	await page
		.locator('[data-bottom-nav]')
		.getByRole('link', { name: 'Plan' })
		.dispatchEvent('click')
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
		name: 'What do you need this trip?',
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
