import { useEffect, useRef } from 'react'
import { useLocation, useRevalidator } from 'react-router'
import { type LoaderCacheOptions, loaderCache } from './loader-cache.ts'

/**
 * Revalidates once when the route's loader data came from the loader cache, so
 * the page shows the stored data at once and fresh data right after it. Data
 * that did not come from the cache (the server-rendered first page) is
 * remembered for the next visit. Pass the same options as the route's
 * `staleWhileRevalidate`.
 *
 * It also watches every revalidation on the page, whoever started it: its own,
 * pull to refresh, Shopping's live refresh, a bulk add. A navigation aborts a
 * revalidation in flight, and one that loads nothing (Plan's day tap changes
 * only view-only params) brings no fresh data either. So a revalidation that
 * ended in a new location (a new location key, which every navigation gets,
 * replace included) with the page's data unchanged runs again. A revalidation
 * that ends on the location it started from is never repeated, so a route
 * whose loader skips a plain revalidation cannot make this loop.
 *
 * Offline, the revalidation waits for the browser's `online` event. It would
 * fail, and the root loader it re-runs has no offline copy, so the failure
 * would replace the whole app with the root error page.
 */
export function useStaleRevalidate(
	loaderData: unknown,
	options?: LoaderCacheOptions,
) {
	const { revalidate, state } = useRevalidator()
	const { pathname, search, key } = useLocation()
	const href = pathname + search
	// Acts once per data object, so a URL change that kept the data (no loader
	// ran) never files it under the new URL.
	const handled = useRef<unknown>(undefined)
	const viewOnlyParams = options?.viewOnlyParams

	const waitingForNetwork = useRef(false)
	useEffect(() => {
		if (handled.current === loaderData) return
		handled.current = loaderData
		waitingForNetwork.current = false
		if (!loaderCache.takeServedFromCache(loaderData)) {
			loaderCache.remember(href, loaderData, { viewOnlyParams })
			return
		}
		if (!navigator.onLine) {
			waitingForNetwork.current = true
			return
		}
		void revalidate()
	}, [loaderData, href, revalidate, viewOnlyParams])

	useEffect(() => {
		const onOnline = () => {
			if (!waitingForNetwork.current) return
			waitingForNetwork.current = false
			void revalidate()
		}
		window.addEventListener('online', onOnline)
		return () => window.removeEventListener('online', onOnline)
	}, [revalidate])

	// The data and location the page showed while a revalidation was loading.
	// Read from rendered state, not from the promise `revalidate` returns: that
	// settles before React renders what the router loaded.
	const revalidatingFrom = useRef<{ data: unknown; key: string } | null>(null)
	useEffect(() => {
		if (state === 'loading') {
			revalidatingFrom.current = { data: loaderData, key }
			return
		}
		const from = revalidatingFrom.current
		revalidatingFrom.current = null
		if (from && from.data === loaderData && from.key !== key) {
			void revalidate()
		}
	}, [state, loaderData, key, revalidate])
}
