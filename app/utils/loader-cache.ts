/**
 * Stale-while-revalidate memory for route loader data.
 *
 * A route's `clientLoader` hands its arguments to `load`. A navigation to a URL
 * loaded before gets the stored data at once, and the page then revalidates
 * once behind it (see `useStaleRevalidate`). A load of the URL the page is
 * already on (any revalidation: after an action, a fetcher, pull to refresh)
 * always asks the server and refills the entry.
 *
 * "The URL the page is on" is the router's committed location, not
 * `window.location`: on back and forward the browser shows the target URL
 * before the loaders run, and that navigation should still be instant.
 *
 * A route whose search has params its loader never reads (Plan's selected day)
 * names them in `viewOnlyParams`, so the URL is compared and keyed without
 * them: the entry for a week is served whichever day the URL shows.
 *
 * Entries are keyed by the signed-in user and Household as well as the URL,
 * and a change of either drops them all, so one Household's data is never
 * served to another on a shared device. Every mutation drops them too.
 */

type LoaderArgs<T> = {
	request: Request
	serverLoader: () => Promise<T>
}

type Entry = { data: unknown; seq: number }

export type LoaderCacheOptions = {
	/** Search params the loader never reads; the URL is keyed without them. */
	viewOnlyParams?: readonly string[]
}

/**
 * `href` (a pathname and search) without the view-only params, the rest of the
 * search sorted: two URLs that load the same data give the same string.
 */
export function withoutViewOnlyParams(
	href: string,
	viewOnlyParams: readonly string[],
) {
	const url = new URL(href, 'http://cache.invalid')
	for (const name of viewOnlyParams) url.searchParams.delete(name)
	url.searchParams.sort()
	return url.pathname + url.search
}

/**
 * The pathname and search a URL is keyed and compared by. Without view-only
 * params that is the URL as it is.
 */
function cacheHref(href: string, { viewOnlyParams }: LoaderCacheOptions = {}) {
	return viewOnlyParams?.length
		? withoutViewOnlyParams(href, viewOnlyParams)
		: href
}

function isObject(value: unknown): value is object {
	return typeof value === 'object' && value !== null
}

export function createLoaderCache({ maxEntries = 32 } = {}) {
	let identity: string | null = null
	let location: string | null = null
	// Orders loads, so a response that started before a clear, or before a newer
	// response for the same URL, cannot overwrite what came after it.
	let seq = 0
	let clearedAt = 0
	// Map iteration order is insertion order: the first key is the least
	// recently used.
	const entries = new Map<string, Entry>()
	const servedFromCache = new WeakSet<object>()
	// Everything `load` returned. `remember` is only for data that never passed
	// through it (the server-rendered first page), so it cannot store a response
	// that `load` refused after a clear.
	const loaded = new WeakSet<object>()

	function keyFor(href: string) {
		return identity == null ? null : `${identity}\n${href}`
	}

	function read(key: string) {
		const entry = entries.get(key)
		if (!entry) return undefined
		entries.delete(key)
		entries.set(key, entry)
		return entry
	}

	function store(key: string, data: unknown, startedAt: number) {
		if (startedAt <= clearedAt) return
		const existing = entries.get(key)
		if (existing && existing.seq > startedAt) return
		entries.delete(key)
		entries.set(key, { data, seq: startedAt })
		while (entries.size > maxEntries) {
			const oldest = entries.keys().next().value
			if (oldest === undefined) break
			entries.delete(oldest)
		}
	}

	function clear() {
		entries.clear()
		clearedAt = ++seq
	}

	return {
		/** The signed-in user and Household; null when signed out or unknown. */
		setIdentity(next: string | null) {
			if (next === identity) return
			identity = next
			clear()
		},

		/** The pathname and search of the router's committed location. */
		setLocation(href: string | null) {
			location = href
		},

		clear,

		async load<T>(
			{ request, serverLoader }: LoaderArgs<T>,
			options?: LoaderCacheOptions,
		): Promise<T> {
			const url = new URL(request.url)
			const href = cacheHref(url.pathname + url.search, options)
			const key = keyFor(href)
			if (key == null) return serverLoader()

			// Only a navigation, a load of some other URL than the committed one,
			// may be answered from memory. Before the first commit nothing is known,
			// so everything goes to the server.
			if (location != null && href !== cacheHref(location, options)) {
				const hit = read(key)
				if (hit) {
					if (isObject(hit.data)) {
						servedFromCache.add(hit.data)
						loaded.add(hit.data)
					}
					return hit.data as T
				}
			}

			const startedAt = ++seq
			try {
				const data = await serverLoader()
				if (isObject(data)) loaded.add(data)
				store(key, data, startedAt)
				return data
			} catch (error) {
				// The server's answer for this URL is now an error or a redirect, so
				// no stale page stays behind for the next navigation. An abort (the
				// user went elsewhere) says nothing about the entry.
				if (!request.signal.aborted) entries.delete(key)
				throw error
			}
		},

		/**
		 * Stores data the page rendered without `load` returning it: the first,
		 * server-rendered page. An entry a load stored is newer and stays.
		 */
		remember(href: string, data: unknown, options?: LoaderCacheOptions) {
			if (isObject(data) && loaded.has(data)) return
			const key = keyFor(cacheHref(href, options))
			if (key == null || entries.has(key)) return
			store(key, data, ++seq)
		},

		/**
		 * True once for data that `load` served from the cache, so the page that
		 * shows it revalidates exactly once.
		 */
		takeServedFromCache(data: unknown) {
			if (!isObject(data)) return false
			return servedFromCache.delete(data)
		},
	}
}

export type LoaderCache = ReturnType<typeof createLoaderCache>

export const loaderCache = createLoaderCache()

/**
 * The body of a route's `clientLoader` (with `clientLoader.hydrate = false`, so
 * the first load always renders server data). Passes the server result
 * through unchanged.
 */
export function staleWhileRevalidate<T>(
	args: LoaderArgs<T>,
	options?: LoaderCacheOptions,
): Promise<T> {
	return loaderCache.load(args, options)
}
