import { type IncomingMessage, type ServerResponse } from 'node:http'
import type express from 'express'
import morgan from 'morgan'
import { redactUrl } from '#app/utils/redact-url.ts'

/**
 * The URL the request log shows: the one the client asked for, with codes,
 * tokens and email addresses redacted before it is decoded for reading.
 * originalUrl, since servePrecompressed rewrites req.url to the asset's .br
 * or .gz twin.
 */
export function requestLogUrl(req: IncomingMessage) {
	const url = redactUrl((req as express.Request).originalUrl ?? req.url ?? '')
	try {
		return decodeURIComponent(url)
	} catch {
		return url
	}
}

morgan.token('url', requestLogUrl)

/**
 * One line per request, in morgan's tiny format, with the URL from
 * requestLogUrl. Successful image and healthcheck requests are left out.
 */
export function requestLog(
	options: { stream?: { write: (line: string) => void } } = {},
) {
	return morgan('tiny', {
		...options,
		skip: (req: IncomingMessage, res: ServerResponse) =>
			res.statusCode === 200 &&
			Boolean(
				req.url?.startsWith('/resources/images') ||
				req.url?.startsWith('/resources/healthcheck'),
			),
	})
}
