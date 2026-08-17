import { Link } from 'react-router'
import { cn } from '#app/utils/misc.tsx'

const LINKS = [
	{ key: 'recipes', to: '/recipes', label: 'Recipes' },
	{ key: 'menus', to: '/recipes/menus', label: 'Menus' },
] as const

/**
 * List-local switch between the Recipes and Menus libraries. Both live in the
 * global Recipes destination — this is a pair of route links, not a tab
 * system.
 */
export function LibrarySwitch({ active }: { active: 'recipes' | 'menus' }) {
	return (
		<nav aria-label="Library" className="mb-3 flex gap-1.5">
			{LINKS.map((link) => (
				<Link
					key={link.key}
					to={link.to}
					viewTransition
					aria-current={active === link.key ? 'page' : undefined}
					className={cn(
						'flex h-8 items-center rounded-full border px-3.5 text-xs font-medium transition-colors',
						active === link.key
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-border/50 bg-secondary/50 text-muted-foreground hover:bg-secondary',
					)}
				>
					{link.label}
				</Link>
			))}
		</nav>
	)
}
