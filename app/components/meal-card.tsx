import { type SubmissionResult } from '@conform-to/react'
import { Img } from 'openimg/react'
import { useEffect, useRef, useState } from 'react'
import { useFetcher, useSearchParams } from 'react-router'
import {
	addedToExistingMessage,
	skippedCheckedMessage,
} from '#app/utils/meal-shopping-messages.ts'
import { getHouseholdClientId } from '#app/utils/household-client.tsx'
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
import { useFetcherSettled } from '#app/hooks/use-fetcher-settled.ts'
import { MEAL_TYPES, MEAL_TYPE_LABELS, type MealType } from '#app/utils/date.ts'
import { IMG_SIZES } from '#app/utils/image-route.ts'
import { groupSnapshotEntries } from '#app/utils/menu-snapshot.ts'
import { formatScaleMultiplier } from '#app/utils/menu-validation.ts'
import { cn } from '#app/utils/misc.tsx'
import { mealPhoto } from '#app/utils/plan-day-swipe.ts'
import { formatServingTime, servingWallTime } from '#app/utils/serving-time.ts'
import { haptic } from '#app/utils/shell-bridge.ts'
import { PushLink } from './push-link.tsx'
import { RecipeSelector } from './recipe-selector.tsx'

export type PlanMealItem = {
	id: string
	recipeTitle: string
	scaleMultiplier: number
	cooked: boolean
	/// Frozen display note copied from the Menu card.
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
	/// Frozen Menu snapshot structure. Empty for planner-created Meals.
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

/**
 * Where a Meal shows: `day` is a phone's one picked day, `agenda` the desktop
 * week. Each mounts its own Meals, so the two can differ.
 */
export type MealLayout = 'day' | 'agenda'

/**
 * In the agenda a Meal's rows share two left edges: the cooked circle (and
 * the icon of a note or Add Recipe row) on the content edge, and every title
 * 32px in.
 */
const COOKED_TOGGLE =
	'-ml-3 -mr-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center desktop:mx-0 desktop:-ml-1 desktop:min-h-0 desktop:min-w-0 desktop:p-1'

/** A trailing icon button whose glyph ends on the content edge. */
const TRAILING_ICON_SLOT =
	'size-11 shrink-0 -mr-[15px] desktop:size-7 desktop:-mr-[7px]'

/**
 * On a phone's day the cooked circle ends each dish row: its 44px tap box
 * hangs 10px into the gutter, so the 24px circle ends on the content edge.
 * Plan is the one screen whose check sits at the right (DESIGN_SYSTEM, Plan).
 */
const DAY_COOKED_TOGGLE =
	'group/cooked -mr-2.5 flex size-11 shrink-0 items-center justify-center'

/** The circle itself on a phone's day: Shopping's check circle. */
function DayCookedCircle({ cooked }: { cooked: boolean }) {
	return (
		<span
			className={cn(
				'flex size-6 items-center justify-center rounded-full border-2 transition-[scale,background-color,border-color] duration-150 ease-(--ease-micro) group-active/cooked:scale-[0.97]',
				cooked
					? 'border-primary-fill bg-primary-fill text-primary-foreground'
					: 'border-control-edge group-hover/cooked:border-primary',
			)}
		>
			{cooked ? <Icon name="check" className="size-3.5" /> : null}
		</span>
	)
}

/** A 44px icon button in a Meal's label line on a phone's day. */
const DAY_LINE_BUTTON =
	'text-muted-foreground hover:text-foreground active:text-foreground flex size-11 shrink-0 items-center justify-center transition-colors'

function ItemRow({
	item,
	showRemove,
	layout,
	withPhoto,
}: {
	item: PlanMealItem
	showRemove: boolean
	layout: MealLayout
	/** On a phone's day: the dish of a Dinner showing its photo. */
	withPhoto: boolean
}) {
	const cookedFetcher = useFetcher()
	const deleteWithUndo = useDeleteWithUndo()
	const day = layout === 'day'

	// Optimistic cooked state while the toggle is in flight. It reads the
	// submitted target value, so repeat taps each show their own state.
	const isCooked = cookedFetcher.formData
		? cookedFetcher.formData.get('cooked') === 'true'
		: item.cooked

	const missing = item.recipe == null

	// Each Recipe item has its own cooked state.
	const cookedToggle = (
		<cookedFetcher.Form
			method="POST"
			className="shrink-0"
			// Marking cooked lands like a done task; unmarking just ticks.
			onSubmit={() => haptic(isCooked ? 'selection' : 'success')}
		>
			<input type="hidden" name="intent" value="setItemCooked" />
			<input type="hidden" name="itemId" value={item.id} />
			{/* The target value, not a server-side flip, so double-taps and
			    two people toggling at once stay last-write-wins. */}
			<input type="hidden" name="cooked" value={String(!isCooked)} />
			<button
				type="submit"
				className={day ? DAY_COOKED_TOGGLE : COOKED_TOGGLE}
				aria-label={
					isCooked
						? `Mark ${item.recipeTitle} not cooked`
						: `Mark ${item.recipeTitle} cooked`
				}
			>
				{day ? (
					<DayCookedCircle cooked={isCooked} />
				) : isCooked ? (
					<span className="border-primary-fill bg-primary-fill text-primary-foreground flex size-5 items-center justify-center rounded-full border-2 transition-colors">
						<Icon name="check" className="size-3" />
					</span>
				) : (
					<span className="border-control-edge hover:border-primary flex size-5 items-center justify-center rounded-full border-2 transition-colors" />
				)}
			</button>
		</cookedFetcher.Form>
	)

	const title = (
		<h4
			className={cn(
				'flex min-w-0 flex-1 font-medium',
				day
					? withPhoto
						? 'text-dish-photo'
						: 'text-dish'
					: 'text-[15px] leading-snug',
				// A cooked dish fades only its text, on the page or a card.
				// Faint is too light on today's tint in the desktop week.
				isCooked &&
					'text-faint [[data-tinted]_&]:text-muted-foreground line-through',
			)}
		>
			{item.recipe ? (
				<PushLink
					to={
						item.scaleMultiplier !== 1
							? `/recipes/${item.recipe.id}?scale=${formatScaleMultiplier(item.scaleMultiplier)}`
							: `/recipes/${item.recipe.id}`
					}
					className={cn(
						'flex min-h-11 min-w-0 items-center hover:underline',
						day ? 'py-1.5' : 'desktop:inline desktop:min-h-0',
						!isCooked && 'text-foreground',
					)}
					onClick={(e) => e.stopPropagation()}
				>
					{/* A long word breaks rather than widen the page. */}
					<span
						className={cn('min-w-11 wrap-anywhere', !day && 'line-clamp-2')}
					>
						{item.recipeTitle}
					</span>
				</PushLink>
			) : (
				<span
					className={cn(
						'text-muted-foreground min-w-0 wrap-anywhere',
						day ? 'py-1.5' : 'line-clamp-2',
					)}
				>
					{item.recipeTitle}
				</span>
			)}
		</h4>
	)

	const scale = missing ? (
		<p className="text-muted-foreground shrink-0 text-xs">Recipe deleted</p>
	) : (
		<MultiplierControl item={item} />
	)

	// Remove item: at once, with Undo.
	const remove = showRemove ? (
		<Button
			type="button"
			size="sm"
			variant="ghost"
			className={cn(
				'text-foreground-destructive hover:text-foreground-destructive p-0',
				day ? 'size-11 shrink-0' : TRAILING_ICON_SLOT,
			)}
			aria-label={`Remove ${item.recipeTitle} from this Meal`}
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
	) : null

	const note = item.note ? (
		<p className="text-muted-foreground text-xs leading-snug break-words">
			{item.note}
		</p>
	) : null

	if (day) {
		// The name, then the trash when there is one, the scale field and the
		// cooked circle on the right edge. The circles and the scale fields of
		// a day each form a column.
		return (
			<div>
				<div className="flex items-center gap-1">
					{title}
					{remove}
					{scale}
					{cookedToggle}
				</div>
				{note}
			</div>
		)
	}

	return (
		<div className="flex items-center gap-2">
			{cookedToggle}

			{/* Title + multiplier share one line, the multiplier trailing, so
			    each is 44px tall to a finger without the row growing; stacked,
			    two 44px targets would not fit. */}
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-2">
					{title}
					{scale}
				</div>
				{note}
			</div>

			{/* A Recipe without a trash keeps its place, so the scale fields of
			    a day line up. */}
			{remove ?? <span aria-hidden="true" className={TRAILING_ICON_SLOT} />}
		</div>
	)
}

/**
 * A frozen snapshot note card: read-only text plus its ordinary
 * Shopping lines, compact enough for the planner's day columns.
 */
function NoteRow({ note }: { note: PlanMealNote }) {
	return (
		<div className="text-muted-foreground flex items-start gap-3">
			<span className="flex w-5 shrink-0 justify-center pt-0.5">
				<Icon name="pencil-2" className="size-3.5" />
			</span>
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
 * Frozen sections first, each heading followed by its Recipe and note cards
 * interleaved by their shared order. Then unsectioned items: everything
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
	// Use the stored zone for an existing time; the browser names a new time.
	const [timeZone] = useState(
		() =>
			meal.servingTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
	)

	useFetcherSettled(fetcher, (data) => {
		if (data?.status === 'success') onDone()
	})

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

			{/* The Meal editor keeps its 14px error line on a phone. */}
			<div role="alert" className="phone:[&_li]:text-sm">
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
	layout,
}: {
	meal: PlanMeal
	choices: PlanChoices
	canMoveUp: boolean
	canMoveDown: boolean
	layout: MealLayout
}) {
	const day = layout === 'day'
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
			skippedCheckedNames?: string[]
		}
	}>()
	const [addingRecipe, setAddingRecipe] = useState(false)
	// On a phone the Recipe picker and Edit details are bottom sheets; wider,
	// they open in place. Set when each opens.
	const [recipeInSheet, setRecipeInSheet] = useState(false)
	const [detailsInSheet, setDetailsInSheet] = useState(false)
	// Each open starts a fresh picker or form, even one that reopens a sheet
	// still leaving. One count each, so opening one leaves the other alone.
	const [recipeOpens, setRecipeOpens] = useState(0)
	const [detailsOpens, setDetailsOpens] = useState(0)
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
	// Where the inline panel opened. A save can add or remove the header line;
	// moving the panel then would remount its form and lose the save's close.
	const [detailsUnderHeader, setDetailsUnderHeader] = useState(false)
	const [menuOpen, setMenuOpen] = useState(false)
	const menuPointer = useRef<string | null>(null)

	const isText = meal.genericText != null
	// A Recipe Meal derives completion from its items. A text-only Meal has
	// its own completed flag.
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
	// On a phone's day a Dinner shows its first Recipe's photo.
	const photo = day
		? mealPhoto(
				{
					label: meal.label,
					items: rows.flatMap((row) =>
						row.kind === 'recipe' ? [row.item] : [],
					),
				},
				hidden,
			)
		: null
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

	// Toast once Add to Shopping settles. The planner shows no other sign of
	// the result.
	useFetcherSettled(addToShoppingFetcher, (data) => {
		// Someone deleted the Meal while this add ran; the Plan reloads
		// without it.
		if (data?.status === 'gone') toast.info('That Meal was just deleted.')
		if (data?.status === 'success' && data.shopping) {
			if (data.refreshed) {
				const changed =
					data.shopping.createdRowCount +
					(data.shopping.attachedCount ?? 0) +
					(data.shopping.updatedContributionCount ?? 0) +
					(data.shopping.removedContributionCount ?? 0) +
					(data.shopping.promotedRowCount ?? 0)
				const skippedNames = data.shopping.skippedCheckedNames ?? []
				if (changed > 0) {
					toast.success(
						skippedCheckedMessage(skippedNames, { afterChanges: true }) ??
							'Shopping updated',
					)
				} else if (skippedNames.length > 0) {
					toast.info(skippedCheckedMessage(skippedNames))
				} else toast.info('Shopping is up to date')
				return
			}
			const { createdRowCount, attachedCount, alreadyContributedCount } =
				data.shopping
			if (createdRowCount > 0) {
				toast.success(
					`Added ${createdRowCount} item${createdRowCount === 1 ? '' : 's'} to Shopping`,
				)
			} else if ((attachedCount ?? 0) > 0) {
				// The amounts joined rows already there, which now show more.
				toast.success(addedToExistingMessage(attachedCount ?? 0))
			} else if ((alreadyContributedCount ?? 0) > 0) {
				toast.info('This Meal is already on Shopping')
			} else {
				toast.info('Nothing to add to Shopping')
			}
		}
	})

	const recipePicker =
		choices.state.status === 'success' ? (
			<RecipeSelector
				key={recipeOpens}
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
		haptic(cooked ? 'success' : 'selection')
		void mealCookedFetcher.submit(
			{ intent: 'setMealCooked', mealId: meal.id, cooked: String(cooked) },
			{ method: 'POST' },
		)
	}

	// A Meal with no label, time, guests or Menu has no header line; its
	// actions end its last row instead.
	const hasHeader = Boolean(
		meal.label || timeText || meal.guestCount != null || meal.sourceMenu,
	)
	// On a phone's day every Meal has its label line: it holds Add Recipe and
	// the dots, whether or not it has a label to show.
	const hasLabelLine = day || hasHeader
	const detailsPanel = editingDetails && !detailsInSheet && (
		// Opened in place, it keeps a sideways drag from stepping the day.
		<div
			data-no-day-swipe=""
			className="border-border/50 bg-background mt-1 rounded-md border p-3"
		>
			<MealDetailsForm meal={meal} onDone={() => setEditingDetails(false)} />
		</div>
	)
	// The dots glyph ends on the content edge; the 44px tap area is wider.
	const actions = (
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
					// In the agenda: 32px to the eye, 44px to a finger, as the
					// pseudo-element takes taps without growing the header. On a
					// phone's day the glyph ends on the content edge.
					className={
						day
							? cn(DAY_LINE_BUTTON, '-mr-3')
							: "text-muted-foreground hover:text-foreground active:bg-muted desktop:-mr-[5px] desktop:min-h-6 desktop:min-w-6 desktop:before:hidden relative -mr-[9px] flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded transition-colors before:absolute before:-inset-1.5 before:content-['']"
					}
					aria-label={`Meal actions for ${mealActionName}`}
				>
					<Icon
						name="dots-horizontal"
						className={day ? 'size-5' : 'size-3.5'}
					/>
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
						setDetailsUnderHeader(hasLabelLine)
						setDetailsOpens((count) => count + 1)
						setEditingDetails(true)
					}}
				>
					<Icon name="pencil-1" size="sm" />
					Edit details
				</DropdownMenuItem>
				{/* Planning never changes Shopping by itself: a Meal gets there
				    from this item or from From Plan on Shopping, and a text-only
				    Meal never does. A Meal already on Shopping keeps Update after
				    losing its demand, so the update can clear it. */}
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
									originClientId: getHouseholdClientId(),
								},
								{ method: 'POST' },
							)
						}}
					>
						<Icon name={meal.addedToShopping ? 'update' : 'cart'} size="sm" />
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
							Delete, keep Shopping as is
						</DropdownMenuItem>
						<DropdownMenuItem
							variant="destructive"
							onSelect={() => deleteMeal(true)}
						>
							<Icon name="trash" size="sm" />
							Delete with its Shopping amounts
						</DropdownMenuItem>
					</>
				) : (
					<DropdownMenuItem
						variant="destructive"
						onSelect={() => deleteMeal(false)}
					>
						<Icon name="trash" size="sm" />
						Delete
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	)

	const addRecipeButtonProps = {
		ref: addRecipeButtonRef,
		type: 'button' as const,
		onClick: () => {
			choices.load()
			setRecipeInSheet(opensAsSheet())
			setRecipeOpens((count) => count + 1)
			setAddingRecipe(true)
		},
		'aria-label': `Add Recipe to ${mealActionName}`,
	}

	const cookedCircle = (
		<button
			type="button"
			onClick={() => submitMealCooked(!isComplete)}
			className={day ? DAY_COOKED_TOGGLE : COOKED_TOGGLE}
			aria-label={
				isComplete
					? `Mark ${mealActionName} not cooked`
					: `Mark ${mealActionName} cooked`
			}
		>
			{day ? (
				<DayCookedCircle cooked={isComplete} />
			) : isComplete ? (
				<span className="border-primary-fill bg-primary-fill text-primary-foreground flex size-5 items-center justify-center rounded-full border-2 transition-colors">
					<Icon name="check" className="size-3" />
				</span>
			) : (
				<span className="border-control-edge hover:border-primary flex size-5 items-center justify-center rounded-full border-2 transition-colors" />
			)}
		</button>
	)

	return (
		<div
			ref={cardRef}
			tabIndex={-1}
			data-meal-id={meal.id}
			// A flat row under the day heading; the day draws the dividers
			// between Meals (MealCards).
			className={cn(
				'group focus-visible:ring-ring relative rounded-sm focus-visible:ring-2',
				day ? 'pb-2' : 'py-3 md:py-1.5',
			)}
		>
			{/* Header: optional label, time and guests on the left (display only,
			    never what orders the day), controls on the right. */}
			{hasLabelLine && (
				<div
					className={cn(
						'flex items-center gap-1.5',
						day ? '-mb-1 min-h-11 gap-0' : 'min-h-7',
					)}
				>
					<div className="text-muted-foreground text-label flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 font-semibold">
						{meal.label ? <span>{mealLabelText(meal.label)}</span> : null}
						{timeText && (
							<span className="inline-flex items-center gap-0.5">
								<Icon name="clock" className="size-3" />
								{timeText}
							</span>
						)}
						{meal.guestCount != null && <span>· {meal.guestCount} guests</span>}
						{/* Where the snapshot came from: a link, not live data. */}
						{meal.sourceMenu && (
							<PushLink
								to={`/recipes/menus/${meal.sourceMenu.id}`}
								className="hover:text-foreground inline-flex max-w-full min-w-0 items-center gap-0.5 transition-colors"
							>
								<Icon name="file-text" className="size-3 shrink-0" />
								<span className="truncate">{meal.sourceMenu.title}</span>
							</PushLink>
						)}
					</div>

					{/* On a phone's day Add Recipe is a + beside the dots. */}
					{day && !isText ? (
						<button {...addRecipeButtonProps} className={DAY_LINE_BUTTON}>
							<Icon name="plus" className="size-5" />
						</button>
					) : null}
					{actions}
				</div>
			)}

			{/* Edit details in place opens under the dots that opened it: under
			    the header, or at the end of a Meal without one. */}
			{detailsUnderHeader && detailsPanel}
			{detailsInSheet && (
				<BottomSheet
					open={editingDetails}
					onClose={() => setEditingDetails(false)}
					labelledBy={`meal-details-${meal.id}-title`}
					title="Edit details"
					returnFocusRef={menuTriggerRef}
				>
					<MealDetailsForm
						key={detailsOpens}
						meal={meal}
						inSheet
						onDone={() => setEditingDetails(false)}
					/>
				</BottomSheet>
			)}

			{photo ? (
				// Decorative: the dish names beside it say what it is.
				<Img
					src={`/resources/images?objectKey=${encodeURIComponent(photo)}`}
					alt=""
					draggable={false}
					className="mt-1 mb-1 h-[152px] w-full rounded-md object-cover select-none [-webkit-touch-callout:none]"
					{...IMG_SIZES.hero}
				/>
			) : null}

			{isText ? (
				// Text-only Meal: its own completed state, no Recipe items, and
				// nothing for Shopping.
				day ? (
					<div className="flex items-center gap-1">
						<p
							className={cn(
								// Typed, not a Recipe: muted, at the running weight.
								'text-dish text-muted-foreground min-w-0 flex-1 py-1.5 wrap-anywhere',
								isComplete && 'text-faint line-through',
							)}
						>
							{meal.genericText}
						</p>
						{cookedCircle}
					</div>
				) : (
					<div className="flex items-center gap-2">
						{cookedCircle}
						<p
							className={cn(
								'text-muted-foreground flex min-w-0 flex-1 text-[15px] leading-snug md:block',
								isComplete &&
									'text-faint [[data-tinted]_&]:text-muted-foreground line-through',
							)}
						>
							{meal.genericText}
						</p>
						{!hasHeader && actions}
					</div>
				)
			) : (
				<div className="space-y-0">
					{rows.map((row, index) => {
						// The Recipe or note showing just before this one, skipping
						// rows deleted with Undo still waiting. A line goes between two
						// that show, never under a heading or above the first.
						let before: MealRow | undefined
						for (let i = index - 1; i >= 0 && !before; i--) {
							const candidate = rows[i]!
							if (candidate.kind === 'recipe' && hidden.has(candidate.item.id))
								continue
							before = candidate
						}
						const insetLine =
							!day &&
							row.kind !== 'heading' &&
							before != null &&
							before.kind !== 'heading'
						return (
							<RowCollapse
								key={row.key}
								hidden={row.kind === 'recipe' && hidden.has(row.item.id)}
								entering={row.kind === 'recipe' && entering.has(row.item.id)}
								className={cn(
									row.kind === 'heading'
										? index > 0 && 'mt-3'
										: index > 0 &&
												rows[index - 1]!.kind !== 'heading' &&
												// On a phone's day a little air between dishes keeps
												// each scale field's tap area clear of the next one's.
												(day ? 'mt-2' : 'mt-2 pt-2'),
									// Inset from the cooked toggle, so it reads as inside the
									// Meal next to the full-width line between Meals.
									insetLine &&
										"before:border-border/60 relative before:absolute before:top-0 before:right-0 before:left-8 before:border-t before:content-['']",
								)}
							>
								{row.kind === 'heading' ? (
									<h5
										className={cn(
											'text-muted-foreground text-label font-semibold',
											day ? 'pt-1' : 'pl-8',
										)}
									>
										{row.name}
									</h5>
								) : row.kind === 'recipe' ? (
									<ItemRow
										item={row.item}
										layout={layout}
										withPhoto={photo != null}
										// The last Recipe goes with its Meal: Delete in its menu.
										showRemove={
											visibleItemCount > 1 || meal.noteItems.length > 0
										}
									/>
								) : (
									<NoteRow note={row.note} />
								)}
							</RowCollapse>
						)
					})}

					{/* Add another Recipe directly to this Meal. The picker replaces
					    the button while open and has its own Cancel; on a phone it is
					    a sheet over the button. */}
					{addingRecipe && !recipeInSheet ? (
						<div
							data-no-day-swipe=""
							className="bg-card animate-fade-up-reveal shadow-warm-lg mt-2 rounded-lg border p-3"
						>
							{recipePicker}
						</div>
					) : null}
					{day ? null : (
						<div className="flex items-center gap-2 md:mt-1">
							{addingRecipe && !recipeInSheet ? null : (
								<button
									{...addRecipeButtonProps}
									className="text-muted-foreground hover:text-foreground desktop:min-h-9 flex min-h-11 items-center gap-3 text-xs font-semibold transition-colors"
								>
									<span className="flex w-5 justify-center">
										<Icon name="plus" className="size-3" />
									</span>
									Add Recipe
								</button>
							)}
							{!hasHeader && <div className="ml-auto">{actions}</div>}
						</div>
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
			{!detailsUnderHeader && detailsPanel}
		</div>
	)
}
