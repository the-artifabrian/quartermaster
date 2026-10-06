import { useEffect, useRef } from 'react'
import { useLocation, useRevalidator } from 'react-router'
import { type LoaderCacheOptions, loaderCache } from './loader-cache.ts'

/**
 * Revalidates once when the route's loader data came from the loader cache, so
 * the page shows the stored data at once and fresh data right after it. Data
 * that did not come from the cache (the server-rendered first page) is
 * remembered for the next visit. Pass the same options as the route's
 * `staleWhileRevalidate`.
 */
export function useStaleRevalidate(
	loaderData: unknown,
	options?: LoaderCacheOptions,
) {
	const { revalidate } = useRevalidator()
	const { pathname, search } = useLocation()
	const href = pathname + search
	// Acts once per data object, so a URL change that kept the data (no loader
	// ran) never files it under the new URL.
	const handled = useRef<unknown>(undefined)
	const viewOnlyParams = options?.viewOnlyParams

	useEffect(() => {
		if (handled.current === loaderData) return
		handled.current = loaderData
		if (!loaderCache.takeServedFromCache(loaderData)) {
			loaderCache.remember(href, loaderData, { viewOnlyParams })
			return
		}
		void revalidate()
	}, [loaderData, href, revalidate, viewOnlyParams])
}
