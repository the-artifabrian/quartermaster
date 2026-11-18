/**
 * Where the nav bar's Back (and an edit screen's Cancel) goes.
 *
 * A pushed page names its parent: the page Back opens when there is nothing
 * in the app to return to (a deep link, a universal link, a cold start, a
 * reload). When the history entry behind the page is the parent, or another
 * page the rule returns to (a Menu behind one of its Recipes, a Recipe behind
 * a linked Recipe), Back pops to it instead, so the list keeps its filter and
 * scroll position. Forms that led to the page (the edit form after a save,
 * the new-Recipe form after creating one) are stepped over on the way.
 *
 * The browser does not say what is behind the current entry, so the app keeps
 * its own log of the entries it has shown, by React Router's history index.
 */

export type HistoryEntry = { pathname: string; search: string }
/** In-app history entries by `history.state.idx`; a gap is an entry never seen. */
export type HistoryLog = Readonly<Record<number, HistoryEntry>>

export type NavRule = {
	/** The pathname Back opens when nothing behind the page qualifies. */
	parent: string
	/** Pages besides the parent that Back may pop to. */
	returnsTo?: (pathname: string) => boolean
	/** Pages Back steps over to reach the parent: the forms that led here. */
	stepsOver?: (pathname: string, current: string) => boolean
}

export type BackTarget =
	| { type: 'pop'; delta: number; label: string }
	| { type: 'replace'; to: string; label: string }

const TAB_ROOT_LABELS: Record<string, string> = {
	'/recipes': 'Recipes',
	'/recipes/menus': 'Menus',
	'/inventory': 'Staples',
	'/plan': 'Plan',
	'/shopping': 'Shopping',
}

const RECIPE_DETAIL = /^\/recipes\/(?!new$|import$|menus$)[^/]+$/
const MENU_DETAIL = /^\/recipes\/menus\/(?!new$)[^/]+$/

function isRecipeDetail(pathname: string) {
	return RECIPE_DETAIL.test(pathname)
}

function isMenuDetail(pathname: string) {
	return MENU_DETAIL.test(pathname)
}

function isTabRoot(pathname: string) {
	return pathname in TAB_ROOT_LABELS
}

function isSettingsSubpage(pathname: string) {
	return pathname.startsWith('/settings/profile/')
}

/** The short name a Back button shows for a page. */
export function navLabel(pathname: string) {
	const tab = TAB_ROOT_LABELS[pathname]
	if (tab) return tab
	if (pathname === '/settings/profile') return 'Settings'
	if (pathname === '/recipes/import') return 'Import'
	if (isMenuDetail(pathname)) return 'Menu'
	if (isRecipeDetail(pathname)) return 'Recipe'
	return 'Back'
}

export function resolveBack({
	idx,
	log,
	pathname,
	rule,
}: {
	idx: number | null
	log: HistoryLog
	pathname: string
	rule: NavRule
}): BackTarget {
	if (idx !== null) {
		for (let j = idx - 1; j >= 0; j--) {
			const entry = log[j]
			// An entry the app never saw (before a reload): it could be anything.
			if (!entry) break
			const previous = entry.pathname
			if (previous === pathname) continue
			if (previous === rule.parent || rule.returnsTo?.(previous)) {
				return { type: 'pop', delta: idx - j, label: navLabel(previous) }
			}
			if (rule.stepsOver?.(previous, pathname)) continue
			break
		}
	}
	return { type: 'replace', to: rule.parent, label: navLabel(rule.parent) }
}

/**
 * The log after the router lands on entry `idx`. A push starts a new branch,
 * so the entries that were ahead of it are gone.
 */
export function recordHistoryEntry(
	log: HistoryLog,
	{
		idx,
		pathname,
		search,
		action,
	}: HistoryEntry & { idx: number; action: 'PUSH' | 'REPLACE' | 'POP' },
): HistoryLog {
	const next: Record<number, HistoryEntry> = {}
	for (const [key, entry] of Object.entries(log)) {
		const at = Number(key)
		if (action === 'PUSH' && at > idx) continue
		next[at] = entry
	}
	next[idx] = { pathname, search }
	return next
}

// Rules for each pushed page.

export const recipeDetailNav: NavRule = {
	parent: '/recipes',
	returnsTo: (p) => isMenuDetail(p) || isRecipeDetail(p),
	stepsOver: (p, current) =>
		p === `${current}/edit` || p === '/recipes/new' || p === '/recipes/import',
}

export const recipeEditNav = (recipeId: string): NavRule => ({
	parent: `/recipes/${recipeId}`,
})

export const recipeNewNav: NavRule = { parent: '/recipes' }

export const recipeImportNav: NavRule = { parent: '/recipes' }

export const menuDetailNav: NavRule = {
	parent: '/recipes/menus',
	stepsOver: (p, current) =>
		p === `${current}/edit` || p === '/recipes/menus/new',
}

export const menuEditNav = (menuId: string): NavRule => ({
	parent: `/recipes/menus/${menuId}`,
})

export const menuNewNav: NavRule = { parent: '/recipes/menus' }

/**
 * Settings opens from the avatar, which only the tab roots show, so it goes
 * back to the tab it was opened from.
 */
export const settingsRootNav: NavRule = {
	parent: '/recipes',
	returnsTo: isTabRoot,
	stepsOver: isSettingsSubpage,
}

export const settingsPageNav: NavRule = {
	parent: '/settings/profile',
	stepsOver: isSettingsSubpage,
}

export const upgradeNav: NavRule = {
	parent: '/settings/profile',
	returnsTo: (p) => p === '/recipes/import',
}

// The log of entries this tab has shown. It lives in sessionStorage so a
// reload keeps it: the browser keeps the history across one, and React
// Router keeps its index in `history.state`.

const STORAGE_KEY = 'qm-history-log'
const EMPTY: HistoryLog = Object.freeze({})
let currentLog: HistoryLog | null = null
const listeners = new Set<() => void>()

function loadLog(): HistoryLog {
	try {
		const raw = window.sessionStorage.getItem(STORAGE_KEY)
		const parsed: unknown = raw ? JSON.parse(raw) : null
		if (parsed && typeof parsed === 'object') return parsed as HistoryLog
	} catch {
		// Storage blocked or garbled: start empty, Back falls back to parents.
	}
	return EMPTY
}

export function getHistoryLog(): HistoryLog {
	if (typeof window === 'undefined') return EMPTY
	currentLog ??= loadLog()
	return currentLog
}

export function getServerHistoryLog(): HistoryLog {
	return EMPTY
}

export function subscribeHistoryLog(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function recordHistory(
	entry: HistoryEntry & { idx: number; action: 'PUSH' | 'REPLACE' | 'POP' },
) {
	const log = getHistoryLog()
	const known = log[entry.idx]
	if (
		entry.action !== 'PUSH' &&
		known?.pathname === entry.pathname &&
		known.search === entry.search
	) {
		return
	}
	currentLog = recordHistoryEntry(log, entry)
	try {
		window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(currentLog))
	} catch {
		// The in-memory log still serves this page load.
	}
	for (const listener of listeners) listener()
}

/** React Router numbers its history entries in `history.state.idx`. */
export function historyIndex() {
	if (typeof window === 'undefined') return null
	const idx = (window.history.state as { idx?: unknown } | null)?.idx
	return typeof idx === 'number' ? idx : null
}
