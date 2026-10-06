import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { SAFARI_UA, SHELL_UA } from '#tests/native-shell.ts'
import { expect, test } from '#tests/playwright-utils.ts'

// The iOS app registers `haptic`, `theme` and `refresh` message handlers on
// its web view. These stand-ins record what the page posts to them.
async function recordBridgeMessages(page: Page) {
	await page.addInitScript(() => {
		const messages: string[] = []
		const handler = (name: string) => ({
			postMessage: (message: string) => messages.push(`${name}:${message}`),
		})
		Object.assign(window, {
			__bridgeMessages: messages,
			webkit: {
				messageHandlers: {
					haptic: handler('haptic'),
					theme: handler('theme'),
					refresh: handler('refresh'),
				},
			},
		})
	})
	return () =>
		page.evaluate(
			() =>
				(window as unknown as { __bridgeMessages: string[] }).__bridgeMessages,
		)
}

async function createShoppingList(user: { id: string; householdId: string }) {
	const list = await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: user.householdId,
			items: { create: [{ name: 'Rice', quantity: '200', unit: 'g' }] },
		},
		include: { items: true },
	})
	return { list, rice: list.items[0]! }
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

const viewport = (page: Page) =>
	page.locator('meta[name="viewport"]').getAttribute('content')

test.describe('in the iOS app', () => {
	test.use({ userAgent: SHELL_UA, colorScheme: 'dark' })

	test('draws under the status bar and reports the system theme', async ({
		page,
		navigate,
		login,
	}) => {
		const messages = await recordBridgeMessages(page)
		await login()
		await navigate('/recipes')

		expect(await viewport(page)).toContain('viewport-fit=cover')
		await expect(page.locator('[data-status-bar-backdrop]')).toHaveCount(1)
		await expect.poll(messages).toContain('theme:dark')
	})

	test('checking a Shopping item taps the haptic and saves the check', async ({
		page,
		login,
	}) => {
		const messages = await recordBridgeMessages(page)
		const { rice } = await createShoppingList(await login())
		await openShopping(page)

		await page
			.getByRole('group', { name: 'Rice shopping item' })
			.getByRole('button', { name: 'Check off item' })
			.click()

		await expect(
			page
				.getByRole('group', { name: 'Rice shopping item' })
				.getByRole('button', { name: 'Uncheck item' }),
		).toBeVisible()
		expect(await messages()).toContain('haptic:selection')
		await expect
			.poll(
				async () =>
					(
						await prisma.shoppingListItem.findUniqueOrThrow({
							where: { id: rice.id },
						})
					).checked,
			)
			.toBe(true)
	})

	test('pull to refresh reloads the page data and then reports done', async ({
		page,
		login,
	}) => {
		const messages = await recordBridgeMessages(page)
		const { list } = await createShoppingList(await login())
		await openShopping(page)
		// Someone else adds an item; the open page does not know yet.
		await prisma.shoppingListItem.create({
			data: { listId: list.id, name: 'Lemons' },
		})

		await page.evaluate(() =>
			window.dispatchEvent(new CustomEvent('qm:refresh')),
		)

		await expect(
			page.getByRole('group', { name: 'Lemons shopping item' }),
		).toBeVisible()
		await expect.poll(messages).toContain('refresh:done')
	})
})

test.describe('in a browser', () => {
	test.use({ userAgent: SAFARI_UA })

	test('keeps the Home Screen layout clear of the status bar', async ({
		page,
		navigate,
		login,
	}) => {
		await login()
		await navigate('/recipes')

		expect(await viewport(page)).not.toContain('viewport-fit')
		await expect(page.locator('[data-status-bar-backdrop]')).toHaveCount(0)
	})
})
