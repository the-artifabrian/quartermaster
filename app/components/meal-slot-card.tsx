import { type Recipe } from '@prisma/client'
import { useState } from 'react'
import { Form, useFetcher } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { type MealType, MEAL_TYPE_LABELS } from '#app/utils/date.ts'
import { cn, useDoubleCheck } from '#app/utils/misc.tsx'
import { type PairingData, RecipeSelector } from './recipe-selector.tsx'

type MealSlotCardProps = {
	date: Date
	mealType: MealType
	entries: Array<{
		id: string
		servings: number | null
		cooked: boolean
		recipe: Recipe
	}>
	recipes: Recipe[]
	weekStart: string
}

function EntryRow({
	entry,
}: {
	entry: {
		id: string
		servings: number | null
		cooked: boolean
		recipe: Recipe
	}
}) {
	const dc = useDoubleCheck()
	const servingsFetcher = useFetcher()
	const cookedFetcher = useFetcher()

	const currentServings = entry.servings ?? entry.recipe.servings

	// Optimistic cooked state
	const isCooked =
		cookedFetcher.formData?.get('intent') === 'toggleCooked'
			? !entry.cooked
			: entry.cooked

	function updateServings(newServings: number) {
		const clamped = Math.max(1, newServings)
		void servingsFetcher.submit(
			{
				intent: 'updateServings',
				entryId: entry.id,
				servings: clamped === entry.recipe.servings ? '' : String(clamped),
			},
			{ method: 'POST' },
		)
	}

	return (
		<div className={cn('space-y-1', isCooked && 'opacity-60')}>
			<div className="flex items-center gap-2">
				<cookedFetcher.Form method="POST" className="flex-shrink-0">
					<input type="hidden" name="intent" value="toggleCooked" />
					<input type="hidden" name="entryId" value={entry.id} />
					<button
						type="submit"
						className={cn(
							'flex size-5 items-center justify-center rounded-full border-2 transition-colors',
							isCooked
								? 'border-green-500 bg-green-500 text-white'
								: 'border-muted-foreground/30 hover:border-green-500',
						)}
						title={isCooked ? 'Mark as not cooked' : 'Mark as cooked'}
					>
						{isCooked && <Icon name="check" size="xs" />}
					</button>
				</cookedFetcher.Form>
				<h4
					className={cn(
						'line-clamp-2 flex-1 text-sm font-semibold',
						isCooked && 'line-through',
					)}
				>
					{entry.recipe.title}
				</h4>
				<Form method="POST">
					<input type="hidden" name="intent" value="remove" />
					<input type="hidden" name="entryId" value={entry.id} />
					<StatusButton
						type="submit"
						size="sm"
						variant={dc.doubleCheck ? 'destructive' : 'ghost'}
						status="idle"
						{...dc.getButtonProps()}
					>
						{dc.doubleCheck ? (
							<span className="text-xs">Sure?</span>
						) : (
							<Icon name="trash" size="sm" />
						)}
					</StatusButton>
				</Form>
			</div>
			<div className="flex items-center gap-1 text-xs">
				<Button
					variant="outline"
					size="sm"
					className="h-5 w-5 p-0 text-xs"
					onClick={() => updateServings(currentServings - 1)}
					disabled={currentServings <= 1}
				>
					-
				</Button>
				<span className="text-muted-foreground min-w-[4ch] text-center">
					{currentServings}
				</span>
				<Button
					variant="outline"
					size="sm"
					className="h-5 w-5 p-0 text-xs"
					onClick={() => updateServings(currentServings + 1)}
				>
					+
				</Button>
				<span className="text-muted-foreground">servings</span>
			</div>
		</div>
	)
}

export function MealSlotCard({
	date,
	mealType,
	entries,
	recipes,
	weekStart,
}: MealSlotCardProps) {
	const [isSelectingRecipe, setIsSelectingRecipe] = useState(false)
	const pairingFetcher = useFetcher<{ pairings: PairingData }>()

	const pairingData = pairingFetcher.data?.pairings

	function openRecipeSelector() {
		setIsSelectingRecipe(true)
		if (!pairingFetcher.data && pairingFetcher.state === 'idle') {
			void pairingFetcher.load(
				`/resources/meal-plan-pairing?weekStart=${weekStart}`,
			)
		}
	}

	const assignedRecipeIds = entries.map((e) => e.recipe.id)

	// Empty slot: compact button that expands to RecipeSelector
	if (entries.length === 0) {
		if (isSelectingRecipe) {
			return (
				<div className="bg-card rounded-xl border border-dashed p-3 shadow-warm">
					<div className="text-muted-foreground mb-2 text-xs font-medium">
						{MEAL_TYPE_LABELS[mealType]}
					</div>
					<RecipeSelector
						recipes={recipes}
						date={date}
						mealType={mealType}
						excludeRecipeIds={assignedRecipeIds}
						onCancel={() => setIsSelectingRecipe(false)}
						pairingData={pairingData}
					/>
				</div>
			)
		}

		return (
			<button
				type="button"
				onClick={openRecipeSelector}
				className="text-muted-foreground hover:text-foreground hover:border-accent/40 hover:bg-accent/5 flex w-full items-center gap-1.5 rounded-xl border border-dashed px-3 py-1.5 text-xs transition-colors"
			>
				<Icon name="plus" size="xs" />
				{MEAL_TYPE_LABELS[mealType]}
			</button>
		)
	}

	// Filled slot: unchanged card with entries
	return (
		<div className="group bg-card overflow-hidden rounded-xl border shadow-warm transition-shadow hover:shadow-warm-md">
			<div className="bg-muted/30 border-b px-3 py-1.5">
				<p className="text-muted-foreground text-xs font-medium">
					{MEAL_TYPE_LABELS[mealType]}
				</p>
			</div>
			<div className="space-y-2 p-3">
				{entries.map((entry) => (
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
							pairingData={pairingData}
						/>
					</div>
				) : (
					<Button
						variant="ghost"
						size="sm"
						className="w-full"
						onClick={openRecipeSelector}
					>
						<Icon name="plus" size="sm" />
						Add Another
					</Button>
				)}
			</div>
		</div>
	)
}
