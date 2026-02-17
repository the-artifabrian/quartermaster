import { type Route } from './+types/household-events.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	householdEventBus,
	pruneOldEvents,
	type HouseholdEventData,
} from '#app/utils/household-events.server.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)

	// Lazy prune old events (fire-and-forget)
	void pruneOldEvents()

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder()

			function send(data: string) {
				try {
					controller.enqueue(encoder.encode(data))
				} catch {
					// Stream closed
				}
			}

			// Send initial connected message
			send('event: connected\ndata: {}\n\n')

			// Keepalive every 30s
			const keepalive = setInterval(() => {
				send('event: keepalive\ndata: {}\n\n')
			}, 30_000)

			// Listen for household events
			function onEvent(event: HouseholdEventData) {
				// Don't notify the acting user
				if (event.userId === userId) return

				send(`event: activity\ndata: ${JSON.stringify(event)}\n\n`)
			}

			householdEventBus.on(`household:${householdId}`, onEvent)

			// Clean up on disconnect
			request.signal.addEventListener('abort', () => {
				clearInterval(keepalive)
				householdEventBus.off(`household:${householdId}`, onEvent)
				try {
					controller.close()
				} catch {
					// Already closed
				}
			})
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
