/**
 * @vitest-environment jsdom
 */
import { beforeEach, expect, test } from 'vitest'
import {
	clearRefreshAfterTraversal,
	isHistoryTraversalTo,
	noteCommit,
	notePopState,
	noteRefreshAfterTraversal,
	wasLandedByTraversal,
} from './history-traversal.ts'

/** Where the address bar is: the browser moves it before a pop loads. */
function addressBar(path: string) {
	window.history.replaceState(null, '', path)
}
const url = (path: string) => new URL(path, 'http://localhost')

beforeEach(() => {
	addressBar('/recipes/r1/edit')
	noteCommit('/recipes/r1/edit')
	clearRefreshAfterTraversal('/recipes/r1/edit')
})

test('a pop to another page is a traversal while it loads', () => {
	addressBar('/recipes/r1')
	notePopState('/recipes/r1')
	expect(isHistoryTraversalTo(url('/recipes/r1'))).toBe(true)
})

test('a push is not: the address bar still shows the page being left', () => {
	expect(isHistoryTraversalTo(url('/recipes/r2'))).toBe(false)
})

test('once the pop has landed, loading the page again is a revalidation', () => {
	addressBar('/recipes/r1')
	notePopState('/recipes/r1')
	noteCommit('/recipes/r1')
	expect(isHistoryTraversalTo(url('/recipes/r1'))).toBe(false)
})

test('the router undoing a held pop (Keep Editing) leaves no traversal behind', () => {
	// The held pop, then the router going forward again to the edit screen.
	addressBar('/recipes/r1')
	notePopState('/recipes/r1')
	addressBar('/recipes/r1/edit')
	notePopState('/recipes/r1/edit')
	expect(isHistoryTraversalTo(url('/recipes/r1/edit'))).toBe(false)
	expect(isHistoryTraversalTo(url('/recipes/r1'))).toBe(false)
})

test('a refresh after a back to a new or restored document counts, until it is done', () => {
	noteRefreshAfterTraversal('/recipes/r1/edit')
	expect(isHistoryTraversalTo(url('/recipes/r1/edit'))).toBe(true)
	clearRefreshAfterTraversal('/recipes/r1/edit')
	expect(isHistoryTraversalTo(url('/recipes/r1/edit'))).toBe(false)
})

test('the search is part of the page', () => {
	addressBar('/recipes?q=soup')
	notePopState('/recipes?q=soup')
	expect(isHistoryTraversalTo(url('/recipes'))).toBe(false)
	expect(isHistoryTraversalTo(url('/recipes?q=soup'))).toBe(true)
})

test('a pop that showed stored data counts while its page refreshes that data', () => {
	addressBar('/recipes/r1')
	notePopState('/recipes/r1')
	noteCommit('/recipes/r1')
	expect(wasLandedByTraversal('/recipes/r1')).toBe(true)
})

test('a page a link opened was not landed by a traversal', () => {
	addressBar('/recipes/r1')
	noteCommit('/recipes/r1')
	expect(wasLandedByTraversal('/recipes/r1')).toBe(false)
})

test('the router undoing a held pop does not land by traversal either', () => {
	addressBar('/recipes/r1/edit')
	notePopState('/recipes/r1/edit')
	noteCommit('/recipes/r1/edit')
	expect(wasLandedByTraversal('/recipes/r1/edit')).toBe(false)
})
