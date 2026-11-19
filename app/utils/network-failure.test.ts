import { afterEach, expect, test, vi } from 'vitest'
import { isNetworkFailure } from './network-failure.ts'

// Failure list: a fetch that never got an answer, in each browser's words,
// counts; so does any TypeError while the browser says it is offline. A server
// error React Router rebuilds as a TypeError in development does not, nor does
// anything that is not a TypeError.

afterEach(() => {
	vi.unstubAllGlobals()
})

test.each([
	['Chromium', 'Failed to fetch'],
	['Safari', 'Load failed'],
	['Firefox', 'NetworkError when attempting to fetch resource.'],
	['older WebKit, connection dropped', 'The network connection was lost.'],
	['older WebKit, offline', 'The Internet connection appears to be offline.'],
])('%s: “%s” is a network failure', (_browser, message) => {
	expect(isNetworkFailure(new TypeError(message))).toBe(true)
})

test('a server error rebuilt as a TypeError is not', () => {
	expect(
		isNetworkFailure(
			new TypeError("Cannot read properties of undefined (reading 'fetch')"),
		),
	).toBe(false)
	expect(isNetworkFailure(new TypeError('network is not a function'))).toBe(
		false,
	)
})

test('while the browser is offline any TypeError is', () => {
	vi.stubGlobal('navigator', { onLine: false })
	expect(isNetworkFailure(new TypeError('Something else'))).toBe(true)
})

test('something other than a TypeError is not, even offline', () => {
	vi.stubGlobal('navigator', { onLine: false })
	expect(isNetworkFailure(new Error('Failed to fetch'))).toBe(false)
	expect(isNetworkFailure(new Response(null, { status: 302 }))).toBe(false)
})
