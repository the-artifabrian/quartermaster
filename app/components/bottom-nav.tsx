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
		to: '/',
		icon: 'home' as IconName,
		label: 'Home',
		matchPaths: ['/'],
	},
	{
		to: '/recipes',
		icon: 'cookie' as IconName,
		label: 'Recipes',
		matchPaths: ['/recipes'],
	},
	{
		to: '/recipes/new',
		icon: 'plus' as IconName,
		label: 'New',
		matchPaths: ['/recipes/new'],
	},
	{
		to: '/settings/profile',
		icon: 'avatar' as IconName,
		label: 'Profile',
		matchPaths: ['/settings/profile', '/users/'],
	},
]

export function BottomNav() {
	const location = useLocation()
	const user = useOptionalUser()

	if (!user) return null

	return (
		<nav className="fixed inset-x-0 bottom-0 z-50 border-t bg-background md:hidden">
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
								'flex flex-col items-center justify-center gap-1 px-4 py-2 transition-colors',
								isActive
									? 'text-primary'
									: 'text-muted-foreground hover:text-foreground',
							)}
						>
							{item.icon === 'plus' ? (
								<span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
									<Icon name={item.icon} size="md" />
								</span>
							) : (
								<>
									<Icon name={item.icon} size="lg" />
									<span className="text-xs">{item.label}</span>
								</>
							)}
						</Link>
					)
				})}
			</div>
		</nav>
	)
}
