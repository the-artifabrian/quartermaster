import { type ShoppingListItem } from '@prisma/client'
import { useState } from 'react'
import { useFetcher } from 'react-router'
import { Button } from './ui/button.tsx'
import { Checkbox } from './ui/checkbox.tsx'

type InventoryReviewItem = {
	id: string
	name: string
	quantity: string | null
	unit: string | null
	included: boolean
	inInventory: boolean
}

export function ShoppingListToInventory({
	items,
	inventoryCanonicals,
	itemCanonicals,
	onCancel,
}: {
	items: ShoppingListItem[]
	inventoryCanonicals: Set<string>
	itemCanonicals: Record<string, string>
	onCancel: () => void
}) {
	const fetcher = useFetcher()
	const isSubmitting = fetcher.state !== 'idle'

	// Separate household items — they won't become inventory
	const foodItems = items.filter((item) => item.category !== 'household')
	const householdCount = items.length - foodItems.length

	const [reviewItems, setReviewItems] = useState<InventoryReviewItem[]>(() =>
		foodItems.map((item) => {
			const canonical = itemCanonicals[item.id]
			const alreadyStocked = canonical
				? inventoryCanonicals.has(canonical)
				: false
			return {
				id: item.id,
				name: item.name,
				quantity: item.quantity,
				unit: item.unit,
				included: !alreadyStocked,
				inInventory: alreadyStocked,
			}
		}),
	)

	const selectedCount = reviewItems.filter((i) => i.included).length
	const allSelected =
		reviewItems.length > 0 && selectedCount === reviewItems.length
	const alreadyStockedCount = reviewItems.filter(
		(i) => i.inInventory && !i.included,
	).length

	function handleToggle(id: string) {
		setReviewItems((prev) =>
			prev.map((item) =>
				item.id === id ? { ...item, included: !item.included } : item,
			),
		)
	}

	function handleSelectAll() {
		const newIncluded = !allSelected
		setReviewItems((prev) =>
			prev.map((item) => ({ ...item, included: newIncluded })),
		)
	}

	function handleSubmit() {
		const selected = reviewItems
			.filter((i) => i.included)
			.map((i) => ({ itemId: i.id }))
		// Include household items too — server will clear them but skip inventory creation
		const householdItemEntries = items
			.filter((item) => item.category === 'household')
			.map((item) => ({ itemId: item.id }))
		const allItems = [...selected, ...householdItemEntries]
		if (allItems.length === 0) return

		const formData = new FormData()
		formData.set('items', JSON.stringify(allItems))
		void fetcher.submit(formData, {
			method: 'POST',
			action: '/resources/shopping-to-inventory',
		})
	}

	return (
		<div className="rounded-xl border border-border/50 bg-secondary/30 p-5">
			<div className="mb-4">
				<h3 className="font-serif text-lg font-normal">Add to Inventory</h3>
				<p className="text-muted-foreground mt-1 text-sm">
					Select the items you want to add to your inventory.
				</p>
			</div>

			{reviewItems.length > 0 && (
				<>
					<div className="mb-2 flex items-center justify-between">
						<button
							type="button"
							onClick={handleSelectAll}
							className="text-primary text-xs font-medium hover:underline"
						>
							{allSelected ? 'Deselect all' : 'Select all'}
						</button>
						<span className="text-muted-foreground text-xs">
							{selectedCount}/{reviewItems.length}
						</span>
					</div>

					<div className="divide-y divide-border/40">
						{reviewItems.map((item) => (
							<div
								key={item.id}
								className={
									item.inInventory && !item.included
										? 'opacity-60'
										: undefined
								}
							>
								<div
									className="flex cursor-pointer items-center gap-3 py-3"
									onClick={() => handleToggle(item.id)}
								>
									<div
										onClick={(e) => e.stopPropagation()}
										className="shrink-0"
									>
										<Checkbox
											checked={item.included}
											onCheckedChange={() => handleToggle(item.id)}
										/>
									</div>
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium">
											{item.name}
										</p>
										{(item.quantity || item.unit) && (
											<p className="text-muted-foreground text-xs">
												{item.quantity} {item.unit}
											</p>
										)}
									</div>
									{item.inInventory && !item.included && (
										<span className="shrink-0 text-xs italic text-muted-foreground">
											Already in inventory
										</span>
									)}
								</div>
							</div>
						))}
					</div>
				</>
			)}

			{alreadyStockedCount > 0 && (
				<p className="text-muted-foreground mt-3 text-sm">
					{alreadyStockedCount} item
					{alreadyStockedCount !== 1 ? 's' : ''} already in your inventory
					(deselected).
				</p>
			)}

			{householdCount > 0 && (
				<p className="text-muted-foreground mt-3 text-sm">
					{householdCount} household item{householdCount !== 1 ? 's' : ''} will
					be cleared from the list (not added to inventory).
				</p>
			)}

			<div className="mt-4 flex items-center justify-end gap-4">
				<button
					type="button"
					onClick={onCancel}
					disabled={isSubmitting}
					className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 disabled:opacity-50"
				>
					Cancel
				</button>
				<Button
					onClick={handleSubmit}
					size="sm"
					disabled={
						(selectedCount === 0 && householdCount === 0) || isSubmitting
					}
				>
					{isSubmitting ? (
						'Processing...'
					) : selectedCount === 0 && householdCount > 0 ? (
						<>Clear Household Items</>
					) : (
						<>Add {selectedCount} to Inventory</>
					)}
				</Button>
			</div>
		</div>
	)
}
