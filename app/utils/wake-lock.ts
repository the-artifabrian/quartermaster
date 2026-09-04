import { useEffect } from 'react'

/**
 * Shared screen wake-lock manager.
 *
 * Several mounted cooking surfaces can want the screen awake at once. The
 * browser only hands out one practical sentinel per page, so claims are
 * refcounted here and a single sentinel is held while any claim is outstanding.
 * The UA silently releases the sentinel when the page is hidden (tab switch,
 * screen lock); it is re-acquired on visibility regain as long as a claim
 * remains.
 */

let claims = 0
let sentinel: WakeLockSentinel | null = null
let syncing = false
let listening = false

function ensureVisibilityListener() {
	if (listening || typeof document === 'undefined') return
	listening = true
	document.addEventListener('visibilitychange', () => void sync())
}

async function sync() {
	if (syncing) return
	if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
	syncing = true
	try {
		// Claims can change while a request/release is in flight, so loop until
		// the held sentinel matches the wanted state.
		for (;;) {
			const want = claims > 0 && document.visibilityState === 'visible'
			if (want && !sentinel) {
				try {
					const next = await navigator.wakeLock.request('screen')
					next.addEventListener('release', () => {
						// The UA can drop the lock on its own (page hidden, battery
						// saver). Forget it and re-evaluate; a deliberate release below
						// has already nulled `sentinel`, making this a no-op.
						if (sentinel === next) {
							sentinel = null
							void sync()
						}
					})
					sentinel = next
				} catch {
					// Request denied (battery saver, permissions policy). Give up for
					// now — the next claim or visibility change retries.
					break
				}
			} else if (!want && sentinel) {
				const held = sentinel
				sentinel = null
				try {
					await held.release()
				} catch {
					// already released
				}
			} else {
				break
			}
		}
	} finally {
		syncing = false
	}
}

export function acquireWakeLock() {
	claims++
	ensureVisibilityListener()
	void sync()
}

export function releaseWakeLock() {
	claims = Math.max(0, claims - 1)
	void sync()
}

/**
 * Hold a wake-lock claim while `active` is true and the component is mounted.
 */
export function useWakeLock(active: boolean = true) {
	useEffect(() => {
		if (!active) return
		acquireWakeLock()
		return releaseWakeLock
	}, [active])
}

/** Test-only: reset module state between tests. */
export function resetWakeLockForTests() {
	claims = 0
	sentinel = null
	syncing = false
	// The visibilitychange listener is idempotent; leave it registered.
}

const KEEP_AWAKE_KEY = 'qm-keep-awake'

/**
 * "Keep screen awake while reading recipes" preference. Defaults to on — the
 * counter context is the app's reason for being; opting out is for
 * battery-anxious days.
 */
export function getKeepAwakePreference(): boolean {
	try {
		return localStorage.getItem(KEEP_AWAKE_KEY) !== 'false'
	} catch {
		return true
	}
}

export function setKeepAwakePreference(value: boolean) {
	try {
		localStorage.setItem(KEEP_AWAKE_KEY, String(value))
	} catch {
		// storage unavailable — the toggle just won't persist
	}
}
