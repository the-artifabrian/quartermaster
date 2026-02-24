import { NavLink, useLocation } from 'react-router'
import { cn } from '#app/utils/misc.tsx'
import { useIsProActive } from '#app/utils/subscription.ts'
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
		label: 'Inventory',
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

const PRO_PATHS = new Set(['/plan', '/shopping'])

export function BottomNav() {
	const location = useLocation()
	const user = useOptionalUser()
	const isPro = useIsProActive()

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
					const isLocked = !isPro && PRO_PATHS.has(item.to)
					const iconName = isLocked
						? 'lock-closed'
						: isActive
							? item.iconFilled
							: item.icon

					return (
						<NavLink
							key={item.to}
							to={item.to}
							aria-label={
								isLocked
									? `${item.label} (Pro feature)`
									: undefined
							}
							className={cn(
								'relative flex flex-col items-center justify-center gap-1 py-2 transition-colors duration-200',
								isActive
									? 'text-primary'
									: 'text-muted-foreground hover:text-foreground',
							)}
						>
							<Icon
								name={iconName}
								size="lg"
								title={isLocked ? 'Pro feature' : undefined}
							/>
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
