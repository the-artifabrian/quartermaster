import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { z } from 'zod'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useState } from 'react'
import { Link } from 'react-router'
import {
	InventoryItemCard,
	InventoryItemGrid,
} from '#app/components/inventory-item-card.tsx'
import { InventoryLocationTabs } from '#app/components/inventory-location-tabs.tsx'
import { InventoryQuickAdd } from '#app/components/inventory-quick-add.tsx'
import { PantryStaplesOnboarding } from '#app/components/pantry-staples-onboarding.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import {
	InventoryItemLocationSchema,
	InventoryItemNameSchema,
	InventoryItemSchema,
} from '#app/utils/inventory-validation.ts'
import { cn } from '#app/utils/misc.tsx'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'My Inventory | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireProTier(request)
	const url = new URL(request.url)
	const location = url.searchParams.get('location') ?? ''

	const now = new Date()
	const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
	const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

	// Single query for all items — filter by location in JS
	const allItems = await prisma.inventoryItem.findMany({
		where: { householdId },
		orderBy: [{ lowStock: 'desc' }, { expiresAt: 'asc' }, { name: 'asc' }],
	})

	const totalItemCount = allItems.length
	const items =
		location && location !== 'all'
			? allItems.filter((item) => item.location === location)
			: allItems

	const expiringSoonCount = allItems.filter(
		(item) =>
			item.expiresAt &&
			new Date(item.expiresAt) >= now &&
			new Date(item.expiresAt) <= sevenDaysFromNow,
	).length

	const lowStockCount = allItems.filter((item) => item.lowStock).length

	// Items expiring within 3 days for the urgent callout
	const urgentExpiringItems = allItems
		.filter(
			(item) =>
				item.expiresAt &&
				new Date(item.expiresAt) >= now &&
				new Date(item.expiresAt) <= threeDaysFromNow,
		)
		.map((item) => ({
			id: item.id,
			name: item.name,
			daysLeft: Math.max(
				0,
				Math.ceil(
					(new Date(item.expiresAt!).getTime() - now.getTime()) /
						(1000 * 60 * 60 * 24),
				),
			),
		}))

	return {
		items,
		totalItemCount,
		selectedLocation: location || 'all',
		expiringSoonCount,
		lowStockCount,
		urgentExpiringItems,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireProTier(request)
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
				householdId,
			},
		})

		void emitHouseholdEvent({
			type: 'inventory_item_added',
			payload: {
				name: submission.value.name,
				location: submission.value.location,
			},
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'bulk-create') {
		const itemsJson = formData.get('items')
		invariantResponse(typeof itemsJson === 'string', 'Items are required')

		const BulkCreateSchema = z
			.array(
				z.object({
					name: InventoryItemNameSchema,
					location: InventoryItemLocationSchema,
				}),
			)
			.min(1)
			.max(200)

		let json: unknown
		try {
			json = JSON.parse(itemsJson)
		} catch {
			return { status: 'error' as const }
		}
		const parsed = BulkCreateSchema.safeParse(json)
		if (!parsed.success) {
			return { status: 'error' as const }
		}
		const items = parsed.data

		await prisma.$transaction(
			items.map((item) =>
				prisma.inventoryItem.create({
					data: {
						name: item.name,
						location: item.location,
						userId,
						householdId,
					},
				}),
			),
		)

		const location = items[0]?.location ?? 'pantry'
		void emitHouseholdEvent({
			type: 'inventory_items_bulk_added',
			payload: { count: items.length, location },
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'delete') {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')

		const item = await prisma.inventoryItem.findFirst({
			where: { id: itemId, householdId },
		})
		invariantResponse(item, 'Item not found', { status: 404 })

		await prisma.inventoryItem.delete({ where: { id: itemId } })

		void emitHouseholdEvent({
			type: 'inventory_item_deleted',
			payload: { name: item.name },
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'toggle-low-stock') {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')

		const item = await prisma.inventoryItem.findFirst({
			where: { id: itemId, householdId },
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
	const {
		items,
		totalItemCount,
		selectedLocation,
		expiringSoonCount,
		lowStockCount,
		urgentExpiringItems,
	} = loaderData

	const [search, setSearch] = useState('')

	if (totalItemCount === 0) {
		return (
			<div className="container py-6 pb-20 md:pb-6">
				<PantryStaplesOnboarding />
			</div>
		)
	}

	const filteredItems = search
		? items.filter((item) =>
				item.name.toLowerCase().includes(search.toLowerCase()),
			)
		: items

	const pantryItems = filteredItems.filter((item) => item.location === 'pantry')
	const fridgeItems = filteredItems.filter((item) => item.location === 'fridge')
	const freezerItems = filteredItems.filter(
		(item) => item.location === 'freezer',
	)

	const displayItems =
		selectedLocation === 'all'
			? filteredItems
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
		<div className="pb-20 md:pb-6">
			{/* Page Header */}
			<div className="from-card to-background border-border/50 border-b bg-linear-to-b">
				<div className="container flex items-center justify-between py-4">
					<h1 className="text-2xl font-bold">
						My Inventory{' '}
						<span className="text-muted-foreground text-base font-normal">
							{search
								? `(${filteredItems.length} of ${items.length})`
								: `(${items.length})`}
						</span>
					</h1>
					<Button asChild>
						<Link to="/inventory/new">
							<Icon name="plus" size="sm" />
							Add Item
						</Link>
					</Button>
				</div>
			</div>

			<div className="container py-6">
				{/* Dashboard Summary Strip */}
				<div className="mb-6 flex gap-3 pb-1">
					<div
						className={cn(
							'bg-card flex flex-1 flex-col items-center rounded-xl border p-3 text-center',
							expiringSoonCount > 0 && 'border-amber-200 dark:border-amber-800',
						)}
					>
						<span
							className={cn(
								'text-2xl font-bold',
								expiringSoonCount > 0
									? 'text-amber-600 dark:text-amber-400'
									: 'text-foreground',
							)}
						>
							{expiringSoonCount}
						</span>
						<span className="text-muted-foreground text-xs">Expiring Soon</span>
					</div>
					<div
						className={cn(
							'bg-card flex flex-1 flex-col items-center rounded-xl border p-3 text-center',
							lowStockCount > 0 && 'border-amber-200 dark:border-amber-800',
						)}
					>
						<span
							className={cn(
								'text-2xl font-bold',
								lowStockCount > 0
									? 'text-amber-600 dark:text-amber-400'
									: 'text-foreground',
							)}
						>
							{lowStockCount}
						</span>
						<span className="text-muted-foreground text-xs">Low Stock</span>
					</div>
					<div className="bg-card flex flex-1 flex-col items-center rounded-xl border p-3 text-center">
						<span className="text-2xl font-bold">{totalItemCount}</span>
						<span className="text-muted-foreground text-xs">Total Items</span>
					</div>
				</div>

				{/* Urgent Expiring Items Callout */}
				{urgentExpiringItems.length > 0 && (
					<div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
						<div className="mb-2 flex items-center gap-2">
							<Icon
								name="clock"
								className="size-5 text-amber-600 dark:text-amber-400"
							/>
							<h2 className="font-semibold text-amber-900 dark:text-amber-200">
								Use these up soon
							</h2>
						</div>
						<ul className="mb-3 space-y-1">
							{urgentExpiringItems.map((item) => (
								<li
									key={item.id}
									className="text-sm text-amber-800 dark:text-amber-300"
								>
									<span className="font-medium">{item.name}</span>
									<span className="text-amber-600 dark:text-amber-400">
										{' — '}
										{item.daysLeft === 0
											? 'expires today'
											: item.daysLeft === 1
												? 'expires tomorrow'
												: `${item.daysLeft} days left`}
									</span>
								</li>
							))}
						</ul>
						<Button
							asChild
							size="sm"
							variant="outline"
							className="border-amber-300 bg-amber-100/50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
						>
							<Link to="/recipes">
								<Icon name="cookie" size="sm" />
								Find recipes to use these
							</Link>
						</Button>
					</div>
				)}

				{/* Search */}
				<div className="relative mb-6">
					<Icon
						name="magnifying-glass"
						size="sm"
						className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
					/>
					<Input
						type="search"
						placeholder="Search inventory..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="pl-9"
					/>
				</div>

				{/* Location Tabs */}
				<div className="mb-6">
					<InventoryLocationTabs />
				</div>

				{/* Quick Add */}
				{showingLocation && (
					<div className="mb-6">
						<InventoryQuickAdd location={showingLocation} />
					</div>
				)}

				{/* Items Grid */}
				{displayItems.length > 0 ? (
					<div className="space-y-8">
						{selectedLocation === 'all' ? (
							<>
								{pantryItems.length > 0 && (
									<section className="rounded-xl bg-amber-50/30 p-4 dark:bg-amber-950/20">
										<h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
											<span className="inline-block size-2.5 rounded-full bg-amber-500" />
											Pantry
											<span className="text-muted-foreground ml-1 text-sm font-normal">
												({pantryItems.length})
											</span>
										</h2>
										<InventoryItemGrid>
											{pantryItems.map((item) => (
												<InventoryItemCard
													key={item.id}
													item={item}
													showLocation={false}
												/>
											))}
										</InventoryItemGrid>
									</section>
								)}
								{fridgeItems.length > 0 && (
									<section className="rounded-xl bg-blue-50/30 p-4 dark:bg-blue-950/20">
										<h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
											<span className="inline-block size-2.5 rounded-full bg-blue-500" />
											Fridge
											<span className="text-muted-foreground ml-1 text-sm font-normal">
												({fridgeItems.length})
											</span>
										</h2>
										<InventoryItemGrid>
											{fridgeItems.map((item) => (
												<InventoryItemCard
													key={item.id}
													item={item}
													showLocation={false}
												/>
											))}
										</InventoryItemGrid>
									</section>
								)}
								{freezerItems.length > 0 && (
									<section className="rounded-xl bg-cyan-50/30 p-4 dark:bg-cyan-950/20">
										<h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
											<span className="inline-block size-2.5 rounded-full bg-cyan-500" />
											Freezer
											<span className="text-muted-foreground ml-1 text-sm font-normal">
												({freezerItems.length})
											</span>
										</h2>
										<InventoryItemGrid>
											{freezerItems.map((item) => (
												<InventoryItemCard
													key={item.id}
													item={item}
													showLocation={false}
												/>
											))}
										</InventoryItemGrid>
									</section>
								)}
							</>
						) : (
							<InventoryItemGrid>
								{displayItems.map((item) => (
									<InventoryItemCard
										key={item.id}
										item={item}
										showLocation={false}
									/>
								))}
							</InventoryItemGrid>
						)}
					</div>
				) : search ? (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<div className="bg-accent/10 flex size-20 items-center justify-center rounded-2xl">
							<Icon
								name="magnifying-glass"
								className="text-accent/50 size-10"
							/>
						</div>
						<h2 className="mt-4 font-serif text-xl font-semibold">
							No items matching &ldquo;{search}&rdquo;
						</h2>
						<p className="text-muted-foreground mt-2 max-w-sm">
							Try a different search term.
						</p>
						<Button
							variant="outline"
							className="mt-4"
							onClick={() => setSearch('')}
						>
							Clear Search
						</Button>
					</div>
				) : (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<div className="bg-accent/10 flex size-20 items-center justify-center rounded-2xl">
							<Icon name="file-text" className="text-accent/50 size-10" />
						</div>
						<h2 className="mt-4 font-serif text-xl font-semibold">
							Nothing here yet
						</h2>
						<p className="text-muted-foreground mt-2 max-w-sm">
							{selectedLocation === 'all'
								? 'Start tracking your pantry, fridge, and freezer items to discover what you can cook.'
								: `Your ${selectedLocation} is empty. Add items to start tracking.`}
						</p>
						<Button asChild className="mt-6">
							<Link to="/inventory/new">
								<Icon name="plus" size="sm" />
								Add Item
							</Link>
						</Button>
					</div>
				)}
			</div>
		</div>
	)
}
