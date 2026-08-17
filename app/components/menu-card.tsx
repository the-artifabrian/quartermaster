import { Link } from 'react-router'
import { cn } from '#app/utils/misc.tsx'
import { Icon } from './ui/icon.tsx'

/**
 * Every Menu shares one fixed placeholder — Menus deliberately have no image
 * or cover management, so composition stays focused.
 */
export function MenuPlaceholder({
	label,
	className,
	iconClassName,
}: {
	label: string
	className?: string
	iconClassName?: string
}) {
	return (
		<div
			role="img"
			aria-label={label}
			className={cn(
				'flex items-center justify-center bg-gradient-to-br from-stone-200/80 to-stone-300/50 dark:from-stone-800/50 dark:to-stone-700/30',
				className,
			)}
		>
			<Icon
				name="rows"
				className={cn(
					'text-stone-600/45 dark:text-stone-400/35',
					iconClassName,
				)}
			/>
		</div>
	)
}

type MenuCardProps = {
	id: string
	title: string
	description?: string | null
	defaultGuestCount?: number | null
}

export function MenuCard({
	id,
	title,
	description,
	defaultGuestCount,
}: MenuCardProps) {
	return (
		<Link
			to={`/recipes/menus/${id}`}
			viewTransition
			className="group active:bg-muted/40 md:border-border/60 md:bg-card md:text-card-foreground md:hover:border-accent/30 md:active:bg-card flex flex-row items-center gap-3.5 px-4 py-3 transition-colors sm:px-8 md:flex-col md:items-stretch md:gap-0 md:overflow-hidden md:rounded-md md:border md:p-0 md:transition-all md:duration-[180ms] md:ease-[var(--ease-hover-lift)]"
		>
			{/* Fixed placeholder — thumbnail on mobile, full-width on desktop */}
			<div className="relative flex size-16 shrink-0 overflow-hidden rounded-lg md:h-28 md:w-full md:rounded-none">
				<MenuPlaceholder
					label={`${title} menu`}
					className="h-full w-full"
					iconClassName="size-6 md:size-8"
				/>
			</div>

			{/* Content */}
			<div className="flex min-w-0 flex-1 flex-col justify-center md:justify-start md:p-6">
				<h3 className="min-w-0 font-serif text-[17px] leading-[1.4] md:text-base md:leading-[1.3] md:tracking-[-0.005em]">
					<span className="line-clamp-2">{title}</span>
				</h3>

				{/* Mobile meta: default guests only */}
				{defaultGuestCount ? (
					<span className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[13px] md:hidden">
						<Icon name="avatar" size="xs" />
						{defaultGuestCount} guests
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
