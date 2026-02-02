import { Img } from 'openimg/react'
import { Link } from 'react-router'
import { cn } from '#app/utils/misc.tsx'
import { Icon } from './ui/icon.tsx'
import { type RecipeMatch } from '#app/utils/recipe-matching.server.ts'

type RecipeMatchCardProps = {
	match: RecipeMatch
}

export function RecipeMatchCard({ match }: RecipeMatchCardProps) {
	const { recipe, matchPercentage, canMake, missingIngredients } = match
	const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)

	return (
		<Link
			to={`/recipes/${recipe.id}`}
			className="group block rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md"
		>
			<div className="aspect-[4/3] overflow-hidden rounded-t-lg bg-muted relative">
				{recipe.image?.objectKey ? (
					<Img
						src={`/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`}
						alt={recipe.title}
						className="h-full w-full object-cover transition-transform group-hover:scale-105"
						width={400}
						height={300}
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center">
						<Icon name="cookie" className="size-12 text-muted-foreground" />
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
					<h3 className="font-semibold line-clamp-1 group-hover:text-primary">
						{recipe.title}
					</h3>
					{canMake && (
						<Icon name="check" className="size-5 text-green-600 flex-shrink-0" />
					)}
				</div>
				{recipe.description && (
					<p className="mt-1 text-sm text-muted-foreground line-clamp-2">
						{recipe.description}
					</p>
				)}

				<div className="mt-3 space-y-2">
					{/* Time & Tags */}
					<div className="flex flex-wrap items-center gap-2">
						{totalTime > 0 && (
							<span className="flex items-center gap-1 text-xs text-muted-foreground">
								<Icon name="clock" size="xs" />
								{totalTime} min
							</span>
						)}
						{recipe.tags && recipe.tags.length > 0 && (
							<div className="flex flex-wrap gap-1">
								{recipe.tags.slice(0, 2).map((tag) => (
									<span
										key={tag.id}
										className="rounded-full bg-secondary px-2 py-0.5 text-xs"
									>
										{tag.name}
									</span>
								))}
								{recipe.tags.length > 2 && (
									<span className="text-xs text-muted-foreground">
										+{recipe.tags.length - 2}
									</span>
								)}
							</div>
						)}
					</div>

					{/* Missing Ingredients */}
					{missingIngredients.length > 0 && (
						<div className="text-xs text-muted-foreground">
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
		<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
			{children}
		</div>
	)
}
