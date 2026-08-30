import { Img } from 'openimg/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { cn } from '#app/utils/misc.tsx'
import { getRecipePlaceholder } from '#app/utils/recipe-placeholder.ts'

export type RecipeSelectorRecipe = {
	id: string
	title: string
	totalTime: number | null
	yieldAmount: number | null
	yieldLabel: string | null
	isFavorite: boolean
	image: { objectKey: string } | null
}

type RecipeSelectorProps = {
	recipes: RecipeSelectorRecipe[]
	/** Weeknights (Mon-Thu) sort by total time; the date only drives that. */
	date: Date
	excludeRecipeIds?: string[]
	onCancel: () => void
	/** Callback-based like the Menu RecipePicker — the parent owns the submit. */
	onPick: (recipe: RecipeSelectorRecipe) => void
}

/**
 * Small square recipe thumbnail — image when one exists, the deterministic
 * warm monogram placeholder otherwise. Shared row language for anything that
 * lists recipes compactly (Plan selector, Menu picker).
 */
export function RecipeThumb({
	title,
	image,
}: {
	title: string
	image: { objectKey: string } | null
}) {
	if (image) {
		return (
			<span className="size-9 shrink-0 overflow-hidden rounded-md">
				<Img
					src={`/resources/images?objectKey=${encodeURIComponent(image.objectKey)}`}
					alt=""
					className="h-full w-full object-cover"
					width={72}
					height={72}
				/>
			</span>
		)
	}
	const placeholder = getRecipePlaceholder(title)
	return (
		<span
			className={cn(
				'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md',
				placeholder.bgClass,
			)}
		>
			<span className={cn('font-serif text-sm', placeholder.letterColorClass)}>
				{placeholder.letter}
			</span>
		</span>
	)
}

export function getRecipeTotalTime(recipe: {
	totalTime: number | null
}): number | null {
	return recipe.totalTime
}

function sortByTime(a: RecipeSelectorRecipe, b: RecipeSelectorRecipe): number {
	const aTime = getRecipeTotalTime(a) ?? 45
	const bTime = getRecipeTotalTime(b) ?? 45
	return aTime - bTime
}

export function RecipeSelector({
	recipes,
	date,
	excludeRecipeIds = [],
	onCancel,
	onPick,
}: RecipeSelectorProps) {
	const [search, setSearch] = useState('')

	const filteredRecipes = recipes
		.filter((r) => !excludeRecipeIds.includes(r.id))
		.filter((r) => r.title.toLowerCase().includes(search.toLowerCase()))

	// Mon=1..Thu=4 are weeknights — sort by total time
	const isWeeknight = date.getUTCDay() >= 1 && date.getUTCDay() <= 4
	const applySorting = (list: RecipeSelectorRecipe[]) =>
		isWeeknight ? [...list].sort(sortByTime) : list

	// Partition into favorites first, then the rest
	const favorites = applySorting(filteredRecipes.filter((r) => r.isFavorite))
	const rest = applySorting(filteredRecipes.filter((r) => !r.isFavorite))
	const hasBothGroups = favorites.length > 0 && rest.length > 0

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Input
					placeholder="Search recipes..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					autoFocus
				/>
				<Button
					variant="ghost"
					size="icon"
					onClick={onCancel}
					aria-label="Close recipe selector"
				>
					<Icon name="cross-1" size="sm" />
				</Button>
			</div>
			<div className="max-h-[300px] scrollbar-thin space-y-0.5 overflow-y-auto">
				{favorites.length === 0 && rest.length === 0 ? (
					<div className="py-4 text-center">
						<p className="text-muted-foreground text-sm">No recipes found</p>
						<Link
							to="/recipes/new"
							className="text-primary mt-1 inline-block text-sm hover:underline"
						>
							Create a new recipe
						</Link>
					</div>
				) : (
					<>
						{favorites.length > 0 && (
							<>
								{hasBothGroups && (
									<p className="text-muted-foreground px-2 pt-1 pb-0.5 text-xs font-medium tracking-wide uppercase">
										Favorites
									</p>
								)}
								{favorites.map((recipe) => (
									<RecipeOption
										key={recipe.id}
										recipe={recipe}
										onPick={onPick}
									/>
								))}
							</>
						)}
						{rest.length > 0 && (
							<>
								{hasBothGroups && (
									<p className="text-muted-foreground px-2 pt-2 pb-0.5 text-xs font-medium tracking-wide uppercase">
										All Recipes
									</p>
								)}
								{rest.map((recipe) => (
									<RecipeOption
										key={recipe.id}
										recipe={recipe}
										onPick={onPick}
									/>
								))}
							</>
						)}
					</>
				)}
			</div>
		</div>
	)
}

function RecipeOption({
	recipe,
	onPick,
}: {
	recipe: RecipeSelectorRecipe
	onPick: (recipe: RecipeSelectorRecipe) => void
}) {
	const totalTime = getRecipeTotalTime(recipe)

	return (
		<button
			type="button"
			onClick={() => onPick(recipe)}
			className="hover:bg-muted/50 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors"
		>
			<RecipeThumb title={recipe.title} image={recipe.image} />
			<div className="flex min-w-0 flex-1 items-center justify-between gap-2">
				<p className="min-w-0 truncate text-sm font-medium">
					{recipe.isFavorite && (
						<Icon
							name="heart-filled"
							className="text-accent mr-1 inline size-3"
						/>
					)}
					{recipe.title}
				</p>
				<span className="inline-flex shrink-0 items-center gap-1.5">
					{totalTime != null && (
						<span className="text-muted-foreground inline-flex items-center gap-0.5 text-xs">
							<Icon name="clock" className="size-3" />
							{totalTime}m
						</span>
					)}
				</span>
			</div>
		</button>
	)
}
