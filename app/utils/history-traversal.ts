/**
 * Whether the router is loading a page because of a history traversal (back
 * or forward), not a link, a redirect or a revalidation. Going back to a
 * Recipe or Menu that is gone opens its list instead (gone-item.tsx); a link
 * to one still says it is not found.
 *
 * The browser moves the address bar before a pop's loaders run, while a
 * push's run before it changes. So a traversal is a popstate to the URL the
 * address bar shows, until the router commits it, and not to the page already
 * showing: that popstate is the router going forward again after holding a
 * pop (an edit screen asking first). A refresh after a back that loaded a new
 * document or restored one from the back-forward cache counts too, while it
 * runs.
 */

let traversalTo: string | null = null
let committed: string | null = null
// The page a traversal committed, until the next commit: a page that showed
// its stored data (loader-cache.ts) refreshes it right after, and that
// refresh is the traversal's load.
let landed: string | null = null
let refreshing: string | null = null

const pathOf = (url: { pathname: string; search: string }) =>
	url.pathname + url.search

export function notePopState(target: string) {
	traversalTo = target
}

export function noteCommit(path: string) {
	landed = traversalTo === path && path !== committed ? path : null
	committed = path
	traversalTo = null
}

/** Whether the page showing at `path` was reached by a back or forward. */
export function wasLandedByTraversal(path: string) {
	return landed === path
}

export function noteRefreshAfterTraversal(path: string) {
	refreshing = path
}

export function clearRefreshAfterTraversal(path: string) {
	if (refreshing === path) refreshing = null
}

export function isHistoryTraversalTo(url: URL) {
	if (typeof window === 'undefined') return false
	const target = pathOf(url)
	if (pathOf(window.location) !== target) return false
	if (refreshing === target) return true
	return traversalTo === target && target !== committed
}
