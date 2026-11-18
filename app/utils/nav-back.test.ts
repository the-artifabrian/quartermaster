import { expect, test } from 'vitest'
import {
	type HistoryEntry,
	type HistoryLog,
	menuDetailNav,
	menuNewNav,
	recipeDetailNav,
	recipeEditNav,
	recordHistoryEntry,
	resolveBack,
	settingsPageNav,
	settingsRootNav,
} from './nav-back.ts'

/** A log of in-app entries, index = history idx; null = never seen. */
function logOf(...paths: Array<string | null>): HistoryLog {
	const log: Record<number, HistoryEntry> = {}
	paths.forEach((path, idx) => {
		if (path === null) return
		const [pathname, search = ''] = path.split('?')
		log[idx] = { pathname: pathname!, search: search ? `?${search}` : '' }
	})
	return log
}

function back(paths: Array<string | null>, rule = recipeDetailNav) {
	const idx = paths.length - 1
	const pathname = paths[idx]!.split('?')[0]!
	return resolveBack({ idx, log: logOf(...paths), pathname, rule })
}

test('a cold deep link has nothing behind it, so Back opens the parent in its place', () => {
	expect(back(['/recipes/r1'])).toEqual({
		type: 'replace',
		to: '/recipes',
		label: 'Recipes',
	})
})

test('after a reload the earlier entries are unknown, so Back opens the parent', () => {
	expect(back([null, '/recipes/r1'])).toEqual({
		type: 'replace',
		to: '/recipes',
		label: 'Recipes',
	})
})

test('without a history index nothing can be popped', () => {
	expect(
		resolveBack({
			idx: null,
			log: logOf('/recipes'),
			pathname: '/recipes/r1',
			rule: recipeDetailNav,
		}),
	).toEqual({ type: 'replace', to: '/recipes', label: 'Recipes' })
})

test('opened from the parent list, Back pops one entry', () => {
	expect(back(['/recipes', '/recipes/r1'])).toEqual({
		type: 'pop',
		delta: 1,
		label: 'Recipes',
	})
})

test('a filtered parent list is still the parent, so its search and scroll come back', () => {
	expect(back(['/recipes?q=soup', '/recipes/r1'])).toEqual({
		type: 'pop',
		delta: 1,
		label: 'Recipes',
	})
})

test('a page from another tab behind it (a tab-bar restore) is not popped into', () => {
	expect(back(['/recipes', '/recipes/r1', '/plan', '/recipes/r1'])).toEqual({
		type: 'replace',
		to: '/recipes',
		label: 'Recipes',
	})
})

test('a Recipe opened from the Plan goes to Recipes, the tab it belongs to', () => {
	expect(back(['/plan', '/recipes/r1'])).toEqual({
		type: 'replace',
		to: '/recipes',
		label: 'Recipes',
	})
})

test('after saving an edit, Back steps over the edit form to the list', () => {
	expect(
		back(['/recipes', '/recipes/r1', '/recipes/r1/edit', '/recipes/r1']),
	).toEqual({ type: 'pop', delta: 3, label: 'Recipes' })
})

test('after creating a Recipe, Back steps over the new-Recipe form', () => {
	expect(back(['/recipes', '/recipes/new', '/recipes/r1'])).toEqual({
		type: 'pop',
		delta: 2,
		label: 'Recipes',
	})
})

test('after an import, Back steps over the Import page', () => {
	expect(back(['/recipes', '/recipes/import', '/recipes/r1'])).toEqual({
		type: 'pop',
		delta: 2,
		label: 'Recipes',
	})
})

test('the same page twice in a row counts as one', () => {
	expect(back(['/recipes', '/recipes/r1', '/recipes/r1'])).toEqual({
		type: 'pop',
		delta: 2,
		label: 'Recipes',
	})
})

test('a Recipe opened from a Menu goes back to that Menu', () => {
	expect(back(['/recipes/menus', '/recipes/menus/m1', '/recipes/r1'])).toEqual({
		type: 'pop',
		delta: 1,
		label: 'Menu',
	})
})

test('a Recipe opened from another Recipe (a linked ingredient) goes back to it', () => {
	expect(back(['/recipes', '/recipes/r1', '/recipes/r2'])).toEqual({
		type: 'pop',
		delta: 1,
		label: 'Recipe',
	})
})

test('another Recipe edit form is not stepped over', () => {
	expect(back(['/recipes', '/recipes/r2/edit', '/recipes/r1'])).toEqual({
		type: 'replace',
		to: '/recipes',
		label: 'Recipes',
	})
})

test('an unknown entry in the middle stops the walk', () => {
	expect(back(['/recipes', null, '/recipes/r1/edit', '/recipes/r1'])).toEqual({
		type: 'replace',
		to: '/recipes',
		label: 'Recipes',
	})
})

test('a pass-through form does not carry Back past an unrelated page', () => {
	expect(
		back(['/recipes', '/plan', '/recipes/r1/edit', '/recipes/r1']),
	).toEqual({ type: 'replace', to: '/recipes', label: 'Recipes' })
})

test('the new-Menu form is not a Menu', () => {
	expect(
		back(
			['/recipes/menus', '/recipes/menus/new', '/recipes/menus/m1'],
			menuDetailNav,
		),
	).toEqual({ type: 'pop', delta: 2, label: 'Menus' })
	expect(back(['/recipes/menus/new', '/recipes/r1'])).toEqual({
		type: 'replace',
		to: '/recipes',
		label: 'Recipes',
	})
})

test('Cancel on a Recipe edit opened from the Recipe pops to it', () => {
	expect(
		back(['/recipes', '/recipes/r1', '/recipes/r1/edit'], recipeEditNav('r1')),
	).toEqual({ type: 'pop', delta: 1, label: 'Recipe' })
})

test('Cancel on a deep-linked Recipe edit opens the Recipe in its place', () => {
	expect(back(['/recipes/r1/edit'], recipeEditNav('r1'))).toEqual({
		type: 'replace',
		to: '/recipes/r1',
		label: 'Recipe',
	})
})

test('Cancel on the new-Menu form returns to Menus', () => {
	expect(back(['/recipes/menus', '/recipes/menus/new'], menuNewNav)).toEqual({
		type: 'pop',
		delta: 1,
		label: 'Menus',
	})
})

test('Settings goes back to the tab it was opened from', () => {
	expect(back(['/plan', '/settings/profile'], settingsRootNav)).toEqual({
		type: 'pop',
		delta: 1,
		label: 'Plan',
	})
	expect(
		back(['/recipes/menus', '/settings/profile'], settingsRootNav),
	).toEqual({ type: 'pop', delta: 1, label: 'Menus' })
})

test('Settings steps over its own subpages after a save', () => {
	expect(
		back(
			[
				'/shopping',
				'/settings/profile',
				'/settings/profile/edit',
				'/settings/profile',
			],
			settingsRootNav,
		),
	).toEqual({ type: 'pop', delta: 3, label: 'Shopping' })
})

test('Settings opened cold goes to Recipes', () => {
	expect(back(['/settings/profile'], settingsRootNav)).toEqual({
		type: 'replace',
		to: '/recipes',
		label: 'Recipes',
	})
})

test('a nested Settings page goes back to Settings, over the page that led to it', () => {
	expect(
		back(
			[
				'/settings/profile',
				'/settings/profile/two-factor',
				'/settings/profile/two-factor/verify',
			],
			settingsPageNav,
		),
	).toEqual({ type: 'pop', delta: 2, label: 'Settings' })
})

test('a push drops the forward entries it replaces', () => {
	// List, Recipe, its edit form, the saved Recipe; then back to the first
	// Recipe and on to another one from it.
	let log = logOf('/recipes', '/recipes/r1', '/recipes/r1/edit', '/recipes/r1')
	log = recordHistoryEntry(log, {
		idx: 1,
		pathname: '/recipes/r1',
		search: '',
		action: 'POP',
	})
	log = recordHistoryEntry(log, {
		idx: 2,
		pathname: '/recipes/r2',
		search: '',
		action: 'PUSH',
	})
	expect(log).toEqual(logOf('/recipes', '/recipes/r1', '/recipes/r2'))
})

test('a replace rewrites its own entry and keeps the ones after it', () => {
	let log = logOf('/recipes', '/recipes/r1', '/recipes/r2')
	log = recordHistoryEntry(log, {
		idx: 1,
		pathname: '/recipes/menus',
		search: '',
		action: 'REPLACE',
	})
	expect(log).toEqual(logOf('/recipes', '/recipes/menus', '/recipes/r2'))
})
