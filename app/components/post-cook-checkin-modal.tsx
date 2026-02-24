import { useState } from 'react'
import { toast } from 'sonner'
import { type CheckInItem } from '#app/utils/post-cook-checkin.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { useModal } from '#app/utils/use-modal.ts'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'

type SweepAction = 'low-stock' | 'used-up'

const LOCATION_LABELS: Record<string, string> = {
	pantry: 'Pantry',
	fridge: 'Fridge',
	freezer: 'Freezer',
}

const LOCATION_ORDER = ['fridge', 'freezer', 'pantry'] as const

export function PostCookCheckInModal({
	items,
	onClose,
}: {
	items: CheckInItem[]
	onClose: () => void
}) {
	const dialogRef = useModal(onClose)
	const [changes, setChanges] = useState<Map<string, SweepAction>>(new Map())
	const [submitting, setSubmitting] = useState(false)

	function cycleState(itemId: string, isAlreadyLowStock: boolean) {
		setChanges((prev) => {
			const next = new Map(prev)
			const current = next.get(itemId)
			if (!current) {
				next.set(itemId, isAlreadyLowStock ? 'used-up' : 'low-stock')
			} else if (current === 'low-stock') {
				next.set(itemId, 'used-up')
			} else {
				next.delete(itemId)
			}
			return next
		})
	}

	const changeCount = changes.size

	async function handleApply() {
		if (changeCount === 0) {
			onClose()
			return
		}
		setSubmitting(true)

		const changesArray = Array.from(changes.entries()).map(
			([itemId, action]) => ({ itemId, action }),
		)

		try {
			const res = await fetch('/resources/inventory-sweep', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ changes: changesArray }),
			})
			const data = (await res.json()) as {
				status: string
				deleted: number
				markedLow: number
			}

			if (data.status === 'success') {
				const parts: string[] = []
				if (data.deleted > 0) parts.push(`${data.deleted} removed`)
				if (data.markedLow > 0) parts.push(`${data.markedLow} marked low`)
				if (parts.length > 0) {
					toast.success(`Inventory updated: ${parts.join(', ')}`)
				}
			} else {
				toast.error('Something went wrong updating inventory')
			}
		} catch {
			toast.error('Failed to update inventory')
		} finally {
			setSubmitting(false)
			onClose()
		}
	}

	// Group items by location
	const groupedLocations = LOCATION_ORDER.filter((loc) =>
		items.some((item) => item.location === loc),
	)

	return (
		<div
			ref={dialogRef}
			className="fixed inset-0 z-60 flex items-end justify-center sm:items-center"
			role="dialog"
			aria-modal="true"
			aria-labelledby="checkin-title"
		>
			<div
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={onClose}
			/>
			<div className="bg-card shadow-warm-lg relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl">
				{/* Header */}
				<div className="flex items-center justify-between border-b p-4 pb-3">
					<h2 id="checkin-title" className="font-serif text-xl">
						Anything running low?
					</h2>
					<button
						onClick={onClose}
						aria-label="Close"
						className="text-muted-foreground hover:text-foreground rounded-md p-1 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2"
					>
						<Icon name="cross-1" size="sm" />
					</button>
				</div>

				{/* Body */}
				<div className="flex-1 overflow-y-auto p-4">
					<div className="space-y-4">
						<p className="text-muted-foreground text-sm">
							Tap items to cycle:{' '}
							<span className="text-foreground font-medium">Keep</span>
							{' → '}
							<span className="font-medium text-amber-600">Running low</span>
							{' → '}
							<span className="font-medium text-red-600">Used up</span>
						</p>

						{groupedLocations.map((loc) => {
							const locItems = items.filter((item) => item.location === loc)
							return (
								<div key={loc}>
									<h3 className="text-muted-foreground mb-1.5 text-[0.75rem] font-medium tracking-[0.08em] uppercase">
										{LOCATION_LABELS[loc]}
									</h3>
									<div className="divide-y divide-border/40">
										{locItems.map((item) => {
											const action = changes.get(item.id)
											const isUsedUp = action === 'used-up'
											const isLowStock = action === 'low-stock'

											return (
												<button
													key={item.id}
													type="button"
													onClick={() => cycleState(item.id, item.lowStock)}
													className={cn(
														'flex w-full items-center gap-3 py-2.5 text-left transition-colors',
														isUsedUp && 'opacity-50',
														isLowStock &&
															'border-l-2 border-amber-500 pl-2',
														!action && 'pl-0',
													)}
												>
													<div className="min-w-0 flex-1">
														<span
															className={cn(
																'text-[15px]',
																isUsedUp &&
																	'text-red-600 line-through dark:text-red-400',
															)}
														>
															{item.name}
														</span>
														{item.lowStock && !action && (
															<span className="ml-1.5 text-xs text-amber-600">
																low
															</span>
														)}
													</div>
													<span
														className={cn(
															'shrink-0 text-xs font-medium',
															isUsedUp &&
																'text-red-600 dark:text-red-400',
															isLowStock &&
																'text-amber-600 dark:text-amber-400',
															!action && 'text-muted-foreground/50',
														)}
													>
														{isUsedUp
															? 'Used up'
															: isLowStock
																? 'Running low'
																: 'Keep'}
													</span>
												</button>
											)
										})}
									</div>
								</div>
							)
						})}
					</div>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between border-t p-4">
					<span className="text-muted-foreground text-sm">
						{changeCount === 0
							? 'No changes'
							: `${changeCount} item${changeCount === 1 ? '' : 's'} to update`}
					</span>
					<Button
						disabled={submitting}
						onClick={() => void handleApply()}
					>
						{submitting ? (
							<>
								<Icon name="update" size="sm" className="animate-spin" />
								Applying...
							</>
						) : changeCount === 0 ? (
							'Done'
						) : (
							'Apply Changes'
						)}
					</Button>
				</div>
			</div>
		</div>
	)
}
