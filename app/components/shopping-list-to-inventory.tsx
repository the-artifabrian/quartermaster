import { type ShoppingListItem } from '@prisma/client'
import { useState } from 'react'
import { useFetcher } from 'react-router'
import { categoryToLocation } from '#app/utils/category-location-map.ts'
import { suggestExpiryDate } from '#app/utils/shelf-life.ts'
import { Button } from './ui/button.tsx'
import { Checkbox } from './ui/checkbox.tsx'
import { Icon } from './ui/icon.tsx'

type InventoryReviewItem = {
	id: string
	name: string
	quantity: string | null
	unit: string | null
	location: 'pantry' | 'fridge' | 'freezer'
	expiresAt: string | null
	included: boolean
}

export function ShoppingListToInventory({
	items,
	onCancel,
}: {
	items: ShoppingListItem[]
	onCancel: () => void
}) {
	const fetcher = useFetcher()
	const isSubmitting = fetcher.state !== 'idle'

	// Separate household items — they won't become inventory
	const foodItems = items.filter((item) => item.category !== 'household')
	const householdCount = items.length - foodItems.length

	const [reviewItems, setReviewItems] = useState<InventoryReviewItem[]>(() =>
		foodItems.map((item) => {
			const location = categoryToLocation(item.category ?? 'other')
			return {
				id: item.id,
				name: item.name,
				quantity: item.quantity,
				unit: item.unit,
				location,
				expiresAt: suggestExpiryDate(item.name, location),
				included: true,
			}
		}),
	)

	const selectedCount = reviewItems.filter((i) => i.included).length

	function handleToggle(id: string) {
		setReviewItems((prev) =>
			prev.map((item) =>
				item.id === id ? { ...item, included: !item.included } : item,
			),
		)
	}

	function handleLocationChange(
		id: string,
		location: 'pantry' | 'fridge' | 'freezer',
	) {
		setReviewItems((prev) =>
			prev.map((item) =>
				item.id === id
					? {
							...item,
							location,
							expiresAt: suggestExpiryDate(item.name, location),
						}
					: item,
			),
		)
	}

	function handleExpiryChange(id: string, expiresAt: string | null) {
		setReviewItems((prev) =>
			prev.map((item) =>
				item.id === id ? { ...item, expiresAt } : item,
			),
		)
	}

	function handleSubmit() {
		const selected = reviewItems
			.filter((i) => i.included)
			.map((i) => ({
				itemId: i.id,
				location: i.location,
				expiresAt: i.expiresAt || null,
			}))
		// Include household items too — server will clear them but skip inventory creation
		const householdItemEntries = items
			.filter((item) => item.category === 'household')
			.map((item) => ({ itemId: item.id, location: 'pantry', expiresAt: null }))
		const allItems = [...selected, ...householdItemEntries]
		if (allItems.length === 0) return

		const formData = new FormData()
		formData.set('intent', 'add-to-inventory')
		formData.set('items', JSON.stringify(allItems))
		void fetcher.submit(formData, { method: 'POST' })
	}

	return (
		<div className="bg-muted/50 rounded-xl border p-5">
			<div className="mb-4">
				<h3 className="flex items-center gap-2 text-lg font-semibold">
					<Icon name="plus" className="size-5" />
					Add to Inventory
				</h3>
				<p className="text-muted-foreground mt-1 text-sm">
					Review items and adjust storage locations before adding.
				</p>
			</div>

			{reviewItems.length > 0 && (
				<div className="space-y-2">
					{reviewItems.map((item) => (
						<div
							key={item.id}
							className="bg-background flex flex-wrap items-center gap-3 rounded-lg px-3 py-2.5"
						>
							<Checkbox
								checked={item.included}
								onCheckedChange={() => handleToggle(item.id)}
							/>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">{item.name}</p>
								{(item.quantity || item.unit) && (
									<p className="text-muted-foreground text-xs">
										{item.quantity} {item.unit}
									</p>
								)}
							</div>
							<select
								value={item.location}
								onChange={(e) =>
									handleLocationChange(
										item.id,
										e.target.value as 'pantry' | 'fridge' | 'freezer',
									)
								}
								className="bg-muted rounded-md border px-2 py-1 text-sm"
							>
								<option value="pantry">Pantry</option>
								<option value="fridge">Fridge</option>
								<option value="freezer">Freezer</option>
							</select>
							<input
								type="date"
								value={item.expiresAt ?? ''}
								onChange={(e) =>
									handleExpiryChange(
										item.id,
										e.target.value || null,
									)
								}
								className="bg-muted w-[130px] rounded-md border px-2 py-1 text-sm"
								aria-label={`Expiry date for ${item.name}`}
							/>
						</div>
					))}
				</div>
			)}

			{householdCount > 0 && (
				<p className="text-muted-foreground mt-3 text-sm">
					{householdCount} household item{householdCount !== 1 ? 's' : ''} will
					be cleared from the list (not added to inventory).
				</p>
			)}

			<div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
				<p className="text-muted-foreground text-sm">
					{selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
				</p>
				<div className="flex gap-3">
					<Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
						Cancel
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={
							(selectedCount === 0 && householdCount === 0) || isSubmitting
						}
					>
						{isSubmitting ? (
							'Processing...'
						) : selectedCount === 0 && householdCount > 0 ? (
							<>
								<Icon name="trash" size="sm" />
								Clear Household Items
							</>
						) : (
							<>
								<Icon name="plus" size="sm" />
								Add to Inventory
							</>
						)}
					</Button>
				</div>
			</div>
		</div>
	)
}
