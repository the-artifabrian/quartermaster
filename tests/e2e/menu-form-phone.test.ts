import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, hydrated, test } from '#tests/playwright-utils.ts'

// A 390px layout: the test browser's scrollbar gutter takes 15px.
test.use({ viewport: { width: 405, height: 844 }, hasTouch: true })

type Owner = { id: string; householdId: string }

/**
 * A Menu with an unnamed section holding a Recipe at 2× with a yield, a
 * missing Recipe and a note card with a Shopping line, and an empty named
 * section. A second Recipe, with a total time, waits in the picker.
 */
async function createMenu(user: Owner, recipeTitle = 'Roast chicken') {
	const owned = { userId: user.id, householdId: user.householdId }
	const recipe = await prisma.recipe.create({
		data: {
			...owned,
			title: recipeTitle,
			yieldAmount: 4,
			yieldLabel: 'servings',
		},
	})
	await prisma.recipe.create({
		data: { ...owned, title: 'Lemon tart', totalTime: 75 },
	})
	return prisma.menu.create({
		data: {
			title: 'Sunday lunch',
			titleKey: 'sunday lunch',
			householdId: user.householdId,
			sections: {
				create: [
					{
						order: 0,
						items: {
							create: [
								{
									kind: 'recipe',
									recipeId: recipe.id,
									recipeTitle,
									scaleMultiplier: 2,
									order: 0,
								},
								{
									kind: 'recipe',
									recipeTitle: 'Green salad',
									scaleMultiplier: 1,
									order: 1,
								},
								{
									kind: 'note',
									note: 'Something cold to drink',
									order: 2,
									shoppingLines: {
										create: {
											name: 'Sparkling water from the shop on the corner',
											quantity: '6',
											unit: 'bottles',
											order: 0,
										},
									},
								},
							],
						},
					},
					{ name: 'Dessert', order: 1 },
				],
			},
		},
		select: { id: true },
	})
}

const save = (page: Page) =>
	page.getByRole('button', { name: 'Save', exact: true })

/**
 * Opens a Menu form and waits for script and for the fonts, which swap in
 * and change what every box measures.
 */
async function openForm(page: Page, path: string) {
	await page.goto(path)
	await hydrated(save(page))
	await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

async function box(locator: Locator) {
	const found = await locator.boundingBox()
	expect(found).not.toBeNull()
	return found!
}

/**
 * Every font size of text and of a field on screen in the page, the bar, an
 * open sheet and an open menu, apart from the letter of a Recipe without a
 * photo, which keeps its own size on every screen.
 */
function textSizes(page: Page) {
	return page.evaluate(() => {
		const found = new Map<string, string>()
		const shown = (el: Element) => {
			if (
				!el.closest(
					'#main-content, [data-nav-bar], [role="dialog"], [role="menu"]',
				)
			) {
				return false
			}
			if (el.closest('[data-recipe-thumb]')) return false
			const rect = el.getBoundingClientRect()
			return rect.width > 1 && rect.height > 1 && el.checkVisibility()
		}
		const walker = document.createTreeWalker(
			document.body,
			NodeFilter.SHOW_TEXT,
		)
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const el = node.parentElement!
			if (!node.textContent?.trim()) continue
			if (!shown(el)) continue
			found.set(getComputedStyle(el).fontSize, node.textContent.trim())
		}
		for (const field of document.querySelectorAll(
			'input:not([type="hidden"]), textarea, select',
		)) {
			if (!shown(field)) continue
			found.set(
				getComputedStyle(field).fontSize,
				`field: ${field.getAttribute('aria-label') ?? field.id}`,
			)
		}
		return Object.fromEntries(found)
	})
}

// The sizes these screens use on a phone: small text, fields and button
// labels, names and the bar's actions, a sheet's title, the Recipes heading
// and the screen's title.
const FORM_SIZES = ['13.5px', '16px', '17px', '20px', '24px', '28px']

function expectOnlyFormSizes(sizes: Record<string, string>) {
	for (const [size, text] of Object.entries(sizes)) {
		expect(FORM_SIZES, `“${text}” at ${size}`).toContain(size)
	}
}

test('the Menu form reads in its phone sizes up to 767px and in the wider sizes from 768px', async ({
	page,
	login,
}) => {
	const user = await login()
	const menu = await createMenu(user)
	await openForm(page, `/recipes/menus/${menu.id}/edit`)
	await page.getByLabel('Title', { exact: true }).fill('')
	await save(page).click()

	const title = page.getByRole('heading', { level: 1 })
	const heading = page.getByRole('group', { name: 'Recipes' }).locator('legend')
	const hint = page.getByText(/^The arrows by a section/)
	const label = page.getByText('Title', { exact: true })
	const name = page.getByText('Roast chicken', { exact: true })
	const makes = page.getByText('Makes 8 servings')
	const missing = page.getByText('This Recipe isn’t in your Recipes any more')
	const times = page.getByText('×', { exact: true }).first()
	const emptySection = page.getByText('No Recipes in this section yet.')
	const textButtons = [
		page.getByRole('button', { name: 'Add Recipe', exact: true }).first(),
		page.getByRole('button', { name: 'Replace Recipe' }),
		page.getByRole('button', { name: 'Add note' }).first(),
		page.getByRole('button', { name: 'Add shopping line' }),
		page.getByRole('button', { name: 'Move Roast chicken to another section' }),
		page.getByRole('button', { name: 'Add section' }),
		page.getByRole('button', { name: 'Delete Menu' }),
	]
	const scale = page.getByLabel('Scale multiplier for Roast chicken')
	const error = page.getByText('Name this Menu', { exact: true })
	await expect(error).toBeVisible()

	await expect(title).toHaveCSS('font-size', '28px')
	await expect(heading).toHaveCSS('font-size', '24px')
	await expect(heading).toHaveCSS('text-transform', 'none')
	await expect(heading).toHaveCSS('font-family', /Newsreader/)
	await expect(hint).toHaveCSS('font-size', '13.5px')
	await expect(label).toHaveCSS('font-size', '13.5px')
	await expect(name).toHaveCSS('font-size', '17px')
	await expect(makes).toHaveCSS('font-size', '13.5px')
	await expect(missing).toHaveCSS('font-size', '13.5px')
	await expect(times).toHaveCSS('font-size', '16px')
	// A field under 16px would make iOS zoom the page on focus.
	await expect(scale).toHaveCSS('font-size', '16px')
	await expect(emptySection).toHaveCSS('font-size', '13.5px')
	for (const button of textButtons) {
		await expect(button).toHaveCSS('font-size', '16px')
	}
	await expect(error).toHaveCSS('font-size', '13.5px')
	expectOnlyFormSizes(await textSizes(page))

	// The heading starts a new part of the form: more room above it than
	// between it and its line.
	const guests = await box(page.getByLabel('Default guests'))
	const headingBox = await box(heading)
	const hintBox = await box(hint)
	const above = headingBox.y - (guests.y + guests.height)
	expect(above).toBe(32)
	expect(hintBox.y - (headingBox.y + headingBox.height)).toBeLessThan(above - 8)

	await page.setViewportSize({ width: 767, height: 844 })
	await expect(title).toHaveCSS('font-size', '28px')
	await expect(heading).toHaveCSS('font-size', '24px')
	await expect(name).toHaveCSS('font-size', '17px')
	await expect(textButtons[0]!).toHaveCSS('font-size', '16px')

	await page.setViewportSize({ width: 768, height: 844 })
	await expect(title).toHaveCSS('font-size', '24px')
	await expect(heading).toHaveCSS('font-size', '12px')
	await expect(heading).toHaveCSS('text-transform', 'uppercase')
	await expect(hint).toHaveCSS('font-size', '14px')
	await expect(label).toHaveCSS('font-size', '14px')
	await expect(name).toHaveCSS('font-size', '14px')
	await expect(makes).toHaveCSS('font-size', '12px')
	await expect(missing).toHaveCSS('font-size', '12px')
	await expect(times).toHaveCSS('font-size', '14px')
	await expect(emptySection).toHaveCSS('font-size', '14px')
	for (const button of textButtons) {
		// Add Recipe and Replace Recipe are the popover's triggers here.
		await expect(button.filter({ visible: true })).toHaveCSS(
			'font-size',
			'14px',
		)
	}
	await expect(error).toHaveCSS('font-size', '14px')
})

test('New Menu has the edit screens’ title and small labels on a phone', async ({
	page,
	login,
}) => {
	await login()
	await openForm(page, '/recipes/menus/new')
	await expect(page.getByRole('heading', { level: 1 })).toHaveCSS(
		'font-size',
		'28px',
	)
	for (const label of ['Title', 'Description', 'Default guests']) {
		await expect(page.getByText(label, { exact: true })).toHaveCSS(
			'font-size',
			'13.5px',
		)
	}
	expectOnlyFormSizes(await textSizes(page))
})

test('the Add Recipe sheet and the Move to… menu read at 17px with their small text at 13.5px', async ({
	page,
	login,
}) => {
	const user = await login()
	const menu = await createMenu(user)
	await openForm(page, `/recipes/menus/${menu.id}/edit`)

	await page
		.getByRole('button', { name: 'Move Roast chicken to another section' })
		.click()
	const target = page.getByRole('menuitem', { name: 'Dessert' })
	await expect(target).toHaveCSS('font-size', '17px')
	expectOnlyFormSizes(await textSizes(page))
	await page.keyboard.press('Escape')
	await expect(target).toBeHidden()

	// With a favorite the sheet groups its rows under two labels.
	await prisma.recipe.updateMany({
		where: { householdId: user.householdId, title: 'Lemon tart' },
		data: { isFavorite: true },
	})
	await openForm(page, `/recipes/menus/${menu.id}/edit`)
	await page
		.getByRole('button', { name: 'Add Recipe', exact: true })
		.first()
		.click()
	const sheet = page.getByRole('dialog', { name: 'Add a Recipe' })
	const option = sheet.getByRole('button', { name: /Lemon tart/ })
	await expect(option).toBeVisible()
	await expect(option.getByText('Lemon tart')).toHaveCSS('font-size', '17px')
	await expect(option.getByText('1 hr 15 min')).toHaveCSS('font-size', '13.5px')
	const group = sheet.getByText('Favorites', { exact: true })
	await expect(group).toHaveCSS('font-size', '13.5px')
	await expect(group).toHaveCSS('text-transform', 'none')
	expectOnlyFormSizes(await textSizes(page))

	await sheet.getByLabel('Search Recipes').fill('zzz')
	await expect(sheet.getByText('No Recipes found')).toHaveCSS(
		'font-size',
		'13.5px',
	)
})

test.describe('at a 320px layout', () => {
	// The test browser keeps 15px for its scrollbar.
	test.use({ viewport: { width: 335, height: 700 } })

	test('a Recipe card with one long word as its name scrolls nothing sideways, with its scale field and Remove on screen', async ({
		page,
		login,
	}) => {
		const user = await login()
		const oneWord = 'Rindfleischetikettierungsueberwachungsauf'
		const menu = await createMenu(user, oneWord)
		await openForm(page, `/recipes/menus/${menu.id}/edit`)
		const main = await box(page.locator('#main-content'))
		expect(main.width).toBe(320)

		await expect(page.getByText(oneWord, { exact: true })).toBeVisible()
		const inside = async (control: Locator) => {
			const found = await box(control)
			expect(found.x + found.width).toBeLessThanOrEqual(main.x + 320)
			return found
		}
		const scale = await inside(
			page.getByLabel(`Scale multiplier for ${oneWord}`),
		)
		const remove = await inside(
			page.getByRole('button', { name: `Remove ${oneWord} from Menu` }),
		)
		// The name has the row beside the thumb to itself; the scale field and
		// Remove sit under it, ending at the card's right edge as the note
		// field does.
		const name = await box(page.getByText(oneWord, { exact: true }))
		expect(scale.y).toBeGreaterThanOrEqual(name.y + name.height)
		expect(remove.y).toBeGreaterThanOrEqual(name.y + name.height)
		const note = await box(page.getByLabel(`Note for ${oneWord}`))
		expect(remove.x + remove.width).toBe(note.x + note.width)
		await inside(page.getByLabel('Shopping line 1 name'))
		await inside(page.getByRole('button', { name: 'Remove shopping line 1' }))
		expect(
			await page.evaluate(() => {
				const root = document.documentElement
				const main = document.querySelector('#main-content')!
				return (
					root.scrollWidth <= root.clientWidth &&
					main.scrollWidth <= main.clientWidth
				)
			}),
		).toBe(true)
	})

	test('Add Recipe and Add note share a row, and a card’s arrows and Move to… share another', async ({
		page,
		login,
	}) => {
		const user = await login()
		const menu = await createMenu(user)
		await openForm(page, `/recipes/menus/${menu.id}/edit`)

		const addRecipe = await box(
			page.getByRole('button', { name: 'Add Recipe', exact: true }).first(),
		)
		const addNote = await box(
			page.getByRole('button', { name: 'Add note' }).first(),
		)
		expect(addNote.y).toBe(addRecipe.y)
		expect(addNote.x).toBeGreaterThan(addRecipe.x + addRecipe.width)

		for (const card of ['Roast chicken', 'note “Something cold to drink”']) {
			const row = await Promise.all(
				[
					page.getByRole('button', { name: `Move ${card} up` }),
					page.getByRole('button', { name: `Move ${card} down` }),
					page.getByRole('button', {
						name: `Move ${card} to another section`,
					}),
				].map(box),
			)
			for (const control of row) {
				expect(control.y).toBe(row[0]!.y)
			}
		}
	})
})

test.describe('with a mouse in a narrow window', () => {
	test.use({ hasTouch: false })

	test('a row of the Move to… menu is still 44px tall', async ({
		page,
		login,
	}) => {
		const user = await login()
		const menu = await createMenu(user)
		await openForm(page, `/recipes/menus/${menu.id}/edit`)
		await page
			.getByRole('button', { name: 'Move Roast chicken to another section' })
			.click()
		const target = page.getByRole('menuitem', { name: 'Dessert' })
		await expect(target).toBeVisible()
		// Its laid-out height: the menu is still growing into place.
		expect(
			await target.evaluate((item) => (item as HTMLElement).offsetHeight),
		).toBe(44)
	})
})
