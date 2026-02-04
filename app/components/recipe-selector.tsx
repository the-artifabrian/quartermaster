import { useState } from 'react'
import { Form } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { type MealType, serializeDate } from '#app/utils/date.ts'
import { type Recipe } from '@prisma/client'

type RecipeSelectorProps = {
	recipes: Recipe[]
	date: Date
	mealType: MealType
	excludeRecipeIds?: string[]
	onCancel: () => void
}

export function RecipeSelector({
	recipes,
	date,
	mealType,
	excludeRecipeIds = [],
	onCancel,
}: RecipeSelectorProps) {
	const [search, setSearch] = useState('')

	const filteredRecipes = recipes
		.filter(r => !excludeRecipeIds.includes(r.id))
		.filter(r => r.title.toLowerCase().includes(search.toLowerCase()))

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<Input
					placeholder="Search recipes..."
					value={search}
					onChange={e => setSearch(e.target.value)}
					autoFocus
				/>
				<Button variant="ghost" size="icon" onClick={onCancel}>
					<Icon name="cross-1" size="sm" />
				</Button>
			</div>
			<div className="max-h-[300px] space-y-2 overflow-y-auto">
				{filteredRecipes.length === 0 ? (
					<p className="py-4 text-center text-sm text-muted-foreground">
						No recipes found
					</p>
				) : (
					filteredRecipes.map(recipe => (
						<Form method="POST" key={recipe.id}>
							<input type="hidden" name="intent" value="assign" />
							<input type="hidden" name="date" value={serializeDate(date)} />
							<input type="hidden" name="mealType" value={mealType} />
							<input type="hidden" name="recipeId" value={recipe.id} />
							<button
								type="submit"
								className="w-full rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted"
							>
								<p className="text-sm font-medium">{recipe.title}</p>
								{recipe.description && (
									<p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
										{recipe.description}
									</p>
								)}
							</button>
						</Form>
					))
				)}
			</div>
		</div>
	)
}
