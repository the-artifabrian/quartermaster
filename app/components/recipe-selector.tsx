import { type Recipe } from '@prisma/client'
import { useState } from 'react'
import { Form } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { type MealType, serializeDate } from '#app/utils/date.ts'

export type PairingData = Record<
	string,
	{ overlapCount: number; overlapIngredients: string[]; score: number }
>

type RecipeSelectorProps = {
	recipes: Recipe[]
	date: Date
	mealType: MealType
	excludeRecipeIds?: string[]
	onCancel: () => void
	pairingData?: PairingData
}

export function RecipeSelector({
	recipes,
	date,
	mealType,
	excludeRecipeIds = [],
	onCancel,
	pairingData,
}: RecipeSelectorProps) {
	const [search, setSearch] = useState('')

	const filteredRecipes = recipes
		.filter((r) => !excludeRecipeIds.includes(r.id))
		.filter((r) => r.title.toLowerCase().includes(search.toLowerCase()))

	// Sort by pairing overlap if data is available
	const sortedRecipes = pairingData
		? [...filteredRecipes].sort((a, b) => {
				const aOverlap = pairingData[a.id]?.overlapCount ?? 0
				const bOverlap = pairingData[b.id]?.overlapCount ?? 0
				return bOverlap - aOverlap
			})
		: filteredRecipes

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
}: {
	recipe: Recipe
	date: Date
	mealType: MealType
	pairing?: {
		overlapCount: number
		overlapIngredients: string[]
		score: number
	}
}) {
	return (
		<Form method="POST">
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
				<div className="flex items-start justify-between gap-2">
					<div className="min-w-0 flex-1">
						<p className="text-sm font-medium">{recipe.title}</p>
						{recipe.description && (
							<p className="text-muted-foreground mt-1 line-clamp-1 text-xs">
								{recipe.description}
							</p>
						)}
					</div>
					{pairing && pairing.overlapCount > 0 && (
						<span className="inline-flex flex-shrink-0 items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
							{pairing.overlapCount} shared
						</span>
					)}
				</div>
				{pairing && pairing.overlapCount > 0 && (
					<p className="text-muted-foreground mt-1 text-xs">
						{pairing.overlapIngredients.join(', ')}
					</p>
				)}
			</button>
		</Form>
	)
}
