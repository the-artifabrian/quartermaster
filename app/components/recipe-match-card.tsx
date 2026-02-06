import { Img } from 'openimg/react'
import { Link } from 'react-router'
import { cn } from '#app/utils/misc.tsx'
import { type RecipeMatch } from '#app/utils/recipe-matching.server.ts'
import { Icon } from './ui/icon.tsx'

type RecipeMatchCardProps = {
	match: RecipeMatch
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

export function RecipeMatchCard({ match }: RecipeMatchCardProps) {
	const { recipe, matchPercentage, canMake, missingIngredients } = match
	const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)

	return (
		<Link
			to={`/recipes/${recipe.id}`}
			className="group bg-card text-card-foreground block rounded-lg border shadow-sm transition-shadow hover:shadow-md"
		>
			<div className="bg-muted relative aspect-[4/3] overflow-hidden rounded-t-lg">
				{recipe.image?.objectKey ? (
					<Img
						src={`/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`}
						alt={recipe.title}
						className="h-full w-full object-cover transition-transform group-hover:scale-105"
						width={400}
						height={300}
					/>
				) : (
					<div
						className={cn(
							'flex h-full w-full items-center justify-center bg-gradient-to-br transition-transform group-hover:scale-105',
							getRecipeGradient(recipe.title),
						)}
					>
						<div className="flex flex-col items-center gap-2">
							<span className="text-6xl font-bold text-white drop-shadow-lg">
								{recipe.title.charAt(0).toUpperCase()}
							</span>
							<Icon name="cookie" className="size-8 text-white/80" />
						</div>
					</div>
				)}
				{/* Match Badge */}
				<div className="absolute top-2 right-2">
					<div
						className={cn(
							'rounded-full px-3 py-1 text-xs font-semibold shadow-lg',
							canMake
								? 'bg-green-500 text-white'
								: matchPercentage >= 75
									? 'bg-blue-500 text-white'
									: matchPercentage >= 50
										? 'bg-yellow-500 text-white'
										: 'bg-gray-500 text-white',
						)}
					>
						{matchPercentage}% Match
					</div>
				</div>
			</div>
			<div className="p-4">
				<div className="flex items-start justify-between gap-2">
					<h3 className="group-hover:text-primary line-clamp-1 font-semibold">
						{recipe.title}
					</h3>
					{canMake && (
						<Icon
							name="check"
							className="size-5 flex-shrink-0 text-green-600"
						/>
					)}
				</div>
				{recipe.description && (
					<p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
						{recipe.description}
					</p>
				)}

				<div className="mt-3 space-y-2">
					{/* Time & Tags */}
					<div className="flex flex-wrap items-center gap-2">
						{totalTime > 0 && (
							<span className="text-muted-foreground flex items-center gap-1 text-xs">
								<Icon name="clock" size="xs" />
								{totalTime} min
							</span>
						)}
						{recipe.tags && recipe.tags.length > 0 && (
							<div className="flex flex-wrap gap-1">
								{recipe.tags.slice(0, 2).map((tag) => (
									<span
										key={tag.id}
										className="bg-secondary rounded-full px-2 py-0.5 text-xs"
									>
										{tag.name}
									</span>
								))}
								{recipe.tags.length > 2 && (
									<span className="text-muted-foreground text-xs">
										+{recipe.tags.length - 2}
									</span>
								)}
							</div>
						)}
					</div>

					{/* Missing Ingredients */}
					{missingIngredients.length > 0 && (
						<div className="text-muted-foreground text-xs">
							<span className="font-medium">Missing:</span>{' '}
							{missingIngredients
								.slice(0, 3)
								.map((ing) => ing.name)
								.join(', ')}
							{missingIngredients.length > 3 &&
								` +${missingIngredients.length - 3} more`}
						</div>
					)}
				</div>
			</div>
		</Link>
	)
}

export function RecipeMatchCardGrid({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
			{children}
		</div>
	)
}
