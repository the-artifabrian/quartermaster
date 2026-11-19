/**
 * The page a request was for, as a path to send someone back to after
 * signing in. React Router's data requests (a Save, a fetcher, a navigation's
 * loaders) ask for `<page>.data` (`<page>/_.data` for a path ending in a
 * slash) with its own `_routes` and `index` params; signing in must land on
 * the page, not on its data.
 */
export function pagePathOf(url: URL) {
	let pathname = url.pathname
	if (pathname.endsWith('/_.data'))
		pathname = pathname.slice(0, -'_.data'.length)
	else if (pathname.endsWith('.data'))
		pathname = pathname.slice(0, -'.data'.length)
	const params = new URLSearchParams(url.search)
	params.delete('_routes')
	if (params.get('index') === '') params.delete('index')
	const search = params.toString()
	return `${pathname}${search ? `?${search}` : ''}`
}
