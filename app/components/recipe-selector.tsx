import { useState } from 'react'
import { Form } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { type MealType, serializeDate } from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'
import { getRecipePlaceholder } from '#app/utils/recipe-placeholder.ts'

export type RecipeSelectorRecipe = {
	id: string
	title: string
	description: string | null
	prepTime: number | null
	cookTime: number | null
	servings: number
	isFavorite: boolean
	image: { objectKey: string } | null
}

export type PairingData = Record<
	string,
	{ overlapCount: number; overlapIngredients: string[]; score: number }
>

export type MatchData = Record<string, { matched: number; total: number }>

type RecipeSelectorProps = {
	recipes: RecipeSelectorRecipe[]
	date: Date
	mealType: MealType
	excludeRecipeIds?: string[]
	onCancel: () => void
	onSelect?: () => void
	pairingData?: PairingData
	matchData?: MatchData
}

function getTotalTime(recipe: RecipeSelectorRecipe): number | null {
	const total = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)
	return total > 0 ? total : null
}

function sortByTime(a: RecipeSelectorRecipe, b: RecipeSelectorRecipe): number {
	const aTime = getTotalTime(a) ?? 45
	const bTime = getTotalTime(b) ?? 45
	return aTime - bTime
}

export function RecipeSelector({
	recipes,
	date,
	mealType,
	excludeRecipeIds = [],
	onCancel,
	onSelect,
	pairingData,
	matchData,
}: RecipeSelectorProps) {
	const [search, setSearch] = useState('')

	const filteredRecipes = recipes
		.filter((r) => !excludeRecipeIds.includes(r.id))
		.filter((r) => r.title.toLowerCase().includes(search.toLowerCase()))

	// Mon=1..Thu=4 are weeknights
	const isWeeknight = date.getUTCDay() >= 1 && date.getUTCDay() <= 4

	// Sort by pairing overlap if data is available
	const sortedRecipes = pairingData
		? [...filteredRecipes].sort((a, b) => {
				const aOverlap = pairingData[a.id]?.overlapCount ?? 0
				const bOverlap = pairingData[b.id]?.overlapCount ?? 0
				const overlapDiff = bOverlap - aOverlap
				if (overlapDiff !== 0) return overlapDiff
				// Secondary sort by time on weeknights
				return isWeeknight ? sortByTime(a, b) : 0
			})
		: isWeeknight
			? [...filteredRecipes].sort(sortByTime)
			: filteredRecipes

	// Split into groups — .filter() preserves the order from sortedRecipes,
	// so overlap-primary + time-secondary sorting is already correct
	const pairsWell = pairingData
		? sortedRecipes.filter((r) => (pairingData[r.id]?.overlapCount ?? 0) > 0)
		: []
	const otherRecipes = pairingData
		? sortedRecipes.filter((r) => (pairingData[r.id]?.overlapCount ?? 0) === 0)
		: sortedRecipes

	return (
		<div className="space-y-3">
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
			<div className="scrollbar-thin max-h-[300px] space-y-1.5 overflow-y-auto">
				{sortedRecipes.length === 0 ? (
					<p className="text-muted-foreground py-4 text-center text-sm">
						No recipes found
					</p>
				) : (
					<>
						{pairsWell.length > 0 && (
							<>
								<p className="text-muted-foreground px-1 text-[11px] font-medium uppercase tracking-wider">
									Pairs well
								</p>
								{pairsWell.map((recipe) => (
									<RecipeOption
										key={recipe.id}
										recipe={recipe}
										date={date}
										mealType={mealType}
										pairing={pairingData?.[recipe.id]}
										match={matchData?.[recipe.id]}
										onSelect={onSelect}
									/>
								))}
								{otherRecipes.length > 0 && (
									<p className="text-muted-foreground px-1 pt-2 text-[11px] font-medium uppercase tracking-wider">
										Other recipes
									</p>
								)}
							</>
						)}
						{otherRecipes.map((recipe) => (
							<RecipeOption
								key={recipe.id}
								recipe={recipe}
								date={date}
								mealType={mealType}
								match={matchData?.[recipe.id]}
								onSelect={onSelect}
							/>
						))}
					</>
				)}
			</div>
		</div>
	)
}

function RecipeOption({
	recipe,
	date,
	mealType,
	pairing,
	match,
	onSelect,
}: {
	recipe: RecipeSelectorRecipe
	date: Date
	mealType: MealType
	pairing?: {
		overlapCount: number
		overlapIngredients: string[]
		score: number
	}
	match?: { matched: number; total: number }
	onSelect?: () => void
}) {
	const totalTime = getTotalTime(recipe)
	const placeholder = getRecipePlaceholder(recipe.title)

	return (
		<Form method="POST" onSubmit={onSelect}>
			<input type="hidden" name="intent" value="assign" />
			<input type="hidden" name="date" value={serializeDate(date)} />
			<input type="hidden" name="mealType" value={mealType} />
			<input type="hidden" name="recipeId" value={recipe.id} />
			{pairing && pairing.overlapCount > 0 && (
				<input type="hidden" name="fromPairing" value="true" />
			)}
			<button
				type="submit"
				className="hover:bg-muted/50 w-full rounded-lg p-2.5 text-left transition-colors"
			>
				<div className="flex items-start gap-3">
					{/* Thumbnail */}
					{recipe.image?.objectKey ? (
						<img
							src={`/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}&w=80&h=80&fit=cover`}
							alt=""
							className="size-9 shrink-0 rounded-full object-cover"
						/>
					) : (
						<div
							className={cn(
								'flex size-9 shrink-0 items-center justify-center rounded-full',
								placeholder.bgClass,
							)}
						>
							<span
								className={cn(
									'font-serif text-sm',
									placeholder.letterColorClass,
								)}
							>
								{placeholder.letter}
							</span>
						</div>
					)}

					<div className="min-w-0 flex-1">
						<div className="flex items-start justify-between gap-2">
							<div className="min-w-0">
								<p className="text-sm font-medium">{recipe.title}</p>
								{recipe.description && (
									<p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
										{recipe.description}
									</p>
								)}
							</div>
							<div className="flex shrink-0 items-center gap-1.5">
								{match && (
									<span
										className={`inline-flex items-center gap-0.5 text-xs ${match.matched === match.total ? 'text-primary' : 'text-muted-foreground'}`}
									>
										{match.matched}/{match.total}
									</span>
								)}
								{totalTime != null && (
									<span className="text-muted-foreground inline-flex items-center gap-0.5 text-xs">
										<Icon name="clock" className="size-3" />
										{totalTime}m
									</span>
								)}
								{pairing && pairing.overlapCount > 0 && (
									<span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
										{pairing.overlapCount} shared
									</span>
								)}
							</div>
						</div>
						{pairing && pairing.overlapCount > 0 && (
							<p className="text-muted-foreground mt-1 text-xs">
								{pairing.overlapIngredients.join(', ')}
							</p>
						)}
					</div>
				</div>
			</button>
		</Form>
	)
}
