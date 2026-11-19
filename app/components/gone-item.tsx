import { useEffect } from 'react'
import {
	isRouteErrorResponse,
	replace,
	type DataStrategyResult,
	type MiddlewareFunction,
	useRevalidator,
} from 'react-router'
import {
	clearRefreshAfterTraversal,
	isHistoryTraversalTo,
	noteRefreshAfterTraversal,
} from '#app/utils/history-traversal.ts'

// A Recipe or Menu deleted here or by another member, or moved out of the
// Household, can still have entries in the history: behind a list a Delete
// returned to through another tab, from before a reload, from a link loop,
// or in a page the browser kept. Going back to one opens its list in that
// entry's place instead of a not-found page. A link or a deep link to a
// missing Recipe or Menu still says it is not found.

function isGone(result: DataStrategyResult) {
	return (
		result.type === 'error' &&
		isRouteErrorResponse(result.result) &&
		(result.result.status === 404 || result.result.status === 403)
	)
}

/**
 * Client middleware for a Recipe's or Menu's pages: a history traversal that
 * finds the item gone opens `list` in its entry's place, before anything of
 * the not-found page renders.
 */
export function goneItemMiddleware(
	list: string,
): MiddlewareFunction<Record<string, DataStrategyResult>> {
	return async ({ request }, next) => {
		const results = await next()
		if (request.method !== 'GET') return results
		if (!isHistoryTraversalTo(new URL(request.url))) return results
		if (Object.values(results).some(isGone)) throw replace(list)
		return results
	}
}

// Whether this document's own load has been looked at; once per document.
let documentLoadChecked = false

/**
 * A back or forward that loads a new document, or restores one the browser
 * kept (the back-forward cache), can show a page as it was: a Recipe deleted
 * or changed since. The page loads its data again once, as a traversal, so a
 * gone Recipe or Menu opens its list and a changed one shows what it is now.
 * Until then the kept page shows; no loading state for a moment's staleness.
 */
export function useRefreshAfterTraversal() {
	const revalidator = useRevalidator()
	useEffect(() => {
		const refresh = () => {
			const path = window.location.pathname + window.location.search
			noteRefreshAfterTraversal(path)
			void Promise.resolve(revalidator.revalidate()).finally(() =>
				clearRefreshAfterTraversal(path),
			)
		}
		if (!documentLoadChecked) {
			documentLoadChecked = true
			const load = performance.getEntriesByType?.('navigation')[0] as
				PerformanceNavigationTiming | undefined
			if (load?.type === 'back_forward') refresh()
		}
		const onPageShow = (event: PageTransitionEvent) => {
			if (event.persisted) refresh()
		}
		window.addEventListener('pageshow', onPageShow)
		return () => window.removeEventListener('pageshow', onPageShow)
	}, [revalidator])
}
