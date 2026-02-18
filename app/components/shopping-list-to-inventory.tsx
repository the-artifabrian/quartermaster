import { type ShoppingListItem } from '@prisma/client'
import { useState } from 'react'
import { useFetcher } from 'react-router'
import { categoryToLocation } from '#app/utils/category-location-map.ts'
import { LOCATION_LABELS } from '#app/utils/inventory-validation.ts'
import { cn } from '#app/utils/misc.tsx'
import { suggestExpiryDate } from '#app/utils/shelf-life.ts'
import { Button } from './ui/button.tsx'
import { Checkbox } from './ui/checkbox.tsx'
import { Icon } from './ui/icon.tsx'

const locationBadgeColors: Record<string, string> = {
	pantry: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200',
	fridge: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200',
	freezer: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-200',
}

type InventoryReviewItem = {
	id: string
	name: string
	quantity: string | null
	unit: string | null
	location: 'pantry' | 'fridge' | 'freezer'
	expiresAt: string | null
	included: boolean
}

function formatShortDate(dateStr: string): string {
	const date = new Date(dateStr + 'T12:00:00')
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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

	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

	const selectedCount = reviewItems.filter((i) => i.included).length
	const allSelected = reviewItems.length > 0 && selectedCount === reviewItems.length

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

	function toggleExpanded(id: string) {
		setExpandedIds((prev) => {
			const next = new Set(prev)
			if (next.has(id)) {
				next.delete(id)
			} else {
				next.add(id)
			}
			return next
		})
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
			prev.map((item) => (item.id === id ? { ...item, expiresAt } : item)),
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
		formData.set('items', JSON.stringify(allItems))
		void fetcher.submit(formData, { method: 'POST', action: '/resources/shopping-to-inventory' })
	}

	return (
		<div className="bg-muted/50 rounded-xl border p-5">
			<div className="mb-4">
				<h3 className="flex items-center gap-2 text-lg font-semibold">
					<Icon name="plus" className="size-5" />
					Add to Inventory
				</h3>
				<p className="text-muted-foreground mt-1 text-sm">
					Tap a row to adjust storage or expiry. Defaults are usually right.
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
							{allSelected ? 'Deselect All' : 'Select All'}
						</button>
						<span className="text-muted-foreground text-xs">
							{selectedCount}/{reviewItems.length} selected
						</span>
					</div>

					<div className="space-y-1">
						{reviewItems.map((item) => {
							const isExpanded = expandedIds.has(item.id)
							return (
								<div
									key={item.id}
									className="bg-background rounded-lg"
								>
									{/* Compact row */}
									<div
										className="flex cursor-pointer items-center gap-3 px-3 py-2.5"
										onClick={() => toggleExpanded(item.id)}
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
										<span
											className={cn(
												'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
												locationBadgeColors[item.location] ??
													'bg-muted text-muted-foreground',
											)}
										>
											{LOCATION_LABELS[item.location as keyof typeof LOCATION_LABELS]}
										</span>
										{item.expiresAt && (
											<span className="text-muted-foreground shrink-0 text-xs">
												{formatShortDate(item.expiresAt)}
											</span>
										)}
										<Icon
											name="chevron-down"
											size="sm"
											className={cn(
												'text-muted-foreground shrink-0 transition-transform',
												isExpanded && 'rotate-180',
											)}
										/>
									</div>

									{/* Expanded controls */}
									{isExpanded && (
										<div className="flex flex-wrap items-center gap-3 border-t px-3 py-2.5">
											<div className="flex items-center gap-2">
												<label className="text-muted-foreground text-xs">
													Location
												</label>
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
											</div>
											<div className="flex items-center gap-2">
												<label className="text-muted-foreground text-xs">
													Expires
												</label>
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
										</div>
									)}
								</div>
							)
						})}
					</div>
				</>
			)}

			{householdCount > 0 && (
				<p className="text-muted-foreground mt-3 text-sm">
					{householdCount} household item{householdCount !== 1 ? 's' : ''} will
					be cleared from the list (not added to inventory).
				</p>
			)}

			<div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
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
							Add {selectedCount} to Inventory
						</>
					)}
				</Button>
			</div>
		</div>
	)
}
