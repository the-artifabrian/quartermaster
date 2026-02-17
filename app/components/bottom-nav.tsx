import { NavLink, useLocation } from 'react-router'
import { cn } from '#app/utils/misc.tsx'
import { useIsProActive } from '#app/utils/subscription.ts'
import { useOptionalUser } from '#app/utils/user.ts'
import { Icon, type IconName } from './ui/icon.tsx'

type NavItem = {
	to: string
	icon: IconName
	label: string
	matchPaths?: string[]
}

const navItems: NavItem[] = [
	{
		to: '/recipes',
		icon: 'cookie' as IconName,
		label: 'Recipes',
		matchPaths: ['/recipes'],
	},
	{
		to: '/inventory',
		icon: 'file-text' as IconName,
		label: 'Inventory',
		matchPaths: ['/inventory'],
	},
	{
		to: '/plan',
		icon: 'clock' as IconName,
		label: 'Plan',
		matchPaths: ['/plan'],
	},
	{
		to: '/shopping',
		icon: 'cart' as IconName,
		label: 'Shop',
		matchPaths: ['/shopping'],
	},
]

const PRO_PATHS = new Set(['/inventory', '/plan', '/shopping'])

export function BottomNav() {
	const location = useLocation()
	const user = useOptionalUser()
	const isPro = useIsProActive()

	if (!user) return null

	const activeIndex = navItems.findIndex((item) =>
		item.matchPaths?.some((path) =>
			path === '/'
				? location.pathname === '/'
				: location.pathname.startsWith(path),
		),
	)

	return (
		<nav
			aria-label="Main"
			className="bg-card/95 border-border/50 fixed inset-x-0 bottom-0 z-50 border-t pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_3px_oklch(20%_0.01_55/0.05)] backdrop-blur-sm md:hidden print:hidden"
		>
			<div className="relative flex h-16 items-center justify-around">
				{/* Sliding pill indicator */}
				{activeIndex >= 0 && (
					<div
						className="bg-primary/10 absolute top-1/2 h-11 w-[calc(25%-8px)] -translate-y-1/2 rounded-xl transition-[left] duration-300 ease-out"
						style={{
							left: `calc(${activeIndex} * 25% + 4px)`,
						}}
					/>
				)}
				{navItems.map((item) => {
					const isActive = item.matchPaths?.some((path) =>
						path === '/'
							? location.pathname === '/'
							: location.pathname.startsWith(path),
					)
					const isLocked = !isPro && PRO_PATHS.has(item.to)

					return (
						<NavLink
							key={item.to}
							to={item.to}
							className={cn(
								'relative z-10 flex flex-col items-center justify-center gap-1 px-4 py-2 transition-colors duration-200',
								isActive
									? 'text-primary'
									: 'text-muted-foreground hover:text-foreground',
							)}
						>
							<Icon name={isLocked ? 'lock-closed' : item.icon} size="lg" />
							<span className={cn('text-xs leading-4', isActive && 'font-semibold')}>
								{item.label}
							</span>
						</NavLink>
					)
				})}
			</div>
		</nav>
	)
}
