import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { EMPTY_MENU_MESSAGE } from '#app/utils/plan-menu.server.ts'
import { expect, hydrated, test } from '#tests/playwright-utils.ts'

// A 390px layout: the test browser's scrollbar gutter takes 15px.
test.use({ viewport: { width: 405, height: 844 }, hasTouch: true })

declare global {
	interface Window {
		shareCalls: Array<ShareData>
	}
}

type Owner = { id: string; householdId: string }

const LONG_WORD = 'Hochgeschwindigkeitsbackofenpapierzuschnitt'
const MISSING_LINE =
	'This Recipe isn’t in your Recipes any more. Edit the Menu to replace or remove it.'

async function createRecipe(
	user: Owner,
	title: string,
	more: { yieldAmount?: number; yieldLabel?: string } = {},
) {
	return prisma.recipe.create({
		data: { title, userId: user.id, householdId: user.householdId, ...more },
		select: { id: true, title: true },
	})
}

/**
 * A Menu with an unnamed section of one Recipe, a named section holding a
 * scaled Recipe with a yield, a Recipe with a note, a missing Recipe and a
 * note card with Shopping lines, and an empty named section.
 */
async function createDinner(
	user: Owner,
	{
		title = 'Sunday lunch',
		recipeName = 'Roast chicken',
		note = 'Boil in the morning.',
		shoppingLine = 'Dry white wine',
	} = {},
) {
	const olives = await createRecipe(user, `Olives for ${title}`)
	const chicken = await createRecipe(user, recipeName, {
		yieldAmount: 4,
		yieldLabel: 'servings',
	})
	const potatoes = await createRecipe(user, `Potatoes for ${title}`)
	const item = (recipe: { id: string; title: string }, order: number) => ({
		kind: 'recipe',
		recipeId: recipe.id,
		recipeTitle: recipe.title,
		scaleMultiplier: 1,
		order,
	})
	return prisma.menu.create({
		data: {
			title,
			titleKey: title.toLowerCase(),
			description: 'A long lunch that mostly cooks itself.',
			defaultGuestCount: 8,
			householdId: user.householdId,
			sections: {
				create: [
					{ order: 0, items: { create: [item(olives, 0)] } },
					{
						name: 'Mains',
						order: 1,
						items: {
							create: [
								{ ...item(chicken, 0), scaleMultiplier: 2, note },
								item(potatoes, 1),
								{
									kind: 'recipe',
									recipeTitle: 'Green salad',
									scaleMultiplier: 1,
									order: 2,
								},
								{
									kind: 'note',
									note: 'Drinks: a cold white and sparkling water.',
									order: 3,
									shoppingLines: {
										create: [
											{
												name: shoppingLine,
												quantity: '2',
												unit: 'bottles',
												order: 0,
											},
										],
									},
								},
							],
						},
					},
					{ name: 'To finish', order: 2 },
				],
			},
		},
		select: { id: true, title: true },
	})
}

async function createEmptyMenu(user: Owner, title = 'Friday supper') {
	return prisma.menu.create({
		data: {
			title,
			titleKey: title.toLowerCase(),
			householdId: user.householdId,
			sections: { create: { order: 0 } },
		},
		select: { id: true, title: true },
	})
}

const bar = (page: Page) => page.locator('[data-nav-bar]')
const share = (scope: Locator | Page) =>
	scope.getByRole('button', { name: 'Share', exact: true })
const edit = (scope: Locator | Page) =>
	scope.getByRole('link', { name: 'Edit', exact: true })
const main = (page: Page) => page.locator('#main-content')

async function box(locator: Locator) {
	const found = await locator.boundingBox()
	expect(found).not.toBeNull()
	return found!
}

// Records every share() call and resolves it, as a finished share does.
async function stubShareSheet(page: Page) {
	await page.addInitScript(() => {
		window.shareCalls = []
		Object.defineProperty(Navigator.prototype, 'canShare', {
			configurable: true,
			value: () => true,
		})
		Object.defineProperty(Navigator.prototype, 'share', {
			configurable: true,
			value: (data: ShareData) => {
				window.shareCalls.push(data)
				return Promise.resolve()
			},
		})
	})
}

/** Every font size of text on screen in the page, the bar and an open sheet. */
function textSizes(page: Page) {
	return page.evaluate(() => {
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
			// Shared controls that keep their own size on every screen: the
			// letter of a Recipe without a photo, and a sheet's line under its
			// title.
			if (el.closest('[data-recipe-thumb]')) continue
			if (el.id && document.querySelector(`[aria-describedby~="${el.id}"]`)) {
				continue
			}
			const rect = el.getBoundingClientRect()
			if (rect.width <= 1 || rect.height <= 1) continue
			if (!el.checkVisibility()) continue
			found.set(getComputedStyle(el).fontSize, node.textContent.trim())
		}
		return Object.fromEntries(found)
	})
}

test('the nav bar holds Share and Edit, in the page the server sends, and the page has none of its own', async ({
	page,
	login,
}) => {
	const user = await login()
	const menu = await createDinner(user)

	// Before any script runs: the buttons come with the bar, and Edit is a
	// link that works without script.
	const html = await (
		await page.request.get(`/recipes/menus/${menu.id}`)
	).text()
	const barHtml = html.slice(
		html.indexOf('data-nav-bar'),
		html.indexOf('</header>'),
	)
	expect(barHtml).toContain('aria-label="Share"')
	expect(barHtml).toContain('aria-label="Edit"')
	expect(barHtml).toContain(`href="/recipes/menus/${menu.id}/edit"`)

	await page.goto(`/recipes/menus/${menu.id}`)
	for (const control of [share(bar(page)), edit(bar(page))]) {
		await expect(control).toBeVisible()
		const size = await box(control)
		expect(size.height).toBeGreaterThanOrEqual(44)
		expect(size.width).toBeGreaterThanOrEqual(44)
	}
	// One of each for a screen reader: the page's own are gone.
	await expect(share(page)).toHaveCount(1)
	await expect(edit(page)).toHaveCount(1)
	// Back, Share, Edit, then the page.
	const order = await page.evaluate(() => {
		const nodes = [
			document.querySelector('[data-nav-back]')!,
			document.querySelector('[data-nav-bar] button[aria-label="Share"]')!,
			document.querySelector('[data-nav-bar] a[aria-label="Edit"]')!,
			document.querySelector('#main-content h1')!,
		]
		return nodes
			.slice(1)
			.every(
				(node, index) =>
					nodes[index]!.compareDocumentPosition(node) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			)
	})
	expect(order).toBe(true)
})

test('Edit in the bar opens the edit screen, and after a rename the bar shares the Menu under its new name', async ({
	page,
	login,
}) => {
	const user = await login()
	const menu = await createDinner(user)
	await stubShareSheet(page)
	await page.goto(`/recipes/menus/${menu.id}`)

	await hydrated(edit(bar(page)))
	await edit(bar(page)).tap()
	await expect(page).toHaveURL(`/recipes/menus/${menu.id}/edit`)
	// An edit screen has Cancel and Save, not the Menu's buttons.
	await expect(share(page)).toHaveCount(0)
	await page.getByLabel('Title', { exact: true }).fill('Easter lunch')
	await page.getByRole('button', { name: 'Save', exact: true }).tap()
	await expect(page).toHaveURL(`/recipes/menus/${menu.id}`)
	await expect(
		page.getByRole('heading', { level: 1, name: 'Easter lunch' }),
	).toBeVisible()

	await share(bar(page)).tap()
	const origin = new URL(page.url()).origin
	await expect
		.poll(() => page.evaluate(() => window.shareCalls))
		.toEqual([
			{ title: 'Easter lunch', url: `${origin}/share/menus/${menu.id}` },
		])
	expect(
		await prisma.menu.findUniqueOrThrow({
			where: { id: menu.id },
			select: { title: true },
		}),
	).toEqual({ title: 'Easter lunch' })
})

test('Share in the bar copies the public link', async ({ page, login }) => {
	const user = await login()
	const menu = await createDinner(user)
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
	await page.goto(`/recipes/menus/${menu.id}`)
	await hydrated(share(bar(page)))
	await share(bar(page)).tap()
	await expect(
		page
			.locator('[data-sonner-toast]')
			.filter({ hasText: 'Public link copied' }),
	).toBeVisible()
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		`${new URL(page.url()).origin}/share/menus/${menu.id}`,
	)
})

test('a second tap on the bar’s Share while the share sheet is open is ignored', async ({
	page,
	login,
}) => {
	const user = await login()
	const menu = await createDinner(user)
	// The sheet stays open until the test closes it.
	await page.addInitScript(() => {
		window.shareCalls = []
		Object.defineProperty(Navigator.prototype, 'canShare', {
			configurable: true,
			value: () => true,
		})
		Object.defineProperty(Navigator.prototype, 'share', {
			configurable: true,
			value: (data: ShareData) => {
				window.shareCalls.push(data)
				return new Promise<void>((resolve) => {
					;(window as unknown as { closeSheet: () => void }).closeSheet =
						resolve
				})
			},
		})
	})
	await page.goto(`/recipes/menus/${menu.id}`)
	await hydrated(share(bar(page)))
	await share(bar(page)).tap()
	await share(bar(page)).tap()
	expect(await page.evaluate(() => window.shareCalls.length)).toBe(1)
	// Once it has closed, Share works again.
	await page.evaluate(() =>
		(window as unknown as { closeSheet: () => void }).closeSheet(),
	)
	await expect(async () => {
		await share(bar(page)).tap()
		expect(await page.evaluate(() => window.shareCalls.length)).toBe(2)
	}).toPass()
})

for (const pointer of ['a finger', 'a mouse'] as const) {
	test.describe(`at 768px with ${pointer}`, () => {
		test.use({
			viewport: { width: 783, height: 844 },
			hasTouch: pointer === 'a finger',
		})

		test('the page has its own Share and Edit beside Add to Plan and the bar has none', async ({
			page,
			login,
		}) => {
			const user = await login()
			const menu = await createDinner(user)
			await page.goto(`/recipes/menus/${menu.id}`)
			expect(
				await page.evaluate(() => ({
					width: document
						.querySelector('#main-content')!
						.getBoundingClientRect().width,
					mouse: matchMedia('(pointer: fine)').matches,
				})),
			).toEqual({ width: 768, mouse: pointer === 'a mouse' })

			await expect(share(main(page))).toBeVisible()
			await expect(edit(main(page))).toBeVisible()
			// Never two of either for a screen reader.
			await expect(share(page)).toHaveCount(1)
			await expect(edit(page)).toHaveCount(1)
			await expect(bar(page).getByRole('button')).toHaveCount(0)
			// They sit on the button's row, which keeps its own width.
			const add = await box(
				page.getByRole('button', { name: 'Add to Plan', exact: true }),
			)
			const shareBox = await box(share(main(page)))
			expect(add.height).toBe(44)
			expect(shareBox.x).toBeGreaterThanOrEqual(add.x + add.width)
			expect(Math.abs(shareBox.y - add.y)).toBeLessThanOrEqual(1)
			expect(add.width).toBeLessThan(200)
		})
	})
}

// The widths the styles switch on are the window's, scrollbar gutter
// included: 715px is a 700px layout, and 767px is the last phone width.
for (const width of [715, 767]) {
	test.describe(`in a ${width}px window`, () => {
		test.use({ viewport: { width, height: 844 } })

		test('the bar holds Share and Edit, Add to Plan fills the row, and its form opens in the row’s place', async ({
			page,
			login,
		}) => {
			const user = await login()
			const menu = await createDinner(user)
			await page.goto(`/recipes/menus/${menu.id}`)
			expect((await box(main(page))).width).toBe(width - 15)

			await expect(share(bar(page))).toBeVisible()
			await expect(edit(bar(page))).toBeVisible()
			// The page has none of its own.
			await expect(share(page)).toHaveCount(1)
			await expect(edit(page)).toHaveCount(1)
			const add = page.getByRole('button', { name: 'Add to Plan', exact: true })
			const column = await box(page.getByRole('heading', { level: 1 }))
			const addBox = await box(add)
			expect(addBox.height).toBe(48)
			expect(addBox.x).toBe(column.x)
			expect(addBox.width).toBe(column.width)

			// A tall screen this wide opens the form in place, not as a sheet.
			await hydrated(add)
			await add.tap()
			const date = page.getByLabel('Date', { exact: true })
			await expect(date).toBeVisible()
			await expect(page.getByRole('dialog')).toHaveCount(0)
			await expect(share(page)).toHaveCount(1)
			// The form starts where the button was: no empty row above it.
			const form = page.locator('form', { has: date })
			const formBox = await box(form)
			expect(formBox.x).toBe(column.x)
			expect(Math.abs(formBox.y - addBox.y)).toBeLessThanOrEqual(1)
			for (const name of ['Cancel', 'Add to Plan']) {
				const button = form.getByRole('button', { name, exact: true })
				expect((await box(button)).height).toBeGreaterThanOrEqual(44)
				await expect(button).toHaveCSS('font-size', '16px')
			}
			// Only the form's own Add to Plan is left; Cancel brings the
			// page's back where it was.
			await expect(add).toHaveCount(1)
			await form.getByRole('button', { name: 'Cancel', exact: true }).tap()
			await expect(date).toHaveCount(0)
			expect((await box(add)).y).toBe(addBox.y)
		})
	})
}

test.describe('at 320px', () => {
	test.use({ viewport: { width: 335, height: 700 } })

	test('a long title, one long word as a title, a long Recipe name, note and Shopping line leave no sideways scroll, on the Menu and on its shared page', async ({
		page,
		login,
	}) => {
		const user = await login()
		const wordy = await createDinner(user, {
			title:
				'Sunday lunch for the whole family with roast chicken and lemon tart',
			recipeName: LONG_WORD,
			note: `Carve at the table and pass the ${LONG_WORD} round with the gravy, twice if there is any left.`,
			shoppingLine: `${LONG_WORD} for the people who do not drink wine`,
		})
		const oneWord = await createDinner(user, { title: LONG_WORD })
		for (const url of [
			`/recipes/menus/${wordy.id}`,
			`/share/menus/${wordy.id}`,
			`/recipes/menus/${oneWord.id}`,
			`/share/menus/${oneWord.id}`,
		]) {
			await page.goto(url)
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
			await expect(page.getByText('2 bottles')).toBeVisible()
			const edges = await page.evaluate(() => {
				const rights = [
					...document.querySelectorAll(
						'#main-content :is(h1, h2, p, li, a, button, span)',
					),
				].map((el) => el.getBoundingClientRect().right)
				return {
					main: document.querySelector('main')!.getBoundingClientRect().right,
					page: document.documentElement.scrollWidth,
					furthest: Math.max(...rights),
					// The title spans the content column.
					content: document
						.querySelector('#main-content h1')!
						.getBoundingClientRect().right,
				}
			})
			expect(edges.main, url).toBe(320)
			expect(edges.page, url).toBeLessThanOrEqual(320)
			// Everything stops at the content edge, inside the gutter.
			expect(edges.content, url).toBeLessThan(320)
			expect(edges.furthest, url).toBeLessThanOrEqual(edges.content)
		}
	})
})

test('a Menu’s page, its Add to Plan sheet and its shared page set their text in the Recipe page’s sizes, never 12, 14 or 15px', async ({
	page,
	login,
	browser,
}) => {
	const user = await login()
	const menu = await createDinner(user)
	await page.goto(`/recipes/menus/${menu.id}`)
	const content = main(page)
	await expect(content.getByRole('heading', { level: 1 })).toHaveCSS(
		'font-size',
		'32px',
	)
	await expect(content.getByRole('heading', { name: 'Mains' })).toHaveCSS(
		'font-size',
		'24px',
	)
	await expect(content.getByText('Usually for 8 guests')).toHaveCSS(
		'font-size',
		'13.5px',
	)
	await expect(
		content.getByText('A long lunch that mostly cooks itself.'),
	).toHaveCSS('font-size', '16px')
	const name = content.getByText('Roast chicken', { exact: true })
	await expect(name).toHaveCSS('font-size', '17px')
	await expect(name).toHaveCSS('font-weight', '500')
	for (const small of [
		'2× · makes 8 servings',
		'Boil in the morning.',
		MISSING_LINE,
		'Nothing in this section yet.',
	]) {
		await expect(content.getByText(small, { exact: true })).toHaveCSS(
			'font-size',
			'13.5px',
		)
	}
	await expect(
		content.getByText('Drinks: a cold white and sparkling water.'),
	).toHaveCSS('font-size', '17px')
	await expect(
		content.locator('li li').filter({ hasText: 'Dry white wine' }),
	).toHaveCSS('font-size', '13.5px')
	const onPage = await textSizes(page)

	const add = page.getByRole('button', { name: 'Add to Plan', exact: true })
	await hydrated(add)
	await add.tap()
	const sheet = page.getByRole('dialog', { name: 'Add to Plan' })
	await expect(sheet).toBeVisible()
	for (const label of ['Date', 'Label', 'Serving time', 'Guests']) {
		const text = sheet.getByText(label, { exact: true })
		await expect(text).toHaveCSS('font-size', '13.5px')
		await expect(text).toHaveCSS('font-weight', '600')
		expect((await box(sheet.getByLabel(label, { exact: true }))).height).toBe(
			44,
		)
	}
	await expect(sheet.getByText(/^Recipe multipliers copy/)).toHaveCSS(
		'font-size',
		'13.5px',
	)
	const inSheet = await textSizes(page)

	// The shared page, signed out.
	const context = await browser.newContext({
		viewport: { width: 405, height: 844 },
		hasTouch: true,
	})
	try {
		const visitor = await context.newPage()
		await visitor.goto(`/share/menus/${menu.id}`)
		await expect(visitor.getByRole('heading', { level: 1 })).toHaveCSS(
			'font-size',
			'32px',
		)
		for (const small of [
			/^Shared on/,
			'Usually for 8 guests',
			'Save your own copy of this Menu and its Recipes.',
			'Recipe unavailable',
		]) {
			await expect(main(visitor).getByText(small)).toHaveCSS(
				'font-size',
				'13.5px',
			)
		}
		const save = await box(
			visitor.getByRole('link', { name: 'Save to your Menus' }),
		)
		// As wide as the title's column.
		const column = await box(visitor.getByRole('heading', { level: 1 }))
		expect(save.height).toBe(48)
		expect(save.x).toBe(column.x)
		expect(save.width).toBe(column.width)
		const shared = await textSizes(visitor)
		for (const found of [onPage, inSheet, shared]) {
			// Each reading saw the small text this page sets.
			expect(found).toHaveProperty(['13.5px'])
			expect(found).not.toHaveProperty(['12px'])
			expect(found).not.toHaveProperty(['14px'])
			expect(found).not.toHaveProperty(['15px'])
		}
	} finally {
		await context.close()
	}
})

test('a Recipe row is at least 56px with its photo on the content edge and reads name, quantity, then note; a missing Recipe is no link', async ({
	page,
	login,
}) => {
	const user = await login()
	const menu = await createDinner(user)
	await page.goto(`/recipes/menus/${menu.id}`)
	const content = main(page)
	const row = content.getByRole('link', { name: /Roast chicken/ })
	const rowBox = await box(row)
	expect(rowBox.height).toBeGreaterThanOrEqual(56)
	// The row and its photo start on the content edge, where the title does.
	const column = await box(content.getByRole('heading', { level: 1 }))
	expect(rowBox.x).toBe(column.x)
	const thumb = await box(row.locator('[data-recipe-thumb]'))
	expect(thumb).toMatchObject({ x: column.x, width: 44, height: 44 })
	const name = await box(row.getByText('Roast chicken', { exact: true }))
	const quantity = await box(row.getByText('2× · makes 8 servings'))
	const note = await box(row.getByText('Boil in the morning.'))
	expect(quantity.y).toBeGreaterThanOrEqual(name.y + name.height)
	expect(note.y).toBeGreaterThanOrEqual(quantity.y + quantity.height)
	expect(quantity.x).toBe(name.x)
	expect(note.x).toBe(name.x)
	// A plain row is the same 56px or more, and the rows touch.
	const plain = await box(content.getByRole('link', { name: /Potatoes for/ }))
	expect(plain.height).toBeGreaterThanOrEqual(56)
	expect(Math.abs(plain.y - (rowBox.y + rowBox.height))).toBeLessThanOrEqual(1)

	const missing = content
		.getByRole('listitem')
		.filter({ hasText: MISSING_LINE })
	await expect(missing).toBeVisible()
	await expect(missing.getByRole('link')).toHaveCount(0)
	await expect(content.getByRole('link', { name: /Green salad/ })).toHaveCount(
		0,
	)
})

test('Add to Plan is one full-width 48px button clear of an empty Menu’s line, and its sheet says why an empty Menu was not planned', async ({
	page,
	login,
}) => {
	const user = await login()
	const menu = await createEmptyMenu(user)
	await page.goto(`/recipes/menus/${menu.id}`)
	const add = page.getByRole('button', { name: 'Add to Plan', exact: true })
	const addBox = await box(add)
	// As wide as the title's column.
	const column = await box(page.getByRole('heading', { level: 1 }))
	expect(addBox.height).toBe(48)
	expect(addBox.x).toBe(column.x)
	expect(addBox.width).toBe(column.width)
	// The bar still has the Menu's buttons.
	await expect(share(bar(page))).toBeVisible()
	await expect(edit(bar(page))).toBeVisible()

	const empty = page.getByText('Nothing on this Menu yet.')
	expect((await box(empty)).y).toBeGreaterThanOrEqual(
		addBox.y + addBox.height + 24,
	)
	// On the page, not in a box.
	await expect(empty).toHaveCSS('border-top-width', '0px')

	await hydrated(add)
	await add.tap()
	const sheet = page.getByRole('dialog', { name: 'Add to Plan' })
	const submit = sheet.getByRole('button', { name: 'Add to Plan', exact: true })
	const field = await box(sheet.getByLabel('Date', { exact: true }))
	const submitBox = await box(submit)
	expect(submitBox.height).toBe(48)
	// As wide as the sheet's full-width field.
	expect(submitBox.width).toBe(field.width)
	await submit.tap()
	const error = sheet.getByText(EMPTY_MENU_MESSAGE)
	await expect(error).toBeVisible()
	await expect(error).toHaveCSS('font-size', '13.5px')
	expect(await prisma.meal.count({ where: { sourceMenuId: menu.id } })).toBe(0)
})
