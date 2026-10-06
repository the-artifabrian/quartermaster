import { useEffect, useLayoutEffect, useRef } from 'react'
import {
	type NavigationType,
	useLocation,
	useNavigationType,
} from 'react-router'

/**
 * Which way a view transition moves the page. tailwind.css keys the
 * `::view-transition-*` rules on `<html data-nav-direction>`: `forward`
 * slides the new page in from the right, `back` slides the old page out to
 * the right, `none` skips the animation, and no attribute keeps the
 * cross-fade (tab switches).
 */
export type NavDirection = 'forward' | 'back' | 'none'

/** Link state for opening a detail page from its list. */
export const OPEN_DETAIL = { navDirection: 'forward' } as const
/** Link state for an in-page link back to the list. */
export const BACK_TO_LIST = { navDirection: 'back' } as const

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
}: {
	type: NavigationType | `${NavigationType}`
	from: unknown
	to: unknown
	historyMove?: 'back' | 'forward'
	hasUAVisualTransition?: boolean
}): NavDirection | null {
	if (type !== 'POP') return markedDirection(to)
	// The system's back swipe already animated the page.
	if (hasUAVisualTransition) return 'none'
	if (historyMove === 'forward') return markedDirection(to)
	return markedDirection(from) === 'forward' ? 'back' : null
}

/** React Router numbers its history entries in `history.state.idx`. */
function historyIndex() {
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
		})
		popHadUATransition.current = false
		const root = document.documentElement
		if (direction) root.dataset.navDirection = direction
		else delete root.dataset.navDirection
	}, [location.key, location.state, type])
}
