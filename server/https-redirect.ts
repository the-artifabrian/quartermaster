import { type RequestHandler } from 'express'
import { getAppOrigin } from '#app/utils/app-origin.server.ts'

const HEALTHCHECK_PATH = '/resources/healthcheck'

/** The Host header in lower case, without its port. */
function requestHost(header: string | undefined) {
	return (header ?? '').toLowerCase().replace(/:\d+$/, '')
}

/**
 * Two redirects, both to APP_ORIGIN's host, never the request's Host or
 * X-Forwarded-Host, which the client controls:
 *
 * - In production, a GET or HEAD on www plus the app's host gets a 301 to the
 *   same path on the app's origin. Passkeys, emailed links and Stripe returns
 *   only work on that origin. Fly's checks and the fly.dev host are left
 *   alone, and so is the healthcheck.
 * - A plain-HTTP GET (X-Forwarded-Proto comes from Fly) goes to the same path
 *   over HTTPS.
 */
export function httpsRedirect(): RequestHandler {
	return (req, res, next) => {
		if (req.method !== 'GET' && req.method !== 'HEAD') return next()
		if (req.path === HEALTHCHECK_PATH) return next()
		if (process.env.NODE_ENV === 'production') {
			const app = new URL(getAppOrigin())
			if (requestHost(req.get('Host')) === `www.${app.hostname}`) {
				res.redirect(301, `${app.origin}${req.originalUrl}`)
				return
			}
		}
		if (req.method !== 'GET') return next()
		if (req.get('X-Forwarded-Proto') === 'http') {
			const host = new URL(getAppOrigin()).host
			res.set('X-Forwarded-Proto', 'https')
			res.redirect(`https://${host}${req.originalUrl}`)
			return
		}
		next()
	}
}
