import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { useSpinDelay } from 'spin-delay'
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
import { type ShoppingListItem } from '#app/generated/prisma/client.ts'
import { parseAmount } from '#app/utils/fractions.ts'
import { cn } from '#app/utils/misc.tsx'
import {
	getProduceCountDisplay,
	isWeightUnit,
} from '#app/utils/produce-weights.ts'
import { LATER, NEXT_SHOP } from '#app/utils/shopping-horizon.ts'
import { keepsOwnAmount } from '#app/utils/shopping-row-source.ts'
import { type ShoppingItemDisplay } from '#app/utils/shopping-optimistic.ts'
import { useSwipeRow } from '#app/hooks/use-swipe-row.ts'
import { type useShoppingChecks } from '#app/hooks/use-shopping-checks.tsx'
import { useDeleteWithUndo } from '#app/components/undo-delete.tsx'
import {
	getHouseholdClientId,
	HouseholdClientInput,
} from '#app/utils/household-client.tsx'

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
	// On a phone the editor is a bottom sheet over the row; wider, it takes
	// the row's place. Set when it opens.
	const [editInSheet, setEditInSheet] = useState(false)
	// Each open starts a fresh form, even one that reopens a sheet still
	// leaving with what was typed before.
	const [editCount, setEditCount] = useState(0)
	const menuTriggerRef = useRef<HTMLButtonElement>(null)
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
	const menuPointer = useRef<string | null>(null)

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
	const swipe = useSwipeRow<HTMLDivElement>({
		enabled: !isEditing && !item.id.startsWith('optimistic:') && !checkState,
		width: swipeWidth,
		onSwiped: (open) => {
			if (open) setMenuOpen(false)
		},
	})
	const swipeOpen = swipe.open

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

	const editor = (
		<editFetcher.Form
			key={editCount}
			method="POST"
			onKeyDown={(e) => {
				if (e.key === 'Escape') setIsEditing(false)
			}}
		>
			<HouseholdClientInput />
			<input type="hidden" name="intent" value="edit" />
			<input type="hidden" name="itemId" value={item.id} />
			<div className={editInSheet ? 'space-y-3' : 'space-y-2'}>
				<EditField label="Name" id={`edit-${item.id}-name`} show={editInSheet}>
					<Input
						id={`edit-${item.id}-name`}
						name="name"
						defaultValue={item.name}
						placeholder="Item name"
						// Items stay lowercase, like the ones From Plan.
						autoCapitalize="none"
						autoFocus
						required
						maxLength={100}
					/>
				</EditField>
				<div className="flex gap-2">
					<EditField
						label="Quantity"
						id={`edit-${item.id}-quantity`}
						show={editInSheet}
						className="flex-1"
					>
						<Input
							id={`edit-${item.id}-quantity`}
							name="quantity"
							defaultValue={
								keepsOwnAmount(item.source)
									? (item.quantity ?? '')
									: (display.quantity ?? '')
							}
							placeholder="Qty"
							enterKeyHint="done"
							className="flex-1"
							maxLength={50}
						/>
					</EditField>
					<EditField
						label="Unit"
						id={`edit-${item.id}-unit`}
						show={editInSheet}
						className="flex-1"
					>
						<Input
							id={`edit-${item.id}-unit`}
							name="unit"
							defaultValue={
								keepsOwnAmount(item.source)
									? (item.unit ?? '')
									: (display.unit ?? '')
							}
							placeholder="Unit"
							autoCapitalize="none"
							autoCorrect="off"
							className="flex-1"
							maxLength={20}
						/>
					</EditField>
				</div>
				{serverError && (
					<p className="text-destructive text-sm">{serverError}</p>
				)}
				{editInSheet ? (
					// A sheet closes by its own Close; Save is full width.
					<Button type="submit" className="mt-1 w-full">
						Save
					</Button>
				) : (
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
				)}
			</div>
		</editFetcher.Form>
	)

	if (isEditing && !editInSheet) {
		return (
			<div
				className="p-3"
				role="group"
				aria-label={`${item.name} shopping item`}
			>
				{editor}
			</div>
		)
	}

	return (
		<div
			// Reaches 14px into the right gutter, so the dots glyph of the 44px
			// menu button ends on the content edge, under the list's hairlines.
			className="group relative -mr-3.5 overflow-hidden"
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
						swipe.close()
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
							deleteItem()
							swipe.closeAfterDelete()
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
				// A tap on an open row shuts it instead of checking the item.
				{...swipe.handlers}
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
							ref={menuTriggerRef}
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
										setEditInSheet(opensAsSheet())
										setEditCount((count) => count + 1)
										setIsEditing(true)
									}}
								>
									<Icon name="pencil-1" size="sm" />
									Edit
								</DropdownMenuItem>
								{keepsOwnAmount(item.source) && display.combined && (
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
									Delete
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
			{/* Outside the swiping row, so its taps and drags stay the sheet's. */}
			{editInSheet && (
				<BottomSheet
					open={isEditing}
					onClose={() => setIsEditing(false)}
					labelledBy={`edit-${item.id}-title`}
					title="Edit item"
					returnFocusRef={menuTriggerRef}
				>
					{editor}
				</BottomSheet>
			)}
		</div>
	)
}

/** A visible label over a field in the sheet; the inline editor has none. */
function EditField({
	label,
	id,
	show,
	className,
	children,
}: {
	label: string
	id: string
	show: boolean
	className?: string
	children: React.ReactNode
}) {
	if (!show) return children
	return (
		<div className={className}>
			<label
				htmlFor={id}
				className="text-muted-foreground mb-1 block text-xs font-medium"
			>
				{label}
			</label>
			{children}
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
