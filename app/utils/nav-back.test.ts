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
	upgradeNav,
} from './nav-back.ts'

/** A path as the tab bar opened it (restoring the tab's page). */
const TAB = ' via tab bar'

function entryOf(path: string): HistoryEntry {
	const viaTabBar = path.endsWith(TAB)
	const [pathname, search = ''] = path.replace(TAB, '').split('?')
	return {
		pathname: pathname!,
		search: search ? `?${search}` : '',
		...(viaTabBar ? { viaTabBar } : {}),
	}
}

/** A log of in-app entries, index = history idx; null = never seen. */
function logOf(...paths: Array<string | null>): HistoryLog {
	const log: Record<number, HistoryEntry> = {}
	paths.forEach((path, idx) => {
		if (path !== null) log[idx] = entryOf(path)
	})
	return log
}

function back(paths: Array<string | null>, rule = recipeDetailNav) {
	const idx = paths.length - 1
	const { pathname, viaTabBar } = entryOf(paths[idx]!)
	return resolveBack({ idx, log: logOf(...paths), pathname, viaTabBar, rule })
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

test('a Recipe opened from the Plan goes back to the Plan', () => {
	expect(back(['/plan', '/recipes/r1'])).toEqual({
		type: 'pop',
		delta: 1,
		label: 'Plan',
	})
})

test('a Menu opened from the Plan goes back to the Plan', () => {
	expect(
		back(['/plan?weekStart=2026-11-16', '/recipes/menus/m1'], menuDetailNav),
	).toEqual({
		type: 'pop',
		delta: 1,
		label: 'Plan',
	})
})

test('a Recipe opened by a link from another tab goes back there, even with the Recipe further back', () => {
	expect(back(['/recipes', '/recipes/r1', '/plan', '/recipes/r1'])).toEqual({
		type: 'pop',
		delta: 1,
		label: 'Plan',
	})
})

test('a Recipe reached through sign-in (a deep link) goes to Recipes, not back to sign-in', () => {
	expect(back(['/login', '/recipes/r1'])).toEqual({
		type: 'replace',
		to: '/recipes',
		label: 'Recipes',
	})
})

test('a Recipe the tab bar restored goes back down its own stack, to the filtered list', () => {
	expect(
		back(['/recipes?q=soup', '/recipes/r1', '/plan', `/recipes/r1${TAB}`]),
	).toEqual({ type: 'pop', delta: 3, label: 'Recipes' })
})

test('a restored Recipe first opened from the Plan stays in its tab: Back opens Recipes', () => {
	expect(
		back(['/plan', '/recipes/r1', '/shopping', `/recipes/r1${TAB}`]),
	).toEqual({ type: 'replace', to: '/recipes', label: 'Recipes' })
})

test('a restored Recipe, edited and saved, still stays in its tab', () => {
	expect(
		back([
			'/plan',
			'/recipes/r1',
			'/shopping',
			`/recipes/r1${TAB}`,
			'/recipes/r1/edit',
			'/recipes/r1',
		]),
	).toEqual({ type: 'replace', to: '/recipes', label: 'Recipes' })
})

test('a restored Recipe does not go back to another Recipe that did not open it', () => {
	expect(back(['/recipes/r2', '/plan', `/recipes/r1${TAB}`])).toEqual({
		type: 'replace',
		to: '/recipes',
		label: 'Recipes',
	})
})

test('a restored Recipe whose own entry is gone still finds the list behind it', () => {
	expect(back(['/recipes', '/plan', `/recipes/r1${TAB}`])).toEqual({
		type: 'pop',
		delta: 2,
		label: 'Recipes',
	})
})

test('a Recipe saved from an edit form the tab bar restored goes down its own stack', () => {
	expect(
		back([
			'/recipes',
			'/recipes/r1',
			'/recipes/r1/edit',
			'/plan',
			`/recipes/r1/edit${TAB}`,
			'/recipes/r1',
		]),
	).toEqual({ type: 'pop', delta: 5, label: 'Recipes' })
})

test('Cancel on an edit form the tab bar restored returns to its Recipe, not the Plan', () => {
	expect(
		back(
			[
				'/recipes',
				'/recipes/r1',
				'/recipes/r1/edit',
				'/plan',
				`/recipes/r1/edit${TAB}`,
			],
			recipeEditNav('r1'),
		),
	).toEqual({ type: 'pop', delta: 3, label: 'Recipe' })
})

test('a restored Recipe saved after an edit still goes down its own stack', () => {
	expect(
		back([
			'/recipes',
			'/recipes/r1',
			'/plan',
			`/recipes/r1${TAB}`,
			'/recipes/r1/edit',
			'/recipes/r1',
		]),
	).toEqual({ type: 'pop', delta: 5, label: 'Recipes' })
})

test('a restored Recipe whose stack is from before a reload opens the parent', () => {
	expect(back([null, '/plan', `/recipes/r1${TAB}`])).toEqual({
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

test('a pass-through form does not carry Back past another page of the tab', () => {
	expect(
		back(['/recipes', '/recipes/menus', '/recipes/r1/edit', '/recipes/r1']),
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

test('Settings opened from a Recipe (the desktop header) goes back to it', () => {
	expect(
		back(['/recipes', '/recipes/r1', '/settings/profile'], settingsRootNav),
	).toEqual({
		type: 'pop',
		delta: 1,
		label: 'Recipe',
	})
})

test('Settings steps over the code check a change of email passes through', () => {
	expect(
		back(
			[
				'/plan',
				'/settings/profile',
				'/settings/profile/change-email',
				'/verify',
				'/settings/profile',
			],
			settingsRootNav,
		),
	).toEqual({ type: 'pop', delta: 4, label: 'Plan' })
})

test('Settings and Upgrade do not go back to sign-in', () => {
	expect(back(['/login', '/settings/profile'], settingsRootNav)).toEqual({
		type: 'replace',
		to: '/recipes',
		label: 'Recipes',
	})
	expect(back(['/login', '/upgrade'], upgradeNav)).toEqual({
		type: 'replace',
		to: '/settings/profile',
		label: 'Settings',
	})
})

test('Upgrade goes back to the page whose Pro notice opened it', () => {
	expect(back(['/plan', '/upgrade'], upgradeNav)).toEqual({
		type: 'pop',
		delta: 1,
		label: 'Plan',
	})
	expect(back(['/settings/profile/household', '/upgrade'], upgradeNav)).toEqual(
		{ type: 'pop', delta: 1, label: 'Settings' },
	)
	expect(back(['/upgrade'], upgradeNav)).toEqual({
		type: 'replace',
		to: '/settings/profile',
		label: 'Settings',
	})
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

test('the log keeps whether the tab bar opened an entry', () => {
	const log = recordHistoryEntry(logOf('/recipes', '/plan'), {
		idx: 2,
		pathname: '/recipes/r1',
		search: '',
		viaTabBar: true,
		action: 'PUSH',
	})
	expect(log).toEqual(logOf('/recipes', '/plan', `/recipes/r1${TAB}`))
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
