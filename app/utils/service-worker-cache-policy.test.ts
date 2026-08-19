import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, test } from 'vitest'

const webmanifestPath = fileURLToPath(
	new URL('../../public/site.webmanifest', import.meta.url),
)
const WEBMANIFEST_START_URL = (
	JSON.parse(readFileSync(webmanifestPath, 'utf8')) as { start_url: string }
).start_url

/**
 * These tests exercise the cache-routing predicates that decide whether a request
 * is cached at all (`isCacheablePage`) and whether it may be served stale
 * (`isReadMostly`). They are the security-/correctness-relevant gates in the
 * service worker: a regression here can silently re-introduce a cross-household
 * data-leak (wrong route cached) or break the SWR fast path.
 *
 * Rather than duplicate the predicates (a copy would drift from the shipped code),
 * we load the REAL public/sw.js into a sandbox and call its actual functions. The
 * SW is a classic worker script (no exports), so we evaluate it with stubbed
 * worker globals and capture the two pure predicates off `self`.
 */
function loadServiceWorkerPredicates() {
	const swPath = fileURLToPath(new URL('../../public/sw.js', import.meta.url))
	const source = readFileSync(swPath, 'utf8')

	// The script only *registers* event handlers at load time (it never invokes
	// them), so a no-op addEventListener is all that's needed to evaluate it.
	const sandbox: Record<string, any> = {
		self: { addEventListener: () => {} },
		// URL/Set/String are ECMAScript intrinsics already present in a vm context;
		// no Web APIs are touched until a handler runs, which we never trigger here.
	}
	vm.createContext(sandbox)
	// Append a probe that captures the predicates we want to test. They are
	// top-level function declarations in sw.js, so they're in scope here.
	vm.runInContext(
		`${source}\n;self.__test = { isCacheablePage, isReadMostly, cachedAgeMs, isFreshEnough, MAX_STALE_SERVE_MS };`,
		sandbox,
	)

	const captured = sandbox.self.__test as {
		isCacheablePage: (url: URL) => boolean
		isReadMostly: (url: URL) => boolean
		cachedAgeMs: (response: Response, now?: number) => number
		isFreshEnough: (response: Response, now?: number) => boolean
		MAX_STALE_SERVE_MS: number
	}
	expect(typeof captured?.isCacheablePage).toBe('function')
	expect(typeof captured?.isReadMostly).toBe('function')
	expect(typeof captured?.cachedAgeMs).toBe('function')
	expect(typeof captured?.isFreshEnough).toBe('function')
	return captured
}

const {
	isCacheablePage,
	isReadMostly,
	cachedAgeMs,
	isFreshEnough,
	MAX_STALE_SERVE_MS,
} = loadServiceWorkerPredicates()
const url = (pathname: string) =>
	new URL(`https://quartermaster.test${pathname}`)

describe('isCacheablePage', () => {
	test.each([
		// list/detail/plan/shopping pages (and their RR7 .data variants) are cached
		['/recipes', true],
		['/recipes.data', true],
		['/plan', true],
		['/plan.data', true],
		['/shopping', true],
		['/shopping.data', true],
		['/inventory', true],
		['/inventory.data', true],
		['/recipes/abc123', true],
		['/recipes/abc123.data', true],
		// recipe form sub-routes must NOT be cached (they need the network)
		['/recipes/new', false],
		['/recipes/new.data', false],
		['/recipes/import', false],
		['/recipes/generate', false],
		['/recipes/quick', false],
		['/recipes/bulk-import', false],
		// edit and deeper sub-paths are not the cacheable detail page
		['/recipes/abc123/edit', false],
		['/recipes/abc123/edit.data', false],
		// unrelated authenticated routes are not cached here
		['/', false],
		['/login', false],
		['/settings/profile', false],
	])('%s → %s', (pathname, expected) => {
		expect(isCacheablePage(url(pathname))).toBe(expected)
	})
})

describe('isReadMostly', () => {
	test.each([
		// read-mostly routes may be served stale-while-revalidate
		['/recipes', true],
		['/recipes.data', true],
		['/recipes/abc123', true],
		['/recipes/abc123.data', true],
		['/plan', true],
		['/plan.data', true],
		['/inventory', true],
		['/inventory.data', true],
		// shopping is edited daily → must stay network-first, never stale
		['/shopping', false],
		['/shopping.data', false],
	])('%s → %s', (pathname, expected) => {
		expect(isReadMostly(url(pathname))).toBe(expected)
	})

	test('every shopping request is excluded from the stale-serve path', () => {
		expect(isReadMostly(url('/shopping'))).toBe(false)
		expect(isReadMostly(url('/shopping.data'))).toBe(false)
	})
})

describe('bounded staleness (isFreshEnough / cachedAgeMs)', () => {
	const NOW = Date.parse('2026-07-11T12:00:00Z')
	const responseDated = (date: string | null) =>
		new Response('x', { headers: date === null ? {} : { date } })

	test('a copy cached an hour ago may be served stale', () => {
		const cached = responseDated('Sat, 11 Jul 2026 11:00:00 GMT')
		expect(cachedAgeMs(cached, NOW)).toBe(60 * 60 * 1000)
		expect(isFreshEnough(cached, NOW)).toBe(true)
	})

	test('a copy cached two weeks ago must NOT be served as current', () => {
		const cached = responseDated('Sat, 27 Jun 2026 12:00:00 GMT')
		expect(isFreshEnough(cached, NOW)).toBe(false)
	})

	test('the cutoff is exactly MAX_STALE_SERVE_MS', () => {
		const justInside = responseDated('Thu, 09 Jul 2026 12:00:01 GMT')
		const justOutside = responseDated('Thu, 09 Jul 2026 12:00:00 GMT')
		expect(isFreshEnough(justInside, NOW)).toBe(true)
		expect(cachedAgeMs(justOutside, NOW)).toBe(MAX_STALE_SERVE_MS)
		expect(isFreshEnough(justOutside, NOW)).toBe(false)
	})

	test('a missing or malformed Date header is treated as too old, not fresh', () => {
		expect(cachedAgeMs(responseDated(null), NOW)).toBe(Infinity)
		expect(isFreshEnough(responseDated(null), NOW)).toBe(false)
		expect(isFreshEnough(responseDated('not-a-date'), NOW)).toBe(false)
	})

	test('clock skew (Date slightly in the future) still counts as fresh', () => {
		const cached = responseDated('Sat, 11 Jul 2026 12:00:30 GMT')
		expect(isFreshEnough(cached, NOW)).toBe(true)
	})
})

/**
 * Runtime harness: drive the REAL staleWhileRevalidate/staleWhileRevalidateData
 * from sw.js with stubbed `caches`/`fetch`/`setTimeout`, so the serve-order
 * policy (fresh → instant cached; stale → network wins only with renderable
 * content, while hangs/5xx/redirect-shapes lose; miss → network else fallback)
 * is pinned by tests — the pure-helper tests above can't catch a reverted
 * `isFreshEnough` gate or a broken fallback chain.
 */
function loadServiceWorkerRuntime(
	currentAssetPaths = ['/assets/current-build.js'],
	publicAssetVersion = 'test-public',
) {
	const swPath = fileURLToPath(new URL('../../public/sw.js', import.meta.url))
	const source = readFileSync(swPath, 'utf8')
		.replace(
			"'__QM_CLIENT_ASSET_PATHS__'",
			currentAssetPaths
				.map((assetPath) => JSON.stringify(assetPath))
				.join(', '),
		)
		.replace("'__QM_START_URL__'", JSON.stringify(WEBMANIFEST_START_URL))
		.replace(
			"'__QM_PUBLIC_ASSET_VERSION__'",
			JSON.stringify(publicAssetVersion),
		)

	// Timers registered by the SW's stale-path grace race. Tests fire them
	// manually; nothing in the sandbox advances time on its own.
	const timers: Array<{ fn: () => void; ms: number }> = []
	const listeners: Record<string, (event: any) => void> = {}
	const sandbox: Record<string, any> = {
		self: {
			location: { origin: 'https://quartermaster.test' },
			clients: { claim: async () => {} },
			skipWaiting: () => {},
			addEventListener: (type: string, listener: (event: any) => void) => {
				listeners[type] = listener
			},
		},
		Response,
		Headers,
		Request,
		URL,
		setTimeout: (fn: () => void, ms: number) => {
			timers.push({ fn, ms })
			return 0
		},
		// caches/fetch are installed per scenario; sw.js resolves them at call
		// time through the context's global scope.
		caches: undefined,
		fetch: undefined,
	}
	vm.createContext(sandbox)
	vm.runInContext(
		`${source}\n;self.__runtime = { cacheFirst, networkFirst, staleWhileRevalidate, staleWhileRevalidateData, rootNavigation, networkWithOfflineFallback, isCurrentBuildAsset, STATIC_CACHE, PUBLIC_CACHE, PAGES_CACHE, FONTS_CACHE, MAX_FONTS, START_URL };`,
		sandbox,
	)
	return {
		sandbox,
		timers,
		listeners,
		runtime: sandbox.self.__runtime as {
			cacheFirst: (
				event: unknown,
				request: unknown,
				cacheName: string,
				maxEntries?: number,
			) => Promise<Response>
			networkFirst: (
				event: unknown,
				request: Request,
				cacheName: string,
				maxEntries?: number,
			) => Promise<Response>
			staleWhileRevalidate: (
				event: unknown,
				request: unknown,
				cacheName: string,
				maxEntries: number,
			) => Promise<Response>
			staleWhileRevalidateData: (
				event: unknown,
				request: unknown,
				cacheName: string,
				maxEntries: number,
			) => Promise<Response>
			rootNavigation: (request: unknown) => Promise<Response>
			networkWithOfflineFallback: (request: unknown) => Promise<Response>
			isCurrentBuildAsset: (url: URL) => boolean
			STATIC_CACHE: string
			PUBLIC_CACHE: string
			PAGES_CACHE: string
			FONTS_CACHE: string
			MAX_FONTS: number
			START_URL: string
		},
	}
}

describe('service-worker lifecycle and navigation fallbacks', () => {
	test('each deploy prunes stale assets and keeps the font cache bounded', async () => {
		const cacheNames = new Set([
			'qm-static-v0',
			'qm-static-v1',
			'qm-public-old',
			// Pre-#106 page/data caches: version-bumped away because their cached
			// loader payloads no longer match the deployed shapes.
			'qm-pages-v1',
			'qm-data-v1-user-household',
			'qm-pages-v2',
			'qm-images-v1',
			'qm-fonts-v1',
			'qm-data-v2-user-household',
		])
		const staticEntryUrls = new Set([
			'https://quartermaster.test/assets/shared.js',
			'https://quartermaster.test/assets/build-a.js',
			'https://quartermaster.test/assets/shared.js?v=stale',
			'https://quartermaster.test/favicon.ico',
		])
		const fontEntries = new Set(
			Array.from(
				{ length: 18 },
				(_, index) => `https://fonts.gstatic.com/font-${index}.woff2`,
			),
		)

		for (const buildVersion of ['b', 'c', 'd']) {
			const currentAssetPaths = [
				'/assets/shared.js',
				`/assets/build-${buildVersion}.js`,
			]
			staticEntryUrls.add(
				`https://quartermaster.test/assets/build-${buildVersion}.js`,
			)
			const { sandbox, listeners, runtime } = loadServiceWorkerRuntime(
				currentAssetPaths,
				`public-${buildVersion}`,
			)
			cacheNames.add(runtime.PUBLIC_CACHE)
			let claimed = false
			sandbox.self.clients.claim = async () => {
				claimed = true
			}
			sandbox.caches = {
				keys: async () => [...cacheNames],
				delete: async (cacheName: string) => cacheNames.delete(cacheName),
				open: async (cacheName: string) => {
					if (cacheName === runtime.STATIC_CACHE) {
						return {
							keys: async () => [...staticEntryUrls].map((url) => ({ url })),
							delete: async (request: { url: string }) => {
								staticEntryUrls.delete(request.url)
								return true
							},
						}
					}
					if (cacheName === runtime.FONTS_CACHE) {
						return {
							keys: async () => [...fontEntries],
							delete: async (entry: string) => {
								fontEntries.delete(entry)
								return true
							},
						}
					}
					throw new Error(`Unexpected cache ${cacheName}`)
				},
			}

			let lifetime: Promise<unknown> | undefined
			listeners.activate?.({
				waitUntil: (promise: Promise<unknown>) => {
					lifetime = promise
				},
			})
			await lifetime

			expect(staticEntryUrls).toEqual(
				new Set([
					...currentAssetPaths.map(
						(pathname) => `https://quartermaster.test${pathname}`,
					),
				]),
			)
			expect(
				[...cacheNames].filter((cacheName) =>
					cacheName.startsWith('qm-public-'),
				),
			).toEqual([runtime.PUBLIC_CACHE])
			expect(fontEntries.size).toBe(runtime.MAX_FONTS)
			expect(claimed).toBe(true)
		}
		expect(cacheNames.has('qm-static-v0')).toBe(false)
		expect(cacheNames.has('qm-pages-v1')).toBe(false)
		expect(cacheNames.has('qm-data-v1-user-household')).toBe(false)
		expect(cacheNames.has('qm-pages-v2')).toBe(true)
		expect(cacheNames.has('qm-data-v2-user-household')).toBe(true)
	})

	test('only exact current-build asset URLs are cacheable', () => {
		const { runtime } = loadServiceWorkerRuntime(['/assets/current.js'])

		expect(
			runtime.isCurrentBuildAsset(
				new URL('https://quartermaster.test/assets/current.js'),
			),
		).toBe(true)
		expect(
			runtime.isCurrentBuildAsset(
				new URL('https://quartermaster.test/assets/current.js?v=duplicate'),
			),
		).toBe(false)
		expect(
			runtime.isCurrentBuildAsset(
				new URL('https://quartermaster.test/assets/old-build.js'),
			),
		).toBe(false)
	})

	test('offline root launch redirects to the manifest start URL', async () => {
		const { sandbox, runtime } = loadServiceWorkerRuntime()
		sandbox.fetch = () => Promise.reject(new Error('offline'))

		const response = await runtime.rootNavigation('/')

		expect(runtime.START_URL).toBe(WEBMANIFEST_START_URL)
		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe(
			`https://quartermaster.test${WEBMANIFEST_START_URL}`,
		)
	})

	test('an uncached Pantry navigation gets the app fallback offline', async () => {
		const { sandbox, listeners } = loadServiceWorkerRuntime()
		sandbox.fetch = () => Promise.reject(new Error('offline'))
		sandbox.caches = {
			open: async () => ({
				match: async () => undefined,
				put: async () => {},
				keys: async () => [],
				delete: async () => true,
			}),
		}

		let responsePromise: Promise<Response> | undefined
		const waited: Array<Promise<unknown>> = []
		listeners.fetch?.({
			request: {
				method: 'GET',
				mode: 'navigate',
				url: 'https://quartermaster.test/inventory',
			},
			respondWith: (promise: Promise<Response>) => {
				responsePromise = promise
			},
			waitUntil: (promise: Promise<unknown>) => waited.push(promise),
		})

		const response = await responsePromise!
		await Promise.all(waited)
		expect(response.status).toBe(503)
		expect(response.headers.get('content-type')).toContain('text/html')
	})

	test.each(['/settings/profile', '/login'])(
		'offline navigation to %s gets the app fallback',
		async (pathname) => {
			const { sandbox, listeners } = loadServiceWorkerRuntime()
			sandbox.fetch = () => Promise.reject(new Error('offline'))

			let responsePromise: Promise<Response> | undefined
			listeners.fetch?.({
				request: {
					method: 'GET',
					mode: 'navigate',
					url: `https://quartermaster.test${pathname}`,
				},
				respondWith: (promise: Promise<Response>) => {
					responsePromise = promise
				},
			})

			const response = await responsePromise!
			expect(response.status).toBe(503)
			expect(response.headers.get('content-type')).toContain('text/html')
			expect(await response.text()).toContain("You're offline")
		},
	)
})

describe('SWR runtime serve order (stubbed caches/fetch)', () => {
	const { sandbox, timers, runtime } = loadServiceWorkerRuntime()

	const bodyWithAge = (body: string, ageMs: number, status = 200) =>
		new Response(body, {
			status,
			headers: { date: new Date(Date.now() - ageMs).toUTCString() },
		})
	const FRESH_MS = 60 * 1000
	// Comfortably past the 48h MAX_STALE_SERVE_MS cutoff.
	const STALE_MS = 72 * 60 * 60 * 1000

	function scenario({
		cached,
		network,
	}: {
		cached: Response | undefined
		network: 'hang' | 'reject' | Response
	}) {
		timers.length = 0
		const puts: Array<Response> = []
		const cacheStub = {
			match: async () => cached,
			put: async (_req: unknown, res: Response) => {
				puts.push(res)
			},
			keys: async () => [],
			delete: async () => true,
		}
		sandbox.caches = { open: async () => cacheStub }
		sandbox.fetch = () =>
			network === 'hang'
				? new Promise(() => {})
				: network === 'reject'
					? Promise.reject(new Error('network down'))
					: Promise.resolve(network)
		const waited: Array<Promise<unknown>> = []
		const event = { waitUntil: (p: Promise<unknown>) => waited.push(p) }
		return { event, puts, waited }
	}

	const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

	test('fresh cached copy is served instantly, without touching the network', async () => {
		const { event, waited } = scenario({
			cached: bodyWithAge('CACHED', FRESH_MS),
			network: 'hang',
		})
		const res = await runtime.staleWhileRevalidate(event, '/plan', 'pages', 50)
		expect(await res.text()).toBe('CACHED')
		// The instant path never builds the grace race…
		expect(timers).toHaveLength(0)
		// …but the background refresh is still kept alive on every path.
		expect(waited).toHaveLength(1)
	})

	test('cache-first keeps its cache write and trim alive', async () => {
		const { event, puts, waited } = scenario({
			cached: undefined,
			network: bodyWithAge('NETWORK', 0),
		})
		const response = await runtime.cacheFirst(event, '/asset.js', 'static', 50)

		expect(await response.text()).toBe('NETWORK')
		expect(waited).toHaveLength(1)
		await Promise.all(waited)
		expect(puts).toHaveLength(1)
	})

	test('network-first keeps its cache write and trim alive', async () => {
		const { event, puts, waited } = scenario({
			cached: undefined,
			network: bodyWithAge('NETWORK', 0),
		})
		const request = new Request('https://quartermaster.test/shopping.data')
		const response = await runtime.networkFirst(event, request, 'data', 64)

		expect(await response.text()).toBe('NETWORK')
		expect(waited).toHaveLength(1)
		await Promise.all(waited)
		expect(puts).toHaveLength(1)
	})

	test('stale cached copy is NOT served when the network answers healthy (the bounded-staleness gate)', async () => {
		const { event, puts } = scenario({
			cached: bodyWithAge('CACHED', STALE_MS),
			network: bodyWithAge('NETWORK', 0),
		})
		const res = await runtime.staleWhileRevalidate(event, '/plan', 'pages', 50)
		expect(await res.text()).toBe('NETWORK')
		await flush()
		expect(puts).toHaveLength(1)
	})

	test('stale cached copy beats a 5xx from the origin', async () => {
		const { event, puts, waited } = scenario({
			cached: bodyWithAge('CACHED', STALE_MS),
			network: bodyWithAge('BOOM', 0, 503),
		})
		const res = await runtime.staleWhileRevalidate(event, '/plan', 'pages', 50)
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('CACHED')
		// The error page must never poison the cache under a fresh Date header.
		await flush()
		expect(puts).toHaveLength(0)
		expect(waited).toHaveLength(1)
	})

	test('stale cached copy beats a rejected fetch (offline)', async () => {
		const { event } = scenario({
			cached: bodyWithAge('CACHED', STALE_MS),
			network: 'reject',
		})
		const res = await runtime.staleWhileRevalidate(event, '/plan', 'pages', 50)
		expect(await res.text()).toBe('CACHED')
	})

	test('stale cached copy is served after the grace timeout when the network hangs', async () => {
		const { event, waited } = scenario({
			cached: bodyWithAge('CACHED', STALE_MS),
			network: 'hang',
		})
		const pending = runtime.staleWhileRevalidate(event, '/plan', 'pages', 50)
		await flush()
		expect(timers).toHaveLength(1)
		expect(timers[0]!.ms).toBe(3_000)
		timers[0]!.fn()
		const res = await pending
		expect(await res.text()).toBe('CACHED')
		// The still-pending refresh stays owned by waitUntil, not dropped.
		expect(waited).toHaveLength(1)
	})

	test('cache miss + network failure yields the offline fallback (HTML page for documents, bare 503 for .data)', async () => {
		const doc = scenario({ cached: undefined, network: 'reject' })
		const docRes = await runtime.staleWhileRevalidate(
			doc.event,
			'/plan',
			'pages',
			50,
		)
		expect(docRes.status).toBe(503)
		expect(docRes.headers.get('content-type')).toContain('text/html')

		const data = scenario({ cached: undefined, network: 'reject' })
		const dataRes = await runtime.staleWhileRevalidateData(
			data.event,
			'/plan.data',
			'data',
			64,
		)
		expect(dataRes.status).toBe(503)
		expect(await dataRes.text()).toBe('Offline')
	})

	test('.data variant passes RR7 202 in-band redirects through without caching them', async () => {
		const { event, puts } = scenario({
			cached: bodyWithAge('CACHED', STALE_MS),
			network: bodyWithAge('REDIRECT-PAYLOAD', 0, 202),
		})
		const res = await runtime.staleWhileRevalidateData(
			event,
			'/plan.data',
			'data',
			64,
		)
		// A 202 is a real navigation outcome (session expired), not a failure —
		// it must reach React Router, but must never be cached.
		expect(res.status).toBe(202)
		await flush()
		expect(puts).toHaveLength(0)
	})

	test('a fast navigation redirect (opaqueredirect, status 0) does not displace a stale copy', async () => {
		// A captive portal answers navigations with an instant 302, which a
		// redirect:"manual" navigation fetch surfaces as an opaqueredirect.
		// Response can't construct status 0, so a minimal stand-in carries the
		// fields the SW reads.
		const opaqueRedirect = {
			status: 0,
			ok: false,
			redirected: false,
			type: 'opaqueredirect',
		} as unknown as Response
		const { event, puts } = scenario({
			cached: bodyWithAge('CACHED', STALE_MS),
			network: opaqueRedirect,
		})
		const res = await runtime.staleWhileRevalidate(event, '/plan', 'pages', 50)
		expect(await res.text()).toBe('CACHED')
		await flush()
		expect(puts).toHaveLength(0)
	})

	test('.data: a followed redirect (portal/proxy HTML) does not displace a stale copy', async () => {
		// .data fetches follow redirects, so a captive portal shows up as a 200
		// with redirected:true — never a valid turbo-stream payload.
		const portal = bodyWithAge('PORTAL-HTML', 0)
		Object.defineProperty(portal, 'redirected', { value: true })
		const { event, puts } = scenario({
			cached: bodyWithAge('CACHED', STALE_MS),
			network: portal,
		})
		const res = await runtime.staleWhileRevalidateData(
			event,
			'/plan.data',
			'data',
			64,
		)
		expect(await res.text()).toBe('CACHED')
		await flush()
		expect(puts).toHaveLength(0)
	})
})
