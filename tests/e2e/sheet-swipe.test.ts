import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, openShopping, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

/**
 * Puts one finger down at `fromY` of the way down a locator. Chromium
 * dispatches these as touch events, the way a phone sends them.
 */
async function fingerDown(page: Page, target: Locator, fromY: number) {
	const box = (await target.boundingBox())!
	const x = box.x + box.width / 2
	const y = box.y + box.height * fromY
	const cdp = await page.context().newCDPSession(page)
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [{ x, y, id: 1 }],
	})
	return {
		/** Moves the finger to `dy` below where it went down. */
		move: (dy: number) =>
			cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [{ x, y: y + dy, id: 1 }],
			}),
		lift: async () => {
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchEnd',
				touchPoints: [],
			})
			await cdp.detach()
		},
	}
}

/**
 * Drags one finger down (or up, with a negative `by`) from `fromY` of the
 * way down a locator, over `ms`.
 */
async function pull(
	page: Page,
	target: Locator,
	{
		fromY,
		by,
		ms,
		steps = 12,
	}: { fromY: number; by: number; ms: number; steps?: number },
) {
	const finger = await fingerDown(page, target, fromY)
	for (let i = 1; i <= steps; i++) {
		await finger.move((by * i) / steps)
		await page.waitForTimeout(ms / steps)
	}
	await finger.lift()
}

/** The panel's offset from its open spot, as shown now (px). */
const shownOffset = (panel: Locator) =>
	panel.evaluate(
		(element) => new DOMMatrix(getComputedStyle(element).transform).m42,
	)

/** The backdrop's opacity as shown now. */
const shownShade = (page: Page) =>
	page
		.locator('[data-bottom-sheet-backdrop]')
		.evaluate((element) => Number(getComputedStyle(element).opacity))

/**
 * Waits for an opening sheet to finish sliding in: until then its box is
 * still moving, and a finger aimed at it lands somewhere else.
 */
async function slidIn(panel: Locator) {
	await expect(panel).toBeVisible()
	await panel.evaluate((element) =>
		Promise.all(element.getAnimations().map((a) => a.finished)),
	)
}

/**
 * Where the panel rests once any settle has run (px from its open spot). A
 * sheet that is closing fails here rather than being read mid-exit.
 */
async function restingOffset(panel: Locator) {
	await expect(panel).toHaveAttribute('data-state', 'open')
	await panel.evaluate((element) =>
		Promise.all(element.getAnimations().map((a) => a.finished)),
	)
	return shownOffset(panel)
}

/** Opens Shopping's Add sheet, slid in. */
async function openAddSheet(
	page: Page,
	user: { id: string; householdId: string },
) {
	await prisma.shoppingList.create({
		data: { userId: user.id, householdId: user.householdId },
	})
	await openShopping(page)
	const addItem = page.getByRole('button', { name: 'Add item' })
	await addItem.click()
	const sheet = page.getByRole('dialog', { name: 'Add to Shopping' })
	await slidIn(sheet)
	return { addItem, sheet, height: (await sheet.boundingBox())!.height }
}

test('pulling the Shopping add sheet down closes it; a short pull or a push up does not', async ({
	page,
	login,
}) => {
	const { addItem, sheet, height } = await openAddSheet(page, await login())

	// While the finger is down the sheet follows it and the backdrop fades
	// with it; let go short, both go back.
	const finger = await fingerDown(page, sheet, 0.2)
	for (const part of [0.05, 0.15, 0.3]) await finger.move(height * part)
	expect(await shownOffset(sheet)).toBeGreaterThan(height * 0.1)
	expect(await shownShade(page)).toBeLessThan(0.95)
	// Held still before it lifts, so it isn't a flick.
	await page.waitForTimeout(200)
	await finger.lift()
	await expect(sheet).toBeVisible()
	expect(await restingOffset(sheet)).toBe(0)
	await expect.poll(() => shownShade(page)).toBe(1)

	// A push up only stretches it a little, and it goes back.
	const push = await fingerDown(page, sheet, 0.5)
	for (const dy of [-20, -60, -120]) await push.move(dy)
	const stretched = await shownOffset(sheet)
	expect(stretched).toBeLessThan(-5)
	expect(stretched).toBeGreaterThan(-60)
	await page.waitForTimeout(200)
	await push.lift()
	expect(await restingOffset(sheet)).toBe(0)

	// A tap straight after a drag is a tap.
	await pull(page, sheet, { fromY: 0.2, by: height * 0.15, ms: 200 })
	await page.getByRole('button', { name: 'Close' }).tap()
	await expect(sheet).toBeHidden()

	// A long pull closes it, and focus goes back to the button.
	await addItem.click()
	await slidIn(sheet)
	await pull(page, sheet, { fromY: 0.2, by: height * 0.7, ms: 600 })
	await expect(sheet).toBeHidden()
	await expect(addItem).toBeFocused()

	// A quick flick down closes it from a distance too short to close it on its own:
	// the sheet follows only the second move, half the flick.
	await addItem.click()
	await slidIn(sheet)
	await pull(page, sheet, { fromY: 0.2, by: height * 0.5, ms: 0, steps: 2 })
	await expect(sheet).toBeHidden()
})

test('a pull that starts in a sideways scroller scrolls it, and a finger lifted off a removed node frees the sheet', async ({
	page,
	login,
}) => {
	const { sheet } = await openAddSheet(page, await login())
	// Stand-ins: a row of chips that scrolls sideways, and a node the page
	// takes away while a finger is on it.
	await sheet.evaluate((panel) => {
		const row = document.createElement('div')
		row.dataset.testid = 'chips'
		row.style.cssText = 'overflow-x:auto;height:60px;white-space:nowrap'
		row.textContent = 'chip '.repeat(200)
		const doomed = document.createElement('div')
		doomed.dataset.testid = 'doomed'
		doomed.style.cssText = 'height:60px'
		panel.append(row, doomed)
	})
	// Taller now, so a pull long enough to close it is longer too.
	const height = (await sheet.boundingBox())!.height

	await pull(page, sheet.getByTestId('chips'), {
		fromY: 0.5,
		by: height * 0.7,
		ms: 400,
	})
	await expect(sheet).toBeVisible()
	expect(await restingOffset(sheet)).toBe(0)

	const finger = await fingerDown(page, sheet.getByTestId('doomed'), 0.5)
	await finger.move(20)
	await finger.move(60)
	await sheet.getByTestId('doomed').evaluate((node) => node.remove())
	await finger.lift()
	await pull(page, sheet, { fromY: 0.2, by: height * 0.7, ms: 600 })
	await expect(sheet).toBeHidden()
})

test('under reduced motion the sheet and backdrop still follow the finger', async ({
	page,
	login,
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' })
	const { sheet, height } = await openAddSheet(page, await login())
	const finger = await fingerDown(page, sheet, 0.2)
	for (const part of [0.05, 0.15, 0.3]) await finger.move(height * part)
	expect(await shownOffset(sheet)).toBeGreaterThan(height * 0.1)
	// Read at once: a backdrop that trails the finger is still near 1 here.
	expect(await shownShade(page)).toBeLessThan(0.9)
	await page.waitForTimeout(200)
	await finger.lift()
	expect(await restingOffset(sheet)).toBe(0)
})

test('a pull down on a scrolled Ingredients list scrolls it instead of closing the sheet', async ({
	page,
	login,
}) => {
	const user = await login()
	const recipe = await prisma.recipe.create({
		data: {
			title: 'Long Recipe',
			userId: user.id,
			householdId: user.householdId,
			ingredients: {
				create: Array.from({ length: 30 }, (_, index) => ({
					name: `ingredient ${index + 1}`,
					amount: String(index + 1),
					unit: 'g',
					order: index,
				})),
			},
			instructions: {
				create: Array.from({ length: 12 }, (_, index) => ({
					content: `Complete cooking step ${index + 1}.`,
					order: index,
				})),
			},
		},
	})
	await page.goto(`/recipes/${recipe.id}`)
	await page
		.getByRole('heading', { name: 'Instructions' })
		.scrollIntoViewIfNeeded()
	await page.getByRole('button', { name: /^Ingredients · / }).click()
	const sheet = page.getByRole('dialog', { name: 'Ingredients' })
	await slidIn(sheet)
	const list = sheet.locator('.overflow-y-auto')
	await list.evaluate((element) => {
		element.scrollTop = 300
	})

	await pull(page, list, { fromY: 0.3, by: 200, ms: 400 })
	await expect(sheet).toBeVisible()
	expect(await restingOffset(sheet)).toBe(0)
	expect(await list.evaluate((element) => element.scrollTop)).toBeLessThan(300)

	// Back at the top, the same pull closes it.
	await list.evaluate((element) => {
		element.scrollTop = 0
	})
	await pull(page, list, { fromY: 0.3, by: 250, ms: 400 })
	await expect(sheet).toBeHidden()
})
