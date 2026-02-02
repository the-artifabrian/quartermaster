import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { invariantResponse } from '@epic-web/invariant'
import { parseWithZod } from '@conform-to/zod'
import { Link, useSearchParams } from 'react-router'
import {
	InventoryItemCard,
	InventoryItemGrid,
} from '#app/components/inventory-item-card.tsx'
import { InventoryQuickAdd } from '#app/components/inventory-quick-add.tsx'
import { InventoryLocationTabs } from '#app/components/inventory-location-tabs.tsx'
import { CommonIngredients } from '#app/components/common-ingredients.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { InventoryItemSchema } from '#app/utils/inventory-validation.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const url = new URL(request.url)
	const location = url.searchParams.get('location') ?? ''

	const items = await prisma.inventoryItem.findMany({
		where: {
			userId,
			...(location && location !== 'all' && { location }),
		},
		orderBy: [{ lowStock: 'desc' }, { expiresAt: 'asc' }, { name: 'asc' }],
	})

	return { items, selectedLocation: location || 'all' }
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'create') {
		const submission = parseWithZod(formData, { schema: InventoryItemSchema })
		if (submission.status !== 'success') {
			return { status: 'error' as const, submission: submission.reply() }
		}

		await prisma.inventoryItem.create({
			data: {
				...submission.value,
				userId,
			},
		})

		return { status: 'success' as const }
	}

	if (intent === 'delete') {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')

		const item = await prisma.inventoryItem.findFirst({
			where: { id: itemId, userId },
		})
		invariantResponse(item, 'Item not found', { status: 404 })

		await prisma.inventoryItem.delete({ where: { id: itemId } })

		return { status: 'success' as const }
	}

	if (intent === 'toggle-low-stock') {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')

		const item = await prisma.inventoryItem.findFirst({
			where: { id: itemId, userId },
		})
		invariantResponse(item, 'Item not found', { status: 404 })

		await prisma.inventoryItem.update({
			where: { id: itemId },
			data: { lowStock: !item.lowStock },
		})

		return { status: 'success' as const }
	}

	return { status: 'error' as const }
}

export default function InventoryIndex({ loaderData }: Route.ComponentProps) {
	const { items, selectedLocation } = loaderData
	const [searchParams] = useSearchParams()

	const pantryItems = items.filter((item) => item.location === 'pantry')
	const fridgeItems = items.filter((item) => item.location === 'fridge')
	const freezerItems = items.filter((item) => item.location === 'freezer')

	const displayItems =
		selectedLocation === 'all'
			? items
			: selectedLocation === 'pantry'
				? pantryItems
				: selectedLocation === 'fridge'
					? fridgeItems
					: freezerItems

	const showingLocation =
		selectedLocation === 'pantry'
			? 'pantry'
			: selectedLocation === 'fridge'
				? 'fridge'
				: selectedLocation === 'freezer'
					? 'freezer'
					: null

	return (
		<div className="container py-6 pb-20 md:pb-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between">
				<h1 className="text-2xl font-bold">My Inventory</h1>
				<Button asChild>
					<Link to="/inventory/new">
						<Icon name="plus" size="sm" />
						Add Item
					</Link>
				</Button>
			</div>

			{/* Location Tabs */}
			<div className="mb-6">
				<InventoryLocationTabs />
			</div>

			{/* Quick Add */}
			{showingLocation && (
				<div className="mb-6 space-y-4">
					<InventoryQuickAdd location={showingLocation} />
					<CommonIngredients location={showingLocation} />
				</div>
			)}

			{/* Items Grid */}
			{displayItems.length > 0 ? (
				<div className="space-y-8">
					{selectedLocation === 'all' ? (
						<>
							{pantryItems.length > 0 && (
								<section>
									<h2 className="mb-3 text-lg font-semibold">Pantry</h2>
									<InventoryItemGrid>
										{pantryItems.map((item) => (
											<InventoryItemCard key={item.id} item={item} />
										))}
									</InventoryItemGrid>
								</section>
							)}
							{fridgeItems.length > 0 && (
								<section>
									<h2 className="mb-3 text-lg font-semibold">Fridge</h2>
									<InventoryItemGrid>
										{fridgeItems.map((item) => (
											<InventoryItemCard key={item.id} item={item} />
										))}
									</InventoryItemGrid>
								</section>
							)}
							{freezerItems.length > 0 && (
								<section>
									<h2 className="mb-3 text-lg font-semibold">Freezer</h2>
									<InventoryItemGrid>
										{freezerItems.map((item) => (
											<InventoryItemCard key={item.id} item={item} />
										))}
									</InventoryItemGrid>
								</section>
							)}
						</>
					) : (
						<InventoryItemGrid>
							{displayItems.map((item) => (
								<InventoryItemCard key={item.id} item={item} />
							))}
						</InventoryItemGrid>
					)}
				</div>
			) : (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<Icon name="cookie" className="size-16 text-muted-foreground" />
					<h2 className="mt-4 text-xl font-semibold">
						{selectedLocation === 'all'
							? 'No items yet'
							: `No items in ${selectedLocation}`}
					</h2>
					<p className="mt-2 text-muted-foreground">
						Start tracking your inventory to see what you can make!
					</p>
					<Button asChild className="mt-6">
						<Link to="/inventory/new">
							<Icon name="plus" size="sm" />
							Add Your First Item
						</Link>
					</Button>
				</div>
			)}
		</div>
	)
}
