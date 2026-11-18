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
import { type useShoppingChecks } from '#app/hooks/use-shopping-checks.tsx'
import {
	getHouseholdClientId,
	HouseholdClientInput,
} from '#app/utils/household-client.tsx'
import { haptic } from '#app/utils/shell-bridge.ts'

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
	const [confirmingDelete, setConfirmingDelete] = useState(false)
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
	const deleteFetcher = useFetcher()
	const moveFetcher = useFetcher()
	const removeGeneratedFetcher = useFetcher()
	const prevEditFetcherState = useRef(editFetcher.state)

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

	// Hide once delete is submitted — formData covers in-flight,
	// fetcher.data covers the idle frame before loaderData refreshes
	if (
		deleteFetcher.formData?.get('intent') === 'delete' ||
		deleteFetcher.data?.status === 'success'
	) {
		return null
	}

	const serverError =
		isEditing &&
		editFetcher.data?.status === 'error' &&
		editFetcher.data?.submission?.error
			? 'Please check your input and try again.'
			: null
	const moveTarget = item.horizon === LATER ? NEXT_SHOP : LATER
	const moveLabel = moveTarget === LATER ? 'Move to Later' : 'Move to Next shop'
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
			className="group flex flex-wrap items-center gap-3"
			role="group"
			aria-label={`${item.name} shopping item`}
			// A row added just now eases in (tailwind.css); the saved row that
			// replaces it does not.
			data-optimistic-row={item.id.startsWith('optimistic:') ? '' : undefined}
		>
			{/* Whole row toggles checkbox */}
			<div className="flex min-w-0 flex-1 items-center gap-3">
				<button
					type="button"
					onClick={() => checks.toggle({ ...item, display })}
					disabled={item.id.startsWith('optimistic:')}
					aria-pressed={optimisticChecked}
					aria-busy={isChecking || undefined}
					aria-describedby={checkState ? `check-status-${item.id}` : undefined}
					// The padding sits on the button, not the row, so a tap anywhere
					// in the row's height checks it off.
					className="group/check flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2.5 text-left select-none"
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

			<DropdownMenu
				modal={false}
				open={menuOpen}
				onOpenChange={(open) => {
					setMenuOpen(open)
					// Closing the menu disarms Delete, so a reopened menu needs
					// two taps again.
					if (!open) setConfirmingDelete(false)
				}}
			>
				<DropdownMenuTrigger asChild disabled={Boolean(checkState)}>
					<button
						type="button"
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
							<DropdownMenuItem
								onSelect={(event) => {
									if (!confirmingDelete) {
										event.preventDefault()
										haptic('warning')
										setConfirmingDelete(true)
										return
									}
									submitRowIntent(deleteFetcher, { intent: 'delete' })
								}}
								className={cn(
									'focus:text-destructive',
									confirmingDelete && 'text-destructive font-medium',
								)}
							>
								<Icon name="trash" size="sm" />
								{confirmingDelete ? 'Delete?' : 'Delete item'}
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
