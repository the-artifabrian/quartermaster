/// <reference lib="webworker" />

const STATIC_CACHE = 'qm-static-v1'
const PAGES_CACHE = 'qm-pages-v1'
const IMAGES_CACHE = 'qm-images-v1'
const FONTS_CACHE = 'qm-fonts-v1'

const MAX_PAGES = 50
const MAX_IMAGES = 100

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
								k !== FONTS_CACHE,
						)
						.map((k) => caches.delete(k)),
				),
			)
			.then(() => self.clients.claim()),
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
	// instantly (fast cold launch, no white flash), then refresh the cache in
	// the background. Data requests (.data, RR7 single-fetch) stay network-first
	// so client-side navigations always render fresh data, falling back to cache
	// only when offline.
	if (isCacheablePage(url)) {
		const isData = url.pathname.endsWith('.data')
		event.respondWith(
			isData
				? networkFirst(request, PAGES_CACHE, MAX_PAGES)
				: staleWhileRevalidate(event, request, PAGES_CACHE, MAX_PAGES),
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

/** Network-first: try network, fall back to cache, then offline page. */
async function networkFirst(request, cacheName, maxEntries) {
	const cache = await caches.open(cacheName)

	try {
		const response = await fetch(request)
		// See staleWhileRevalidate: a redirected response can't satisfy a future
		// navigation, so don't cache one.
		if (response.ok && !response.redirected) {
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
