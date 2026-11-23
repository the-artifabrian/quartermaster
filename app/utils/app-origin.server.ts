/**
 * The origin for every absolute URL the app hands out. What uses it is listed
 * in docs/ARCHITECTURE.md under "Deployment and recovery". It never comes from
 * the request, whose Host and X-Forwarded-* headers (and so `request.url`) the
 * client controls.
 *
 * `APP_ORIGIN` is validated as a bare origin and required in production
 * (env.server.ts). Outside production it defaults to localhost on PORT, so dev
 * and tests need no setting.
 */
export function getAppOrigin(): string {
	const configured = process.env.APP_ORIGIN
	if (configured) return new URL(configured).origin
	if (process.env.NODE_ENV === 'production') {
		throw new Error('APP_ORIGIN must be set in production')
	}
	return `http://localhost:${process.env.PORT || 3000}`
}

/**
 * A Host header's name in lower case, without its port or a trailing dot,
 * so "WWW.useqm.app.:443" compares equal to "www.useqm.app". Empty when
 * there is no header.
 */
export function hostName(header: string | null | undefined): string {
	return (header ?? '')
		.trim()
		.toLowerCase()
		.replace(/:\d*$/, '')
		.replace(/\.$/, '')
}
