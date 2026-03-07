import { type ShoppingListItem } from '@prisma/client'
import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { parseAmount } from '#app/utils/fractions.ts'
import { cn } from '#app/utils/misc.tsx'
import {
	getProduceCountDisplay,
	isWeightUnit,
} from '#app/utils/produce-weights.ts'

type ShoppingListItemCardProps = {
	item: ShoppingListItem
	isVoiceAdded?: boolean
}

export function ShoppingListItemCard({ item, isVoiceAdded }: ShoppingListItemCardProps) {
	const [isEditing, setIsEditing] = useState(false)
	const [showActions, setShowActions] = useState(false)
	const editFetcher = useFetcher()
	const toggleFetcher = useFetcher()
	const deleteFetcher = useFetcher()
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
	const optimisticChecked =
		toggleFetcher.formData?.get('intent') === 'toggle'
			? !item.checked
			: item.checked

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

	if (isEditing) {
		return (
			<div className="p-3 print:p-1">
				<editFetcher.Form
					method="POST"
					onKeyDown={(e) => {
						if (e.key === 'Escape') setIsEditing(false)
					}}
				>
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
								defaultValue={item.quantity ?? ''}
								placeholder="Qty"
								className="flex-1"
								maxLength={50}
							/>
							<Input
								name="unit"
								defaultValue={item.unit ?? ''}
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
		<div className="group flex items-center gap-3 py-2.5 print:py-1">
			{/* Whole row toggles checkbox */}
			<toggleFetcher.Form method="POST" className="flex min-w-0 flex-1 items-center gap-3 print:contents">
				<input type="hidden" name="intent" value="toggle" />
				<input type="hidden" name="itemId" value={item.id} />
				<button
					type="submit"
					className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
					aria-label={optimisticChecked ? 'Uncheck item' : 'Check off item'}
				>
					<div
						className={`flex size-6 shrink-0 items-center justify-center rounded border-2 transition-colors duration-150 print:hidden ${
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
					<span className="hidden pt-0.5 text-base print:inline">
						{optimisticChecked ? '\u2611' : '\u2610'}
					</span>

					<div className="min-w-0 flex-1">
						<p
							className={cn(
								'text-base',
								optimisticChecked
									? 'text-muted-foreground/50 line-through decoration-muted-foreground/60 decoration-2'
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
						{(item.quantity || item.unit) && (
							<p
								className={`text-sm ${
									optimisticChecked
										? 'text-muted-foreground/40'
										: 'text-muted-foreground'
								}`}
							>
								<ProduceCountLine item={item} />
							</p>
						)}
					</div>
				</button>
			</toggleFetcher.Form>

			{/* Overflow menu */}
			{!optimisticChecked && (
				<div ref={actionsRef} className="relative shrink-0 print:hidden">
					<button
						type="button"
						onClick={() => setShowActions((v) => !v)}
						className="flex size-10 items-center justify-center rounded-full text-muted-foreground/40 transition-colors hover:bg-muted hover:text-muted-foreground"
						aria-label="Item actions"
					>
						<Icon name="dots-horizontal" className="size-4" />
					</button>
					{showActions && (
						<div className="absolute right-0 z-10 mt-1 flex items-center gap-1 rounded-lg border bg-card p-1 shadow-warm-md animate-fade-up-reveal">
							<button
								type="button"
								onClick={() => {
									setIsEditing(true)
									setShowActions(false)
								}}
								className="flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								aria-label="Edit item"
							>
								<Icon name="pencil-1" size="sm" />
							</button>
							<deleteFetcher.Form method="POST">
								<input type="hidden" name="intent" value="delete" />
								<input type="hidden" name="itemId" value={item.id} />
								<button
									type="submit"
									className="flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
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
	)
}

function ProduceCountLine({ item }: { item: ShoppingListItem }) {
	const quantity = item.quantity?.replace(/^["']+|["']+$/g, '') || null
	if (quantity && item.unit && isWeightUnit(item.unit)) {
		const parsed = parseAmount(quantity)
		if (parsed !== null) {
			const countDisplay = getProduceCountDisplay(item.name, parsed, item.unit)
			if (countDisplay) {
				return (
					<>
						{countDisplay} ({quantity} {item.unit})
					</>
				)
			}
		}
	}
	return (
		<>
			{quantity} {item.unit}
		</>
	)
}
