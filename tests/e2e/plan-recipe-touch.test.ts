import { type Locator, type Page } from '@playwright/test'
import { getWeekStart, serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

/** Waits for a sheet to finish sliding in, so its controls hold still. */
async function slidIn(sheet: Locator) {
	await expect(sheet).toBeVisible()
	await sheet.evaluate((element) =>
		Promise.all(element.getAnimations().map((a) => a.finished)),
	)
}

async function expectThumbSized(control: Locator) {
	await expect(control).toBeVisible()
	const box = await control.boundingBox()
	expect(box).not.toBeNull()
	expect(box!.width).toBeGreaterThanOrEqual(44)
	expect(box!.height).toBeGreaterThanOrEqual(44)
}

// Taps just right of a control's drawn box, where only an enlarged tap area
// reaches. A finger, so controls that open on a tap are tested as a phone
// uses them.
async function tapJustRightOf(page: Page, control: Locator) {
	const box = (await control.boundingBox())!
	await page.touchscreen.tap(box.x + box.width + 4, box.y + box.height / 2)
}

function todayUTC() {
	const today = new Date()
	return new Date(
		Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
	)
}

async function createRecipe(user: { id: string; householdId: string }) {
	return prisma.recipe.create({
		data: {
			title: 'Miso Soup',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: { name: 'miso', amount: '2', unit: 'tbsp', order: 0 },
			},
		},
	})
}

test('on a phone, Add to Plan opens as a sheet with thumb-sized choices', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createRecipe(user)

	await page.goto(`/recipes/${recipe.id}`)
	await page.getByRole('button', { name: 'Add to Plan' }).click()
	const sheet = page.getByRole('dialog', { name: 'Add to Plan' })
	await slidIn(sheet)
	// A sheet spans the screen; the popover was 288px wide.
	expect((await sheet.boundingBox())!.width).toBeGreaterThanOrEqual(360)

	const tomorrow = sheet.getByRole('button', { name: 'Tomorrow' })
	const lunch = sheet.getByRole('button', { name: 'Lunch' })
	await expectThumbSized(tomorrow)
	await expectThumbSized(lunch)
	await tomorrow.tap()
	await lunch.tap()
	await expect(tomorrow).toHaveAttribute('aria-pressed', 'true')
	await expect(lunch).toHaveAttribute('aria-pressed', 'true')
	await sheet.getByRole('button', { name: 'Add to Plan' }).click()
	await expect(page.getByText(/^Added to .+ Lunch$/)).toBeVisible()
	await expect(sheet).toBeHidden()

	const meals = await prisma.meal.findMany({
		where: { mealPlan: { householdId: user.householdId } },
		select: {
			date: true,
			label: true,
			recipeItems: { select: { recipeId: true } },
		},
	})
	const tomorrowUTC = new Date(todayUTC().getTime() + 24 * 60 * 60 * 1000)
	expect(meals).toEqual([
		{
			date: tomorrowUTC,
			label: 'lunch',
			recipeItems: [{ recipeId: recipe.id }],
		},
	])
})

test('a phone on its side gets the sheet too; a desktop gets the popover', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createRecipe(user)

	await page.setViewportSize({ width: 844, height: 390 })
	await page.goto(`/recipes/${recipe.id}`)
	await page.getByRole('button', { name: 'Add to Plan' }).click()
	const sheet = page.getByRole('dialog', { name: 'Add to Plan' })
	await slidIn(sheet)
	await expect(page.locator('[data-bottom-sheet]')).toHaveCount(1)
	await expectThumbSized(sheet.getByRole('button', { name: 'Tomorrow' }))
	await page.keyboard.press('Escape')
	await expect(sheet).toBeHidden()

	// A wider, taller screen keeps the popover.
	await page.setViewportSize({ width: 1024, height: 768 })
	await page.getByRole('button', { name: 'Add to Plan' }).click()
	await expect(
		page.getByRole('dialog').getByRole('button', { name: 'Add to Plan' }),
	).toBeVisible()
	await expect(page.locator('[data-bottom-sheet]')).toHaveCount(0)
})

test('the floating Ingredients button steps aside while Add to Plan is open', async ({
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
				create: Array.from({ length: 12 }, (_, index) => ({
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
	await page.getByRole('button', { name: 'Add to Plan' }).click()
	const sheet = page.getByRole('dialog', { name: 'Add to Plan' })
	await slidIn(sheet)
	// The page behind still scrolls, past the point where the button shows.
	await page.evaluate(() =>
		window.scrollTo(0, document.documentElement.scrollHeight),
	)
	const floating = page.getByRole('button', { name: /^Ingredients · / })
	await expect(sheet).toBeVisible()
	await expect(floating).toBeHidden()
	await page.keyboard.press('Escape')
	await expect(floating).toBeVisible()
})

test('Plan meal and Add Meal controls take taps around their drawn edges', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createRecipe(user)
	const today = todayUTC()
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
						create: {
							recipeId: recipe.id,
							recipeTitle: recipe.title,
							order: 0,
						},
					},
				},
			},
		},
	})

	await page.goto(`/plan?weekStart=${serializeDate(weekStart)}`)
	const mobile = page.getByTestId('mobile-plan')
	const mealActions = mobile.getByRole('button', {
		name: 'Meal actions for Miso Soup',
	})
	await expect(mealActions).toBeVisible()
	// A scroll that starts on the button leaves the menu shut.
	const box = (await mealActions.boundingBox())!
	const x = box.x + box.width / 2
	const y = box.y + box.height / 2
	const cdp = await page.context().newCDPSession(page)
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ x, y, id: 1 }],
	})
	for (const dy of [-15, -30, -45, -60]) {
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x, y: y + dy, id: 1 }],
		})
	}
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	})
	await cdp.detach()
	await expect(page.getByRole('menu')).toBeHidden()
	await expect(async () => {
		await tapJustRightOf(page, mealActions)
		await expect(
			page.getByRole('menuitem', { name: 'Edit details' }),
		).toBeVisible({ timeout: 1000 })
	}).toPass()
	await page.getByRole('menuitem', { name: 'Edit details' }).click()
	await expectThumbSized(mobile.getByLabel('Guests'))
	await expectThumbSized(mobile.getByRole('button', { name: 'Save' }))
	await mobile.getByRole('button', { name: 'Cancel' }).click()

	await mobile.getByRole('button', { name: /^Add Meal to/ }).click()
	const lunch = mobile.getByRole('button', { name: 'Lunch' })
	await expect(lunch).toBeVisible()
	// Measured once the section has finished sliding up into place.
	await lunch.evaluate((element) =>
		Promise.all(
			element
				.closest('.animate-fade-up-reveal')!
				.getAnimations()
				.map((animation) => animation.finished),
		),
	)
	await expectThumbSized(lunch)
	await lunch.tap()
	await expect(lunch).toHaveAttribute('aria-pressed', 'true')
	await expect(
		mobile.getByRole('textbox', { name: 'Search Recipes and Menus' }),
	).toBeVisible()
	await expectThumbSized(
		mobile.getByRole('button', { name: /^Add text instead/ }),
	)
})
