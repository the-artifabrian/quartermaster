/**
 * The page a share sheet hands to `/recipes/import?url=…`, or null when there
 * is none to fetch. Only an absolute http(s) URL counts, so a bad or missing
 * value leaves the import page as it is. The first `url` param wins, and the
 * value is returned as shared, keeping its own query string and fragment.
 */
export function importUrlFromSearch(search: string): string | null {
	const value = new URLSearchParams(search).get('url')?.trim()
	if (!value) return null
	try {
		const { protocol } = new URL(value)
		return protocol === 'http:' || protocol === 'https:' ? value : null
	} catch {
		return null
	}
}
