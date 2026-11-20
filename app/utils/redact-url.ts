// Query parameters whose values are secrets or personal data: emailed and 2FA
// codes, invite tokens, verification targets (an email address or user id),
// OAuth's code and state, and Stripe's checkout session id.
const SENSITIVE_PARAMS = new Set([
	'code',
	'token',
	'target',
	'session_id',
	'otp',
	'state',
	'email',
	'password',
	'secret',
])

// A sign-in redirect carries the whole original URL in redirectTo, which can
// itself hold a redirectTo. This deep is more than any real URL nests.
const MAX_DEPTH = 5

/** Decodes every escape that decodes and leaves malformed ones as they are. */
function lenientDecode(value: string) {
	return value.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
		try {
			return decodeURIComponent(run)
		} catch {
			return run.replace(/%[0-9a-f]{2}/gi, (escape) => {
				try {
					return decodeURIComponent(escape)
				} catch {
					return escape
				}
			})
		}
	})
}

function redact(url: string, depth: number): string {
	const hashAt = url.indexOf('#')
	const main = hashAt === -1 ? url : url.slice(0, hashAt)
	const hash = hashAt === -1 ? '' : url.slice(hashAt)
	const queryAt = main.indexOf('?')
	if (queryAt === -1) return url

	const query = main
		.slice(queryAt + 1)
		.split('&')
		.map((part) => {
			const eq = part.indexOf('=')
			if (eq === -1) return part
			const name = part.slice(0, eq)
			const value = part.slice(eq + 1)
			if (SENSITIVE_PARAMS.has(lenientDecode(name).toLowerCase())) {
				return `${name}=redacted`
			}
			if (depth < MAX_DEPTH) {
				const decoded = lenientDecode(value)
				if (decoded.includes('?')) {
					const inner = redact(decoded, depth + 1)
					if (inner !== decoded) return `${name}=${encodeURIComponent(inner)}`
				}
			}
			return part
		})
		.join('&')

	return `${main.slice(0, queryAt)}?${query}${hash}`
}

/**
 * The URL with the values of sensitive query parameters replaced, for logs and
 * analytics. Works on absolute URLs and bare paths, follows URLs nested in
 * other parameters (redirectTo), and leaves every other byte as it was.
 */
export function redactUrl(url: string): string {
	return redact(url, 0)
}
