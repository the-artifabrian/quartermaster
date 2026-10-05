import { expect, test } from 'vitest'
import { importUrlFromSearch } from './import-url.ts'

const shared = 'https://example.com/recipes/chickpea-lunch'

test('no url param', () => {
	expect(importUrlFromSearch('')).toBeNull()
	expect(importUrlFromSearch('?source=share')).toBeNull()
})

test('empty url param', () => {
	expect(importUrlFromSearch('?url=')).toBeNull()
	expect(importUrlFromSearch('?url')).toBeNull()
})

test('whitespace-only url param', () => {
	expect(importUrlFromSearch('?url=%20%09%0A')).toBeNull()
})

test('whitespace around a valid URL is dropped', () => {
	expect(importUrlFromSearch(`?url=%20${encodeURIComponent(shared)}%0A`)).toBe(
		shared,
	)
})

test('relative path', () => {
	expect(importUrlFromSearch('?url=/recipes/123')).toBeNull()
	expect(importUrlFromSearch('?url=example.com/recipe')).toBeNull()
	expect(importUrlFromSearch('?url=//example.com/recipe')).toBeNull()
})

test('javascript: scheme', () => {
	expect(
		importUrlFromSearch(`?url=${encodeURIComponent('javascript:alert(1)')}`),
	).toBeNull()
})

test('data: scheme', () => {
	expect(
		importUrlFromSearch(
			`?url=${encodeURIComponent('data:text/html,<h1>Recipe</h1>')}`,
		),
	).toBeNull()
})

test('ftp: and other non-web schemes', () => {
	expect(importUrlFromSearch('?url=ftp://example.com/recipe.txt')).toBeNull()
	expect(importUrlFromSearch('?url=file:///etc/passwd')).toBeNull()
	expect(importUrlFromSearch('?url=mailto:cook@example.com')).toBeNull()
})

test('scheme with no host', () => {
	expect(importUrlFromSearch('?url=https://')).toBeNull()
})

test('http and uppercase schemes are accepted', () => {
	expect(importUrlFromSearch('?url=http://example.com/r')).toBe(
		'http://example.com/r',
	)
	expect(importUrlFromSearch('?url=HTTPS://example.com/r')).toBe(
		'HTTPS://example.com/r',
	)
})

test("the shared URL's own query string and fragment survive intact", () => {
	const withQuery = `${shared}?utm_source=share&serves=4#step-3`
	expect(importUrlFromSearch(`?url=${encodeURIComponent(withQuery)}`)).toBe(
		withQuery,
	)
})

test('an unencoded ? inside the value is kept', () => {
	expect(importUrlFromSearch(`?url=${shared}?serves=4`)).toBe(
		`${shared}?serves=4`,
	)
})

test('percent-encoded param is decoded once', () => {
	expect(
		importUrlFromSearch(
			'?url=https%3A%2F%2Fexample.com%2Fr%2Fpasta%2520bake%2Bsalad',
		),
	).toBe('https://example.com/r/pasta%20bake+salad')
})

test('repeated url params take the first', () => {
	expect(
		importUrlFromSearch(
			'?url=https://example.com/first&url=https://example.com/second',
		),
	).toBe('https://example.com/first')
	expect(
		importUrlFromSearch('?url=javascript:alert(1)&url=https://example.com/r'),
	).toBeNull()
})

test('works without the leading ?', () => {
	expect(importUrlFromSearch(`url=${encodeURIComponent(shared)}`)).toBe(shared)
})
