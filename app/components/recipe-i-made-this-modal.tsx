import { format } from 'date-fns'
import { useEffect } from 'react'
import { type useFetcher } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	type SubtractionPreviewData,
	formatQuantity,
} from '#app/utils/recipe-detail.ts'

export function IMadeThisModal({
	ratio,
	cookFetcher,
	previewFetcher,
	onClose,
	isProActive,
}: {
	ratio: number
	cookFetcher: ReturnType<typeof useFetcher>
	previewFetcher: ReturnType<typeof useFetcher>
	onClose: () => void
	isProActive: boolean
}) {
	useEffect(() => {
		function handleEscape(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', handleEscape)
		return () => document.removeEventListener('keydown', handleEscape)
	}, [onClose])

	const previewData = previewFetcher.data as
		| { preview?: SubtractionPreviewData }
		| undefined
	const preview = previewData?.preview
	const isLoadingPreview = previewFetcher.state !== 'idle'
	const hasInventoryImpact = preview && preview.willSubtract.length > 0

	return (
		<div
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
					<h2 id="i-made-this-title" className="font-serif text-xl font-bold">
						I Made This
					</h2>
					<button
						onClick={onClose}
						aria-label="Close"
						className="text-muted-foreground hover:text-foreground rounded-md p-1"
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
										<ul className="space-y-1.5">
											{preview.willSubtract.map((item) => (
												<li
													key={item.name}
													className="flex items-center justify-between text-sm"
												>
													<span>{item.name}</span>
													<span className="text-muted-foreground text-xs">
														{item.willBeFlaggedLow ? (
															<span className="text-amber-600">
																will be flagged low
															</span>
														) : item.willBeRemoved ? (
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
										{preview.noMatch.length > 0 && (
											<p className="text-muted-foreground mt-2 text-xs">
												Not in inventory: {preview.noMatch.join(', ')}
											</p>
										)}
									</>
								) : preview ? (
									<p className="text-muted-foreground text-sm">
										No matching inventory items to subtract.
										{preview.noMatch.length > 0 && (
											<span className="mt-1 block text-xs">
												Not in inventory: {preview.noMatch.join(', ')}
											</span>
										)}
									</p>
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
								Subtract ingredients from inventory
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
