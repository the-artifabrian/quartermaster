import { useState } from 'react'
import { Form } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { type MealType, serializeDate } from '#app/utils/date.ts'

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

// Deterministic color from recipe title
const PLACEHOLDER_COLORS = [
	'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
	'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
	'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
	'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
	'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
	'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300',
]

function getRecipePlaceholder(title: string) {
	const letter = title.charAt(0).toUpperCase()
	let hash = 0
	for (let i = 0; i < title.length; i++) {
		hash = (hash * 31 + title.charCodeAt(i)) | 0
	}
	const colorClass =
		PLACEHOLDER_COLORS[Math.abs(hash) % PLACEHOLDER_COLORS.length]
	return { letter, colorClass }
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
	const isWeeknight = date.getDay() >= 1 && date.getDay() <= 4

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
				<Button variant="ghost" size="icon" onClick={onCancel}>
					<Icon name="cross-1" size="sm" />
				</Button>
			</div>
			<div className="max-h-[300px] space-y-2 overflow-y-auto">
				{sortedRecipes.length === 0 ? (
					<p className="text-muted-foreground py-4 text-center text-sm">
						No recipes found
					</p>
				) : (
					<>
						{pairsWell.length > 0 && (
							<>
								<p className="text-muted-foreground px-1 text-xs font-medium">
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
									<p className="text-muted-foreground px-1 pt-1 text-xs font-medium">
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
				className="bg-background hover:bg-muted w-full rounded-lg border p-3 text-left transition-colors"
			>
				<div className="flex items-start gap-3">
					{/* Thumbnail */}
					{recipe.image?.objectKey ? (
						<img
							src={`/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}&w=80&h=80&fit=cover`}
							alt=""
							className="size-10 shrink-0 rounded-md object-cover"
						/>
					) : (
						(() => {
							const { letter, colorClass } = getRecipePlaceholder(recipe.title)
							return (
								<div
									className={`flex size-10 shrink-0 items-center justify-center rounded-md text-sm font-bold ${colorClass}`}
								>
									{letter}
								</div>
							)
						})()
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
										className={`inline-flex items-center gap-0.5 text-xs ${match.matched === match.total ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}
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
									<span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
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
