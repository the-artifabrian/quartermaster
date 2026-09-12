import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { useSpinDelay } from 'spin-delay'
import { Button } from '#app/components/ui/button.tsx'
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
import { HouseholdClientInput } from '#app/utils/household-client.tsx'

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
	const [showActions, setShowActions] = useState(false)
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
	const actionsRef = useRef<HTMLDivElement>(null)

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

	// Close actions menu on outside click
	useEffect(() => {
		if (!showActions) return
		function handleClick(e: MouseEvent) {
			if (
				actionsRef.current &&
				!actionsRef.current.contains(e.target as Node)
			) {
				setShowActions(false)
			}
		}
		document.addEventListener('click', handleClick)
		return () => document.removeEventListener('click', handleClick)
	}, [showActions])

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
			className="group flex flex-wrap items-center gap-3 py-2.5"
			role="group"
			aria-label={`${item.name} shopping item`}
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
					className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
					aria-label={optimisticChecked ? 'Uncheck item' : 'Check off item'}
				>
					<div
						className={`flex size-6 shrink-0 items-center justify-center rounded border-2 transition-colors duration-150 ${
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

			{/* Overflow menu */}
			<div ref={actionsRef} className="relative shrink-0">
				<button
					type="button"
					onClick={() => setShowActions((v) => !v)}
					disabled={Boolean(checkState)}
					className="text-muted-foreground/40 hover:bg-muted hover:text-muted-foreground flex size-10 items-center justify-center rounded-full transition-colors"
					aria-label="Item actions"
				>
					<Icon
						name={isChecking && showCheckSpinner ? 'update' : 'dots-horizontal'}
						className={cn(
							'size-4',
							isChecking && showCheckSpinner && 'motion-safe:animate-spin',
						)}
						aria-hidden
					/>
				</button>
				{showActions && (
					<div className="bg-card shadow-warm-md animate-fade-up-reveal absolute right-0 z-10 mt-1 min-w-44 rounded-lg border p-1">
						<moveFetcher.Form method="POST">
							<HouseholdClientInput />
							<input type="hidden" name="intent" value="move" />
							<input type="hidden" name="itemId" value={item.id} />
							<input type="hidden" name="horizon" value={moveTarget} />
							<button
								type="submit"
								disabled={moveFetcher.state !== 'idle'}
								className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-10 w-full items-center gap-2 rounded-md px-3 text-sm transition-colors disabled:opacity-50"
								aria-label={moveLabel}
							>
								<Icon
									name={moveTarget === LATER ? 'arrow-down' : 'arrow-up'}
									size="sm"
								/>
								{moveLabel}
							</button>
						</moveFetcher.Form>
						{!optimisticChecked && (
							<div className="border-border/50 flex items-center justify-end gap-1 border-t pt-1">
								<button
									type="button"
									onClick={() => {
										setIsEditing(true)
										setShowActions(false)
									}}
									className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-10 items-center justify-center rounded-md transition-colors"
									aria-label="Edit item"
								>
									<Icon name="pencil-1" size="sm" />
								</button>
								{item.source === 'manual' && display.combined && (
									<removeGeneratedFetcher.Form method="POST">
										<HouseholdClientInput />
										<input
											type="hidden"
											name="intent"
											value="removeGeneratedAmount"
										/>
										<input type="hidden" name="itemId" value={item.id} />
										<button
											type="submit"
											className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-10 items-center justify-center rounded-md transition-colors"
											aria-label="Remove generated amount"
										>
											<Icon name="reset" size="sm" />
										</button>
									</removeGeneratedFetcher.Form>
								)}
								<deleteFetcher.Form method="POST">
									<HouseholdClientInput />
									<input type="hidden" name="intent" value="delete" />
									<input type="hidden" name="itemId" value={item.id} />
									<button
										type="submit"
										className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-10 items-center justify-center rounded-md transition-colors"
										aria-label="Delete item"
									>
										<Icon name="trash" size="sm" />
									</button>
								</deleteFetcher.Form>
							</div>
						)}
					</div>
				)}
			</div>
			{checkState && (
				<div
					id={`check-status-${item.id}`}
					className={
						checkState === 'failed'
							? 'text-muted-foreground w-full pl-9 text-sm'
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
