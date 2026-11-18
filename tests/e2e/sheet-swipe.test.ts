import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, openShopping, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

/**
 * Drags one finger down (or up, with a negative `by`) from `fromY` of the
 * way down a locator, over `ms`. Chromium dispatches these as touch events.
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
	const box = (await target.boundingBox())!
	const x = box.x + box.width / 2
	const y = box.y + box.height * fromY
	const cdp = await page.context().newCDPSession(page)
	const point = (dy: number) => [{ x, y: y + dy, id: 1 }]
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: point(0),
	})
	for (let i = 1; i <= steps; i++) {
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: point((by * i) / steps),
		})
		await page.waitForTimeout(ms / steps)
	}
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	})
	await cdp.detach()
}

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
	return panel.evaluate(
		(element) => new DOMMatrix(getComputedStyle(element).transform).m42,
	)
}

test('pulling the Shopping add sheet down closes it; a short pull or a push up does not', async ({
	page,
	login,
}) => {
	const user = await login()
	await prisma.shoppingList.create({
		data: { userId: user.id, householdId: user.householdId },
	})
	await openShopping(page)

	const addItem = page.getByRole('button', { name: 'Add item' })
	await addItem.click()
	const sheet = page.getByRole('dialog', { name: 'Add to Shopping' })
	await slidIn(sheet)
	const height = (await sheet.boundingBox())!.height

	// A short, slow pull settles back.
	await pull(page, sheet, { fromY: 0.2, by: height * 0.15, ms: 600 })
	await expect(sheet).toBeVisible()
	expect(await restingOffset(sheet)).toBe(0)

	// So does a push up, which only stretches it a little.
	await pull(page, sheet, { fromY: 0.5, by: -120, ms: 300 })
	await expect(sheet).toBeVisible()
	expect(await restingOffset(sheet)).toBe(0)

	// A long pull closes it, and focus goes back to the button.
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
