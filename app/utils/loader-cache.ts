import { isRouteErrorResponse } from 'react-router'

/**
 * Stale-while-revalidate memory for route loader data.
 *
 * A route's `clientLoader` hands its arguments to `load`. A navigation to a URL
 * loaded before gets the stored data at once, and the page then revalidates
 * once behind it (see `useStaleRevalidate`). A load of the URL the page is
 * already on (any revalidation: after an action, a fetcher, pull to refresh)
 * always asks the server and refills the entry.
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

export function createLoaderCache({
	maxEntries = 32,
	reportError,
}: {
	maxEntries?: number
	reportError: (error: unknown) => void
}) {
	let identity: string | null = null
	// Orders loads, so a response that started before a clear, or before a newer
	// response for the same URL, cannot overwrite what came after it.
	let seq = 0
	let clearedAt = 0
	// Map iteration order is insertion order: the first key is the least
	// recently used.
	const entries = new Map<string, Entry>()
	const servedFromCache = new WeakSet<object>()
	const backgroundRevalidations = new Set<string>()

	function keyFor(href: string) {
		return identity == null ? null : `${identity}\n${href}`
	}

	function hrefOf(request: Request) {
		const url = new URL(request.url)
		return url.pathname + url.search
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
		backgroundRevalidations.clear()
		clearedAt = ++seq
	}

	return {
		/** The signed-in user and Household; null when signed out or unknown. */
		setIdentity(next: string | null) {
			if (next === identity) return
			identity = next
			clear()
		},

		clear,

		/**
		 * `currentHref` is the pathname and search of the page the user is on. The
		 * cache answers only a load of some other URL, which is a navigation.
		 */
		async load<T>(
			{ request, serverLoader }: LoaderArgs<T>,
			currentHref: string,
		): Promise<T> {
			const href = hrefOf(request)
			const key = keyFor(href)
			if (key == null) return serverLoader()

			if (href !== currentHref) {
				const hit = read(key)
				if (hit) {
					if (typeof hit.data === 'object' && hit.data !== null) {
						servedFromCache.add(hit.data)
					}
					return hit.data as T
				}
			}

			const background = backgroundRevalidations.delete(key)
			const startedAt = ++seq
			try {
				const data = await serverLoader()
				store(key, data, startedAt)
				return data
			} catch (error) {
				if (request.signal.aborted) throw error
				const stale = entries.get(key)
				entries.delete(key)
				// A redirect or an error response is the server's real answer for this
				// URL now, so it replaces the page. Anything else (the network, a
				// server fault) on a background revalidation leaves the page the user
				// is reading in place; the next navigation goes to the server and uses
				// the route's normal error path.
				const isAnswer =
					error instanceof Response || isRouteErrorResponse(error)
				if (background && stale && !isAnswer) {
					reportError(error)
					if (typeof stale.data === 'object' && stale.data !== null) {
						servedFromCache.delete(stale.data)
					}
					return stale.data as T
				}
				throw error
			}
		},

		/**
		 * Stores data the page rendered without a load storing it: the first,
		 * server-rendered page. An entry a load stored is newer and stays.
		 */
		remember(href: string, data: unknown) {
			const key = keyFor(href)
			if (key == null || entries.has(key)) return
			store(key, data, ++seq)
		},

		/** Whether `load` would answer this request from the cache. */
		willServe(request: Request, currentHref: string) {
			const href = hrefOf(request)
			const key = keyFor(href)
			return key != null && href !== currentHref && entries.has(key)
		},

		/**
		 * True once for data that `load` served from the cache, so the page that
		 * shows it revalidates exactly once.
		 */
		takeServedFromCache(data: unknown) {
			if (typeof data !== 'object' || data === null) return false
			return servedFromCache.delete(data)
		},

		/**
		 * Marks the next load of `href` as the revalidation behind cached data, so
		 * a network failure keeps the page rather than replacing it with an error.
		 */
		markBackgroundRevalidation(href: string) {
			const key = keyFor(href)
			if (key != null) backgroundRevalidations.add(key)
		},
	}
}

export type LoaderCache = ReturnType<typeof createLoaderCache>

export const loaderCache = createLoaderCache({
	reportError: (error) => {
		// reportError surfaces it like an uncaught error (console and PostHog's
		// exception autocapture) without breaking the page.
		if (typeof globalThis.reportError === 'function') {
			globalThis.reportError(error)
		} else {
			console.error(error)
		}
	},
})

function currentHref() {
	return window.location.pathname + window.location.search
}

/**
 * The body of a route's `clientLoader` (with `clientLoader.hydrate = false`, so
 * the first load always renders server data). Passes the server result
 * through unchanged.
 */
export function staleWhileRevalidate<T>(args: LoaderArgs<T>): Promise<T> {
	return loaderCache.load(args, currentHref())
}

/** For a parent route whose loader only guards: the child page is cached. */
export function willServeFromCache(request: Request) {
	return loaderCache.willServe(request, currentHref())
}
