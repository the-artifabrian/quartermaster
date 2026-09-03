/// <reference lib="webworker" />

const STATIC_CACHE = 'qm-static-v1'
const IMAGES_CACHE = 'qm-images-v1'
const FONTS_CACHE = 'qm-fonts-v1'
const CACHE_VERSION = '__QM_CACHE_VERSION__'
const PUBLIC_CACHE = `qm-public-${CACHE_VERSION}`

// The build replaces this sentinel with every file in build/client/assets.
// Embedding the list also changes sw.js whenever the hashed asset set changes,
// which makes the browser install a new worker and run the activate-time prune.
const CURRENT_ASSET_PATHS = new Set(['__QM_CLIENT_ASSET_PATHS__'])
// Keep the offline root bridge coupled to the PWA manifest instead of copying
// its start_url by hand. The build replaces this sentinel too.
const START_URL = '__QM_START_URL__'

const MAX_IMAGES = 100
const MAX_DATA = 64
const MAX_FONTS = 16

// Per-session (user+household) cache for authenticated `.data` (RR7 single-fetch).
// The SW can't read the httpOnly session cookie, so the client posts an opaque
// `<userId>-<householdId>` token after hydration. Until that token is known,
// `.data` is network-only — never served or written from cache — so one
// household's data can never be served to another on a shared device.
// The build-derived generation prevents an older payload shape from hydrating a
// newer client without relying on a manually bumped cache version.
const DATA_CACHE_ROOT = 'qm-data-'
const DATA_CACHE_PREFIX = `${DATA_CACHE_ROOT}${CACHE_VERSION}-`
let dataCacheName = null
let dataCacheEpoch = 0

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
							k !== IMAGES_CACHE &&
							k !== FONTS_CACHE &&
							k !== PUBLIC_CACHE &&
							// Current-generation `.data` caches are reaped once the page
							// identifies its live session; older generations are deleted here.
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
//  - qm-data-session {token}: adopt the `<userId>-<householdId>` namespace and
//    reap every other personalized data cache.
//  - qm-data-purge: logout — forget the namespace and reap all `.data` caches.
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
		dataCacheName = next
		dataCacheEpoch++
		event.waitUntil(reapDataCaches(next))
	} else if (msg.type === 'qm-data-purge') {
		dataCacheName = null
		dataCacheEpoch++
		event.waitUntil(reapDataCaches(null))
	} else if (msg.type === 'qm-data-invalidate') {
		if (dataCacheName) {
			dataCacheEpoch++
			event.waitUntil(caches.delete(dataCacheName))
		}
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

	// ── Web manifest (network-first with cached offline fallback) ──
	if (url.pathname === '/site.webmanifest') {
		if (url.search === '') {
			event.respondWith(networkFirstManifest(event, request))
		}
		return
	}

	// ── Favicons & splash screens (cache-first) ────────────────
	if (
		url.pathname.startsWith('/favicons/') ||
		url.pathname.startsWith('/splash/') ||
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

	// ── Root navigation: bridge to the manifest start URL when offline ──
	// An already-installed app may still launch "/" until iOS re-reads a changed
	// manifest. Online, "/" redirects. Offline, redirect to the manifest-derived
	// start URL; its normal navigation handler then serves the offline response.
	if (request.mode === 'navigate' && url.pathname === '/') {
		event.respondWith(rootNavigation(request))
		return
	}

	// ── Eligible Route data ──────────────────────────────────────
	// Authenticated `.data` (RR single-fetch) is always network-first and cached
	// only in the current session/Household namespace. A cache entry can answer a
	// transport failure, but an origin response — including auth redirects and
	// 4xx/5xx errors — always reaches React Router unchanged. Until the client has
	// supplied a namespace, `.data` remains network-only.
	// Each entry is keyed by its exact URL (including any ?_routes), so a cached
	// payload always matches the shape React Router asked for.
	if (isEligibleRouteData(url)) {
		if (!dataCacheName) {
			event.respondWith(networkOnlyData(request))
			return
		}
		event.respondWith(
			networkFirstData(event, request, dataCacheName, dataCacheEpoch, MAX_DATA),
		)
		return
	}

	// Every same-origin document is network-only. Personalized HTML is never
	// retained in Cache Storage; an offline navigation receives the safe,
	// non-personalized app response instead of browser chrome or another session.
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
		// updates the URL; the follow-up navigation receives offlineFallback.
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
 * Determine if a URL represents authenticated Route data eligible for the
 * session-scoped offline fallback.
 * Matches:
 *   /recipes.data
 *   /recipes/<id>.data (but not form/edit routes)
 *   /plan.data, /shopping.data, /inventory.data
 */
function isEligibleRouteData(url) {
	const p = url.pathname

	if (p === '/recipes.data') return true
	if (p === '/plan.data') return true
	if (p === '/shopping.data') return true
	if (p === '/inventory.data') return true

	// Recipe detail data, excluding named form routes and deeper edit routes.
	const recipeFormRoutes = new Set(['new', 'import', 'quick', 'bulk-import'])
	const recipeMatch = p.match(/^\/recipes\/([^/]+)\.data$/)
	if (recipeMatch) {
		const id = recipeMatch[1]
		if (!recipeFormRoutes.has(id)) return true
	}

	return false
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

/** Fetch fresh install metadata, falling back to this build's cached copy offline. */
async function networkFirstManifest(event, request) {
	try {
		const response = await fetch(request)
		const contentType = response.headers.get('Content-Type')?.toLowerCase()
		if (
			response.status === 200 &&
			!response.redirected &&
			(contentType?.startsWith('application/manifest+json') ||
				contentType?.startsWith('application/json'))
		) {
			const cacheResponse = response.clone()
			event.waitUntil(cacheManifest(request, cacheResponse))
		}
		return response
	} catch {
		try {
			const cache = await caches.open(PUBLIC_CACHE)
			const cached = await cache.match(request)
			if (cached) return cached
		} catch {
			// Cache Storage is best-effort; its failure is an ordinary offline miss.
		}
		return new Response('Offline', { status: 503 })
	}
}

/** Keep cache failures from changing a successful manifest response. */
async function cacheManifest(request, response) {
	try {
		const cache = await caches.open(PUBLIC_CACHE)
		await cache.put(request, response)
	} catch {
		// Quota pressure or a killed write must not fail the network response.
	}
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

/** Network-first Route data: use this session's cache only on transport failure. */
async function networkFirstData(
	event,
	request,
	cacheName,
	cacheEpoch,
	maxEntries,
) {
	try {
		const response = await fetch(request)
		// Only cache a plain 200. A React Router single-fetch redirect rides in-band
		// on a 202 body (.ok, not .redirected), and a followed HTTP redirect or
		// captive-portal response has redirected=true. Neither may be replayed.
		if (
			response.status === 200 &&
			!response.redirected &&
			response.headers
				.get('Content-Type')
				?.toLowerCase()
				.startsWith('text/x-script')
		) {
			// Reserve the cache body before yielding; the client may start consuming
			// the returned response while Cache Storage is still opening.
			const cacheResponse = response.clone()
			event.waitUntil(
				putCurrentData(
					request,
					cacheResponse,
					cacheName,
					cacheEpoch,
					maxEntries,
				),
			)
		}
		return response
	} catch {
		// A session switch, logout, or mutation can happen while fetch is pending.
		// Never answer from (or recreate) the namespace that was current at dispatch.
		if (cacheName !== dataCacheName || cacheEpoch !== dataCacheEpoch) {
			return new Response('Offline', { status: 503 })
		}
		try {
			const cache = await caches.open(cacheName)
			const cached = await cache.match(request)
			if (
				cached &&
				cacheName === dataCacheName &&
				cacheEpoch === dataCacheEpoch
			) {
				return cached
			}
		} catch {
			// Cache Storage is best-effort; its failure is an ordinary offline miss.
		}

		return new Response('Offline', { status: 503 })
	}
}

/** Cache data only while the dispatching session/epoch is still current. */
async function putCurrentData(
	request,
	response,
	cacheName,
	cacheEpoch,
	maxEntries,
) {
	if (cacheName !== dataCacheName || cacheEpoch !== dataCacheEpoch) return
	try {
		const cache = await caches.open(cacheName)
		if (cacheName !== dataCacheName || cacheEpoch !== dataCacheEpoch) {
			await caches.delete(cacheName)
			return
		}
		await putAndTrim(cache, request, response, cacheName, maxEntries)
		if (cacheName !== dataCacheName || cacheEpoch !== dataCacheEpoch) {
			await caches.delete(cacheName)
		}
	} catch {
		// Cache Storage failure must not affect the response already returned.
	}
}

/** Minimal offline fallback page. */
function offlineFallback() {
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#f6f1eb" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#1a1816" media="(prefers-color-scheme: dark)" />
<title>Offline — Quartermaster</title>
<style>
  :root { color-scheme: light dark; --canvas: #f6f1eb; --text: #2d2926;
          --muted: #6f6358; }
  @media (prefers-color-scheme: dark) {
    :root { --canvas: #1a1816; --text: #e2dbd1; --muted: #b5a99b; }
  }
  html { background: var(--canvas); }
  body { font-family: system-ui, sans-serif; display: flex; align-items: center;
         justify-content: center; min-height: 100vh; margin: 0;
         box-sizing: border-box; background: var(--canvas); color: var(--text);
         text-align: center; padding: 2rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  p { color: var(--muted); max-width: 28rem; }
</style>
</head>
<body>
  <div>
    <h1>You're offline</h1>
    <p>Connect to the internet and try again.</p>
  </div>
</body>
</html>`

	return new Response(html, {
		status: 503,
		headers: {
			'Cache-Control': 'no-store',
			'Content-Type': 'text/html; charset=utf-8',
		},
	})
}

/** Delete every per-session `.data` cache except `keep` (null deletes them all). */
async function reapDataCaches(keep) {
	const keys = await caches.keys()
	await Promise.all(
		keys
			.filter((k) => k.startsWith(DATA_CACHE_ROOT) && k !== keep)
			.map((k) => caches.delete(k)),
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
