import { navItems } from '#app/components/bottom-nav.tsx'

/**
 * Where the nav bar's Back (and an edit screen's Cancel) goes. Back undoes
 * the last move.
 *
 * A pushed page names its parent: the page Back opens when there is nothing
 * in the app to return to (a deep link, a universal link, a cold start, a
 * reload). When the history entry behind the page is the parent, another
 * page the rule returns to (a Menu behind one of its Recipes, a Recipe behind
 * a linked Recipe), or a page outside the rule's tab that opened it (the Plan
 * behind tonight's Recipe), Back pops to it instead, so that page keeps its
 * filter and scroll position. Forms that led to the page (the edit form after
 * a save, the new-Recipe form after creating one) are stepped over on the
 * way. So are the other tabs' pages between a page the tab bar restored and
 * the stack it continues.
 *
 * The browser does not say what is behind the current entry, so the app keeps
 * its own log of the entries it has shown, by React Router's history index.
 * Entries from before a reload or a full page load are unknown.
 */

export type HistoryEntry = {
	pathname: string
	search: string
	/** The tab bar opened this entry, continuing the tab's own stack. */
	viaTabBar?: boolean
}
/** In-app history entries by `history.state.idx`; a gap is an entry never seen. */
export type HistoryLog = Readonly<Record<number, HistoryEntry>>

export type NavRule = {
	/** The pathname Back opens when nothing behind the page qualifies. */
	parent: string
	/** Pages besides the parent that Back may pop to. */
	returnsTo?: (pathname: string) => boolean
	/** Pages Back steps over to reach the parent: the forms that led here. */
	stepsOver?: (pathname: string, current: string) => boolean
	/** The tab the page belongs to. A page outside it that opened this one is
	 * where Back returns. */
	tab?: (pathname: string) => boolean
}

export type BackTarget =
	| { type: 'pop'; delta: number; label: string }
	| { type: 'replace'; to: string; label: string }

// The tab bar's roots, plus Menus, the Recipes tab's second library.
const TAB_ROOT_LABELS: Record<string, string> = {
	...Object.fromEntries(navItems.map((item) => [item.to, item.label])),
	'/recipes/menus': 'Menus',
}

const RECIPE_DETAIL = /^\/recipes\/(?!new$|import$|menus$)[^/]+$/
const MENU_DETAIL = /^\/recipes\/menus\/(?!new$)[^/]+$/

function isRecipeDetail(pathname: string) {
	return RECIPE_DETAIL.test(pathname)
}

function isMenuDetail(pathname: string) {
	return MENU_DETAIL.test(pathname)
}

function isInTab(pathname: string, tab: string) {
	return pathname === tab || pathname.startsWith(`${tab}/`)
}

function isRecipesTab(pathname: string) {
	return isInTab(pathname, '/recipes')
}

/** A page of one of the tab bar's tabs: not sign-in, marketing, or Settings. */
function isTabPage(pathname: string) {
	return navItems.some((item) => isInTab(pathname, item.to))
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
	viaTabBar = false,
	rule,
}: {
	idx: number | null
	log: HistoryLog
	pathname: string
	/** The tab bar opened the current entry (it restored the tab's page). */
	viaTabBar?: boolean
	rule: NavRule
}): BackTarget {
	const outsideTab = (p: string) => (rule.tab ? !rule.tab(p) : false)
	if (idx !== null) {
		// Between a page the tab bar restored and the stack it continues lie
		// the other tabs' pages, which did not open it.
		let crossingTabs = viaTabBar
		for (let j = idx - 1; j >= 0; j--) {
			const entry = log[j]
			// An entry the app never saw (before a reload): it could be anything.
			if (!entry) break
			const previous = entry.pathname
			if (previous === pathname) {
				crossingTabs = entry.viaTabBar ?? false
				continue
			}
			if (crossingTabs && outsideTab(previous)) continue
			if (previous === rule.parent || rule.returnsTo?.(previous)) {
				return { type: 'pop', delta: idx - j, label: navLabel(previous) }
			}
			if (rule.stepsOver?.(previous, pathname)) continue
			// Opened from another tab (a planned Recipe from the Plan). Not from
			// sign-in, which a deep link passes through on its way here.
			if (outsideTab(previous) && isTabPage(previous)) {
				return { type: 'pop', delta: idx - j, label: navLabel(previous) }
			}
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
		action,
		...entry
	}: HistoryEntry & { idx: number; action: 'PUSH' | 'REPLACE' | 'POP' },
): HistoryLog {
	const next: Record<number, HistoryEntry> = {}
	for (const [key, known] of Object.entries(log)) {
		const at = Number(key)
		if (action === 'PUSH' && at > idx) continue
		next[at] = known
	}
	next[idx] = entry
	return next
}

// Rules for each pushed page.

export const recipeDetailNav: NavRule = {
	parent: '/recipes',
	tab: isRecipesTab,
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
	tab: isRecipesTab,
	stepsOver: (p, current) =>
		p === `${current}/edit` || p === '/recipes/menus/new',
}

export const menuEditNav = (menuId: string): NavRule => ({
	parent: `/recipes/menus/${menuId}`,
})

export const menuNewNav: NavRule = { parent: '/recipes/menus' }

/**
 * Settings opens from the avatar: on a tab root on phones, on any page of a
 * tab on desktop. It goes back to the page it was opened from, over its own
 * pages and the code check a change of email passes through.
 */
export const settingsRootNav: NavRule = {
	parent: '/recipes',
	returnsTo: isTabPage,
	stepsOver: (p) => isSettingsSubpage(p) || p === '/verify',
}

export const settingsPageNav: NavRule = {
	parent: '/settings/profile',
	stepsOver: isSettingsSubpage,
}

/** Upgrade opens from Settings, Import, or the Pro expiry notice on any page
 * of a tab. */
export const upgradeNav: NavRule = {
	parent: '/settings/profile',
	returnsTo: isTabPage,
}

// The log of entries this document has shown. It lives in memory only:
// React Router numbers a new document's entries from 0 again, so a log kept
// across documents (a reload, a full page load) would describe the wrong
// pages, and Back falls back to the parent instead.

const EMPTY: HistoryLog = Object.freeze({})
let currentLog: HistoryLog = EMPTY
const listeners = new Set<() => void>()

export function getHistoryLog(): HistoryLog {
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
	const known = currentLog[entry.idx]
	if (
		entry.action !== 'PUSH' &&
		known?.pathname === entry.pathname &&
		known.search === entry.search &&
		(known.viaTabBar ?? false) === (entry.viaTabBar ?? false)
	) {
		return
	}
	currentLog = recordHistoryEntry(currentLog, entry)
	for (const listener of listeners) listener()
}
