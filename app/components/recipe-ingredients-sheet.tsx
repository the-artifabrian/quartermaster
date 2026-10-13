import { useState } from 'react'
import {
	IngredientList,
	type IngredientListIngredient,
} from '#app/components/recipe-ingredient-list.tsx'
import { BottomSheet } from '#app/components/ui/bottom-sheet.tsx'
import { cn } from '#app/utils/misc.tsx'

/**
 * Mobile-only "ingredients at hand" affordance for mid-cook glances: a quiet
 * text pill that opens the ingredient list as a bottom sheet over the steps —
 * the same sheet pattern as the shopping quick-add. Check-off and scaled
 * amounts work inside; dismiss and you're still on your step.
 */
export function RecipeIngredientsSheet({
	visible,
	checkedCount,
	totalCount,
	ingredients,
	checkedIngredients,
	onToggle,
	ratio,
	recipeId,
	useMetric,
}: {
	visible: boolean
	checkedCount: number
	totalCount: number
	ingredients: IngredientListIngredient[]
	checkedIngredients: Set<string>
	onToggle: (id: string) => void
	ratio: number
	recipeId: string
	useMetric?: boolean
}) {
	const [open, setOpen] = useState(false)

	return (
		<div className="lg:hidden print:hidden">
			{/* Stays mounted under the sheet so focus can come back to it, and
			    comes before it so the leaving sheet slides over it. */}
			{visible && (
				<button
					type="button"
					onClick={() => setOpen(true)}
					className={cn(
						'bg-card text-foreground shadow-warm-lg border-border/60 fixed bottom-[calc(var(--bottom-nav-h)+1.5rem+var(--bottom-nav-inset))] left-4 z-50 flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-all active:scale-95 md:bottom-4',
						open && 'hidden',
					)}
				>
					Ingredients
					<span className="text-muted-foreground text-xs tabular-nums">
						· {checkedCount}/{totalCount}
					</span>
				</button>
			)}
			<BottomSheet
				open={open}
				onClose={() => setOpen(false)}
				labelledBy="ingredients-sheet-title"
				title="Ingredients"
				className="md:bottom-0"
			>
				<div className="max-h-[55dvh] overflow-y-auto overscroll-contain">
					<IngredientList
						ingredients={ingredients}
						checkedIngredients={checkedIngredients}
						onToggle={onToggle}
						ratio={ratio}
						recipeId={recipeId}
						useMetric={useMetric}
					/>
				</div>
			</BottomSheet>
		</div>
	)
}
