import { styleText } from 'node:util'
import { runInBackground } from './background.server.ts'
import { redactUrl } from './redact-url.ts'
import { serializeError } from './serialize-error.server.ts'

/**
 * Log a server error with its stack and report it to PostHog, as an
 * uncaught one is (entry.server.tsx, handleError). For errors a route
 * catches to show the visitor something better than an error page.
 */
export function reportServerError(error: unknown, request: Request) {
	if (error instanceof Error) {
		console.error(styleText('red', String(error.stack)))
	} else {
		console.error(error)
	}

	runInBackground(
		import('./posthog.server.ts').then(({ captureServerEvent }) => {
			captureServerEvent('server', 'server_error', {
				error: serializeError(error),
				stack: error instanceof Error ? error.stack : undefined,
				url: redactUrl(request.url),
			})
		}),
		'reporting a server error',
	)
}
