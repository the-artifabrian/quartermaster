import { type HouseholdEventData } from './household-events.server.ts'

type EventCallback = (event: HouseholdEventData) => void

let eventSource: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<EventCallback>()

// Dedup: bounded set of recently seen event IDs (FIFO eviction at 500)
const seenEventIds: Set<string> = new Set()
const SEEN_IDS_MAX = 500

// Cursor for polling — updated on every event received from either source
let lastSeenTimestamp: string | null = null

function addSeenId(id: string) {
	seenEventIds.add(id)
	if (seenEventIds.size > SEEN_IDS_MAX) {
		// Delete oldest (first inserted)
		const first = seenEventIds.values().next().value
		if (first) seenEventIds.delete(first)
	}
}

function broadcast(event: HouseholdEventData) {
	if (seenEventIds.has(event.id)) return
	addSeenId(event.id)

	// Advance cursor
	if (
		!lastSeenTimestamp ||
		event.createdAt > lastSeenTimestamp
	) {
		lastSeenTimestamp = event.createdAt
	}

	for (const cb of listeners) {
		cb(event)
	}
}

async function poll() {
	if (!lastSeenTimestamp) return
	try {
		const res = await fetch(
			`/resources/household-events-poll?since=${encodeURIComponent(lastSeenTimestamp)}`,
		)
		if (!res.ok) return
		const json = (await res.json()) as { events: HouseholdEventData[] }
		for (const event of json.events) {
			broadcast(event)
		}
	} catch {
		// Silently ignore poll failures — SSE is still the primary channel
	}
}

function startPolling() {
	if (pollTimer) return
	pollTimer = setInterval(poll, 30_000)
}

function stopPolling() {
	if (pollTimer) {
		clearInterval(pollTimer)
		pollTimer = null
	}
}

function resetState() {
	seenEventIds.clear()
	lastSeenTimestamp = null
}

function connect() {
	if (eventSource) return

	// Initialize cursor so polling starts from connection time
	if (!lastSeenTimestamp) {
		lastSeenTimestamp = new Date().toISOString()
	}

	eventSource = new EventSource('/resources/household-events')

	eventSource.addEventListener('activity', (e) => {
		try {
			const data = JSON.parse(e.data) as HouseholdEventData
			broadcast(data)
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

	startPolling()
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
			stopPolling()
			if (reconnectTimer) {
				clearTimeout(reconnectTimer)
				reconnectTimer = null
			}
			resetState()
		}
	}
}
