/** Each browser's words for a fetch that never got an answer. */
const NETWORK_FAILURE_MESSAGES = [
	'Failed to fetch', // Chromium
	'Load failed', // Safari
	'The network connection was lost.', // older WebKit, a dropped connection
	'The Internet connection appears to be offline.', // older WebKit, offline
]

/**
 * A fetch that never got an answer: a TypeError in the browser's own words
 * for it, or any TypeError while the browser says it is offline. A server
 * error React Router rebuilds as a TypeError in development is none of these,
 * so it still reaches the error page.
 */
export function isNetworkFailure(error: unknown) {
	if (!(error instanceof TypeError)) return false
	if (typeof navigator !== 'undefined' && navigator.onLine === false) {
		return true
	}
	return (
		NETWORK_FAILURE_MESSAGES.includes(error.message) ||
		error.message.startsWith('NetworkError when attempting to fetch') // Firefox
	)
}
