import { useEffect, useState } from 'react'
import { useFetcher } from 'react-router'
import { toast } from 'sonner'
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '#app/components/ui/alert-dialog.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Checkbox } from '#app/components/ui/checkbox.tsx'

type MatchedItem = { id: string; name: string; preChecked?: boolean }

export function PostCookInventoryReview({
	open,
	onOpenChange,
	recipeTitle,
	matchedItems,
	onComplete,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	recipeTitle: string
	matchedItems: MatchedItem[]
	onComplete: () => void
}) {
	const [selected, setSelected] = useState<Set<string>>(() => new Set())
	const fetcher = useFetcher<{ success: boolean; deletedCount?: number }>()

	// Pre-select perishable items when the dialog opens
	useEffect(() => {
		if (open && matchedItems.length > 0) {
			setSelected(
				new Set(
					matchedItems
						.filter((i) => i.preChecked !== false)
						.map((i) => i.id),
				),
			)
		}
	}, [open, matchedItems])

	// Handle successful removal
	useEffect(() => {
		if (fetcher.data?.success) {
			const count = fetcher.data.deletedCount ?? selected.size
			toast.success(
				`Removed ${count} item${count !== 1 ? 's' : ''} from inventory`,
			)
			onOpenChange(false)
			onComplete()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fetcher.data])

	function toggleItem(id: string) {
		setSelected((prev) => {
			const next = new Set(prev)
			if (next.has(id)) {
				next.delete(id)
			} else {
				next.add(id)
			}
			return next
		})
	}

	function handleRemove() {
		const ids = Array.from(selected)
		if (ids.length === 0) return
		const formData = new FormData()
		formData.set('inventoryItemIds', JSON.stringify(ids))
		void fetcher.submit(formData, {
			method: 'POST',
			action: '/resources/inventory-remove',
		})
	}

	function handleSkip() {
		onOpenChange(false)
		onComplete()
	}

	const isSubmitting = fetcher.state !== 'idle'

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Update your inventory?</AlertDialogTitle>
					<AlertDialogDescription>
						You cooked {recipeTitle}. Tap items you've used up.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="grid grid-cols-2 gap-1.5">
					{matchedItems.map((item) => (
						<label
							key={item.id}
							className="flex cursor-pointer items-center gap-2 rounded-lg bg-secondary/30 px-2.5 py-2 select-none"
						>
							<Checkbox
								checked={selected.has(item.id)}
								onCheckedChange={() => toggleItem(item.id)}
								className="shrink-0"
							/>
							<span className="text-xs leading-tight capitalize sm:text-sm">
								{item.name}
							</span>
						</label>
					))}
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={handleSkip}>Skip</AlertDialogCancel>
					<Button
						onClick={handleRemove}
						disabled={selected.size === 0 || isSubmitting}
					>
						{isSubmitting
							? 'Removing...'
							: `Remove ${selected.size} item${selected.size !== 1 ? 's' : ''}`}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
