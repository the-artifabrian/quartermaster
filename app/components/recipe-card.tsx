import { Img } from 'openimg/react'
import { Link } from 'react-router'
import { formatTimeAgo } from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'
import { Icon } from './ui/icon.tsx'

type RecipeCardProps = {
	id: string
	title: string
	description?: string | null
	imageObjectKey?: string | null
	prepTime?: number | null
	cookTime?: number | null
	tags?: Array<{ id: string; name: string }>
	isFavorite?: boolean
	lastCookedAt?: string | null
	cookCount?: number
}

// Generate a consistent color gradient based on recipe title
function getRecipeGradient(title: string) {
	const gradients = [
		'from-secondary to-muted',
		'from-secondary to-muted',
		'from-secondary to-muted',
		'from-secondary to-muted',
		'from-secondary to-muted',
		'from-secondary to-muted',
		'from-secondary to-muted',
		'from-secondary to-muted',
		'from-secondary to-muted',
		'from-secondary to-muted',
	]

	// Simple hash function to get consistent gradient for same title
	let hash = 0
	for (let i = 0; i < title.length; i++) {
		hash = (hash << 5) - hash + title.charCodeAt(i)
		hash = hash & hash // Convert to 32bit integer
	}
	const index = Math.abs(hash) % gradients.length
	return gradients[index]
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
}: RecipeCardProps) {
	const totalTime = (prepTime ?? 0) + (cookTime ?? 0)

	return (
		<Link
			to={`/recipes/${id}`}
			className="group bg-card text-card-foreground block overflow-hidden rounded-xl border border-border/60 shadow-warm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-warm-md"
		>
			<div className="bg-muted relative aspect-[4/3] overflow-hidden rounded-t-lg">
				{isFavorite && (
					<div className="absolute top-2 right-2 z-10">
						<Icon
							name="heart-filled"
							className="size-5 text-red-500 drop-shadow"
						/>
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
					<div
						role="img"
						aria-label={`${title} recipe`}
						className={cn(
							'flex h-full w-full items-center justify-center bg-gradient-to-br transition-transform group-hover:scale-105',
							getRecipeGradient(title),
						)}
					>
						<div className="flex flex-col items-center gap-2">
							<span className="text-accent/40 text-6xl font-bold">
								{title.charAt(0).toUpperCase()}
							</span>
							<Icon name="cookie" className="text-accent/30 size-8" />
						</div>
					</div>
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
								className="bg-accent/10 text-accent-foreground rounded-full border border-accent/20 px-2 py-0.5 text-xs font-medium"
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
