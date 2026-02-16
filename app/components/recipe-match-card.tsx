import { type Ingredient } from '@prisma/client'
import { Img } from 'openimg/react'
import { useEffect, useRef } from 'react'
import { Link, useFetcher } from 'react-router'
import { toast } from 'sonner'
import { formatTimeAgo } from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'
import { type RecipeMatch } from '#app/utils/recipe-matching.server.ts'
import { getRecipePlaceholder } from '#app/utils/recipe-placeholder.ts'
import { SubstitutionHint } from './ingredient-substitution.tsx'
import { MatchProgressRing } from './match-progress-ring.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'

type RecipeMatchCardProps = {
	match: RecipeMatch
	lastCookedAt?: string | null
	cookCount?: number
	urgentBorder?: boolean
	isProActive?: boolean
}

export function RecipeMatchCard({
	match,
	lastCookedAt,
	cookCount,
	urgentBorder,
	isProActive,
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
			<div className="bg-muted relative aspect-[16/9] overflow-hidden rounded-t-lg sm:aspect-[4/3]">
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
							isProActive={isProActive}
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
	isProActive,
}: {
	recipeId: string
	missingIngredients: Ingredient[]
	isProActive?: boolean
}) {
	const fetcher = useFetcher<{ status: string; addedCount: number }>()
	const isAdded = fetcher.data?.status === 'success'
	const isSubmitting = fetcher.state !== 'idle'

	const visible = missingIngredients.slice(0, 4)
	const overflowCount = missingIngredients.length - visible.length

	return (
		<div className="bg-muted rounded-md px-2.5 py-1.5 text-xs">
			<div className="mb-1.5 flex items-center justify-between">
				<span className="text-muted-foreground font-medium">Missing:</span>
				<fetcher.Form
					method="POST"
					action="/resources/discover-actions"
					onClick={(e) => e.stopPropagation()}
				>
					<input type="hidden" name="intent" value="addMissing" />
					<input type="hidden" name="recipeIds" value={recipeId} />
					<Button
						type="submit"
						variant="ghost"
						size="sm"
						className="text-muted-foreground hover:text-foreground -mr-1 size-8 p-0"
						disabled={isSubmitting || isAdded}
						onClick={(e) => {
							e.preventDefault()
							e.stopPropagation()
							void fetcher.submit(e.currentTarget.form!)
						}}
					>
						<Icon
							name={isAdded ? 'check' : 'plus'}
							className={cn('size-4', isAdded && 'text-green-600')}
						/>
						<span className="sr-only">Add all missing to shopping list</span>
					</Button>
				</fetcher.Form>
			</div>
			<div className="flex flex-wrap gap-1">
				{visible.map((ing) => (
					<span
						key={ing.id}
						className="bg-background/60 text-muted-foreground inline-flex items-center gap-0.5 rounded-full py-0.5 pl-2 pr-0.5"
					>
						<SubstitutionHint
							ingredientName={ing.name}
							isProActive={!!isProActive}
						>
							{ing.name}
						</SubstitutionHint>
						<IngredientHaveItButton name={ing.name} />
					</span>
				))}
				{overflowCount > 0 && (
					<span className="text-muted-foreground leading-5">
						+{overflowCount} more
					</span>
				)}
			</div>
		</div>
	)
}

export function IngredientHaveItButton({
	name,
	variant = 'card',
}: {
	name: string
	variant?: 'card' | 'banner'
}) {
	const fetcher = useFetcher<{
		status: string
		intent?: string
		addedCount: number
	}>()
	const isSuccess = fetcher.data?.status === 'success'
	const isAlready = fetcher.data?.status === 'already_exists'
	const isDone = isSuccess || isAlready
	const isSubmitting = fetcher.state !== 'idle'

	// Toast on completion
	const prevState = useRef(fetcher.state)
	useEffect(() => {
		if (prevState.current !== 'idle' && fetcher.state === 'idle' && fetcher.data) {
			if (fetcher.data.status === 'success') {
				toast.success(`Added "${name}" to your inventory`)
			} else if (fetcher.data.status === 'already_exists') {
				toast.info(`"${name}" is already in your inventory`)
			}
		}
		prevState.current = fetcher.state
	}, [fetcher.state, fetcher.data, name])

	return (
		<fetcher.Form
			method="POST"
			action="/resources/discover-actions"
			className="inline-flex"
			onClick={(e) => e.stopPropagation()}
		>
			<input type="hidden" name="intent" value="addToInventory" />
			<input type="hidden" name="ingredientName" value={name} />
			<button
				type="submit"
				disabled={isSubmitting || isDone}
				className={cn(
					'inline-flex items-center justify-center rounded-full transition-colors',
					variant === 'card'
						? 'text-muted-foreground hover:text-foreground size-7 hover:bg-background'
						: 'text-emerald-600 hover:text-emerald-800 size-7 hover:bg-emerald-200/50 dark:text-emerald-400 dark:hover:text-emerald-200 dark:hover:bg-emerald-800/40',
					isDone && 'cursor-default',
				)}
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
					if (!isSubmitting && !isDone) {
						void fetcher.submit(e.currentTarget.form!)
					}
				}}
				aria-label={`Add ${name} to inventory`}
			>
				<Icon
					name={isDone ? 'check' : 'plus'}
					className={cn(
						'size-3.5',
						isDone && 'text-green-600',
					)}
				/>
			</button>
		</fetcher.Form>
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
