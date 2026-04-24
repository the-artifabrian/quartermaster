import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router'
import { cn } from '#app/utils/misc.tsx'
import { useIsProActive } from '#app/utils/subscription.ts'
import { useShoppingActivityDot } from '#app/utils/use-shopping-activity-dot.ts'
import { useOptionalUser } from '#app/utils/user.ts'
import { Icon, type IconName } from './ui/icon.tsx'

type NavItem = {
	to: string
	icon: IconName
	iconFilled: IconName
	label: string
	matchPaths?: string[]
}

const navItems: NavItem[] = [
	{
		to: '/recipes',
		icon: 'cookie' as IconName,
		iconFilled: 'cookie-filled' as IconName,
		label: 'Recipes',
		matchPaths: ['/recipes'],
	},
	{
		to: '/inventory',
		icon: 'file-text' as IconName,
		iconFilled: 'file-text-filled' as IconName,
		label: 'Pantry',
		matchPaths: ['/inventory'],
	},
	{
		to: '/plan',
		icon: 'calendar' as IconName,
		iconFilled: 'calendar-filled' as IconName,
		label: 'Plan',
		matchPaths: ['/plan'],
	},
	{
		to: '/shopping',
		icon: 'cart' as IconName,
		iconFilled: 'cart-filled' as IconName,
		label: 'Shop',
		matchPaths: ['/shopping'],
	},
]

export function BottomNav() {
	const location = useLocation()
	const user = useOptionalUser()
	const isProActive = useIsProActive()
	const showShoppingDot = useShoppingActivityDot(isProActive)
	const lastPathPerTab = useRef<Record<string, string>>({})

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

	if (!user) return null

	return (
		<nav
			aria-label="Main"
			className="bg-card/95 border-border fixed inset-x-0 bottom-0 z-50 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden print:hidden"
		>
			<div className="grid h-16 grid-cols-4 items-center">
				{navItems.map((item) => {
					const isActive = item.matchPaths?.some((path) =>
						path === '/'
							? location.pathname === '/'
							: location.pathname.startsWith(path),
					)
					const iconName = isActive ? item.iconFilled : item.icon
					const isOnSubPage = isActive && location.pathname !== item.to
					// Switching tabs: restore last position. Active tab on sub-page: go to root.
					const linkTo = isActive
						? item.to
						: (lastPathPerTab.current[item.to] ?? item.to)

					return (
						<NavLink
							key={item.to}
							to={linkTo}
							onClick={
								isOnSubPage
									? () => {
											delete lastPathPerTab.current[item.to]
										}
									: undefined
							}
							className={cn(
								'relative flex flex-col items-center justify-center gap-1 py-2 transition-colors duration-200',
								isActive
									? 'text-primary'
									: 'text-muted-foreground hover:text-foreground',
							)}
						>
							<span className="relative">
								<Icon name={iconName} size="lg" />
								{item.to === '/shopping' && showShoppingDot && (
									<span className="bg-accent absolute -top-0.5 -right-0.5 size-2 rounded-full" />
								)}
							</span>
							<span
								className={cn('text-xs leading-4', isActive && 'font-medium')}
							>
								{item.label}
							</span>
							{isActive && (
								<span className="bg-accent absolute bottom-1 h-0.5 w-4 rounded-full" />
							)}
						</NavLink>
					)
				})}
			</div>
		</nav>
	)
}
