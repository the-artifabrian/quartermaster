import {
	type MouseEvent as ReactMouseEvent,
	useEffect,
	useRef,
	useState,
} from 'react'
import { NavLink, useLocation, useNavigate, useNavigation } from 'react-router'
import { cn } from '#app/utils/misc.tsx'
import { useIsNativeShell } from '#app/utils/request-info.ts'
import { haptic } from '#app/utils/shell-bridge.ts'
import { useIsProActive } from '#app/utils/subscription.ts'
import { useShoppingActivityDot } from '#app/utils/use-shopping-activity-dot.ts'
import { useOptionalUser } from '#app/utils/user.ts'
import { type BottomNavDestination, useBottomNavTiming } from './nav-timing.tsx'
import { Icon, type IconName } from './ui/icon.tsx'

type NavItem = {
	to: string
	icon: IconName
	iconFilled: IconName
	label: string
	destination: BottomNavDestination
	matchPaths?: string[]
}

const navItems: NavItem[] = [
	{
		to: '/recipes',
		icon: 'cookie' as IconName,
		iconFilled: 'cookie-filled' as IconName,
		label: 'Recipes',
		destination: 'recipes',
		matchPaths: ['/recipes'],
	},
	{
		to: '/inventory',
		icon: 'file-text' as IconName,
		iconFilled: 'file-text-filled' as IconName,
		label: 'Staples',
		destination: 'staples',
		matchPaths: ['/inventory'],
	},
	{
		to: '/plan',
		icon: 'calendar' as IconName,
		iconFilled: 'calendar-filled' as IconName,
		label: 'Plan',
		destination: 'plan',
		matchPaths: ['/plan'],
	},
	{
		to: '/shopping',
		icon: 'cart' as IconName,
		iconFilled: 'cart-filled' as IconName,
		label: 'Shop',
		destination: 'shop',
		matchPaths: ['/shopping'],
	},
]

function isNormalLinkActivation(event: ReactMouseEvent<HTMLAnchorElement>) {
	return (
		event.button === 0 &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		!event.altKey &&
		(!event.currentTarget.target || event.currentTarget.target === '_self')
	)
}

function pathIsInTab(path: string | undefined, tabPath: string) {
	return path === tabPath || path?.startsWith(`${tabPath}/`) === true
}

export function BottomNav() {
	const location = useLocation()
	const navigation = useNavigation()
	const navigate = useNavigate()
	const user = useOptionalUser()
	const isNativeShell = useIsNativeShell()
	const isProActive = useIsProActive()
	const showShoppingDot = useShoppingActivityDot(isProActive)
	const timing = useBottomNavTiming()
	const lastPathPerTab = useRef<Record<string, string>>({})
	const inputRef = useRef<{ tabPath: string; startedAt: number } | null>(null)
	const pendingStartedRef = useRef(false)
	// The tab a press already switched to, so the click that follows the press
	// does not switch a second time.
	const pressNavigatedRef = useRef<string | null>(null)
	const [pressedTab, setPressedTab] = useState<string | null>(null)
	const [pendingInput, setPendingInput] = useState<{
		tabPath: string
		startedAt: number
		fromLocationKey: string
		supersededPathname: string | undefined
	} | null>(null)

	// Track the last visited path for each tab section
	useEffect(() => {
		for (const item of navItems) {
			const matches = item.matchPaths?.some((path) =>
				location.pathname.startsWith(path),
			)
			if (matches) {
				lastPathPerTab.current[item.to] = location.pathname + location.search
				break
			}
		}
	}, [location.pathname, location.search])

	useEffect(() => {
		if (!pendingInput) return
		const clearPending = () => {
			timing.cancel(pendingInput.startedAt)
			pendingStartedRef.current = false
			setPendingInput(null)
		}

		// A committed destination, error boundary, back/forward action, or redirect
		// replaces the location key. The committed tab styling can take over.
		if (location.key !== pendingInput.fromLocationKey) {
			clearPending()
			return
		}

		if (navigation.state !== 'idle') {
			const pathname = navigation.location?.pathname
			if (pathIsInTab(pathname, pendingInput.tabPath)) {
				pendingStartedRef.current = true
			} else if (pathname && pathname !== pendingInput.supersededPathname) {
				// The navigation this tap interrupted can still be reported until
				// the router starts the new one (it may first discover the route),
				// so only a different destination means the tap went elsewhere.
				clearPending()
			}
			return
		}

		if (pendingStartedRef.current) {
			clearPending()
		}
	}, [
		location.key,
		navigation.location?.pathname,
		navigation.state,
		pendingInput,
		timing,
	])

	const startTabNavigation = (
		item: NavItem,
		destinationPath: string,
		startedAt: number,
	) => {
		inputRef.current = null
		pendingStartedRef.current = false
		setPendingInput({
			tabPath: item.to,
			startedAt,
			fromLocationKey: location.key,
			supersededPathname:
				navigation.state === 'idle' ? undefined : navigation.location?.pathname,
		})
		timing.begin({
			destination: item.destination,
			destinationPath,
			tabPath: item.to,
			startedAt,
		})
	}

	if (!user) return null

	return (
		<nav
			aria-label="Main"
			data-bottom-nav=""
			className="bg-card/95 border-border fixed inset-x-0 bottom-0 z-50 border-t pb-(--bottom-nav-inset) backdrop-blur-sm md:hidden print:hidden"
		>
			<div
				// --bottom-nav-h: a 54pt row in the iOS app, where the links take more
				// padding above the icon than below the label so the icons sit as far
				// below the bar's edge as the labels sit above the home indicator;
				// --bottom-nav-inset keeps the labels just clear of it.
				className="grid h-(--bottom-nav-h) grid-cols-4 items-center"
			>
				{navItems.map((item) => {
					const isActive = item.matchPaths?.some((path) =>
						path === '/'
							? location.pathname === '/'
							: location.pathname.startsWith(path),
					)
					const isOnSubPage = isActive && location.pathname !== item.to
					// Switching tabs: restore last position. Active tab on sub-page: go to root.
					const linkTo = isActive
						? item.to
						: (lastPathPerTab.current[item.to] ?? item.to)
					const isPressed = pressedTab === item.to
					const isPending = pendingInput?.tabPath === item.to
					// As in a native tab bar, the tab being switched to looks selected
					// at once and the one being left does not. aria-current stays
					// with the page that is showing.
					const isSelected = pendingInput ? isPending : isActive
					const iconName = isSelected ? item.iconFilled : item.icon
					// Single fetch would otherwise rerun the root loader on every tab
					// switch, so even a page from the loader cache waited on a round
					// trip. A pending toast still revalidates it (root
					// shouldRevalidate), and so does the cached page's revalidation.
					// Only between tabs: the target page is then always a new route,
					// which loads anyway, while within a tab the same route with a
					// different search must still load.
					const defaultShouldRevalidate = isActive ? undefined : false

					return (
						<NavLink
							key={item.to}
							to={linkTo}
							defaultShouldRevalidate={defaultShouldRevalidate}
							viewTransition
							aria-busy={isPending || undefined}
							data-bottom-nav-tab={item.destination}
							data-pending={isPending ? 'true' : undefined}
							data-pressed={isPressed ? 'true' : undefined}
							onPointerDown={(event) => {
								if (event.button !== 0 || !event.isPrimary) return
								const startedAt = performance.now()
								setPressedTab(item.to)
								if (
									event.metaKey ||
									event.ctrlKey ||
									event.shiftKey ||
									event.altKey
								) {
									// A modified press belongs to the browser (new tab or
									// window); the click decides.
									pressNavigatedRef.current = null
									inputRef.current = { tabPath: item.to, startedAt }
									return
								}
								// Switch on the press, as a native tab bar does, not on the
								// click that follows once the finger lifts. The bar is fixed
								// and does not scroll, so a press on it is a tap.
								pressNavigatedRef.current = item.to
								// A press on the tab the router is already switching to starts
								// nothing new. A pending look left by a blocked navigation does
								// not count.
								if (
									isPending &&
									navigation.state !== 'idle' &&
									pathIsInTab(navigation.location?.pathname, item.to)
								)
									return
								if (isOnSubPage) delete lastPathPerTab.current[item.to]
								haptic('selection')
								startTabNavigation(item, linkTo, startedAt)
								void navigate(linkTo, {
									viewTransition: true,
									defaultShouldRevalidate,
								})
							}}
							onPointerUp={() => setPressedTab(null)}
							onPointerCancel={() => {
								// No click follows a cancelled press.
								pressNavigatedRef.current = null
								if (inputRef.current?.tabPath === item.to)
									inputRef.current = null
								setPressedTab(null)
							}}
							onPointerLeave={(event) => {
								if (event.pointerType !== 'mouse') return
								if (inputRef.current?.tabPath === item.to)
									inputRef.current = null
								setPressedTab(null)
							}}
							onKeyDown={(event) => {
								if (event.key !== 'Enter' || event.repeat) return
								inputRef.current = {
									tabPath: item.to,
									startedAt: performance.now(),
								}
								setPressedTab(item.to)
							}}
							onKeyUp={(event) => {
								if (event.key === 'Enter') setPressedTab(null)
							}}
							onBlur={() => {
								// Pressing another tab blurs this one after that press set the
								// ref; clearing it then let the press's click navigate again.
								if (pressNavigatedRef.current === item.to)
									pressNavigatedRef.current = null
								inputRef.current = null
								setPressedTab(null)
							}}
							onClick={(event) => {
								// A keyboard click has detail 0; a pointer click follows the
								// press that already switched.
								if (event.detail > 0 && pressNavigatedRef.current === item.to) {
									pressNavigatedRef.current = null
									event.preventDefault()
									return
								}
								pressNavigatedRef.current = null
								if (isOnSubPage) delete lastPathPerTab.current[item.to]
								if (!isNormalLinkActivation(event) || event.defaultPrevented)
									return
								// Only a click no press switched gets here (the keyboard's), so
								// one tap gives one haptic.
								haptic('selection')

								const startedAt =
									inputRef.current?.tabPath === item.to
										? inputRef.current.startedAt
										: performance.now()
								setPressedTab(null)
								startTabNavigation(item, linkTo, startedAt)
							}}
							className={cn(
								'flex flex-col items-center justify-center transition-[color,transform] duration-150',
								isNativeShell ? 'gap-0.5 pt-2 pb-1' : 'gap-1 py-2',
								isSelected
									? 'text-primary'
									: 'text-muted-foreground hover:text-foreground',
								isPressed && 'scale-[0.97]',
								isPressed && !isSelected && 'text-foreground',
							)}
						>
							<span className="relative flex">
								<Icon name={iconName} size="lg" />
								{item.to === '/shopping' && showShoppingDot && (
									<span
										data-testid="shopping-activity-dot"
										className="bg-accent absolute -top-0.5 -right-0.5 size-2 rounded-full"
									/>
								)}
							</span>
							<span
								className={cn('text-xs leading-4', isSelected && 'font-medium')}
							>
								{item.label}
							</span>
						</NavLink>
					)
				})}
			</div>
		</nav>
	)
}
