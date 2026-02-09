import { Link, useLocation } from 'react-router'
import { cn } from '#app/utils/misc.tsx'
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
		to: '/discover',
		icon: 'magnifying-glass' as IconName,
		label: 'Discover',
		matchPaths: ['/discover'],
	},
]

export function BottomNav() {
	const location = useLocation()
	const user = useOptionalUser()

	if (!user) return null

	return (
		<nav className="bg-background fixed inset-x-0 bottom-0 z-50 border-t md:hidden print:hidden">
			<div className="flex h-16 items-center justify-around">
				{navItems.map((item) => {
					const isActive = item.matchPaths?.some((path) =>
						path === '/'
							? location.pathname === '/'
							: location.pathname.startsWith(path),
					)

					return (
						<Link
							key={item.to}
							to={item.to}
							className={cn(
								'relative flex flex-col items-center justify-center gap-1 px-4 py-2 transition-colors',
								isActive
									? 'text-primary'
									: 'text-muted-foreground hover:text-foreground',
							)}
						>
							{isActive && (
								<span className="bg-primary absolute top-0 right-2 left-2 h-0.5 rounded-full" />
							)}
							{item.icon === 'plus' ? (
								<span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-full">
									<Icon name={item.icon} size="md" />
								</span>
							) : (
								<>
									<Icon name={item.icon} size="lg" />
									<span className={cn('text-xs', isActive && 'font-semibold')}>
										{item.label}
									</span>
								</>
							)}
						</Link>
					)
				})}
			</div>
		</nav>
	)
}
