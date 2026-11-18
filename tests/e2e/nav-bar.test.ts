import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { SHELL_UA, setShellSafeArea } from '#tests/native-shell.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const backButton = (page: Page, label: string) =>
	page.getByRole('link', { name: `Back to ${label}`, exact: true })

/** React has hydrated an element once it has attached its props to it. */
async function hydrated(target: Locator) {
	await expect
		.poll(() =>
			target.evaluate((element) =>
				Object.keys(element).some((key) => key.startsWith('__reactProps')),
			),
		)
		.toBe(true)
}

const historyIdx = (page: Page) =>
	page.evaluate(() => (window.history.state as { idx: number }).idx)

const brand = (page: Page) =>
	page.getByRole('banner').getByRole('link', { name: 'Quartermaster' })

async function createRecipes(
	user: { id: string; householdId: string },
	count: number,
) {
	await prisma.recipe.createMany({
		data: Array.from({ length: count }, (_, i) => ({
			title: `Soup ${String(i + 1).padStart(2, '0')}`,
			userId: user.id,
			householdId: user.householdId,
		})),
	})
}

/** A Recipe tall enough to scroll its title well under the bar. */
async function createLongRecipe(
	user: { id: string; householdId: string },
	title = 'Slow-roasted tomato soup',
) {
	return prisma.recipe.create({
		data: {
			title,
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: Array.from({ length: 12 }, (_, order) => ({
					name: `ingredient ${order + 1}`,
					order,
				})),
			},
			instructions: {
				create: Array.from({ length: 12 }, (_, order) => ({
					content: `Step ${order + 1}: stir, taste, and keep going a while longer.`,
					order,
				})),
			},
		},
		select: { id: true, title: true },
	})
}

test('Back from a Recipe returns to the list where it was', async ({
	page,
	login,
}) => {
	const user = await login()
	await createRecipes(user, 30)

	await page.goto('/recipes')
	// A tab root keeps the brand header and has no nav bar.
	await expect(brand(page)).toBeVisible()
	await expect(page.locator('[data-nav-bar]')).toHaveCount(0)

	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
	const card = page.getByRole('link', { name: /^Soup \d+ recipe/ }).last()
	await expect(card).toBeInViewport()
	const listScroll = await page.evaluate(() => window.scrollY)
	expect(listScroll).toBeGreaterThan(500)
	const listIdx = await historyIdx(page)
	await card.tap()
	await expect(page).toHaveURL(/\/recipes\/[^/]+$/)

	// The Recipe swaps the brand header for the nav bar.
	await expect(brand(page)).toBeHidden()
	const back = backButton(page, 'Recipes')
	await expect(back).toBeVisible()
	await expect(back).toHaveText('Recipes')
	const backBox = await back.boundingBox()
	expect(backBox?.height).toBeGreaterThanOrEqual(44)

	await back.tap()
	await expect(page).toHaveURL('/recipes')
	// It went back through history, not forward to a new copy of the list.
	expect(await historyIdx(page)).toBe(listIdx)
	await expect
		.poll(() => page.evaluate(() => window.scrollY))
		.toBeGreaterThan(listScroll - 5)
	expect(await page.evaluate(() => window.scrollY)).toBeLessThan(listScroll + 5)
})

test('Back from a deep-linked Recipe opens Recipes in its place', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createLongRecipe(user)

	await page.goto(`/recipes/${recipe.id}`)
	const lengthBefore = await page.evaluate(() => window.history.length)
	// A tap before hydration would be a full page load to the list.
	await hydrated(backButton(page, 'Recipes'))
	await backButton(page, 'Recipes').tap()
	await expect(page).toHaveURL('/recipes')
	await expect(
		page.getByRole('heading', { level: 1, name: /My Recipes/ }),
	).toBeVisible()
	// Replaced, so the Recipe is not left behind the list.
	expect(await page.evaluate(() => window.history.length)).toBe(lengthBefore)
})

test('a Recipe opened from a Menu goes back to the Menu', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createLongRecipe(user, 'Hummus')
	const menu = await prisma.menu.create({
		data: {
			title: 'Mezze night',
			titleKey: 'mezze night',
			householdId: user.householdId,
			sections: {
				create: {
					items: {
						create: {
							kind: 'recipe',
							recipeId: recipe.id,
							recipeTitle: 'Hummus',
							order: 0,
						},
					},
				},
			},
		},
		select: { id: true },
	})

	await page.goto(`/recipes/menus/${menu.id}`)
	// The Menu's own arrow link is gone; its nav bar goes back to Menus.
	await expect(backButton(page, 'Menus')).toBeVisible()
	await expect(
		page.locator('main').getByRole('link', { name: 'Menus' }),
	).toHaveCount(0)
	await page.getByRole('link', { name: /Hummus/ }).tap()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	await backButton(page, 'Menu').tap()
	await expect(page).toHaveURL(`/recipes/menus/${menu.id}`)
	// Cold, the Menu's parent is Menus.
	await backButton(page, 'Menus').tap()
	await expect(page).toHaveURL('/recipes/menus')
})

test.describe('in the iOS app', () => {
	test.use({ userAgent: SHELL_UA })

	test('the small title shows once the big one is under the bar, which sits under the status bar', async ({
		page,
		login,
	}) => {
		await setShellSafeArea(page, { top: 47, bottom: 34 })
		const user = await login()
		const recipe = await createLongRecipe(user)
		await page.goto(`/recipes/${recipe.id}`)

		const bar = page.locator('[data-nav-bar]')
		const title = page.locator('[data-nav-title]')
		const heading = page.getByRole('heading', { level: 1, name: recipe.title })
		await expect(heading).toBeVisible()
		// The bar is the 44pt row under the 47pt status bar.
		expect(await bar.boundingBox()).toMatchObject({ y: 47, height: 44 })
		await expect(title).toHaveCSS('opacity', '0')

		const barBottom = 47 + 44
		const headingTop = (await heading.boundingBox())!.y
		const headingHeight = (await heading.boundingBox())!.height
		// Halfway under the bar: the big title still shows, the small one not.
		await page.evaluate(
			(y) => window.scrollTo(0, y),
			headingTop - barBottom + headingHeight / 2,
		)
		await expect
			.poll(async () => (await heading.boundingBox())!.y)
			.toBeLessThan(barBottom)
		// Give the observer a frame to (wrongly) fire.
		await page.waitForTimeout(300)
		await expect(title).not.toHaveAttribute('data-shown')
		await expect(title).toHaveCSS('opacity', '0')

		// All the way under: the small title fades in, with the Recipe's name.
		await page.evaluate(
			(y) => window.scrollTo(0, y),
			headingTop - barBottom + headingHeight + 40,
		)
		await expect(title).toHaveAttribute('data-shown', '')
		await expect(title).toHaveAttribute('data-nav-title', recipe.title)
		await expect(title).toHaveCSS('opacity', '1')
		// The bar stays pinned under the status bar while the page scrolls.
		expect((await bar.boundingBox())?.y).toBe(47)

		// Back near the top, it goes again.
		await page.evaluate(() => window.scrollTo(0, 0))
		await expect(title).not.toHaveAttribute('data-shown')
	})
})

test('Save in the nav bar saves the edit and returns to the Recipe', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createLongRecipe(user, 'Lentil soup')

	await page.goto('/recipes')
	await hydrated(page.getByRole('link', { name: 'Lentil soup recipe' }))
	const listIdx = await historyIdx(page)
	await page.getByRole('link', { name: 'Lentil soup recipe' }).tap()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	await page.getByRole('link', { name: 'Edit Recipe' }).tap()
	await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)

	// The edit screen's bar holds Cancel and Save; the form has no Save of
	// its own.
	const save = page.locator('[data-nav-bar]').getByRole('button', {
		name: 'Save',
		exact: true,
	})
	await expect(save).toBeVisible()
	await expect(
		page.locator('[data-nav-bar]').getByRole('link', { name: 'Cancel' }),
	).toBeVisible()
	await expect(
		page.locator('main').getByRole('button', { name: /^(Save|Cancel)/ }),
	).toHaveCount(0)

	await page.getByLabel('Title').fill('Red lentil soup')
	await save.tap()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	await expect(
		page.getByRole('heading', { level: 1, name: 'Red lentil soup' }),
	).toBeVisible()
	const saved = await prisma.recipe.findUniqueOrThrow({
		where: { id: recipe.id },
		select: { title: true },
	})
	expect(saved.title).toBe('Red lentil soup')

	// Back from the saved Recipe steps over the edit form to the list.
	await backButton(page, 'Recipes').tap()
	await expect(page).toHaveURL('/recipes')
	expect(await historyIdx(page)).toBe(listIdx)
})

test('Cancel discards the edit', async ({ page, login }) => {
	const user = await login()
	const recipe = await createLongRecipe(user, 'Lentil soup')

	await page.goto(`/recipes/${recipe.id}`)
	await hydrated(page.getByRole('link', { name: 'Edit Recipe' }))
	await page.getByRole('link', { name: 'Edit Recipe' }).tap()
	await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
	await page.getByLabel('Title').fill('Something else')
	await page
		.locator('[data-nav-bar]')
		.getByRole('link', { name: 'Cancel' })
		.tap()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	await expect(
		page.getByRole('heading', { level: 1, name: 'Lentil soup' }),
	).toBeVisible()
	const kept = await prisma.recipe.findUniqueOrThrow({
		where: { id: recipe.id },
		select: { title: true },
	})
	expect(kept.title).toBe('Lentil soup')
})

test('Cancel on a deep-linked edit opens the Recipe in its place', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createLongRecipe(user, 'Lentil soup')
	await page.goto(`/recipes/${recipe.id}/edit`)
	const lengthBefore = await page.evaluate(() => window.history.length)
	const cancel = page
		.locator('[data-nav-bar]')
		.getByRole('link', { name: 'Cancel' })
	await hydrated(cancel)
	await cancel.tap()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	expect(await page.evaluate(() => window.history.length)).toBe(lengthBefore)
})

test('a title error after Save shows its field below the bar, not under it', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createLongRecipe(user, 'Lentil soup')

	await page.goto(`/recipes/${recipe.id}/edit`)
	await hydrated(page.getByLabel('Title'))
	await page.getByLabel('Title').fill('')
	await page.getByLabel('Title').blur()
	const barBottom = await page
		.locator('[data-nav-bar]')
		.evaluate((bar) => bar.getBoundingClientRect().bottom)
	// Scroll the field partly under the bar. The browser counts a field still
	// on screen as in view, so only the bar's scroll padding moves it out.
	await page.getByLabel('Title').evaluate((input, barBottom) => {
		const top = input.getBoundingClientRect().top + window.scrollY
		window.scrollTo(0, top - barBottom + 20)
	}, barBottom)
	expect((await page.getByLabel('Title').boundingBox())!.y).toBeLessThan(
		barBottom,
	)
	await page
		.locator('[data-nav-bar]')
		.getByRole('button', { name: 'Save' })
		.tap()

	const error = page.getByText('Title is required')
	await expect(error).toBeVisible()
	await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
	await expect(page.getByLabel('Title')).toBeFocused()
	await expect
		.poll(async () => (await page.getByLabel('Title').boundingBox())!.y)
		.toBeGreaterThanOrEqual(barBottom)
	const kept = await prisma.recipe.findUniqueOrThrow({
		where: { id: recipe.id },
		select: { title: true },
	})
	expect(kept.title).toBe('Lentil soup')
})

test('Settings goes back to the tab it came from, and its pages back to Settings', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/plan')
	await page.getByRole('link', { name: 'Settings' }).tap()
	await expect(page).toHaveURL('/settings/profile')
	await expect(backButton(page, 'Plan')).toBeVisible()

	await page.getByRole('link', { name: /Household/ }).tap()
	await expect(page).toHaveURL('/settings/profile/household')
	// The old text link back to Settings is gone; the bar has it.
	await expect(
		page.locator('main').getByRole('link', { name: 'Settings' }),
	).toHaveCount(0)
	await backButton(page, 'Settings').tap()
	await expect(page).toHaveURL('/settings/profile')
	await backButton(page, 'Plan').tap()
	await expect(page).toHaveURL('/plan')
	await expect(brand(page)).toBeVisible()
})
