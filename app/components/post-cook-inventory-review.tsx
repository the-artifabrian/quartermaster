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

/**
 * The inner content for the post-cook Pantry review.
 * Used directly inside a combined dialog (meal-slot-card) or
 * wrapped in its own AlertDialog (uncooked-meal-reminder).
 */
export function PostCookInventoryReviewContent({
	recipeTitle,
	matchedItems,
	onDone,
}: {
	recipeTitle: string
	matchedItems: MatchedItem[]
	onDone: () => void
}) {
	const [selected, setSelected] = useState<Set<string>>(
		() =>
			new Set(
				matchedItems.filter((i) => i.preChecked !== false).map((i) => i.id),
			),
	)
	const fetcher = useFetcher<{ success: boolean; deletedCount?: number }>()

	// Handle successful removal
	useEffect(() => {
		if (fetcher.data?.success) {
			const count = fetcher.data.deletedCount ?? selected.size
			toast.success(
				`Removed ${count} item${count !== 1 ? 's' : ''} from Pantry`,
			)
			onDone()
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

	const isSubmitting = fetcher.state !== 'idle'

	return (
		<>
			<AlertDialogHeader>
				<AlertDialogTitle>Update your Pantry?</AlertDialogTitle>
				<AlertDialogDescription>
					You cooked {recipeTitle}. Uncheck anything you still have.
				</AlertDialogDescription>
			</AlertDialogHeader>
			<div className="grid grid-cols-2 gap-1.5">
				{matchedItems.map((item) => (
					<label
						key={item.id}
						className="bg-secondary/30 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 select-none"
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
				<AlertDialogCancel onClick={onDone}>Skip</AlertDialogCancel>
				<Button
					onClick={handleRemove}
					disabled={selected.size === 0 || isSubmitting}
				>
					{isSubmitting
						? 'Removing...'
						: `Remove ${selected.size} item${selected.size !== 1 ? 's' : ''}`}
				</Button>
			</AlertDialogFooter>
		</>
	)
}

/**
 * Standalone dialog wrapper — used by uncooked-meal-reminder
 * where there's no preceding confirmation dialog.
 */
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
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<PostCookInventoryReviewContent
					recipeTitle={recipeTitle}
					matchedItems={matchedItems}
					onDone={() => {
						onOpenChange(false)
						onComplete()
					}}
				/>
			</AlertDialogContent>
		</AlertDialog>
	)
}
