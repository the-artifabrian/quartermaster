import { expect, test } from 'vitest'
import { safeRedirect } from './safe-redirect.ts'

// Picking where to send the browser from a value it sent. Browsers drop tabs,
// newlines and carriage returns from a URL, so "/\t/evil.com" lands on another
// site, and they read a backslash as a slash.

test.each([
	['a tab', '/\t/evil.com'],
	['a newline', '/\n/evil.com'],
	['a carriage return', '/\r/evil.com'],
	['a NUL', '/\0/evil.com'],
	['a DEL', '/\u007f/evil.com'],
	['a space', '/ /evil.com'],
	['a leading space', ' //evil.com'],
	['a backslash', '/\\evil.com'],
	['a backslash later on', '/recipes\\..\\..'],
	['two slashes', '//evil.com'],
	['a full URL', 'https://evil.com/'],
])('a value with %s goes to the default', (_, value) => {
	expect(safeRedirect(value, '/recipes')).toBe('/recipes')
})

test('an ordinary path comes through unchanged', () => {
	expect(safeRedirect('/verify?type=onboarding&target=a%40b.c', '/x')).toBe(
		'/verify?type=onboarding&target=a%40b.c',
	)
})

test('a missing value gives the default', () => {
	expect(safeRedirect(null, '/recipes')).toBe('/recipes')
	expect(safeRedirect(undefined)).toBe('/')
})
