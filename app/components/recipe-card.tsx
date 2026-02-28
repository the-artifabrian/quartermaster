import { Img } from 'openimg/react'
import { Link } from 'react-router'
import { formatTimeAgo } from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'
import { getRecipePlaceholder } from '#app/utils/recipe-placeholder.ts'
import { MatchProgressRing } from './match-progress-ring.tsx'
import { Icon } from './ui/icon.tsx'

type RecipeCardProps = {
	id: string
	title: string
	description?: string | null
	imageObjectKey?: string | null
	prepTime?: number | null
	cookTime?: number | null
	isFavorite?: boolean
	isAiGenerated?: boolean
	lastCookedAt?: string | null
	cookCount?: number
	matchPercentage?: number
}

export function RecipeCard({
	id,
	title,
	description,
	imageObjectKey,
	prepTime,
	cookTime,
	isFavorite,
	isAiGenerated,
	lastCookedAt,
	cookCount,
	matchPercentage,
}: RecipeCardProps) {
	const totalTime = (prepTime ?? 0) + (cookTime ?? 0)
	const placeholder = !imageObjectKey ? getRecipePlaceholder(title) : null

	return (
		<Link
			to={`/recipes/${id}`}
			className={cn(
				'group flex flex-row items-stretch overflow-hidden rounded-lg border border-border/60 bg-card text-card-foreground shadow-warm transition-all ease-[var(--ease-hover-lift)] duration-[180ms] hover:-translate-y-0.5 hover:border-accent/20 hover:shadow-warm-md md:flex-col md:rounded-xl',
				placeholder && `border-l-[3px] md:border-l-0 ${placeholder.borderClass}`,
			)}
		>
			{/* Image / Placeholder — desktop only for grid view */}
			<div
				className={cn(
					'relative shrink-0 overflow-hidden',
					imageObjectKey
						? 'hidden md:block md:w-full md:aspect-[4/3]'
						: 'hidden md:flex md:h-28 md:w-full',
				)}
			>
				{/* Desktop badges overlay */}
				<div className="absolute top-2 right-2 z-10 flex items-center gap-1">
					{isFavorite && (
						<Icon
							name="heart-filled"
							className="size-4 text-accent drop-shadow"
						/>
					)}
				</div>
				{/* Desktop match ring overlay */}
				{matchPercentage != null && (
					<div className="absolute bottom-2 left-2">
						<div className="rounded-full bg-white/70 p-0.5 shadow-lg backdrop-blur-sm dark:bg-black/50">
							<MatchProgressRing percentage={matchPercentage} size={30} />
						</div>
					</div>
				)}
				{imageObjectKey ? (
					<Img
						src={`/resources/images?objectKey=${encodeURIComponent(imageObjectKey)}`}
						alt={title}
						className="h-full w-full object-cover transition-transform group-hover:scale-[1.02] md:rounded-none"
						width={400}
						height={300}
					/>
				) : (
					<div
						role="img"
						aria-label={`${title} recipe`}
						className={cn(
							'flex h-full w-full items-center justify-center',
							placeholder!.bgClass,
						)}
					>
						<span
							className={cn(
								'font-serif text-4xl',
								placeholder!.letterColorClass,
							)}
						>
							{placeholder!.letter}
						</span>
					</div>
				)}
			</div>

			{/* Content */}
			<div
				className={cn(
					'flex min-w-0 flex-1 flex-col justify-center px-3 py-2 md:justify-start',
					imageObjectKey ? 'md:p-5' : 'md:p-6',
				)}
			>
				<div className="flex items-center gap-1.5">
					<h3 className="min-w-0 font-serif text-base leading-[1.4] group-hover:text-primary md:text-base md:leading-[1.3] md:tracking-[-0.005em]">
						<span className="line-clamp-2">{title}</span>
					</h3>
					{/* Mobile-only inline badges */}
					{isFavorite && (
						<span className="shrink-0 md:hidden">
							<Icon
								name="heart-filled"
								className="size-3.5 text-accent"
							/>
						</span>
					)}
				</div>

				{/* Mobile-only: time + match % + AI inline */}
				<div className="mt-0.5 flex items-center gap-2 md:hidden">
					{totalTime > 0 && (
						<span className="flex items-center gap-1 text-xs text-muted-foreground">
							<Icon name="clock" size="xs" />
							{totalTime} min
						</span>
					)}
					{matchPercentage != null && (
						<span className="flex items-center gap-1">
							<MatchProgressRing
								percentage={matchPercentage}
								size={16}
								hideText
								className="shrink-0"
							/>
							<span
								className={cn(
									'text-xs font-medium tabular-nums',
									matchPercentage >= 80
										? 'text-green-600 dark:text-green-400'
										: matchPercentage >= 50
											? 'text-amber-600 dark:text-amber-400'
											: 'text-muted-foreground',
								)}
							>
								{matchPercentage}%
							</span>
						</span>
					)}
					{isAiGenerated && (
						<Icon name="sparkles" size="xs" className="text-muted-foreground/50" />
					)}
					{cookCount != null && cookCount > 0 && (
						<span className="text-xs text-muted-foreground/60">Made {cookCount}x</span>
					)}
				</div>

				{/* Description */}
				{description && (
					<p
						className={cn(
							'mt-0.5 text-xs text-muted-foreground md:mt-1 md:text-sm',
							imageObjectKey
								? 'line-clamp-1 md:line-clamp-2'
								: 'line-clamp-1 md:line-clamp-3',
						)}
					>
						{description}
					</p>
				)}

				{/* Desktop-only: cook stats + time + AI label */}
				<div className="mt-auto hidden items-center gap-3 pt-2 md:flex">
					{totalTime > 0 && (
						<span className="flex items-center gap-1 text-xs text-muted-foreground">
							<Icon name="clock" size="xs" />
							{totalTime} min
						</span>
					)}
					{cookCount != null && cookCount > 0 && lastCookedAt && (
						<span className="text-xs text-muted-foreground/60">
							{cookCount === 1 ? 'Made once' : `Made ${cookCount} times`} ·
							Last: {formatTimeAgo(new Date(lastCookedAt))}
						</span>
					)}
					{isAiGenerated && (
						<Icon name="sparkles" size="xs" className="ml-auto text-muted-foreground/50" />
					)}
				</div>
			</div>
		</Link>
	)
}

export function RecipeCardGrid({
	children,
	className,
}: {
	children: React.ReactNode
	className?: string
}) {
	return (
		<div
			className={cn(
				'grid grid-cols-1 gap-2 md:gap-4 md:grid-cols-2 lg:grid-cols-3',
				className,
			)}
		>
			{children}
		</div>
	)
}
