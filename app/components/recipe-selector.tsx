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

type RecipeSelectorProps = {
	recipes: RecipeSelectorRecipe[]
	date: Date
	mealType: MealType
	excludeRecipeIds?: string[]
	onCancel: () => void
	onSelect?: () => void
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
}: RecipeSelectorProps) {
	const [search, setSearch] = useState('')

	const filteredRecipes = recipes
		.filter((r) => !excludeRecipeIds.includes(r.id))
		.filter((r) => r.title.toLowerCase().includes(search.toLowerCase()))

	// Mon=1..Thu=4 are weeknights — sort by cook time
	const isWeeknight = date.getUTCDay() >= 1 && date.getUTCDay() <= 4
	const sortedRecipes = isWeeknight
		? [...filteredRecipes].sort(sortByTime)
		: filteredRecipes

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
			<div className="scrollbar-thin max-h-[300px] space-y-0.5 overflow-y-auto">
				{sortedRecipes.length === 0 ? (
					<p className="text-muted-foreground py-4 text-center text-sm">
						No recipes found
					</p>
				) : (
					sortedRecipes.map((recipe) => (
						<RecipeOption
							key={recipe.id}
							recipe={recipe}
							date={date}
							mealType={mealType}
							onSelect={onSelect}
						/>
					))
				)}
			</div>
		</div>
	)
}

function RecipeOption({
	recipe,
	date,
	mealType,
	onSelect,
}: {
	recipe: RecipeSelectorRecipe
	date: Date
	mealType: MealType
	onSelect?: () => void
}) {
	const totalTime = getTotalTime(recipe)

	return (
		<Form method="POST" onSubmit={onSelect}>
			<input type="hidden" name="intent" value="assign" />
			<input type="hidden" name="date" value={serializeDate(date)} />
			<input type="hidden" name="mealType" value={mealType} />
			<input type="hidden" name="recipeId" value={recipe.id} />
			<button
				type="submit"
				className="hover:bg-muted/50 w-full rounded-lg px-2 py-1.5 text-left transition-colors"
			>
				<div className="flex items-center justify-between gap-2">
					<p className="min-w-0 truncate text-sm font-medium">
						{recipe.title}
					</p>
					{totalTime != null && (
						<span className="text-muted-foreground inline-flex shrink-0 items-center gap-0.5 text-xs">
							<Icon name="clock" className="size-3" />
							{totalTime}m
						</span>
					)}
				</div>
			</button>
		</Form>
	)
}
