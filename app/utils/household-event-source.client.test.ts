import { expect, test, vi } from 'vitest'

const SILENCE_LIMIT_MS = 75_000

class FakeEventSource {
	static instances: FakeEventSource[] = []
	readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>()
	closed = false

	constructor(readonly url: string) {
		FakeEventSource.instances.push(this)
	}

	addEventListener(type: string, listener: (event: MessageEvent) => void) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
	}

	close() {
		this.closed = true
	}

	emit(type: string, data = '{}') {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(new MessageEvent(type, { data }))
		}
	}
}

let pollRequests: string[]

/** Fake timers, a fake EventSource and a fake poll endpoint, for one test. */
function fakeNetwork() {
	vi.useFakeTimers()
	vi.resetModules()
	FakeEventSource.instances = []
	pollRequests = []
	vi.stubGlobal('EventSource', FakeEventSource)
	vi.stubGlobal('fetch', async (url: string) => {
		pollRequests.push(url)
		return Response.json({ events: [] })
	})
	// Reconnect at the start of the 3-5 s jitter window.
	vi.spyOn(Math, 'random').mockReturnValue(0)
	return {
		[Symbol.dispose]() {
			vi.useRealTimers()
			vi.unstubAllGlobals()
		},
	}
}

async function subscribe() {
	const { subscribeToHouseholdEvents } =
		await import('./household-event-source.client.tsx')
	return subscribeToHouseholdEvents(() => {})
}

function streams() {
	return FakeEventSource.instances
}

test('a stream silent for 75 s is closed, polled, and reconnected once', async () => {
	using _network = fakeNetwork()
	await subscribe()
	streams()[0]!.emit('open')
	pollRequests.length = 0

	await vi.advanceTimersByTimeAsync(SILENCE_LIMIT_MS - 1)
	expect(streams()[0]!.closed).toBe(false)
	await vi.advanceTimersByTimeAsync(1)
	expect(streams()[0]!.closed).toBe(true)
	expect(streams()).toHaveLength(1)

	await vi.advanceTimersByTimeAsync(3000)
	expect(streams()).toHaveLength(2)
	expect(streams()[1]!.closed).toBe(false)

	// The replacement has not opened yet, so the polling fallback is running.
	await vi.advanceTimersByTimeAsync(30_000)
	expect(pollRequests).toHaveLength(1)
	expect(pollRequests[0]).toMatch(/^\/resources\/household-events-poll\?since=/)
	expect(streams()).toHaveLength(2)
})

test('an error from the stream the watchdog closed does not open another', async () => {
	using _network = fakeNetwork()
	await subscribe()
	streams()[0]!.emit('open')

	await vi.advanceTimersByTimeAsync(SILENCE_LIMIT_MS)
	streams()[0]!.emit('error')
	await vi.advanceTimersByTimeAsync(5000)
	streams()[1]!.emit('open')
	await vi.advanceTimersByTimeAsync(10_000)

	expect(streams()).toHaveLength(2)
	expect(streams()[1]!.closed).toBe(false)
})

test('keepalives every 30 s keep the stream open', async () => {
	using _network = fakeNetwork()
	await subscribe()
	streams()[0]!.emit('open')
	pollRequests.length = 0

	for (let elapsed = 0; elapsed < 5 * 60_000; elapsed += 30_000) {
		await vi.advanceTimersByTimeAsync(30_000)
		streams()[0]!.emit('keepalive')
	}

	expect(streams()).toHaveLength(1)
	expect(streams()[0]!.closed).toBe(false)
	expect(pollRequests).toEqual([])
})

test('activity keeps the stream open as a keepalive does', async () => {
	using _network = fakeNetwork()
	await subscribe()
	streams()[0]!.emit('open')
	const event = JSON.stringify({
		id: 'event-1',
		createdAt: new Date().toISOString(),
		payload: {},
	})

	await vi.advanceTimersByTimeAsync(60_000)
	streams()[0]!.emit('activity', event)
	await vi.advanceTimersByTimeAsync(60_000)

	expect(streams()).toHaveLength(1)
	expect(streams()[0]!.closed).toBe(false)
})

test('a stream that never opens is replaced after 75 s', async () => {
	using _network = fakeNetwork()
	await subscribe()

	await vi.advanceTimersByTimeAsync(SILENCE_LIMIT_MS + 3000)

	expect(streams()[0]!.closed).toBe(true)
	expect(streams()).toHaveLength(2)
})

test('after the last listener leaves, silence opens no stream', async () => {
	using _network = fakeNetwork()
	const unsubscribe = await subscribe()
	streams()[0]!.emit('open')
	unsubscribe()
	pollRequests.length = 0

	await vi.advanceTimersByTimeAsync(SILENCE_LIMIT_MS * 2)

	expect(streams()).toHaveLength(1)
	expect(streams()[0]!.closed).toBe(true)
	expect(pollRequests).toEqual([])
})
