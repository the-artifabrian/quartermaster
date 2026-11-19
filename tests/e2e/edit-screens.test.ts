import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { SHELL_UA, setShellSafeArea } from '#tests/native-shell.ts'
import { expect, test } from '#tests/playwright-utils.ts'

// Recipe and Menu edit screens (edit and new): every error that holds Save
// back shows at what it is about, the tab bar is gone, leaving with changes
// asks first, and Save and Delete leave the history as if the screen was
// dismissed.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

type User = { id: string; householdId: string }

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

const saveButton = (page: Page) => page.locator('[data-nav-save]')
const cancelLink = (page: Page) =>
	page.locator('[data-nav-bar]').getByRole('link', { name: 'Cancel' })
const discardSheet = (page: Page) =>
	page.getByRole('dialog', { name: 'Discard changes?' })
const tabBar = (page: Page) => page.locator('[data-bottom-nav]')

async function createRecipe(user: User, title = 'Lentil soup') {
	return prisma.recipe.create({
		data: {
			title,
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: Array.from({ length: 10 }, (_, order) => ({
					name: `ingredient ${order + 1}`,
					order,
				})),
			},
			instructions: {
				create: Array.from({ length: 8 }, (_, order) => ({
					content: `Step ${order + 1}: stir, taste, and keep going a while longer.`,
					order,
				})),
			},
		},
		select: { id: true, title: true },
	})
}

async function createMenu(user: User, title = 'Terrace dinner') {
	return prisma.menu.create({
		data: {
			title,
			titleKey: title.toLowerCase(),
			householdId: user.householdId,
			sections: { create: { name: null, order: 0 } },
		},
		select: { id: true },
	})
}

const recipeTitle = (id: string) =>
	prisma.recipe
		.findUniqueOrThrow({ where: { id }, select: { title: true } })
		.then((recipe) => recipe.title)

/** Opens the list, then the Recipe from it, and returns both entries. */
async function openRecipeFromList(page: Page, title: string) {
	await page.goto('/recipes')
	const card = page.getByRole('link', { name: `${title} recipe` })
	await hydrated(card)
	const listIdx = await historyIdx(page)
	await card.tap()
	await expect(page).toHaveURL(/\/recipes\/[^/]+$/)
	const recipeIdx = await historyIdx(page)
	return { listIdx, recipeIdx }
}

async function openEdit(page: Page, recipeId: string) {
	const edit = page.getByRole('link', { name: 'Edit Recipe' })
	await hydrated(edit)
	await edit.tap()
	await expect(page).toHaveURL(`/recipes/${recipeId}/edit`)
	await hydrated(saveButton(page))
}

/**
 * Loads of the edit screen's own loader from now on. The root's reload after
 * a Save names only the root (`_routes=root`) and does not count.
 */
function editScreenLoads(page: Page) {
	const loads: string[] = []
	page.on('request', (request) => {
		const url = new URL(request.url())
		if (request.method() !== 'GET' || !url.pathname.endsWith('/edit.data')) {
			return
		}
		const routes = url.searchParams.get('_routes')
		if (routes === null || routes.includes('edit')) loads.push(request.url())
	})
	return loads
}

/** The element is on screen, below the pinned nav bar. */
async function expectInViewBelowBar(page: Page, target: Locator) {
	const barBottom = await page
		.locator('[data-nav-bar]')
		.evaluate((bar) => bar.getBoundingClientRect().bottom)
	await expect
		.poll(async () => {
			const box = (await target.boundingBox())!
			return box.y >= barBottom && box.y + box.height <= 844
		})
		.toBe(true)
}

test.describe('errors that hold Save back', () => {
	test('a new Recipe with only a title shows what is missing at its row, in view and focused; nothing is saved', async ({
		page,
		login,
	}) => {
		const user = await login()
		await page.goto('/recipes/new')
		await hydrated(saveButton(page))
		await page.getByLabel('Title').fill('Pea soup')
		await saveButton(page).tap()

		const name = page.getByLabel('Ingredient 1 name')
		// The only row cannot be removed, so its error does not offer to.
		const nameError = page.getByText('Name this ingredient', { exact: true })
		await expect(nameError).toBeVisible()
		await expect(name).toBeFocused()
		await expect(name).toHaveAttribute('aria-invalid', 'true')
		await expect(name).toHaveAccessibleDescription('Name this ingredient')
		await expectInViewBelowBar(page, name)
		const step = page.getByLabel('Step 1', { exact: true })
		await expect(
			page.getByText('Write this step', { exact: true }),
		).toBeVisible()
		await expect(step).toHaveAttribute('aria-invalid', 'true')
		await expect(page).toHaveURL('/recipes/new')
		expect(
			await prisma.recipe.count({ where: { householdId: user.householdId } }),
		).toBe(0)

		// Fixing a row clears its error; the other row's stays until fixed.
		await name.fill('split peas')
		await expect(nameError).toBeHidden()
		await expect(name).not.toHaveAttribute('aria-invalid')
		await expect(step).toHaveAttribute('aria-invalid', 'true')
		await saveButton(page).tap()
		await expect(step).toBeFocused()
		await step.fill('Simmer until soft.')
		await saveButton(page).tap()
		await expect(page).toHaveURL(/\/recipes\/[^/]+$/)
		await expect(
			page.getByRole('heading', { level: 1, name: 'Pea soup' }),
		).toBeVisible()
		expect(
			await prisma.recipe.count({ where: { householdId: user.householdId } }),
		).toBe(1)
	})

	test('an error never stays on the row that took the place of a removed one', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		await page.goto(`/recipes/${recipe.id}/edit`)
		await hydrated(saveButton(page))
		// Empty the first ingredient's name and save.
		await page.getByRole('button', { name: /^ingredient 1$/ }).tap()
		await page.getByLabel('Ingredient 1 name').fill('')
		await saveButton(page).tap()
		await expect(page.getByLabel('Ingredient 1 name')).toHaveAttribute(
			'aria-invalid',
			'true',
		)

		// Remove the empty row: "ingredient 2" moves up to the first place.
		await page
			.getByLabel('Ingredient 1 name')
			.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
			.getByRole('button', { name: 'Remove ingredient' })
			.tap()
		await expect(
			page.getByText('Name this ingredient, or remove it'),
		).toBeHidden()
		await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0)
	})

	test('a field in a collapsed section opens the section and takes focus', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		await page.goto(`/recipes/${recipe.id}/edit`)
		await hydrated(saveButton(page))
		const details = page.locator('summary', { hasText: 'Details' })
		await details.tap()
		await page.getByLabel('Source URL').fill('not a link')
		await details.tap()
		await expect(page.getByLabel('Source URL')).toBeHidden()
		await saveButton(page).tap()

		await expect(page.getByLabel('Source URL')).toBeFocused()
		await expectInViewBelowBar(page, page.getByLabel('Source URL'))
		expect(await recipeTitle(recipe.id)).toBe('Lentil soup')
	})

	test('too many new classifications show under Classification, which opens, and take focus', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		await page.goto(`/recipes/${recipe.id}/edit`)
		await hydrated(saveButton(page))
		const classification = page.locator('summary', {
			hasText: 'Classification',
		})
		await classification.tap()
		await page.getByRole('button', { name: 'Add cuisine' }).tap()
		const input = page.getByRole('textbox', { name: 'Add cuisine' })
		for (let n = 1; n <= 21; n++) {
			await input.fill(`Cuisine ${n}`)
			await input.press('Enter')
		}
		await classification.tap()
		await page.evaluate(() => window.scrollTo(0, 0))
		await saveButton(page).tap()

		const message = page.getByText('Add up to 20 new cuisines at a time')
		await expect(message).toBeVisible()
		const target = page.locator('[data-error-target]', { has: message })
		await expect(target).toBeFocused()
		await expectInViewBelowBar(page, target)
		await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
		expect(await recipeTitle(recipe.id)).toBe('Lentil soup')
	})

	test('an error the server returns shows the same way: in view, focused', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		await page.goto(`/recipes/${recipe.id}/edit`)
		await hydrated(saveButton(page))
		await page.getByLabel('Title').fill('Changed title')
		// A classification that is not this Household's passes the form's own
		// check; only the server can turn it down.
		await page
			.locator('input[name="recipeMetadata"]')
			.evaluate((input: HTMLInputElement) => {
				input.value = JSON.stringify({
					selectedValueIds: ['not-a-value'],
					newValues: { cuisine: [], season: [], course: [] },
				})
			})
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
		await saveButton(page).tap()

		const error = page.getByText(
			'One or more Recipe classifications are not available in this household.',
		)
		await expect(error).toBeVisible()
		const message = page.locator('[data-error-target]').first()
		await expect(message).toBeFocused()
		await expectInViewBelowBar(page, message)
		await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
		expect(await recipeTitle(recipe.id)).toBe('Lentil soup')
	})

	test("a Menu card's own error, with no field to focus, shows at the card, in view and focused", async ({
		page,
		login,
	}) => {
		const user = await login()
		const menu = await createMenu(user)
		await page.goto(`/recipes/menus/${menu.id}/edit`)
		await hydrated(saveButton(page))
		await page.getByRole('button', { name: 'Add note' }).tap()
		await page.getByLabel('Note text').fill('Lemonade')
		// One shopping line more than a note holds.
		const addLine = page.getByRole('button', { name: 'Add shopping line' })
		for (let line = 1; line <= 21; line++) {
			await addLine.tap()
			await page.getByLabel(`Shopping line ${line} name`).fill(`lemon ${line}`)
		}
		await page.evaluate(() => window.scrollTo(0, 0))
		await saveButton(page).tap()

		const message = page.getByText('A note can hold at most 20 shopping lines')
		await expect(message).toBeVisible()
		const target = page.locator('[data-error-target]', { has: message })
		await expect(target).toBeFocused()
		await expectInViewBelowBar(page, target)
		expect(
			await prisma.menuItem.count({ where: { section: { menuId: menu.id } } }),
		).toBe(0)
	})
})

test.describe('no tab bar on edit screens', () => {
	test.use({ userAgent: SHELL_UA })

	test('edit and new screens have no tab bar, from the first paint; the Recipe and Import keep theirs', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		const menu = await createMenu(user)
		const editScreens = [
			`/recipes/${recipe.id}/edit`,
			'/recipes/new',
			`/recipes/menus/${menu.id}/edit`,
			'/recipes/menus/new',
		]
		for (const path of editScreens) {
			const html = await (await page.request.get(path)).text()
			expect(html, path).toContain('data-nav-save')
			expect(html, path).not.toContain('data-bottom-nav')
			await page.goto(path)
			await hydrated(saveButton(page))
			await expect(tabBar(page), path).toHaveCount(0)
		}
		for (const path of [`/recipes/${recipe.id}`, '/recipes/import']) {
			const html = await (await page.request.get(path)).text()
			expect(html, path).toContain('data-bottom-nav')
			await page.goto(path)
			await expect(tabBar(page), path).toBeVisible()
		}

		// In and out by the nav bar: the bar goes with the edit screen and comes
		// back with the Recipe.
		await page.goto(`/recipes/${recipe.id}`)
		await openEdit(page, recipe.id)
		await expect(tabBar(page)).toHaveCount(0)
		await cancelLink(page).tap()
		await expect(page).toHaveURL(`/recipes/${recipe.id}`)
		await expect(tabBar(page)).toBeVisible()
	})

	test("the edit screen's last control scrolls to just above the home indicator, not above a tab bar", async ({
		page,
		login,
	}) => {
		await setShellSafeArea(page, { top: 47, bottom: 34 })
		const user = await login()
		const recipe = await createRecipe(user)
		await page.goto(`/recipes/${recipe.id}/edit`)
		await hydrated(saveButton(page))
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
		const deleteButton = page.getByRole('button', { name: 'Delete Recipe' })
		await expect(deleteButton).toBeInViewport()
		const box = (await deleteButton.boundingBox())!
		const gap = 844 - (box.y + box.height)
		// Clear of the 34pt home indicator, with the page's 1rem under it,
		// and no room left for a 54pt tab bar.
		expect(gap).toBeGreaterThanOrEqual(34 + 16)
		expect(gap).toBeLessThan(34 + 16 + 10)
	})
})

test.describe('leaving with changes asks first', () => {
	test('Cancel with changes asks; Keep Editing keeps them, Discard Changes leaves and saves nothing', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		const { recipeIdx } = await openRecipeFromList(page, recipe.title)
		await openEdit(page, recipe.id)
		await page.getByLabel('Title').fill('Something else')

		await cancelLink(page).tap()
		const sheet = discardSheet(page)
		await expect(sheet).toBeVisible()
		await expect(
			sheet.getByRole('button', { name: 'Keep Editing' }),
		).toBeFocused()
		await sheet.getByRole('button', { name: 'Keep Editing' }).tap()
		await expect(sheet).toBeHidden()
		await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
		await expect(page.getByLabel('Title')).toHaveValue('Something else')

		await cancelLink(page).tap()
		await sheet.getByRole('button', { name: 'Discard Changes' }).tap()
		await expect(page).toHaveURL(`/recipes/${recipe.id}`)
		// Back to the Recipe's own entry, as Cancel went before, sliding back
		// as the nav bar's Back does.
		expect(await historyIdx(page)).toBe(recipeIdx)
		await expect
			.poll(() =>
				page.evaluate(() => document.documentElement.dataset.navDirection),
			)
			.toBe('back')
		await expect(
			page.getByRole('heading', { level: 1, name: 'Lentil soup' }),
		).toBeVisible()
		expect(await recipeTitle(recipe.id)).toBe('Lentil soup')
	})

	test('going back in history with changes asks; Keep Editing stays on the same entry', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		const { recipeIdx } = await openRecipeFromList(page, recipe.title)
		await openEdit(page, recipe.id)
		const editIdx = await historyIdx(page)
		// A new ingredient row: a change only the hidden inputs carry.
		await page.getByRole('button', { name: 'Ingredient', exact: true }).tap()
		await page.getByLabel('Ingredient 11 name').fill('bay leaf')

		await page.evaluate(() => window.history.back())
		const sheet = discardSheet(page)
		await expect(sheet).toBeVisible()
		await sheet.getByRole('button', { name: 'Keep Editing' }).tap()
		await expect(sheet).toBeHidden()
		await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
		await expect.poll(() => historyIdx(page)).toBe(editIdx)
		await expect(page.getByLabel('Ingredient 11 name')).toHaveValue('bay leaf')

		// The nav bar still knows where Cancel goes after the held pop.
		await cancelLink(page).tap()
		await expect(sheet).toBeVisible()
		await sheet.getByRole('button', { name: 'Discard Changes' }).tap()
		await expect(page).toHaveURL(`/recipes/${recipe.id}`)
		expect(await historyIdx(page)).toBe(recipeIdx)
		expect(
			await prisma.ingredient.count({
				where: { recipeId: recipe.id, name: 'bay leaf' },
			}),
		).toBe(0)
	})

	test('history back with changes, then Discard Changes, goes back', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		const { recipeIdx } = await openRecipeFromList(page, recipe.title)
		await openEdit(page, recipe.id)
		await page.getByLabel('Title').fill('Something else')
		// A Cancel held and kept leaves nothing behind for the next way out.
		await cancelLink(page).tap()
		await discardSheet(page).getByRole('button', { name: 'Keep Editing' }).tap()
		await expect(discardSheet(page)).toBeHidden()
		await page.evaluate(() => window.history.back())
		await discardSheet(page)
			.getByRole('button', { name: 'Discard Changes' })
			.tap()
		await expect(page).toHaveURL(`/recipes/${recipe.id}`)
		expect(await historyIdx(page)).toBe(recipeIdx)
		// A plain history back from a page opened without a slide: no slide,
		// as before the edit screen asked.
		await expect(
			page.getByRole('heading', { level: 1, name: 'Lentil soup' }),
		).toBeVisible()
		expect(
			await page.evaluate(() => document.documentElement.dataset.navDirection),
		).toBeUndefined()
		expect(await recipeTitle(recipe.id)).toBe('Lentil soup')
	})

	test('a link with changes asks too', async ({ page, login }) => {
		const user = await login()
		const recipe = await createRecipe(user)
		// The desktop header keeps its links on pushed pages.
		await page.setViewportSize({ width: 1280, height: 800 })
		await page.goto(`/recipes/${recipe.id}/edit`)
		await hydrated(saveButton(page))
		await page.getByLabel('Title').fill('Something else')
		const planLink = page
			.getByRole('banner')
			.getByRole('link', { name: 'Plan', exact: true })
		await planLink.click()
		const sheet = discardSheet(page)
		await expect(sheet).toBeVisible()
		await sheet.getByRole('button', { name: 'Keep Editing' }).click()
		await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
		await expect(page.getByLabel('Title')).toHaveValue('Something else')
		await planLink.click()
		await sheet.getByRole('button', { name: 'Discard Changes' }).click()
		await expect(page).toHaveURL(/\/plan/)
		expect(await recipeTitle(recipe.id)).toBe('Lentil soup')
	})

	test('a form nobody changed leaves without asking, by Cancel or by history back', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		const menu = await createMenu(user)
		await openRecipeFromList(page, recipe.title)
		await openEdit(page, recipe.id)
		// Opening and closing a section changes nothing.
		await page.locator('summary', { hasText: 'Details' }).tap()
		await cancelLink(page).tap()
		await expect(page).toHaveURL(`/recipes/${recipe.id}`)
		await expect(discardSheet(page)).toHaveCount(0)

		await openEdit(page, recipe.id)
		await page.evaluate(() => window.history.back())
		await expect(page).toHaveURL(`/recipes/${recipe.id}`)
		await expect(discardSheet(page)).toHaveCount(0)

		for (const path of ['/recipes/new', `/recipes/menus/${menu.id}/edit`]) {
			await page.goto(path)
			await hydrated(cancelLink(page))
			await cancelLink(page).tap()
			await expect(page).not.toHaveURL(path)
			await expect(discardSheet(page)).toHaveCount(0)
		}
	})

	test('a Menu with changes asks before Cancel too', async ({
		page,
		login,
	}) => {
		const user = await login()
		const menu = await createMenu(user)
		await page.goto(`/recipes/menus/${menu.id}/edit`)
		await hydrated(saveButton(page))
		await page.getByLabel('Description').fill('Long lunch outside')
		await cancelLink(page).tap()
		const sheet = discardSheet(page)
		await expect(sheet).toBeVisible()
		await sheet.getByRole('button', { name: 'Discard Changes' }).tap()
		await expect(page).toHaveURL(`/recipes/menus/${menu.id}`)
		const kept = await prisma.menu.findUniqueOrThrow({
			where: { id: menu.id },
			select: { description: true },
		})
		expect(kept.description).toBeNull()
	})
})

test.describe('history after Save and Delete', () => {
	test('Save from a Recipe returns to its entry: history back then goes where the nav bar Back goes', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		const { listIdx, recipeIdx } = await openRecipeFromList(page, recipe.title)
		await openEdit(page, recipe.id)
		await page.getByLabel('Title').fill('Red lentil soup')
		const loads = editScreenLoads(page)
		await saveButton(page).tap()

		await expect(page).toHaveURL(`/recipes/${recipe.id}`)
		await expect(
			page.getByRole('heading', { level: 1, name: 'Red lentil soup' }),
		).toBeVisible()
		// A changed form saved without asking.
		await expect(discardSheet(page)).toHaveCount(0)
		expect(await historyIdx(page)).toBe(recipeIdx)
		expect(await recipeTitle(recipe.id)).toBe('Red lentil soup')
		// The form it is leaving does not load again first.
		expect(loads).toEqual([])

		await page.goBack()
		await expect(page).toHaveURL('/recipes')
		expect(await historyIdx(page)).toBe(listIdx)
		await expect(page.getByText('Red lentil soup')).toBeVisible()
	})

	test('Save on a deep-linked edit screen opens the Recipe in its place', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		await page.goto(`/recipes/${recipe.id}/edit`)
		await hydrated(saveButton(page))
		const lengthBefore = await page.evaluate(() => window.history.length)
		await page.getByLabel('Title').fill('Red lentil soup')
		await saveButton(page).tap()
		await expect(page).toHaveURL(`/recipes/${recipe.id}`)
		await expect(
			page.getByRole('heading', { level: 1, name: 'Red lentil soup' }),
		).toBeVisible()
		expect(await page.evaluate(() => window.history.length)).toBe(lengthBefore)
	})

	test('a new Recipe takes the place of its form: history back goes to the page before New', async ({
		page,
		login,
	}) => {
		const user = await login()
		await page.goto('/recipes')
		const write = page.getByRole('link', { name: 'Write a Recipe' })
		await hydrated(write)
		const listIdx = await historyIdx(page)
		await write.tap()
		await expect(page).toHaveURL('/recipes/new')
		await hydrated(saveButton(page))
		const formIdx = await historyIdx(page)
		await page.getByLabel('Title').fill('Pea soup')
		await page.getByLabel('Ingredient 1 name').fill('split peas')
		await page.getByLabel('Step 1', { exact: true }).fill('Simmer.')
		await saveButton(page).tap()
		await expect(page).toHaveURL(/\/recipes\/[^/]+$/)
		await expect(
			page.getByRole('heading', { level: 1, name: 'Pea soup' }),
		).toBeVisible()
		expect(await historyIdx(page)).toBe(formIdx)
		expect(
			await prisma.recipe.count({ where: { householdId: user.householdId } }),
		).toBe(1)

		await page.goBack()
		await expect(page).toHaveURL('/recipes')
		expect(await historyIdx(page)).toBe(listIdx)
	})

	test('a new Menu takes the place of its form: history back goes to Menus', async ({
		page,
		login,
	}) => {
		const user = await login()
		await page.goto('/recipes/menus')
		const newMenu = page.getByRole('link', { name: 'New Menu' }).first()
		await hydrated(newMenu)
		const listIdx = await historyIdx(page)
		await newMenu.tap()
		await expect(page).toHaveURL('/recipes/menus/new')
		await hydrated(saveButton(page))
		const formIdx = await historyIdx(page)
		await page.getByLabel('Title').fill('Long lunch')
		await saveButton(page).tap()
		await expect(
			page.getByRole('heading', { level: 1, name: 'Long lunch' }),
		).toBeVisible()
		expect(await historyIdx(page)).toBe(formIdx)
		expect(
			await prisma.menu.count({ where: { householdId: user.householdId } }),
		).toBe(1)

		await page.goBack()
		await expect(page).toHaveURL('/recipes/menus')
		expect(await historyIdx(page)).toBe(listIdx)
	})

	test('Save on an edited Menu returns to its entry: history back goes to Menus', async ({
		page,
		login,
	}) => {
		const user = await login()
		const menu = await createMenu(user)
		await page.goto('/recipes/menus')
		const card = page.getByRole('link', { name: /Terrace dinner/ }).first()
		await hydrated(card)
		const listIdx = await historyIdx(page)
		await card.tap()
		await expect(page).toHaveURL(`/recipes/menus/${menu.id}`)
		const menuIdx = await historyIdx(page)
		const edit = page.getByRole('link', { name: 'Edit', exact: true })
		await hydrated(edit)
		await edit.tap()
		await expect(page).toHaveURL(`/recipes/menus/${menu.id}/edit`)
		await hydrated(saveButton(page))
		await page.getByLabel('Title').fill('Longer lunch')
		await saveButton(page).tap()
		await expect(
			page.getByRole('heading', { level: 1, name: 'Longer lunch' }),
		).toBeVisible()
		expect(await historyIdx(page)).toBe(menuIdx)
		const saved = await prisma.menu.findUniqueOrThrow({
			where: { id: menu.id },
			select: { title: true },
		})
		expect(saved.title).toBe('Longer lunch')

		await page.goBack()
		await expect(page).toHaveURL('/recipes/menus')
		expect(await historyIdx(page)).toBe(listIdx)
	})

	test('Delete returns to the list over the Recipe: history back shows no page for it', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		await page.goto('/plan')
		const recipesTab = page
			.getByRole('navigation', { name: 'Main' })
			.getByRole('link', { name: 'Recipes', exact: true })
		await hydrated(recipesTab)
		await recipesTab.tap()
		await expect(page).toHaveURL('/recipes')
		const card = page.getByRole('link', { name: `${recipe.title} recipe` })
		await hydrated(card)
		const listIdx = await historyIdx(page)
		await card.tap()
		await openEdit(page, recipe.id)
		await page.getByLabel('Title').fill('Changed before deleting')
		const loads = editScreenLoads(page)

		await page.getByRole('button', { name: 'Delete Recipe' }).tap()
		await page
			.getByRole('dialog', { name: 'Delete this Recipe?' })
			.getByRole('button', { name: 'Delete Recipe' })
			.tap()
		await expect(page).toHaveURL('/recipes')
		await expect(discardSheet(page)).toHaveCount(0)
		expect(await historyIdx(page)).toBe(listIdx)
		expect(await prisma.recipe.count({ where: { id: recipe.id } })).toBe(0)
		// Nothing loads the gone Recipe's edit screen, whose error could show.
		expect(loads).toEqual([])

		await page.goBack()
		await expect(page).toHaveURL('/plan')
		await expect(page.getByText('Recipe not found')).toHaveCount(0)
	})

	test('Delete of a Recipe opened cold puts the list in its place: history back shows no page for it', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		await page.goto('/plan')
		// A new document, as a link from outside the app opens it.
		await page.goto(`/recipes/${recipe.id}`)
		await openEdit(page, recipe.id)
		await page.getByRole('button', { name: 'Delete Recipe' }).tap()
		await page
			.getByRole('dialog', { name: 'Delete this Recipe?' })
			.getByRole('button', { name: 'Delete Recipe' })
			.tap()
		await expect(page).toHaveURL('/recipes')
		await expect(
			page.getByRole('heading', { name: /^My Recipes/ }),
		).toBeVisible()
		expect(await historyIdx(page)).toBe(0)

		await page.goBack()
		await expect(page).toHaveURL('/plan')
		await expect(page.getByText('Recipe not found')).toHaveCount(0)
	})

	test('Delete of a Menu returns to Menus over the Menu', async ({
		page,
		login,
	}) => {
		const user = await login()
		const menu = await createMenu(user)
		await page.goto('/recipes/menus')
		const card = page.getByRole('link', { name: /Terrace dinner/ }).first()
		await hydrated(card)
		const listIdx = await historyIdx(page)
		await card.tap()
		await expect(page).toHaveURL(`/recipes/menus/${menu.id}`)
		const edit = page.getByRole('link', { name: 'Edit', exact: true })
		await hydrated(edit)
		await edit.tap()
		await hydrated(saveButton(page))
		await page.getByRole('button', { name: 'Delete Menu' }).tap()
		await page
			.getByRole('dialog', { name: 'Delete this Menu?' })
			.getByRole('button', { name: 'Delete Menu' })
			.tap()
		await expect(page).toHaveURL('/recipes/menus')
		expect(await historyIdx(page)).toBe(listIdx)
		expect(await prisma.menu.count({ where: { id: menu.id } })).toBe(0)
	})
})

const mainTab = (page: Page, name: string) =>
	page
		.getByRole('navigation', { name: 'Main' })
		.getByRole('link', { name, exact: true })
const backTo = (page: Page, label: string) =>
	page.getByRole('link', { name: `Back to ${label}`, exact: true })

async function deleteRecipeFromEdit(page: Page) {
	await page.getByRole('button', { name: 'Delete Recipe' }).tap()
	await page
		.getByRole('dialog', { name: 'Delete this Recipe?' })
		.getByRole('button', { name: 'Delete Recipe' })
		.tap()
}

/**
 * Records, across documents, whether a not-found page ever reached the DOM:
 * one painted for a frame counts.
 */
async function watchNotFound(page: Page) {
	await page.addInitScript(() => {
		const check = () => {
			if (/(Recipe|Menu) not found/.test(document.body?.textContent ?? '')) {
				sessionStorage.setItem('sawNotFound', '1')
			}
		}
		new MutationObserver(check).observe(document, {
			childList: true,
			subtree: true,
			characterData: true,
		})
	})
}
const sawNotFound = (page: Page) =>
	page.evaluate(() => sessionStorage.getItem('sawNotFound') === '1')

test.describe('a deleted Recipe left in the history', () => {
	test('going back to it after a trip through another tab opens Recipes, never its not-found page', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		await watchNotFound(page)
		await openRecipeFromList(page, recipe.title)
		// To the Plan and back with the tab bar, which restores the Recipe.
		await mainTab(page, 'Plan').tap()
		await expect(page).toHaveURL('/plan')
		await mainTab(page, 'Recipes').tap()
		await expect(page).toHaveURL(`/recipes/${recipe.id}`)
		await openEdit(page, recipe.id)
		await deleteRecipeFromEdit(page)
		await expect(page).toHaveURL('/recipes')

		await page.goBack()
		await expect(page).toHaveURL('/plan')
		// The Recipe's first entry, behind the Plan.
		await page.goBack()
		await expect(page).toHaveURL('/recipes')
		await expect(
			page.getByRole('heading', { name: /^My Recipes/ }),
		).toBeVisible()
		expect(await sawNotFound(page)).toBe(false)
	})

	test('going back to it from before a reload opens Recipes, never its not-found page', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		await watchNotFound(page)
		await openRecipeFromList(page, recipe.title)
		await openEdit(page, recipe.id)
		// As when iOS restarts the app's web view in the background.
		await page.reload()
		await hydrated(saveButton(page))
		await deleteRecipeFromEdit(page)
		await expect(page).toHaveURL('/recipes')

		// The Recipe's entry belongs to the document before the reload.
		await page.goBack()
		await expect(page).toHaveURL('/recipes')
		await expect(
			page.getByRole('heading', { name: /^My Recipes/ }),
		).toBeVisible()
		expect(await sawNotFound(page)).toBe(false)
	})

	test('a link or a deep link to a missing Recipe still says it is not found', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		await page.goto('/recipes/no-such-recipe')
		await expect(page.getByText('Recipe not found')).toBeVisible()
		await expect(page).toHaveURL('/recipes/no-such-recipe')

		// Deleted by another member after the list loaded.
		await page.goto('/recipes')
		const card = page.getByRole('link', { name: `${recipe.title} recipe` })
		await hydrated(card)
		await prisma.recipe.delete({ where: { id: recipe.id } })
		await card.tap()
		await expect(page.getByText('Recipe not found')).toBeVisible()
		await expect(page).toHaveURL(`/recipes/${recipe.id}`)
	})
})

test.describe('more ways out of an edit screen', () => {
	test('a reload or closing the page with changes asks the browser first; without changes it does not', async ({
		page,
		context,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		await page.goto(`/recipes/${recipe.id}/edit`)
		await hydrated(saveButton(page))
		await page.getByLabel('Title').tap()
		await page.getByLabel('Title').fill('Something else')
		const dialog = page.waitForEvent('dialog')
		await page.close({ runBeforeUnload: true })
		expect((await dialog).type()).toBe('beforeunload')
		await (await dialog).dismiss()
		expect(page.isClosed()).toBe(false)

		const pristine = await context.newPage()
		await pristine.goto(`/recipes/${recipe.id}/edit`)
		await hydrated(saveButton(pristine))
		await pristine.getByLabel('Title').tap()
		const dialogs: string[] = []
		pristine.on('dialog', (d) => {
			dialogs.push(d.type())
			void d.dismiss()
		})
		const closed = pristine.waitForEvent('close')
		await pristine.close({ runBeforeUnload: true })
		await closed
		expect(dialogs).toEqual([])
	})

	test('an edit form the tab bar restored goes back down its own stack after Save or Cancel', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		for (const leave of ['Save', 'Cancel'] as const) {
			await page.setViewportSize({ width: 390, height: 844 })
			const { listIdx } = await openRecipeFromList(page, recipe.title)
			await openEdit(page, recipe.id)
			// The edit screen has no tab bar: off to the Plan by the desktop
			// header, then back on a phone with the tab bar, which restores
			// the edit form.
			await page.setViewportSize({ width: 1280, height: 800 })
			await page
				.getByRole('banner')
				.getByRole('link', { name: 'Plan', exact: true })
				.click()
			await expect(page).toHaveURL('/plan')
			await page.setViewportSize({ width: 390, height: 844 })
			await mainTab(page, 'Recipes').tap()
			await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
			await hydrated(saveButton(page))

			if (leave === 'Save') await saveButton(page).tap()
			else await cancelLink(page).tap()
			await expect(page).toHaveURL(`/recipes/${recipe.id}`)
			await expect(backTo(page, 'Recipes'), leave).toBeVisible()
			await backTo(page, 'Recipes').tap()
			await expect(page).toHaveURL('/recipes')
			expect(await historyIdx(page), leave).toBe(listIdx)
		}
	})

	test('Save or Cancel on a restored edit form opened cold hands the restore on to the Recipe', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		for (const leave of ['Save', 'Cancel'] as const) {
			await page.setViewportSize({ width: 1280, height: 800 })
			// Straight to the edit form, so nothing is behind it to pop to.
			await page.goto(`/recipes/${recipe.id}/edit`)
			const plan = page
				.getByRole('banner')
				.getByRole('link', { name: 'Plan', exact: true })
			await hydrated(plan)
			await plan.click()
			await expect(page).toHaveURL('/plan')
			await page.setViewportSize({ width: 390, height: 844 })
			await mainTab(page, 'Recipes').tap()
			await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
			await hydrated(saveButton(page))

			if (leave === 'Save') await saveButton(page).tap()
			else await cancelLink(page).tap()
			await expect(page).toHaveURL(`/recipes/${recipe.id}`)
			// The Recipe stays in the Recipes tab's stack: not back to the Plan.
			await expect(backTo(page, 'Recipes'), leave).toBeVisible()
			await backTo(page, 'Recipes').tap()
			await expect(page).toHaveURL('/recipes')
		}
	})

	test('while Delete is on its way, the bar holds Cancel and Save', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		let release = () => {}
		const held = new Promise<void>((resolve) => (release = resolve))
		await page.route(/\/edit\.data/, async (route) => {
			if (route.request().method() === 'POST') await held
			await route.continue()
		})
		await page.goto(`/recipes/${recipe.id}/edit`)
		await hydrated(saveButton(page))
		await deleteRecipeFromEdit(page)

		await expect(saveButton(page)).toBeDisabled()
		await expect(cancelLink(page)).toHaveAttribute('aria-disabled', 'true')
		// The sheet's scrim covers the bar on a phone; a click that reaches
		// Cancel anyway (a keyboard, a desktop pointer) does nothing.
		await cancelLink(page).dispatchEvent('click')
		await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)

		release()
		await expect(page).toHaveURL('/recipes')
		expect(await prisma.recipe.count({ where: { id: recipe.id } })).toBe(0)
	})

	test('a Delete that finds the Recipe already gone shows its error page with the tab bar', async ({
		page,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		await page.goto(`/recipes/${recipe.id}/edit`)
		await hydrated(saveButton(page))
		await expect(tabBar(page)).toHaveCount(0)
		// Another member deletes it first.
		await prisma.recipe.delete({ where: { id: recipe.id } })
		await deleteRecipeFromEdit(page)
		await expect(page.getByText('Recipe not found')).toBeVisible()
		await expect(tabBar(page)).toBeVisible()
	})
})

test.describe('a Save that cannot go through keeps the form', () => {
	test('a linked sub-Recipe another member deleted shows at its row; the edits stay', async ({
		page,
		login,
	}) => {
		const user = await login()
		const stock = await prisma.recipe.create({
			data: {
				title: 'Chicken stock',
				userId: user.id,
				householdId: user.householdId,
			},
			select: { id: true },
		})
		const soup = await prisma.recipe.create({
			data: {
				title: 'Chicken soup',
				userId: user.id,
				householdId: user.householdId,
				ingredients: {
					create: [
						{ name: 'stock', order: 0, linkedRecipeId: stock.id },
						{ name: 'carrots', order: 1 },
					],
				},
				instructions: { create: [{ content: 'Simmer.', order: 0 }] },
			},
			select: { id: true },
		})
		await page.goto(`/recipes/${soup.id}/edit`)
		await hydrated(saveButton(page))
		await page.getByLabel('Title').fill('Chicken noodle soup')
		await prisma.recipe.delete({ where: { id: stock.id } })
		await saveButton(page).tap()

		const message = page.getByText(
			'This linked Recipe was deleted. Remove the link to save.',
			{ exact: true },
		)
		await expect(message).toBeVisible()
		const target = page.locator('[data-error-target]', { has: message })
		await expect(target).toBeFocused()
		await expectInViewBelowBar(page, target)
		await expect(page).toHaveURL(`/recipes/${soup.id}/edit`)
		await expect(page.getByLabel('Title')).toHaveValue('Chicken noodle soup')
		expect(await recipeTitle(soup.id)).toBe('Chicken soup')

		await page.getByRole('button', { name: 'Remove recipe link' }).tap()
		await expect(message).toBeHidden()
		await saveButton(page).tap()
		await expect(page).toHaveURL(`/recipes/${soup.id}`)
		expect(await recipeTitle(soup.id)).toBe('Chicken noodle soup')
	})

	test('Save while offline keeps the form and its edits and says nothing was saved', async ({
		page,
		context,
		login,
	}) => {
		const user = await login()
		const recipe = await createRecipe(user)
		await page.goto(`/recipes/${recipe.id}/edit`)
		await hydrated(saveButton(page))
		await page.getByLabel('Title').fill('Red lentil soup')
		await context.setOffline(true)
		await saveButton(page).tap()

		const message = page.getByText(
			'You’re offline, so nothing was saved. Your changes are still here.',
		)
		await expect(message).toBeVisible()
		await expect(
			page.locator('[data-error-target]', { has: message }),
		).toBeFocused()
		await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
		await expect(page.getByLabel('Title')).toHaveValue('Red lentil soup')
		await expect(page.getByText(/hasn’t been loaded/)).toHaveCount(0)
		expect(await recipeTitle(recipe.id)).toBe('Lentil soup')

		await context.setOffline(false)
		await saveButton(page).tap()
		await expect(page).toHaveURL(`/recipes/${recipe.id}`)
		expect(await recipeTitle(recipe.id)).toBe('Red lentil soup')
	})
})
