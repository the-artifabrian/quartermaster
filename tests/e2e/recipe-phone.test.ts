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

test('More actions holds Edit, Copy Recipe and Print, and Reset cooking checks once a row is checked', async ({
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
	await expect(page.getByRole('menuitem')).toHaveText([
		'Edit',
		'Copy Recipe',
		'Print',
	])
	await page.getByRole('menuitem', { name: 'Copy Recipe' }).tap()
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toContain('Tomato and white bean soup')

	const oil = page.getByRole('checkbox', { name: 'olive oil', exact: true })
	await oil.tap()
	await expect(oil).toBeChecked()
	await more.tap()
	await expect(page.getByRole('menuitem')).toHaveText([
		'Edit',
		'Reset cooking checks',
		'Copy Recipe',
		'Print',
	])
	await page.getByRole('menuitem', { name: 'Reset cooking checks' }).tap()
	await expect(oil).not.toBeChecked()
})

test('Edit Recipe in More actions opens the edit screen, from a tap and from the keyboard', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.goto(`/recipes/${recipe.id}`)
	// The page itself has no Edit button: the bar's menu is the way in.
	await expect(
		page.getByRole('main').getByRole('link', { name: /Edit/ }),
	).toHaveCount(0)
	const more = bar(page).getByRole('button', { name: 'More actions' })
	await hydrated(more)
	await more.tap()
	await page.getByRole('menuitem', { name: 'Edit Recipe' }).tap()
	await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
	await expect(page.getByLabel('Title')).toHaveValue(recipe.title)

	// From the keyboard the menu opens on its first item, Edit Recipe.
	await page.goto(`/recipes/${recipe.id}`)
	await hydrated(more)
	await more.focus()
	await page.keyboard.press('Enter')
	await expect(
		page.getByRole('menuitem', { name: 'Edit Recipe' }),
	).toBeFocused()
	await page.keyboard.press('Enter')
	await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
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
	const barBottom = (await box(bar(page))).y + 44
	// Read in the same task as the focus: the scroll that focus makes.
	const topAfterFocus = await step.evaluate((field) => {
		;(field as HTMLElement).focus()
		return field.getBoundingClientRect().top
	})
	await expect(step).toBeFocused()
	expect(topAfterFocus).toBeGreaterThanOrEqual(barBottom)

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

/** Recipe A (the soup) and its sub-Recipe, tall enough at the top that its
 * Ingredients heading starts below the fold. */
async function createTallSubRecipe(user: Owner) {
	const recipe = await createSoup(user, { photo: true })
	const dough = await prisma.recipe.findFirstOrThrow({
		where: { householdId: user.householdId, title: 'Pizza dough' },
		select: { id: true },
	})
	const objectKey = `users/${user.id}/recipes/dough/images/photo.png`
	const file = path.join('tests/fixtures/uploaded', objectKey)
	await fs.mkdir(path.dirname(file), { recursive: true })
	await fs.writeFile(file, TINY_PNG)
	await prisma.recipe.update({
		where: { id: dough.id },
		data: {
			title: 'Overnight pizza dough for a crisp base',
			description:
				'A soft dough that rests overnight in the fridge, then bakes into a crisp, chewy base with a few big bubbles. Shape it cold, straight from the fridge, and bake it on the hottest shelf of the oven. Any flour works, but bread flour gives the chewiest base.',
			activeTime: 15,
			totalTime: 720,
			sourceUrl: 'https://www.example.com/pizza-dough',
			notes:
				'Use the strong flour. Leave it out for an hour before stretching, or it springs back.',
			image: { create: { objectKey, altText: 'Dough in a bowl' } },
			ingredients: {
				create: [{ name: 'flour', amount: '500', unit: 'g', order: 0 }],
			},
			// Long enough to scroll its heading off the top.
			instructions: {
				create: Array.from({ length: 10 }, (_, order) => ({
					content: `Step ${order + 1}: knead, fold and let it rest a while.`,
					order,
				})),
			},
		},
	})
	return { recipe, dough }
}

const ingredientsPill = (page: Page) =>
	page.getByRole('button', { name: /^Ingredients ·/ })

/** On the sub-Recipe: its heading is below the fold, so nothing has passed. */
async function expectNoPillOnTallSubRecipe(page: Page, doughId: string) {
	await expect(page).toHaveURL(new RegExp(`/recipes/${doughId}$`))
	await expect(
		page.getByRole('heading', {
			level: 1,
			name: 'Overnight pizza dough for a crisp base',
		}),
	).toBeVisible()
	const heading = await box(
		page.getByRole('heading', { name: 'Ingredients' }).first(),
	)
	expect(heading.y).toBeGreaterThan(844)
	await expect(ingredientsPill(page)).toHaveCount(0)
	await page.getByRole('button', { name: 'Add to Plan' }).click({ trial: true })
	// Its own heading passing above the screen still brings the button.
	await page
		.getByRole('heading', { name: 'Ingredients' })
		.first()
		.evaluate((heading) =>
			window.scrollBy(0, heading.getBoundingClientRect().bottom + 20),
		)
	await expect(ingredientsPill(page)).toBeVisible()
	await page.evaluate(() => window.scrollTo(0, 0))
	await expect(ingredientsPill(page)).toHaveCount(0)
}

test('a sub-Recipe opened from a Recipe scrolled past its Ingredients starts without the floating Ingredients button', async ({
	page,
	login,
}) => {
	const user = await login()
	const { recipe, dough } = await createTallSubRecipe(user)
	await page.goto(`/recipes/${recipe.id}`)
	const link = page.getByRole('link', { name: 'pizza dough' })
	await hydrated(link)
	// The heading just above the screen, the sub-Recipe's row still on it.
	await page
		.getByRole('heading', { name: 'Ingredients' })
		.first()
		.evaluate((heading) =>
			window.scrollBy(0, heading.getBoundingClientRect().bottom + 20),
		)
	await expect(ingredientsPill(page)).toBeVisible()
	await expect(link).toBeInViewport()
	await link.tap()
	await expectNoPillOnTallSubRecipe(page, dough.id)

	// Back to the first Recipe, where it was: the button is back, and the
	// link's tap left its row unchecked.
	await page.goBack()
	await expect(page).toHaveURL(new RegExp(`/recipes/${recipe.id}$`))
	await expect(ingredientsPill(page)).toBeVisible()
	await expect(
		page.getByRole('checkbox', { name: 'pizza dough', exact: true }),
	).not.toBeChecked()
})

test.describe('in the iOS app, from the Ingredients sheet', () => {
	// The app's push closes the sheet it starts from.
	test.use({ userAgent: SHELL_UA })

	test('a sub-Recipe opened from the Ingredients sheet starts without the floating Ingredients button', async ({
		page,
		login,
	}) => {
		const user = await login()
		const { recipe, dough } = await createTallSubRecipe(user)
		await page.goto(`/recipes/${recipe.id}`)
		await hydrated(page.getByRole('heading', { name: 'Instructions' }))
		await page
			.locator('[data-step-id]')
			.nth(6)
			.evaluate((step) => step.scrollIntoView({ block: 'center' }))
		await ingredientsPill(page).tap()
		const sheet = page.getByRole('dialog', { name: 'Ingredients' })
		await expect(sheet).toBeVisible()
		await sheet.getByRole('link', { name: 'pizza dough' }).tap()
		await expect(sheet).toBeHidden()
		await expectNoPillOnTallSubRecipe(page, dough.id)
	})
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

	test('a long ingredient wraps under its own start without a sideways scroll, and Add to Plan fills the row', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createSoup(user)
		await prisma.ingredient.updateMany({
			where: { recipeId: recipe.id, name: 'tomatoes' },
			data: { notes: 'crushed by hand, with their juice, seeds and all' },
		})
		await page.goto(`/recipes/${recipe.id}`)
		const text = page
			.getByRole('checkbox', { name: 'tomatoes', exact: true })
			.locator('[data-ingredient-text]')
		await expect(text).toHaveText(
			'~ 14.25 fl oz tomatoes, crushed by hand, with their juice, seeds and all',
		)
		// Each line starts where the first does, after the check circle.
		const lineStarts = await text.evaluate((span) => {
			const range = document.createRange()
			range.selectNodeContents(span)
			const starts = new Map<number, number>()
			for (const rect of range.getClientRects()) {
				if (!rect.width) continue
				const top = Math.round(rect.top)
				starts.set(top, Math.min(starts.get(top) ?? Infinity, rect.left))
			}
			return [...starts.values()].map(Math.round)
		})
		expect(lineStarts.length).toBeGreaterThan(1)
		expect(new Set(lineStarts)).toEqual(new Set([52]))
		expect(await text.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
			true,
		)

		const plan = page.getByRole('button', { name: 'Add to Plan' })
		const planBox = await box(plan)
		expect(planBox).toMatchObject({ x: 16, width: 288, height: 48 })
		expect(await plan.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
			true,
		)
		await expect(page.getByRole('link', { name: 'Edit Recipe' })).toHaveCount(0)
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= 320),
		).toBe(true)
	})

	test('an ingredient with one long word breaks it and leaves no sideways scroll, on the Recipe and on its share page', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createSoup(user)
		const word = 'Hochgeschwindigkeitsbackofenpapierzuschnitt'
		await prisma.ingredient.updateMany({
			where: { recipeId: recipe.id, name: 'tomatoes' },
			data: { name: word },
		})
		for (const url of [`/recipes/${recipe.id}`, `/share/${recipe.id}`]) {
			await page.goto(url)
			const text = page
				.locator('[data-ingredient-text]')
				.filter({ hasText: word })
				.first()
			await expect(text).toBeVisible()
			const edges = await text.evaluate((span) => ({
				right: span.getBoundingClientRect().right,
				fits: span.scrollWidth <= span.clientWidth,
				page: document.documentElement.scrollWidth,
				main: document.querySelector('main')!.getBoundingClientRect().right,
			}))
			expect(edges.main, url).toBe(320)
			expect(edges.page, url).toBeLessThanOrEqual(320)
			expect(edges.fits, url).toBe(true)
			expect(edges.right, url).toBeLessThanOrEqual(320)
		}
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
		// Edit keeps its own button in the row, so its menu has none.
		await expect(page.getByRole('link', { name: 'Edit Recipe' })).toBeVisible()
		const more = page.getByRole('button', { name: 'More actions' })
		await hydrated(more)
		await more.click()
		await expect(page.getByRole('menuitem', { name: 'Print' })).toBeVisible()
		await expect(
			page.getByRole('menuitem', { name: 'Edit Recipe' }),
		).toHaveCount(0)
	})
})

test('a photo runs edge to edge under the bar at 244px; without one the 36px title clears the bar', async ({
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
	expect(shown).toMatchObject({ x: 0, width, height: 244 })
	// The header's hairline sits between the bar and the photo.
	expect(shown.y).toBeGreaterThanOrEqual(barBottom)
	expect(shown.y).toBeLessThanOrEqual(barBottom + 1)

	const plain = await createSoup(user)
	await page.goto(`/recipes/${plain.id}`)
	const heading = page.getByRole('heading', { level: 1, name: plain.title })
	const headingBox = await box(heading)
	expect(headingBox.y).toBeGreaterThanOrEqual(barBottom + 8)
	expect(await heading.evaluate((h1) => getComputedStyle(h1).fontSize)).toBe(
		'36px',
	)
})

test('the facts read as label over value, the yield shows once and follows the scale, and missing facts leave no gap', async ({
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
	// Scaled, the line by Scale keeps the scaled yield with the original.
	const yieldLine = page.locator('#main-content p[aria-live="polite"]')
	await expect(yieldLine).toHaveText('Makes 8 servings · original: 4')
	await expect(yieldLine).toHaveCSS('font-size', '13.5px')
	const scale = await box(page.getByRole('button', { name: 'Scale 2×' }))
	const line = await box(yieldLine)
	expect(line.width).toBeGreaterThan(100)
	expect(line.y).toBeGreaterThanOrEqual(scale.y + scale.height - 1)
	expect(line.y).toBeLessThan(scale.y + scale.height + 24)

	// At 1× the facts show the yield, and the line is there only for a
	// screen reader.
	await page.goto(`/recipes/${recipe.id}`)
	await expect(page.getByRole('definition').nth(2)).toHaveText('4 servings')
	await expect(yieldLine).toHaveText('Makes 4 servings')
	expect((await box(yieldLine)).width).toBeLessThanOrEqual(1)
	// A share page has no facts row, so its line stays in sight.
	await page.goto(`/share/${recipe.id}`)
	await expect(page.getByText('Makes 4 servings')).toBeVisible()
	expect((await box(page.getByText('Makes 4 servings'))).width).toBeGreaterThan(
		50,
	)

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
	// And Ingredients starts a section well clear of it.
	const ingredients = await box(
		page.getByRole('heading', { name: 'Ingredients' }).first(),
	)
	expect(ingredients.y - (plan.y + plan.height)).toBeGreaterThanOrEqual(32)
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

/**
 * Where each ingredient row's check circle and each heading inside the list
 * start, and where each row's text starts.
 */
async function rowEdges(scope: Locator) {
	const lefts = (selector: string) =>
		scope
			.locator(selector)
			.evaluateAll((cells) =>
				cells.map((cell) => Math.round(cell.getBoundingClientRect().left)),
			)
	return {
		leads: await lefts('[data-ingredient-check], [data-ingredient-heading]'),
		texts: await lefts('[data-ingredient-text]'),
	}
}

test('every ingredient row starts with its check circle on the content edge, its text in one column and its cart on the other edge, a row with no amount, a heading and a sub-Recipe included', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.goto(`/recipes/${recipe.id}`)
	await expect(page.locator('[data-ingredient-text]')).toHaveCount(6)
	const { x: edge } = await box(page.getByRole('heading', { level: 1 }))
	const { leads, texts } = await rowEdges(page.locator('#ingredients-list'))
	// Six rows (one with no amount, one a sub-Recipe) and two headings.
	expect(leads).toHaveLength(8)
	expect(new Set(leads)).toEqual(new Set([Math.round(edge)]))
	expect(texts).toHaveLength(6)
	expect(new Set(texts)).toEqual(new Set([Math.round(edge) + 36]))
	const toServe = page.getByText('To serve', { exact: true })
	await expect(toServe).toHaveCSS('text-transform', 'none')
	// A heading has a hairline under it, and more room above than below.
	await expect(toServe).toHaveCSS('border-bottom-width', '1px')
	const heading = await box(toServe)
	// Measured to the rows' text, not their 56px boxes.
	const textOf = (name: string) =>
		page
			.getByRole('checkbox', { name, exact: true })
			.locator('[data-ingredient-text]')
			.evaluate((el) => {
				const range = document.createRange()
				range.selectNodeContents(el)
				const rect = range.getBoundingClientRect()
				return { top: rect.top, bottom: rect.bottom }
			})
	const stockText = await textOf('stock')
	const saltText = await textOf('salt')
	const spaceAbove = heading.y - stockText.bottom
	const spaceBelow = saltText.top - (heading.y + heading.height)
	expect(spaceAbove).toBeGreaterThan(spaceBelow + 8)
	// One-line rows sit 56px apart, and touch, so all of the list checks one.
	const oil = await box(page.getByRole('checkbox', { name: 'olive oil' }))
	const onion = await box(page.getByRole('checkbox', { name: 'onion' }))
	expect(Math.round(onion.y - oil.y)).toBe(56)
	expect(Math.round(oil.height)).toBe(56)
	// The amount leads the line at weight 600.
	await expect(
		page
			.getByRole('checkbox', { name: 'olive oil', exact: true })
			.locator('[data-ingredient-text] > span')
			.first(),
	).toHaveCSS('font-weight', '600')
	// The carts end on the other edge.
	const main = await box(page.getByRole('main'))
	const cartEnds = await page
		.locator('#ingredients-list')
		.getByRole('button', { name: 'Add to Shopping' })
		.locator('svg')
		.evaluateAll((icons) =>
			icons.map((icon) => Math.round(icon.getBoundingClientRect().right)),
		)
	expect(cartEnds.length).toBeGreaterThan(1)
	expect(new Set(cartEnds)).toEqual(
		new Set([Math.round(main.x + main.width - edge)]),
	)
})

test('an ingredient row checks from a 44px area round its circle that stays clear of its 44px cart', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.goto(`/recipes/${recipe.id}`)
	const oil = page.getByRole('checkbox', { name: 'olive oil', exact: true })
	await hydrated(oil)
	const row = await box(oil)
	const circle = await box(oil.locator('[data-ingredient-check]'))
	const text = await box(oil.locator('[data-ingredient-text]'))
	const cart = await box(oil.getByRole('button', { name: 'Add to Shopping' }))
	expect(circle).toMatchObject({ width: 24, height: 24 })
	// The row reaches 44px and more round the circle, up to where its text
	// starts, and the cart's own 44px box starts after the text ends.
	expect(text.x - row.x).toBeGreaterThanOrEqual(44)
	expect(row.height).toBeGreaterThanOrEqual(44)
	expect(cart.width).toBeGreaterThanOrEqual(44)
	expect(cart.height).toBeGreaterThanOrEqual(44)
	expect(cart.x).toBeGreaterThanOrEqual(circle.x + circle.width)
	// A tap on the circle checks the row; one on the cart only adds to
	// Shopping.
	await page.touchscreen.tap(
		circle.x + circle.width / 2,
		circle.y + circle.height / 2,
	)
	await expect(oil).toBeChecked()
	await oil.press('Space')
	await expect(oil).not.toBeChecked()
	await page.touchscreen.tap(cart.x + cart.width / 2, cart.y + cart.height / 2)
	await expect
		.poll(() =>
			prisma.shoppingListItem.count({
				where: { name: 'olive oil', list: { householdId: user.householdId } },
			}),
		)
		.toBe(1)
	await expect(oil).not.toBeChecked()
})

test('a checked ingredient fills its circle and fades its whole line without a strike, and stays checked after a reload', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.goto(`/recipes/${recipe.id}`)
	const onion = page.getByRole('checkbox', { name: 'onion', exact: true })
	await hydrated(onion)
	await expect(onion).toHaveText('1 onion, chopped')
	const circle = onion.locator('[data-ingredient-check]')
	await expect(circle).toBeVisible()
	await expect(circle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
	await onion.locator('[data-ingredient-text]').tap()
	await expect(onion).toBeChecked()
	const expectCheckedLook = async () => {
		await expect(circle).toBeVisible()
		// The light theme's primary fill and faint text.
		await expect(circle).toHaveCSS('background-color', 'rgb(31, 90, 61)')
		for (const part of [
			onion.locator('[data-ingredient-text]'),
			onion.locator('[data-ingredient-text] > span').first(),
			onion.locator('[data-ingredient-name]'),
			onion.locator('[data-ingredient-name] > span').last(),
		]) {
			await expect(part).toHaveCSS('color', 'rgb(118, 115, 107)')
			await expect(part).toHaveCSS('text-decoration-line', 'none')
		}
	}
	await expectCheckedLook()
	const saved = await page.evaluate(() =>
		Object.keys(localStorage).filter((key) =>
			key.startsWith('cooking-progress:'),
		),
	)
	expect(saved).toHaveLength(1)
	await page.reload()
	await hydrated(onion)
	await expect(onion).toBeChecked()
	await expectCheckedLook()
	await onion.press('Space')
	await expect(onion).not.toBeChecked()
	await expect(circle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
})

test('the Ingredients sheet and a share page start every circle and heading on one edge and every row’s text in one column', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	const oneEdge = async (scope: Locator) => {
		const { leads, texts } = await rowEdges(scope)
		expect(leads).toHaveLength(8)
		expect(new Set(leads).size).toBe(1)
		expect(texts).toHaveLength(6)
		expect(new Set(texts)).toEqual(new Set([leads[0]! + 36]))
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
	await oneEdge(sheet)

	await page.goto(`/share/${recipe.id}`)
	await oneEdge(page.getByRole('main'))
})

test('ingredients, steps and the description read in the sans, upright; the title, section headings and step numerals in the serif', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await page.goto(`/recipes/${recipe.id}`)
	const face = (locator: Locator) =>
		locator.evaluate((el) => {
			const style = getComputedStyle(el)
			return `${style.fontFamily.split(',')[0]!.replace(/['"]/g, '')} ${style.fontStyle}`
		})
	const sans = 'Schibsted Grotesk normal'
	const serif = 'Newsreader normal'
	const onion = page.getByRole('checkbox', { name: 'onion', exact: true })
	expect(await face(onion.locator('[data-ingredient-text]'))).toBe(sans)
	// The note, after its comma, in muted roman.
	expect(
		await face(onion.locator('[data-ingredient-name] > span').last()),
	).toBe(sans)
	expect(await face(page.locator('[data-step-text]').first())).toBe(sans)
	expect(await face(page.getByText('A quick pantry soup.'))).toBe(sans)
	expect(await face(page.getByRole('heading', { level: 1 }))).toBe(serif)
	expect(
		await face(page.getByRole('heading', { name: 'Ingredients' }).first()),
	).toBe(serif)
	expect(await face(page.getByRole('heading', { name: 'Instructions' }))).toBe(
		serif,
	)
	expect(await face(page.locator('[data-step-number]').first())).toBe(serif)
	await expect(page.locator('[data-ingredient-text]').first()).toHaveCSS(
		'font-size',
		'17px',
	)
})

test('step numerals are 24px and green, two digits clear the text, hairlines part the steps, and a finished step fades without a strike, its check where its numeral was', async ({
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
	await expect(numeral).toHaveCSS('font-size', '24px')
	// The primary green in light.
	await expect(numeral).toHaveCSS('color', 'rgb(31, 90, 61)')
	const text = await box(tenth.locator('[data-step-text]'))
	const number = await numeral.evaluate((el) => {
		const range = document.createRange()
		range.selectNodeContents(el)
		return range.getBoundingClientRect().right
	})
	expect(number).toBeLessThan(text.x)
	await expect(tenth.locator('[data-step-text]')).toHaveCSS('font-size', '17px')
	// Its text starts in the column the ingredients' text does.
	const ingredientText = await box(
		page
			.getByRole('checkbox', { name: 'olive oil', exact: true })
			.locator('[data-ingredient-text]'),
	)
	expect(Math.round(text.x)).toBe(Math.round(ingredientText.x))
	// A hairline under every step but the last.
	await expect(tenth).toHaveCSS('border-bottom-width', '1px')
	await expect(steps.last()).toHaveCSS('border-bottom-width', '0px')

	const first = steps.first()
	await hydrated(first)
	// Within its row, read in one go: checking a step scrolls to the next.
	const inRow = (part: Locator) =>
		part.evaluate((el) => {
			const row = el.closest('[data-step-id]')!.getBoundingClientRect()
			const inner = el.getBoundingClientRect()
			return {
				x: inner.x - row.x,
				y: inner.y - row.y,
				width: inner.width,
				height: inner.height,
			}
		})
	const digit = await inRow(first.locator('[data-step-number]'))
	// Its middle is the temperature, which converts on a tap.
	await first.locator('[data-step-number]').tap()
	await expect(first).toBeChecked()
	// The check in the numeral's place (print keeps the number), centred on
	// the same first line.
	const check = first.locator('[data-step-number] svg')
	await expect(check).toBeVisible()
	const checkBox = await inRow(check)
	expect(
		Math.abs(checkBox.y + checkBox.height / 2 - (digit.y + digit.height / 2)),
	).toBeLessThanOrEqual(1)
	expect(Math.round(checkBox.x)).toBe(Math.round(digit.x))
	const stepText = first.locator('[data-step-text]')
	await expect(stepText).toHaveCSS('text-decoration-line', 'none')
	await expect(stepText).toHaveCSS('color', 'rgb(118, 115, 107)')
	// A cue keeps its weight, fades and loses its underline.
	const cue = first.getByTestId('cooking-duration-cue')
	await expect(cue).toHaveCSS('font-weight', '600')
	await expect(cue).toHaveCSS('text-decoration-line', 'none')
})

test('the page sets its text in one reading size and one small size, never 12 or 15px', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createSoup(user)
	await prisma.recipe.update({
		where: { id: recipe.id },
		data: { notes: 'Leave the beans out for a smoother soup.' },
	})
	const sizes = () =>
		page.evaluate(() => {
			const found = new Map<string, string>()
			const walker = document.createTreeWalker(
				document.body,
				NodeFilter.SHOW_TEXT,
			)
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				const el = node.parentElement!
				if (!node.textContent?.trim()) continue
				if (!el.closest('#main-content, [data-nav-bar], [role="dialog"]')) {
					continue
				}
				const rect = el.getBoundingClientRect()
				// Out of sight (a screen reader's line) counts for nothing.
				if (rect.width <= 1 || rect.height <= 1) continue
				if (!el.checkVisibility()) continue
				found.set(getComputedStyle(el).fontSize, node.textContent.trim())
			}
			return Object.fromEntries(found)
		})
	// Scaled, so the yield line shows, and scrolled, so the Ingredients
	// button floats.
	await page.goto(`/recipes/${recipe.id}?scale=2`)
	await expect(page.getByText('original: 4')).toBeVisible()
	const top = await sizes()
	await page
		.getByRole('heading', { name: 'Instructions' })
		.evaluate((heading) => heading.scrollIntoView())
	await expect(
		page.getByRole('button', { name: /^Ingredients ·/ }),
	).toBeVisible()
	const scrolled = await sizes()
	// And the Add to Plan sheet.
	await page.evaluate(() => window.scrollTo(0, 0))
	await page.getByRole('button', { name: 'Add to Plan' }).tap()
	await expect(page.getByRole('dialog', { name: 'Add to Plan' })).toBeVisible()
	const sheet = await sizes()
	expect(sheet).toHaveProperty(['13.5px'])
	for (const found of [top, scrolled, sheet]) {
		expect(found).not.toHaveProperty(['12px'])
		expect(found).not.toHaveProperty(['15px'])
	}
	// Notes read at the ingredients' size; small labels at 13.5px.
	await expect(
		page.getByText('Leave the beans out for a smoother soup.'),
	).toHaveCSS('font-size', '17px')
	await expect(page.getByRole('link', { name: 'seriouseats.com' })).toHaveCSS(
		'font-size',
		'13.5px',
	)
	await expect(page.getByRole('button', { name: 'Scale 2×' })).toHaveCSS(
		'font-size',
		'13.5px',
	)
	await expect(
		page.getByRole('heading', { name: 'Ingredients' }).first(),
	).toHaveCSS('font-size', '24px')
	await expect(page.getByRole('heading', { name: 'Instructions' })).toHaveCSS(
		'font-size',
		'24px',
	)
})
