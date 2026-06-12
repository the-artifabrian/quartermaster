/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
	acquireWakeLock,
	getKeepAwakePreference,
	releaseWakeLock,
	resetWakeLockForTests,
	setKeepAwakePreference,
} from './wake-lock.ts'

type ReleaseListener = () => void

class FakeSentinel {
	released = false
	private listeners: ReleaseListener[] = []
	addEventListener(_type: 'release', listener: ReleaseListener) {
		this.listeners.push(listener)
	}
	async release() {
		this.fireRelease()
	}
	/** Simulate the UA dropping the lock (page hidden, battery saver). */
	fireRelease() {
		if (this.released) return
		this.released = true
		for (const listener of this.listeners) listener()
	}
}

let sentinels: FakeSentinel[]
let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
	resetWakeLockForTests()
	sentinels = []
	requestMock = vi.fn(async () => {
		const sentinel = new FakeSentinel()
		sentinels.push(sentinel)
		return sentinel
	})
	Object.defineProperty(navigator, 'wakeLock', {
		configurable: true,
		value: { request: requestMock },
	})
})

afterEach(() => {
	resetWakeLockForTests()
	// @ts-expect-error cleanup of the test-only property
	delete navigator.wakeLock
	localStorage.clear()
})

async function flush() {
	// let the async sync loop settle
	await new Promise((resolve) => setTimeout(resolve, 0))
}

test('acquire requests one sentinel, release releases it', async () => {
	acquireWakeLock()
	await flush()
	expect(requestMock).toHaveBeenCalledTimes(1)

	releaseWakeLock()
	await flush()
	expect(sentinels[0]?.released).toBe(true)
})

test('overlapping claims share one sentinel and only the last release drops it', async () => {
	acquireWakeLock() // recipe page
	acquireWakeLock() // running timer
	await flush()
	expect(requestMock).toHaveBeenCalledTimes(1)

	releaseWakeLock()
	await flush()
	expect(sentinels[0]?.released).toBe(false)

	releaseWakeLock()
	await flush()
	expect(sentinels[0]?.released).toBe(true)
})

test('re-acquires after the UA drops the lock while still claimed', async () => {
	acquireWakeLock()
	await flush()
	expect(requestMock).toHaveBeenCalledTimes(1)

	// UA drops the lock on its own (e.g. brief visibility flicker)
	sentinels[0]!.fireRelease()
	await flush()
	expect(requestMock).toHaveBeenCalledTimes(2)

	releaseWakeLock()
	await flush()
	expect(sentinels[1]?.released).toBe(true)
})

test('release of all claims while a request is in flight still releases', async () => {
	let resolveRequest: (sentinel: FakeSentinel) => void = () => {}
	requestMock.mockImplementationOnce(
		() =>
			new Promise<FakeSentinel>((resolve) => {
				resolveRequest = resolve
			}),
	)
	acquireWakeLock()
	releaseWakeLock() // released before the request resolves
	const sentinel = new FakeSentinel()
	sentinels.push(sentinel)
	resolveRequest(sentinel)
	await flush()
	expect(sentinel.released).toBe(true)
})

test('extra releases never go negative', async () => {
	releaseWakeLock()
	releaseWakeLock()
	acquireWakeLock()
	await flush()
	expect(requestMock).toHaveBeenCalledTimes(1)
	releaseWakeLock()
	await flush()
	expect(sentinels[0]?.released).toBe(true)
})

test('missing wakeLock API is a no-op', async () => {
	// @ts-expect-error remove the test-only property
	delete navigator.wakeLock
	acquireWakeLock()
	await flush()
	releaseWakeLock()
	await flush()
	// reaching here without throwing is the assertion
})

test('keep-awake preference defaults on and round-trips', () => {
	expect(getKeepAwakePreference()).toBe(true)
	setKeepAwakePreference(false)
	expect(getKeepAwakePreference()).toBe(false)
	setKeepAwakePreference(true)
	expect(getKeepAwakePreference()).toBe(true)
})
