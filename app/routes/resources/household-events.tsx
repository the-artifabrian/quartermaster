import {
	householdEventBus,
	pruneOldEvents,
	type HouseholdEventData,
} from '#app/utils/household-events.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { type Route } from './+types/household-events.ts'

const KEEPALIVE_INTERVAL_MS = 30_000
const MAX_LIFETIME_MS = 5 * 60 * 1000

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)

	// Lazy prune old events (fire-and-forget)
	void pruneOldEvents()

	let cleanup = () => {}

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder()
			const startedAt = Date.now()
			let closed = false

			cleanup = () => {
				if (closed) return
				closed = true
				clearInterval(keepalive)
				householdEventBus.off(`household:${householdId}`, onEvent)
				try {
					controller.close()
				} catch {
					// Already closed
				}
			}

			function send(data: string) {
				if (closed) return
				try {
					controller.enqueue(encoder.encode(data))
				} catch {
					cleanup()
				}
			}

			// Send initial connected message
			send('event: connected\ndata: {}\n\n')

			// The keepalive doubles as a liveness probe: neither request.signal
			// 'abort' nor stream cancel() fires on client disconnect under the
			// express adapter (verified on react-router 7.14.2 and 8.2.0), so
			// without this check every PWA reconnect left this closure — interval,
			// bus listener, controller queue — rooted forever and leaked ~10-20KB
			// per cycle. A gone consumer is detected by its queue no longer
			// draining (desiredSize stays negative); the lifetime cap bounds
			// anything the probe can't see. EventSource reconnects transparently
			// after either close.
			const keepalive = setInterval(() => {
				const stale = (controller.desiredSize ?? 0) < 0
				const expired = Date.now() - startedAt > MAX_LIFETIME_MS
				if (stale || expired) {
					cleanup()
					return
				}
				send('event: keepalive\ndata: {}\n\n')
			}, KEEPALIVE_INTERVAL_MS)

			// Listen for household events
			function onEvent(event: HouseholdEventData) {
				// Don't notify the acting user
				if (event.userId === userId) return

				send(`event: activity\ndata: ${JSON.stringify(event)}\n\n`)
			}

			householdEventBus.on(`household:${householdId}`, onEvent)

			// Clean up on disconnect
			request.signal.addEventListener('abort', cleanup)
		},
		cancel() {
			cleanup()
		},
	})

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		},
	})
}
