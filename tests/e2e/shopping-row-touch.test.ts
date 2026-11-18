import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { expect, test } from '#tests/playwright-utils.ts'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const ITEMS = [
	'canned tomatoes',
	'coriander',
	'eggs',
	'lemons',
	'oat milk',
	'ricotta',
	'salmon fillets',
	'spaghetti',
	'washing-up liquid',
	'yogurt',
]

async function seedList(user: { id: string; householdId: string }) {
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: {
				create: [
					...ITEMS.map((name) => ({ name })),
					{ name: 'bread', checked: true },
				],
			},
		},
	})
}

// Shopping fills its client id once it has hydrated.
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

async function expectThumbSized(control: Locator) {
	await expect(control).toBeVisible()
	const box = await control.boundingBox()
	expect(box).not.toBeNull()
	expect(box!.width).toBeGreaterThanOrEqual(44)
	expect(box!.height).toBeGreaterThanOrEqual(44)
}

test('a tap near the edge of a Shopping row checks the item off', async ({
	page,
	login,
}) => {
	const user = await login()
	await seedList(user)
	await openShopping(page)

	const oatMilk = row(page, 'oat milk')
	const box = await oatMilk.boundingBox()
	expect(box).not.toBeNull()
	// A one-line row keeps room around its name, not just a thumb's height.
	expect(box!.height).toBeGreaterThanOrEqual(60)
	// Two pixels inside the row's top edge, over the name rather than the box.
	await page.mouse.click(box!.x + box!.width / 2, box!.y + 2)

	await expect(
		oatMilk.getByRole('button', { name: 'Uncheck oat milk' }),
	).toBeVisible()
	await expect
		.poll(async () =>
			prisma.shoppingListItem.findFirst({
				where: { name: 'oat milk', list: { householdId: user.householdId } },
				select: { checked: true },
			}),
		)
		.toEqual({ checked: true })
})

test('a row menu near the bottom opens clear of the add button and tab bar', async ({
	page,
	login,
}) => {
	const user = await login()
	await seedList(user)
	await openShopping(page)

	// The row whose menu would open across the add button: the last row that
	// starts above the button's top edge.
	const addButton = page.getByRole('button', { name: 'Add item' })
	const fab = (await addButton.boundingBox())!
	let target = ''
	for (const name of ITEMS) {
		const box = await row(page, name).boundingBox()
		if (box && box.y + box.height <= fab.y) target = name
	}
	expect(target).not.toBe('')

	await row(page, target).getByRole('button', { name: 'Item actions' }).click()
	const deleteItem = page.getByRole('menuitem', { name: /^Delete/ })
	await expect(deleteItem).toBeVisible()
	// The whole menu sits above both, so nothing covers any of its items.
	// Measured once it has finished growing in.
	await page
		.getByRole('menu')
		.evaluate((element) =>
			Promise.all(element.getAnimations().map((a) => a.finished)),
		)
	const menu = (await page.getByRole('menu').boundingBox())!
	const tabBar = (await page.locator('[data-bottom-nav]').boundingBox())!
	expect(menu.y + menu.height).toBeLessThanOrEqual(fab.y)
	expect(menu.y + menu.height).toBeLessThanOrEqual(tabBar.y)
	// And its items are thumb-sized on a touch screen.
	expect((await deleteItem.boundingBox())!.height).toBeGreaterThanOrEqual(44)
	// Delete is red before it is armed, not only once it asks.
	const red = await page.evaluate(() => {
		const probe = document.createElement('span')
		probe.className = 'text-destructive'
		document.body.append(probe)
		const color = getComputedStyle(probe).color
		probe.remove()
		return color
	})
	await expect(deleteItem).toHaveText('Delete item')
	await expect(deleteItem).toHaveCSS('color', red)

	await deleteItem.click()
	await expect(row(page, target)).toBeHidden()
	// Saved once its Undo toast has gone.
	await expect
		.poll(
			() =>
				prisma.shoppingListItem.count({
					where: { name: target, list: { householdId: user.householdId } },
				}),
			{ timeout: 10_000 },
		)
		.toBe(0)
})

test('Shopping row and add-sheet controls are thumb-sized', async ({
	page,
	login,
}) => {
	const user = await login()
	await seedList(user)
	await openShopping(page)

	await expectThumbSized(
		row(page, 'eggs').getByRole('button', { name: 'Item actions' }),
	)
	await expectThumbSized(
		page.getByRole('button', { name: 'Clear checked items from Next shop' }),
	)

	await page.getByRole('button', { name: 'Add item' }).click()
	const sheet = page.getByRole('dialog', { name: 'Add to Shopping' })
	const qtyToggle = sheet.getByRole('button', { name: '+ Qty & unit' })
	await expectThumbSized(qtyToggle)
	await qtyToggle.click()
	await expectThumbSized(sheet.getByRole('button', { name: 'Hide' }))
})
