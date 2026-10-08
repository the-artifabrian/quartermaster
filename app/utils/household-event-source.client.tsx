import { type HouseholdEventData } from './household-events.server.ts'
import { getHouseholdClientId } from './household-client.tsx'

type EventCallback = (event: HouseholdEventData) => void

let eventSource: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let watchdogTimer: ReturnType<typeof setTimeout> | null = null
// The server sends a keepalive every 30 s. A half-open socket (common on
// cellular) fires no error, so a stream this quiet is treated as dead.
const SILENCE_LIMIT_MS = 75_000
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
	if (!lastSeenTimestamp || event.createdAt > lastSeenTimestamp) {
		lastSeenTimestamp = event.createdAt
	}

	for (const cb of listeners) {
		if (event.payload.originClientId === getHouseholdClientId()) continue
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

	// Don't open a stream while the tab/PWA is backgrounded — iOS suspends it
	// anyway, so reopening on resume avoids churn. visibilitychange handles resume.
	if (typeof document !== 'undefined' && document.hidden) return

	// Initialize cursor so polling starts from connection time
	if (!lastSeenTimestamp) {
		lastSeenTimestamp = new Date().toISOString()
	}

	const source = new EventSource('/resources/household-events')
	eventSource = source
	// Every listener below ignores a stream that has since been replaced.
	const current = () => eventSource === source
	armWatchdog()

	// SSE is healthy — drop the polling fallback if it was running, but first
	// catch up on anything emitted during the gap: the fallback's first tick is
	// 30s out, so it never covers the 3-5s reconnect window, and the server now
	// deliberately ends every stream at its lifetime cap.
	source.addEventListener('open', () => {
		if (!current()) return
		armWatchdog()
		stopPolling()
		void poll()
	})

	source.addEventListener('keepalive', () => {
		if (current()) armWatchdog()
	})

	source.addEventListener('activity', (e) => {
		if (!current()) return
		armWatchdog()
		try {
			const data = JSON.parse(e.data) as HouseholdEventData
			broadcast(data)
		} catch {
			// Ignore malformed events
		}
	})

	source.addEventListener('error', () => {
		if (current()) dropAndReconnect()
	})
}

/** Restart the silence countdown: the stream just showed it is alive. */
function armWatchdog() {
	if (watchdogTimer) clearTimeout(watchdogTimer)
	watchdogTimer = setTimeout(() => {
		watchdogTimer = null
		dropAndReconnect()
	}, SILENCE_LIMIT_MS)
}

/** Close the stream, poll while it is down, and reconnect after 3-5 s. */
function dropAndReconnect() {
	cleanup()
	startPolling()
	if (reconnectTimer) return
	const delay = 3000 + Math.random() * 2000
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null
		if (
			listeners.size > 0 &&
			!(typeof document !== 'undefined' && document.hidden)
		) {
			connect()
		}
	}, delay)
}

function cleanup() {
	if (watchdogTimer) {
		clearTimeout(watchdogTimer)
		watchdogTimer = null
	}
	if (eventSource) {
		eventSource.close()
		eventSource = null
	}
}

function teardownConnection() {
	cleanup()
	stopPolling()
	if (reconnectTimer) {
		clearTimeout(reconnectTimer)
		reconnectTimer = null
	}
}

function handleVisibilityChange() {
	if (document.hidden) {
		// Backgrounded (iOS suspends the PWA anyway): drop the stream + timers to
		// stop radio/battery churn and avoid a revalidate storm on resume.
		teardownConnection()
	} else if (listeners.size > 0) {
		// Foregrounded: reconnect and immediately catch up on anything missed.
		connect()
		void poll()
	}
}

export function subscribeToHouseholdEvents(
	callback: EventCallback,
): () => void {
	listeners.add(callback)

	if (listeners.size === 1) {
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', handleVisibilityChange)
		}
		connect()
	}

	return () => {
		listeners.delete(callback)
		if (listeners.size === 0) {
			if (typeof document !== 'undefined') {
				document.removeEventListener('visibilitychange', handleVisibilityChange)
			}
			teardownConnection()
			resetState()
		}
	}
}
