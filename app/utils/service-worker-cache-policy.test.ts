import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, test } from 'vitest'

const ORIGIN = 'https://quartermaster.test'
const webmanifestPath = fileURLToPath(
	new URL('../../public/site.webmanifest', import.meta.url),
)
const WEBMANIFEST_START_URL = (
	JSON.parse(readFileSync(webmanifestPath, 'utf8')) as { start_url: string }
).start_url

type RequestLike = string | Request | { url: string }

function requestUrl(request: RequestLike): string {
	return new URL(typeof request === 'string' ? request : request.url, ORIGIN)
		.href
}

class MemoryCache {
	readonly entries = new Map<string, Response>()

	constructor(
		private readonly name: string,
		private readonly storage: MemoryCacheStorage,
	) {}

	async match(request: RequestLike) {
		return this.entries.get(requestUrl(request))?.clone()
	}

	async put(request: RequestLike, response: Response) {
		if (this.storage.rejectWrites) throw new Error('Quota exceeded')
		const url = requestUrl(request)
		this.entries.set(url, response.clone())
		this.storage.puts.push({ cacheName: this.name, url })
	}

	async keys() {
		return [...this.entries].map(([url]) => ({ url }))
	}

	async delete(request: RequestLike) {
		return this.entries.delete(requestUrl(request))
	}
}

class MemoryCacheStorage {
	readonly caches = new Map<string, MemoryCache>()
	readonly puts: Array<{ cacheName: string; url: string }> = []
	rejectOpen = false
	rejectWrites = false
	async open(name: string) {
		if (this.rejectOpen) throw new Error('Cache Storage unavailable')
		let cache = this.caches.get(name)
		if (!cache) {
			cache = new MemoryCache(name, this)
			this.caches.set(name, cache)
		}
		return cache
	}

	async keys() {
		return [...this.caches.keys()]
	}

	async delete(name: string) {
		return this.caches.delete(name)
	}

	async seed(cacheName: string, url: string, response: Response) {
		const cache = await this.open(cacheName)
		cache.entries.set(requestUrl(url), response.clone())
	}
}

type FetchRequest = {
	method: string
	mode: string
	url: string
}

function fetchRequest(request: RequestLike): FetchRequest {
	return {
		method: typeof request === 'string' ? 'GET' : (request as Request).method,
		mode: typeof request === 'string' ? 'cors' : (request as Request).mode,
		url: requestUrl(request),
	}
}

function routeDataResponse(body: string, status = 200) {
	return new Response(body, {
		status,
		headers: { 'Content-Type': 'text/x-script' },
	})
}

function loadServiceWorker({
	storage = new MemoryCacheStorage(),
	currentAssetPaths = ['/assets/current-build.js'],
	cacheVersion = 'test-build',
	navigationPreloadSupported = false,
	navigationPreloadEnableFails = false,
}: {
	storage?: MemoryCacheStorage
	currentAssetPaths?: string[]
	cacheVersion?: string
	navigationPreloadSupported?: boolean
	navigationPreloadEnableFails?: boolean
} = {}) {
	const swPath = fileURLToPath(new URL('../../public/sw.js', import.meta.url))
	const source = readFileSync(swPath, 'utf8')
		.replace(
			"'__QM_CLIENT_ASSET_PATHS__'",
			currentAssetPaths
				.map((assetPath) => JSON.stringify(assetPath))
				.join(', '),
		)
		.replace("'__QM_START_URL__'", JSON.stringify(WEBMANIFEST_START_URL))
		.replace("'__QM_CACHE_VERSION__'", JSON.stringify(cacheVersion))

	const listeners: Record<string, (event: any) => void> = {}
	let claimed = false
	let skipWaitingCalls = 0
	let navigationPreloadEnabled = false
	let fetchImplementation = async (_request: FetchRequest): Promise<Response> =>
		new Response('NETWORK')
	const fetchCalls: FetchRequest[] = []
	const runFetch = (request: RequestLike) => {
		const normalized = fetchRequest(request)
		fetchCalls.push(normalized)
		return fetchImplementation(normalized)
	}
	const sandbox: Record<string, any> = {
		self: {
			location: { origin: ORIGIN },
			registration: navigationPreloadSupported
				? {
						navigationPreload: {
							enable: async () => {
								if (navigationPreloadEnableFails) {
									throw new Error('Navigation Preload unavailable')
								}
								navigationPreloadEnabled = true
							},
						},
					}
				: {},
			clients: {
				claim: async () => {
					claimed = true
				},
			},
			skipWaiting: async () => {
				skipWaitingCalls++
			},
			addEventListener: (type: string, listener: (event: any) => void) => {
				listeners[type] = listener
			},
		},
		Response,
		Headers,
		Request,
		URL,
		Set,
		caches: storage,
		fetch: runFetch,
	}
	vm.createContext(sandbox)
	vm.runInContext(source, sandbox)

	async function dispatchFetch(
		pathname: string,
		{
			mode = 'cors',
			preloadResponse,
		}: { mode?: string; preloadResponse?: Promise<Response | undefined> } = {},
	) {
		let responsePromise: Promise<Response> | undefined
		const lifetimes: Promise<unknown>[] = []
		listeners.fetch?.({
			request: {
				method: 'GET',
				mode,
				url: new URL(pathname, ORIGIN).href,
			},
			preloadResponse,
			respondWith: (response: Response | Promise<Response>) => {
				responsePromise = Promise.resolve(response)
			},
			waitUntil: (promise: Promise<unknown>) => lifetimes.push(promise),
		})
		if (!responsePromise) return undefined
		const response = await responsePromise
		await Promise.all(lifetimes)
		return response
	}

	async function dispatchMessage(data: unknown) {
		const lifetimes: Promise<unknown>[] = []
		listeners.message?.({
			data,
			waitUntil: (promise: Promise<unknown>) => lifetimes.push(promise),
		})
		await Promise.all(lifetimes)
	}

	async function dispatchInstall() {
		const lifetimes: Promise<unknown>[] = []
		listeners.install?.({
			waitUntil: (promise: Promise<unknown>) => lifetimes.push(promise),
		})
		await Promise.all(lifetimes)
	}

	async function dispatchActivate() {
		const lifetimes: Promise<unknown>[] = []
		listeners.activate?.({
			waitUntil: (promise: Promise<unknown>) => lifetimes.push(promise),
		})
		await Promise.all(lifetimes)
	}

	return {
		storage,
		fetchCalls,
		dispatchActivate,
		dispatchFetch,
		dispatchInstall,
		dispatchMessage,
		setFetch: (
			implementation: (request: FetchRequest) => Promise<Response>,
		) => {
			fetchImplementation = implementation
		},
		wasClaimed: () => claimed,
		registeredEventTypes: () => Object.keys(listeners),
		skipWaitingCalls: () => skipWaitingCalls,
		wasNavigationPreloadEnabled: () => navigationPreloadEnabled,
	}
}

describe('service-worker lifecycle and public resources', () => {
	test('does not retain the retired cooking-timer notification path', () => {
		const worker = loadServiceWorker()

		expect(worker.registeredEventTypes()).not.toContain('notificationclick')
	})

	test.each([
		{ supported: true, enabled: true },
		{ supported: false, enabled: false },
	])(
		'activation enables Navigation Preload only when support is $supported',
		async ({ supported, enabled }) => {
			const worker = loadServiceWorker({
				navigationPreloadSupported: supported,
			})

			await worker.dispatchActivate()

			expect(worker.wasNavigationPreloadEnabled()).toBe(enabled)
			expect(worker.wasClaimed()).toBe(false)
		},
	)

	test('activation continues when Navigation Preload cannot be enabled', async () => {
		const worker = loadServiceWorker({
			navigationPreloadSupported: true,
			navigationPreloadEnableFails: true,
		})

		await worker.dispatchActivate()

		expect(worker.wasNavigationPreloadEnabled()).toBe(false)
		expect(worker.wasClaimed()).toBe(false)
	})

	test('install leaves the active generation untouched and does not activate early', async () => {
		const storage = new MemoryCacheStorage()
		await storage.seed(
			'qm-static-active-build',
			'/assets/active.js',
			new Response('ACTIVE ASSET'),
		)
		const worker = loadServiceWorker({
			storage,
			cacheVersion: 'next-build',
			currentAssetPaths: ['/assets/app.js', '/assets/lazy.js'],
		})
		worker.setFetch(async ({ url }) => new Response(`asset:${url}`))

		await worker.dispatchInstall()

		expect(worker.skipWaitingCalls()).toBe(0)
		expect(worker.fetchCalls).toEqual([])
		expect(await storage.keys()).toEqual(['qm-static-active-build'])
		expect(
			await (
				await worker.storage.open('qm-static-active-build')
			).match('/assets/active.js'),
		).toBeDefined()
	})

	test('only an explicit update message asks a waiting worker to activate', async () => {
		const worker = loadServiceWorker()

		await worker.dispatchMessage({ type: 'unrelated' })
		expect(worker.skipWaitingCalls()).toBe(0)

		await worker.dispatchMessage({ type: 'qm-activate-update' })
		expect(worker.skipWaitingCalls()).toBe(1)
	})

	test('activation removes obsolete data but retains the active static generation', async () => {
		const storage = new MemoryCacheStorage()
		await storage.seed('qm-pages-v7', '/plan', new Response('PRIVATE DOCUMENT'))
		await storage.seed(
			'qm-data-old-build-user-household',
			'/plan.data',
			new Response('OLD DATA'),
		)
		await storage.seed(
			'qm-data-current-build-user-household',
			'/plan.data',
			new Response('CURRENT GENERATION DATA'),
		)
		await storage.seed(
			'qm-static-v1',
			'/assets/current.js',
			new Response('CURRENT ASSET'),
		)
		await storage.seed(
			'qm-static-v1',
			'/assets/old.js',
			new Response('OLD ASSET'),
		)
		for (let index = 0; index < 18; index++) {
			await storage.seed(
				'qm-fonts-v1',
				`https://fonts.gstatic.com/font-${index}.woff2`,
				new Response(`FONT ${index}`),
			)
		}

		const worker = loadServiceWorker({
			storage,
			currentAssetPaths: ['/assets/current.js'],
			cacheVersion: 'current-build',
		})
		await worker.dispatchActivate()

		expect(await storage.keys()).not.toContain('qm-pages-v7')
		expect(await storage.keys()).not.toContain(
			'qm-data-old-build-user-household',
		)
		expect(await storage.keys()).toContain(
			'qm-data-current-build-user-household',
		)
		expect(
			await (await storage.open('qm-static-v1')).match('/assets/current.js'),
		).toBeDefined()
		expect(
			await (await storage.open('qm-static-v1')).match('/assets/old.js'),
		).toBeDefined()
		expect(await storage.keys()).toContain('qm-static-current-build')
		expect((await storage.open('qm-fonts-v1')).entries.size).toBe(16)
		expect(worker.wasClaimed()).toBe(false)
	})

	test('N-1 assets remain available after N activates and N-2 is retired', async () => {
		const storage = new MemoryCacheStorage()
		const oldest = loadServiceWorker({
			storage,
			cacheVersion: 'oldest-build',
			currentAssetPaths: ['/assets/oldest.js'],
		})
		oldest.setFetch(async () => new Response('N-2 ASSET'))
		await oldest.dispatchActivate()
		await oldest.dispatchFetch('/assets/oldest.js')

		const previous = loadServiceWorker({
			storage,
			cacheVersion: 'previous-build',
			currentAssetPaths: ['/assets/previous-lazy.js'],
		})
		previous.setFetch(async () => new Response('N-1 LAZY ASSET'))
		await previous.dispatchActivate()
		await previous.dispatchFetch('/assets/previous-lazy.js')

		const worker = loadServiceWorker({
			storage,
			cacheVersion: 'current-build',
			currentAssetPaths: ['/assets/current.js'],
		})
		worker.setFetch(async ({ url }) => new Response(`current:${url}`))

		expect(await storage.keys()).toContain('qm-static-previous-build')
		expect(await storage.keys()).toContain('qm-static-oldest-build')

		await worker.dispatchActivate()

		expect(await storage.keys()).toContain('qm-static-current-build')
		expect(await storage.keys()).toContain('qm-static-previous-build')
		expect(await storage.keys()).not.toContain('qm-static-oldest-build')
		worker.setFetch(async () => {
			throw new TypeError('Old asset no longer exists at the origin')
		})
		const lazyAsset = await worker.dispatchFetch('/assets/previous-lazy.js')
		expect(await lazyAsset?.text()).toBe('N-1 LAZY ASSET')
	})

	test('only exact current-build asset URLs use Cache Storage', async () => {
		const worker = loadServiceWorker({
			currentAssetPaths: ['/assets/current.js'],
		})
		worker.setFetch(async () => new Response('CURRENT ASSET'))

		expect(await worker.dispatchFetch('/assets/current.js')).toBeDefined()
		expect(
			await worker.dispatchFetch('/assets/current.js?v=copy'),
		).toBeUndefined()
		expect(await worker.dispatchFetch('/assets/old.js')).toBeDefined()
		expect(worker.storage.puts).toEqual([
			{
				cacheName: 'qm-static-test-build',
				url: `${ORIGIN}/assets/current.js`,
			},
		])
	})

	test('the manifest uses the network and refreshes its offline fallback', async () => {
		const worker = loadServiceWorker()
		await worker.storage.seed(
			'qm-public-test-build',
			'/site.webmanifest',
			new Response('OLD MANIFEST'),
		)
		worker.setFetch(
			async () =>
				new Response('CURRENT MANIFEST', {
					headers: { 'Content-Type': 'application/manifest+json' },
				}),
		)

		const response = await worker.dispatchFetch('/site.webmanifest')

		expect(await response?.text()).toBe('CURRENT MANIFEST')
		expect(worker.fetchCalls).toHaveLength(1)
		const cached = await (
			await worker.storage.open('qm-public-test-build')
		).match('/site.webmanifest')
		expect(await cached?.text()).toBe('CURRENT MANIFEST')
	})

	test('the manifest uses its current-generation cache on transport failure', async () => {
		const worker = loadServiceWorker()
		await worker.storage.seed(
			'qm-public-test-build',
			'/site.webmanifest',
			new Response('CACHED MANIFEST'),
		)
		worker.setFetch(async () => {
			throw new TypeError('Failed to fetch')
		})

		const response = await worker.dispatchFetch('/site.webmanifest')

		expect(response?.status).toBe(200)
		expect(await response?.text()).toBe('CACHED MANIFEST')
	})

	test('manifest origin errors remain visible and do not replace the fallback', async () => {
		const worker = loadServiceWorker()
		await worker.storage.seed(
			'qm-public-test-build',
			'/site.webmanifest',
			new Response('CACHED MANIFEST'),
		)
		worker.setFetch(async () => new Response('ORIGIN ERROR', { status: 503 }))

		const response = await worker.dispatchFetch('/site.webmanifest')

		expect(response?.status).toBe(503)
		expect(await response?.text()).toBe('ORIGIN ERROR')
		const cached = await (
			await worker.storage.open('qm-public-test-build')
		).match('/site.webmanifest')
		expect(await cached?.text()).toBe('CACHED MANIFEST')
	})

	test('a captive response cannot replace the cached manifest', async () => {
		const worker = loadServiceWorker()
		await worker.storage.seed(
			'qm-public-test-build',
			'/site.webmanifest',
			new Response('CACHED MANIFEST'),
		)
		worker.setFetch(
			async () =>
				new Response('<html>Sign in to this network</html>', {
					headers: { 'Content-Type': 'text/html' },
				}),
		)

		const response = await worker.dispatchFetch('/site.webmanifest')

		expect(response?.status).toBe(200)
		expect(await response?.text()).toContain('Sign in to this network')
		const cached = await (
			await worker.storage.open('qm-public-test-build')
		).match('/site.webmanifest')
		expect(await cached?.text()).toBe('CACHED MANIFEST')
	})

	test('a cache write failure does not fail a fresh manifest response', async () => {
		const worker = loadServiceWorker()
		worker.storage.rejectWrites = true
		worker.setFetch(
			async () =>
				new Response('CURRENT MANIFEST', {
					headers: { 'Content-Type': 'application/manifest+json' },
				}),
		)

		const response = await worker.dispatchFetch('/site.webmanifest')

		expect(response?.status).toBe(200)
		expect(await response?.text()).toBe('CURRENT MANIFEST')
	})

	test('an uncached offline manifest returns a bounded failure', async () => {
		const worker = loadServiceWorker()
		await worker.storage.seed(
			'qm-public-previous-build',
			'/site.webmanifest',
			new Response('PREVIOUS GENERATION MANIFEST'),
		)
		worker.setFetch(async () => {
			throw new TypeError('Failed to fetch')
		})

		const response = await worker.dispatchFetch('/site.webmanifest')

		expect(response?.status).toBe(503)
		expect(await response?.text()).toBe('Offline')
		expect(
			await worker.dispatchFetch('/site.webmanifest?cache-bust=1'),
		).toBeUndefined()
	})
})

describe('document navigation policy', () => {
	test.each([
		'/plan',
		'/settings/profile',
		'/login',
		'/',
		'/assets/current-build.js',
		'/resources/healthcheck',
	])(
		'a preload supplies the only network response for %s',
		async (pathname) => {
			const worker = loadServiceWorker({ navigationPreloadSupported: true })
			const response = await worker.dispatchFetch(pathname, {
				mode: 'navigate',
				preloadResponse: Promise.resolve(new Response('PRELOADED DOCUMENT')),
			})

			expect(await response?.text()).toBe('PRELOADED DOCUMENT')
			expect(worker.fetchCalls).toHaveLength(0)
		},
	)

	test.each([
		{ name: 'absent', preloadResponse: () => undefined },
		{
			name: 'rejected',
			preloadResponse: () =>
				Promise.reject<Response>(new TypeError('Preload failed')),
		},
	])(
		'an $name preload falls back to one ordinary network request',
		async ({ preloadResponse }) => {
			const worker = loadServiceWorker()
			worker.setFetch(async () => new Response('NETWORK DOCUMENT'))

			const response = await worker.dispatchFetch('/plan', {
				mode: 'navigate',
				preloadResponse: preloadResponse(),
			})

			expect(await response?.text()).toBe('NETWORK DOCUMENT')
			expect(worker.fetchCalls).toHaveLength(1)
		},
	)

	test.each([
		{ status: 302, body: '' },
		{ status: 503, body: 'ORIGIN ERROR' },
		{ status: 200, body: '<html>Sign in to this network</html>' },
	])(
		'a preloaded status $status passes through unchanged',
		async ({ status, body }) => {
			const worker = loadServiceWorker({ navigationPreloadSupported: true })
			const preloaded = new Response(body, {
				status,
				headers: { 'Content-Type': 'text/html' },
			})

			const response = await worker.dispatchFetch('/plan', {
				mode: 'navigate',
				preloadResponse: Promise.resolve(preloaded),
			})

			expect(response?.status).toBe(status)
			expect(await response?.text()).toBe(body)
			expect(worker.fetchCalls).toHaveLength(0)
		},
	)

	test('a rejected preload and aborted request use the offline response', async () => {
		const worker = loadServiceWorker({ navigationPreloadSupported: true })
		worker.setFetch(async () => {
			throw new DOMException('The operation was aborted', 'AbortError')
		})

		const response = await worker.dispatchFetch('/settings/profile', {
			mode: 'navigate',
			preloadResponse: Promise.reject(
				new DOMException('Aborted', 'AbortError'),
			),
		})

		expect(response?.status).toBe(503)
		expect(await response?.text()).toContain("You're offline")
		expect(worker.fetchCalls).toHaveLength(1)
	})

	test('online documents always use the network and are never cached', async () => {
		const worker = loadServiceWorker()
		await worker.storage.seed(
			'qm-pages-v7',
			'/plan',
			new Response('PREVIOUS ACCOUNT PRIVATE PLAN'),
		)
		worker.setFetch(async () => new Response('CURRENT DEPLOYMENT'))

		const response = await worker.dispatchFetch('/plan', { mode: 'navigate' })

		expect(await response?.text()).toBe('CURRENT DEPLOYMENT')
		expect(worker.fetchCalls).toHaveLength(1)
		expect(worker.storage.puts).toHaveLength(0)
	})

	test.each(['/plan', '/settings/profile', '/login'])(
		'offline navigation to %s gets the non-personalized HTML response',
		async (pathname) => {
			const worker = loadServiceWorker()
			worker.setFetch(async () => {
				throw new TypeError('Failed to fetch')
			})

			const response = await worker.dispatchFetch(pathname, {
				mode: 'navigate',
			})
			const body = await response?.text()

			expect(response?.status).toBe(503)
			expect(response?.headers.get('Content-Type')).toContain('text/html')
			expect(body).toContain("You're offline")
			expect(body).toContain('#f6f1eb')
			expect(body).toContain('#1a1816')
			expect(body).not.toContain('PRIVATE')
		},
	)

	test('offline root launch redirects to the manifest start URL', async () => {
		const worker = loadServiceWorker()
		worker.setFetch(async () => {
			throw new TypeError('Failed to fetch')
		})

		const response = await worker.dispatchFetch('/', { mode: 'navigate' })

		expect(response?.status).toBe(302)
		expect(response?.headers.get('location')).toBe(
			`${ORIGIN}${WEBMANIFEST_START_URL}`,
		)
	})
})

describe('session-scoped Route data', () => {
	test.each([
		'/recipes.data',
		'/recipes/recipe-123.data',
		'/plan.data',
		'/shopping.data',
		'/inventory.data',
	])(
		'%s is handled while form and edit data routes are not',
		async (pathname) => {
			const worker = loadServiceWorker()
			worker.setFetch(async () => routeDataResponse('CURRENT'))

			expect(await worker.dispatchFetch(pathname)).toBeDefined()
			expect(await worker.dispatchFetch('/recipes/new.data')).toBeUndefined()
			expect(
				await worker.dispatchFetch('/recipes/recipe-123/edit.data'),
			).toBeUndefined()
		},
	)

	test('an unknown session is network-only and cannot use an existing cache', async () => {
		const worker = loadServiceWorker({ cacheVersion: 'restart' })
		await worker.storage.seed(
			'qm-data-restart-user-a-household-a',
			'/plan.data',
			new Response('USER A PRIVATE DATA'),
		)
		worker.setFetch(async () => {
			throw new TypeError('Failed to fetch')
		})

		const response = await worker.dispatchFetch('/plan.data')

		expect(response?.status).toBe(503)
		expect(await response?.text()).toBe('Offline')
		expect(worker.storage.puts).toHaveLength(0)
	})

	test('healthy online data wins for both partial and full navigations', async () => {
		const worker = loadServiceWorker()
		await worker.dispatchMessage({
			type: 'qm-data-session',
			token: 'user-household',
		})
		const cacheName = 'qm-data-test-build-user-household'
		await worker.storage.seed(
			cacheName,
			'/plan.data?_routes=routes%2Fplan',
			new Response('STALE PARTIAL'),
		)
		await worker.storage.seed(
			cacheName,
			'/plan.data',
			new Response('STALE FULL'),
		)
		worker.setFetch(async () => routeDataResponse('CURRENT'))

		const partial = await worker.dispatchFetch(
			'/plan.data?_routes=routes%2Fplan',
		)
		const full = await worker.dispatchFetch('/plan.data')

		expect(await partial?.text()).toBe('CURRENT')
		expect(await full?.text()).toBe('CURRENT')
		expect(worker.fetchCalls).toHaveLength(2)
	})

	test.each([
		{ status: 202, body: 'AUTH REDIRECT' },
		{ status: 401, body: 'AUTH EXPIRED' },
		{ status: 500, body: 'ORIGIN ERROR' },
	])(
		'origin status $status passes through instead of cached data',
		async (value) => {
			const worker = loadServiceWorker()
			await worker.dispatchMessage({
				type: 'qm-data-session',
				token: 'session',
			})
			await worker.storage.seed(
				'qm-data-test-build-session',
				'/plan.data',
				new Response('CACHED'),
			)
			worker.setFetch(async () => routeDataResponse(value.body, value.status))

			const response = await worker.dispatchFetch('/plan.data')

			expect(response?.status).toBe(value.status)
			expect(await response?.text()).toBe(value.body)
			expect(worker.storage.puts).toHaveLength(0)
		},
	)

	test('a followed captive-portal response passes through and is not cached', async () => {
		const worker = loadServiceWorker()
		await worker.dispatchMessage({ type: 'qm-data-session', token: 'session' })
		await worker.storage.seed(
			'qm-data-test-build-session',
			'/plan.data',
			new Response('CACHED'),
		)
		const portal = new Response('PORTAL HTML', {
			headers: { 'Content-Type': 'text/html' },
		})
		Object.defineProperty(portal, 'redirected', { value: true })
		worker.setFetch(async () => portal)

		const response = await worker.dispatchFetch('/plan.data')

		expect(await response?.text()).toBe('PORTAL HTML')
		expect(worker.storage.puts).toHaveLength(0)
	})

	test('a direct HTML captive-portal response is never cached as Route data', async () => {
		const worker = loadServiceWorker()
		await worker.dispatchMessage({ type: 'qm-data-session', token: 'session' })
		worker.setFetch(
			async () =>
				new Response('PORTAL HTML', {
					headers: { 'Content-Type': 'text/html' },
				}),
		)

		const response = await worker.dispatchFetch('/plan.data')

		expect(await response?.text()).toBe('PORTAL HTML')
		expect(worker.storage.puts).toHaveLength(0)
	})

	test('a transport failure uses only the current session cache', async () => {
		const worker = loadServiceWorker()
		await worker.dispatchMessage({ type: 'qm-data-session', token: 'session' })
		await worker.storage.seed(
			'qm-data-test-build-session',
			'/plan.data',
			new Response('CURRENT SESSION FALLBACK'),
		)
		worker.setFetch(async () => {
			throw new TypeError('Failed to fetch')
		})

		const cached = await worker.dispatchFetch('/plan.data')
		const miss = await worker.dispatchFetch('/inventory.data')

		expect(await cached?.text()).toBe('CURRENT SESSION FALLBACK')
		expect(miss?.status).toBe(503)
	})

	test('a quota failure cannot replace or fail the network response', async () => {
		const worker = loadServiceWorker()
		await worker.dispatchMessage({ type: 'qm-data-session', token: 'session' })
		worker.storage.rejectWrites = true
		worker.setFetch(async () => routeDataResponse('CURRENT'))

		const response = await worker.dispatchFetch('/plan.data')

		expect(response?.status).toBe(200)
		expect(await response?.text()).toBe('CURRENT')
	})

	test('Cache Storage failure still returns a healthy network response', async () => {
		const worker = loadServiceWorker()
		await worker.dispatchMessage({ type: 'qm-data-session', token: 'session' })
		worker.storage.rejectOpen = true
		worker.setFetch(async () => routeDataResponse('CURRENT'))

		const online = await worker.dispatchFetch('/plan.data')
		expect(online?.status).toBe(200)
		expect(await online?.text()).toBe('CURRENT')

		worker.setFetch(async () => {
			throw new TypeError('Failed to fetch')
		})
		const offline = await worker.dispatchFetch('/plan.data')
		expect(offline?.status).toBe(503)
	})

	test('an in-flight response cannot recreate an invalidated data cache', async () => {
		const worker = loadServiceWorker()
		await worker.dispatchMessage({ type: 'qm-data-session', token: 'session' })
		let resolveNetwork!: (response: Response) => void
		worker.setFetch(
			async () =>
				await new Promise<Response>((resolve) => {
					resolveNetwork = resolve
				}),
		)

		const pending = worker.dispatchFetch('/plan.data')
		await Promise.resolve()
		await worker.dispatchMessage({ type: 'qm-data-invalidate' })
		resolveNetwork(routeDataResponse('PRE-MUTATION DATA'))

		expect(await (await pending)?.text()).toBe('PRE-MUTATION DATA')
		expect(await worker.storage.keys()).not.toContain(
			'qm-data-test-build-session',
		)
	})

	test('an in-flight failure cannot fall back across a session switch', async () => {
		const worker = loadServiceWorker()
		await worker.dispatchMessage({ type: 'qm-data-session', token: 'user-a' })
		await worker.storage.seed(
			'qm-data-test-build-user-a',
			'/plan.data',
			new Response('USER A DATA'),
		)
		let rejectNetwork!: (error: Error) => void
		worker.setFetch(
			async () =>
				await new Promise<Response>((_resolve, reject) => {
					rejectNetwork = reject
				}),
		)

		const pending = worker.dispatchFetch('/plan.data')
		await Promise.resolve()
		await worker.dispatchMessage({ type: 'qm-data-session', token: 'user-b' })
		rejectNetwork(new TypeError('Failed to fetch'))

		const response = await pending
		expect(response?.status).toBe(503)
		expect(await response?.text()).toBe('Offline')
	})

	test('session changes, logout, and worker restart cannot cross namespaces', async () => {
		const storage = new MemoryCacheStorage()
		const firstWorker = loadServiceWorker({
			storage,
			cacheVersion: 'restart',
		})
		await firstWorker.dispatchMessage({
			type: 'qm-data-session',
			token: 'user-a-household-a',
		})
		firstWorker.setFetch(async (request) =>
			request.mode === 'navigate'
				? new Response('USER A PRIVATE DOCUMENT')
				: routeDataResponse('USER A PRIVATE DATA'),
		)
		await firstWorker.dispatchFetch('/plan', { mode: 'navigate' })
		await firstWorker.dispatchFetch('/plan.data')

		expect(storage.puts.map((put) => put.url)).toEqual([`${ORIGIN}/plan.data`])

		const restartedWorker = loadServiceWorker({
			storage,
			cacheVersion: 'restart',
		})
		restartedWorker.setFetch(async () => {
			throw new TypeError('Failed to fetch')
		})

		const unknownDocument = await restartedWorker.dispatchFetch('/plan', {
			mode: 'navigate',
		})
		const unknownData = await restartedWorker.dispatchFetch('/plan.data')
		expect(await unknownDocument?.text()).not.toContain('USER A')
		expect(unknownData?.status).toBe(503)

		await storage.seed(
			'qm-data-legacy-user-c',
			'/plan.data',
			new Response('LEGACY USER DATA'),
		)
		await restartedWorker.dispatchMessage({
			type: 'qm-data-session',
			token: 'user-b-household-b',
		})
		expect(await storage.keys()).not.toContain(
			'qm-data-restart-user-a-household-a',
		)
		expect(await storage.keys()).not.toContain('qm-data-legacy-user-c')
		expect((await restartedWorker.dispatchFetch('/plan.data'))?.status).toBe(
			503,
		)

		restartedWorker.setFetch(async () => routeDataResponse('USER B DATA'))
		await restartedWorker.dispatchFetch('/plan.data')
		expect(await storage.keys()).toContain('qm-data-restart-user-b-household-b')
		await restartedWorker.dispatchMessage({ type: 'qm-data-purge' })
		expect(
			(await storage.keys()).filter((name) => name.startsWith('qm-data-')),
		).toEqual([])
	})
})
