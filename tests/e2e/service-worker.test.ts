import { type Page } from '@playwright/test'
import { expect, test } from '#tests/playwright-utils.ts'

async function waitForPageCache(page: Page, pathname: string) {
	await page.waitForFunction(async (expectedPathname: string) => {
		for (const cacheName of await caches.keys()) {
			if (!cacheName.startsWith('qm-pages-')) continue
			const cache = await caches.open(cacheName)
			if (await cache.match(expectedPathname)) return true
		}
		return false
	}, pathname)
}

test('an online launch uses the current deployment instead of cached HTML', async ({
	page,
	login,
}) => {
	await login()
	await page.goto('/inventory')
	await page.evaluate(() => navigator.serviceWorker.ready)
	await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
	await page.reload()
	await waitForPageCache(page, '/inventory')

	await page.evaluate(async () => {
		const cacheName = (await caches.keys()).find((name) =>
			name.startsWith('qm-pages-'),
		)
		if (!cacheName) throw new Error('Page cache was not created')
		const cache = await caches.open(cacheName)
		await cache.put(
			'/plan',
			new Response('<h1>Old deployment</h1>', {
				headers: {
					'Content-Type': 'text/html; charset=utf-8',
					date: new Date().toUTCString(),
				},
			}),
		)
	})

	const response = await page.goto('/plan')
	expect(response?.fromServiceWorker()).toBe(true)
	await expect(page.getByRole('heading', { name: 'Meal Plan' })).toBeVisible()
	await expect(
		page.getByRole('heading', { name: 'Old deployment' }),
	).toHaveCount(0)
})

test('cached tabs and uncached pages stay inside the app offline', async ({
	page,
	context,
	login,
}) => {
	await login()
	await page.goto('/inventory')
	await page.evaluate(() => navigator.serviceWorker.ready)
	await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))

	// Reload under SW control so both the document and its current-build assets
	// are populated through the real production worker.
	await page.reload()
	await waitForPageCache(page, '/inventory')
	const pantryHeading = await page
		.getByRole('heading', { level: 1 })
		.innerText()

	await page.goto('/plan')
	await waitForPageCache(page, '/plan')

	await context.setOffline(true)
	try {
		const pantryResponse = await page.goto('/inventory')
		expect(pantryResponse?.fromServiceWorker()).toBe(true)
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			pantryHeading,
		)

		const fallbackResponse = await page.goto('/settings/profile')
		expect(fallbackResponse?.fromServiceWorker()).toBe(true)
		expect(fallbackResponse?.status()).toBe(503)
		await expect(
			page.getByRole('heading', { name: /you.re offline/i }),
		).toBeVisible()

		const launchResponse = await page.goto('/')
		expect(launchResponse?.fromServiceWorker()).toBe(true)
		await expect(page).toHaveURL('/plan')
	} finally {
		await context.setOffline(false)
	}
})
