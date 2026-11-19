import { expect, test } from 'vitest'
import { pagePathOf } from './page-path.ts'

const page = (url: string) => pagePathOf(new URL(url, 'http://localhost'))

test('a page request is the page, search and all', () => {
	expect(page('/recipes?search=soup')).toBe('/recipes?search=soup')
})

test("a data request (a Save, a fetcher) is the page it was for, without React Router's .data", () => {
	expect(page('/recipes/r1/edit.data')).toBe('/recipes/r1/edit')
})

test("React Router's own params go; the page's stay", () => {
	expect(
		page('/recipes.data?search=soup&_routes=routes%2Frecipes%2Findex'),
	).toBe('/recipes?search=soup')
	expect(page('/recipes.data?index')).toBe('/recipes')
})

test('a data request for a path ending in a slash is that path', () => {
	expect(page('/_.data')).toBe('/')
	expect(page('/recipes/_.data')).toBe('/recipes/')
})

test('a page whose own name ends in .data elsewhere in the path is left alone', () => {
	expect(page('/recipes/my.data.recipe')).toBe('/recipes/my.data.recipe')
})
