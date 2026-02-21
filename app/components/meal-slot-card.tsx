import { useState, useEffect, useRef } from 'react'
import { Form, Link, useFetcher } from 'react-router'
import { toast } from 'sonner'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '#app/components/ui/alert-dialog.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { type MealType, MEAL_TYPE_LABELS } from '#app/utils/date.ts'
import { cn, useDoubleCheck } from '#app/utils/misc.tsx'
import {
	type MatchData,
	type PairingData,
	type RecipeSelectorRecipe,
	RecipeSelector,
} from './recipe-selector.tsx'

type MealSlotCardProps = {
	date: Date
	mealType: MealType
	entries: Array<{
		id: string
		servings: number | null
		cooked: boolean
		recipe: RecipeSelectorRecipe
	}>
	recipes: RecipeSelectorRecipe[]
	weekStart: string
}

type QuickCookData = {
	status: string
	recipeTitle?: string
	inventorySummary?: {
		removed: string[]
		updated: string[]
		skipped: Array<{ name: string; inventoryItemId: string; reason: string }>
	} | null
}

function EntryRow({
	entry,
}: {
	entry: {
		id: string
		servings: number | null
		cooked: boolean
		recipe: RecipeSelectorRecipe
	}
}) {
	const dc = useDoubleCheck()
	const servingsFetcher = useFetcher()
	const cookedFetcher = useFetcher<QuickCookData>()
	const prevCookedFetcherState = useRef(cookedFetcher.state)
	const [showCookConfirm, setShowCookConfirm] = useState(false)

	const currentServings = entry.servings ?? entry.recipe.servings

	// Optimistic cooked state: consider both quickCook and toggleCooked
	const cookedIntent = cookedFetcher.formData?.get('intent')
	const isCooked =
		cookedIntent === 'quickCook'
			? true
			: cookedIntent === 'toggleCooked'
				? !entry.cooked
				: entry.cooked

	// Show toast when quickCook completes
	useEffect(() => {
		if (
			prevCookedFetcherState.current !== 'idle' &&
			cookedFetcher.state === 'idle' &&
			cookedFetcher.data?.status === 'success' &&
			cookedFetcher.data?.recipeTitle
		) {
			const summary = cookedFetcher.data.inventorySummary
			if (summary) {
				const parts: string[] = []
				if (summary.removed.length > 0) {
					parts.push(`Removed ${summary.removed.join(', ')}.`)
				}
				if (summary.updated.length > 0) {
					parts.push(`Updated ${summary.updated.join(', ')}.`)
				}
				if (summary.skipped.length > 0) {
					const names = summary.skipped.map((s) => s.name)
					if (names.length <= 3) {
						parts.push(`Skipped ${names.join(', ')}.`)
					} else {
						parts.push(
							`Skipped ${names.slice(0, 3).join(', ')} +${names.length - 3} more.`,
						)
					}
				}
				toast.success(`Cooked ${cookedFetcher.data.recipeTitle}`, {
					description:
						parts.length > 0
							? parts.join(' ')
							: 'No matching inventory items found.',
				})
			} else {
				toast.success(`Cooked ${cookedFetcher.data.recipeTitle}`)
			}
		}
		prevCookedFetcherState.current = cookedFetcher.state
	}, [cookedFetcher.state, cookedFetcher.data])

	function updateServings(newServings: number) {
		const clamped = Math.min(999, Math.max(1, newServings))
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
		<div className={cn(isCooked && 'opacity-50')}>
			<div className="flex items-center gap-2">
				{/* Cooked checkbox */}
				{isCooked ? (
					<cookedFetcher.Form method="POST" className="shrink-0">
						<input type="hidden" name="intent" value="toggleCooked" />
						<input type="hidden" name="entryId" value={entry.id} />
						<button
							type="submit"
							className="border-primary bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full border-2 transition-colors"
							aria-label="Mark as not cooked"
						>
							<Icon name="check" className="size-3" />
						</button>
					</cookedFetcher.Form>
				) : (
					<AlertDialog open={showCookConfirm} onOpenChange={setShowCookConfirm}>
						<button
							type="button"
							onClick={() => setShowCookConfirm(true)}
							className="border-muted-foreground/30 hover:border-primary flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors"
							aria-label="Mark as cooked"
						/>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Mark as cooked?</AlertDialogTitle>
								<AlertDialogDescription>
									This will log the cook and subtract ingredients from your
									inventory.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									onClick={() => {
										void cookedFetcher.submit(
											{
												intent: 'quickCook',
												entryId: entry.id,
											},
											{ method: 'POST' },
										)
									}}
								>
									Cooked
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				)}

				{/* Title + servings inline */}
				<div className="min-w-0 flex-1">
					<h4
						className={cn(
							'line-clamp-1 text-sm font-medium',
							isCooked && 'text-muted-foreground line-through',
						)}
					>
						<Link
							to={
								entry.servings && entry.servings !== entry.recipe.servings
									? `/recipes/${entry.recipe.id}?servings=${entry.servings}`
									: `/recipes/${entry.recipe.id}`
							}
							className="hover:underline"
							onClick={(e) => e.stopPropagation()}
						>
							{entry.recipe.title}
						</Link>
					</h4>
					<div className="mt-0.5 flex items-center gap-0.5">
						<button
							type="button"
							className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-6 items-center justify-center rounded-md transition-colors disabled:opacity-40"
							onClick={() => updateServings(currentServings - 1)}
							disabled={currentServings <= 1}
							aria-label="Decrease servings"
						>
							−
						</button>
						<span className="text-muted-foreground min-w-[2ch] text-center text-xs">
							{currentServings}
						</span>
						<button
							type="button"
							className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-6 items-center justify-center rounded-md transition-colors"
							onClick={() => updateServings(currentServings + 1)}
							aria-label="Increase servings"
						>
							+
						</button>
					</div>
				</div>

				{/* Remove */}
				<Form method="POST" className="shrink-0">
					<input type="hidden" name="intent" value="remove" />
					<input type="hidden" name="entryId" value={entry.id} />
					<StatusButton
						type="submit"
						size="sm"
						variant={dc.doubleCheck ? 'destructive' : 'ghost'}
						status="idle"
						aria-label="Remove from meal plan"
						className={dc.doubleCheck ? undefined : 'size-7 p-0'}
						{...dc.getButtonProps()}
					>
						{dc.doubleCheck ? (
							<span className="text-xs">Sure?</span>
						) : (
							<Icon name="trash" className="size-3.5" />
						)}
					</StatusButton>
				</Form>
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
	const pairingFetcher = useFetcher<{
		pairings: PairingData
		matchData: MatchData
	}>()

	const pairingData = pairingFetcher.data?.pairings
	const matchData = pairingFetcher.data?.matchData

	function openRecipeSelector() {
		setIsSelectingRecipe(true)
		if (!pairingFetcher.data && pairingFetcher.state === 'idle') {
			void pairingFetcher.load(
				`/resources/meal-plan-pairing?weekStart=${weekStart}`,
			)
		}
	}

	const assignedRecipeIds = entries.map((e) => e.recipe.id)

	// Empty slot: ghost + button
	if (entries.length === 0) {
		if (isSelectingRecipe) {
			return (
				<div className="animate-fade-up-reveal rounded-xl border border-dashed p-3">
					<div className="text-muted-foreground mb-2 text-xs font-medium">
						{MEAL_TYPE_LABELS[mealType]}
					</div>
					<RecipeSelector
						recipes={recipes}
						date={date}
						mealType={mealType}
						excludeRecipeIds={assignedRecipeIds}
						onCancel={() => setIsSelectingRecipe(false)}
						onSelect={() => setIsSelectingRecipe(false)}
						pairingData={pairingData}
						matchData={matchData}
					/>
				</div>
			)
		}

		return (
			<button
				type="button"
				onClick={openRecipeSelector}
				className="text-muted-foreground hover:text-foreground hover:border-accent/30 flex w-full items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-xs transition-colors"
			>
				<span className="bg-muted flex size-5 items-center justify-center rounded-full text-[10px]">
					+
				</span>
				{MEAL_TYPE_LABELS[mealType]}
			</button>
		)
	}

	// Filled slot: warm card with entries
	return (
		<div className="bg-card shadow-warm hover:shadow-warm-md group overflow-hidden rounded-xl transition-shadow">
			<div className="flex items-center justify-between px-3 pt-2">
				<p className="text-muted-foreground text-xs font-medium">
					{MEAL_TYPE_LABELS[mealType]}
				</p>
				{!isSelectingRecipe && (
					<button
						type="button"
						onClick={openRecipeSelector}
						className="text-muted-foreground hover:text-foreground -m-1 rounded p-1.5 transition-colors"
						title="Add another recipe"
					>
						<Icon name="plus" className="size-3.5" />
					</button>
				)}
			</div>
			<div className="p-3 pt-2">
				{entries.map((entry, i) => (
					<div
						key={entry.id}
						className={cn(i > 0 && 'border-border/50 mt-2 border-t pt-2')}
					>
						<EntryRow entry={entry} />
					</div>
				))}
				{isSelectingRecipe && (
					<div className="border-border/50 mt-2 border-t pt-2">
						<RecipeSelector
							recipes={recipes}
							date={date}
							mealType={mealType}
							excludeRecipeIds={assignedRecipeIds}
							onCancel={() => setIsSelectingRecipe(false)}
							onSelect={() => setIsSelectingRecipe(false)}
							pairingData={pairingData}
							matchData={matchData}
						/>
					</div>
				)}
			</div>
		</div>
	)
}
