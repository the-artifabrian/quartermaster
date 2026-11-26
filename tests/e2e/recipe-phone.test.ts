import fs from 'node:fs/promises'
import path from 'node:path'
import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { SHELL_UA } from '#tests/native-shell.ts'
import {
	animationsFinished,
	expect,
	hydrated,
	test,
} from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

// A 2x1 PNG, enough for the image route to serve a photo.
const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+Y8FWnUAAAAASUVORK5CYII=',
	'base64',
)

type Owner = { id: string; householdId: string }

async function createSoup(
	user: Owner,
	{
		photo = false,
		details = true,
	}: { photo?: boolean; details?: boolean } = {},
) {
	let image
	if (photo) {
		const objectKey = `users/${user.id}/recipes/soup/images/photo.png`
		const file = path.join('tests/fixtures/uploaded', objectKey)
		await fs.mkdir(path.dirname(file), { recursive: true })
		await fs.writeFile(file, TINY_PNG)
		image = { create: { objectKey, altText: 'Soup in a bowl' } }
	}
	const dough = await prisma.recipe.create({
		data: {
			title: 'Pizza dough',
			userId: user.id,
			householdId: user.householdId,
		},
		select: { id: true },
	})
	return prisma.recipe.create({
		data: {
			title: 'Tomato and white bean soup',
			userId: user.id,
			householdId: user.householdId,
			...(details
				? {
						description: 'A quick pantry soup.',
						activeTime: 20,
						totalTime: 55,
						yieldAmount: 4,
						yieldLabel: 'servings',
						sourceUrl: 'https://www.seriouseats.com/white-bean-soup',
					}
				: {}),
			image,
			ingredients: {
				create: [
					{ name: 'For the soup', isHeading: true, order: 0 },
					{ name: 'olive oil', amount: '2', unit: 'tbsp', order: 1 },
					{ name: 'onion', amount: '1', notes: 'chopped', order: 2 },
					{ name: 'tomatoes', amount: '~ 14.25', unit: 'fl oz', order: 3 },
					{ name: 'stock', amount: '1', unit: 'l', order: 4 },
					{ name: 'To serve', isHeading: true, order: 5 },
					{ name: 'salt', notes: 'to taste', order: 6 },
					{
						name: 'pizza dough',
						amount: '1',
						linkedRecipeId: dough.id,
						order: 7,
					},
				],
			},
			instructions: {
				create: Array.from({ length: 11 }, (_, order) => ({
					content:
						order === 0
							? 'Heat the oven to 400°F and simmer for 25 minutes.'
							: `Step ${order + 1}: stir, taste, and keep going a while longer.`,
					order,
				})),
			},
		},
		select: { id: true, title: true },
	})
}

const bar = (page: Page) => page.locator('[data-nav-bar]')
const favorite = (scope: Locator | Page) =>
	scope.getByRole('button', { name: /^(Add to|Remove from) favorites$/ })

async function box(locator: Locator) {
	const found = await locator.boundingBox()
	expect(found).not.toBeNull()
	return found!
}

test('the nav bar holds Favourite, Share and More actions, in the page the server sends', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)

	// Before any script runs: the buttons come with the bar, not after it.
	const html = await (await page.request.get(`/recipes/${recipe.id}`)).text()
	const barHtml = html.slice(
		html.indexOf('data-nav-bar'),
		html.indexOf('</header>'),
	)
	expect(barHtml).toContain('aria-label="Add to favorites"')
	expect(barHtml).toContain('aria-label="Share"')
	expect(barHtml).toContain('aria-label="More actions"')

	await page.goto(`/recipes/${recipe.id}`)
	for (const button of [
		favorite(bar(page)),
		bar(page).getByRole('button', { name: 'Share' }),
		bar(page).getByRole('button', { name: 'More actions' }),
	]) {
		await expect(button).toBeVisible()
		expect((await box(button)).height).toBeGreaterThanOrEqual(44)
	}
	// One of each on the screen: the page's own row of icons is gone.
	await expect(favorite(page)).toHaveCount(1)
	await expect(page.getByRole('button', { name: 'Copy Recipe' })).toHaveCount(0)
})

test('a favourite tapped in the bar shows at once and is saved', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.goto(`/recipes/${recipe.id}`)
	const heart = favorite(bar(page))
	await hydrated(heart)

	let release!: () => void
	const held = new Promise<void>((resolve) => (release = resolve))
	await page.route(`**/recipes/${recipe.id}.data*`, async (route) => {
		if (route.request().method() === 'POST') await held
		await route.continue()
	})
	await heart.tap()
	// While the request is out, the heart already shows the new state.
	await expect(heart).toHaveAccessibleName('Remove from favorites')
	release()
	await expect
		.poll(
			async () =>
				(
					await prisma.recipe.findUniqueOrThrow({
						where: { id: recipe.id },
						select: { isFavorite: true },
					})
				).isFavorite,
		)
		.toBe(true)
	await expect(heart).toHaveAccessibleName('Remove from favorites')
})

test('Share in the bar copies the public link', async ({ page, login }) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
	await page.goto(`/recipes/${recipe.id}`)
	const share = bar(page).getByRole('button', { name: 'Share' })
	await hydrated(share)
	await share.tap()
	await expect(
		page
			.locator('[data-sonner-toast]')
			.filter({ hasText: 'Public link copied' }),
	).toBeVisible()
	expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
		new RegExp(`/share/${recipe.id}$`),
	)
})

test('More actions holds Copy Recipe above Print, and Reset cooking checks once a row is checked', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
	await page.goto(`/recipes/${recipe.id}`)
	const more = bar(page).getByRole('button', { name: 'More actions' })
	await hydrated(more)
	await more.tap()
	await expect(page.getByRole('menuitem')).toHaveText(['Copy Recipe', 'Print'])
	await page.getByRole('menuitem', { name: 'Copy Recipe' }).tap()
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toContain('Tomato and white bean soup')

	const oil = page.getByRole('checkbox', { name: 'olive oil', exact: true })
	await oil.tap()
	await expect(oil).toBeChecked()
	await more.tap()
	await expect(page.getByRole('menuitem')).toHaveText([
		'Reset cooking checks',
		'Copy Recipe',
		'Print',
	])
	await page.getByRole('menuitem', { name: 'Reset cooking checks' }).tap()
	await expect(oil).not.toBeChecked()
})

test.describe('in the iOS app', () => {
	// A lapsed Pro answers in place there; a browser opens Upgrade instead.
	test.use({ userAgent: SHELL_UA })

	test('Suggest description & times in the bar’s menu answers on the page', async ({
		page,
		login,
	}) => {
		const user = await login()
		await prisma.subscription.create({ data: { userId: user.id, tier: 'pro' } })
		const recipe = await createSoup(user)
		await page.goto(`/recipes/${recipe.id}`)
		const more = bar(page).getByRole('button', { name: 'More actions' })
		await hydrated(more)
		await more.tap()
		const suggest = page.getByRole('menuitem', {
			name: 'Suggest description & times',
		})
		await expect(suggest).toBeVisible()
		// Pro lapses with the menu open: the page, not the bar, reads the answer.
		await prisma.subscription.delete({ where: { userId: user.id } })
		await suggest.tap()
		await expect(
			page.getByText(
				'Suggestions aren’t available on your account. Edit the Recipe to add these yourself.',
			),
		).toBeVisible()
	})
})

test('a pushed page with no buttons of its own, and a Recipe that is not found, leave the bar’s right side empty', async ({
	page,
	login,
}) => {
	await login()
	for (const url of ['/recipes/import', '/recipes/no-such-recipe']) {
		await page.goto(url)
		await expect(bar(page).locator('[data-nav-back]')).toBeVisible()
		await expect(bar(page).getByRole('button')).toHaveCount(0)
	}
})

test('a Recipe deleted while it is open takes the bar’s buttons with it when its page turns into not found', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.goto(`/recipes/${recipe.id}`)
	const heart = favorite(bar(page))
	await hydrated(heart)
	await prisma.recipe.delete({ where: { id: recipe.id } })
	await heart.tap()
	await expect(
		page.getByRole('heading', { level: 1, name: 'Recipe not found' }),
	).toBeVisible()
	await expect(bar(page).locator('[data-nav-back]')).toBeVisible()
	await expect(bar(page).getByRole('button')).toHaveCount(0)
})

test('a sub-Recipe deleted meanwhile opens as not found, with no bar buttons and the app still there', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.goto(`/recipes/${recipe.id}`)
	const link = page.getByRole('link', { name: 'pizza dough' })
	await hydrated(link)
	await prisma.recipe.deleteMany({
		where: { householdId: user.householdId, title: 'Pizza dough' },
	})
	await link.tap()
	await expect(
		page.getByRole('heading', { level: 1, name: 'Recipe not found' }),
	).toBeVisible()
	await expect(bar(page).locator('[data-nav-back]')).toBeVisible()
	await expect(bar(page).getByRole('button')).toHaveCount(0)
})

test('a scale changed on a Recipe deleted meanwhile shows not found, with no bar buttons and the app still there', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.goto(`/recipes/${recipe.id}`)
	const scale = page.getByRole('button', { name: 'Scale 1×' })
	await hydrated(scale)
	await scale.tap()
	await prisma.recipe.delete({ where: { id: recipe.id } })
	await page.getByRole('button', { name: 'Increase Recipe scale' }).tap()
	await expect(
		page.getByRole('heading', { level: 1, name: 'Recipe not found' }),
	).toBeVisible()
	await expect(bar(page).locator('[data-nav-back]')).toBeVisible()
	await expect(bar(page).getByRole('button')).toHaveCount(0)
})

test('the bar’s heart on a sub-Recipe favourites that Recipe, and Back shows the first one’s own', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	const isFavorite = async (id: string) =>
		(
			await prisma.recipe.findUniqueOrThrow({
				where: { id },
				select: { isFavorite: true },
			})
		).isFavorite
	const dough = await prisma.recipe.findFirstOrThrow({
		where: { householdId: user.householdId, title: 'Pizza dough' },
		select: { id: true },
	})
	await page.goto(`/recipes/${recipe.id}`)
	const link = page.getByRole('link', { name: 'pizza dough' })
	await hydrated(link)
	await link.tap()
	await expect(page).toHaveURL(new RegExp(`/recipes/${dough.id}$`))
	const heart = favorite(bar(page))
	await expect(heart).toHaveAccessibleName('Add to favorites')
	await heart.tap()
	await expect(heart).toHaveAccessibleName('Remove from favorites')
	await expect.poll(() => isFavorite(dough.id)).toBe(true)
	expect(await isFavorite(recipe.id)).toBe(false)

	await bar(page).locator('[data-nav-back]').tap()
	await expect(page).toHaveURL(new RegExp(`/recipes/${recipe.id}$`))
	await expect(heart).toHaveAccessibleName('Add to favorites')
	await heart.tap()
	await expect(heart).toHaveAccessibleName('Remove from favorites')
	await expect.poll(() => isFavorite(recipe.id)).toBe(true)
})

test('Copy Recipe in the bar’s menu writes the amounts at the page’s scale', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
	await page.goto(`/recipes/${recipe.id}?scale=2`)
	const more = bar(page).getByRole('button', { name: 'More actions' })
	await hydrated(more)
	await more.tap()
	await page.getByRole('menuitem', { name: 'Copy Recipe' }).tap()
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toContain('- 4 tbsp olive oil')
	expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
		'- 2 l stock',
	)
})

test('focusing Back, Favourite, Share and More actions while scrolled leaves the page where it is', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user, { photo: true })
	await page.goto(`/recipes/${recipe.id}`)
	await hydrated(favorite(bar(page)))
	for (const control of [
		bar(page).getByRole('link', { name: 'Back to Recipes' }),
		favorite(bar(page)),
		bar(page).getByRole('button', { name: 'Share' }),
		bar(page).getByRole('button', { name: 'More actions' }),
	]) {
		await page.evaluate(() => {
			;(document.activeElement as HTMLElement | null)?.blur()
			window.scrollTo(0, 600)
		})
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600)
		await control.focus()
		await expect(control).toBeFocused()
		expect(await page.evaluate(() => window.scrollY)).toBe(600)
	}
	// A control in the page that sits under the bar still comes out below it.
	const oil = page.getByRole('checkbox', { name: 'olive oil', exact: true })
	await oil.evaluate((row) => {
		;(document.activeElement as HTMLElement | null)?.blur()
		window.scrollBy(0, row.getBoundingClientRect().top - 10)
	})
	await oil.focus()
	const barBottom = (await box(bar(page))).y + 44
	expect((await box(oil)).y).toBeGreaterThanOrEqual(barBottom)
})

test('a step field partly under the bar on the edit screen comes out below it when focused', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.goto(`/recipes/${recipe.id}/edit`)
	const step = page.getByRole('textbox', { name: 'Step 4', exact: true })
	await hydrated(step)
	await step.evaluate((field) => {
		;(document.activeElement as HTMLElement | null)?.blur()
		window.scrollBy(0, field.getBoundingClientRect().top - 10)
	})
	expect(Math.round((await box(step)).y)).toBe(10)
	await step.focus()
	await expect(step).toBeFocused()
	const barBottom = (await box(bar(page))).y + 44
	await expect
		.poll(async () => (await box(step)).y)
		.toBeGreaterThanOrEqual(barBottom)

	// The same by Tab, from the step's own Reorder button.
	const reorder = page.getByRole('button', { name: 'Reorder step 4' })
	await step.evaluate((field) => {
		;(document.activeElement as HTMLElement | null)?.blur()
		window.scrollBy(0, field.getBoundingClientRect().top - 10)
	})
	await reorder.evaluate((button) =>
		(button as HTMLElement).focus({ preventScroll: true }),
	)
	expect(Math.round((await box(step)).y)).toBe(10)
	await page.keyboard.press('Tab')
	await expect(step).toBeFocused()
	await expect
		.poll(async () => (await box(step)).y)
		.toBeGreaterThanOrEqual(barBottom)
})

test.describe('at 320px', () => {
	test.use({ viewport: { width: 335, height: 700 } })

	test('the small title has room beside Back and the three buttons', async ({
		page,
		login,
	}) => {
		const user = await login()
		// Back names the page behind it: a tab, Menu or Recipe. "Recipes" is
		// the longest a Recipe can show.
		const recipe = await createSoup(user)
		await page.goto(`/recipes/${recipe.id}`)
		await expect(bar(page).locator('[data-nav-back]')).toHaveText('Recipes')
		await page.evaluate(() => window.scrollTo(0, 400))
		const title = bar(page).locator('[data-nav-title]')
		await expect(title).toHaveAttribute('data-shown', '')
		// Back keeps its whole label.
		expect(
			await bar(page)
				.locator('[data-nav-back] span')
				.evaluate((label) => label.scrollWidth <= label.clientWidth),
		).toBe(true)
		const back = await box(bar(page).locator('[data-nav-back]'))
		const heart = await box(favorite(bar(page)))
		const more = await box(
			bar(page).getByRole('button', { name: 'More actions' }),
		)
		const shown = await box(title)
		// The bar is 320px wide, and nothing in it overlaps or leaves it.
		expect((await box(page.getByRole('main'))).width).toBe(320)
		expect(shown.width).toBeGreaterThanOrEqual(56)
		expect(shown.x).toBeGreaterThanOrEqual(back.x + back.width)
		expect(shown.x + shown.width).toBeLessThanOrEqual(heart.x)
		expect(more.x + more.width).toBeLessThanOrEqual(320)
	})

	test('the longest amount fits its column, and Add to Plan and Edit fit side by side', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createSoup(user)
		await page.goto(`/recipes/${recipe.id}`)
		const amount = page
			.locator('[data-ingredient-amount]')
			.filter({ hasText: '~ 14.25 fl oz' })
		await expect(amount).toBeVisible()
		// On one line, inside its cell, clear of the name.
		const cell = await box(amount)
		expect(cell.height).toBeLessThan(30)
		expect(
			await amount.evaluate((el) => el.scrollWidth <= el.clientWidth),
		).toBe(true)
		const name = await box(
			page.locator('[data-ingredient-name]').filter({ hasText: 'tomatoes' }),
		)
		expect(cell.x + cell.width).toBeLessThanOrEqual(name.x)

		const plan = page.getByRole('button', { name: 'Add to Plan' })
		const edit = page.getByRole('link', { name: 'Edit Recipe' })
		const planBox = await box(plan)
		const editBox = await box(edit)
		expect(Math.abs(planBox.y - editBox.y)).toBeLessThan(1)
		expect(planBox.x + planBox.width).toBeLessThanOrEqual(editBox.x)
		expect(editBox.x + editBox.width).toBeLessThanOrEqual(320)
		for (const control of [plan, edit]) {
			expect(
				await control.evaluate((el) => el.scrollWidth <= el.clientWidth),
			).toBe(true)
		}
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true)
	})
})

test.describe('on a sideways phone', () => {
	test.use({ viewport: { width: 844, height: 390 }, hasTouch: true })

	test('the page keeps its row of actions and the bar has none', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createSoup(user)
		await page.goto(`/recipes/${recipe.id}`)
		await expect(bar(page).locator('[data-nav-back]')).toBeVisible()
		await expect(favorite(page)).toHaveCount(1)
		await expect(favorite(bar(page))).toHaveCount(0)
		await expect(
			page.getByRole('button', { name: 'Copy Recipe' }),
		).toBeVisible()
	})
})

test('a photo runs edge to edge under the bar at 292px; without one the title clears the bar', async ({
	page,
	login,
}) => {
	const user = await login()
	const withPhoto = await createSoup(user, { photo: true })
	await page.goto('/recipes')
	const row = page.getByText(withPhoto.title, { exact: true })
	await hydrated(row)
	// The photo the list's photo moves into while the page comes in.
	await page.evaluate(() => {
		const seen: boolean[] = []
		Object.assign(window, { __morph: seen })
		new MutationObserver(() => {
			const hero = document.querySelector(
				'#main-content img[alt="Soup in a bowl"]',
			)
			if (hero) seen.push(hero.hasAttribute('data-recipe-image-transition'))
		}).observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
		})
	})
	await row.tap()
	const photo = page.getByRole('img', { name: 'Soup in a bowl' })
	await expect(photo).toBeVisible()
	expect(
		await page.evaluate(
			() => (window as unknown as { __morph: boolean[] }).__morph,
		),
	).toContain(true)
	const barBottom = (await box(bar(page))).y + 44
	const shown = await box(photo)
	const { width } = await box(page.getByRole('main'))
	expect(shown).toMatchObject({ x: 0, width, height: 292 })
	// The header's hairline sits between the bar and the photo.
	expect(shown.y).toBeGreaterThanOrEqual(barBottom)
	expect(shown.y).toBeLessThanOrEqual(barBottom + 1)

	const plain = await createSoup(user)
	await page.goto(`/recipes/${plain.id}`)
	const heading = page.getByRole('heading', { level: 1, name: plain.title })
	const headingBox = await box(heading)
	expect(headingBox.y).toBeGreaterThanOrEqual(barBottom + 8)
	expect(await heading.evaluate((h1) => getComputedStyle(h1).fontSize)).toBe(
		'44px',
	)
})

test('the facts read as label over value, the yield follows the scale, and missing facts leave no gap', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.goto(`/recipes/${recipe.id}?scale=2`)
	await expect(page.getByRole('term')).toHaveText(['Active', 'Total', 'Makes'])
	await expect(page.getByRole('definition')).toHaveText([
		'20 min',
		'55 min',
		'8 servings',
	])
	const term = await box(page.getByRole('term').first())
	const value = await box(page.getByRole('definition').first())
	expect(value.y).toBeGreaterThanOrEqual(term.y + term.height - 1)
	await expect(
		page.getByRole('link', { name: 'seriouseats.com' }),
	).toBeVisible()

	await prisma.recipe.update({
		where: { id: recipe.id },
		data: { activeTime: null, yieldAmount: null, yieldLabel: null },
	})
	await page.goto(`/recipes/${recipe.id}`)
	await expect(page.getByRole('term')).toHaveText(['Total'])

	const bare = await createSoup(user, { details: false })
	await page.goto(`/recipes/${bare.id}`)
	await expect(page.getByRole('term')).toHaveCount(0)
	// Add to Plan follows the title as closely as it follows the facts.
	const heading = await box(page.getByRole('heading', { level: 1 }))
	const plan = await box(page.getByRole('button', { name: 'Add to Plan' }))
	expect(plan.y - (heading.y + heading.height)).toBeLessThanOrEqual(24)
})

test('Add to Plan is a full-width button that opens its sheet and plans the Recipe', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.goto(`/recipes/${recipe.id}`)
	const plan = page.getByRole('button', { name: 'Add to Plan' })
	await hydrated(plan)
	expect((await box(plan)).width).toBeGreaterThan(200)
	await plan.tap()
	const sheet = page.getByRole('dialog', { name: 'Add to Plan' })
	await expect(sheet).toBeVisible()
	await sheet.getByRole('button', { name: 'Add to Plan' }).tap()
	await expect(sheet).toBeHidden()
	await expect
		.poll(() => prisma.mealRecipeItem.count({ where: { recipeId: recipe.id } }))
		.toBe(1)
})

test.describe('between 640 and 767px', () => {
	test.use({ viewport: { width: 700, height: 844 } })

	test('Add to Plan opens its popover beside the button', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createSoup(user)
		await page.goto(`/recipes/${recipe.id}`)
		const plan = page.getByRole('button', { name: 'Add to Plan' })
		await hydrated(plan)
		const button = await box(plan)
		await plan.tap()
		const popover = page.getByRole('dialog')
		await expect(popover).toBeVisible()
		await animationsFinished(page)
		const shown = await box(popover)
		expect(shown.y).toBeGreaterThanOrEqual(button.y + button.height)
		expect(shown.y).toBeLessThan(button.y + button.height + 24)
	})
})

test('amounts share one right-aligned column and names one edge, a row with no amount, a heading and a sub-Recipe included', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.goto(`/recipes/${recipe.id}`)
	const amounts = page.locator('[data-ingredient-amount]')
	const names = page.locator('[data-ingredient-name]')
	await expect(names).toHaveCount(6)
	const amountRights = await amounts.evaluateAll((cells) =>
		cells
			.filter((cell) => cell.textContent?.trim())
			.map((cell) => Math.round(cell.getBoundingClientRect().right)),
	)
	expect(new Set(amountRights).size).toBe(1)
	const nameLefts = await names.evaluateAll((cells) =>
		cells.map((cell) => Math.round(cell.getBoundingClientRect().left)),
	)
	expect(new Set(nameLefts).size).toBe(1)
	expect(nameLefts[0]).toBeGreaterThanOrEqual(amountRights[0]!)
	// The heading starts on the content edge, not in the name column.
	const heading = await box(page.getByText('To serve', { exact: true }))
	expect(heading.x).toBeLessThan(amountRights[0]! - 40)
	await expect(page.getByText('To serve', { exact: true })).toHaveCSS(
		'text-transform',
		'none',
	)

	// Metric rewrites the amounts; the names keep one edge.
	await page.getByRole('button', { name: 'Metric' }).tap()
	await expect(page.getByRole('button', { name: 'Metric' })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
	const metricLefts = await names.evaluateAll((cells) =>
		cells.map((cell) => Math.round(cell.getBoundingClientRect().left)),
	)
	expect(new Set(metricLefts).size).toBe(1)
})

test('a scale that makes the longest amount wider widens the column for every row', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Bread',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: [
					{ name: 'flour', amount: '1', unit: 'cup', order: 0 },
					{ name: 'salt', amount: '1', unit: 'tsp', order: 1 },
					{ name: 'water', notes: 'warm', order: 2 },
				],
			},
		},
		select: { id: true },
	})
	const nameLefts = () =>
		page
			.locator('[data-ingredient-name]')
			.evaluateAll((cells) =>
				cells.map((cell) => Math.round(cell.getBoundingClientRect().left)),
			)
	await page.goto(`/recipes/${recipe.id}`)
	await expect(page.locator('[data-ingredient-name]')).toHaveCount(3)
	const before = await nameLefts()
	expect(new Set(before).size).toBe(1)
	await page.goto(`/recipes/${recipe.id}?scale=12`)
	await expect(
		page.locator('[data-ingredient-amount]').filter({ hasText: '12 cups' }),
	).toBeVisible()
	const after = await nameLefts()
	expect(new Set(after).size).toBe(1)
	expect(after[0]).toBeGreaterThan(before[0]!)
})

test('an ingredient row is one checkbox named by the ingredient; a tap or Space checks it and strikes its name', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.goto(`/recipes/${recipe.id}`)
	const onion = page.getByRole('checkbox', { name: 'onion', exact: true })
	await hydrated(onion)
	await expect(onion).toHaveText('1 onion, chopped')
	// No check box is drawn; the amount starts the row.
	const amount = await box(onion.locator('[data-ingredient-amount]'))
	expect(amount.x).toBeLessThan(40)
	await onion.locator('[data-ingredient-amount]').tap()
	await expect(onion).toBeChecked()
	await expect(onion.locator('[data-ingredient-name]')).toHaveCSS(
		'text-decoration-line',
		'line-through',
	)
	const saved = await page.evaluate(() =>
		Object.keys(localStorage).filter((key) =>
			key.startsWith('cooking-progress:'),
		),
	)
	expect(saved).toHaveLength(1)
	await onion.press('Space')
	await expect(onion).not.toBeChecked()
})

test('the Ingredients sheet and a share page set ingredients in the same columns', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	const columnsAligned = async (scope: Locator) => {
		const lefts = await scope
			.locator('[data-ingredient-name]')
			.evaluateAll((cells) =>
				cells.map((cell) => Math.round(cell.getBoundingClientRect().left)),
			)
		expect(lefts.length).toBeGreaterThan(1)
		expect(new Set(lefts).size).toBe(1)
	}

	await page.goto(`/recipes/${recipe.id}`)
	await page
		.getByRole('heading', { name: 'Instructions' })
		.scrollIntoViewIfNeeded()
	await page.evaluate(() => window.scrollBy(0, 400))
	const open = page.getByRole('button', { name: /^Ingredients ·/ })
	await hydrated(open)
	await open.tap()
	const sheet = page.getByRole('dialog', { name: 'Ingredients' })
	await expect(sheet).toBeVisible()
	await columnsAligned(sheet)

	await page.goto(`/share/${recipe.id}`)
	await columnsAligned(page.getByRole('main'))
})

test('step numerals are large and green, two digits clear the text, and a finished step turns its numeral into a check', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.goto(`/recipes/${recipe.id}`)
	const steps = page.locator('[data-step-id]')
	await expect(steps).toHaveCount(11)
	const tenth = steps.nth(9)
	const numeral = tenth.locator('[data-step-number]')
	await expect(numeral).toHaveText('10')
	await expect(numeral).toHaveCSS('font-size', '32px')
	// The primary green in light.
	await expect(numeral).toHaveCSS('color', 'rgb(31, 90, 61)')
	const text = await box(tenth.locator('[data-step-text]'))
	const number = await numeral.evaluate((el) => {
		const range = document.createRange()
		range.selectNodeContents(el)
		return range.getBoundingClientRect().right
	})
	expect(number).toBeLessThan(text.x)
	await expect(tenth.locator('[data-step-text]')).toHaveCSS('font-size', '20px')

	const first = steps.first()
	await hydrated(first)
	// Its middle is the temperature, which converts on a tap.
	await first.locator('[data-step-number]').tap()
	await expect(first).toBeChecked()
	// The check in the numeral's place (print keeps the number).
	await expect(first.locator('[data-step-number] svg')).toBeVisible()
	// A cue keeps its weight and its underline.
	const cue = first.getByTestId('cooking-duration-cue')
	await expect(cue).toHaveCSS('font-weight', '600')
})
