import { type RequestHandler } from 'express'
import { getAppOrigin } from '#app/utils/app-origin.ts'

/**
 * Sends a plain-HTTP GET (X-Forwarded-Proto comes from Fly) to the same path
 * on the app's own host. The host is APP_ORIGIN's, never the request's Host or
 * X-Forwarded-Host, which the client controls.
 */
export function httpsRedirect(): RequestHandler {
	return (req, res, next) => {
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
