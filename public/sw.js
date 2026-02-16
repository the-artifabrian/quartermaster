/// <reference lib="webworker" />

const STATIC_CACHE = 'qm-static-v1'
const PAGES_CACHE = 'qm-pages-v1'
const IMAGES_CACHE = 'qm-images-v1'

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
								k !== IMAGES_CACHE,
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

	// ── Cacheable pages (network-first) ──────────────────────────
	if (isCacheablePage(url)) {
		event.respondWith(networkFirst(request, PAGES_CACHE, MAX_PAGES))
		return
	}
})

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Determine if a URL represents a page we want to cache.
 * Matches:
 *   /recipes/<id>  (but not /recipes, /recipes/new, /recipes/<id>/edit)
 *   /plan
 *   /plan/shopping-list
 * Also matches the .data suffix variants for client-side navigations.
 */
function isCacheablePage(url) {
	const p = url.pathname

	// /plan or /plan.data
	if (p === '/plan' || p === '/plan.data') return true

	// /plan/shopping-list or /plan/shopping-list.data
	if (p === '/plan/shopping-list' || p === '/plan/shopping-list.data')
		return true

	// /recipes/<id> but not /recipes, /recipes/new, /recipes/<id>/edit
	const recipeMatch = p.match(/^\/recipes\/([^/]+?)(\.data)?$/)
	if (recipeMatch) {
		const id = recipeMatch[1]
		if (id !== 'new' && !id.endsWith('.data')) return true
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
		if (response.ok) {
			cache.put(request, response.clone())
			if (maxEntries) trimCache(cacheName, maxEntries)
		}
		return response
	} catch {
		return new Response('Offline', { status: 503 })
	}
}

/** Network-first: try network, fall back to cache, then offline page. */
async function networkFirst(request, cacheName, maxEntries) {
	const cache = await caches.open(cacheName)

	try {
		const response = await fetch(request)
		if (response.ok) {
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
