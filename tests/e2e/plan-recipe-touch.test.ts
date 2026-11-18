import { type Locator, type Page } from '@playwright/test'
import { getWeekStart, serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 } })

async function expectThumbSized(control: Locator) {
	await expect(control).toBeVisible()
	const box = await control.boundingBox()
	expect(box).not.toBeNull()
	expect(box!.width).toBeGreaterThanOrEqual(44)
	expect(box!.height).toBeGreaterThanOrEqual(44)
}

// Clicks just outside a control's drawn box, where only an enlarged tap
// area reaches.
async function clickJustOutside(
	page: Page,
	control: Locator,
	side: 'top' | 'right',
) {
	const box = (await control.boundingBox())!
	if (side === 'top') {
		await page.mouse.click(box.x + box.width / 2, box.y - 4)
	} else {
		await page.mouse.click(box.x + box.width + 4, box.y + box.height / 2)
	}
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
	await expect(sheet).toBeVisible()
	// A sheet spans the screen; the popover was 288px wide.
	expect((await sheet.boundingBox())!.width).toBeGreaterThanOrEqual(360)

	const tomorrow = sheet.getByRole('button', { name: 'Tomorrow' })
	const lunch = sheet.getByRole('button', { name: 'Lunch' })
	await expectThumbSized(tomorrow)
	await expectThumbSized(lunch)
	await tomorrow.click()
	await lunch.click()
	await expect(tomorrow).toHaveAttribute('aria-pressed', 'true')
	await expect(lunch).toHaveAttribute('aria-pressed', 'true')
	await sheet.getByRole('button', { name: 'Add to Plan' }).click()
	await expect(page.getByText(/^Added to .+ Lunch$/)).toBeVisible()
	await expect(sheet).toBeHidden()

	const meals = await prisma.meal.findMany({
		where: { mealPlan: { householdId: user.householdId } },
		select: { label: true, recipeItems: { select: { recipeId: true } } },
	})
	expect(meals).toEqual([
		{ label: 'lunch', recipeItems: [{ recipeId: recipe.id }] },
	])
})

test('Plan meal and Add Meal controls take taps around their drawn edges', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createRecipe(user)
	const today = new Date()
	const todayUTC = new Date(
		Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
	)
	const weekStart = getWeekStart(todayUTC)
	await prisma.mealPlan.create({
		data: {
			householdId: user.householdId,
			weekStart,
			meals: {
				create: {
					date: todayUTC,
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
	await expect(async () => {
		await clickJustOutside(page, mealActions, 'right')
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
	await clickJustOutside(page, lunch, 'top')
	await expect(lunch).toHaveAttribute('aria-pressed', 'true')
	await expect(
		mobile.getByRole('textbox', { name: 'Search Recipes and Menus' }),
	).toBeVisible()
	await expectThumbSized(
		mobile.getByRole('button', { name: /^Add text instead/ }),
	)
})
