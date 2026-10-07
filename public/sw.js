/// <reference lib="webworker" />

const STATIC_CACHE_ROOT = 'qm-static-'
const IMAGES_CACHE = 'qm-images-v1'
const CACHE_VERSION = '__QM_CACHE_VERSION__'
const STATIC_CACHE = `${STATIC_CACHE_ROOT}${CACHE_VERSION}`
const PUBLIC_CACHE = `qm-public-${CACHE_VERSION}`
const CACHE_STATE = 'qm-cache-state-v1'
const ACTIVE_STATIC_CACHE_KEY = '/__qm-active-static-cache__'

// The build replaces this sentinel with every file in build/client/assets.
// Embedding the list also changes sw.js whenever the hashed asset set changes,
// which makes the browser install a new worker. After activation the worker
// warms every JavaScript file on the list into that build's isolated cache (see
// warmCurrentAssets), so a tab whose route module was never loaded still opens
// offline. Assets a page requests first are cached on demand as before.
const CURRENT_ASSET_PATHS = new Set(['__QM_CLIENT_ASSET_PATHS__'])
// Keep the offline root bridge coupled to the PWA manifest instead of copying
// its start_url by hand. The build replaces this sentinel too.
const START_URL = '__QM_START_URL__'

const MAX_IMAGES = 100
const MAX_DATA = 64
const WARM_CONCURRENCY = 6
const SESSION_REQUEST_TIMEOUT_MS = 500

// Per-session (user+household) cache for authenticated `.data` (RR7 single-fetch).
// The SW can't read the httpOnly session cookie, so the client posts an opaque
// `<userId>-<householdId>` token after hydration. Until that token is known,
// `.data` goes to the network and is never written to a cache, so one
// household's data can never be served to another on a shared device.
// The token lives only in memory. The browser can stop an idle worker while its
// page stays open (#315); the fresh worker knows no session. When such a
// worker's network request fails, it asks the page that sent the request for
// its token (askPageForSession) and, given one, adopts it exactly as the
// qm-data-session message does: it serves only that page's cache and reaps
// every other. A page that answers null, or not within SESSION_REQUEST_TIMEOUT_MS,
// gets the 503 as before. Online, nothing is asked.
// The build-derived generation prevents an older payload shape from hydrating a
// newer client without relying on a manually bumped cache version.
const DATA_CACHE_ROOT = 'qm-data-'
const DATA_CACHE_PREFIX = `${DATA_CACHE_ROOT}${CACHE_VERSION}-`
let dataCacheName = null
let dataCacheEpoch = 0

// ── Activate ────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const previousStaticCache = await getActiveStaticCache()
			if ('navigationPreload' in self.registration) {
				try {
					await self.registration.navigationPreload.enable()
				} catch {
					// Optional preload support must not prevent worker activation.
				}
			}
			const keys = await caches.keys()
			const retainedStaticCaches = new Set([
				STATIC_CACHE,
				...(previousStaticCache && previousStaticCache !== STATIC_CACHE
					? [previousStaticCache]
					: []),
			])
			await Promise.all([
				// Create this generation only after activation. A waiting worker never
				// downloads assets or mutates the cache state used by active pages.
				caches.open(STATIC_CACHE),
				...keys
					.filter(
						(k) =>
							k.startsWith('qm-') &&
							k !== CACHE_STATE &&
							!retainedStaticCaches.has(k) &&
							k !== IMAGES_CACHE &&
							k !== PUBLIC_CACHE &&
							// Current-generation `.data` caches are reaped once the page
							// identifies its live session; older generations are deleted here.
							!k.startsWith(DATA_CACHE_PREFIX),
					)
					.map((k) => caches.delete(k)),
			])
			await setActiveStaticCache(STATIC_CACHE)
			// Fetch events wait for activation to settle, so warming here would hold
			// every request behind a couple of megabytes of downloads. Start it after
			// and do not wait. A worker stopped mid-warm resumes when the next page
			// load posts qm-warm-assets.
			void warmCurrentAssets()
		})(),
	)
})

// ── Messages (updates + session namespace + cache invalidation) ─────
// The client (ServiceWorkerDataSync) drives the per-session `.data` cache:
//  - qm-data-session {token}: adopt the `<userId>-<householdId>` namespace and
//    reap every other personalized data cache.
//  - qm-data-purge: logout — forget the namespace and reap all `.data` caches.
//  - qm-data-invalidate: after a mutation — drop this session's `.data` cache so
//    the next navigation refetches fresh.
//  - qm-warm-assets: once per page load — finish warming this build's chunks.
self.addEventListener('message', (event) => {
	const msg = event.data
	if (!msg || typeof msg !== 'object') return

	if (msg.type === 'qm-activate-update') {
		event.waitUntil(self.skipWaiting())
	} else if (msg.type === 'qm-warm-assets') {
		event.waitUntil(warmCurrentAssets())
	} else if (msg.type === 'qm-data-session' && isSessionToken(msg.token)) {
		const reaping = adoptDataSession(msg.token)
		if (reaping) event.waitUntil(reaping)
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

// ── Fetch ───────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
	const { request } = event
	if (request.method !== 'GET') return

	const url = new URL(request.url)

	// Skip non-same-origin
	if (url.origin !== self.location.origin) return

	// ── Document navigations (network-first with Navigation Preload) ──
	// Handle every same-origin navigation before URL-specific resource policies.
	// A top-level visit to an asset-like URL is still a document navigation, and
	// must consume its preload instead of starting a duplicate request.
	if (request.mode === 'navigate') {
		event.respondWith(
			url.pathname === '/'
				? rootNavigation(request, event.preloadResponse)
				: networkWithOfflineFallback(request, event.preloadResponse),
		)
		return
	}

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
		return
	}

	// ── Static assets (cache-first) ──────────────────────────────
	if (url.pathname.startsWith('/assets/')) {
		// Query variants stay network-only. Exact current-build assets use this
		// generation; an old client may still read a content-hashed asset from the
		// retained active generation after another window accepts an update.
		if (url.search === '') {
			event.respondWith(staticAsset(event, request, url))
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

	// ── Eligible Route data ──────────────────────────────────────
	// Authenticated `.data` (RR single-fetch) is always network-first and cached
	// only in the current session/Household namespace. A cache entry can answer a
	// transport failure, but an origin response — including auth redirects and
	// 4xx/5xx errors — always reaches React Router unchanged. Until the client has
	// supplied a namespace, `.data` is network-only, except that a transport
	// failure asks the requesting page for its namespace (see unknownSessionData).
	// Each entry is keyed by its URL (including any ?_routes), so a cached
	// payload always matches the shape React Router asked for. For Plan the key
	// leaves out its view-only params and sorts the rest of the search (see
	// dataCacheKey); its loader never reads them.
	if (isEligibleRouteData(url)) {
		if (!dataCacheName) {
			event.respondWith(unknownSessionData(event, request))
			return
		}
		event.respondWith(
			networkFirstData(event, request, dataCacheName, dataCacheEpoch, MAX_DATA),
		)
		return
	}
})

/** Prefer a navigation preload, then issue the ordinary request if unavailable. */
async function preloadOrFetch(request, preloadResponse) {
	try {
		const response = await preloadResponse
		if (response) return response
	} catch {
		// A failed preload is optional optimization failure, not an offline signal.
	}
	return fetch(request)
}

/** Root "/" navigation: try network, else redirect locally to the start URL. */
async function rootNavigation(request, preloadResponse) {
	try {
		return await preloadOrFetch(request, preloadResponse)
	} catch {
		// Returning the cached start-url HTML directly leaves window.location at
		// "/", so the client router hydrates the wrong route. A synthetic redirect
		// updates the URL; the follow-up navigation receives offlineFallback.
		return Response.redirect(new URL(START_URL, self.location.origin), 302)
	}
}

/** Network-only navigation with the app's HTML fallback when offline. */
async function networkWithOfflineFallback(request, preloadResponse) {
	try {
		return await preloadOrFetch(request, preloadResponse)
	} catch {
		return offlineFallback()
	}
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Is this the exact, query-free URL of an asset in the current client build? */
function isCurrentBuildAsset(url) {
	return url.search === '' && CURRENT_ASSET_PATHS.has(url.pathname)
}

/** Read the generation owned by the worker that was active before activation. */
async function getActiveStaticCache() {
	try {
		const state = await caches.open(CACHE_STATE)
		const response = await state.match(ACTIVE_STATIC_CACHE_KEY)
		const cacheName = response ? await response.text() : null
		if (cacheName?.startsWith(STATIC_CACHE_ROOT)) return cacheName
	} catch {
		// Fall through to the legacy migration below.
	}

	// The first versioned-cache deployment has no marker. Preserve the newest
	// existing static cache as its N-1 bridge (normally the legacy qm-static-v1).
	const keys = await caches.keys()
	const candidates = keys.filter(
		(key) => key.startsWith(STATIC_CACHE_ROOT) && key !== STATIC_CACHE,
	)
	return candidates.length ? candidates[candidates.length - 1] : null
}

/** Mark this build as active for the next waiting generation. */
async function setActiveStaticCache(cacheName) {
	const state = await caches.open(CACHE_STATE)
	await state.put(ACTIVE_STATIC_CACHE_KEY, new Response(cacheName))
}

/** Serve current assets from N and old-client assets from the retained N-1. */
async function staticAsset(event, request, url) {
	if (isCurrentBuildAsset(url)) {
		const current = await caches.open(STATIC_CACHE)
		const cached = await current.match(request)
		if (cached) return cached

		// A content-identical URL may already exist in N-1. Promote it into N so
		// the current generation remains complete when N-1 is retired.
		const previous = await matchPreviousStaticAsset(request)
		if (previous) {
			event.waitUntil(putAndTrim(current, request, previous, STATIC_CACHE))
			return previous
		}

		const response = await fetch(request)
		if (response.ok) {
			event.waitUntil(putAndTrim(current, request, response, STATIC_CACHE))
		}
		return response
	}

	return (await matchPreviousStaticAsset(request)) ?? fetch(request)
}

/**
 * Put every JavaScript file of the current build in its static cache, so any
 * route module can load offline. Fonts and CSS arrive with the document. A file
 * already cached is skipped, one N-1 holds is promoted, and the rest are
 * fetched a few at a time. Failures are left for the on-demand path. Activation
 * and a page's qm-warm-assets can ask at once; they share one run.
 */
let warming = null
function warmCurrentAssets() {
	warming ??= fillStaticCache().finally(() => {
		warming = null
	})
	return warming
}

async function fillStaticCache() {
	try {
		const cache = await caches.open(STATIC_CACHE)
		const queue = [...CURRENT_ASSET_PATHS].filter((path) =>
			path.endsWith('.js'),
		)
		const warmNext = async () => {
			while (queue.length) {
				const path = queue.shift()
				try {
					if (await cache.match(path)) continue
					const response =
						(await matchPreviousStaticAsset(path)) ?? (await fetch(path))
					if (response.ok) await putAndTrim(cache, path, response, STATIC_CACHE)
				} catch {
					// Offline or evicted; the on-demand path tries again.
				}
			}
		}
		await Promise.allSettled(
			Array.from({ length: WARM_CONCURRENCY }, () => warmNext()),
		)
	} catch {
		// Cache Storage is best-effort.
	}
}

async function matchPreviousStaticAsset(request) {
	try {
		const keys = await caches.keys()
		const candidates = keys.filter(
			(key) => key.startsWith(STATIC_CACHE_ROOT) && key !== STATIC_CACHE,
		)
		for (let index = candidates.length - 1; index >= 0; index--) {
			const cached = await (await caches.open(candidates[index])).match(request)
			if (cached) return cached
		}
	} catch {
		// Cache Storage is best-effort; fall through to the network.
	}
	return null
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
 * `.data` while the per-session cache namespace isn't known (pre-hydration,
 * logged out, or a restarted worker): the network, never written to a cache.
 * On a transport failure, ask the requesting page for its session and, given
 * one, continue as that session. Otherwise 503 → the Route's ErrorBoundary.
 */
async function unknownSessionData(event, request) {
	try {
		return await fetch(request)
	} catch {
		// Asked below.
	}
	const epoch = dataCacheEpoch
	const token = await askPageForSession(event)
	if (token && epoch === dataCacheEpoch) {
		const reaping = adoptDataSession(token)
		if (reaping) event.waitUntil(reaping)
	}
	// A logout or another session that arrived during the wait wins.
	if (token && dataCacheName === DATA_CACHE_PREFIX + token) {
		return networkFirstData(
			event,
			request,
			dataCacheName,
			dataCacheEpoch,
			MAX_DATA,
		)
	}
	return new Response('Offline', { status: 503 })
}

function isSessionToken(token) {
	return typeof token === 'string' && token !== ''
}

/** Use the `<userId>-<householdId>` namespace; returns the reap, if any. */
function adoptDataSession(token) {
	const next = DATA_CACHE_PREFIX + token
	if (next === dataCacheName) return null
	dataCacheName = next
	dataCacheEpoch++
	return reapDataCaches(next)
}

/**
 * Ask the page behind a fetch for its session token over a MessageChannel.
 * Resolves null when there is no such page, it is signed out, or it does not
 * answer in time. The token is kept in memory only, as from qm-data-session.
 */
async function askPageForSession(event) {
	let channel = null
	try {
		const client =
			(event.clientId && (await self.clients.get(event.clientId))) ||
			(event.resultingClientId &&
				(await self.clients.get(event.resultingClientId)))
		if (!client) return null
		channel = new MessageChannel()
		const port = channel.port1
		return await new Promise((resolve) => {
			const timer = setTimeout(() => resolve(null), SESSION_REQUEST_TIMEOUT_MS)
			port.onmessage = (message) => {
				clearTimeout(timer)
				const token = message.data?.token
				resolve(isSessionToken(token) ? token : null)
			}
			client.postMessage({ type: 'qm-data-session-request' }, [channel.port2])
		})
	} catch {
		return null
	} finally {
		channel?.port1.close()
	}
}

// Plan's selected day and Meal link only pick what the page shows
// (PLAN_VIEW_ONLY_PARAMS in app/utils/plan-day-param.ts, which the cache-policy
// test checks against), so Plan data is keyed without them: offline, any day of
// a cached week falls back to it.
const PLAN_VIEW_ONLY_PARAMS = ['day', 'mealId']

/** The Cache Storage key for Route data: its URL, Plan's without view params. */
function dataCacheKey(request) {
	const url = new URL(request.url)
	if (url.pathname !== '/plan.data') return request
	for (const name of PLAN_VIEW_ONLY_PARAMS) url.searchParams.delete(name)
	url.searchParams.sort()
	return url.href
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
					dataCacheKey(request),
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
			const cached = await cache.match(dataCacheKey(request))
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
