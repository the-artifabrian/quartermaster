import { type Locator, type Page } from '@playwright/test'
import { getWeekStart } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { expect, openShopping, test } from '#tests/playwright-utils.ts'

// The base controls on a phone: a thumb gets at least 44px in each control,
// switches and segmented controls behave as iOS ones do, and what they set is
// what the app keeps.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function expectThumbTall(control: Locator) {
	await expect(control).toBeVisible()
	const box = await control.boundingBox()
	expect(box, 'control has a box').not.toBeNull()
	expect(box!.height).toBeGreaterThanOrEqual(44)
}

async function expectThumbSized(control: Locator) {
	await expectThumbTall(control)
	expect((await control.boundingBox())!.width).toBeGreaterThanOrEqual(44)
}

/** Taps until the tap lands on a hydrated page and `then` holds. */
async function tapUntil(
	control: Locator,
	then: () => Promise<void>,
	timeout = 10_000,
) {
	await expect(async () => {
		await control.tap()
		await then()
	}).toPass({ timeout })
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
			instructions: { create: { content: 'Whisk.', order: 0 } },
		},
	})
}

test('recipe form buttons, remove and classification chips are thumb-sized', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createRecipe(user)

	await page.goto(`/recipes/${recipe.id}/edit`)
	await expectThumbTall(
		page.getByRole('button', { name: 'Heading', exact: true }),
	)
	await expectThumbTall(
		page.getByRole('button', { name: 'Ingredient', exact: true }),
	)
	await expectThumbTall(page.getByRole('button', { name: 'Add Step' }))
	await expectThumbSized(
		page.getByRole('button', { name: 'Remove ingredient' }).first(),
	)

	await page.getByText('Classification', { exact: true }).click()
	await expectThumbTall(
		page
			.getByRole('group', { name: 'Season' })
			.getByRole('button', { name: 'Year-round' }),
	)
	await expectThumbTall(
		page
			.getByRole('group', { name: 'Course' })
			.getByRole('button', { name: 'Breakfast' }),
	)
	await expectThumbTall(page.getByRole('button', { name: 'Add cuisine' }))
})

test('Add a meal names its label chips as Add to Plan does, at thumb size', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/plan')
	const mobile = page.getByTestId('mobile-plan')
	const addMeal = mobile.getByRole('button', { name: /^Add Meal to/ }).first()
	await expectThumbTall(addMeal)
	const label = mobile.getByRole('group', { name: 'Label (optional)' })
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

test('Shopping From Staples, From Plan and the item editor Save are thumb-sized', async ({
	page,
	login,
}) => {
	const user = await login()
	// From Plan shows once something is planned.
	const recipe = await createRecipe(user)
	const today = new Date()
	const todayUTC = new Date(
		Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
	)
	await prisma.mealPlan.create({
		data: {
			householdId: user.householdId,
			weekStart: getWeekStart(todayUTC),
			meals: {
				create: {
					date: todayUTC,
					order: 0,
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
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: { create: { name: 'Foil' } },
		},
	})

	await openShopping(page)
	await expectThumbTall(page.getByRole('button', { name: /^From Staples/ }))
	await expectThumbTall(page.getByRole('button', { name: /^From Plan/ }))

	const foil = page.getByRole('group', { name: 'Foil shopping item' })
	await foil.getByRole('button', { name: 'Item actions' }).tap()
	await page.getByRole('menuitem', { name: 'Edit item' }).tap()
	await expectThumbTall(foil.getByRole('button', { name: 'Save' }))
})

test('Keep screen awake is a switch that holds its setting', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/settings/profile')
	const keepAwake = page.getByRole('switch', {
		name: 'Keep screen awake while a recipe is open',
	})
	// Read from the device after hydration; disabled until then.
	await expect(keepAwake).toBeEnabled()
	await expect(keepAwake).toHaveAttribute('aria-checked', 'true')
	await expectThumbSized(keepAwake)
	await expect(keepAwake).toHaveText('')

	await keepAwake.tap()
	await expect(keepAwake).toHaveAttribute('aria-checked', 'false')
	expect(await page.evaluate(() => localStorage.getItem('qm-keep-awake'))).toBe(
		'false',
	)

	await page.reload()
	await expect(keepAwake).toBeEnabled()
	await expect(keepAwake).toHaveAttribute('aria-checked', 'false')

	await keepAwake.tap()
	await expect(keepAwake).toHaveAttribute('aria-checked', 'true')
	expect(await page.evaluate(() => localStorage.getItem('qm-keep-awake'))).toBe(
		'true',
	)

	await expectThumbTall(page.getByRole('button', { name: 'Delete my account' }))
})

async function importTab(page: Page, name: string) {
	return page
		.getByRole('tablist', { name: 'Import from' })
		.getByRole('tab', { name, exact: true })
}

test('Import switches between URL and pasted text with a segmented control', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/recipes/import')
	const fromUrl = await importTab(page, 'From URL')
	const fromText = await importTab(page, 'From Text')
	await expect(fromUrl).toHaveAttribute('aria-selected', 'true')
	await expect(fromText).toHaveAttribute('aria-selected', 'false')
	await expectThumbTall(fromText)
	await expect(page.getByLabel('Recipe URL')).toBeVisible()

	await tapUntil(fromText, () =>
		expect(page.getByLabel('Recipe text')).toBeVisible({ timeout: 2000 }),
	)
	await expect(fromText).toHaveAttribute('aria-selected', 'true')
	await expect(fromUrl).toHaveAttribute('aria-selected', 'false')
	await expect(page.getByLabel('Recipe URL')).toHaveCount(0)

	await fromUrl.tap()
	await expect(page.getByLabel('Recipe URL')).toBeVisible()
	await expect(fromUrl).toHaveAttribute('aria-selected', 'true')
})

test('Recipes and Menus switch with a thumb-sized segmented control', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/recipes')
	const library = page.getByRole('navigation', { name: 'Library' })
	const recipes = library.getByRole('link', { name: 'Recipes', exact: true })
	const menus = library.getByRole('link', { name: 'Menus', exact: true })
	await expect(recipes).toHaveAttribute('aria-current', 'page')
	await expectThumbTall(menus)

	await menus.tap()
	await expect(page).toHaveURL(/\/recipes\/menus$/)
	await expect(menus).toHaveAttribute('aria-current', 'page')
	await expect(recipes).not.toHaveAttribute('aria-current', 'page')

	await recipes.tap()
	await expect(page).toHaveURL(/\/recipes$/)
	await expect(recipes).toHaveAttribute('aria-current', 'page')
})
