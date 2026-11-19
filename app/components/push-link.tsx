import { Link, type LinkProps } from 'react-router'
import { OPEN_DETAIL } from '#app/utils/nav-direction.ts'
import { useIsNativeShell } from '#app/utils/request-info.ts'
import { isNormalLinkActivation } from './bottom-nav.tsx'
import { dismissSheetForPush } from './ui/bottom-sheet.tsx'

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
 * A menu or sheet the push starts from goes at once, before the leaving
 * page's picture is taken: iOS dismisses it as the push begins. A menu then
 * closes as it does on any pick, unseen.
 */
function dismissOverlays(link: HTMLAnchorElement) {
	link
		.closest('[data-radix-popper-content-wrapper]')
		?.setAttribute('data-push-dismissed', '')
	dismissSheetForPush(link)
}

/**
 * A link to a page with a nav bar (its route `handle` declares `nav`). In the
 * iOS app it slides the page in from the right, as a native push does, and
 * the nav bar's Back slides it out again. Outside the app it is a plain link,
 * unless `viewTransition` asks for the cross-fade (a Recipe card).
 */
export function PushLink({
	state,
	viewTransition,
	onClick,
	...props
}: LinkProps) {
	const isNativeShell = useIsNativeShell()
	const transitions = isNativeShell || viewTransition === true
	return (
		<Link
			{...props}
			state={pushState(state)}
			viewTransition={transitions}
			onClick={(event) => {
				onClick?.(event)
				if (event.defaultPrevented || !isNormalLinkActivation(event)) return
				if (transitions) dismissOverlays(event.currentTarget)
			}}
		/>
	)
}
