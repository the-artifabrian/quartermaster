import { Img } from 'openimg/react'
import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { toast } from 'sonner'
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
import { MEAL_TYPES, MEAL_TYPE_LABELS, type MealType } from '#app/utils/date.ts'
import { groupSnapshotEntries } from '#app/utils/menu-snapshot.ts'
import { formatScaleMultiplier } from '#app/utils/menu-validation.ts'
import { cn } from '#app/utils/misc.tsx'
import { getRecipePlaceholder } from '#app/utils/recipe-placeholder.ts'
import { formatServingTime, servingWallTime } from '#app/utils/serving-time.ts'
import {
	type RecipeSelectorRecipe,
	RecipeSelector,
} from './recipe-selector.tsx'

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
		servings: number
		prepTime: number | null
		cookTime: number | null
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
	shoppingDemandStatus: 'not-added' | 'current' | 'stale' | 'blocked'
	items: PlanMealItem[]
}

export function mealLabelText(label: string) {
	return MEAL_TYPE_LABELS[label as MealType] ?? label
}

/** Client-side twin of ScaleMultiplierSchema for instant feedback. */
function isValidMultiplierInput(value: string) {
	if (!/^\d{1,3}([.,]\d{1,2})?$/.test(value.trim())) return false
	const parsed = Number(value.trim().replace(',', '.'))
	return parsed > 0 && parsed <= 100
}

function MultiplierControl({ item }: { item: PlanMealItem }) {
	const fetcher = useFetcher()
	const [editing, setEditing] = useState(false)
	const [value, setValue] = useState('')
	const [invalid, setInvalid] = useState(false)

	// Optimistic: show the submitted value while the write is in flight.
	const submitted = fetcher.formData?.get('multiplier')
	const shown =
		typeof submitted === 'string'
			? submitted.replace(',', '.')
			: formatScaleMultiplier(item.scaleMultiplier)

	function commit() {
		const trimmed = value.trim()
		if (!trimmed || trimmed === formatScaleMultiplier(item.scaleMultiplier)) {
			setEditing(false)
			return
		}
		if (!isValidMultiplierInput(trimmed)) {
			setInvalid(true)
			return
		}
		void fetcher.submit(
			{ intent: 'setItemMultiplier', itemId: item.id, multiplier: trimmed },
			{ method: 'POST' },
		)
		setEditing(false)
	}

	if (editing) {
		return (
			<Input
				autoFocus
				inputMode="decimal"
				value={value}
				onChange={(e) => {
					setValue(e.target.value)
					setInvalid(false)
				}}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === 'Enter') commit()
					if (e.key === 'Escape') setEditing(false)
				}}
				aria-label={`Multiplier for ${item.recipeTitle}`}
				aria-invalid={invalid || undefined}
				className={cn(
					'h-7 w-14 px-1.5 text-center text-xs',
					invalid && 'border-destructive focus-visible:ring-destructive',
				)}
			/>
		)
	}

	return (
		<button
			type="button"
			onClick={() => {
				setValue(formatScaleMultiplier(item.scaleMultiplier))
				setInvalid(false)
				setEditing(true)
			}}
			className="text-muted-foreground hover:bg-muted hover:text-foreground relative rounded px-1 py-0.5 text-xs tabular-nums transition-colors after:absolute after:-inset-x-1.5 after:-inset-y-1.5 after:content-[''] md:after:hidden"
			aria-label={`Edit multiplier for ${item.recipeTitle} (currently ${shown}×)`}
		>
			{shown}×
		</button>
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
	const removeFetcher = useFetcher()
	const [confirmingRemove, setConfirmingRemove] = useState(false)

	// Optimistic cooked state while the toggle is in flight — read the
	// submitted target value so repeat taps each show their own state
	const isCooked = cookedFetcher.formData
		? cookedFetcher.formData.get('cooked') === 'true'
		: item.cooked

	// Auto-disarm the remove confirmation like useDoubleCheck's blur behavior
	useEffect(() => {
		if (!confirmingRemove) return
		const timer = setTimeout(() => setConfirmingRemove(false), 4000)
		return () => clearTimeout(timer)
	}, [confirmingRemove])

	const missing = item.recipe == null
	const linkServings =
		item.recipe && item.scaleMultiplier !== 1
			? Math.min(
					999,
					Math.max(1, Math.round(item.scaleMultiplier * item.recipe.servings)),
				)
			: null
	const thumbPlaceholder = item.recipe?.image?.objectKey
		? null
		: getRecipePlaceholder(item.recipeTitle)

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

			{/* Thumbnail — mobile only (desktop day columns are too narrow) */}
			<div className="size-11 shrink-0 overflow-hidden rounded-md md:hidden">
				{item.recipe?.image?.objectKey ? (
					<Img
						src={`/resources/images?objectKey=${encodeURIComponent(item.recipe.image.objectKey)}`}
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
								linkServings && linkServings !== item.recipe.servings
									? `/recipes/${item.recipe.id}?servings=${linkServings}`
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

			{/* Remove item */}
			{showRemove && (
				<removeFetcher.Form method="POST" className="shrink-0">
					<input type="hidden" name="intent" value="removeItem" />
					<input type="hidden" name="itemId" value={item.id} />
					{confirmingRemove ? (
						<Button
							type="submit"
							size="sm"
							variant="destructive"
							aria-label={`Tap again to remove ${item.recipeTitle}`}
						>
							<span className="text-xs">Sure?</span>
						</Button>
					) : (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="size-9 p-0 md:size-7"
							aria-label={`Remove ${item.recipeTitle} from this meal`}
							onClick={() => setConfirmingRemove(true)}
						>
							<Icon name="trash" className="size-3.5" />
						</Button>
					)}
				</removeFetcher.Form>
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
}: {
	meal: PlanMeal
	onDone: () => void
}) {
	const fetcher = useFetcher()
	const wasSubmitting = useRef(false)
	// The instant is named by wall time plus the browser's IANA zone; the zone
	// travels in a hidden input so the server can store the pair (#98).
	const [timeZone] = useState(
		() => Intl.DateTimeFormat().resolvedOptions().timeZone,
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
					htmlFor={`label-${meal.id}`}
					className="text-muted-foreground mb-1 block text-xs font-medium"
				>
					Label
				</label>
				<select
					id={`label-${meal.id}`}
					name="label"
					defaultValue={meal.label ?? ''}
					className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
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
					className="h-9"
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
					name="guestCount"
					min={1}
					max={999}
					defaultValue={meal.guestCount ?? ''}
					className="h-9"
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
						className="h-9"
					/>
				</div>
			)}

			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onDone}>
					Cancel
				</Button>
				<Button type="submit" size="sm">
					Save
				</Button>
			</div>
		</fetcher.Form>
	)
}

export function MealCard({
	meal,
	recipes,
	canMoveUp,
	canMoveDown,
}: {
	meal: PlanMeal
	recipes: RecipeSelectorRecipe[]
	canMoveUp: boolean
	canMoveDown: boolean
}) {
	const moveFetcher = useFetcher()
	const mealCookedFetcher = useFetcher()
	const removeMealFetcher = useFetcher()
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
		}
	}>()
	const [addingRecipe, setAddingRecipe] = useState(false)
	const [editingDetails, setEditingDetails] = useState(false)
	const [confirmingDelete, setConfirmingDelete] = useState(false)
	const [menuOpen, setMenuOpen] = useState(false)

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
					toast.success('Shopping contribution refreshed')
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
					toast.success('Everything is already on your Shopping list')
				} else if ((alreadyContributedCount ?? 0) > 0) {
					toast.info('This meal is already on Shopping')
				} else {
					toast.info('Nothing to add to Shopping')
				}
			}
		}
		prevShoppingState.current = addToShoppingFetcher.state
	}, [addToShoppingFetcher.state, addToShoppingFetcher.data])

	function submitMealCooked(cooked: boolean) {
		void mealCookedFetcher.submit(
			{ intent: 'setMealCooked', mealId: meal.id, cooked: String(cooked) },
			{ method: 'POST' },
		)
	}

	return (
		<div className="group border-border/50 bg-card/60 relative rounded-lg border p-2">
			{/* Header: optional label/time/guests on the left — display metadata
			    only, never what orders the day (#98) — controls on the right. */}
			<div className="flex min-h-7 items-center gap-1.5">
				<div className="text-muted-foreground flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-[11px] font-semibold tracking-wider uppercase">
					{meal.label && <span>{mealLabelText(meal.label)}</span>}
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
					{meal.shoppingDemandStatus === 'stale' && (
						<span className="text-amber-700 normal-case dark:text-amber-300">
							· Shopping changed
						</span>
					)}
					{meal.shoppingDemandStatus === 'blocked' && (
						<span className="text-amber-700 normal-case dark:text-amber-300">
							· Shopping refresh blocked
						</span>
					)}
				</div>

				<moveFetcher.Form method="POST" className="flex shrink-0 items-center">
					<input type="hidden" name="intent" value="moveMeal" />
					<input type="hidden" name="mealId" value={meal.id} />
					<button
						type="submit"
						name="direction"
						value="up"
						disabled={!canMoveUp}
						className="text-muted-foreground hover:text-foreground flex min-h-8 min-w-8 items-center justify-center rounded transition-colors disabled:opacity-25 md:min-h-6 md:min-w-6"
						aria-label="Move meal up in the day"
					>
						<Icon name="arrow-up" className="size-3.5" />
					</button>
					<button
						type="submit"
						name="direction"
						value="down"
						disabled={!canMoveDown}
						className="text-muted-foreground hover:text-foreground flex min-h-8 min-w-8 items-center justify-center rounded transition-colors disabled:opacity-25 md:min-h-6 md:min-w-6"
						aria-label="Move meal down in the day"
					>
						<Icon name="arrow-down" className="size-3.5" />
					</button>
				</moveFetcher.Form>

				<DropdownMenu
					modal={false}
					open={menuOpen}
					onOpenChange={(open) => {
						setMenuOpen(open)
						if (!open) setConfirmingDelete(false)
					}}
				>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							className="text-muted-foreground hover:text-foreground flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded transition-colors md:min-h-6 md:min-w-6"
							aria-label="Meal actions"
						>
							<Icon name="dots-horizontal" className="size-3.5" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onSelect={() => submitMealCooked(!isComplete)}>
							<Icon name="check" size="sm" />
							{isComplete ? 'Mark not cooked' : 'Mark meal cooked'}
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => setEditingDetails(true)}>
							<Icon name="pencil-1" size="sm" />
							Edit details
						</DropdownMenuItem>
						{/* A Meal reaches Shopping only through this explicit action —
						    planning never live-syncs Shopping. Text-only Meals have no
						    Shopping behavior (#108). */}
						{!isText && hasShoppingDemand && (
							<DropdownMenuItem
								disabled={
									addToShoppingFetcher.state !== 'idle' ||
									meal.shoppingDemandStatus === 'current' ||
									meal.shoppingDemandStatus === 'blocked'
								}
								onSelect={() => {
									void addToShoppingFetcher.submit(
										{
											intent:
												meal.shoppingDemandStatus === 'stale'
													? 'refreshMealShopping'
													: 'addMealToShopping',
											mealId: meal.id,
										},
										{ method: 'POST' },
									)
								}}
							>
								<Icon
									name={
										meal.shoppingDemandStatus === 'stale' ? 'update' : 'cart'
									}
									size="sm"
								/>
								{meal.shoppingDemandStatus === 'stale'
									? 'Refresh Shopping List'
									: meal.shoppingDemandStatus === 'blocked'
										? 'Replace missing Recipe to refresh'
										: meal.shoppingDemandStatus === 'current'
											? 'Shopping List is current'
											: 'Add to Shopping List'}
							</DropdownMenuItem>
						)}
						<DropdownMenuSeparator />
						{confirmingDelete && meal.shoppingDemandStatus !== 'not-added' ? (
							<>
								<DropdownMenuItem
									onSelect={() => {
										void removeMealFetcher.submit(
											{ intent: 'removeMeal', mealId: meal.id },
											{ method: 'POST' },
										)
									}}
									className="text-destructive focus:text-destructive font-medium"
								>
									<Icon name="trash" size="sm" />
									Delete meal · keep Shopping
								</DropdownMenuItem>
								<DropdownMenuItem
									onSelect={() => {
										void removeMealFetcher.submit(
											{
												intent: 'removeMeal',
												mealId: meal.id,
												removeShoppingContributions: 'true',
											},
											{ method: 'POST' },
										)
									}}
									className="text-destructive focus:text-destructive"
								>
									<Icon name="trash" size="sm" />
									Delete meal · remove generated amount
								</DropdownMenuItem>
							</>
						) : (
							<DropdownMenuItem
								onSelect={(event) => {
									if (!confirmingDelete) {
										event.preventDefault()
										setConfirmingDelete(true)
										return
									}
									void removeMealFetcher.submit(
										{ intent: 'removeMeal', mealId: meal.id },
										{ method: 'POST' },
									)
								}}
								className={cn(
									confirmingDelete &&
										'text-destructive focus:text-destructive font-medium',
								)}
							>
								<Icon name="trash" size="sm" />
								{confirmingDelete ? 'Really delete?' : 'Delete meal'}
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{/* Edit details inline panel */}
			{editingDetails && (
				<div className="border-border/50 bg-background mt-1 rounded-md border p-3">
					<MealDetailsForm
						meal={meal}
						onDone={() => setEditingDetails(false)}
					/>
				</div>
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
						aria-label={isComplete ? 'Mark as not done' : 'Mark as done'}
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
						<div
							key={row.key}
							className={cn(
								row.kind === 'heading'
									? index > 0 && 'mt-3'
									: index > 0 &&
											rows[index - 1]!.kind !== 'heading' &&
											'border-border/50 mt-2 border-t pt-2',
							)}
						>
							{row.kind === 'heading' ? (
								<h5 className="text-muted-foreground/80 text-[10px] font-semibold tracking-wider uppercase">
									{row.name}
								</h5>
							) : row.kind === 'recipe' ? (
								<ItemRow item={row.item} showRemove />
							) : (
								<NoteRow note={row.note} />
							)}
						</div>
					))}

					{/* Add another Recipe directly to this Meal (#98 story 41) */}
					<div className="relative">
						{addingRecipe ? (
							<div className="bg-card animate-fade-up-reveal shadow-warm-lg absolute top-full right-0 left-0 z-20 mt-1 rounded-lg border p-3 md:min-w-[280px]">
								<RecipeSelector
									recipes={recipes}
									date={new Date(meal.dateStr + 'T00:00:00.000Z')}
									excludeRecipeIds={meal.items.flatMap(
										(item) => item.recipe?.id ?? [],
									)}
									onCancel={() => setAddingRecipe(false)}
									onPick={(recipe) => {
										void addRecipeFetcher.submit(
											{
												intent: 'addRecipeToMeal',
												mealId: meal.id,
												recipeId: recipe.id,
											},
											{ method: 'POST' },
										)
										setAddingRecipe(false)
									}}
								/>
							</div>
						) : (
							<button
								type="button"
								onClick={() => setAddingRecipe(true)}
								className="text-muted-foreground/80 hover:text-foreground mt-1 flex min-h-8 w-full items-center gap-1 rounded-md text-xs transition-colors"
							>
								<Icon name="plus" className="size-3" />
								Add recipe
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	)
}
