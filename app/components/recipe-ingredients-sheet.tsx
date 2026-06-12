import { useState } from 'react'
import { type useFetcher } from 'react-router'
import {
	IngredientList,
	type IngredientListIngredient,
} from '#app/components/recipe-ingredient-list.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { useModal } from '#app/utils/use-modal.ts'

/**
 * Mobile-only "ingredients at hand" affordance for mid-cook glances: a quiet
 * text pill (bottom-left, opposite the timer pill) that opens the ingredient
 * list as a bottom sheet over the steps — same sheet pattern as the shopping
 * quick-add. Check-off and scaled amounts work inside; dismiss and you're
 * still on your step.
 */
export function RecipeIngredientsSheet({
	visible,
	checkedCount,
	totalCount,
	ingredients,
	checkedIngredients,
	onToggle,
	ratio,
	missingIngredientIds,
	recipeId,
	shoppingFetcher,
	useMetric,
}: {
	visible: boolean
	checkedCount: number
	totalCount: number
	ingredients: IngredientListIngredient[]
	checkedIngredients: Set<string>
	onToggle: (id: string) => void
	ratio: number
	missingIngredientIds: string[]
	recipeId: string
	shoppingFetcher: ReturnType<typeof useFetcher>
	useMetric?: boolean
}) {
	const [open, setOpen] = useState(false)

	if (!visible && !open) return null

	return (
		<div className="md:hidden print:hidden">
			{open ? (
				<IngredientsSheet onClose={() => setOpen(false)}>
					<IngredientList
						ingredients={ingredients}
						checkedIngredients={checkedIngredients}
						onToggle={onToggle}
						ratio={ratio}
						missingIngredientIds={missingIngredientIds}
						recipeId={recipeId}
						shoppingFetcher={shoppingFetcher}
						useMetric={useMetric}
						showFooter={false}
					/>
				</IngredientsSheet>
			) : (
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="bg-card text-foreground shadow-warm-lg border-border/60 fixed bottom-[5.5rem] left-4 z-50 flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-all active:scale-95"
				>
					Ingredients
					<span className="text-muted-foreground text-xs tabular-nums">
						· {checkedCount}/{totalCount}
					</span>
				</button>
			)}
		</div>
	)
}

function IngredientsSheet({
	onClose,
	children,
}: {
	onClose: () => void
	children: React.ReactNode
}) {
	const dialogRef = useModal(onClose)

	return (
		<div
			ref={dialogRef}
			role="dialog"
			aria-modal="true"
			aria-labelledby="ingredients-sheet-title"
		>
			<div className="fixed inset-0 z-40 bg-black/15" onClick={onClose} />
			<div className="animate-slide-up-reveal border-border/60 bg-card shadow-warm-lg fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 rounded-t-xl border-t p-4">
				<div className="mb-2 flex items-center justify-between">
					<span id="ingredients-sheet-title" className="text-sm font-medium">
						Ingredients
					</span>
					<button
						type="button"
						onClick={onClose}
						className="text-muted-foreground hover:text-foreground -m-1 p-1"
						aria-label="Close"
					>
						<Icon name="cross-1" size="sm" />
					</button>
				</div>
				<div className="max-h-[55vh] overflow-y-auto overscroll-contain">
					{children}
				</div>
			</div>
		</div>
	)
}
