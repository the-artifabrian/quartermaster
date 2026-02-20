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
			className="group flex flex-row items-stretch overflow-hidden rounded-lg border border-border/60 bg-card text-card-foreground shadow-warm transition-all ease-[var(--ease-hover-lift)] duration-[180ms] hover:-translate-y-0.5 hover:border-accent/20 hover:shadow-warm-md md:flex-col md:rounded-xl"
		>
			{/* Image / Placeholder */}
			<div
				className={cn(
					'relative shrink-0 overflow-hidden',
					imageObjectKey
						? 'w-12 md:w-full md:aspect-[4/3]'
						: 'w-12 md:h-36 md:w-full',
				)}
			>
				{/* Desktop badges overlay */}
				<div className="absolute top-2 right-2 z-10 hidden items-center gap-1 md:flex">
					{isAiGenerated && (
						<Icon
							name="sparkles"
							className="size-3.5 text-violet-400/70 drop-shadow"
						/>
					)}
					{isFavorite && (
						<Icon
							name="heart-filled"
							className="size-4 text-red-400/70 drop-shadow"
						/>
					)}
				</div>
				{/* Desktop match ring overlay */}
				{matchPercentage != null && (
					<div className="absolute bottom-2 left-2 hidden md:block">
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
							'flex h-full w-full items-center justify-center transition-transform group-hover:scale-[1.02]',
							placeholder!.bgClass,
						)}
					>
						<span
							className={cn(
								'font-serif text-xl font-light md:text-5xl',
								placeholder!.letterColorClass,
							)}
						>
							{placeholder!.letter}
						</span>
					</div>
				)}
			</div>

			{/* Content */}
			<div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2 md:p-5">
				<div className="flex items-center gap-1.5">
					<h3 className="min-w-0 truncate font-serif text-base font-normal group-hover:text-primary md:text-[1.125rem] md:font-semibold">
						{title}
					</h3>
					{/* Mobile-only inline badges */}
					{(isFavorite || isAiGenerated) && (
						<span className="flex shrink-0 items-center gap-0.5 md:hidden">
							{isFavorite && (
								<Icon
									name="heart-filled"
									className="size-3.5 text-red-400/70"
								/>
							)}
							{isAiGenerated && (
								<Icon
									name="sparkles"
									className="size-3 text-violet-400/70"
								/>
							)}
						</span>
					)}
				</div>

				{/* Mobile-only: time + match % inline */}
				{(totalTime > 0 || matchPercentage != null) && (
					<div className="mt-0.5 flex items-center gap-2 md:hidden">
						{totalTime > 0 && (
							<span className="flex items-center gap-1 text-xs text-muted-foreground">
								<Icon name="clock" size="xs" />
								{totalTime} min
							</span>
						)}
						{matchPercentage != null && (
							<span className="flex items-center gap-1 text-xs text-muted-foreground">
								<span
									className={cn(
										'inline-block size-1.5 rounded-full',
										matchPercentage >= 80
											? 'bg-green-500'
											: matchPercentage >= 50
												? 'bg-amber-500'
												: 'bg-muted-foreground/40',
									)}
								/>
								{matchPercentage}%
							</span>
						)}
					</div>
				)}

				{/* Desktop-only: description */}
				{description && (
					<p className="mt-1 hidden line-clamp-2 text-sm text-muted-foreground md:block">
						{description}
					</p>
				)}

				{/* Desktop-only: cook stats + time */}
				<div className="mt-2 hidden items-center gap-3 md:flex">
					{totalTime > 0 && (
						<span className="flex items-center gap-1 text-xs text-muted-foreground">
							<Icon name="clock" size="xs" />
							{totalTime} min
						</span>
					)}
					{cookCount != null && cookCount > 0 && lastCookedAt && (
						<span className="text-xs text-muted-foreground">
							{cookCount === 1 ? 'Made once' : `Made ${cookCount} times`} ·
							Last: {formatTimeAgo(new Date(lastCookedAt))}
						</span>
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
