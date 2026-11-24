/**
 * The limit on demo starts per client.
 *
 * Failure list:
 * - One client starts more than its share in the window and fills the
 *   live-demo cap on its own.
 * - One client's starts use up another client's.
 * - A client stays refused after the window is over.
 * - A refused start counts, so a client that keeps trying never gets back in.
 * - The client sets its own key with the header the server uses to pass
 *   the key on, and gets a fresh allowance with each request.
 * - A request with no key (one that didn't come through the server) isn't
 *   limited at all.
 * - Development and the Playwright run, where every test comes from one
 *   address, are limited like production.
 */
import { expect, test } from 'vitest'
import {
	CLIENT_KEY_HEADER,
	UNKNOWN_CLIENT_KEY,
} from './client-address.server.ts'
import {
	createStartLimiter,
	DEMO_STARTS_PER_CLIENT,
	DEMO_STARTS_WINDOW_MS,
	demoStartKey,
	stampClientKey,
} from './demo-start-limit.server.ts'
import { rateLimitMultiple } from './rate-limit-scale.server.ts'

test('a client gets five starts an hour', () => {
	expect(DEMO_STARTS_PER_CLIENT).toBe(5)
	expect(DEMO_STARTS_WINDOW_MS).toBe(60 * 60 * 1000)
})

function limiter(now: { t: number }) {
	return createStartLimiter({
		limit: () => 5,
		windowMs: 60 * 60 * 1000,
		now: () => now.t,
	})
}

test('the sixth start in the window is refused', () => {
	const clock = { t: 0 }
	const starts = limiter(clock)

	const results = Array.from({ length: 6 }, () => starts.take('a'))

	expect(results).toEqual([true, true, true, true, true, false])
})

test('each client has its own count', () => {
	const clock = { t: 0 }
	const starts = limiter(clock)
	for (let i = 0; i < 5; i++) starts.take('a')

	expect(starts.take('a')).toBe(false)
	expect(starts.take('b')).toBe(true)
})

test('a client starts again once the window is over, and refusals don’t count', () => {
	const clock = { t: 0 }
	const starts = limiter(clock)
	for (let i = 0; i < 5; i++) starts.take('a')
	clock.t = 30 * 60 * 1000
	for (let i = 0; i < 10; i++) expect(starts.take('a')).toBe(false)

	clock.t = 60 * 60 * 1000

	expect(starts.take('a')).toBe(true)
})

test('the key is the one the server stamped, never one the client sent', () => {
	const headers: Record<string, string | string[] | undefined> = {
		[CLIENT_KEY_HEADER]: 'chosen-by-the-client',
	}

	stampClientKey({ headers }, '203.0.113.7')

	expect(headers[CLIENT_KEY_HEADER]).toBe('203.0.113.7')
	expect(
		demoStartKey(
			new Request('https://useqm.app/demo', {
				headers: { [CLIENT_KEY_HEADER]: '203.0.113.7' },
			}),
		),
	).toBe('203.0.113.7')
})

test('a request with no key counts against one shared key', () => {
	expect(demoStartKey(new Request('https://useqm.app/demo'))).toBe(
		UNKNOWN_CLIENT_KEY,
	)
})

test('limits are relaxed in development and under Playwright, as the other rate limits are', () => {
	expect(rateLimitMultiple({ NODE_ENV: 'production' })).toBe(1)
	expect(rateLimitMultiple({ NODE_ENV: 'development' })).toBeGreaterThan(1000)
	expect(
		rateLimitMultiple({
			NODE_ENV: 'production',
			PLAYWRIGHT_TEST_BASE_URL: 'http://localhost:3117',
		}),
	).toBeGreaterThan(1000)
})
