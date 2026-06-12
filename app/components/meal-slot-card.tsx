import { Img } from 'openimg/react'
import { useState } from 'react'
import { Form, Link, useFetcher } from 'react-router'

import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { type MealType, MEAL_TYPE_LABELS } from '#app/utils/date.ts'
import { cn, useDoubleCheck } from '#app/utils/misc.tsx'
import { getRecipePlaceholder } from '#app/utils/recipe-placeholder.ts'
import {
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
	const cookedFetcher = useFetcher()

	const currentServings = entry.servings ?? entry.recipe.servings

	// Optimistic cooked state while the toggle is in flight — read the
	// submitted target value so repeat taps each show their own state
	const isCooked = cookedFetcher.formData
		? cookedFetcher.formData.get('cooked') === 'true'
		: entry.cooked

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

	const thumbPlaceholder = entry.recipe.image?.objectKey
		? null
		: getRecipePlaceholder(entry.recipe.title)

	return (
		<div className={cn(isCooked && 'opacity-50')}>
			<div className="flex items-center gap-2 md:gap-1">
				{/* Cooked checkbox — plain toggle, optimistic */}
				<cookedFetcher.Form method="POST" className="shrink-0">
					<input type="hidden" name="intent" value="toggleCooked" />
					<input type="hidden" name="entryId" value={entry.id} />
					{/* Explicit target (not a server-side flip) so double-taps and
					    concurrent household toggles stay last-write-wins */}
					<input type="hidden" name="cooked" value={String(!isCooked)} />
					<button
						type="submit"
						className="flex min-h-11 min-w-11 shrink-0 items-center justify-center md:min-h-0 md:min-w-0 md:p-1"
						aria-label={isCooked ? 'Mark as not cooked' : 'Mark as cooked'}
					>
						{isCooked ? (
							<span className="border-primary bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full border-2 transition-colors">
								<Icon name="check" className="size-3" />
							</span>
						) : (
							<span className="border-muted-foreground/30 hover:border-primary flex size-5 items-center justify-center rounded-full border-2 transition-colors" />
						)}
					</button>
				</cookedFetcher.Form>

				{/* Thumbnail — mobile only (desktop slots are too narrow) */}
				<div className="size-11 shrink-0 overflow-hidden rounded-md md:hidden">
					{entry.recipe.image?.objectKey ? (
						<Img
							src={`/resources/images?objectKey=${encodeURIComponent(entry.recipe.image.objectKey)}`}
							alt=""
							className="h-full w-full object-cover"
							width={88}
							height={88}
						/>
					) : (
						<div
							className={cn(
								'flex h-full w-full items-center justify-center',
								thumbPlaceholder!.bgClass,
							)}
						>
							<span
								className={cn(
									'font-serif text-base',
									thumbPlaceholder!.letterColorClass,
								)}
							>
								{thumbPlaceholder!.letter}
							</span>
						</div>
					)}
				</div>

				{/* Title + servings inline */}
				<div className="min-w-0 flex-1">
					<h4
						className={cn(
							'line-clamp-2 font-serif text-[15px] leading-snug',
							isCooked && 'text-muted-foreground line-through',
						)}
					>
						<Link
							to={
								entry.servings && entry.servings !== entry.recipe.servings
									? `/recipes/${entry.recipe.id}?servings=${entry.servings}`
									: `/recipes/${entry.recipe.id}`
							}
							className={cn('hover:underline', !isCooked && 'text-foreground')}
							onClick={(e) => e.stopPropagation()}
						>
							{entry.recipe.title}
						</Link>
					</h4>
					<div className="flex items-center gap-0.5">
						<button
							type="button"
							className="text-muted-foreground hover:bg-muted hover:text-foreground relative flex size-6 min-h-8 min-w-6 items-center justify-center rounded transition-colors after:absolute after:-inset-x-2.5 after:-inset-y-1.5 after:content-[''] disabled:opacity-40 md:size-5 md:min-h-0 md:min-w-0 md:after:hidden"
							onClick={() => updateServings(currentServings - 1)}
							disabled={currentServings <= 1}
							aria-label="Decrease servings"
						>
							<span className="text-xs">−</span>
						</button>
						<span className="text-muted-foreground min-w-[2ch] text-center text-xs">
							{currentServings}
						</span>
						<button
							type="button"
							className="text-muted-foreground hover:bg-muted hover:text-foreground relative flex size-6 min-h-8 min-w-6 items-center justify-center rounded transition-colors after:absolute after:-inset-x-2.5 after:-inset-y-1.5 after:content-[''] md:size-5 md:min-h-0 md:min-w-0 md:after:hidden"
							onClick={() => updateServings(currentServings + 1)}
							aria-label="Increase servings"
						>
							<span className="text-xs">+</span>
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
						aria-label={
							dc.doubleCheck
								? 'Tap again to remove from meal plan'
								: 'Remove from meal plan'
						}
						className={dc.doubleCheck ? undefined : 'size-9 p-0 md:size-7'}
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
}: MealSlotCardProps) {
	const [isSelectingRecipe, setIsSelectingRecipe] = useState(false)

	const assignedRecipeIds = entries.map((e) => e.recipe.id)

	const selectorDropdown = isSelectingRecipe ? (
		<div className="bg-card animate-fade-up-reveal shadow-warm-lg absolute top-full right-0 left-0 z-20 mt-1 rounded-lg border p-3 md:min-w-[280px]">
			<RecipeSelector
				recipes={recipes}
				date={date}
				mealType={mealType}
				excludeRecipeIds={assignedRecipeIds}
				onCancel={() => setIsSelectingRecipe(false)}
				onSelect={() => setIsSelectingRecipe(false)}
			/>
		</div>
	) : null

	// Empty slot: quiet add row
	if (entries.length === 0) {
		return (
			<div className="relative">
				<button
					type="button"
					onClick={() => setIsSelectingRecipe(true)}
					className={cn(
						'text-muted-foreground hover:text-foreground flex min-h-9 w-full items-center gap-1.5 rounded-md py-1.5 text-[13px] transition-colors',
						isSelectingRecipe && 'text-foreground',
					)}
				>
					<Icon name="plus" className="size-3.5" />
					{MEAL_TYPE_LABELS[mealType]}
				</button>
				{selectorDropdown}
			</div>
		)
	}

	// Filled slot: flat rows under the meal-type label
	return (
		<div className="group relative">
			<div className="flex items-center justify-between pt-2 md:pt-1.5">
				<p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
					{MEAL_TYPE_LABELS[mealType]}
				</p>
				<button
					type="button"
					onClick={() => setIsSelectingRecipe(!isSelectingRecipe)}
					className="text-muted-foreground hover:text-foreground -m-1 rounded p-1.5 transition-colors"
					title={isSelectingRecipe ? 'Close' : 'Add another recipe'}
				>
					<Icon
						name={isSelectingRecipe ? 'cross-1' : 'plus'}
						className="size-3.5"
					/>
				</button>
			</div>
			<div className="pt-2 pb-3 md:pt-1 md:pb-2">
				{entries.map((entry, i) => (
					<div
						key={entry.id}
						className={cn(i > 0 && 'border-border/50 mt-2 border-t pt-2')}
					>
						<EntryRow entry={entry} />
					</div>
				))}
			</div>
			{selectorDropdown}
		</div>
	)
}
