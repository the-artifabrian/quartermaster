import { type Page } from '@playwright/test'
import { expect, test } from '#tests/playwright-utils.ts'

// The bottom tab bar switches on the press (pointerdown), not on the click
// that follows once the finger lifts. See #346, 5.0.

const touch = {
	button: 0,
	buttons: 1,
	isPrimary: true,
	pointerId: 1,
	pointerType: 'touch',
}

function tab(page: Page, name: 'Recipes' | 'Staples' | 'Plan' | 'Shopping') {
	return page
		.getByRole('navigation', { name: 'Main' })
		.getByRole('link', { name, exact: true })
}

async function countDataRequests(page: Page, delayMs = 0) {
	const counts = new Map<string, number>()
	await page.route(
		/\/(recipes|inventory|plan|shopping)\.data(?:\?|$)/,
		async (route) => {
			const path = new URL(route.request().url()).pathname
			counts.set(path, (counts.get(path) ?? 0) + 1)
			if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
			await route.continue()
		},
	)
	return counts
}

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } })

test('a press switches tabs before the finger lifts, and the click after it adds nothing', async ({
	page,
	login,
}) => {
	await login()
	const counts = await countDataRequests(page)
	await page.goto('/plan')
	const shop = tab(page, 'Shopping')
	await expect(shop).toBeVisible()

	await shop.dispatchEvent('pointerdown', touch)
	await expect(page).toHaveURL('/shopping')

	await shop.dispatchEvent('pointerup', { ...touch, buttons: 0 })
	await shop.dispatchEvent('click', { button: 0, detail: 1 })
	await expect(shop).not.toHaveAttribute('data-pending', /.+/)
	await page.waitForTimeout(200)
	expect(counts.get('/shopping.data')).toBe(1)
})

test('a second press on the tab being switched to starts nothing new', async ({
	page,
	login,
}) => {
	await login()
	const counts = await countDataRequests(page, 400)
	await page.goto('/plan')
	const shop = tab(page, 'Shopping')
	await expect(shop).toBeVisible()

	await shop.dispatchEvent('pointerdown', touch)
	await expect(shop).toHaveAttribute('data-pending', 'true')
	// The tapped tab looks selected while Plan is still showing.
	await expect(shop).toHaveClass(/(^|\s)text-primary(\s|$)/)
	await expect(tab(page, 'Plan')).not.toHaveClass(/(^|\s)text-primary(\s|$)/)
	await expect(tab(page, 'Plan')).toHaveAttribute('aria-current', 'page')
	await shop.dispatchEvent('pointerup', { ...touch, buttons: 0 })
	await shop.dispatchEvent('pointerdown', touch)
	await shop.dispatchEvent('pointerup', { ...touch, buttons: 0 })

	await expect(page).toHaveURL('/shopping')
	await expect(shop).not.toHaveAttribute('data-pending', /.+/)
	expect(counts.get('/shopping.data')).toBe(1)
})

test('a press on another tab during a pending switch wins', async ({
	page,
	login,
}) => {
	await login()
	await countDataRequests(page, 400)
	await page.goto('/plan')
	const shop = tab(page, 'Shopping')
	await expect(shop).toBeVisible()

	await shop.dispatchEvent('pointerdown', touch)
	await expect(shop).toHaveAttribute('data-pending', 'true')
	await tab(page, 'Recipes').dispatchEvent('pointerdown', touch)

	await expect(page).toHaveURL('/recipes')
	await expect(tab(page, 'Recipes')).toHaveAttribute('aria-current', 'page')
	await expect(shop).not.toHaveAttribute('data-pending', /.+/)
})

test('the right mouse button and a modified press do not switch', async ({
	page,
	login,
}) => {
	await login()
	const counts = await countDataRequests(page)
	await page.goto('/plan')
	const shop = tab(page, 'Shopping')
	await expect(shop).toBeVisible()

	await shop.dispatchEvent('pointerdown', {
		...touch,
		button: 2,
		buttons: 2,
		pointerType: 'mouse',
	})
	await shop.dispatchEvent('pointerdown', {
		...touch,
		pointerType: 'mouse',
		metaKey: true,
	})
	await page.waitForTimeout(300)
	await expect(page).toHaveURL('/plan')
	expect(counts.get('/shopping.data')).toBeUndefined()
})

test('Enter on a focused tab still switches', async ({ page, login }) => {
	await login()
	await page.goto('/plan')
	const shop = tab(page, 'Shopping')
	await expect(shop).toBeVisible()

	await shop.focus()
	await page.keyboard.press('Enter')
	await expect(page).toHaveURL('/shopping')
})
