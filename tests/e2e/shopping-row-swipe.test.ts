import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

/**
 * Drags one finger across a locator's middle, from `fromX` to `toX` (as
 * fractions of its width), over `ms`. Chromium turns these touch events into
 * pointer events of type "touch".
 */
async function swipe(
	page: Page,
	target: Locator,
	{
		fromX,
		toX,
		ms,
		holdMs = 0,
		steps = 12,
	}: {
		fromX: number
		toX: number
		ms: number
		holdMs?: number
		steps?: number
	},
) {
	const box = (await target.boundingBox())!
	const y = box.y + box.height / 2
	const cdp = await page.context().newCDPSession(page)
	const point = (x: number) => [{ x: box.x + box.width * x, y, id: 1 }]
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: point(fromX),
	})
	for (let i = 1; i <= steps; i++) {
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: point(fromX + ((toX - fromX) * i) / steps),
		})
		await page.waitForTimeout(ms / steps)
	}
	if (holdMs) await page.waitForTimeout(holdMs)
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	})
	await cdp.detach()
}

/** Where the row's sliding layer rests (px), once any settle has run. */
async function restingX(row: Locator) {
	return row.evaluate(async (element) => {
		const layer = element.querySelector<HTMLElement>('.touch-pan-y')!
		await Promise.all(layer.getAnimations().map((a) => a.finished))
		return new DOMMatrix(getComputedStyle(layer).transform).m41
	})
}

async function openShopping(page: Page) {
	await page.goto('/shopping')
	await page.waitForFunction(() =>
		[
			...document.querySelectorAll<HTMLInputElement>(
				'input[name="originClientId"]',
			),
		].some((input) => input.value),
	)
}

const row = (page: Page, name: string) =>
	page.getByRole('group', { name: `${name} shopping item` })

async function seed(user: { id: string; householdId: string }) {
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: {
				create: ['eggs', 'lemons', 'oat milk'].map((name) => ({ name })),
			},
		},
	})
}

test('swiping a Shopping row left reveals Later and Delete; Delete removes it at once, with Undo', async ({
	page,
	login,
}) => {
	const user = await login()
	await seed(user)
	await openShopping(page)

	const eggs = row(page, 'eggs')
	const deleteButton = eggs.getByRole('button', { name: 'Delete' })
	await expect(deleteButton).toBeHidden()

	await swipe(page, eggs, { fromX: 0.8, toX: 0.2, ms: 240 })
	await expect(deleteButton).toBeVisible()
	await expect(eggs.getByRole('button', { name: 'Later' })).toBeVisible()
	// The row sits clear of both actions.
	await expect.poll(() => restingX(eggs)).toBe(-152)
	// The drag did not also check the item off.
	await expect(
		eggs.getByRole('button', { name: 'Check off eggs' }),
	).toBeVisible()

	// Opening another row shuts this one.
	const lemons = row(page, 'lemons')
	await swipe(page, lemons, { fromX: 0.8, toX: 0.2, ms: 240 })
	await expect(lemons.getByRole('button', { name: 'Delete' })).toBeVisible()
	await expect(deleteButton).toBeHidden()

	// Delete goes at once and offers Undo; it is saved once the toast goes.
	await lemons.getByRole('button', { name: 'Delete' }).click()
	await expect(lemons).toBeHidden()
	await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
	await expect
		.poll(
			() =>
				prisma.shoppingListItem.findMany({
					where: { list: { householdId: user.householdId } },
					select: { name: true, checked: true },
					orderBy: { name: 'asc' },
				}),
			{ timeout: 10_000 },
		)
		.toEqual([
			{ name: 'eggs', checked: false },
			{ name: 'oat milk', checked: false },
		])
})

test('a short, slow swipe snaps back, and a tap on an open row only shuts it', async ({
	page,
	login,
}) => {
	const user = await login()
	await seed(user)
	await openShopping(page)

	const oatMilk = row(page, 'oat milk')
	await swipe(page, oatMilk, { fromX: 0.8, toX: 0.7, ms: 600 })
	await expect(oatMilk.getByRole('button', { name: 'Delete' })).toBeHidden()
	await expect.poll(() => restingX(oatMilk)).toBe(0)
	// A quick short drag held still before lifting is not a flick.
	await swipe(page, oatMilk, {
		fromX: 0.8,
		toX: 0.63,
		ms: 0,
		steps: 3,
		holdMs: 400,
	})
	await expect(oatMilk.getByRole('button', { name: 'Delete' })).toBeHidden()
	await expect.poll(() => restingX(oatMilk)).toBe(0)

	await swipe(page, oatMilk, { fromX: 0.8, toX: 0.2, ms: 240 })
	await expect(oatMilk.getByRole('button', { name: 'Delete' })).toBeVisible()
	await oatMilk.getByText('oat milk', { exact: true }).click()
	await expect(oatMilk.getByRole('button', { name: 'Delete' })).toBeHidden()
	await expect(
		oatMilk.getByRole('button', { name: 'Check off oat milk' }),
	).toBeVisible()
	expect(
		await prisma.shoppingListItem.findFirst({
			where: { name: 'oat milk', list: { householdId: user.householdId } },
			select: { checked: true },
		}),
	).toEqual({ checked: false })
})

test('a swipe that starts on the row menu button leaves the menu shut', async ({
	page,
	login,
}) => {
	const user = await login()
	await seed(user)
	await openShopping(page)

	const eggs = row(page, 'eggs')
	await swipe(page, eggs, { fromX: 0.96, toX: 0.4, ms: 240 })
	await expect(eggs.getByRole('button', { name: 'Delete' })).toBeVisible()
	await expect(page.getByRole('menu')).toBeHidden()

	// A tap on the button still opens the menu.
	await eggs.getByText('eggs', { exact: true }).click()
	await expect(eggs.getByRole('button', { name: 'Delete' })).toBeHidden()
	await eggs.getByRole('button', { name: 'Item actions' }).tap()
	await expect(
		page.getByRole('menuitem', { name: 'Edit', exact: true }),
	).toBeVisible()
})
