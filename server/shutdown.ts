import { type Server } from 'node:http'
import { styleText } from 'node:util'
import closeWithGrace from 'close-with-grace'
import { closeEventStreams } from '../app/utils/event-streams.server.ts'

// Fly allows 10 seconds (fly.toml) before sending SIGKILL. Keep this timeout
// comfortably below that platform window so cleanup failures are bounded too.
export const SHUTDOWN_GRACE_PERIOD_MS = 4_000

type ShutdownOptions = {
	flushTelemetry?: () => Promise<void>
	closeStreams?: () => void
}

async function flushPostHog() {
	const { shutdownPostHog } = await import('../app/utils/posthog.server.ts')
	await shutdownPostHog()
}

export function registerGracefulShutdown(
	server: Server,
	{
		flushTelemetry = flushPostHog,
		closeStreams = closeEventStreams,
	}: ShutdownOptions = {},
) {
	return closeWithGrace(
		{ delay: SHUTDOWN_GRACE_PERIOD_MS },
		async ({ err }) => {
			// Log the triggering error before cleanup so it remains visible even if
			// an unexpected resource consumes the rest of the bounded grace period.
			if (err) {
				console.error(styleText('red', String(err)))
				console.error(styleText('red', String(err.stack)))
			}
			const serverClosed = new Promise((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve('ok')))
			})
			closeStreams()

			const results = await Promise.allSettled([serverClosed, flushTelemetry()])
			const failures = results.filter(
				(result): result is PromiseRejectedResult =>
					result.status === 'rejected',
			)
			if (failures.length > 0) {
				throw new AggregateError(
					failures.map(({ reason }) => reason),
					'Graceful shutdown failed',
				)
			}
		},
	)
}
