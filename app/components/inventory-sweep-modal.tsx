import { useEffect, useState } from 'react'
import { useFetcher } from 'react-router'
import { toast } from 'sonner'
import { cn } from '#app/utils/misc.tsx'
import { useModal } from '#app/utils/use-modal.ts'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'

type SweepItem = {
	id: string
	name: string
	location: string
	lowStock: boolean
	priority: boolean
}

type SweepAction = 'low-stock' | 'used-up'

const LOCATION_ORDER = ['fridge', 'freezer', 'pantry'] as const
const LOCATION_LABELS: Record<string, string> = {
	pantry: 'Pantry',
	fridge: 'Fridge',
	freezer: 'Freezer',
}

function ItemsByLocation({
	items,
	changes,
	onCycle,
}: {
	items: SweepItem[]
	changes: Map<string, SweepAction>
	onCycle: (itemId: string, isAlreadyLowStock: boolean) => void
}) {
	return (
		<>
			{LOCATION_ORDER.map((loc) => {
				const locItems = items.filter((item) => item.location === loc)
				if (locItems.length === 0) return null
				return (
					<div key={loc}>
						<h3 className="text-muted-foreground mb-1.5 text-[0.75rem] font-medium tracking-[0.08em] uppercase">
							{LOCATION_LABELS[loc]}
						</h3>
						<div className="divide-y divide-border/40">
							{locItems.map((item) => (
								<SweepItemRow
									key={item.id}
									item={item}
									action={changes.get(item.id)}
									onCycle={() => onCycle(item.id, item.lowStock)}
								/>
							))}
						</div>
					</div>
				)
			})}
		</>
	)
}

export function InventorySweepModal({
	onClose,
	onApplied,
}: {
	onClose: () => void
	onApplied: () => void
}) {
	const dialogRef = useModal(onClose)
	const loadFetcher = useFetcher<{ items: SweepItem[] }>()
	const [changes, setChanges] = useState<Map<string, SweepAction>>(new Map())
	const [submitting, setSubmitting] = useState(false)
	const [showAll, setShowAll] = useState(false)

	// Load inventory items on mount
	useEffect(() => {
		void loadFetcher.load('/resources/inventory-sweep')
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	const items = loadFetcher.data?.items ?? []
	const isLoading = loadFetcher.state !== 'idle' || !loadFetcher.data

	const priorityItems = items.filter((i) => i.priority)
	const restItems = items.filter((i) => !i.priority)
	// If everything is priority (small inventory), just show all inline
	const hasSplit = restItems.length > 0 && priorityItems.length > 0

	function cycleState(itemId: string, isAlreadyLowStock: boolean) {
		setChanges((prev) => {
			const next = new Map(prev)
			const current = next.get(itemId)
			if (!current) {
				// keep → low-stock (skip low-stock if already marked low)
				next.set(itemId, isAlreadyLowStock ? 'used-up' : 'low-stock')
			} else if (current === 'low-stock') {
				// low-stock → used-up
				next.set(itemId, 'used-up')
			} else {
				// used-up → keep (remove from changes)
				next.delete(itemId)
			}
			return next
		})
	}

	const changeCount = changes.size

	async function handleApply() {
		if (changeCount === 0) return
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
				toast.success(`Inventory swept: ${parts.join(', ')}`)
				onApplied()
			} else {
				toast.error('Something went wrong applying changes')
			}
		} catch {
			toast.error('Failed to apply changes')
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div
			ref={dialogRef}
			className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
			role="dialog"
			aria-modal="true"
			aria-labelledby="sweep-modal-title"
		>
			<div
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={onClose}
			/>
			<div className="bg-card shadow-warm-lg relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl sm:max-h-[85vh] sm:rounded-2xl">
				{/* Header */}
				<div className="flex items-center justify-between border-b p-4 pb-3">
					<h2 id="sweep-modal-title" className="font-serif text-xl">
						Quick Inventory Review
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
					{isLoading ? (
						<div className="flex flex-col items-center justify-center py-12">
							<Icon
								name="update"
								size="md"
								className="text-muted-foreground animate-spin"
							/>
							<p className="text-muted-foreground mt-2 text-sm">
								Loading inventory...
							</p>
						</div>
					) : items.length === 0 ? (
						<p className="text-muted-foreground py-8 text-center text-sm">
							Your inventory is empty.
						</p>
					) : (
						<div className="space-y-4">
							<p className="text-muted-foreground text-sm">
								Tap items to cycle:{' '}
								<span className="text-foreground font-medium">Keep</span>
								{' → '}
								<span className="font-medium text-amber-600">
									Running low
								</span>
								{' → '}
								<span className="font-medium text-red-600">Used up</span>
							</p>

							{hasSplit ? (
								<>
									<ItemsByLocation
										items={priorityItems}
										changes={changes}
										onCycle={cycleState}
									/>
									{showAll ? (
										<>
											<div className="border-t border-border/40 pt-3">
												<p className="text-muted-foreground mb-3 text-[0.75rem] font-medium tracking-[0.08em] uppercase">
													Everything else
												</p>
											</div>
											<ItemsByLocation
												items={restItems}
												changes={changes}
												onCycle={cycleState}
											/>
										</>
									) : (
										<button
											type="button"
											onClick={() => setShowAll(true)}
											className="text-muted-foreground hover:text-foreground w-full rounded-lg border border-dashed border-border/60 py-2.5 text-center text-sm transition-colors"
										>
											Show {restItems.length} more pantry items
										</button>
									)}
								</>
							) : (
								<ItemsByLocation
									items={items}
									changes={changes}
									onCycle={cycleState}
								/>
							)}
						</div>
					)}
				</div>

				{/* Footer */}
				{!isLoading && items.length > 0 && (
					<div className="flex items-center justify-between border-t p-4">
						<span className="text-muted-foreground text-sm">
							{changeCount === 0
								? 'No changes'
								: `${changeCount} item${changeCount === 1 ? '' : 's'} to update`}
						</span>
						<Button
							disabled={changeCount === 0 || submitting}
							onClick={() => void handleApply()}
						>
							{submitting ? (
								<>
									<Icon
										name="update"
										size="sm"
										className="animate-spin"
									/>
									Applying...
								</>
							) : (
								'Apply Changes'
							)}
						</Button>
					</div>
				)}
			</div>
		</div>
	)
}

function SweepItemRow({
	item,
	action,
	onCycle,
}: {
	item: SweepItem
	action: SweepAction | undefined
	onCycle: () => void
}) {
	const isUsedUp = action === 'used-up'
	const isLowStock = action === 'low-stock'

	return (
		<button
			type="button"
			onClick={onCycle}
			className={cn(
				'flex w-full items-center gap-3 py-2.5 text-left transition-colors',
				isUsedUp && 'opacity-50',
				isLowStock && 'border-l-2 border-amber-500 pl-2',
				!action && 'pl-0',
			)}
		>
			<div className="min-w-0 flex-1">
				<span
					className={cn(
						'text-[15px]',
						isUsedUp && 'text-red-600 line-through dark:text-red-400',
					)}
				>
					{item.name}
				</span>
				{item.lowStock && !action && (
					<span className="ml-1.5 text-xs text-amber-600">low</span>
				)}
			</div>
			<span
				className={cn(
					'shrink-0 text-xs font-medium',
					isUsedUp && 'text-red-600 dark:text-red-400',
					isLowStock && 'text-amber-600 dark:text-amber-400',
					!action && 'text-muted-foreground/50',
				)}
			>
				{isUsedUp ? 'Used up' : isLowStock ? 'Running low' : 'Keep'}
			</span>
		</button>
	)
}
