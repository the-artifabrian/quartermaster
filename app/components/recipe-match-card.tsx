import { type Ingredient } from '@prisma/client'
import { Img } from 'openimg/react'
import { Link, useFetcher } from 'react-router'
import { formatTimeAgo } from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'
import { type RecipeMatch } from '#app/utils/recipe-matching.server.ts'
import { getRecipePlaceholder } from '#app/utils/recipe-placeholder.ts'
import { MatchProgressRing } from './match-progress-ring.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'

type RecipeMatchCardProps = {
	match: RecipeMatch
	lastCookedAt?: string | null
	cookCount?: number
	urgentBorder?: boolean
}

export function RecipeMatchCard({
	match,
	lastCookedAt,
	cookCount,
	urgentBorder,
}: RecipeMatchCardProps) {
	const { recipe, matchPercentage, canMake, missingIngredients } = match
	const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)

	return (
		<Link
			to={`/recipes/${recipe.id}`}
			className={cn(
				'group bg-card text-card-foreground block overflow-hidden rounded-xl border border-border/60 shadow-warm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-warm-md',
				urgentBorder &&
					'border-l-4 border-l-amber-400 dark:border-l-amber-500',
			)}
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
					(() => {
						const placeholder = getRecipePlaceholder(recipe.title)
						return (
							<div
								role="img"
								aria-label={`${recipe.title} recipe`}
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
				{/* Match Progress Ring */}
				<div className="absolute top-2 right-2">
					<div className="rounded-full bg-white/80 p-0.5 shadow-lg backdrop-blur-sm dark:bg-black/60">
						<MatchProgressRing percentage={matchPercentage} size={40} />
					</div>
				</div>
			</div>
			<div className="p-5">
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

				{cookCount != null && cookCount > 0 && lastCookedAt && (
					<p className="text-muted-foreground mt-2 text-xs">
						{cookCount === 1 ? 'Made once' : `Made ${cookCount} times`} · Last:{' '}
						{formatTimeAgo(new Date(lastCookedAt))}
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
								{recipe.tags.slice(0, 3).map((tag) => (
									<span
										key={tag.id}
										className="bg-accent/10 text-accent-foreground rounded-full border border-accent/20 px-2 py-0.5 text-xs font-medium"
									>
										{tag.name}
									</span>
								))}
								{recipe.tags.length > 3 && (
									<span className="text-muted-foreground text-xs leading-5">
										+{recipe.tags.length - 3}
									</span>
								)}
							</div>
						)}
					</div>

					{/* Missing Ingredients */}
					{missingIngredients.length > 0 && (
						<MissingIngredients
							recipeId={recipe.id}
							missingIngredients={missingIngredients}
						/>
					)}
				</div>
			</div>
		</Link>
	)
}

function MissingIngredients({
	recipeId,
	missingIngredients,
}: {
	recipeId: string
	missingIngredients: Ingredient[]
}) {
	const fetcher = useFetcher<{ status: string; addedCount: number }>()
	const isAdded = fetcher.data?.status === 'success'
	const isSubmitting = fetcher.state !== 'idle'

	return (
		<div className="bg-muted flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs">
			<div className="min-w-0 flex-1">
				<span className="text-muted-foreground font-medium">Missing:</span>{' '}
				<span className="text-muted-foreground">
					{missingIngredients
						.slice(0, 3)
						.map((ing) => ing.name)
						.join(', ')}
					{missingIngredients.length > 3 &&
						` +${missingIngredients.length - 3} more`}
				</span>
			</div>
			<fetcher.Form
				method="POST"
				action="/discover"
				onClick={(e) => e.stopPropagation()}
			>
				<input type="hidden" name="intent" value="addMissing" />
				<input type="hidden" name="recipeIds" value={recipeId} />
				<Button
					type="submit"
					variant="ghost"
					size="sm"
					className="text-muted-foreground hover:text-foreground -mr-1.5 size-7 p-0"
					disabled={isSubmitting || isAdded}
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						void fetcher.submit(e.currentTarget.form!)
					}}
				>
					<Icon
						name={isAdded ? 'check' : 'plus'}
						className={cn('size-3.5', isAdded && 'text-green-600')}
					/>
					<span className="sr-only">Add missing to shopping list</span>
				</Button>
			</fetcher.Form>
		</div>
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
