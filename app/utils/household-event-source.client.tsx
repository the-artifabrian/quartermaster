import { type HouseholdEventData } from './household-events.server.ts'

type EventCallback = (event: HouseholdEventData) => void

let eventSource: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<EventCallback>()

function connect() {
	if (eventSource) return

	eventSource = new EventSource('/resources/household-events')

	eventSource.addEventListener('activity', (e) => {
		try {
			const data = JSON.parse(e.data) as HouseholdEventData
			for (const cb of listeners) {
				cb(data)
			}
		} catch {
			// Ignore malformed events
		}
	})

	eventSource.addEventListener('error', () => {
		cleanup()
		// Reconnect with 3-5s jitter
		const delay = 3000 + Math.random() * 2000
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null
			if (listeners.size > 0) connect()
		}, delay)
	})
}

function cleanup() {
	if (eventSource) {
		eventSource.close()
		eventSource = null
	}
}

export function subscribeToHouseholdEvents(
	callback: EventCallback,
): () => void {
	listeners.add(callback)

	if (listeners.size === 1) {
		connect()
	}

	return () => {
		listeners.delete(callback)
		if (listeners.size === 0) {
			cleanup()
			if (reconnectTimer) {
				clearTimeout(reconnectTimer)
				reconnectTimer = null
			}
		}
	}
}
