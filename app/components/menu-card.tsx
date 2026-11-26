import { PushLink } from './push-link.tsx'
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
	// On a phone the line under the title counts the Recipes, then gives the
	// description, or names the Recipes when there is none.
	const count = recipes.length
	const summary =
		description || recipes.map((recipe) => recipe.title).join(', ')
	return (
		<PushLink
			to={`/recipes/menus/${id}`}
			// Outside the iOS app too: a cross-fade.
			viewTransition
			className="group active:bg-muted/40 md:border-border/60 md:bg-card md:text-card-foreground md:hover:border-primary/30 md:active:bg-card flex flex-row items-center gap-3.5 px-4 py-2.5 transition-colors max-md:min-h-[73px] sm:px-8 md:flex-col md:items-stretch md:gap-0 md:overflow-hidden md:rounded-md md:border md:p-0 md:transition-colors md:duration-[180ms] md:ease-[var(--ease-hover-lift)]"
		>
			{/* Menus carry no imagery. A phone's row is a Recipe row's shape
			    with the guests at the right. */}
			<div className="flex min-w-0 flex-1 flex-col justify-center md:justify-start md:p-6">
				<div className="flex items-baseline gap-3">
					<h3 className="text-list-name min-w-0 flex-1 font-medium md:text-base md:leading-[1.3]">
						<span className="line-clamp-3 md:line-clamp-2">{title}</span>
					</h3>
					{defaultGuestCount ? (
						<span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs tabular-nums md:hidden">
							<Icon name="avatar" size="xs" />
							{defaultGuestCount}
							<span className="sr-only"> guests</span>
						</span>
					) : null}
				</div>

				{count > 0 || summary ? (
					<p
						data-menu-meta=""
						className="text-muted-foreground mt-[3px] flex min-w-0 gap-2.5 text-[0.90625rem] leading-snug md:hidden"
					>
						{count > 0 ? (
							<span className="shrink-0 font-semibold">
								{count} {count === 1 ? 'Recipe' : 'Recipes'}
							</span>
						) : null}
						{summary ? (
							<span className="min-w-0 truncate">{summary}</span>
						) : null}
					</p>
				) : null}

				{description && (
					<p className="text-muted-foreground hidden md:mt-1 md:line-clamp-3 md:block md:text-sm">
						{description}
					</p>
				)}

				{defaultGuestCount ? (
					<div className="mt-auto hidden items-center gap-3 pt-2 md:flex">
						<span className="text-muted-foreground flex items-center gap-1 text-xs">
							<Icon name="avatar" size="xs" />
							{defaultGuestCount} guests
						</span>
					</div>
				) : null}
			</div>
		</PushLink>
	)
}
