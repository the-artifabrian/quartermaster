import { type Recipe } from '@prisma/client'
import { useState, useEffect, useRef } from 'react'
import { Form, Link, useFetcher } from 'react-router'
import { toast } from 'sonner'
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

type QuickCookData = {
	status: string
	recipeTitle?: string
	inventorySummary?: {
		removed: string[]
		updated: string[]
		flaggedLow: string[]
	} | null
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
	const cookedFetcher = useFetcher<QuickCookData>()
	const prevCookedFetcherState = useRef(cookedFetcher.state)

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
				if (summary.flaggedLow.length > 0) {
					parts.push(`${summary.flaggedLow.join(', ')} marked low.`)
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
				<cookedFetcher.Form method="POST" className="shrink-0">
					<input
						type="hidden"
						name="intent"
						value={entry.cooked ? 'toggleCooked' : 'quickCook'}
					/>
					<input type="hidden" name="entryId" value={entry.id} />
					<button
						type="submit"
						className={cn(
							'flex size-6 items-center justify-center rounded-full border-2 transition-colors',
							isCooked
								? 'border-green-500 bg-green-500 text-white'
								: 'border-muted-foreground/30 hover:border-green-500',
						)}
						title={
							isCooked
								? 'Mark as not cooked'
								: 'Mark as cooked (logs cook + updates inventory)'
						}
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
					<Link
						to={`/recipes/${entry.recipe.id}`}
						className="hover:underline"
						onClick={(e) => e.stopPropagation()}
					>
						{entry.recipe.title}
					</Link>
				</h4>
				<Form method="POST">
					<input type="hidden" name="intent" value="remove" />
					<input type="hidden" name="entryId" value={entry.id} />
					<StatusButton
						type="submit"
						size="sm"
						variant={dc.doubleCheck ? 'destructive' : 'ghost'}
						status="idle"
						aria-label="Remove from meal plan"
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
					className="h-9 w-9 p-0 text-xs"
					onClick={() => updateServings(currentServings - 1)}
					disabled={currentServings <= 1}
					aria-label="Decrease servings"
				>
					-
				</Button>
				<span className="text-muted-foreground min-w-[4ch] text-center">
					{currentServings}
				</span>
				<Button
					variant="outline"
					size="sm"
					className="h-9 w-9 p-0 text-xs"
					onClick={() => updateServings(currentServings + 1)}
					aria-label="Increase servings"
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
				<div className="bg-card shadow-warm rounded-xl border border-dashed p-3">
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
					/>
				</div>
			)
		}

		return (
			<button
				type="button"
				onClick={openRecipeSelector}
				className="text-muted-foreground hover:text-foreground hover:border-accent/40 hover:bg-accent/5 flex w-full items-center gap-1.5 rounded-xl border border-dashed px-3 py-2.5 text-xs transition-colors"
			>
				<Icon name="plus" size="xs" />
				{MEAL_TYPE_LABELS[mealType]}
			</button>
		)
	}

	// Filled slot: card with entries + add button in header
	return (
		<div className="group bg-card shadow-warm hover:shadow-warm-md overflow-hidden rounded-xl border transition-shadow">
			<div className="bg-muted/30 flex items-center justify-between border-b px-3 py-1.5">
				<p className="text-muted-foreground text-xs font-medium">
					{MEAL_TYPE_LABELS[mealType]}
				</p>
				{!isSelectingRecipe && (
					<button
						type="button"
						onClick={openRecipeSelector}
						className="text-muted-foreground hover:text-foreground -m-1 rounded p-2 transition-colors"
						title="Add another recipe"
					>
						<Icon name="plus" className="size-3.5" />
					</button>
				)}
			</div>
			<div className="divide-border/50 divide-y p-3">
				{entries.map((entry) => (
					<div key={entry.id} className="py-2 first:pt-0 last:pb-0">
						<EntryRow entry={entry} />
					</div>
				))}
				{isSelectingRecipe && (
					<div className="border-t pt-2">
						<RecipeSelector
							recipes={recipes}
							date={date}
							mealType={mealType}
							excludeRecipeIds={assignedRecipeIds}
							onCancel={() => setIsSelectingRecipe(false)}
							onSelect={() => setIsSelectingRecipe(false)}
							pairingData={pairingData}
						/>
					</div>
				)}
			</div>
		</div>
	)
}
