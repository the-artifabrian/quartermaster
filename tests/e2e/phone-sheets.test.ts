import { type Locator, type Page } from '@playwright/test'
import { getWeekStart, serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { SHELL_UA } from '#tests/native-shell.ts'
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
	const meal = await prisma.meal.create({
		data: {
			mealPlan: {
				connectOrCreate: {
					where: {
						householdId_weekStart: {
							householdId: user.householdId,
							weekStart,
						},
					},
					create: { householdId: user.householdId, weekStart },
				},
			},
			date: today,
			order: 0,
			label: 'dinner',
			recipeItems: {
				create: { recipeId: recipe.id, recipeTitle: recipe.title, order: 0 },
			},
		},
	})
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
		.poll(() =>
			prisma.meal.findMany({
				where: { mealPlan: { householdId: user.householdId } },
				select: { label: true, recipeItems: { select: { recipeId: true } } },
			}),
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
		.poll(() =>
			prisma.meal.findMany({
				where: { mealPlan: { householdId: user.householdId } },
				select: { genericText: true },
			}),
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
		.poll(() =>
			prisma.mealRecipeItem.count({
				where: { mealId: meal.id, recipeId: rice.id },
			}),
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
	await expect(sheet).toBeHidden()
	await expect(mobile.getByText('· 6 guests')).toBeVisible()
	await expect
		.poll(
			async () =>
				(await prisma.meal.findUniqueOrThrow({ where: { id: meal.id } }))
					.guestCount,
		)
		.toBe(6)
	await expect(actions).toBeFocused()
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
	await sheet.getByRole('button', { name: 'Save' }).tap()
	await expect(sheet).toBeHidden()
	await expect(row).toContainText('2 rolls')
	await expect
		.poll(() =>
			prisma.shoppingListItem.findUniqueOrThrow({
				where: { id: list.items[0]!.id },
				select: { name: true, quantity: true, unit: true },
			}),
		)
		.toEqual({ name: 'foil', quantity: '2', unit: 'rolls' })
	await expect(actions).toBeFocused()
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
	const sheet = page.getByRole('dialog', { name: 'Scale this recipe' })
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
	await expect(page).toHaveURL(new RegExp(`/recipes/${recipe.id}\\?scale=2$`))
	await expect(page.getByText('Makes 24 pieces')).toBeVisible()
})

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
	await expect(sheet).toBeHidden()
	await expect(
		page.getByRole('group', { name: 'Milk shopping item' }),
	).toBeVisible()
	await expect
		.poll(() =>
			prisma.shoppingListItem.findMany({
				where: { list: { householdId: user.householdId } },
				select: { name: true, horizon: true },
				orderBy: { name: 'asc' },
			}),
		)
		.toEqual([
			{ name: 'Milk', horizon: 'next' },
			{ name: 'foil', horizon: 'next' },
		])
})

test('Link recipe is a sheet; Enter in its search leaves the Recipe form alone', async ({
	page,
	login,
}) => {
	const user = await login()
	const dough = await createRecipe(user, 'Pizza dough')

	await page.goto('/recipes/new')
	await page.getByRole('textbox', { name: 'Title' }).fill('Margherita')
	await page.getByRole('textbox', { name: 'Ingredient 1 name' }).fill('dough')
	const sheet = page.getByRole('dialog', { name: 'Link a recipe' })
	await tapUntil(page.getByRole('button', { name: 'Link recipe' }), () =>
		expect(sheet).toBeVisible({ timeout: 1000 }),
	)
	await expectBottomSheet(page, sheet)
	const search = sheet.getByRole('textbox', { name: 'Search recipes' })
	await expect(search).toBeFocused()
	await search.fill('pizza')
	await search.press('Enter')
	await expect(page).toHaveURL(/\/recipes\/new$/)
	await sheet.getByRole('button', { name: 'Pizza dough' }).tap()
	await expect(sheet).toBeHidden()
	await expect(page.getByText('Pizza dough', { exact: true })).toBeVisible()

	await page.getByRole('textbox', { name: 'Step 1' }).fill('Bake hot.')
	await page.getByRole('button', { name: 'Create Recipe' }).tap()
	await expect(page).not.toHaveURL(/\/recipes\/new$/)
	await expect
		.poll(() =>
			prisma.ingredient.findMany({
				where: {
					recipe: { title: 'Margherita', householdId: user.householdId },
				},
				select: { name: true, linkedRecipeId: true },
			}),
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
	await expect(page).toHaveURL(/\/plan/)
	await expect
		.poll(() =>
			prisma.meal.findMany({
				where: { mealPlan: { householdId: user.householdId } },
				select: { guestCount: true, sourceMenuId: true },
			}),
		)
		.toEqual([{ guestCount: 4, sourceMenuId: menu.id }])
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
			await expect(groups).toHaveCount(2)
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
				async () =>
					(
						await prisma.mealRecipeItem.findFirstOrThrow({
							where: { mealId: meal.id },
						})
					).cooked,
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

test.describe('tooltips in the iOS app', () => {
	test.use({ userAgent: SHELL_UA })

	test('focus coming back to a Recipe action after a sheet shows no tooltip', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user, 'Miso Soup')

		await page.goto(`/recipes/${recipe.id}`)
		await expect(page.locator('html')).toHaveAttribute('data-native-shell', '')
		const addToPlan = page.getByRole('button', { name: 'Add to Plan' })
		const sheet = page.getByRole('dialog', { name: 'Add to Plan' })
		await tapUntil(addToPlan, () =>
			expect(sheet).toBeVisible({ timeout: 1000 }),
		)
		await expectBottomSheet(page, sheet)
		await sheet.getByRole('button', { name: 'Close', exact: true }).tap()
		await expect(sheet).toBeHidden()
		// The case that showed one: focus back on a button with a tooltip.
		await expect(addToPlan).toBeFocused()
		await page.waitForTimeout(800)
		await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0)
	})
})
