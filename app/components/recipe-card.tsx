import { Img } from 'openimg/react'
import { Link } from 'react-router'
import { formatTimeAgo } from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'
import { getRecipePlaceholder } from '#app/utils/recipe-placeholder.ts'
import { MatchProgressRing } from './match-progress-ring.tsx'
import { Icon } from './ui/icon.tsx'

type TagWithCategory = { id: string; name: string; category?: string }

type RecipeCardProps = {
	id: string
	title: string
	description?: string | null
	imageObjectKey?: string | null
	prepTime?: number | null
	cookTime?: number | null
	tags?: Array<TagWithCategory>
	isFavorite?: boolean
	lastCookedAt?: string | null
	cookCount?: number
	matchPercentage?: number
}

export function getTagCategoryClass(category?: string): string {
	switch (category) {
		case 'cuisine':
			return 'bg-lime-50/80 text-lime-800 border-lime-200/60 dark:bg-lime-950/30 dark:text-lime-300 dark:border-lime-800/40'
		case 'meal-type':
			return 'bg-amber-50/80 text-amber-800 border-amber-200/60 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/40'
		case 'dietary':
			return 'bg-emerald-50/80 text-emerald-800 border-emerald-200/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800/40'
		default:
			return 'bg-accent/10 text-accent-foreground border-accent/20'
	}
}

export function RecipeCard({
	id,
	title,
	description,
	imageObjectKey,
	prepTime,
	cookTime,
	tags,
	isFavorite,
	lastCookedAt,
	cookCount,
	matchPercentage,
}: RecipeCardProps) {
	const totalTime = (prepTime ?? 0) + (cookTime ?? 0)

	return (
		<Link
			to={`/recipes/${id}`}
			className="group bg-card text-card-foreground block overflow-hidden rounded-xl border border-border/60 shadow-warm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-warm-md"
		>
			<div className="bg-muted relative aspect-[16/9] overflow-hidden rounded-t-lg sm:aspect-[4/3]">
				{isFavorite && (
					<div className="absolute top-2 right-2 z-10">
						<Icon
							name="heart-filled"
							className="size-5 text-red-500 drop-shadow"
						/>
					</div>
				)}
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
				{tags && tags.length > 0 && (
					<div className="mt-3 flex flex-wrap gap-1">
						{tags.slice(0, 3).map((tag) => (
							<span
								key={tag.id}
								className={cn(
									'rounded-full border px-2 py-0.5 text-xs font-medium',
									getTagCategoryClass(tag.category),
								)}
							>
								{tag.name}
							</span>
						))}
						{tags.length > 3 && (
							<span className="text-muted-foreground text-xs leading-5">
								+{tags.length - 3}
							</span>
						)}
					</div>
				)}
			</div>
		</Link>
	)
}

export function RecipeListRow({
	id,
	title,
	imageObjectKey,
	prepTime,
	cookTime,
	tags,
	isFavorite,
	lastCookedAt,
	cookCount,
	matchPercentage,
}: RecipeCardProps) {
	const totalTime = (prepTime ?? 0) + (cookTime ?? 0)

	return (
		<Link
			to={`/recipes/${id}`}
			className="group bg-card text-card-foreground flex items-center gap-3 rounded-lg border border-border/60 p-3 shadow-warm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-warm-md"
		>
			{/* Thumbnail */}
			<div className="bg-muted relative size-14 flex-shrink-0 overflow-hidden rounded-lg">
				{isFavorite && (
					<div className="absolute top-0.5 right-0.5 z-10">
						<Icon
							name="heart-filled"
							className="size-3 text-red-500 drop-shadow"
						/>
					</div>
				)}
				{imageObjectKey ? (
					<Img
						src={`/resources/images?objectKey=${encodeURIComponent(imageObjectKey)}`}
						alt={title}
						className="h-full w-full object-cover"
						width={56}
						height={56}
					/>
				) : (
					(() => {
						const placeholder = getRecipePlaceholder(title)
						return (
							<div
								role="img"
								aria-label={`${title} recipe`}
								className={cn(
									'flex h-full w-full items-center justify-center',
									placeholder.bgClass,
								)}
							>
								<span
									className={cn(
										'text-xl font-bold',
										placeholder.letterColorClass,
									)}
								>
									{placeholder.letter}
								</span>
							</div>
						)
					})()
				)}
			</div>

			{/* Match ring */}
			{matchPercentage != null && (
				<MatchProgressRing percentage={matchPercentage} size={28} />
			)}

			{/* Content */}
			<div className="min-w-0 flex-1">
				<h3 className="group-hover:text-primary line-clamp-1 text-sm font-semibold">
					{title}
				</h3>
				<div className="mt-0.5 flex flex-wrap items-center gap-2">
					{totalTime > 0 && (
						<span className="text-muted-foreground flex items-center gap-1 text-xs">
							<Icon name="clock" size="xs" />
							{totalTime} min
						</span>
					)}
					{cookCount != null && cookCount > 0 && lastCookedAt && (
						<span className="text-muted-foreground text-xs">
							{cookCount === 1 ? 'Made once' : `Made ${cookCount}x`} ·{' '}
							{formatTimeAgo(new Date(lastCookedAt))}
						</span>
					)}
					{tags && tags.length > 0 && (
						<div className="flex flex-wrap gap-1">
							{tags.slice(0, 2).map((tag) => (
								<span
									key={tag.id}
									className={cn(
										'rounded-full border px-1.5 py-0 text-[10px] font-medium leading-4',
										getTagCategoryClass(tag.category),
									)}
								>
									{tag.name}
								</span>
							))}
							{tags.length > 2 && (
								<span className="text-muted-foreground text-[10px] leading-4">
									+{tags.length - 2}
								</span>
							)}
						</div>
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
				'grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3',
				className,
			)}
		>
			{children}
		</div>
	)
}
