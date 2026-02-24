import { format } from 'date-fns'
import { type useFetcher } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { useModal } from '#app/utils/use-modal.ts'

export function IMadeThisModal({
	ratio,
	cookFetcher,
	onClose,
}: {
	ratio: number
	cookFetcher: ReturnType<typeof useFetcher>
	onClose: () => void
}) {
	const dialogRef = useModal(onClose)

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
					Log this cook to your history.
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
