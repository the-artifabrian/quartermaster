/// <reference lib="webworker" />

const STATIC_CACHE = 'qm-static-v1'
const PAGES_CACHE = 'qm-pages-v1'
const IMAGES_CACHE = 'qm-images-v1'
const FONTS_CACHE = 'qm-fonts-v1'

const MAX_PAGES = 50
const MAX_IMAGES = 100
const MAX_DATA = 64

// Per-session (user+household) cache for authenticated `.data` (RR7 single-fetch).
// The SW can't read the httpOnly session cookie, so the client posts an opaque
// `<userId>-<householdId>` token after hydration. Until that token is known,
// `.data` is network-only — never served or written from cache — so one
// household's data can never be served to another on a shared device.
const DATA_CACHE_PREFIX = 'qm-data-v1-'
let dataCacheName = null

// ── Install ─────────────────────────────────────────────────────────
self.addEventListener('install', () => {
	self.skipWaiting()
})

// ── Activate ────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter(
							(k) =>
								k.startsWith('qm-') &&
								k !== STATIC_CACHE &&
								k !== PAGES_CACHE &&
								k !== IMAGES_CACHE &&
								k !== FONTS_CACHE &&
								// Per-session `.data` caches are reaped on session change/logout,
								// not on activate (they outlive a SW update for the same user).
								!k.startsWith(DATA_CACHE_PREFIX),
						)
						.map((k) => caches.delete(k)),
				),
			)
			.then(() => self.clients.claim()),
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

	if (msg.type === 'qm-data-session' && typeof msg.token === 'string' && msg.token) {
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
		event.respondWith(cacheFirst(request, FONTS_CACHE))
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
	if (skipPaths.some((p) => url.pathname.startsWith(p))) return

	// ── Static assets (cache-first) ──────────────────────────────
	if (url.pathname.startsWith('/assets/')) {
		event.respondWith(cacheFirst(request, STATIC_CACHE))
		return
	}

	// ── Favicons, splash screens & webmanifest (cache-first) ────
	if (
		url.pathname.startsWith('/favicons/') ||
		url.pathname.startsWith('/splash/') ||
		url.pathname === '/site.webmanifest' ||
		url.pathname === '/favicon.ico'
	) {
		event.respondWith(cacheFirst(request, STATIC_CACHE))
		return
	}

	// ── Recipe images (cache-first, capped) ──────────────────────
	if (
		url.pathname === '/resources/images' &&
		url.searchParams.has('objectKey')
	) {
		event.respondWith(cacheFirst(request, IMAGES_CACHE, MAX_IMAGES))
		return
	}

	// ── Root navigation: bridge to cached /recipes when offline ──
	// start_url is /recipes, but an already-installed app may still launch "/"
	// until iOS re-reads the manifest. Online, "/" redirects (to /recipes when
	// signed in). Offline, serve the cached /recipes shell so a cold launch lands
	// on usable content instead of the generic offline page.
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
	//   - read-mostly routes (recipes list/detail, plan) → stale-while-revalidate
	//     (instant nav on a cold connection, then refresh) — the iOS-effective win;
	//   - /shopping (edited daily) → network-first, with the session's own copy
	//     kept for offline;
	//   - namespace unknown (pre-hydration / logged out) → network-only, never
	//     served or written from cache (structural cross-household isolation).
	// Each entry is keyed by its exact URL (including any ?_routes), so a cached
	// payload always matches the shape RR7 asked for — no partial/full mismatch.
	if (isCacheablePage(url)) {
		if (!url.pathname.endsWith('.data')) {
			event.respondWith(staleWhileRevalidate(event, request, PAGES_CACHE, MAX_PAGES))
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
				: networkFirst(request, dataCacheName, MAX_DATA),
		)
		return
	}
})

/** Root "/" navigation: try network, else fall back to cached /recipes shell. */
async function rootNavigation(request) {
	try {
		return await fetch(request)
	} catch {
		const cache = await caches.open(PAGES_CACHE)
		const cached = await cache.match('/recipes')
		if (cached) return cached
		return offlineFallback()
	}
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Determine if a URL represents a page we want to cache.
 * Matches:
 *   /recipes       (the list page, but not /recipes/new, /recipes/import, etc.)
 *   /recipes/<id>  (but not /recipes/<id>/edit)
 *   /plan
 *   /shopping
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
 * Read-mostly cacheable routes (safe to serve stale-while-revalidate): the recipe
 * list/detail and the plan. Excludes /shopping, which is edited daily and stays
 * network-first. Only called for URLs already known to be cacheable pages.
 */
function isReadMostly(url) {
	const p = url.pathname
	if (p === '/shopping' || p === '/shopping.data') return false
	return true
}

/** Cache-first: return cached response, or fetch and cache. */
async function cacheFirst(request, cacheName, maxEntries) {
	const cache = await caches.open(cacheName)
	const cached = await cache.match(request)
	if (cached) return cached

	try {
		const response = await fetch(request)
		// Cache successful responses, plus opaque ones (status 0) — cross-origin
		// no-cors fonts come back opaque but are still safe to cache and reuse.
		if (response.ok || response.type === 'opaque') {
			cache.put(request, response.clone())
			if (maxEntries) trimCache(cacheName, maxEntries)
		}
		return response
	} catch {
		return new Response('Offline', { status: 503 })
	}
}

/**
 * Stale-while-revalidate: return the cached response immediately (instant
 * paint), while refreshing the cache from the network in the background. Falls
 * back to the network when there's no cache, and to the offline page on total
 * failure.
 */
async function staleWhileRevalidate(event, request, cacheName, maxEntries) {
	const cache = await caches.open(cacheName)
	const cached = await cache.match(request)

	const network = fetch(request)
		.then((response) => {
			// Never cache a redirected response: browsers refuse to use one to
			// satisfy a navigation, so a cached redirect (e.g. an expired session
			// sending /recipes → /login) would break the next cold launch.
			if (response.ok && !response.redirected) {
				cache.put(request, response.clone())
				if (maxEntries) trimCache(cacheName, maxEntries)
			}
			return response
		})
		.catch(() => null)

	if (cached) {
		// Keep the worker alive until the background refresh finishes, but we've
		// already served the cached response to the page.
		event.waitUntil(network)
		return cached
	}

	const response = await network
	return response ?? offlineFallback()
}

/**
 * Stale-while-revalidate tuned for `.data`: same as staleWhileRevalidate but on a
 * total miss+failure returns a 503 (not the offline HTML), so React Router shows
 * its ErrorBoundary instead of trying to parse HTML as a turbo-stream payload.
 * Caches by exact request URL (incl. any ?_routes) so a served payload always
 * matches the shape RR7 requested.
 */
async function staleWhileRevalidateData(event, request, cacheName, maxEntries) {
	const cache = await caches.open(cacheName)
	const cached = await cache.match(request)

	const network = fetch(request)
		.then((response) => {
			// Only cache a plain 200. RR7 single-fetch encodes a loader/action
			// redirect (e.g. expired session → /login) as an IN-BAND turbo-stream
			// body with status 202 — which is `.ok` and NOT `.redirected`, so an
			// `ok && !redirected` check would happily cache it and then pin the
			// route to /login on the next launch. Requiring status === 200 rejects
			// that 202 (and any 4xx/5xx); `!redirected` still rejects followed 3xx.
			if (response.status === 200 && !response.redirected) {
				cache.put(request, response.clone())
				if (maxEntries) trimCache(cacheName, maxEntries)
			}
			return response
		})
		.catch(() => null)

	if (cached) {
		event.waitUntil(network)
		return cached
	}

	const response = await network
	return response ?? new Response('Offline', { status: 503 })
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
async function networkFirst(request, cacheName, maxEntries) {
	const cache = await caches.open(cacheName)

	try {
		const response = await fetch(request)
		// Only cache a plain 200 — see staleWhileRevalidateData: an RR7 single-fetch
		// redirect rides in-band on a 202 body (.ok, not .redirected), and a
		// redirected response can't satisfy a future navigation. Requiring 200
		// rejects both.
		if (response.status === 200 && !response.redirected) {
			cache.put(request, response.clone())
			if (maxEntries) trimCache(cacheName, maxEntries)
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
