import { Link } from 'react-router'
import { Icon } from './ui/icon.tsx'

type MenuCardProps = {
	id: string
	title: string
	description?: string | null
	defaultGuestCount?: number | null
	recipes?: Array<{ title: string }>
}

export function MenuCard({
	id,
	title,
	description,
	defaultGuestCount,
	recipes = [],
}: MenuCardProps) {
	// What's on the Menu, by name — the courses under the title.
	const contents = recipes.map((recipe) => recipe.title).join(', ')
	return (
		<Link
			to={`/recipes/menus/${id}`}
			viewTransition
			className="group active:bg-muted/40 md:border-border/60 md:bg-card md:text-card-foreground md:hover:border-accent/30 md:active:bg-card flex flex-row items-center gap-3.5 px-4 py-3.5 transition-colors sm:px-8 md:flex-col md:items-stretch md:gap-0 md:overflow-hidden md:rounded-md md:border md:p-0 md:transition-all md:duration-[180ms] md:ease-[var(--ease-hover-lift)]"
		>
			{/* Menus carry no imagery (Gate 1A dogfood) — the row reads like a
			    printed menu card: title, guests at the right, courses beneath. */}
			<div className="flex min-w-0 flex-1 flex-col justify-center md:justify-start md:p-6">
				<div className="flex items-baseline gap-3">
					<h3 className="min-w-0 flex-1 font-serif text-lg leading-[1.35] md:text-base md:leading-[1.3] md:tracking-[-0.005em]">
						<span className="line-clamp-2">{title}</span>
					</h3>
					{defaultGuestCount ? (
						<span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs tabular-nums md:hidden">
							<Icon name="avatar" size="xs" />
							{defaultGuestCount}
							<span className="sr-only"> guests</span>
						</span>
					) : null}
				</div>

				{contents ? (
					<span className="text-muted-foreground mt-1 line-clamp-2 text-[13px] leading-snug md:hidden">
						{contents}
					</span>
				) : null}

				{/* Description — desktop only */}
				{description && (
					<p className="text-muted-foreground hidden md:mt-1 md:line-clamp-3 md:block md:text-sm">
						{description}
					</p>
				)}

				{/* Desktop meta */}
				{defaultGuestCount ? (
					<div className="mt-auto hidden items-center gap-3 pt-2 md:flex">
						<span className="text-muted-foreground flex items-center gap-1 text-xs">
							<Icon name="avatar" size="xs" />
							{defaultGuestCount} guests
						</span>
					</div>
				) : null}
			</div>
		</Link>
	)
}
