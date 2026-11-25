import { expect, test } from 'vitest'
import {
	type HistoryEntry,
	type HistoryLog,
	menuDetailNav,
	menuNewNav,
	recipeDetailNav,
	recipeEditNav,
	menuPages,
	recipePages,
	recordHistoryEntry,
	resolveAfterDelete,
	resolveAfterSave,
	resolveBack,
	settingsPageNav,
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

test('Upgrade does not go back to sign-in', () => {
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

test('a Settings page the tab bar restored goes back to Settings, past the other tabs', () => {
	expect(
		back(
			[
				'/settings/profile',
				'/settings/profile/household',
				'/plan',
				`/settings/profile/household${TAB}`,
			],
			settingsPageNav,
		),
	).toEqual({ type: 'pop', delta: 3, label: 'Settings' })
})

test('a Settings page the tab bar restored, with no Settings behind it, opens Settings in its place', () => {
	expect(
		back(['/plan', `/settings/profile/passkeys${TAB}`], settingsPageNav),
	).toEqual({ type: 'replace', to: '/settings/profile', label: 'Settings' })
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

// After a Save or a Delete, an edit screen leaves as if it was dismissed:
// what is behind the page it lands on is what was behind the edit screen.

function afterSave(paths: Array<string | null>, to: string) {
	return resolveAfterSave({
		idx: paths.length - 1,
		log: logOf(...paths),
		to,
	})
}

function afterDelete(
	paths: Array<string | null>,
	gone = recipePages('r1'),
	to = '/recipes',
) {
	return resolveAfterDelete({
		idx: paths.length - 1,
		log: logOf(...paths),
		to,
		gone,
	})
}

test('Save from an edit screen opened from its Recipe pops back to that Recipe', () => {
	expect(
		afterSave(['/recipes', '/recipes/r1', '/recipes/r1/edit'], '/recipes/r1'),
	).toEqual({ type: 'pop', delta: 1 })
})

test('Save pops back to a scaled Recipe too, keeping its search', () => {
	expect(
		afterSave(['/recipes/r1?scale=2', '/recipes/r1/edit'], '/recipes/r1'),
	).toEqual({ type: 'pop', delta: 1 })
})

test('Save on a deep-linked edit screen opens the Recipe in its place', () => {
	expect(afterSave(['/recipes/r1/edit'], '/recipes/r1')).toEqual({
		type: 'replace',
		to: '/recipes/r1',
	})
})

test('Save after a reload, with the entry behind unknown, opens the Recipe in its place', () => {
	expect(afterSave([null, '/recipes/r1/edit'], '/recipes/r1')).toEqual({
		type: 'replace',
		to: '/recipes/r1',
	})
})

test('Save never pops to another page behind the edit screen', () => {
	expect(afterSave(['/recipes', '/recipes/r1/edit'], '/recipes/r1')).toEqual({
		type: 'replace',
		to: '/recipes/r1',
	})
	expect(afterSave(['/recipes/r2', '/recipes/r1/edit'], '/recipes/r1')).toEqual(
		{ type: 'replace', to: '/recipes/r1' },
	)
})

test('Save with no history index (before hydration) opens the page in place', () => {
	expect(
		resolveAfterSave({
			idx: null,
			log: logOf('/recipes/r1'),
			to: '/recipes/r1',
		}),
	).toEqual({ type: 'replace', to: '/recipes/r1' })
})

test('Delete from list, Recipe, edit pops back to the list', () => {
	expect(
		afterDelete(['/plan', '/recipes', '/recipes/r1', '/recipes/r1/edit']),
	).toEqual({ type: 'pop', delta: 2 })
})

test('Delete pops back to a filtered list, keeping its search', () => {
	expect(
		afterDelete(['/recipes?q=soup', '/recipes/r1', '/recipes/r1/edit']),
	).toEqual({ type: 'pop', delta: 2 })
})

test('Delete steps over every entry of the deleted Recipe directly behind', () => {
	expect(
		afterDelete([
			'/recipes',
			'/recipes/r1',
			'/recipes/r1/edit',
			'/recipes/r1',
			'/recipes/r1/edit',
		]),
	).toEqual({ type: 'pop', delta: 4 })
})

test('Delete of a Recipe opened from the Plan puts the list where the Recipe was', () => {
	// Older entries of the Recipe behind the Plan stay; going back to one opens
	// the list in its place (gone-item.tsx).
	expect(afterDelete(['/plan', '/recipes/r1', '/recipes/r1/edit'])).toEqual({
		type: 'pop-replace',
		delta: 1,
		to: '/recipes',
	})
})

test('Delete of a cold-started Recipe puts the list where the Recipe was', () => {
	expect(afterDelete(['/recipes/r1', '/recipes/r1/edit'])).toEqual({
		type: 'pop-replace',
		delta: 1,
		to: '/recipes',
	})
})

test('Delete after a reload replaces the known Recipe entries; unknown ones are left to going back (gone-item.tsx)', () => {
	expect(afterDelete([null, '/recipes/r1', '/recipes/r1/edit'])).toEqual({
		type: 'pop-replace',
		delta: 1,
		to: '/recipes',
	})
})

test('Delete on a deep-linked edit screen opens the list in its place', () => {
	expect(afterDelete(['/recipes/r1/edit'])).toEqual({
		type: 'replace',
		to: '/recipes',
	})
	expect(afterDelete([null, '/recipes/r1/edit'])).toEqual({
		type: 'replace',
		to: '/recipes',
	})
})

test('Delete with another page right behind the edit screen opens the list in its place', () => {
	expect(afterDelete(['/plan', '/recipes/r1/edit'])).toEqual({
		type: 'replace',
		to: '/recipes',
	})
})

test('Delete does not step over another Recipe that only shares the id prefix', () => {
	expect(
		afterDelete([
			'/recipes',
			'/recipes/r10',
			'/recipes/r1',
			'/recipes/r1/edit',
		]),
	).toEqual({ type: 'pop-replace', delta: 1, to: '/recipes' })
})

test('Delete with no history index opens the list in place', () => {
	expect(
		resolveAfterDelete({
			idx: null,
			log: logOf('/recipes', '/recipes/r1'),
			to: '/recipes',
			gone: recipePages('r1'),
		}),
	).toEqual({ type: 'replace', to: '/recipes' })
})

test('Delete of a Menu pops back to Menus over the Menu and its edit screen', () => {
	expect(
		afterDelete(
			['/recipes/menus', '/recipes/menus/m1', '/recipes/menus/m1/edit'],
			menuPages('m1'),
			'/recipes/menus',
		),
	).toEqual({ type: 'pop', delta: 2 })
})

test("a Recipe's pages are its own page and its edit screen, nothing else", () => {
	const gone = recipePages('r1')
	expect(gone('/recipes/r1')).toBe(true)
	expect(gone('/recipes/r1/edit')).toBe(true)
	expect(gone('/recipes/r10')).toBe(false)
	expect(gone('/recipes/r1x/edit')).toBe(false)
	expect(gone('/recipes')).toBe(false)
	const menu = menuPages('m1')
	expect(menu('/recipes/menus/m1')).toBe(true)
	expect(menu('/recipes/menus/m1/edit')).toBe(true)
	expect(menu('/recipes/menus/m10')).toBe(false)
	expect(menu('/recipes/m1')).toBe(false)
})
