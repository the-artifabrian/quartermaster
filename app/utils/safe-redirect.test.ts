import { expect, test } from 'vitest'
import { safeRedirect } from './safe-redirect.ts'

// Failure list for picking where to send the browser from a value it sent:
// 1. Browsers drop tabs, newlines and carriage returns from a URL, so
//    "/\t/evil.com" lands on another site. Any control character is refused.
// 2. A space, or any other whitespace, is refused rather than trimmed.
// 3. A backslash anywhere is refused; browsers read it as a slash.
// 4. The usual off-site forms (//, /\, a full URL) are still refused.
// 5. An ordinary path with a query string comes through unchanged, and a
//    missing value gives the default.

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
