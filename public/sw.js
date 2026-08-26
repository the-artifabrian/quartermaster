/// <reference lib="webworker" />

const STATIC_CACHE = 'qm-static-v1'
// v2: #106 changed loader-data shapes (shopping weeksWithPlans, plan Meals) —
// bump PAGES_CACHE/DATA_CACHE_PREFIX on every loader-shape deploy so a cached
// pre-deploy payload can't hydrate the new bundle.
const PAGES_CACHE = 'qm-pages-v7'
const IMAGES_CACHE = 'qm-images-v1'
const FONTS_CACHE = 'qm-fonts-v1'
const PUBLIC_ASSET_VERSION = '__QM_PUBLIC_ASSET_VERSION__'
const PUBLIC_CACHE = `qm-public-${PUBLIC_ASSET_VERSION}`

// The build replaces this sentinel with every file in build/client/assets.
// Embedding the list also changes sw.js whenever the hashed asset set changes,
// which makes the browser install a new worker and run the activate-time prune.
const CURRENT_ASSET_PATHS = new Set(['__QM_CLIENT_ASSET_PATHS__'])
// Keep the offline root bridge coupled to the PWA manifest instead of copying
// its start_url by hand. The build replaces this sentinel too.
const START_URL = '__QM_START_URL__'

const MAX_PAGES = 50
const MAX_IMAGES = 100
const MAX_DATA = 64
const MAX_FONTS = 16

// Stale-while-revalidate serves the cached copy and only refreshes the cache in
// the background, so the display is always one successful revalidation behind.
// Bounded staleness: beyond this age the cached copy may not be flashed as
// current (a two-week-old plan page reads as "this week") — prefer the network
// instead, using the stale copy as the fallback when the network hangs or
// errors. 48h, not 24h: daily use re-stamps each entry roughly every 24h, so a
// 24h cutoff would make every slightly-late daily launch pay the network wait.
const MAX_STALE_SERVE_MS = 48 * 60 * 60 * 1000

// How long a too-stale-to-flash cached copy waits for the network before being
// served anyway. A hung connection (captive portal, dead radio) must not blank
// a page we can render from cache; the refresh keeps running in the background.
const STALE_NETWORK_GRACE_MS = 3_000

// Per-session (user+household) cache for authenticated `.data` (RR7 single-fetch).
// The SW can't read the httpOnly session cookie, so the client posts an opaque
// `<userId>-<householdId>` token after hydration. Until that token is known,
// `.data` is network-only — never served or written from cache — so one
// household's data can never be served to another on a shared device.
const DATA_CACHE_PREFIX = 'qm-data-v7-'
let dataCacheName = null

// ── Install ─────────────────────────────────────────────────────────
self.addEventListener('install', () => {
	self.skipWaiting()
})

// ── Activate ────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys()
			await Promise.all([
				...keys
					.filter(
						(k) =>
							k.startsWith('qm-') &&
							k !== STATIC_CACHE &&
							k !== PAGES_CACHE &&
							k !== IMAGES_CACHE &&
							k !== FONTS_CACHE &&
							k !== PUBLIC_CACHE &&
							// Per-session `.data` caches are reaped on session change/logout,
							// not on activate (they outlive a SW update for the same user).
							!k.startsWith(DATA_CACHE_PREFIX),
					)
					.map((k) => caches.delete(k)),
				pruneStaticAssets(),
				// Google can change the font file URLs behind its stylesheet. Keep that
				// long-lived cross-deploy cache useful without letting it grow forever.
				trimCache(FONTS_CACHE, MAX_FONTS),
			])
			await self.clients.claim()
		})(),
	)
})

// ── Messages (session namespace + cache invalidation) ───────────────
// The client (ServiceWorkerDataSync) drives the per-session `.data` cache:
//  - qm-data-session {token}: adopt the `<userId>-<householdId>` namespace; on a
//    real switch, drop the previous session's cached authenticated documents too.
//  - qm-data-purge: logout — forget the namespace and reap all `.data` caches +
//    authenticated documents.
//  - qm-data-invalidate: after a mutation — drop this session's `.data` cache so
//    the next navigation refetches fresh.
self.addEventListener('message', (event) => {
	const msg = event.data
	if (!msg || typeof msg !== 'object') return

	if (
		msg.type === 'qm-data-session' &&
		typeof msg.token === 'string' &&
		msg.token
	) {
		const next = DATA_CACHE_PREFIX + msg.token
		if (next === dataCacheName) return
		// A non-null previous namespace means the user/household actually changed
		// (vs. a first sync or a post-restart re-sync for the same session).
		const switched = dataCacheName !== null
		dataCacheName = next
		event.waitUntil(
			Promise.all([
				reapDataCaches(next),
				switched ? purgeAuthenticatedPages() : Promise.resolve(),
			]),
		)
	} else if (msg.type === 'qm-data-purge') {
		dataCacheName = null
		event.waitUntil(
			Promise.all([reapDataCaches(null), purgeAuthenticatedPages()]),
		)
	} else if (msg.type === 'qm-data-invalidate') {
		if (dataCacheName) event.waitUntil(caches.delete(dataCacheName))
	}
})

// ── Notifications (kitchen timers) ──────────────────────────────────
// Timer-done notifications are shown by the page (timer-notifications.ts);
// tapping one should land back in the app, on an existing window if any.
self.addEventListener('notificationclick', (event) => {
	event.notification.close()
	event.waitUntil(
		self.clients
			.matchAll({ type: 'window', includeUncontrolled: true })
			.then((clientList) => {
				const client = clientList.find((c) => 'focus' in c)
				if (client) return client.focus()
				return self.clients.openWindow('/recipes')
			}),
	)
})

// ── Fetch ───────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
	const { request } = event
	if (request.method !== 'GET') return

	const url = new URL(request.url)

	// ── Google Fonts (cache-first) ───────────────────────────────
	// Must precede the same-origin guard below. The font stylesheet and files
	// are render-blocking and cross-origin, so without this they hit the network
	// on every cold launch — a major cause of slow first paint + white flash.
	// Caches opaque responses too (the stylesheet link is no-cors).
	if (
		url.hostname === 'fonts.googleapis.com' ||
		url.hostname === 'fonts.gstatic.com'
	) {
		event.respondWith(cacheFirst(event, request, FONTS_CACHE, MAX_FONTS))
		return
	}

	// Skip non-same-origin
	if (url.origin !== self.location.origin) return

	// Skip healthcheck
	if (url.pathname === '/resources/healthcheck') return

	// Skip auth / mutation routes
	const skipPaths = [
		'/login',
		'/signup',
		'/verify',
		'/onboarding',
		'/reset-password',
		'/forgot-password',
		'/resources/login',
		'/resources/verify',
	]
	if (skipPaths.some((p) => url.pathname.startsWith(p))) {
		if (request.mode === 'navigate') {
			event.respondWith(networkWithOfflineFallback(request))
		}
		return
	}

	// ── Static assets (cache-first) ──────────────────────────────
	if (url.pathname.startsWith('/assets/')) {
		// Only the exact URLs stamped from this build belong in the cache. Query
		// variants and old paths stay network-only, so they cannot grow or evict
		// the bounded current-build set between worker activations.
		if (isCurrentBuildAsset(url)) {
			event.respondWith(cacheFirst(event, request, STATIC_CACHE))
		}
		return
	}

	// ── Favicons, splash screens & webmanifest (cache-first) ────
	if (
		url.pathname.startsWith('/favicons/') ||
		url.pathname.startsWith('/splash/') ||
		url.pathname === '/site.webmanifest' ||
		url.pathname === '/favicon.ico'
	) {
		// These files are not content-hashed, so the build fingerprints their
		// cache as a generation. Query variants remain network-only and cannot
		// multiply entries inside one generation.
		if (url.search === '') {
			event.respondWith(cacheFirst(event, request, PUBLIC_CACHE))
		}
		return
	}

	// ── Recipe images (cache-first, capped) ──────────────────────
	if (
		url.pathname === '/resources/images' &&
		url.searchParams.has('objectKey')
	) {
		event.respondWith(cacheFirst(event, request, IMAGES_CACHE, MAX_IMAGES))
		return
	}

	// ── Root navigation: bridge to the cached start URL when offline ──
	// An already-installed app may still launch "/" until iOS re-reads a changed
	// manifest. Online, "/" redirects. Offline, redirect to the manifest-derived
	// start URL; its normal navigation handler can then serve the cached shell.
	if (request.mode === 'navigate' && url.pathname === '/') {
		event.respondWith(rootNavigation(request))
		return
	}

	// ── Cacheable pages ──────────────────────────────────────────
	// Document navigations use stale-while-revalidate: serve the cached page
	// instantly (fast cold launch, no white flash), then refresh in the background.
	//
	// `.data` (RR7 single-fetch) is authenticated + household-scoped, so it is
	// cached ONLY in the per-session namespace (dataCacheName), and only once the
	// client has told us that namespace:
	//   - read-mostly routes (recipes list/detail, plan, Pantry) → stale-while-revalidate
	//     (instant nav on a cold connection, then refresh) — the iOS-effective win —
	//     bounded by MAX_STALE_SERVE_MS so week-old data can't pose as current;
	//   - /shopping (edited daily) → network-first, with the session's own copy
	//     kept for offline;
	//   - namespace unknown (pre-hydration / logged out) → network-only, never
	//     served or written from cache (structural cross-household isolation).
	// Each entry is keyed by its exact URL (including any ?_routes), so a cached
	// payload always matches the shape RR7 asked for — no partial/full mismatch.
	if (isCacheablePage(url)) {
		if (!url.pathname.endsWith('.data')) {
			event.respondWith(
				staleWhileRevalidate(event, request, PAGES_CACHE, MAX_PAGES),
			)
			return
		}
		if (!dataCacheName) {
			event.respondWith(networkOnlyData(request))
			return
		}
		// Stale-while-revalidate is used ONLY for a read-mostly route requested as a
		// PARTIAL client navigation. RR7 appends ?_routes when the root opts out of
		// revalidation — i.e. an ordinary same-session tab nav, which is the
		// perf-critical cold-resume path the SWR win targets. A PLAIN .data request
		// (no ?_routes) is a FULL revalidation (a formAction redirect such as a
		// household switch, or a useRevalidator/theme-change refresh). Those can
		// straddle a session/household change before the post-commit client effect
		// has told us the new namespace, so they must never be served stale from the
		// previous session's cache. networkFirst keeps them fresh online (closing the
		// cross-household serve window) while still falling back to this session's
		// own cache when offline.
		const partialNav = url.searchParams.has('_routes')
		event.respondWith(
			isReadMostly(url) && partialNav
				? staleWhileRevalidateData(event, request, dataCacheName, MAX_DATA)
				: networkFirst(event, request, dataCacheName, MAX_DATA),
		)
		return
	}

	// Every other same-origin document remains network-only, but still gets the
	// app's offline response. Without this final navigation catch, an uncached
	// route falls through to Safari/Chrome's own connection-error page.
	if (request.mode === 'navigate') {
		event.respondWith(networkWithOfflineFallback(request))
	}
})

/** Root "/" navigation: try network, else redirect locally to the start URL. */
async function rootNavigation(request) {
	try {
		return await fetch(request)
	} catch {
		// Returning the cached start-url HTML directly leaves window.location at
		// "/", so the client router hydrates the wrong route. A synthetic redirect
		// updates the URL; the follow-up navigation is handled by the normal page
		// cache and falls back to offlineFallback when it has not been cached yet.
		return Response.redirect(new URL(START_URL, self.location.origin), 302)
	}
}

/** Network-only navigation with the app's HTML fallback when offline. */
async function networkWithOfflineFallback(request) {
	try {
		return await fetch(request)
	} catch {
		return offlineFallback()
	}
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Is this the exact, query-free URL of an asset in the current client build? */
function isCurrentBuildAsset(url) {
	return url.search === '' && CURRENT_ASSET_PATHS.has(url.pathname)
}

/**
 * Remove content-hashed assets absent from the current client build, plus
 * non-asset entries left in this formerly-mixed cache by older workers.
 */
async function pruneStaticAssets() {
	const cache = await caches.open(STATIC_CACHE)
	const keys = await cache.keys()
	await Promise.all(
		keys
			.filter((request) => {
				try {
					const url = new URL(request.url)
					if (!url.pathname.startsWith('/assets/')) return true
					return !isCurrentBuildAsset(url)
				} catch {
					return false
				}
			})
			.map((request) => cache.delete(request)),
	)
}

/**
 * Determine if a URL represents a page we want to cache.
 * Matches:
 *   /recipes       (the list page, but not /recipes/new, /recipes/import, etc.)
 *   /recipes/<id>  (but not /recipes/<id>/edit)
 *   /plan
 *   /shopping
 *   /inventory     (the user-facing Pantry tab)
 * Also matches the .data suffix variants for client-side navigations.
 */
function isCacheablePage(url) {
	const p = url.pathname

	// /recipes or /recipes.data (the list page itself, not its sub-routes like
	// /recipes/new, /recipes/import, /recipes/<id>, ...)
	if (p === '/recipes' || p === '/recipes.data') return true

	// /plan or /plan.data
	if (p === '/plan' || p === '/plan.data') return true

	// /shopping or /shopping.data
	if (p === '/shopping' || p === '/shopping.data') return true

	// /inventory or /inventory.data (the user-facing Pantry tab)
	if (p === '/inventory' || p === '/inventory.data') return true

	// /recipes/<id> (detail page) but not /recipes/<id>/edit and not the named
	// form sub-routes (new, import, generate, quick, bulk-import), which need the
	// network anyway and shouldn't be served stale from cache.
	const recipeFormRoutes = new Set([
		'new',
		'import',
		'generate',
		'quick',
		'bulk-import',
	])
	const recipeMatch = p.match(/^\/recipes\/([^/]+?)(\.data)?$/)
	if (recipeMatch) {
		const id = recipeMatch[1]
		if (!recipeFormRoutes.has(id) && !id.endsWith('.data')) return true
	}

	return false
}

/**
 * Age of a cached response in ms, derived from the `Date` header every response
 * stamped by the server (and Fly's proxy) carries. Returns Infinity when the
 * header is missing or unparseable, so an undatable entry is treated as too old
 * to serve as current rather than infinitely fresh.
 */
function cachedAgeMs(response, now = Date.now()) {
	const dateHeader = response.headers.get('date')
	if (!dateHeader) return Infinity
	const cachedAt = Date.parse(dateHeader)
	if (Number.isNaN(cachedAt)) return Infinity
	return now - cachedAt
}

/** May this cached copy still be flashed as current content? */
function isFreshEnough(response, now = Date.now()) {
	return cachedAgeMs(response, now) < MAX_STALE_SERVE_MS
}

/**
 * May a network response displace a stale-but-servable cached copy? Server
 * errors (5xx) lose, and so do redirect-shaped responses, which aren't
 * renderable content here: an opaqueredirect (status 0 — a navigation 3xx,
 * e.g. a captive portal grabbing the request) and a followed redirect
 * (redirected: true — for `.data` that is portal/proxy HTML, never a valid
 * turbo-stream payload). This gate only applies when a stale copy exists; on
 * a cache miss the network response passes through regardless. RR7's in-band
 * 202 redirect has none of those shapes and wins as a real navigation outcome.
 */
function beatsStaleCache(response) {
	return response.status < 500 && response.status !== 0 && !response.redirected
}

/**
 * Read-mostly cacheable routes (safe to serve stale-while-revalidate): the recipe
 * list/detail, plan, and Pantry. Excludes /shopping, which is edited daily and
 * stays network-first. Only called for URLs already known to be cacheable pages.
 */
function isReadMostly(url) {
	const p = url.pathname
	if (p === '/shopping' || p === '/shopping.data') return false
	return true
}

/**
 * Write a response and any follow-up trim as one promise. Callers attach this
 * promise to the fetch event so the worker cannot be terminated mid-write.
 */
async function putAndTrim(cache, request, response, cacheName, maxEntries) {
	try {
		await cache.put(request, response.clone())
		if (maxEntries) await trimCache(cacheName, maxEntries)
	} catch {
		// Quota pressure or a killed write must not fail the network response.
	}
}

/** Cache-first: return cached response, or fetch and cache. */
async function cacheFirst(event, request, cacheName, maxEntries) {
	const cache = await caches.open(cacheName)
	const cached = await cache.match(request)
	if (cached) return cached

	try {
		const response = await fetch(request)
		// Cache successful responses, plus opaque ones (status 0) — cross-origin
		// no-cors fonts come back opaque but are still safe to cache and reuse.
		if (response.ok || response.type === 'opaque') {
			event.waitUntil(
				putAndTrim(cache, request, response, cacheName, maxEntries),
			)
		}
		return response
	} catch {
		return new Response('Offline', { status: 503 })
	}
}

/**
 * Shared stale-while-revalidate core for documents and `.data` payloads:
 *   - cached copy fresher than MAX_STALE_SERVE_MS → served instantly, network
 *     refreshes the cache in the background;
 *   - stale cached copy → the network gets STALE_NETWORK_GRACE_MS to produce
 *     renderable content; on timeout, network failure, a 5xx, or a
 *     redirect-shaped response the stale copy is served instead (see
 *     beatsStaleCache — a hung origin, an error page, or a captive portal
 *     must not beat content we can render). RR7's 202 in-band redirect is a
 *     real navigation outcome and passes through untouched;
 *   - no cached copy → whatever the network produced, else makeFallback().
 * shouldCache decides what may be written to the cache (documents and .data
 * have different redirect-safety rules — see the two wrappers).
 */
async function staleWhileRevalidateCore(
	event,
	request,
	cacheName,
	maxEntries,
	shouldCache,
	makeFallback,
) {
	const cache = await caches.open(cacheName)
	const cached = await cache.match(request)

	const network = fetch(request).catch(() => null)
	// The background refresh must outlive this handler on EVERY path — iOS
	// kills idle workers aggressively, and a lost put strands the entry on its
	// old Date header (every later nav repeats the slow stale path). This
	// promise settles only once the body has fully streamed into the cache
	// (not at headers), so waitUntil genuinely covers the write.
	const revalidated = network.then(async (response) => {
		if (!response || !shouldCache(response)) return
		await putAndTrim(cache, request, response, cacheName, maxEntries)
	})
	event.waitUntil(revalidated)

	if (cached && isFreshEnough(cached)) return cached

	if (cached) {
		const response = await Promise.race([
			network,
			new Promise((resolve) =>
				setTimeout(() => resolve(null), STALE_NETWORK_GRACE_MS),
			),
		])
		return response && beatsStaleCache(response) ? response : cached
	}

	const response = await network
	return response ?? makeFallback()
}

/**
 * Stale-while-revalidate for document navigations. Never caches a redirected
 * response: browsers refuse to use one to satisfy a navigation, so a cached
 * redirect (e.g. an expired session sending /recipes → /login) would break the
 * next cold launch.
 */
async function staleWhileRevalidate(event, request, cacheName, maxEntries) {
	return staleWhileRevalidateCore(
		event,
		request,
		cacheName,
		maxEntries,
		(response) => response.ok && !response.redirected,
		offlineFallback,
	)
}

/**
 * Stale-while-revalidate tuned for `.data`: same core, but the total-failure
 * fallback is a bare 503 (not the offline HTML), so React Router shows its
 * ErrorBoundary instead of trying to parse HTML as a turbo-stream payload.
 * Only caches a plain 200: RR7 single-fetch encodes a loader/action redirect
 * (e.g. expired session → /login) as an IN-BAND turbo-stream body with status
 * 202 — which is `.ok` and NOT `.redirected`, so an `ok && !redirected` check
 * would happily cache it and then pin the route to /login on the next launch.
 * Requiring status === 200 rejects that 202 (and any 4xx/5xx); `!redirected`
 * still rejects followed 3xx. Caches by exact request URL (incl. any ?_routes)
 * so a served payload always matches the shape RR7 requested.
 */
async function staleWhileRevalidateData(event, request, cacheName, maxEntries) {
	return staleWhileRevalidateCore(
		event,
		request,
		cacheName,
		maxEntries,
		(response) => response.status === 200 && !response.redirected,
		() => new Response('Offline', { status: 503 }),
	)
}

/**
 * Network-only for `.data` when the per-session cache namespace isn't known yet
 * (pre-hydration or logged out): never read or write a cache, so one household's
 * data can never be served to another. 503 on failure → RR ErrorBoundary.
 */
async function networkOnlyData(request) {
	try {
		return await fetch(request)
	} catch {
		return new Response('Offline', { status: 503 })
	}
}

/** Network-first: try network, fall back to cache, then offline page. */
async function networkFirst(event, request, cacheName, maxEntries) {
	const cache = await caches.open(cacheName)

	try {
		const response = await fetch(request)
		// Only cache a plain 200 — see staleWhileRevalidateData: an RR7 single-fetch
		// redirect rides in-band on a 202 body (.ok, not .redirected), and a
		// redirected response can't satisfy a future navigation. Requiring 200
		// rejects both.
		if (response.status === 200 && !response.redirected) {
			event.waitUntil(
				putAndTrim(cache, request, response, cacheName, maxEntries),
			)
		}
		return response
	} catch {
		const cached = await cache.match(request)
		if (cached) return cached

		// For .data requests (RR7 Single Fetch), return a 503 so React Router
		// triggers its ErrorBoundary instead of trying to parse HTML as turbo-stream.
		const url = new URL(request.url)
		if (url.pathname.endsWith('.data')) {
			return new Response('Offline', { status: 503 })
		}

		return offlineFallback()
	}
}

/** Minimal offline fallback page. */
function offlineFallback() {
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Offline — Quartermaster</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center;
         justify-content: center; min-height: 100vh; margin: 0;
         background: #f8fafc; color: #1e293b; text-align: center; padding: 2rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  p { color: #64748b; max-width: 28rem; }
</style>
</head>
<body>
  <div>
    <h1>You're offline</h1>
    <p>This page isn't cached yet. Connect to the internet and try again, or go back to a page you've visited before.</p>
  </div>
</body>
</html>`

	return new Response(html, {
		status: 503,
		headers: { 'Content-Type': 'text/html; charset=utf-8' },
	})
}

/** Delete every per-session `.data` cache except `keep` (null deletes them all). */
async function reapDataCaches(keep) {
	const keys = await caches.keys()
	await Promise.all(
		keys
			.filter((k) => k.startsWith(DATA_CACHE_PREFIX) && k !== keep)
			.map((k) => caches.delete(k)),
	)
}

/**
 * Drop cached authenticated documents (and any `.data` that predates the
 * per-session cache) from PAGES_CACHE, so a prior session's server-rendered
 * shell can't be served after logout or a session switch.
 */
async function purgeAuthenticatedPages() {
	const cache = await caches.open(PAGES_CACHE)
	const keys = await cache.keys()
	await Promise.all(
		keys
			.filter((req) => {
				try {
					return isCacheablePage(new URL(req.url))
				} catch {
					return false
				}
			})
			.map((req) => cache.delete(req)),
	)
}

/** Trim a cache to maxEntries by deleting the oldest entries (FIFO). */
async function trimCache(cacheName, maxEntries) {
	const cache = await caches.open(cacheName)
	const keys = await cache.keys()
	if (keys.length > maxEntries) {
		await Promise.all(
			keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)),
		)
	}
}
