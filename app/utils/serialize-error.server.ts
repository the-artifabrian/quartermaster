import { isRouteErrorResponse } from 'react-router'

/**
 * Serialize an unknown thrown value for the PostHog `server_error` event.
 * Non-Error throws (route ErrorResponses, plain objects) stringify to
 * "[object Object]", which makes the captured `error` property useless.
 */
export function serializeError(error: unknown): string {
	if (error instanceof Error) return error.message
	if (isRouteErrorResponse(error)) {
		const status = error.statusText
			? `${error.status} ${error.statusText}`
			: String(error.status)
		return `${status}: ${JSON.stringify(error.data)}`
	}
	if (typeof error === 'string') return error
	try {
		return JSON.stringify(error) ?? String(error)
	} catch {
		return String(error)
	}
}
