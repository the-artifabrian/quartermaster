import { useState } from 'react'
import { Form } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { type MealType, MEAL_TYPE_LABELS } from '#app/utils/date.ts'
import { type Recipe } from '@prisma/client'
import { useDoubleCheck } from '#app/utils/misc.tsx'
import { RecipeSelector } from './recipe-selector.tsx'

type MealSlotCardProps = {
	date: Date
	mealType: MealType
	entries: Array<{ id: string; recipe: Recipe }>
	recipes: Recipe[]
}

function EntryRow({ entry }: { entry: { id: string; recipe: Recipe } }) {
	const dc = useDoubleCheck()

	return (
		<div className="flex items-center gap-2">
			<h4 className="line-clamp-2 flex-1 text-sm font-semibold">
				{entry.recipe.title}
			</h4>
			<Form method="POST">
				<input type="hidden" name="intent" value="remove" />
				<input type="hidden" name="entryId" value={entry.id} />
				<StatusButton
					type="submit"
					size="sm"
					variant="ghost"
					status="idle"
					{...dc.getButtonProps()}
				>
					<Icon name="trash" size="sm" />
				</StatusButton>
			</Form>
		</div>
	)
}

export function MealSlotCard({
	date,
	mealType,
	entries,
	recipes,
}: MealSlotCardProps) {
	const [isSelectingRecipe, setIsSelectingRecipe] = useState(false)

	const assignedRecipeIds = entries.map(e => e.recipe.id)

	if (entries.length === 0) {
		return (
			<div className="rounded-lg border bg-card p-4">
				<div className="mb-2 text-xs font-medium text-muted-foreground">
					{MEAL_TYPE_LABELS[mealType]}
				</div>
				<div className="flex min-h-[100px] items-center justify-center">
					{isSelectingRecipe ? (
						<RecipeSelector
							recipes={recipes}
							date={date}
							mealType={mealType}
							excludeRecipeIds={assignedRecipeIds}
							onCancel={() => setIsSelectingRecipe(false)}
						/>
					) : (
						<Button
							variant="ghost"
							onClick={() => setIsSelectingRecipe(true)}
							className="h-auto flex-col gap-1 py-4"
						>
							<Icon name="plus" size="lg" className="text-muted-foreground" />
							<span className="text-xs text-muted-foreground">Add Recipe</span>
						</Button>
					)}
				</div>
			</div>
		)
	}

	return (
		<div className="group overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md">
			<div className="border-b bg-muted/50 p-2">
				<p className="text-xs font-medium text-muted-foreground">
					{MEAL_TYPE_LABELS[mealType]}
				</p>
			</div>
			<div className="space-y-2 p-3">
				{entries.map(entry => (
					<EntryRow key={entry.id} entry={entry} />
				))}
				{isSelectingRecipe ? (
					<div className="border-t pt-2">
						<RecipeSelector
							recipes={recipes}
							date={date}
							mealType={mealType}
							excludeRecipeIds={assignedRecipeIds}
							onCancel={() => setIsSelectingRecipe(false)}
						/>
					</div>
				) : (
					<Button
						variant="ghost"
						size="sm"
						className="w-full"
						onClick={() => setIsSelectingRecipe(true)}
					>
						<Icon name="plus" size="sm" />
						Add Another
					</Button>
				)}
			</div>
		</div>
	)
}
