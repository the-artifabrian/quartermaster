import { Link, type LinkProps } from 'react-router'
import { OPEN_DETAIL } from '#app/utils/nav-direction.ts'
import { useIsNativeShell } from '#app/utils/request-info.ts'

/**
 * Link state for a push: the forward marker (nav-direction.ts), merged under
 * whatever state the link carries itself.
 */
function pushState(state?: unknown) {
	return typeof state === 'object' && state !== null
		? { ...OPEN_DETAIL, ...state }
		: OPEN_DETAIL
}

/**
 * A link to a page with a nav bar (its route `handle` declares `nav`). In the
 * iOS app it slides the page in from the right, as a native push does, and
 * the nav bar's Back slides it out again. Outside the app it is a plain link,
 * unless `viewTransition` asks for the cross-fade (a Recipe card).
 */
export function PushLink({ state, viewTransition, ...props }: LinkProps) {
	const isNativeShell = useIsNativeShell()
	return (
		<Link
			{...props}
			state={pushState(state)}
			viewTransition={isNativeShell || viewTransition}
		/>
	)
}
