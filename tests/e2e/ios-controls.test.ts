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
	const addMeal = page.getByRole('button', { name: /^Add Meal to/ }).first()
	await expectThumbTall(addMeal)
	const label = page
		.getByRole('dialog', { name: 'Add a Meal' })
		.getByRole('group', { name: 'Label (optional)' })
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
	await page.getByRole('menuitem', { name: 'Edit', exact: true }).tap()
	await expectThumbTall(
		page
			.getByRole('dialog', { name: 'Edit item' })
			.getByRole('button', { name: 'Save' }),
	)
})

/**
 * Records, from every frame, whether an element matching `selector` ran a CSS
 * transition, into `window[flag]`. Installed before each page load, so it
 * also sees a transition that plays while a page hydrates.
 */
async function recordTransitions(page: Page, selector: string, flag: string) {
	await page.addInitScript(
		({ selector, flag }) => {
			const record = window as unknown as Record<string, boolean>
			record[flag] = false
			const tick = () => {
				for (const element of document.querySelectorAll(selector)) {
					if (
						element
							.getAnimations()
							.some((animation) => animation instanceof CSSTransition)
					) {
						record[flag] = true
					}
				}
				requestAnimationFrame(tick)
			}
			requestAnimationFrame(tick)
		},
		{ selector, flag },
	)
	return {
		reset: () =>
			page.evaluate((flag) => {
				;(window as unknown as Record<string, boolean>)[flag] = false
			}, flag),
		seen: () =>
			page.evaluate(
				(flag) => (window as unknown as Record<string, boolean>)[flag],
				flag,
			),
	}
}

/** Waits until React has hydrated the element `selector` matches. */
async function waitForHydration(page: Page, selector: string) {
	await page.waitForFunction((selector) => {
		const element = document.querySelector(selector)
		return element
			? Object.keys(element).some((key) => key.startsWith('__reactFiber'))
			: false
	}, selector)
}

/** Waits long enough for a 150–200ms transition to have started and ended. */
async function pastAnyTransition(page: Page) {
	await page.waitForTimeout(400)
}

test('Keep screen awake is a switch that holds its setting', async ({
	page,
	login,
}) => {
	await login()
	const thumbSlid = await recordTransitions(
		page,
		'[data-slot="switch-thumb"]',
		'thumbSlid',
	)
	await page.goto('/settings/profile')
	const keepAwake = page.getByRole('switch', {
		name: 'Keep screen awake while a recipe is open',
	})
	const track = keepAwake.locator('[data-slot="switch-track"]')
	const thumb = keepAwake.locator('[data-slot="switch-thumb"]')
	// How far the thumb sits from the track's left edge.
	const thumbOffset = async () => {
		const [t, k] = await Promise.all([track.boundingBox(), thumb.boundingBox()])
		return Math.round(k!.x - t!.x)
	}
	const trackColor = () =>
		track.evaluate((element) => getComputedStyle(element).backgroundColor)

	// Read from the device after hydration; disabled until then.
	await expect(keepAwake).toBeEnabled()
	await expect(keepAwake).toHaveAttribute('aria-checked', 'true')
	await expectThumbSized(keepAwake)
	await expect(keepAwake).toHaveText('')
	const trackBox = (await track.boundingBox())!
	expect([Math.round(trackBox.width), Math.round(trackBox.height)]).toEqual([
		51, 31,
	])
	expect(await thumbOffset()).toBe(22)
	const onColor = await trackColor()

	await keepAwake.tap()
	await expect(keepAwake).toHaveAttribute('aria-checked', 'false')
	expect(await page.evaluate(() => localStorage.getItem('qm-keep-awake'))).toBe(
		'false',
	)
	// The thumb slides left and the track gives up its sage.
	await expect.poll(thumbOffset).toBe(2)
	await expect.poll(trackColor).not.toBe(onColor)
	expect(await thumbSlid.seen()).toBe(true)

	// A page that opens on Off shows it without playing the slide.
	await page.reload()
	await expect(keepAwake).toBeEnabled()
	await expect(keepAwake).toHaveAttribute('aria-checked', 'false')
	await pastAnyTransition(page)
	expect(await thumbOffset()).toBe(2)
	expect(await thumbSlid.seen()).toBe(false)

	await keepAwake.tap()
	await expect(keepAwake).toHaveAttribute('aria-checked', 'true')
	expect(await page.evaluate(() => localStorage.getItem('qm-keep-awake'))).toBe(
		'true',
	)
	await expect.poll(thumbOffset).toBe(22)
	await expect.poll(trackColor).toBe(onColor)

	await expectThumbTall(page.getByRole('button', { name: 'Delete my account' }))
})

async function importTab(page: Page, name: string) {
	return page
		.getByRole('tablist', { name: 'Import from' })
		.getByRole('tab', { name, exact: true })
}

/** Whether the sage pill now sits under `tab`. */
async function pillUnder(pill: Locator, tab: Locator) {
	const [p, t] = await Promise.all([pill.boundingBox(), tab.boundingBox()])
	const center = p!.x + p!.width / 2
	return center > t!.x && center < t!.x + t!.width
}

test('Import switches between URL and pasted text with a segmented control', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/recipes/import')
	const tablist = page.getByRole('tablist', { name: 'Import from' })
	const pill = tablist.locator('[data-slot="segmented-pill"]')
	const fromUrl = await importTab(page, 'From URL')
	const fromText = await importTab(page, 'From Text')
	const fromImage = await importTab(page, 'From Image')
	await expect(fromUrl).toHaveAttribute('aria-selected', 'true')
	await expect(fromText).toHaveAttribute('aria-selected', 'false')
	await expectThumbTall(fromText)
	expect(await pillUnder(pill, fromUrl)).toBe(true)
	await expect(page.getByRole('tabpanel', { name: 'From URL' })).toContainText(
		'Recipe URL',
	)

	await tapUntil(fromText, () =>
		expect(page.getByLabel('Recipe text')).toBeVisible({ timeout: 2000 }),
	)
	await expect(fromText).toHaveAttribute('aria-selected', 'true')
	await expect(fromUrl).toHaveAttribute('aria-selected', 'false')
	await expect(page.getByLabel('Recipe URL')).toHaveCount(0)
	await expect(page.getByRole('tabpanel', { name: 'From Text' })).toContainText(
		'Recipe text',
	)
	await expect.poll(() => pillUnder(pill, fromText)).toBe(true)

	await fromUrl.tap()
	await expect(page.getByLabel('Recipe URL')).toBeVisible()
	await expect(fromUrl).toHaveAttribute('aria-selected', 'true')
	await expect.poll(() => pillUnder(pill, fromUrl)).toBe(true)

	// From the keyboard: Left/Right and Home/End move a row of tabs; Up/Down
	// leave it alone.
	await fromUrl.focus()
	await page.keyboard.press('ArrowRight')
	await expect(fromText).toHaveAttribute('aria-selected', 'true')
	await expect(fromText).toBeFocused()
	await expect(page.getByLabel('Recipe text')).toBeVisible()
	await page.keyboard.press('ArrowDown')
	await expect(fromText).toHaveAttribute('aria-selected', 'true')
	await page.keyboard.press('End')
	await expect(fromImage).toHaveAttribute('aria-selected', 'true')
	await expect(fromImage).toBeFocused()
	await page.keyboard.press('Home')
	await expect(fromUrl).toHaveAttribute('aria-selected', 'true')
	await expect.poll(() => pillUnder(pill, fromUrl)).toBe(true)
})

test('Recipes and Menus switch with a thumb-sized segmented control', async ({
	page,
	login,
}) => {
	await login()
	const pillSlid = await recordTransitions(
		page,
		'[data-slot="segmented-pill"]',
		'pillSlid',
	)
	await page.goto('/recipes')
	const library = page.getByRole('navigation', { name: 'Library' })
	const recipes = library.getByRole('link', { name: 'Recipes', exact: true })
	const menus = library.getByRole('link', { name: 'Menus', exact: true })
	await expect(recipes).toHaveAttribute('aria-current', 'page')
	await expectThumbTall(menus)

	// A tap before hydration is a plain page load, which has nothing to slide.
	await waitForHydration(page, 'nav[aria-label="Library"] a')
	// Each list draws its own switch; the arriving one slides its pill over
	// from the link just left rather than appearing in place.
	await pillSlid.reset()
	await menus.tap()
	await expect(page).toHaveURL(/\/recipes\/menus$/)
	await expect.poll(pillSlid.seen).toBe(true)
	await expect(menus).toHaveAttribute('aria-current', 'page')
	await expect(recipes).not.toHaveAttribute('aria-current', 'page')

	await pillSlid.reset()
	await recipes.tap()
	await expect(page).toHaveURL(/\/recipes$/)
	await expect(recipes).toHaveAttribute('aria-current', 'page')
	await expect.poll(pillSlid.seen).toBe(true)

	// Back and Forward return to pages already arrived on: no slide.
	for (const [step, url] of [
		['back', /\/recipes\/menus$/],
		['forward', /\/recipes$/],
	] as const) {
		// Let the slide from the step before finish first.
		await pastAnyTransition(page)
		await pillSlid.reset()
		await (step === 'back' ? page.goBack() : page.goForward())
		await expect(page).toHaveURL(url)
		await pastAnyTransition(page)
		expect(await pillSlid.seen(), `no slide on ${step}`).toBe(false)
	}

	// A reload keeps the entry's state, but it is not a switch.
	await page.reload()
	await waitForHydration(page, 'nav[aria-label="Library"] a')
	await pastAnyTransition(page)
	expect(await pillSlid.seen(), 'no slide on reload').toBe(false)
	await expect(recipes).toHaveAttribute('aria-current', 'page')
	expect(
		await pillUnder(library.locator('[data-slot="segmented-pill"]'), recipes),
	).toBe(true)
})

test('From Plan turns the week with thumb-sized chevrons', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await createRecipe(user)
	const today = new Date()
	const todayUTC = new Date(
		Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
	)
	const thisWeek = getWeekStart(todayUTC)
	const nextWeek = new Date(thisWeek.getTime() + 7 * 24 * 60 * 60 * 1000)
	for (const weekStart of [thisWeek, nextWeek]) {
		await prisma.mealPlan.create({
			data: {
				householdId: user.householdId,
				weekStart,
				meals: {
					create: {
						date: weekStart,
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
	}

	await openShopping(page)
	const next = page.getByRole('button', { name: 'Next week' })
	await tapUntil(page.getByRole('button', { name: /^From Plan/ }), () =>
		expect(next).toBeVisible({ timeout: 2000 }),
	)
	const previous = page.getByRole('button', { name: 'Previous week' })
	// Measure once the sheet has finished sliding in: mid-slide its transform
	// leaves the chevrons a fraction of a pixel short of 44.
	const sheet = page.getByRole('dialog', { name: 'What are we buying for?' })
	await sheet.evaluate((element) =>
		Promise.all(element.getAnimations().map((a) => a.finished)),
	)
	for (const [control, icon] of [
		[previous, /#chevron-left$/],
		[next, /#chevron-right$/],
	] as const) {
		await expectThumbSized(control)
		await expect(control.locator('use')).toHaveAttribute('href', icon)
	}
	await expect(previous).toBeDisabled()
	// The sheet's primary action spans it, inside its 20px side padding.
	const add = sheet.getByRole('button', { name: /^Add / })
	await expect(add).toBeVisible()
	const sheetBox = (await sheet.boundingBox())!
	expect((await add.boundingBox())!.width).toBeCloseTo(sheetBox.width - 40, 0)
	await next.tap()
	await expect(next).toBeDisabled()
	await expect(previous).toBeEnabled()
})
