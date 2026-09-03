import { type Page } from '@playwright/test'
import { expect, test } from '#tests/playwright-utils.ts'

async function takeControl(page: Page) {
	await page.goto('/inventory')
	await page.evaluate(() => navigator.serviceWorker.ready)
	await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
	await page.reload()
}

test('online documents use the current deployment and never enter Cache Storage', async ({
	page,
	login,
}) => {
	await login()
	await takeControl(page)
	const preloadState = await page.evaluate(async () => {
		const registration = await navigator.serviceWorker.ready
		return registration.navigationPreload.getState()
	})
	expect(preloadState.enabled).toBe(true)
	const planRequests: string[] = []
	page.on('request', (request) => {
		const url = new URL(request.url())
		if (request.method() === 'GET' && url.pathname === '/plan') {
			planRequests.push(request.url())
		}
	})

	await page.evaluate(async () => {
		const legacy = await caches.open('qm-pages-v7')
		await legacy.put(
			'/plan',
			new Response('<h1>Previous account private plan</h1>', {
				headers: { 'Content-Type': 'text/html; charset=utf-8' },
			}),
		)
	})

	const response = await page.goto('/plan')
	expect(response?.fromServiceWorker()).toBe(true)
	expect(planRequests).toHaveLength(1)
	expect(response?.headers()['cache-control']).toBe('private, no-cache')
	await expect(page.getByRole('heading', { name: 'Meal Plan' })).toBeVisible()
	await expect(
		page.getByRole('heading', { name: 'Previous account private plan' }),
	).toHaveCount(0)

	// A legacy document can exist until the next worker activation, but the current
	// worker must neither read it nor create a replacement document cache.
	await page.evaluate(() => caches.delete('qm-pages-v7'))
	await page.reload()
	const documentCaches = await page.evaluate(async () => {
		const matches: string[] = []
		for (const cacheName of await caches.keys()) {
			const cache = await caches.open(cacheName)
			if (await cache.match('/plan')) matches.push(cacheName)
		}
		return matches
	})
	expect(documentCaches).toEqual([])
})

test('Route data is current online and falls back only inside the live session', async ({
	page,
	context,
	login,
}) => {
	await login()
	await takeControl(page)

	// The session-sync effect runs after hydration. Re-fetch until the production
	// worker has created the build- and session-scoped cache.
	await page.waitForFunction(async () => {
		await fetch('/plan.data')
		for (const cacheName of await caches.keys()) {
			if (!cacheName.startsWith('qm-data-')) continue
			const cache = await caches.open(cacheName)
			if (await cache.match('/plan.data')) return true
		}
		return false
	})

	await page.evaluate(async () => {
		const cacheName = (await caches.keys()).find((name) =>
			name.startsWith('qm-data-'),
		)
		if (!cacheName) throw new Error('Session data cache was not created')
		const cache = await caches.open(cacheName)
		await cache.put('/plan.data', new Response('STALE ROUTE DATA'))
	})

	const online = await page.evaluate(async () => {
		const response = await fetch('/plan.data')
		return {
			body: await response.text(),
			cacheControl: response.headers.get('Cache-Control'),
			status: response.status,
		}
	})
	expect(online.status).toBe(200)
	expect(online.body).not.toBe('STALE ROUTE DATA')
	expect(online.cacheControl).toBe('private, no-cache')

	await page.waitForFunction(async () => {
		const cacheName = (await caches.keys()).find((name) =>
			name.startsWith('qm-data-'),
		)
		if (!cacheName) return false
		const response = await (await caches.open(cacheName)).match('/plan.data')
		return response ? (await response.text()) !== 'STALE ROUTE DATA' : false
	})

	await context.setOffline(true)
	try {
		const offline = await page.evaluate(async () => {
			const response = await fetch('/plan.data')
			return { body: await response.text(), status: response.status }
		})
		expect(offline.status).toBe(200)
		expect(offline.body).toBe(online.body)
	} finally {
		await context.setOffline(false)
	}
})

test('offline document launches use the safe app response', async ({
	page,
	context,
	login,
}) => {
	await login()
	await takeControl(page)
	await page.goto('/plan')

	await context.setOffline(true)
	try {
		const pantryResponse = await page.goto('/inventory')
		expect(pantryResponse?.fromServiceWorker()).toBe(true)
		expect(pantryResponse?.status()).toBe(503)
		expect(pantryResponse?.headers()['cache-control']).toBe('no-store')
		expect(pantryResponse?.headers()['content-type']).toContain('text/html')
		await expect(
			page.getByRole('heading', { name: /you.re offline/i }),
		).toBeVisible()
		await expect(page.getByText('Meal Plan')).toHaveCount(0)

		const launchResponse = await page.goto('/')
		expect(launchResponse?.fromServiceWorker()).toBe(true)
		expect(launchResponse?.status()).toBe(503)
		await expect(page).toHaveURL('/plan')
		await expect(
			page.getByRole('heading', { name: /you.re offline/i }),
		).toBeVisible()
	} finally {
		await context.setOffline(false)
	}
})

test('production HTTP caching keeps dynamic content private and assets immutable', async ({
	page,
	login,
}) => {
	await login()
	const assetResponsePromise = page.waitForResponse((response) => {
		const url = new URL(response.url())
		return url.pathname.startsWith('/assets/') && response.status() === 200
	})

	const documentResponse = await page.goto('/plan')
	const assetResponse = await assetResponsePromise
	const dataResponse = await page.request.get('/plan.data')
	const manifestResponse = await page.request.get('/site.webmanifest')

	expect(documentResponse?.headers()['cache-control']).toBe('private, no-cache')
	expect(dataResponse.headers()['cache-control']).toBe('private, no-cache')
	expect(manifestResponse.headers()['cache-control']).toBe('no-cache')
	expect(assetResponse.headers()['cache-control']).toContain('max-age=31536000')
	expect(assetResponse.headers()['cache-control']).toContain('immutable')
})
