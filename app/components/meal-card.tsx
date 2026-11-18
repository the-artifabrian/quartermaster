import { type SubmissionResult } from '@conform-to/react'
import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { ErrorList } from '#app/components/forms.tsx'
import {
	PlanChoiceRequestState,
	type PlanChoices,
} from '#app/components/plan-choices.tsx'
import { RecipeScaleControl } from '#app/components/recipe-scale-control.tsx'
import {
	useDeleteWithUndo,
	useEnteringRows,
	useHiddenRows,
} from '#app/components/undo-delete.tsx'
import { BottomSheet, opensAsSheet } from '#app/components/ui/bottom-sheet.tsx'
import { Button } from '#app/components/ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '#app/components/ui/dropdown-menu.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { RowCollapse } from '#app/components/ui/row-collapse.tsx'
import { MEAL_TYPES, MEAL_TYPE_LABELS, type MealType } from '#app/utils/date.ts'
import { groupSnapshotEntries } from '#app/utils/menu-snapshot.ts'
import { formatScaleMultiplier } from '#app/utils/menu-validation.ts'
import { cn } from '#app/utils/misc.tsx'
import { formatServingTime, servingWallTime } from '#app/utils/serving-time.ts'
import { RecipeSelector } from './recipe-selector.tsx'

export type PlanMealItem = {
	id: string
	recipeTitle: string
	scaleMultiplier: number
	cooked: boolean
	/// Frozen display note copied from the Menu card (#107).
	note: string | null
	order: number
	sectionId: string | null
	recipe: {
		id: string
		title: string
		yieldAmount: number | null
		yieldLabel: string | null
		totalTime: number | null
		image: { objectKey: string } | null
	} | null
}

export type PlanMealNote = {
	id: string
	text: string
	order: number
	sectionId: string | null
	shoppingLines: Array<{
		id: string
		name: string
		quantity: string | null
		unit: string | null
	}>
}

export type PlanMeal = {
	id: string
	dateStr: string
	label: string | null
	servingAt: string | null
	servingTimeZone: string | null
	genericText: string | null
	completed: boolean
	guestCount: number | null
	sourceMenu: { id: string; title: string } | null
	/// Frozen Menu snapshot structure (#107); empty for planner-created Meals.
	sections: Array<{ id: string; name: string | null }>
	noteItems: PlanMealNote[]
	/// True once the Meal has been added to Shopping.
	addedToShopping: boolean
	items: PlanMealItem[]
}

export function mealLabelText(label: string) {
	return MEAL_TYPE_LABELS[label as MealType] ?? label
}

function MultiplierControl({ item }: { item: PlanMealItem }) {
	const fetcher = useFetcher()
	const submitted = fetcher.formData?.get('multiplier')
	const shownMultiplier =
		typeof submitted === 'string'
			? Number(submitted.replace(',', '.'))
			: item.scaleMultiplier
	return (
		<RecipeScaleControl
			scaleMultiplier={shownMultiplier}
			yieldAmount={item.recipe?.yieldAmount ?? null}
			yieldLabel={item.recipe?.yieldLabel ?? null}
			compact
			onScaleMultiplierChange={(scaleMultiplier) => {
				void fetcher.submit(
					{
						intent: 'setItemMultiplier',
						itemId: item.id,
						multiplier: formatScaleMultiplier(scaleMultiplier),
					},
					{ method: 'POST' },
				)
			}}
		/>
	)
}

function ItemRow({
	item,
	showRemove,
}: {
	item: PlanMealItem
	showRemove: boolean
}) {
	const cookedFetcher = useFetcher()
	const deleteWithUndo = useDeleteWithUndo()

	// Optimistic cooked state while the toggle is in flight — read the
	// submitted target value so repeat taps each show their own state
	const isCooked = cookedFetcher.formData
		? cookedFetcher.formData.get('cooked') === 'true'
		: item.cooked

	const missing = item.recipe == null
	return (
		<div
			className={cn(
				'flex items-center gap-2 md:gap-1',
				isCooked && 'opacity-50',
			)}
		>
			{/* Cooked checkbox — independent per Recipe item (#98) */}
			<cookedFetcher.Form method="POST" className="shrink-0">
				<input type="hidden" name="intent" value="setItemCooked" />
				<input type="hidden" name="itemId" value={item.id} />
				{/* Explicit target (not a server-side flip) so double-taps and
				    concurrent household toggles stay last-write-wins */}
				<input type="hidden" name="cooked" value={String(!isCooked)} />
				<button
					type="submit"
					className="flex min-h-11 min-w-11 shrink-0 items-center justify-center md:min-h-0 md:min-w-0 md:p-1"
					aria-label={
						isCooked
							? `Mark ${item.recipeTitle} as not cooked`
							: `Mark ${item.recipeTitle} as cooked`
					}
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

			{/* Title + multiplier */}
			<div className="min-w-0 flex-1">
				<h4
					className={cn(
						'line-clamp-2 font-serif text-[15px] leading-snug',
						isCooked && 'text-muted-foreground line-through',
					)}
				>
					{item.recipe ? (
						<Link
							to={
								item.scaleMultiplier !== 1
									? `/recipes/${item.recipe.id}?scale=${formatScaleMultiplier(item.scaleMultiplier)}`
									: `/recipes/${item.recipe.id}`
							}
							className={cn('hover:underline', !isCooked && 'text-foreground')}
							onClick={(e) => e.stopPropagation()}
						>
							{item.recipeTitle}
						</Link>
					) : (
						<span className="text-muted-foreground">{item.recipeTitle}</span>
					)}
				</h4>
				{missing ? (
					<p className="text-muted-foreground text-xs">Recipe deleted</p>
				) : (
					<MultiplierControl item={item} />
				)}
				{item.note ? (
					<p className="text-muted-foreground text-xs leading-snug break-words">
						{item.note}
					</p>
				) : null}
			</div>

			{/* Remove item: at once, with Undo */}
			{showRemove && (
				<Button
					type="button"
					size="sm"
					variant="ghost"
					className="text-destructive hover:text-destructive desktop:size-7 size-11 shrink-0 p-0"
					aria-label={`Remove ${item.recipeTitle} from this meal`}
					onClick={() =>
						deleteWithUndo({
							key: `meal-item:${item.id}`,
							hides: [item.id],
							message: `Removed ${item.recipeTitle}`,
							what: item.recipeTitle,
							verb: 'remove',
							request: { intent: 'delete-meal-item', itemId: item.id },
						})
					}
				>
					<Icon name="trash" className="size-3.5" />
				</Button>
			)}
		</div>
	)
}

/**
 * A frozen snapshot note card (#107) — read-only text plus its ordinary
 * Shopping lines, compact enough for the planner's day columns.
 */
function NoteRow({ note }: { note: PlanMealNote }) {
	return (
		<div className="text-muted-foreground flex items-start gap-2">
			<Icon name="pencil-2" className="mt-0.5 size-3.5 shrink-0" />
			<div className="min-w-0 flex-1">
				<p className="text-[13px] leading-snug break-words whitespace-pre-wrap">
					{note.text}
				</p>
				{note.shoppingLines.length > 0 ? (
					<ul className="mt-1 space-y-0.5">
						{note.shoppingLines.map((line) => (
							<li key={line.id} className="flex items-baseline gap-1 text-xs">
								<Icon name="cart" className="size-3 shrink-0 translate-y-px" />
								<span className="min-w-0 break-words">{line.name}</span>
								{line.quantity || line.unit ? (
									<span className="shrink-0 tabular-nums">
										{[line.quantity, line.unit].filter(Boolean).join(' ')}
									</span>
								) : null}
							</li>
						))}
					</ul>
				) : null}
			</div>
		</div>
	)
}

type MealRow =
	| { kind: 'heading'; key: string; name: string }
	| { kind: 'recipe'; key: string; item: PlanMealItem }
	| { kind: 'note'; key: string; note: PlanMealNote }

/**
 * Frozen sections first — each heading followed by its Recipe and note cards
 * interleaved by their shared order — then unsectioned items: everything
 * planner-created, plus Recipes added to a snapshot Meal later. Empty frozen
 * sections stay stored but render nothing.
 */
function buildMealRows(meal: PlanMeal): MealRow[] {
	const rows: MealRow[] = []
	for (const group of groupSnapshotEntries(
		meal.sections,
		meal.items,
		meal.noteItems,
	)) {
		if (group.entries.length === 0) continue
		if (group.name) {
			rows.push({ kind: 'heading', key: group.id, name: group.name })
		}
		rows.push(
			...group.entries.map((entry) =>
				entry.kind === 'recipe'
					? { kind: 'recipe' as const, key: entry.item.id, item: entry.item }
					: { kind: 'note' as const, key: entry.item.id, note: entry.item },
			),
		)
	}
	rows.push(
		...meal.items
			.filter((item) => item.sectionId == null)
			.map((item) => ({ kind: 'recipe' as const, key: item.id, item })),
		// Unsectioned notes have no write path today; render any rather than
		// silently hiding stored content.
		...meal.noteItems
			.filter((note) => note.sectionId == null)
			.map((note) => ({ kind: 'note' as const, key: note.id, note })),
	)
	return rows
}

function MealDetailsForm({
	meal,
	onDone,
	inSheet = false,
}: {
	meal: PlanMeal
	onDone: () => void
	/** A sheet closes by its own Close and puts Save full width. */
	inSheet?: boolean
}) {
	const fetcher = useFetcher<{
		status: string
		submission?: SubmissionResult
	}>()
	const wasSubmitting = useRef(false)
	// Use the stored zone for an existing time; the browser names a new time.
	const [timeZone] = useState(
		() =>
			meal.servingTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
	)

	useEffect(() => {
		if (wasSubmitting.current && fetcher.state === 'idle') {
			if (fetcher.data?.status === 'success') onDone()
		}
		wasSubmitting.current = fetcher.state !== 'idle'
	}, [fetcher.state, fetcher.data, onDone])

	const defaultTime =
		meal.servingAt && meal.servingTimeZone
			? servingWallTime(new Date(meal.servingAt), meal.servingTimeZone)
			: ''

	return (
		<fetcher.Form method="POST" className="space-y-3">
			<input type="hidden" name="intent" value="updateMealDetails" />
			<input type="hidden" name="mealId" value={meal.id} />
			<input type="hidden" name="timeZone" value={timeZone} />

			<div>
				<label
					htmlFor={`date-${meal.id}`}
					className="text-muted-foreground mb-1 block text-xs font-medium"
				>
					Date
				</label>
				<Input
					id={`date-${meal.id}`}
					type="date"
					name="date"
					required
					defaultValue={meal.dateStr}
					className="h-11 md:h-9"
				/>
			</div>

			<div>
				<label
					htmlFor={`label-${meal.id}`}
					className="text-muted-foreground mb-1 block text-xs font-medium"
				>
					Label
				</label>
				<select
					id={`label-${meal.id}`}
					name="label"
					defaultValue={meal.label ?? ''}
					className="border-input bg-background h-11 w-full rounded-md border px-2 text-sm md:h-9"
				>
					<option value="">No label</option>
					{MEAL_TYPES.map((type) => (
						<option key={type} value={type}>
							{MEAL_TYPE_LABELS[type]}
						</option>
					))}
				</select>
			</div>

			<div>
				<label
					htmlFor={`time-${meal.id}`}
					className="text-muted-foreground mb-1 block text-xs font-medium"
				>
					Serving time
				</label>
				<Input
					id={`time-${meal.id}`}
					type="time"
					name="time"
					defaultValue={defaultTime}
					className="h-11 md:h-9"
				/>
			</div>

			<div>
				<label
					htmlFor={`guests-${meal.id}`}
					className="text-muted-foreground mb-1 block text-xs font-medium"
				>
					Guests
				</label>
				<Input
					id={`guests-${meal.id}`}
					type="number"
					inputMode="numeric"
					enterKeyHint="done"
					name="guestCount"
					min={1}
					max={999}
					defaultValue={meal.guestCount ?? ''}
					className="h-11 md:h-9"
				/>
			</div>

			{meal.genericText != null && (
				<div>
					<label
						htmlFor={`text-${meal.id}`}
						className="text-muted-foreground mb-1 block text-xs font-medium"
					>
						Text
					</label>
					<Input
						id={`text-${meal.id}`}
						name="text"
						defaultValue={meal.genericText}
						maxLength={200}
						className="h-11 md:h-9"
					/>
				</div>
			)}

			<div role="alert">
				<ErrorList
					errors={Object.values(fetcher.data?.submission?.error ?? {}).flat()}
				/>
			</div>
			{inSheet ? (
				<Button
					type="submit"
					className="w-full"
					disabled={fetcher.state !== 'idle'}
				>
					{fetcher.state !== 'idle' ? 'Saving…' : 'Save'}
				</Button>
			) : (
				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" size="sm" onClick={onDone}>
						Cancel
					</Button>
					<Button type="submit" size="sm" disabled={fetcher.state !== 'idle'}>
						{fetcher.state !== 'idle' ? 'Saving…' : 'Save'}
					</Button>
				</div>
			)}
		</fetcher.Form>
	)
}

export function MealCard({
	meal,
	choices,
	canMoveUp,
	canMoveDown,
}: {
	meal: PlanMeal
	choices: PlanChoices
	canMoveUp: boolean
	canMoveDown: boolean
}) {
	const moveFetcher = useFetcher()
	const [searchParams] = useSearchParams()
	const targetMealId = searchParams.get('mealId')
	const cardRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const card = cardRef.current
		// Both responsive calendars are mounted; only focus the visible copy.
		if (targetMealId === meal.id && card?.getClientRects().length) {
			card.focus({ preventScroll: true })
			card.scrollIntoView({ block: 'center' })
		}
	}, [targetMealId, meal.id, meal.dateStr])
	const mealCookedFetcher = useFetcher()
	const deleteWithUndo = useDeleteWithUndo()
	const addRecipeFetcher = useFetcher()
	const addToShoppingFetcher = useFetcher<{
		status: string
		refreshed?: boolean
		shopping?: {
			createdRowCount: number
			attachedCount?: number
			alreadyContributedCount?: number
			updatedContributionCount?: number
			removedContributionCount?: number
			promotedRowCount?: number
		}
	}>()
	const [addingRecipe, setAddingRecipe] = useState(false)
	// On a phone the Recipe picker and Edit details are bottom sheets; wider,
	// they open in place. Set when each opens.
	const [recipeInSheet, setRecipeInSheet] = useState(false)
	const [detailsInSheet, setDetailsInSheet] = useState(false)
	const addRecipeButtonRef = useRef<HTMLButtonElement>(null)
	// Edit details' sheet hands focus back here: its menu item is gone.
	const menuTriggerRef = useRef<HTMLButtonElement>(null)
	// Closing the picker unmounts whatever had focus; hand focus back to the
	// button that opened it instead of dropping it on the page.
	const restoreAddRecipeFocus = useRef(false)
	useEffect(() => {
		if (!addingRecipe && restoreAddRecipeFocus.current) {
			restoreAddRecipeFocus.current = false
			addRecipeButtonRef.current?.focus()
		}
	}, [addingRecipe])
	function closeRecipePicker() {
		restoreAddRecipeFocus.current = true
		setAddingRecipe(false)
	}
	const [editingDetails, setEditingDetails] = useState(false)
	const [menuOpen, setMenuOpen] = useState(false)
	const menuPointer = useRef<string | null>(null)

	const isText = meal.genericText != null
	// A Recipe Meal derives completion from its items; a text-only Meal owns
	// one completed flag (#98 readiness corrections).
	const optimisticMealCooked = mealCookedFetcher.formData
		? mealCookedFetcher.formData.get('cooked') === 'true'
		: null
	const isComplete =
		optimisticMealCooked ??
		(isText
			? meal.completed
			: meal.items.length > 0 && meal.items.every((item) => item.cooked))

	const timeText =
		meal.servingAt && meal.servingTimeZone
			? formatServingTime(new Date(meal.servingAt), meal.servingTimeZone)
			: null

	const rows = isText ? [] : buildMealRows(meal)
	const hidden = useHiddenRows()
	const entering = useEnteringRows()
	const visibleItemCount = meal.items.filter(
		(item) => !hidden.has(item.id),
	).length
	// The toast names the Meal as a person would: its text, its one Recipe or
	// its label; anything else is "the Meal".
	const mealToastName = isText
		? meal.genericText
		: meal.items.length === 1
			? meal.items[0]!.recipeTitle
			: meal.label
				? mealLabelText(meal.label)
				: 'the Meal'
	// Goes at once, with Undo.
	function deleteMeal(removeShoppingContributions: boolean) {
		deleteWithUndo({
			key: `meal:${meal.id}`,
			hides: [meal.id],
			what: 'the Meal',
			message: removeShoppingContributions
				? `Deleted ${mealToastName} and its Shopping amounts`
				: `Deleted ${mealToastName}`,
			request: {
				intent: 'delete-meal',
				mealId: meal.id,
				removeShoppingContributions,
			},
		})
	}
	const mealActionName = isText
		? meal.genericText
		: meal.items.length === 1
			? meal.items[0]!.recipeTitle
			: meal.label
				? mealLabelText(meal.label)
				: meal.items.length === 0
					? 'this Meal'
					: `${meal.items.length}-recipe Meal`
	const hasShoppingDemand =
		meal.items.length > 0 ||
		meal.noteItems.some((note) => note.shoppingLines.length > 0)

	// Toast once the explicit Add-to-Shopping action settles (#108) — the
	// result is otherwise invisible from the planner.
	const prevShoppingState = useRef(addToShoppingFetcher.state)
	useEffect(() => {
		if (
			prevShoppingState.current !== 'idle' &&
			addToShoppingFetcher.state === 'idle'
		) {
			const data = addToShoppingFetcher.data
			if (data?.status === 'success' && data.shopping) {
				if (data.refreshed) {
					const changed =
						data.shopping.createdRowCount +
						(data.shopping.attachedCount ?? 0) +
						(data.shopping.updatedContributionCount ?? 0) +
						(data.shopping.removedContributionCount ?? 0) +
						(data.shopping.promotedRowCount ?? 0)
					if (changed > 0) toast.success('Shopping updated')
					else toast.info('Shopping is up to date')
					prevShoppingState.current = addToShoppingFetcher.state
					return
				}
				const { createdRowCount, attachedCount, alreadyContributedCount } =
					data.shopping
				if (createdRowCount > 0) {
					toast.success(
						`Added ${createdRowCount} item${createdRowCount === 1 ? '' : 's'} to Shopping`,
					)
				} else if ((attachedCount ?? 0) > 0) {
					toast.success('Everything is already on Shopping')
				} else if ((alreadyContributedCount ?? 0) > 0) {
					toast.info('This Meal is already on Shopping')
				} else {
					toast.info('Nothing to add to Shopping')
				}
			}
		}
		prevShoppingState.current = addToShoppingFetcher.state
	}, [addToShoppingFetcher.state, addToShoppingFetcher.data])

	const recipePicker =
		choices.state.status === 'success' ? (
			<RecipeSelector
				recipes={choices.state.recipes}
				date={new Date(meal.dateStr + 'T00:00:00.000Z')}
				excludeRecipeIds={meal.items.flatMap((item) => item.recipe?.id ?? [])}
				onCancel={closeRecipePicker}
				// A sheet has its own Close.
				showClose={!recipeInSheet}
				onPick={(recipe) => {
					void addRecipeFetcher.submit(
						{
							intent: 'addRecipeToMeal',
							mealId: meal.id,
							recipeId: recipe.id,
						},
						{ method: 'POST' },
					)
					closeRecipePicker()
				}}
			/>
		) : (
			<PlanChoiceRequestState
				state={choices.state.status}
				onRetry={choices.load}
				onCancel={recipeInSheet ? undefined : closeRecipePicker}
				subject="Recipes"
			/>
		)

	function submitMealCooked(cooked: boolean) {
		void mealCookedFetcher.submit(
			{ intent: 'setMealCooked', mealId: meal.id, cooked: String(cooked) },
			{ method: 'POST' },
		)
	}

	return (
		<div
			ref={cardRef}
			tabIndex={-1}
			data-meal-id={meal.id}
			// A flat row under the day heading; the day draws the dividers
			// between Meals (MealCards).
			className="group focus-visible:ring-ring relative rounded-sm py-3 focus-visible:ring-2 md:py-1.5"
		>
			{/* Header: optional label/time/guests on the left — display metadata
			    only, never what orders the day (#98) — controls on the right. */}
			<div className="flex min-h-7 items-center gap-1.5">
				<div className="text-muted-foreground flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-[11px] font-semibold tracking-wider uppercase">
					{meal.label ? (
						<span>{mealLabelText(meal.label)}</span>
					) : (
						<span className="hidden md:inline">Meal</span>
					)}
					{timeText && (
						<span className="inline-flex items-center gap-0.5 normal-case">
							<Icon name="clock" className="size-3" />
							{timeText}
						</span>
					)}
					{meal.guestCount != null && (
						<span className="normal-case">· {meal.guestCount} guests</span>
					)}
					{/* Where the snapshot came from — a reference, not live data */}
					{meal.sourceMenu && (
						<Link
							to={`/recipes/menus/${meal.sourceMenu.id}`}
							className="hover:text-foreground inline-flex max-w-full min-w-0 items-center gap-0.5 normal-case transition-colors"
						>
							<Icon name="file-text" className="size-3 shrink-0" />
							<span className="truncate">{meal.sourceMenu.title}</span>
						</Link>
					)}
				</div>

				<DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenuTrigger asChild>
						<button
							ref={menuTriggerRef}
							type="button"
							// Radix opens a menu on pointerdown. A finger opens it on the
							// tap instead, so a scroll that starts on the button leaves
							// it shut.
							onPointerDown={(event) => {
								menuPointer.current = event.pointerType
								if (event.pointerType !== 'mouse') event.preventDefault()
							}}
							onClick={() => {
								if (menuPointer.current && menuPointer.current !== 'mouse') {
									setMenuOpen((open) => !open)
								}
								menuPointer.current = null
							}}
							// 32px to the eye on a phone, 44px to the thumb: the
							// pseudo-element takes taps without growing the header.
							className="text-muted-foreground hover:text-foreground active:bg-muted relative flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded transition-colors before:absolute before:-inset-1.5 before:content-[''] md:min-h-6 md:min-w-6 md:before:hidden"
							aria-label={`Meal actions for ${mealActionName}`}
						>
							<Icon name="dots-horizontal" className="size-3.5" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{canMoveUp ? (
							<DropdownMenuItem
								onSelect={() => {
									void moveFetcher.submit(
										{
											intent: 'moveMeal',
											mealId: meal.id,
											direction: 'up',
										},
										{ method: 'POST' },
									)
								}}
							>
								<Icon name="arrow-up" size="sm" />
								Move earlier
							</DropdownMenuItem>
						) : null}
						{canMoveDown ? (
							<DropdownMenuItem
								onSelect={() => {
									void moveFetcher.submit(
										{
											intent: 'moveMeal',
											mealId: meal.id,
											direction: 'down',
										},
										{ method: 'POST' },
									)
								}}
							>
								<Icon name="arrow-down" size="sm" />
								Move later
							</DropdownMenuItem>
						) : null}
						{canMoveUp || canMoveDown ? <DropdownMenuSeparator /> : null}
						<DropdownMenuItem onSelect={() => submitMealCooked(!isComplete)}>
							<Icon name="check" size="sm" />
							{isComplete ? 'Mark not cooked' : 'Mark cooked'}
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() => {
								setDetailsInSheet(opensAsSheet())
								setEditingDetails(true)
							}}
						>
							<Icon name="pencil-1" size="sm" />
							Edit details
						</DropdownMenuItem>
						{/* A Meal reaches Shopping only through this explicit action —
						    planning never live-syncs Shopping. Text-only Meals have no
						    Shopping behavior (#108). A Meal already on Shopping keeps
						    Update after losing its demand, so the update can clear it. */}
						{!isText && (hasShoppingDemand || meal.addedToShopping) && (
							<DropdownMenuItem
								disabled={addToShoppingFetcher.state !== 'idle'}
								onSelect={() => {
									void addToShoppingFetcher.submit(
										{
											intent: meal.addedToShopping
												? 'refreshMealShopping'
												: 'addMealToShopping',
											mealId: meal.id,
										},
										{ method: 'POST' },
									)
								}}
							>
								<Icon
									name={meal.addedToShopping ? 'update' : 'cart'}
									size="sm"
								/>
								{meal.addedToShopping ? 'Update Shopping' : 'Add to Shopping'}
							</DropdownMenuItem>
						)}
						<DropdownMenuSeparator />
						{/* A Meal on Shopping asks what to do with its amounts there. */}
						{meal.addedToShopping ? (
							<>
								<DropdownMenuItem
									variant="destructive"
									onSelect={() => deleteMeal(false)}
								>
									<Icon name="trash" size="sm" />
									Delete Meal · keep Shopping
								</DropdownMenuItem>
								<DropdownMenuItem
									variant="destructive"
									onSelect={() => deleteMeal(true)}
								>
									<Icon name="trash" size="sm" />
									Delete Meal · remove generated amount
								</DropdownMenuItem>
							</>
						) : (
							<DropdownMenuItem
								variant="destructive"
								onSelect={() => deleteMeal(false)}
							>
								<Icon name="trash" size="sm" />
								Delete Meal
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{/* Edit details: inline panel, or a sheet on a phone */}
			{editingDetails && !detailsInSheet && (
				<div className="border-border/50 bg-background mt-1 rounded-md border p-3">
					<MealDetailsForm
						meal={meal}
						onDone={() => setEditingDetails(false)}
					/>
				</div>
			)}
			{detailsInSheet && (
				<BottomSheet
					open={editingDetails}
					onClose={() => setEditingDetails(false)}
					labelledBy={`meal-details-${meal.id}-title`}
					title="Edit details"
					returnFocusRef={menuTriggerRef}
				>
					<MealDetailsForm
						meal={meal}
						inSheet
						onDone={() => setEditingDetails(false)}
					/>
				</BottomSheet>
			)}

			{isText ? (
				// Text-only Meal: parent completion state, no Recipe items, no
				// Shopping behavior (#98).
				<div
					className={cn('flex items-center gap-2', isComplete && 'opacity-50')}
				>
					<button
						type="button"
						onClick={() => submitMealCooked(!isComplete)}
						className="flex min-h-11 min-w-11 shrink-0 items-center justify-center md:min-h-0 md:min-w-0 md:p-1"
						aria-label={isComplete ? 'Mark not cooked' : 'Mark cooked'}
					>
						{isComplete ? (
							<span className="border-primary bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full border-2 transition-colors">
								<Icon name="check" className="size-3" />
							</span>
						) : (
							<span className="border-muted-foreground/30 hover:border-primary flex size-5 items-center justify-center rounded-full border-2 transition-colors" />
						)}
					</button>
					<p
						className={cn(
							'min-w-0 flex-1 font-serif text-[15px] leading-snug',
							isComplete && 'text-muted-foreground line-through',
						)}
					>
						{meal.genericText}
					</p>
				</div>
			) : (
				<div className="space-y-0">
					{rows.map((row, index) => (
						<RowCollapse
							key={row.key}
							hidden={row.kind === 'recipe' && hidden.has(row.item.id)}
							entering={row.kind === 'recipe' && entering.has(row.item.id)}
							className={cn(
								row.kind === 'heading'
									? index > 0 && 'mt-3'
									: index > 0 &&
											rows[index - 1]!.kind !== 'heading' &&
											// Inset from the cooked toggle, so it reads as inside
											// the Meal next to the full-width line between Meals.
											"before:border-border/60 relative mt-2 pt-2 before:absolute before:top-0 before:right-0 before:left-11 before:border-t before:content-[''] md:before:left-8",
							)}
						>
							{row.kind === 'heading' ? (
								<h5 className="text-muted-foreground/80 text-[10px] font-semibold tracking-wider uppercase">
									{row.name}
								</h5>
							) : row.kind === 'recipe' ? (
								<ItemRow
									item={row.item}
									// The last Recipe goes with its Meal: Delete Meal.
									showRemove={visibleItemCount > 1 || meal.noteItems.length > 0}
								/>
							) : (
								<NoteRow note={row.note} />
							)}
						</RowCollapse>
					))}

					{/* Add another Recipe directly to this Meal (#98 story 41). The
					    picker replaces the button while open and has its own Cancel;
					    on a phone it is a sheet over the button. */}
					{addingRecipe && !recipeInSheet ? (
						<div className="bg-card animate-fade-up-reveal shadow-warm-lg mt-2 rounded-lg border p-3">
							{recipePicker}
						</div>
					) : (
						<button
							ref={addRecipeButtonRef}
							type="button"
							onClick={() => {
								choices.load()
								setRecipeInSheet(opensAsSheet())
								setAddingRecipe(true)
							}}
							aria-label={`Add Recipe to ${mealActionName}`}
							className="text-muted-foreground hover:text-foreground flex min-h-11 items-center gap-1 text-xs font-semibold transition-colors md:mt-1 md:min-h-9 md:pl-8"
						>
							<Icon name="plus" className="size-3" />
							Add Recipe
						</button>
					)}
					{recipeInSheet && (
						<BottomSheet
							open={addingRecipe}
							onClose={closeRecipePicker}
							labelledBy={`meal-add-recipe-${meal.id}-title`}
							title="Add a Recipe"
						>
							{recipePicker}
						</BottomSheet>
					)}
				</div>
			)}
		</div>
	)
}
