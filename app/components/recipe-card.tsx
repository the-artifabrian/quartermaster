import { Img } from 'openimg/react'
import { Link } from 'react-router'
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
}

// Generate a consistent color gradient based on recipe title
function getRecipeGradient(title: string) {
	const gradients = [
		'from-emerald-400 to-teal-500', // Green
		'from-orange-400 to-amber-500', // Orange
		'from-rose-400 to-pink-500', // Pink
		'from-blue-400 to-cyan-500', // Blue
		'from-purple-400 to-fuchsia-500', // Purple
		'from-lime-400 to-green-500', // Lime
		'from-amber-400 to-orange-500', // Amber
		'from-indigo-400 to-blue-500', // Indigo
		'from-red-400 to-rose-500', // Red
		'from-cyan-400 to-blue-500', // Cyan
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
}: RecipeCardProps) {
	const totalTime = (prepTime ?? 0) + (cookTime ?? 0)

	return (
		<Link
			to={`/recipes/${id}`}
			className="group bg-card text-card-foreground block rounded-lg border shadow-sm transition-shadow hover:shadow-md"
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
						className={cn(
							'flex h-full w-full items-center justify-center bg-gradient-to-br transition-transform group-hover:scale-105',
							getRecipeGradient(title),
						)}
					>
						<div className="flex flex-col items-center gap-2">
							<span className="text-6xl font-bold text-white drop-shadow-lg">
								{title.charAt(0).toUpperCase()}
							</span>
							<Icon name="cookie" className="size-8 text-white/80" />
						</div>
					</div>
				)}
			</div>
			<div className="p-4">
				<h3 className="group-hover:text-primary line-clamp-1 font-semibold">
					{title}
				</h3>
				{description && (
					<p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
						{description}
					</p>
				)}
				<div className="mt-3 flex flex-wrap items-center gap-2">
					{totalTime > 0 && (
						<span className="text-muted-foreground flex items-center gap-1 text-xs">
							<Icon name="clock" size="xs" />
							{totalTime} min
						</span>
					)}
					{tags && tags.length > 0 && (
						<div className="flex flex-wrap gap-1">
							{tags.slice(0, 2).map((tag) => (
								<span
									key={tag.id}
									className="bg-secondary rounded-full px-2 py-0.5 text-xs"
								>
									{tag.name}
								</span>
							))}
							{tags.length > 2 && (
								<span className="text-muted-foreground text-xs">
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
