/**
 * The origin every absolute URL the app hands out is built from: emailed
 * verification links, the robots.txt and sitemap URLs, OG URLs, the TOTP
 * issuer, the WebAuthn relying party, Stripe return URLs and the HTTPS
 * redirect. It never comes from the request, whose Host and X-Forwarded-*
 * headers (and so `request.url`) the client controls.
 *
 * `APP_ORIGIN` is validated as a bare origin and required in production
 * (env.server.ts). Outside production it defaults to localhost on PORT, so dev
 * and tests need no setting. Read per call, never at module scope: this module
 * also reaches the browser bundle through misc.tsx.
 */
export function getAppOrigin(): string {
	const configured = process.env.APP_ORIGIN
	if (configured) return new URL(configured).origin
	if (process.env.NODE_ENV === 'production') {
		throw new Error('APP_ORIGIN must be set in production')
	}
	return `http://localhost:${process.env.PORT || 3000}`
}
