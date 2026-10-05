import { expect, test } from 'vitest'
import { isNativeShell } from './native-shell.server.ts'

const IOS_SAFARI_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'

function requestWith(userAgent: string | null, method: 'GET' | 'POST' = 'GET') {
	const headers = new Headers()
	if (userAgent !== null) headers.set('User-Agent', userAgent)
	return new Request('https://useqm.app/login', { method, headers })
}

test('a request without a User-Agent header is not the shell', () => {
	expect(isNativeShell(requestWith(null))).toBe(false)
})

test('iOS Safari without the token is not the shell', () => {
	expect(isNativeShell(requestWith(IOS_SAFARI_UA))).toBe(false)
})

test('the token the shell appends is detected', () => {
	expect(
		isNativeShell(requestWith(`${IOS_SAFARI_UA} QuartermasterShell/1`)),
	).toBe(true)
})

test('a later shell version is still detected', () => {
	expect(
		isNativeShell(requestWith(`${IOS_SAFARI_UA} QuartermasterShell/2`)),
	).toBe(true)
})

test('a lowercase token is rejected', () => {
	expect(
		isNativeShell(requestWith(`${IOS_SAFARI_UA} quartermastershell/1`)),
	).toBe(false)
})

test('the token without a version number is rejected', () => {
	expect(
		isNativeShell(requestWith(`${IOS_SAFARI_UA} QuartermasterShell/`)),
	).toBe(false)
	expect(
		isNativeShell(requestWith(`${IOS_SAFARI_UA} QuartermasterShell`)),
	).toBe(false)
})

test('version 0 is rejected', () => {
	expect(
		isNativeShell(requestWith(`${IOS_SAFARI_UA} QuartermasterShell/0`)),
	).toBe(false)
})

test('the token glued into a longer product name is rejected', () => {
	expect(
		isNativeShell(requestWith(`${IOS_SAFARI_UA} NotQuartermasterShell/1`)),
	).toBe(false)
	expect(
		isNativeShell(requestWith(`${IOS_SAFARI_UA} QuartermasterShell/1x`)),
	).toBe(false)
})

test('the token alone, with nothing before it, is detected', () => {
	expect(isNativeShell(requestWith('QuartermasterShell/1'))).toBe(true)
})

test('a POST from the shell is detected, since login posts', () => {
	expect(
		isNativeShell(requestWith(`${IOS_SAFARI_UA} QuartermasterShell/1`, 'POST')),
	).toBe(true)
})
