import { type Page } from '@playwright/test'
import sharp from 'sharp'
import { getWeekStart, serializeDate } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { SHELL_UA, setShellSafeArea } from '#tests/native-shell.ts'
import {
	animationsFinished,
	browserToday,
	expect,
	hydrated,
	test,
} from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const backButton = (page: Page, label: string) =>
	page.getByRole('link', { name: `Back to ${label}`, exact: true })

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
	await hydrated(card)
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
		page.getByRole('heading', { level: 1, name: /^Recipes \(/ }),
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
	await hydrated(page.getByRole('link', { name: /Hummus/ }))
	const menuIdx = await historyIdx(page)
	await page.getByRole('link', { name: /Hummus/ }).tap()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)

	// Hold the Menu's data, so the Recipe stays up while the pop loads.
	let release = () => {}
	const held = new Promise<void>((resolve) => (release = resolve))
	let requested = false
	await page.route(/\/recipes\/menus\/[^/]+\.data/, async (route) => {
		requested = true
		await held
		await route.continue()
	})
	await backButton(page, 'Menu').tap()
	await expect.poll(() => requested).toBe(true)
	// Still on the Recipe: the label still names the Menu, and a second tap
	// neither goes back again nor replaces the Menu with Recipes.
	await expect(backButton(page, 'Menu')).toBeVisible()
	await backButton(page, 'Menu').tap()
	release()
	await expect(page).toHaveURL(`/recipes/menus/${menu.id}`)
	await expect(
		page.getByRole('heading', { level: 1, name: 'Mezze night' }),
	).toBeVisible()
	expect(await historyIdx(page)).toBe(menuIdx)
	await page.unrouteAll()
	// Cold, the Menu's parent is Menus.
	await backButton(page, 'Menus').tap()
	await expect(page).toHaveURL('/recipes/menus')
})

test('a page opened from a scrolled page does not start with its title in the bar', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/settings/profile')
	const household = page.getByRole('link', { name: /Household/ })
	await hydrated(household)
	// Scroll Settings' own title under the bar; its small title shows. Scroll
	// again if it doesn't, and say where the page and the bar were if it
	// never does.
	const title = page.locator('[data-nav-title]')
	await expect(async () => {
		const where = await page.evaluate(() => {
			window.scrollTo(0, 200)
			return {
				scrollY: window.scrollY,
				barBottom: document
					.querySelector('[data-nav-bar]')
					?.getBoundingClientRect().bottom,
			}
		})
		await expect(
			title,
			`small title hidden at ${JSON.stringify(where)}`,
		).toHaveAttribute('data-shown', '', { timeout: 1000 })
	}).toPass({ timeout: 5000 })
	await expect(title).toHaveAttribute('data-nav-title', 'Settings')

	// Record, in every frame from here on, which page is on screen (its h1;
	// the URL changes before the router commits the page) and the bar.
	await page.evaluate(() => {
		const frames: string[] = []
		Object.assign(window, { __frames: frames })
		const sample = () => {
			const bar = document.querySelector('[data-nav-title]')
			const heading = document.querySelector('#main-content h1')
			frames.push(
				`${heading?.textContent?.trim()}: ${bar?.hasAttribute('data-shown') ? 'shown' : 'hidden'} ${bar?.getAttribute('data-nav-title')}`,
			)
			requestAnimationFrame(sample)
		}
		requestAnimationFrame(sample)
	})
	await household.tap()
	await expect(page).toHaveURL('/settings/profile/household')
	await expect(
		page.getByRole('heading', { level: 1, name: 'Household' }),
	).toBeVisible()
	await animationsFinished(page)
	const frames = await page.evaluate(
		() => (window as unknown as { __frames: string[] }).__frames,
	)
	expect(frames.some((f) => f.startsWith('Household:'))).toBe(true)
	expect(
		frames.filter((f) => f.startsWith('Household:') && f.includes(' shown ')),
	).toEqual([])
})

test.describe('in the iOS app', () => {
	test.use({ userAgent: SHELL_UA })

	test('the floating Ingredients button shows once the heading is under the bar', async ({
		page,
		login,
	}) => {
		await setShellSafeArea(page, { top: 47, bottom: 34 })
		const user = await login()
		const recipe = await createLongRecipe(user)
		await page.goto(`/recipes/${recipe.id}`)
		const scale = page.getByRole('button', { name: 'Scale 1×' })
		await hydrated(scale)
		const floating = page.locator('[data-floating-ingredients]')
		await expect(floating).toHaveCount(0)
		// The Ingredients heading row under the bar (47 + 44), still on screen.
		await scale.evaluate((button) => {
			const bottom = button.getBoundingClientRect().bottom + window.scrollY
			window.scrollTo(0, bottom - 60)
		})
		const box = (await scale.boundingBox())!
		expect(box.y + box.height).toBeGreaterThan(0)
		expect(box.y + box.height).toBeLessThan(91)
		await expect(floating).toBeVisible()
	})

	test('the bar re-measures when the status bar inset changes', async ({
		page,
		login,
	}) => {
		await setShellSafeArea(page, { top: 47, bottom: 34 })
		const user = await login()
		const recipe = await createLongRecipe(user)
		await page.goto(`/recipes/${recipe.id}`)
		const barBottom = () =>
			page.evaluate(() =>
				document.documentElement.style.getPropertyValue('--nav-bar-bottom'),
			)
		await expect.poll(barBottom).toBe('91px')
		await page.evaluate(() =>
			document.documentElement.style.setProperty('--qm-shell-safe-top', '59px'),
		)
		await expect.poll(barBottom).toBe('103px')
	})

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

test.describe('on a sideways iPhone in the iOS app', () => {
	test.use({
		userAgent: SHELL_UA,
		viewport: { width: 844, height: 390 },
		hasTouch: true,
	})

	test('a Recipe keeps the bar and its Back, though the screen is desktop-wide', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createLongRecipe(user, 'Lentil soup')
		await page.goto(`/recipes/${recipe.id}`)
		// As wide as a desktop, but with a finger, not a mouse.
		expect(
			await page.evaluate(() => ({
				wide: matchMedia('(width >= 48rem)').matches,
				mouse: matchMedia('(pointer: fine)').matches,
			})),
		).toEqual({ wide: true, mouse: false })

		const bar = page.locator('[data-nav-bar]')
		const back = backButton(page, 'Recipes')
		await expect(back).toBeVisible()
		await expect(back).toHaveText('Recipes')
		// Content clears the bar, not just the header row above it.
		const barBottom = Math.round((await bar.boundingBox())!.y + 44)
		await expect
			.poll(() =>
				page.evaluate(() =>
					document.documentElement.style.getPropertyValue('--nav-bar-bottom'),
				),
			)
			.toBe(`${barBottom}px`)

		await hydrated(back)
		await back.tap()
		await expect(page).toHaveURL('/recipes')
		await expect(
			page.getByRole('heading', { level: 1, name: 'Recipes' }),
		).toBeVisible()
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

	// Back from the saved Recipe steps over the edit form to the list. (The
	// slide is the iOS app's: page-transitions.test.ts.)
	await backButton(page, 'Recipes').tap()
	await expect(page).toHaveURL('/recipes')
	expect(await historyIdx(page)).toBe(listIdx)
})

test('Cancel discards the edit', async ({ page, login }) => {
	const user = await login()
	const recipe = await createLongRecipe(user, 'Lentil soup')

	await page.goto(`/recipes/${recipe.id}`)
	await hydrated(page.getByRole('link', { name: 'Edit Recipe' }))
	const recipeIdx = await historyIdx(page)
	await page.getByRole('link', { name: 'Edit Recipe' }).tap()
	await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
	await page.getByLabel('Title').fill('Something else')
	await page
		.locator('[data-nav-bar]')
		.getByRole('link', { name: 'Cancel' })
		.tap()
	// With a change, Cancel asks first (edit-screens.test.ts).
	await page
		.getByRole('dialog', { name: 'Discard changes?' })
		.getByRole('button', { name: 'Discard Changes' })
		.tap()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	// Popped back to the Recipe's own entry, not a new copy of it.
	expect(await historyIdx(page)).toBe(recipeIdx)
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

	const error = page.getByText('Add a title')
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
	await hydrated(page.getByRole('link', { name: 'Settings' }))
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

/** A JPEG over the 3 MB upload limit, so the form shrinks it first. */
async function bulkyPhoto() {
	const jpeg = await sharp({
		create: { width: 64, height: 48, channels: 3, background: '#c86b3c' },
	})
		.jpeg()
		.toBuffer()
	const comment = Buffer.alloc(65_535 + 2, 0x20)
	comment.writeUInt16BE(0xfffe, 0)
	comment.writeUInt16BE(65_535, 2)
	const comments = Array.from({ length: 64 }, () => comment)
	return Buffer.concat([jpeg.subarray(0, 2), ...comments, jpeg.subarray(2)])
}

const scrollY = (page: Page) => page.evaluate(() => window.scrollY)

test('a Recipe opened from the Plan goes back to the Plan where it was', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipes = []
	for (let i = 1; i <= 12; i++) {
		recipes.push(await createLongRecipe(user, `Dish ${i}`))
	}
	const today = browserToday()
	const weekStart = getWeekStart(today)
	await prisma.mealPlan.create({
		data: {
			householdId: user.householdId,
			weekStart,
			meals: {
				create: recipes.map((recipe, order) => ({
					date: today,
					order,
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
	const last = page
		.getByTestId('mobile-plan')
		.getByRole('link', { name: 'Dish 12', exact: true })
	await last.scrollIntoViewIfNeeded()
	await hydrated(last)
	const planIdx = await historyIdx(page)
	await last.tap()
	await expect(page).toHaveURL(`/recipes/${recipes[11]!.id}`)

	await backButton(page, 'Plan').tap()
	await expect(page).toHaveURL(/\/plan/)
	expect(await historyIdx(page)).toBe(planIdx)
	await expect(last).toBeInViewport()
	// The same place the browser's own Back restores. (Both land about 96px
	// above where the tap was: the router saves the Plan's place as it
	// leaves, not at the tap.)
	const afterBack = await scrollY(page)
	expect(afterBack).toBeGreaterThan(0)
	await page.goForward()
	await expect(page).toHaveURL(`/recipes/${recipes[11]!.id}`)
	await page.goBack()
	await expect(page).toHaveURL(/\/plan/)
	await expect.poll(() => scrollY(page)).toBeGreaterThan(afterBack - 5)
	expect(await scrollY(page)).toBeLessThan(afterBack + 5)
})

test('Back from a Recipe the tab bar restored returns to the filtered list where it was', async ({
	page,
	login,
}) => {
	const user = await login()
	await createRecipes(user, 30)
	const tab = (name: string) =>
		page
			.getByRole('navigation', { name: 'Main' })
			.getByRole('link', { name, exact: true })

	await page.goto('/recipes?search=Soup')
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
	const card = page.getByRole('link', { name: /^Soup \d+ recipe/ }).last()
	await expect(card).toBeInViewport()
	await hydrated(card)
	const listScroll = await scrollY(page)
	expect(listScroll).toBeGreaterThan(500)
	const listIdx = await historyIdx(page)
	await card.tap()
	await expect(page).toHaveURL(/\/recipes\/[^/?]+$/)
	const recipeUrl = page.url()

	// To the Plan and back with the tab bar, which restores the Recipe.
	await tab('Plan').tap()
	await expect(page).toHaveURL('/plan')
	// From the keyboard this time, the tab link's own click.
	await tab('Recipes').focus()
	await page.keyboard.press('Enter')
	await expect(page).toHaveURL(recipeUrl)

	await backButton(page, 'Recipes').tap()
	await expect(page).toHaveURL('/recipes?search=Soup')
	expect(await historyIdx(page)).toBe(listIdx)
	await expect.poll(() => scrollY(page)).toBeGreaterThan(listScroll - 5)
	expect(await scrollY(page)).toBeLessThan(listScroll + 5)
})

test("an edit page showing its error has Back, not the form's Cancel and Save", async ({
	page,
	login,
}) => {
	await login()
	// Not even before hydration: the server's page has no Save either.
	const html = await (
		await page.request.get('/recipes/no-such-recipe/edit')
	).text()
	expect(html).toContain('data-nav-back')
	expect(html).not.toContain('data-nav-save')

	await page.goto('/recipes/no-such-recipe/edit')
	const bar = page.locator('[data-nav-bar]')
	await hydrated(backButton(page, 'Recipe'))
	await expect(bar.getByRole('button', { name: 'Save' })).toHaveCount(0)
	await expect(bar.getByRole('link', { name: 'Cancel' })).toHaveCount(0)
	// The not-found page has its own h1, and the bar is still measured, so
	// toasts open below it.
	await expect(page.locator('#main-content h1')).toHaveText('Recipe not found')
	await expect
		.poll(() =>
			page.evaluate(() =>
				document.documentElement.style.getPropertyValue('--nav-bar-bottom'),
			),
		)
		.toBe('44px')
})

test('Return in an ingredient or a Menu builder field does not save; in a Recipe or new Menu title it does', async ({
	page,
	login,
}) => {
	const user = await login()
	await page.goto('/recipes/new')
	const title = page.getByRole('textbox', { name: /title/i })
	await hydrated(title)
	await title.fill('Return pasta')
	// A form that would pass validation, so only the Return guard stops it.
	await page.getByPlaceholder('Step 1').fill('Boil.')
	const ingredient = page.getByPlaceholder('Ingredient name')
	await ingredient.fill('spaghetti')
	await ingredient.press('Enter')
	await page.waitForTimeout(500)
	await expect(page).toHaveURL('/recipes/new')
	expect(await prisma.recipe.count({ where: { title: 'Return pasta' } })).toBe(
		0,
	)
	// The title saves on Return, as it did when the form had its own Save.
	await title.press('Enter')
	await expect(page).toHaveURL(/\/recipes\/(?!new)[^/]+$/)
	expect(await prisma.recipe.count({ where: { title: 'Return pasta' } })).toBe(
		1,
	)

	const menu = await prisma.menu.create({
		data: {
			title: 'Mezze night',
			titleKey: 'mezze night',
			householdId: user.householdId,
			sections: { create: { order: 0 } },
		},
		select: { id: true },
	})
	await page.goto(`/recipes/menus/${menu.id}/edit`)
	const sectionName = page.getByPlaceholder(/Section name/).first()
	await hydrated(sectionName)
	await sectionName.fill('Dessert')
	await sectionName.press('Enter')
	await page.waitForTimeout(500)
	await expect(page).toHaveURL(`/recipes/menus/${menu.id}/edit`)
	expect(
		await prisma.menuSection.count({
			where: { menuId: menu.id, name: 'Dessert' },
		}),
	).toBe(0)
	// A Menu builder's title did nothing on Return before, and still does not.
	const menuTitle = page.getByLabel('Title', { exact: true })
	await menuTitle.fill('Mezze nights')
	await menuTitle.press('Enter')
	await page.waitForTimeout(500)
	await expect(page).toHaveURL(`/recipes/menus/${menu.id}/edit`)
	expect(
		(await prisma.menu.findUniqueOrThrow({ where: { id: menu.id } })).title,
	).toBe('Mezze night')

	// A new Menu's title saves on Return.
	await page.goto('/recipes/menus/new')
	const newTitle = page.getByLabel('Title', { exact: true })
	await hydrated(newTitle)
	await newTitle.fill('Return dinner')
	await newTitle.press('Enter')
	await expect(page).toHaveURL(/\/recipes\/menus\/(?!new)[^/]+$/)
	expect(
		await prisma.menu.count({
			where: { householdId: user.householdId, title: 'Return dinner' },
		}),
	).toBe(1)
})

test('Save waits for a photo still being shrunk', async ({ page, login }) => {
	await login()
	// Hold the browser's image decode until the test lets it go.
	await page.addInitScript(() => {
		const decode = window.createImageBitmap.bind(window)
		let release = () => {}
		const held = new Promise<void>((resolve) => (release = resolve))
		Object.assign(window, { __releasePhoto: () => release() })
		window.createImageBitmap = (async (
			...args: Parameters<typeof createImageBitmap>
		) => {
			await held
			return decode(...args)
		}) as typeof createImageBitmap
	})
	await page.goto('/recipes/new')
	const title = page.getByRole('textbox', { name: /title/i })
	await hydrated(title)
	await title.fill('Photo pasta')
	await page.getByPlaceholder('Ingredient name').fill('spaghetti')
	await page.getByPlaceholder('Step 1').fill('Boil.')
	await page.getByText('Photo', { exact: true }).click()
	const save = page
		.locator('[data-nav-bar]')
		.getByRole('button', { name: 'Save', exact: true })
	await expect(save).toBeEnabled()
	await page.locator('input[type="file"][name="image"]').setInputFiles({
		name: 'IMG_0001.JPG',
		mimeType: 'image/jpeg',
		buffer: await bulkyPhoto(),
	})
	await expect(save).toBeDisabled()
	await page.evaluate(() =>
		(window as unknown as { __releasePhoto: () => void }).__releasePhoto(),
	)
	await expect(save).toBeEnabled()
	await save.tap()
	await expect(page).toHaveURL(/\/recipes\/(?!new)[^/]+$/)
	const saved = await prisma.recipe.findFirstOrThrow({
		where: { title: 'Photo pasta' },
		select: { image: { select: { objectKey: true } } },
	})
	expect(saved.image?.objectKey).toBeTruthy()
})

test('Save shows it is saving and sends the edit once', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createLongRecipe(user, 'Lentil soup')
	await page.goto(`/recipes/${recipe.id}/edit`)
	const title = page.getByLabel('Title')
	await hydrated(title)
	await title.fill('Red lentil soup')

	let posts = 0
	let release = () => {}
	const held = new Promise<void>((resolve) => (release = resolve))
	await page.route(/\/edit\.data/, async (route) => {
		if (route.request().method() !== 'POST') return route.continue()
		posts++
		await held
		await route.continue().catch(() => {})
	})
	const save = page.locator('[data-nav-save]')
	await save.tap()
	await expect(save).toBeDisabled()
	await expect(save).toHaveAttribute('aria-busy', 'true')
	await expect(save).toHaveText('Saving')
	await save.tap({ force: true })
	await page.waitForTimeout(300)
	release()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	expect(posts).toBe(1)
})

test('the small title stays hidden while the big one is still below the fold', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createLongRecipe(user, 'Lentil soup')
	// So short that the page's h1 starts below the screen.
	await page.setViewportSize({ width: 390, height: 56 })
	await page.goto(`/recipes/${recipe.id}`)
	const title = page.locator('[data-nav-title]')
	// The observer has reported: it has read the h1.
	await expect(title).toHaveAttribute('data-nav-title', 'Lentil soup')
	const headingTop = await page
		.getByRole('heading', { level: 1, name: 'Lentil soup' })
		.evaluate((h1) => h1.getBoundingClientRect().top)
	expect(headingTop).toBeGreaterThan(56)
	await expect(title).not.toHaveAttribute('data-shown')
})

test('changing the scale keeps the Recipe where it was, small title and all', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createLongRecipe(user, 'Lentil soup')
	await page.goto(`/recipes/${recipe.id}`)
	const scale = page.getByRole('button', { name: 'Scale 1×' })
	await hydrated(scale)
	// The big title under the bar, the scale control just below it.
	await scale.evaluate((button) => {
		const top = button.getBoundingClientRect().top + window.scrollY
		window.scrollTo(0, top - 65)
	})
	const title = page.locator('[data-nav-title]')
	await expect(title).toHaveAttribute('data-shown', '')
	const before = await scrollY(page)
	await page.evaluate(() => {
		const frames: boolean[] = []
		Object.assign(window, { __frames: frames })
		const sample = () => {
			frames.push(
				document.querySelector('[data-nav-title]')!.hasAttribute('data-shown'),
			)
			requestAnimationFrame(sample)
		}
		requestAnimationFrame(sample)
	})
	await scale.tap()
	await page.getByRole('button', { name: 'Increase Recipe scale' }).tap()
	await expect(page).toHaveURL(/scale=/)
	// The new scale has rendered, so anything it moves has started moving.
	await expect(scale).toHaveCount(0)
	await animationsFinished(page)
	expect(Math.abs((await scrollY(page)) - before)).toBeLessThan(5)
	const frames = await page.evaluate(
		() => (window as unknown as { __frames: boolean[] }).__frames,
	)
	expect(frames.every(Boolean)).toBe(true)
})

test('a toast on a pushed page opens below the bar', async ({
	page,
	login,
}) => {
	const user = await login()
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
	const menu = await prisma.menu.create({
		data: {
			title: 'Mezze night',
			titleKey: 'mezze night',
			householdId: user.householdId,
		},
		select: { id: true },
	})
	// The toast opens below the pinned header: on a phone its last row is the
	// nav bar; on desktop the header has no bar here, only its links row.
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		await page.setViewportSize(viewport)
		await page.goto(`/recipes/menus/${menu.id}`)
		const share = page.getByRole('button', { name: 'Share' })
		await hydrated(share)
		await share.click()
		const toast = page.locator('[data-sonner-toast]').filter({
			hasText: 'Public link copied',
		})
		await expect(toast).toBeVisible()
		const headerBottom = await page
			.locator('[data-site-header]')
			.evaluate((header) => header.getBoundingClientRect().bottom)
		expect(headerBottom).toBeGreaterThan(40)
		await expect
			.poll(async () => (await toast.boundingBox())!.y)
			.toBeGreaterThanOrEqual(headerBottom)
	}
})

test.describe('on a desktop', () => {
	// A mouse, not the file's touch screen: `desktop:` is wide and fine-pointed.
	test.use({ hasTouch: false })

	test('on desktop the header does the bar’s job: no Back bar on a Recipe or Settings, but an edit screen keeps Cancel and Save', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createLongRecipe(user, 'Lentil soup')
		await page.setViewportSize({ width: 1280, height: 800 })
		await page.goto(`/recipes/${recipe.id}`)
		const header = page.getByRole('navigation', { name: 'Main' })
		await expect(header.getByRole('link', { name: 'Recipes' })).toBeVisible()
		await expect(page.locator('[data-nav-bar]')).toBeHidden()

		// With the bar hidden, content still clears the sticky header: the
		// Ingredients column pins below it (its sticky top reads --nav-bar-bottom).
		const offsets = await page.evaluate(() => {
			const header = document.querySelector('[data-site-header]')!
			const column = document.querySelector<HTMLElement>(
				'#main-content [class*="lg:sticky"]',
			)!
			return {
				headerBottom: header.getBoundingClientRect().bottom,
				stickyTop: parseFloat(getComputedStyle(column).top),
			}
		})
		expect(offsets.headerBottom).toBeGreaterThan(40)
		expect(offsets.stickyTop).toBeGreaterThanOrEqual(offsets.headerBottom)

		const avatar = page.getByRole('link', { name: 'Settings', exact: true })
		await hydrated(avatar)
		await avatar.click()
		await expect(page).toHaveURL('/settings/profile')
		await expect(page.locator('[data-nav-bar]')).toBeHidden()
		// The browser's Back still returns to the Recipe it came from.
		await page.goBack()
		await expect(page).toHaveURL(`/recipes/${recipe.id}`)

		await page.goto(`/recipes/${recipe.id}/edit`)
		const bar = page.locator('[data-nav-bar]')
		await expect(bar).toBeVisible()
		await expect(bar.getByRole('link', { name: 'Cancel' })).toBeVisible()
		await expect(bar.getByRole('button', { name: 'Save' })).toBeVisible()

		// A phone keeps the bar on the Recipe.
		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto(`/recipes/${recipe.id}`)
		await expect(backButton(page, 'Recipes')).toBeVisible()
	})
})

test('Import has no Cancel of its own; the bar goes back', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/recipes')
	const importLink = page.getByRole('link', { name: /Import/ }).first()
	await hydrated(importLink)
	await importLink.tap()
	await expect(page).toHaveURL(/\/recipes\/import/)
	await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
	await backButton(page, 'Recipes').tap()
	await expect(page).toHaveURL('/recipes')
})

test('a Recipe reached by signing in from a deep link goes back to Recipes, not to sign-in', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createLongRecipe(user, 'Lentil soup')
	await page.context().clearCookies()

	await page.goto(`/recipes/${recipe.id}`)
	await expect(page).toHaveURL(/\/login\?redirectTo=/)
	const username = page.getByRole('textbox', { name: /username/i })
	await hydrated(username)
	await username.fill(user.username)
	await page.getByLabel(/^password$/i).fill(user.username)
	await page.getByRole('button', { name: 'Log in', exact: true }).click()
	await expect(page).toHaveURL(`/recipes/${recipe.id}`)

	await backButton(page, 'Recipes').tap()
	await expect(page).toHaveURL('/recipes')
})

test('opening a form from a list commits Cancel and Save with the form', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/recipes/menus')
	const newMenu = page.getByRole('link', { name: 'New Menu' }).first()
	await hydrated(newMenu)
	// Record what the bar holds each time the page changes, at the end of
	// the task that changed it: what the browser may paint next. (A frame
	// sampler can miss it: React often runs its effects before the paint.)
	await page.evaluate(() => {
		const frames: string[] = []
		Object.assign(window, { __frames: frames })
		new MutationObserver(() => {
			const heading = document.querySelector('#main-content h1')
			const save = document.querySelector('[data-nav-save]')
			const back = document.querySelector('[data-nav-back]')
			frames.push(
				`${heading?.textContent?.trim()}: ${save ? 'save' : 'no save'} ${back?.textContent?.trim()}`,
			)
		}).observe(document.body, {
			childList: true,
			subtree: true,
			characterData: true,
		})
	})
	await newMenu.tap()
	await expect(page).toHaveURL('/recipes/menus/new')
	await expect(page.locator('[data-nav-save]')).toBeVisible()
	await animationsFinished(page)
	const frames = await page.evaluate(
		() => (window as unknown as { __frames: string[] }).__frames,
	)
	const formFrames = frames.filter((f) => f.startsWith('New Menu:'))
	expect(formFrames.length).toBeGreaterThan(0)
	expect(formFrames.filter((f) => !f.includes(': save Cancel'))).toEqual([])
})
