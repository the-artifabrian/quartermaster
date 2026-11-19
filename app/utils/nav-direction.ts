import { useEffect, useLayoutEffect, useRef } from 'react'
import {
	type NavigationType,
	useLocation,
	useNavigationType,
} from 'react-router'
import { noteCommit, notePopState } from './history-traversal.ts'

/**
 * Which way a view transition moves the page. tailwind.css keys the
 * `::view-transition-*` rules on `<html data-nav-direction>`: `forward`
 * slides the new page in from the right, `back` slides the old page out to
 * the right, `none` skips the animation, and no attribute keeps the
 * cross-fade (a detail page in Safari or the Home Screen install). A tab
 * switch starts no view transition at all.
 */
export type NavDirection = 'forward' | 'back' | 'none'

/** Link state for opening a detail page from its list. */
export const OPEN_DETAIL = { navDirection: 'forward' } as const
/** Link state for an in-page link back to the list. */
export const BACK_TO_LIST = { navDirection: 'back' } as const
/**
 * Link state for the tab bar. A tab whose page is not its root restores that
 * page, continuing the tab's stack (nav-back.ts walks past the other tabs).
 */
export const VIA_TAB_BAR = { viaTabBar: true } as const

export function isViaTabBar(state: unknown) {
	return (
		typeof state === 'object' &&
		state !== null &&
		(state as { viaTabBar?: unknown }).viaTabBar === true
	)
}

// The nav bar's Back pops history; the pop it starts slides back even when
// the page it leaves was not opened with a forward slide (a Recipe the edit
// form's Save redirected to).
let backButtonPop = false
export function markBackButtonPop() {
	backButtonPop = true
}
/**
 * Clears the mark and says whether it was set. An edit screen that holds a
 * pop back to ask first takes it, so a Keep Editing does not leave it for the
 * next navigation, and puts it back on Discard.
 */
export function takeBackButtonPop() {
	const marked = backButtonPop
	backButtonPop = false
	return marked
}

function markedDirection(state: unknown) {
	if (typeof state !== 'object' || state === null) return null
	const direction = (state as { navDirection?: unknown }).navDirection
	return direction === 'forward' || direction === 'back' ? direction : null
}

/**
 * A push follows its link's marker. Going back undoes the entry it leaves, and
 * only a forward-marked one slides back: a back never slides forward. Going
 * forward through history replays the entry it lands on. When the history
 * move is unknown, a pop is treated as a back.
 */
export function getNavDirection({
	type,
	from,
	to,
	historyMove,
	hasUAVisualTransition = false,
	backButton = false,
}: {
	type: NavigationType | `${NavigationType}`
	from: unknown
	to: unknown
	historyMove?: 'back' | 'forward'
	hasUAVisualTransition?: boolean
	/** The nav bar's Back started this pop. */
	backButton?: boolean
}): NavDirection | null {
	if (type !== 'POP') return markedDirection(to)
	// The system's back swipe already animated the page.
	if (hasUAVisualTransition) return 'none'
	if (historyMove === 'forward') return markedDirection(to)
	if (backButton) return 'back'
	return markedDirection(from) === 'forward' ? 'back' : null
}

/** React Router numbers its history entries in `history.state.idx`. */
export function historyIndex() {
	if (typeof window === 'undefined') return null
	const idx = (window.history.state as { idx?: unknown } | null)?.idx
	return typeof idx === 'number' ? idx : null
}

/** Sets `data-nav-direction` on `<html>` for each committed navigation. */
export function useNavDirection() {
	const location = useLocation()
	const type = useNavigationType()
	const previous = useRef<{ state: unknown; idx: number | null } | null>(null)
	const popHadUATransition = useRef(false)

	useEffect(() => {
		const onPopState = (event: PopStateEvent) => {
			notePopState(window.location.pathname + window.location.search)
			popHadUATransition.current =
				(event as PopStateEvent & { hasUAVisualTransition?: boolean })
					.hasUAVisualTransition === true
		}
		window.addEventListener('popstate', onPopState)
		return () => window.removeEventListener('popstate', onPopState)
	}, [])

	// A layout effect, so the attribute is in place before the router's view
	// transition resolves its update and starts the animation.
	useLayoutEffect(() => {
		// Committed: a later load of this URL is a revalidation.
		noteCommit(location.pathname + location.search)
		const left = previous.current
		const idx = historyIndex()
		previous.current = { state: location.state, idx }
		if (!left) return
		const direction = getNavDirection({
			type,
			from: left.state,
			to: location.state,
			historyMove:
				idx === null || left.idx === null || idx === left.idx
					? undefined
					: idx < left.idx
						? 'back'
						: 'forward',
			hasUAVisualTransition: popHadUATransition.current,
			backButton: type === 'POP' && backButtonPop,
		})
		popHadUATransition.current = false
		// Whatever commits next, the mark belonged to it or was left by a pop
		// that never came (a link tapped first).
		backButtonPop = false
		const root = document.documentElement
		if (direction) root.dataset.navDirection = direction
		else delete root.dataset.navDirection
	}, [location.key, location.pathname, location.search, location.state, type])
}
