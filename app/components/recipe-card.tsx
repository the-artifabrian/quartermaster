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

	return (
		<Link
			to={`/recipes/${id}`}
			className="group bg-card text-card-foreground border-border/60 shadow-warm hover:shadow-warm-md block overflow-hidden rounded-xl border transition-all duration-200 hover:-translate-y-0.5"
		>
			<div className="bg-muted relative aspect-[16/9] overflow-hidden rounded-t-lg sm:aspect-[4/3]">
				<div className="absolute top-2 right-2 z-10 flex items-center gap-1">
					{isAiGenerated && (
						<Icon
							name="sparkles"
							className="size-4 text-violet-500 drop-shadow"
						/>
					)}
					{isFavorite && (
						<Icon
							name="heart-filled"
							className="size-5 text-red-500 drop-shadow"
						/>
					)}
				</div>
				{matchPercentage != null && (
					<div className="absolute bottom-2 left-2">
						<div className="rounded-full bg-white/80 p-0.5 shadow-lg backdrop-blur-sm dark:bg-black/60">
							<MatchProgressRing percentage={matchPercentage} size={36} />
						</div>
					</div>
				)}
				{imageObjectKey ? (
					<Img
						src={`/resources/images?objectKey=${encodeURIComponent(imageObjectKey)}`}
						alt={title}
						className="h-full w-full object-cover transition-transform group-hover:scale-105"
						width={400}
						height={300}
					/>
				) : (
					(() => {
						const placeholder = getRecipePlaceholder(title)
						return (
							<div
								role="img"
								aria-label={`${title} recipe`}
								className={cn(
									'flex h-full w-full items-center justify-center transition-transform group-hover:scale-105',
									placeholder.bgClass,
								)}
							>
								<div className="flex flex-col items-center gap-2">
									<span
										className={cn(
											'text-6xl font-bold',
											placeholder.letterColorClass,
										)}
									>
										{placeholder.letter}
									</span>
									<Icon
										name={placeholder.iconName}
										className={cn('size-8', placeholder.iconColorClass)}
									/>
								</div>
							</div>
						)
					})()
				)}
			</div>
			<div className="p-5">
				<div className="flex items-start justify-between gap-2">
					<h3 className="group-hover:text-primary line-clamp-1 font-semibold">
						{title}
					</h3>
					{totalTime > 0 && (
						<span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
							<Icon name="clock" size="xs" />
							{totalTime} min
						</span>
					)}
				</div>
				{description && (
					<p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
						{description}
					</p>
				)}
				{cookCount != null && cookCount > 0 && lastCookedAt && (
					<p className="text-muted-foreground mt-2 text-xs">
						{cookCount === 1 ? 'Made once' : `Made ${cookCount} times`} · Last:{' '}
						{formatTimeAgo(new Date(lastCookedAt))}
					</p>
				)}
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
				'grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3',
				className,
			)}
		>
			{children}
		</div>
	)
}
