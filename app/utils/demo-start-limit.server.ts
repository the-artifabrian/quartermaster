import {
	CLIENT_KEY_HEADER,
	UNKNOWN_CLIENT_KEY,
} from './client-address.server.ts'
import { rateLimitMultiple } from './rate-limit-scale.server.ts'

/**
 * Demo starts one client gets per window. Without a cookie, every start
 * makes a new demo user, so without this one client could fill the live cap
 * (DEMO_LIVE_LIMIT) on its own and keep it full.
 */
export const DEMO_STARTS_PER_CLIENT = 5
export const DEMO_STARTS_WINDOW_MS = 60 * 60 * 1000

/**
 * A fixed-window count per key, in memory, so it starts over on deploy. A
 * window starts at a key's first take and lasts `windowMs`, however often
 * the client is refused meanwhile.
 */
export function createStartLimiter({
	limit,
	windowMs,
	now = () => Date.now(),
}: {
	/** Read on each take, so the relaxed limits of tests can change it. */
	limit: () => number
	windowMs: number
	now?: () => number
}) {
	const windows = new Map<string, { count: number; endsAt: number }>()
	return {
		take(key: string) {
			const time = now()
			if (windows.size > 10_000) {
				for (const [k, w] of windows) if (w.endsAt <= time) windows.delete(k)
			}
			let window = windows.get(key)
			if (!window || window.endsAt <= time) {
				window = { count: 0, endsAt: time + windowMs }
				windows.set(key, window)
			}
			if (window.count >= limit()) return false
			window.count++
			return true
		},
	}
}

/** Put the client key on a request on its way to the app. */
export function stampClientKey(
	req: { headers: Record<string, string | string[] | undefined> },
	key: string,
) {
	req.headers[CLIENT_KEY_HEADER] = key
}

/** The client key server/index.ts stamped on the request. */
export function demoStartKey(request: Request) {
	return request.headers.get(CLIENT_KEY_HEADER) ?? UNKNOWN_CLIENT_KEY
}

const demoStarts = createStartLimiter({
	limit: () => DEMO_STARTS_PER_CLIENT * rateLimitMultiple(),
	windowMs: DEMO_STARTS_WINDOW_MS,
})

/** Count one demo start for the request's client; false when it has none left. */
export function takeDemoStart(request: Request) {
	return demoStarts.take(demoStartKey(request))
}
