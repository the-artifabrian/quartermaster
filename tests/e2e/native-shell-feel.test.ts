import { type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import {
	SAFARI_UA,
	SHELL_UA,
	setHomeIndicatorInset,
} from '#tests/native-shell.ts'
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

async function expectSheetDocksOnTabBar(page: Page) {
	await page.getByRole('button', { name: 'Add item' }).click()

	const sheet = page
		.getByRole('dialog', { name: 'Add to list' })
		.locator(':scope > div')
		.last()
	const bar = page.locator('[data-bottom-nav]')
	// The sheet slides up as it opens; poll until it has settled.
	await expect
		.poll(async () => {
			const [sheetBox, barBox] = await Promise.all([
				sheet.boundingBox(),
				bar.boundingBox(),
			])
			if (!sheetBox || !barBox) return Infinity
			return Math.abs(sheetBox.y + sheetBox.height - barBox.y)
		})
		.toBeLessThanOrEqual(1)
}

// Guards the removed active-tab underline: the tab is its icon and label.
async function expectNoActiveTabUnderline(page: Page) {
	await expect(
		page
			.getByRole('navigation', { name: 'Main' })
			.getByRole('link', { name: 'Plan', exact: true })
			.locator(':scope > *'),
	).toHaveCount(2)
}

const count = (messages: string[], message: string) =>
	messages.filter((m) => m === message).length

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

		const uncheck = page
			.getByRole('group', { name: 'Rice shopping item' })
			.getByRole('button', { name: 'Uncheck item' })
		await expect(uncheck).toBeVisible()
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
		// The check has settled; one tap gave one haptic.
		await expect(uncheck).not.toHaveAttribute('aria-busy', /.+/)
		expect(count(await messages(), 'haptic:selection')).toBe(1)
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

		const pull = () =>
			page.evaluate(() => window.dispatchEvent(new CustomEvent('qm:refresh')))
		const dones = async () => count(await messages(), 'refresh:done')

		await pull()
		await expect(
			page.getByRole('group', { name: 'Lemons shopping item' }),
		).toBeVisible()
		await expect.poll(dones).toBe(1)

		await pull()
		await expect.poll(dones).toBe(2)
	})

	test('a Recipe slides in from its card, and backing out of Edit does not slide it in again', async ({
		page,
		login,
	}) => {
		const messages = await recordBridgeMessages(page)
		const user = await login()
		const recipe = await prisma.recipe.create({
			data: {
				title: 'Lemon rice',
				userId: user.id,
				householdId: user.householdId,
			},
		})
		const direction = () =>
			page.evaluate(() => document.documentElement.dataset.navDirection ?? null)

		await page.goto('/recipes')
		// The theme is posted after hydration, so the card link is live.
		await expect.poll(messages).toContain('theme:dark')
		await page.getByRole('link', { name: /Lemon rice/ }).click()
		await expect(page).toHaveURL(`/recipes/${recipe.id}`)
		// The URL changes before the router commits the new page.
		await expect.poll(direction).toBe('forward')

		await page.getByRole('link', { name: 'Edit recipe' }).click()
		await expect(page).toHaveURL(`/recipes/${recipe.id}/edit`)
		await page.getByRole('button', { name: 'Cancel' }).click()
		await expect(
			page.getByRole('heading', { level: 1, name: 'Lemon rice' }),
		).toBeVisible()
		expect(await direction()).not.toBe('forward')
	})
})

test.describe('the homepage in the iOS app', () => {
	test.use({ userAgent: SHELL_UA, colorScheme: 'light' })

	test('reports dark for the espresso chrome, then the theme again', async ({
		page,
	}) => {
		const messages = await recordBridgeMessages(page)
		await page.goto('/')
		await expect.poll(messages).toContain('theme:dark')

		await page.getByRole('banner').getByRole('link', { name: 'Log In' }).click()
		await expect(page).toHaveURL('/login')
		await expect.poll(messages).toContain('theme:light')
	})
})

test.describe('the tab bar in the iOS app', () => {
	test.use({ userAgent: SHELL_UA, viewport: { width: 390, height: 844 } })

	test('the tab bar leaves 18pt of the home indicator inset under its row', async ({
		page,
		login,
	}) => {
		await setHomeIndicatorInset(page, 34)
		await login()
		await page.goto('/plan')
		// The 54pt row, its 1px top border, and 18pt of the 34pt inset.
		const bar = (await page.locator('[data-bottom-nav]').boundingBox())!
		expect(bar.height).toBe(73)
		// The icons sit as far below the bar's edge as the labels sit above the
		// home indicator, whose top is 13pt from the screen edge.
		const plan = page.getByRole('link', { name: 'Plan' })
		const icon = (await plan.locator('svg').boundingBox())!
		const label = (await plan.getByText('Plan').boundingBox())!
		expect(icon.y - bar.y).toBe(9)
		expect(bar.y + bar.height - 13 - (label.y + label.height)).toBe(9)
		await expectNoActiveTabUnderline(page)
	})

	test('with no home indicator inset, the tab bar is its row alone', async ({
		page,
		login,
	}) => {
		await createShoppingList(await login())
		await openShopping(page)
		// The 54pt row and its 1px top border; the inset stops at 0.
		expect(
			(await page.locator('[data-bottom-nav]').boundingBox())?.height,
		).toBe(55)
		await expectSheetDocksOnTabBar(page)
	})

	test('the header is as tall as a native nav bar', async ({ page, login }) => {
		await login()
		await page.goto('/plan')
		// Playwright has no status bar, so the header is the 44pt row and its
		// 1px bottom border.
		expect((await page.getByRole('banner').boundingBox())?.height).toBe(45)
		const settings = await page
			.getByRole('banner')
			.getByRole('link', { name: 'Settings' })
			.boundingBox()
		expect([settings?.width, settings?.height]).toEqual([44, 44])
	})

	test('signed out, the header keeps its padding around Sign Up', async ({
		page,
	}) => {
		await page.goto('/login')
		await expect(
			page.getByRole('banner').getByRole('link', { name: 'Sign Up' }),
		).toBeVisible()
		expect((await page.getByRole('banner').boundingBox())?.height).toBe(69)
	})

	test('a sheet docks on the tab bar with no gap', async ({ page, login }) => {
		await setHomeIndicatorInset(page, 34)
		await createShoppingList(await login())
		await openShopping(page)
		await expectSheetDocksOnTabBar(page)
	})

	test('a tab tap or Enter taps the haptic once', async ({ page, login }) => {
		const messages = await recordBridgeMessages(page)
		await login()
		await openShopping(page)
		const tabHaptics = async () => count(await messages(), 'haptic:selection')

		const tabBar = page.getByRole('navigation', { name: 'Main' })
		const plan = tabBar.getByRole('link', { name: 'Plan', exact: true })
		await plan.click()
		await expect(page).toHaveURL('/plan')
		// The press and the click after it have both run once the switch ends.
		await expect(plan).not.toHaveAttribute('data-pending', /.+/)
		expect(await tabHaptics()).toBe(1)

		const shop = tabBar.getByRole('link', { name: 'Shop', exact: true })
		await shop.focus()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL('/shopping')
		await expect(shop).not.toHaveAttribute('data-pending', /.+/)
		expect(await tabHaptics()).toBe(2)
	})
})

test.describe('in a browser', () => {
	test.use({ userAgent: SAFARI_UA })

	test('the header and the tab bar keep their heights', async ({
		page,
		login,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await setHomeIndicatorInset(page, 34)
		await login()
		await page.goto('/plan')
		expect((await page.getByRole('banner').boundingBox())?.height).toBe(67)
		// The 64px row, its 1px top border, and the whole 34pt inset.
		expect(
			(await page.locator('[data-bottom-nav]').boundingBox())?.height,
		).toBe(99)
		await expectNoActiveTabUnderline(page)
	})

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
