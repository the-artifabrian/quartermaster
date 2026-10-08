import { type BrowserContext, type Page } from '@playwright/test'
import { expect, test } from '#tests/playwright-utils.ts'

const UPDATE_KEY = 'qm:pwa-update'

/** Count the documents this tab loads from now on, reloads included. */
function watchDocumentLoads(page: Page) {
	let loads = 0
	page.on('load', () => {
		loads += 1
	})
	return () => loads
}

function pendingUpdate(page: Page) {
	return page.evaluate(
		(key) =>
			JSON.parse(sessionStorage.getItem(key) ?? 'null') as {
				prompt?: { trigger?: string }
				accepted?: { fromBuild: string }
				activatedAt?: number
			} | null,
		UPDATE_KEY,
	)
}

/**
 * Stand in for a deploy: the server gives this context a byte-different
 * worker script (see `qm-e2e-deploy` in server/index.ts), and the open page
 * finds it the way the hourly check would.
 */
async function deployNewWorker(context: BrowserContext, page: Page) {
	await context.addCookies([
		{ name: 'qm-e2e-deploy', value: 'next', domain: 'localhost', path: '/' },
	])
	await page.evaluate(async () => {
		const registration = await navigator.serviceWorker.getRegistration()
		await registration?.update()
	})
	await expect
		.poll(
			() =>
				page.evaluate(
					async () =>
						(await navigator.serviceWorker.getRegistration())?.waiting?.state,
				),
			{ message: 'the new worker is waiting' },
		)
		.toBe('installed')
}

/** Simulate the app going to the background and coming back. */
async function setVisibility(page: Page, state: 'hidden' | 'visible') {
	await page.evaluate((next) => {
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => next,
		})
		Object.defineProperty(document, 'hidden', {
			configurable: true,
			get: () => next === 'hidden',
		})
		document.dispatchEvent(new Event('visibilitychange'))
	}, state)
}

/**
 * Open Shopping and wait for hydration, which also means the update control
 * has registered the worker: a deploy after this point is found mid-session.
 */
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

function addItemInput(page: Page) {
	return page.getByPlaceholder(/add an item/i).filter({ visible: true })
}

async function takeControl(page: Page) {
	await page.goto('/inventory')
	await page.evaluate(() => navigator.serviceWorker.ready)
	// The worker deliberately does not claim the page that installed it. A first
	// registration takes control at the next document boundary; existing
	// registrations are already controlling and skip this reload.
	if (
		!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
	) {
		await page.reload()
	}
	await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
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

test('the installed worker waits for a document boundary and uses a build-scoped asset cache', async ({
	page,
	login,
}) => {
	await login()
	// Chromium shows a first worker as `waiting` for a moment before it
	// activates. That moment must not count as an update to apply.
	await page.goto('/inventory')
	await page.evaluate(() => navigator.serviceWorker.ready)
	expect(
		await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
	).toBe(false)
	// waitForFunction treats an async predicate's Promise as truthy and returns
	// at once, so poll the worker state instead.
	await expect
		.poll(() =>
			page.evaluate(
				async () => (await navigator.serviceWorker.ready).active?.state,
			),
		)
		.toBe('activated')
	expect(await pendingUpdate(page)).toBeNull()
	await page.reload()
	await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
	const result = await page.evaluate(async () => {
		const staticCaches = (await caches.keys()).filter((name) =>
			name.startsWith('qm-static-'),
		)
		const cachedAssets = await Promise.all(
			staticCaches.map(async (name) => {
				const requests = await (await caches.open(name)).keys()
				return requests.map((request) => new URL(request.url).pathname)
			}),
		)
		return {
			cacheNames: staticCaches,
			cachedAssets: cachedAssets.flat().sort(),
		}
	})

	expect(result.cacheNames).toHaveLength(1)
	expect(result.cacheNames[0]).toMatch(/^qm-static-[a-f\d]{12}$/)
	expect(result.cachedAssets.length).toBeGreaterThan(0)
	expect(
		result.cachedAssets.every((asset) => asset.startsWith('/assets/')),
	).toBe(true)
})

function waitingWorkerState(page: Page) {
	return page.evaluate(
		async () =>
			(await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null,
	)
}

test('a deploy found mid-session waits, and the next launch applies it with one reload', async ({
	page,
	context,
	login,
}) => {
	await login()
	await takeControl(page)
	await openShopping(page)
	await addItemInput(page).fill('Half-typed bananas')
	const firstWindowLoads = watchDocumentLoads(page)

	await deployNewWorker(context, page)
	// Mid-session the new worker only waits.
	await expect(addItemInput(page)).toHaveValue('Half-typed bananas')
	expect(await pendingUpdate(page)).toBeNull()

	// Opening the app again is a launch: the waiting worker activates before
	// anyone touches the page, and that window reloads once.
	const launched = await context.newPage()
	const launchedLoads = watchDocumentLoads(launched)
	await launched.goto('/shopping')
	await expect.poll(launchedLoads, { message: 'one reload' }).toBe(2)
	await expect(addItemInput(launched)).toBeVisible()
	expect(await waitingWorkerState(launched)).toBeNull()
	expect(await pendingUpdate(launched)).toMatchObject({
		prompt: { trigger: 'launch' },
		accepted: { fromBuild: expect.any(String) },
		activatedAt: expect.any(Number),
	})

	// The first window keeps its page and its half-typed item; it moves to the
	// new worker at its own next launch.
	await expect(addItemInput(page)).toHaveValue('Half-typed bananas')
	expect(firstWindowLoads()).toBe(0)
	expect(launchedLoads()).toBe(2)
})

test('a quick switch away and back keeps the page and leaves the update waiting', async ({
	page,
	context,
	login,
}) => {
	await login()
	await takeControl(page)
	await openShopping(page)
	await deployNewWorker(context, page)
	await addItemInput(page).fill('Half-typed bananas')
	const loads = watchDocumentLoads(page)

	await setVisibility(page, 'hidden')
	await setVisibility(page, 'visible')

	await expect(addItemInput(page)).toHaveValue('Half-typed bananas')
	expect(await pendingUpdate(page)).toBeNull()
	expect(await waitingWorkerState(page)).toBe('installed')
	expect(loads()).toBe(0)
})

test('a return after 30 minutes away applies the waiting update with one reload', async ({
	page,
	context,
	login,
}) => {
	await login()
	await takeControl(page)
	await openShopping(page)
	await deployNewWorker(context, page)
	const loads = watchDocumentLoads(page)

	const leftAt = Date.now()
	await page.clock.setFixedTime(leftAt)
	await setVisibility(page, 'hidden')
	await page.clock.setFixedTime(leftAt + 31 * 60 * 1000)
	await setVisibility(page, 'visible')

	await expect.poll(loads, { message: 'one reload' }).toBe(1)
	await expect(addItemInput(page)).toBeVisible()
	expect(await waitingWorkerState(page)).toBeNull()
	expect(await pendingUpdate(page)).toMatchObject({
		prompt: { trigger: 'resume' },
		activatedAt: expect.any(Number),
	})
	expect(loads()).toBe(1)
})

test('Route data is current online and falls back only inside the live session', async ({
	page,
	context,
	login,
}) => {
	await login()
	await takeControl(page)

	// The worker caches Route data only after the page names its session, which
	// happens after hydration, and it writes the cache after it has answered the
	// page. Keep requesting until a session cache holds /plan.data, then replace
	// that entry in the same step. Use expect.poll: page.waitForFunction calls
	// an async predicate once and resolves with whatever it returns.
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					for (const cacheName of await caches.keys()) {
						if (!cacheName.startsWith('qm-data-')) continue
						const cache = await caches.open(cacheName)
						if (!(await cache.match('/plan.data'))) continue
						await cache.put('/plan.data', new Response('STALE ROUTE DATA'))
						return true
					}
					await fetch('/plan.data')
					return false
				}),
			{ message: 'a session data cache holds /plan.data' },
		)
		.toBe(true)

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

	// The worker stores the fresh response after returning it.
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					for (const cacheName of await caches.keys()) {
						if (!cacheName.startsWith('qm-data-')) continue
						const cache = await caches.open(cacheName)
						const response = await cache.match('/plan.data')
						if (response) return response.text()
					}
					return null
				}),
			{ message: 'the worker stores the fresh /plan.data' },
		)
		.toBe(online.body)

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
