import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { useSpinDelay } from 'spin-delay'
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
import { type ShoppingListItem } from '#app/generated/prisma/client.ts'
import { parseAmount } from '#app/utils/fractions.ts'
import { cn } from '#app/utils/misc.tsx'
import {
	getProduceCountDisplay,
	isWeightUnit,
} from '#app/utils/produce-weights.ts'
import { LATER, NEXT_SHOP } from '#app/utils/shopping-horizon.ts'
import { type ShoppingItemDisplay } from '#app/utils/shopping-optimistic.ts'
import { useHorizontalSwipe } from '#app/hooks/use-horizontal-swipe.ts'
import { type useShoppingChecks } from '#app/hooks/use-shopping-checks.tsx'
import { useDeleteWithUndo } from '#app/components/undo-delete.tsx'
import {
	getHouseholdClientId,
	HouseholdClientInput,
} from '#app/utils/household-client.tsx'
import { haptic } from '#app/utils/shell-bridge.ts'
import { settleReveal } from '#app/utils/swipe.ts'

/** Each action revealed behind a swiped row is this wide (px). */
const SWIPE_ACTION_WIDTH = 76
/**
 * How far up from the bottom of the screen a row's menu keeps clear (px): the
 * tab bar and the add button sit there, so a menu for a row near them opens
 * upward instead of under them.
 */
function bottomClearance() {
	const tops = ['[data-bottom-nav]', 'button[aria-label="Add item"]']
		.map((selector) =>
			document.querySelector(selector)?.getBoundingClientRect(),
		)
		.filter((box) => box && box.height > 0)
		.map((box) => box!.top)
	return tops.length ? window.innerHeight - Math.min(...tops) + 8 : 8
}

/** The row whose actions are showing. Opening another shuts it. */
let openSwipeRow: { close: () => void } | null = null

type ShoppingListItemCardProps = {
	checks: ReturnType<typeof useShoppingChecks>
	item: ShoppingListItem & { display?: ShoppingItemDisplay }
	isVoiceAdded?: boolean
}

export function ShoppingListItemCard({
	checks,
	item,
	isVoiceAdded,
}: ShoppingListItemCardProps) {
	const [isEditing, setIsEditing] = useState(false)
	const [menuOpen, setMenuOpen] = useState(false)
	// Edit replaces the row, trigger included, so the closing menu has no
	// trigger to hand focus back to; the edit field takes it instead.
	const openingEdit = useRef(false)
	const editFetcher = useFetcher()
	const checkState = checks.state(item.id)
	const isChecking = checkState === 'saving' || checkState === 'reconciling'
	const showCheckSpinner = useSpinDelay(isChecking, {
		delay: 400,
		minDuration: 0,
	})
	const deleteWithUndo = useDeleteWithUndo()
	const moveFetcher = useFetcher()
	const removeGeneratedFetcher = useFetcher()
	const prevEditFetcherState = useRef(editFetcher.state)
	const [swipeOpen, setSwipeOpen] = useState(false)
	const menuPointer = useRef<string | null>(null)
	const swipeRow = useRef<{ close: () => void } | null>(null)

	// Close edit mode when fetcher transitions from submitting/loading → idle
	useEffect(() => {
		if (
			prevEditFetcherState.current !== 'idle' &&
			editFetcher.state === 'idle'
		) {
			if (isEditing && editFetcher.data?.status !== 'error') {
				setIsEditing(false)
			}
		}
		prevEditFetcherState.current = editFetcher.state
	}, [editFetcher.state, editFetcher.data?.status, isEditing])

	// Optimistic checked state
	const optimisticChecked = item.checked

	// The displayed quantity groups the row with its current Meal
	// contributions (#109), computed by the loader. The row's stored
	// quantity/unit stay the editable manual identity below.
	const display = item.display ?? {
		quantity: item.quantity,
		unit: item.unit,
		combined: false,
	}

	// Swiping a row left reveals Later (or Next shop) and, while unchecked,
	// Delete: the menu's two most common actions, one gesture away.
	const swipeWidth = SWIPE_ACTION_WIDTH * (optimisticChecked ? 1 : 2)
	const swipe = useHorizontalSwipe<HTMLDivElement>({
		enabled: !isEditing && !item.id.startsWith('optimistic:') && !checkState,
		getBase: () => (swipeOpen ? -swipeWidth : 0),
		min: -swipeWidth,
		max: 0,
		onRelease: ({ offset, velocity }) => {
			const open = settleReveal({ offset, velocity, width: swipeWidth })
			if (open) {
				if (!swipeOpen) haptic('selection')
				setMenuOpen(false)
				if (openSwipeRow !== swipeRow.current) openSwipeRow?.close()
				openSwipeRow = swipeRow.current
			} else if (openSwipeRow === swipeRow.current) {
				openSwipeRow = null
			}
			setSwipeOpen(open)
			return open ? -swipeWidth : 0
		},
	})
	swipeRow.current ??= {
		close: () => {
			swipe.moveTo(0, true)
			setSwipeOpen(false)
		},
	}
	const closeSwipe = () => {
		swipeRow.current?.close()
		if (openSwipeRow === swipeRow.current) openSwipeRow = null
	}
	// Checking or unchecking the item (here or on the other member's phone)
	// adds or drops Delete; an open row keeps both actions in view.
	const moveSwipe = swipe.moveTo
	useEffect(() => {
		if (swipeOpen) moveSwipe(-swipeWidth, true)
	}, [swipeWidth, swipeOpen, moveSwipe])

	const serverError =
		isEditing &&
		editFetcher.data?.status === 'error' &&
		editFetcher.data?.submission?.error
			? 'Please check your input and try again.'
			: null
	const moveTarget = item.horizon === LATER ? NEXT_SHOP : LATER
	const moveLabel = moveTarget === LATER ? 'Move to Later' : 'Move to Next shop'
	// Goes at once with an Undo toast; the delete is sent when the toast goes.
	const deleteItem = () =>
		deleteWithUndo({
			key: `shopping-item:${item.id}`,
			hides: [item.id],
			message: `Deleted ${item.name}`,
			what: item.name,
			request: { intent: 'delete-shopping', itemIds: [item.id] },
		})
	const submitRowIntent = (
		fetcher: ReturnType<typeof useFetcher>,
		fields: Record<string, string>,
	) =>
		void fetcher.submit(
			{ ...fields, itemId: item.id, originClientId: getHouseholdClientId() },
			{ method: 'POST' },
		)

	if (isEditing) {
		return (
			<div
				className="p-3"
				role="group"
				aria-label={`${item.name} shopping item`}
			>
				<editFetcher.Form
					method="POST"
					onKeyDown={(e) => {
						if (e.key === 'Escape') setIsEditing(false)
					}}
				>
					<HouseholdClientInput />
					<input type="hidden" name="intent" value="edit" />
					<input type="hidden" name="itemId" value={item.id} />
					<div className="space-y-2">
						<Input
							name="name"
							defaultValue={item.name}
							placeholder="Item name"
							// Items stay lowercase, like the ones From Plan.
							autoCapitalize="none"
							autoFocus
							required
							maxLength={100}
						/>
						<div className="flex gap-2">
							<Input
								name="quantity"
								defaultValue={
									item.source === 'manual'
										? (item.quantity ?? '')
										: (display.quantity ?? '')
								}
								placeholder="Qty"
								enterKeyHint="done"
								className="flex-1"
								maxLength={50}
							/>
							<Input
								name="unit"
								defaultValue={
									item.source === 'manual'
										? (item.unit ?? '')
										: (display.unit ?? '')
								}
								placeholder="Unit"
								autoCapitalize="none"
								autoCorrect="off"
								className="flex-1"
								maxLength={20}
							/>
						</div>
						{serverError && (
							<p className="text-destructive text-sm">{serverError}</p>
						)}
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => setIsEditing(false)}
							>
								Cancel
							</Button>
							<Button type="submit" size="sm">
								Save
							</Button>
						</div>
					</div>
				</editFetcher.Form>
			</div>
		)
	}

	return (
		<div
			className="group relative overflow-hidden"
			role="group"
			aria-label={`${item.name} shopping item`}
			// A row added just now eases in (tailwind.css); the saved row that
			// replaces it does not.
			data-optimistic-row={item.id.startsWith('optimistic:') ? '' : undefined}
		>
			{/* Behind the row, uncovered by a swipe to the left. Out of reach of
			    taps, Tab and VoiceOver until then; the menu holds the same
			    actions. */}
			<div
				className="absolute inset-y-0 right-0 flex"
				style={{ width: swipeWidth }}
				aria-hidden={!swipeOpen}
				inert={!swipeOpen}
			>
				<button
					type="button"
					onClick={() => {
						closeSwipe()
						submitRowIntent(moveFetcher, {
							intent: 'move',
							horizon: moveTarget,
						})
					}}
					className="bg-secondary text-secondary-foreground active:bg-secondary/80 flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium"
				>
					<Icon
						name={moveTarget === LATER ? 'arrow-down' : 'arrow-up'}
						size="sm"
					/>
					{moveTarget === LATER ? 'Later' : 'Next shop'}
				</button>
				{!optimisticChecked && (
					<button
						type="button"
						onClick={() => {
							// The row collapses as it is, Delete showing, and shuts
							// once it is out of sight, so Undo brings it back shut.
							deleteItem()
							window.setTimeout(closeSwipe, 250)
						}}
						className="bg-destructive text-destructive-foreground active:bg-destructive/90 flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium"
					>
						<Icon name="trash" size="sm" />
						Delete
					</button>
				)}
			</div>
			<div
				ref={swipe.ref}
				onPointerDown={(event) => {
					// The menu is portaled out of the row but its events still
					// bubble here through React; they are not the row's.
					if (!event.currentTarget.contains(event.target as Node)) return
					swipe.handlers.onPointerDown(event)
				}}
				onClickCapture={(event) => {
					if (!event.currentTarget.contains(event.target as Node)) return
					// A tap on an open row shuts it instead of checking the item.
					if (swipeOpen) {
						event.preventDefault()
						event.stopPropagation()
						closeSwipe()
						return
					}
					swipe.handlers.onClickCapture(event)
				}}
				className="bg-background relative flex touch-pan-y touch-pinch-zoom flex-wrap items-center gap-3"
			>
				{/* Whole row toggles checkbox */}
				<div className="flex min-w-0 flex-1 items-center gap-3">
					<button
						type="button"
						onClick={() => checks.toggle({ ...item, display })}
						disabled={item.id.startsWith('optimistic:')}
						aria-pressed={optimisticChecked}
						aria-busy={isChecking || undefined}
						aria-describedby={
							checkState ? `check-status-${item.id}` : undefined
						}
						// The padding sits on the button, not the row, so a tap anywhere
						// in the row's height checks it off.
						className="group/check flex min-h-15 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2.5 text-left select-none"
						aria-label={`${optimisticChecked ? 'Uncheck' : 'Check off'} ${item.name}`}
					>
						<div
							className={`flex size-6 shrink-0 items-center justify-center rounded border-2 transition-[scale,background-color,border-color] duration-150 ease-(--ease-micro) group-enabled/check:group-active/check:scale-[0.97] ${
								optimisticChecked
									? 'border-primary bg-primary'
									: 'border-border bg-muted/30'
							}`}
						>
							{optimisticChecked && (
								<Icon
									name="check"
									size="xs"
									className="text-primary-foreground"
								/>
							)}
						</div>

						<div className="min-w-0 flex-1">
							<p
								className={cn(
									'text-base',
									optimisticChecked
										? 'text-muted-foreground/50 decoration-muted-foreground/60 line-through decoration-2'
										: isVoiceAdded && 'text-amber-500/80',
								)}
							>
								{item.name}
								{isVoiceAdded && !optimisticChecked && (
									<Icon
										name="microphone"
										className="ml-1.5 inline size-4 align-middle text-amber-500/80"
									/>
								)}
							</p>
							{(display.quantity || display.unit) && (
								<p
									className={`text-sm ${
										optimisticChecked
											? 'text-muted-foreground/40'
											: 'text-muted-foreground'
									}`}
								>
									<ProduceCountLine
										name={item.name}
										quantity={display.quantity}
										unit={display.unit}
									/>
									{display.combined && (
										<span className="text-muted-foreground/60">
											{' '}
											· incl. meals
										</span>
									)}
								</p>
							)}
						</div>
					</button>
				</div>

				<DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenuTrigger asChild disabled={Boolean(checkState)}>
						<button
							type="button"
							// Radix opens a menu on pointerdown. A finger opens it on the
							// tap instead, so a row swipe that starts here (where a thumb
							// starts a left swipe) swallows that tap and leaves it shut.
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
							className="text-muted-foreground/70 hover:bg-muted hover:text-foreground active:bg-muted flex size-11 shrink-0 items-center justify-center rounded-full transition-colors"
							aria-label="Item actions"
						>
							<Icon
								name={
									isChecking && showCheckSpinner ? 'update' : 'dots-horizontal'
								}
								className={cn(
									'size-4',
									isChecking && showCheckSpinner && 'motion-safe:animate-spin',
								)}
								aria-hidden
							/>
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						collisionPadding={
							menuOpen ? { top: 8, bottom: bottomClearance() } : undefined
						}
						className="min-w-48"
						onCloseAutoFocus={(event) => {
							if (!openingEdit.current) return
							openingEdit.current = false
							event.preventDefault()
						}}
					>
						<DropdownMenuItem
							disabled={moveFetcher.state !== 'idle'}
							onSelect={() =>
								submitRowIntent(moveFetcher, {
									intent: 'move',
									horizon: moveTarget,
								})
							}
						>
							<Icon
								name={moveTarget === LATER ? 'arrow-down' : 'arrow-up'}
								size="sm"
							/>
							{moveLabel}
						</DropdownMenuItem>
						{!optimisticChecked && (
							<>
								<DropdownMenuItem
									onSelect={() => {
										openingEdit.current = true
										setIsEditing(true)
									}}
								>
									<Icon name="pencil-1" size="sm" />
									Edit item
								</DropdownMenuItem>
								{item.source === 'manual' && display.combined && (
									<DropdownMenuItem
										onSelect={() =>
											submitRowIntent(removeGeneratedFetcher, {
												intent: 'removeGeneratedAmount',
											})
										}
									>
										<Icon name="reset" size="sm" />
										Remove generated amount
									</DropdownMenuItem>
								)}
								<DropdownMenuSeparator />
								<DropdownMenuItem variant="destructive" onSelect={deleteItem}>
									<Icon name="trash" size="sm" />
									Delete item
								</DropdownMenuItem>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
				{checkState && (
					<div
						id={`check-status-${item.id}`}
						className={
							checkState === 'failed'
								? 'text-muted-foreground w-full pb-2.5 pl-9 text-sm'
								: 'sr-only'
						}
						role={checkState === 'failed' ? 'alert' : 'status'}
					>
						{checkState === 'failed'
							? 'Couldn’t confirm this check. Your change is still here.'
							: checkState === 'reconciling'
								? 'Checking saved state…'
								: 'Saving check…'}
						{checkState === 'failed' && (
							<button
								type="button"
								className="ml-2 min-h-11 underline"
								onClick={() => checks.retry(item.id)}
							>
								Retry
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	)
}

function ProduceCountLine({
	name,
	quantity: rawQuantity,
	unit,
}: {
	name: string
	quantity: string | null
	unit: string | null
}) {
	const quantity = rawQuantity?.replace(/^["']+|["']+$/g, '') || null
	if (quantity && unit && isWeightUnit(unit)) {
		const parsed = parseAmount(quantity)
		if (parsed !== null) {
			const countDisplay = getProduceCountDisplay(name, parsed, unit)
			if (countDisplay) {
				return (
					<>
						{countDisplay} ({quantity} {unit})
					</>
				)
			}
		}
	}
	return (
		<>
			{quantity} {unit}
		</>
	)
}
