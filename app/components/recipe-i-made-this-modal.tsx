import { format } from 'date-fns'
import { useState } from 'react'
import { type useFetcher } from 'react-router'
import { toast } from 'sonner'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { type SubtractionSummary } from '#app/utils/inventory-subtract.server.ts'
import { cn } from '#app/utils/misc.tsx'
import {
	type SubtractionPreviewData,
	formatQuantity,
} from '#app/utils/recipe-detail.ts'
import { useModal } from '#app/utils/use-modal.ts'

function formatSkipReason(
	items: Array<{ name: string; reason: string }>,
): string {
	const noQty = items.filter((i) => i.reason === 'no_quantity')
	const badUnits = items.filter((i) => i.reason === 'incompatible_units')

	const parts: string[] = []
	if (noQty.length > 0) {
		parts.push(`${noQty.map((i) => i.name).join(', ')} (no quantity tracked)`)
	}
	if (badUnits.length > 0) {
		parts.push(`${badUnits.map((i) => i.name).join(', ')} (incompatible units)`)
	}
	return parts.join('; ')
}

export function IMadeThisModal({
	ratio,
	cookFetcher,
	previewFetcher,
	onClose,
	isProActive,
	cookResult,
}: {
	ratio: number
	cookFetcher: ReturnType<typeof useFetcher>
	previewFetcher: ReturnType<typeof useFetcher>
	onClose: () => void
	isProActive: boolean
	cookResult?: SubtractionSummary | null
}) {
	const dialogRef = useModal(onClose)

	// Review state: post-cook review of skipped items
	if (cookResult && cookResult.skipped.length > 0) {
		return <ReviewState cookResult={cookResult} onClose={onClose} />
	}

	const previewData = previewFetcher.data as
		| { preview?: SubtractionPreviewData }
		| undefined
	const preview = previewData?.preview
	const isLoadingPreview = previewFetcher.state !== 'idle'
	const hasSubtractions = preview && preview.willSubtract.length > 0
	const hasInventoryImpact =
		preview && (preview.willSubtract.length > 0 || preview.willSkip.length > 0)

	return (
		<div
			ref={dialogRef}
			className="fixed inset-0 z-60 flex items-end justify-center sm:items-center"
			role="dialog"
			aria-modal="true"
			aria-labelledby="i-made-this-title"
		>
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={onClose}
			/>
			{/* Modal */}
			<div className="bg-card shadow-warm-lg relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-6 sm:rounded-2xl">
				<div className="mb-1 flex items-center justify-between">
					<h2 id="i-made-this-title" className="font-serif text-xl">
						I Made This
					</h2>
					<button
						onClick={onClose}
						aria-label="Close"
						className="text-muted-foreground hover:text-foreground rounded-md p-1 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2"
					>
						<Icon name="cross-1" size="sm" />
					</button>
				</div>
				<p className="text-muted-foreground mb-4 text-sm">
					{isProActive
						? 'Log this cook and update your inventory.'
						: 'Log this cook to your history.'}
				</p>
				<cookFetcher.Form method="POST" className="space-y-4">
					<input type="hidden" name="intent" value="logCook" />
					<input type="hidden" name="servingRatio" value={ratio} />
					<div>
						<label
							htmlFor="cookedAt"
							className="text-muted-foreground mb-1 block text-sm"
						>
							Date
						</label>
						<input
							type="date"
							id="cookedAt"
							name="cookedAt"
							defaultValue={format(new Date(), 'yyyy-MM-dd')}
							className="border-input bg-background rounded-md border px-3 py-1.5 text-base md:text-sm"
						/>
					</div>
					<div>
						<label
							htmlFor="cookNotes"
							className="text-muted-foreground mb-1 block text-sm"
						>
							Notes (optional)
						</label>
						<textarea
							id="cookNotes"
							name="notes"
							rows={2}
							placeholder="How did it turn out? Any adjustments?"
							className="border-input bg-background w-full rounded-md border px-3 py-2 text-base md:text-sm"
						/>
					</div>

					{/* Inventory impact preview (Pro only) */}
					{isProActive && (
						<>
							<div className="rounded-lg border p-3">
								<h3 className="mb-2 text-sm font-semibold">Inventory Impact</h3>
								{isLoadingPreview ? (
									<p className="text-muted-foreground text-sm">
										Checking inventory...
									</p>
								) : hasInventoryImpact ? (
									<>
										{preview.willSubtract.length > 0 && (
											<ul className="space-y-1.5">
												{preview.willSubtract.map((item) => (
													<li
														key={item.name}
														className="flex items-center justify-between text-sm"
													>
														<span>{item.name}</span>
														<span className="text-muted-foreground text-xs">
															{item.willBeRemoved ? (
																<span className="text-red-600">
																	will be removed
																</span>
															) : (
																<>
																	{formatQuantity(item.currentQuantity)}{' '}
																	{item.currentUnit ?? ''} →{' '}
																	{formatQuantity(item.newQuantity)}{' '}
																	{item.currentUnit ?? ''}
																</>
															)}
														</span>
													</li>
												))}
											</ul>
										)}
										{preview.noMatch.length > 0 && (
											<p className="text-muted-foreground mt-2 text-xs">
												Not in inventory: {preview.noMatch.join(', ')}
											</p>
										)}
										{preview.willSkip.length > 0 && (
											<p className="text-muted-foreground mt-2 text-xs">
												Won't auto-adjust: {formatSkipReason(preview.willSkip)}
											</p>
										)}
									</>
								) : preview ? (
									<>
										<p className="text-muted-foreground text-sm">
											No matching inventory items to subtract.
										</p>
										{preview.noMatch.length > 0 && (
											<p className="text-muted-foreground mt-1 text-xs">
												Not in inventory: {preview.noMatch.join(', ')}
											</p>
										)}
										{preview.willSkip.length > 0 && (
											<p className="text-muted-foreground mt-1 text-xs">
												Won't auto-adjust: {formatSkipReason(preview.willSkip)}
											</p>
										)}
									</>
								) : null}
							</div>

							<label className="flex items-center gap-2 py-1 text-sm">
								<input
									key={hasInventoryImpact ? 'has-impact' : 'no-impact'}
									type="checkbox"
									name="subtractInventory"
									defaultChecked={!!hasInventoryImpact}
									disabled={!hasInventoryImpact}
									className="size-5 rounded"
								/>
								{hasSubtractions
									? 'Subtract ingredients from inventory'
									: 'Review inventory after cooking'}
							</label>
						</>
					)}
					<div className="flex gap-2">
						<Button type="submit" className="flex-1">
							Confirm
						</Button>
						<Button type="button" variant="ghost" onClick={onClose}>
							Cancel
						</Button>
					</div>
				</cookFetcher.Form>
			</div>
		</div>
	)
}

function ReviewState({
	cookResult,
	onClose,
}: {
	cookResult: SubtractionSummary
	onClose: () => void
}) {
	const reviewDialogRef = useModal(onClose)
	const [usedUpIds, setUsedUpIds] = useState<Set<string>>(() => new Set())

	function markUsedUp(inventoryItemId: string) {
		setUsedUpIds((prev) => new Set(prev).add(inventoryItemId))
		// Use plain fetch to allow concurrent deletions (useFetcher would
		// abort the previous in-flight request on rapid taps)
		fetch('/resources/inventory-remove', {
			method: 'POST',
			body: new URLSearchParams({ inventoryItemId }),
		}).then((response) => {
			if (!response.ok) {
				setUsedUpIds((prev) => {
					const next = new Set(prev)
					next.delete(inventoryItemId)
					return next
				})
				toast.error('Failed to remove item from inventory')
			}
		}).catch(() => {
			setUsedUpIds((prev) => {
				const next = new Set(prev)
				next.delete(inventoryItemId)
				return next
			})
			toast.error('Failed to remove item from inventory')
		})
	}

	const summaryParts: string[] = []
	if (cookResult.updated.length > 0) {
		summaryParts.push(`Subtracted ${cookResult.updated.join(', ')}.`)
	}
	if (cookResult.removed.length > 0) {
		summaryParts.push(`Removed ${cookResult.removed.join(', ')}.`)
	}

	const hasChanges =
		cookResult.updated.length > 0 || cookResult.removed.length > 0

	return (
		<div
			ref={reviewDialogRef}
			className="fixed inset-0 z-60 flex items-end justify-center sm:items-center"
			role="dialog"
			aria-modal="true"
			aria-labelledby="review-title"
		>
			<div
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={onClose}
			/>
			<div className="bg-card shadow-warm-lg relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-6 sm:rounded-2xl">
				<div className="mb-1 flex items-center justify-between">
					<h2 id="review-title" className="font-serif text-xl">
						{hasChanges ? 'Inventory Updated' : 'Cook Logged'}
					</h2>
					<button
						onClick={onClose}
						aria-label="Close"
						className="text-muted-foreground hover:text-foreground rounded-md p-1 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2"
					>
						<Icon name="cross-1" size="sm" />
					</button>
				</div>

				{summaryParts.length > 0 && (
					<p className="text-muted-foreground mb-4 text-sm">
						{summaryParts.join(' ')}
					</p>
				)}

				<div className="space-y-3">
					<div>
						<h3 className="text-sm font-semibold">Ran out of anything?</h3>
						<p className="text-muted-foreground text-xs">
							Tap items you've used up:
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						{cookResult.skipped.map((item) => {
							const isUsedUp = usedUpIds.has(item.inventoryItemId)
							return (
								<button
									key={item.inventoryItemId}
									type="button"
									onClick={() => {
										if (!isUsedUp) markUsedUp(item.inventoryItemId)
									}}
									disabled={isUsedUp}
									className={cn(
										'rounded-full border px-3 py-1.5 text-sm transition-colors',
										isUsedUp
											? 'text-muted-foreground border-muted line-through opacity-60'
											: 'hover:bg-accent/10 hover:border-accent border-border',
									)}
								>
									{item.name}
								</button>
							)
						})}
					</div>
				</div>

				<div className="mt-5">
					<Button onClick={onClose} className="w-full">
						Done
					</Button>
				</div>
			</div>
		</div>
	)
}
