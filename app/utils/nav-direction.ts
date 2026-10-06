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
 * A push follows its link's marker. A pop undoes the entry it leaves, or
 * replays the entry it lands on when going forward through history.
 */
export function getNavDirection({
	type,
	from,
	to,
	hasUAVisualTransition = false,
}: {
	type: NavigationType | `${NavigationType}`
	from: unknown
	to: unknown
	hasUAVisualTransition?: boolean
}): NavDirection | null {
	if (type !== 'POP') return markedDirection(to)
	// The system's back swipe already animated the page.
	if (hasUAVisualTransition) return 'none'
	const leaving = markedDirection(from)
	if (leaving) return leaving === 'forward' ? 'back' : 'forward'
	return markedDirection(to)
}

/** Sets `data-nav-direction` on `<html>` for each committed navigation. */
export function useNavDirection() {
	const location = useLocation()
	const type = useNavigationType()
	const previousState = useRef<{ state: unknown } | null>(null)
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
		const previous = previousState.current
		previousState.current = { state: location.state }
		if (!previous) return
		const direction = getNavDirection({
			type,
			from: previous.state,
			to: location.state,
			hasUAVisualTransition: popHadUATransition.current,
		})
		popHadUATransition.current = false
		const root = document.documentElement
		if (direction) root.dataset.navDirection = direction
		else delete root.dataset.navDirection
	}, [location.key, location.state, type])
}
