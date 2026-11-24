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
		(async () => {
			// A demo user's errors are marked, as their browser events are. The
			// database may be why the request failed, so a failed lookup only
			// leaves the mark off.
			const demo = await import('./demo-guard.server.ts')
				.then(({ isDemoSession }) => isDemoSession(request))
				.catch(() => false)
			const { captureServerEvent } = await import('./posthog.server.ts')
			captureServerEvent('server', 'server_error', {
				error: serializeError(error),
				stack: error instanceof Error ? error.stack : undefined,
				url: redactUrl(request.url),
				...(demo ? { is_demo: true } : {}),
			})
		})(),
		'reporting a server error',
	)
}
