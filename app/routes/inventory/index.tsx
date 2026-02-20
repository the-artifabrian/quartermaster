import { type InventoryItem } from '@prisma/client'
import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { z } from 'zod'
import { InventoryItemCard } from '#app/components/inventory-item-card.tsx'
import { InventoryLocationTabs } from '#app/components/inventory-location-tabs.tsx'
import { InventoryQuickAdd } from '#app/components/inventory-quick-add.tsx'
import { PantryStaplesOnboarding } from '#app/components/pantry-staples-onboarding.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	getWeekStart,
	getNextWeek,
	serializeDate,
	MEAL_TYPE_LABELS,
	type MealType,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	findMatchingInventoryItem,
	buildMergeData,
} from '#app/utils/inventory-dedup.server.ts'
import {
	InventoryItemLocationSchema,
	InventoryItemNameSchema,
	InventoryItemSchema,
} from '#app/utils/inventory-validation.ts'
import { cn } from '#app/utils/misc.tsx'
import { ingredientMatchesInventoryItem } from '#app/utils/recipe-matching.server.ts'
import {
	getInventoryUsage,
	getUserTier,
} from '#app/utils/subscription.server.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'My Inventory | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const { isProActive } = await getUserTier(userId)
	const inventoryUsage = await getInventoryUsage(householdId, isProActive)
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
	const expiringRaw = allItems.filter(
		(item) =>
			item.expiresAt &&
			new Date(item.expiresAt) >= now &&
			new Date(item.expiresAt) <= threeDaysFromNow,
	)

	// Load upcoming uncooked meal plan entries to detect coverage
	const weekStart = getWeekStart(now)
	const twoWeeksEnd = getNextWeek(getNextWeek(weekStart))
	const upcomingEntries = await prisma.mealPlanEntry.findMany({
		where: {
			cooked: false,
			date: { gte: weekStart, lt: twoWeeksEnd },
			mealPlan: { householdId },
		},
		include: {
			recipe: {
				select: {
					title: true,
					ingredients: {
						where: { isHeading: false },
						select: { name: true },
					},
				},
			},
		},
	})

	const urgentExpiringItems = expiringRaw.map((item) => {
		// Check if any upcoming recipe ingredient matches this expiring item
		let coveredBy: {
			recipeTitle: string
			date: string
			mealType: string
		} | null = null

		for (const entry of upcomingEntries) {
			const matches = entry.recipe.ingredients.some((ing) =>
				ingredientMatchesInventoryItem(ing, item),
			)
			if (matches) {
				coveredBy = {
					recipeTitle: entry.recipe.title,
					date: serializeDate(new Date(entry.date)),
					mealType: entry.mealType,
				}
				break
			}
		}

		return {
			id: item.id,
			name: item.name,
			expiresAt: item.expiresAt
				? serializeDate(new Date(item.expiresAt))
				: null,
			daysLeft: Math.max(
				0,
				Math.ceil(
					(new Date(item.expiresAt!).getTime() - now.getTime()) /
						(1000 * 60 * 60 * 24),
				),
			),
			coveredBy,
		}
	})

	return {
		items,
		totalItemCount,
		selectedLocation: location || 'all',
		expiringSoonCount,
		lowStockCount,
		urgentExpiringItems,
		inventoryUsage,
		isProActive,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const { isProActive } = await getUserTier(userId)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'create') {
		const usage = await getInventoryUsage(householdId, isProActive)
		if (usage.isAtLimit) {
			return { status: 'error' as const, message: 'Free plan limit reached' }
		}

		const submission = parseWithZod(formData, { schema: InventoryItemSchema })
		if (submission.status !== 'success') {
			return { status: 'error' as const, submission: submission.reply() }
		}

		const force = formData.get('force')

		// Check for duplicates unless force is set
		if (!force) {
			const existingItems = await prisma.inventoryItem.findMany({
				where: { householdId, location: submission.value.location },
			})
			const match = findMatchingInventoryItem(
				submission.value.name,
				submission.value.location,
				existingItems,
			)
			if (match) {
				return {
					status: 'duplicate_warning' as const,
					existingItem: {
						id: match.id,
						name: match.name,
						location: match.location,
						quantity: match.quantity,
						unit: match.unit,
					},
				}
			}
		}

		if (force === 'merge') {
			// Find the existing item and merge into it
			const existingItems = await prisma.inventoryItem.findMany({
				where: { householdId, location: submission.value.location },
			})
			const match = findMatchingInventoryItem(
				submission.value.name,
				submission.value.location,
				existingItems,
			)
			if (match) {
				const mergeData = buildMergeData(
					match,
					submission.value.quantity,
					submission.value.unit,
					submission.value.expiresAt,
				)
				if (Object.keys(mergeData).length > 0) {
					await prisma.inventoryItem.update({
						where: { id: match.id },
						data: mergeData,
					})
				}
				return { status: 'merged' as const, mergedInto: match.name }
			}
		}

		// force === 'add' or no duplicate found — create normally
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
		const usage = await getInventoryUsage(householdId, isProActive)
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
		// Truncate to remaining slots for free users
		const items =
			usage.remaining !== null
				? parsed.data.slice(0, usage.remaining)
				: parsed.data

		if (items.length === 0) {
			return { status: 'error' as const, message: 'Free plan limit reached' }
		}

		// Load existing items for dedup; track in-place for intra-batch dedup
		const existingItems = await prisma.inventoryItem.findMany({
			where: { householdId },
		})
		const trackingItems = [...existingItems]

		const toCreate: typeof items = []
		let skippedCount = 0

		for (const item of items) {
			const match = findMatchingInventoryItem(
				item.name,
				item.location,
				trackingItems,
			)
			if (match) {
				skippedCount++
			} else {
				toCreate.push(item)
				// Add to tracking so subsequent items in the batch can detect it
				trackingItems.push({
					id: `pending-${toCreate.length}`,
					name: item.name,
					location: item.location,
					quantity: null,
					unit: null,
					expiresAt: null,
					lowStock: false,
					userId,
					householdId,
					createdAt: new Date(),
					updatedAt: new Date(),
				})
			}
		}

		if (toCreate.length > 0) {
			await prisma.$transaction(
				toCreate.map((item) =>
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
		}

		const location = items[0]?.location ?? 'pantry'
		if (toCreate.length > 0) {
			void emitHouseholdEvent({
				type: 'inventory_items_bulk_added',
				payload: { count: toCreate.length, location },
				userId,
				householdId,
			})
		}

		return {
			status: 'success' as const,
			createdCount: toCreate.length,
			skippedCount,
		}
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

	if (intent === 'quick-update') {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')

		const item = await prisma.inventoryItem.findFirst({
			where: { id: itemId, householdId },
		})
		invariantResponse(item, 'Item not found', { status: 404 })

		const data: Record<string, unknown> = {}

		if (formData.has('quantity')) {
			const raw = formData.get('quantity')
			data.quantity =
				typeof raw === 'string' && raw.trim() ? parseFloat(raw) || null : null
		}
		if (formData.has('unit')) {
			const raw = formData.get('unit')
			data.unit = typeof raw === 'string' && raw.trim() ? raw.trim() : null
		}
		if (formData.has('expiresAt')) {
			const raw = formData.get('expiresAt')
			data.expiresAt =
				typeof raw === 'string' && raw.trim() ? new Date(raw) : null
		}

		if (Object.keys(data).length > 0) {
			await prisma.inventoryItem.update({
				where: { id: itemId },
				data,
			})

			void emitHouseholdEvent({
				type: 'inventory_item_updated',
				payload: { name: item.name },
				userId,
				householdId,
			})
		}

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

		void emitHouseholdEvent({
			type: 'inventory_item_low_stock_toggled',
			payload: { name: item.name, lowStock: !item.lowStock },
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	return { status: 'error' as const }
}

const SEARCH_THRESHOLD = 15

export default function InventoryIndex({ loaderData }: Route.ComponentProps) {
	const {
		items,
		totalItemCount,
		selectedLocation,
		expiringSoonCount,
		lowStockCount,
		urgentExpiringItems,
		inventoryUsage,
	} = loaderData

	const [search, setSearch] = useState('')
	const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

	// Load dismissed IDs from localStorage on mount
	useEffect(() => {
		const dismissed = new Set<string>()
		for (const item of urgentExpiringItems) {
			const key = `dismissed-expiring-${item.id}-${item.expiresAt}`
			if (localStorage.getItem(key) === 'true') {
				dismissed.add(item.id)
			}
		}
		if (dismissed.size > 0) setDismissedIds(dismissed)
	}, [urgentExpiringItems])

	if (totalItemCount === 0) {
		return (
			<div className="container-content py-6 pb-20 md:pb-6">
				<PantryStaplesOnboarding maxItems={inventoryUsage.limit ?? undefined} />
			</div>
		)
	}

	const filteredItems = search
		? items.filter((item) =>
				item.name.toLowerCase().includes(search.toLowerCase()),
			)
		: items

	const showingLocation =
		selectedLocation === 'pantry'
			? 'pantry'
			: selectedLocation === 'fridge'
				? 'fridge'
				: selectedLocation === 'freezer'
					? 'freezer'
					: null

	const showSearch = totalItemCount >= SEARCH_THRESHOLD

	return (
		<div className="pb-20 md:pb-6">
			{/* Page Header */}
			<div className="container-content flex items-center justify-between gap-3 py-3 md:py-4">
				<div>
					<h1 className="font-serif text-2xl font-normal">Inventory</h1>
					{/* Status line */}
					{(expiringSoonCount > 0 ||
						lowStockCount > 0 ||
						inventoryUsage.limit !== null) && (
						<p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
							{expiringSoonCount > 0 && (
								<span className="text-amber-600 dark:text-amber-400">
									{expiringSoonCount} expiring soon
								</span>
							)}
							{expiringSoonCount > 0 && lowStockCount > 0 && (
								<span className="text-muted-foreground/40">·</span>
							)}
							{lowStockCount > 0 && (
								<span className="text-amber-600 dark:text-amber-400">
									{lowStockCount} low stock
								</span>
							)}
							{(expiringSoonCount > 0 || lowStockCount > 0) &&
								inventoryUsage.limit !== null && (
									<span className="text-muted-foreground/40">·</span>
								)}
							{inventoryUsage.limit !== null && (
								<span
									className={cn(
										inventoryUsage.isAtLimit
											? 'text-amber-600 dark:text-amber-400'
											: '',
									)}
								>
									{inventoryUsage.count}/{inventoryUsage.limit} free items
								</span>
							)}
						</p>
					)}
				</div>
				{inventoryUsage.isAtLimit ? (
					<Button asChild size="sm">
						<Link to="/upgrade">Upgrade</Link>
					</Button>
				) : (
					<Button
						asChild
						className="size-10 rounded-full p-0 sm:h-auto sm:w-auto sm:rounded-lg sm:px-4 sm:py-2"
					>
						<Link to="/inventory/new">
							<Icon name="plus" size="sm" />
							<span className="hidden sm:inline">Add Item</span>
						</Link>
					</Button>
				)}
			</div>

			<div className="container-content py-2">
				{/* Free plan limit banner */}
				{inventoryUsage.isAtLimit && (
					<div className="mb-6 flex flex-col gap-3 rounded-lg bg-accent/8 p-4 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<p className="text-[0.75rem] font-medium tracking-[0.08em] uppercase text-accent">
								Free plan limit reached
							</p>
							<p className="mt-1 text-sm text-muted-foreground">
								Upgrade to Pro for unlimited inventory, meal planning, and
								shopping lists.
							</p>
						</div>
						<Button asChild size="sm" className="shrink-0">
							<Link to="/upgrade">Upgrade to Pro</Link>
						</Button>
					</div>
				)}

				{/* Urgent Expiring Items Callout */}
				<ExpiringItemsCallout
					items={urgentExpiringItems}
					dismissedIds={dismissedIds}
					onDismiss={(item) => {
						const key = `dismissed-expiring-${item.id}-${item.expiresAt}`
						localStorage.setItem(key, 'true')
						setDismissedIds((prev) => new Set(prev).add(item.id))
					}}
				/>

				{/* Search + Location Tabs */}
				<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<InventoryLocationTabs />
					{showSearch && (
						<div className="relative sm:w-56">
							<Icon
								name="magnifying-glass"
								size="sm"
								className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
							/>
							<input
								type="search"
								placeholder="Search inventory..."
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="h-9 w-full rounded-full border border-border/50 bg-secondary/50 pl-9 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/30 focus:ring-1 focus:ring-primary/20"
							/>
						</div>
					)}
				</div>

				{/* Quick Add — shown when a specific location is selected */}
				{showingLocation && !inventoryUsage.isAtLimit && (
					<div className="mb-2">
						<InventoryQuickAdd location={showingLocation} />
					</div>
				)}

				{/* Items List */}
				{filteredItems.length > 0 ? (
					selectedLocation === 'all' ? (
						/* All tab: grouped by location with section headers */
						<AllTabGrouped items={filteredItems} />
					) : (
						/* Single location: items with lightweight header */
						<div>
							<LocationSectionHeader
								location={selectedLocation}
								count={filteredItems.length}
								isFirst
							/>
							<div className="divide-y divide-border/40">
								{filteredItems.map((item) => (
									<InventoryItemCard
										key={item.id}
										item={item}
									/>
								))}
							</div>
						</div>
					)
				) : search ? (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<div className="mx-auto flex size-16 items-center justify-center rounded-full border-2 border-dashed border-border">
							<Icon
								name="magnifying-glass"
								className="size-6 text-muted-foreground"
							/>
						</div>
						<h2 className="mt-4 font-serif text-xl font-normal">
							No items matching &ldquo;{search}&rdquo;
						</h2>
						<p className="mt-2 max-w-sm text-muted-foreground">
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
						<div className="mx-auto flex size-16 items-center justify-center rounded-full border-2 border-dashed border-border">
							<Icon
								name="file-text"
								className="size-6 text-muted-foreground"
							/>
						</div>
						<h2 className="mt-4 font-serif text-xl font-normal">
							Nothing here yet
						</h2>
						<p className="mt-2 max-w-sm text-muted-foreground">
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

const locationDotColors: Record<string, string> = {
	pantry: 'bg-amber-500',
	fridge: 'bg-blue-500',
	freezer: 'bg-cyan-500',
}

const locationLabels: Record<string, string> = {
	pantry: 'Pantry',
	fridge: 'Fridge',
	freezer: 'Freezer',
}

function LocationSectionHeader({
	location,
	count,
	isFirst = false,
}: {
	location: string
	count: number
	isFirst?: boolean
}) {
	return (
		<div className={cn('pb-3', isFirst ? 'pt-1' : 'pt-8')}>
			<div className="flex items-center gap-2">
				<span
					className={cn(
						'size-2 rounded-full',
						locationDotColors[location] ?? 'bg-muted-foreground',
					)}
				/>
				<span className="text-[0.75rem] font-medium tracking-[0.08em] uppercase text-muted-foreground">
					{locationLabels[location] ?? location}
				</span>
				<span className="text-[0.75rem] text-muted-foreground">({count})</span>
			</div>
		</div>
	)
}

const LOCATION_ORDER = ['pantry', 'fridge', 'freezer'] as const

function AllTabGrouped({ items }: { items: InventoryItem[] }) {
	const firstLocation = LOCATION_ORDER.find((loc) =>
		items.some((item) => item.location === loc),
	)
	return (
		<div>
			{LOCATION_ORDER.map((loc) => {
				const locItems = items.filter((item) => item.location === loc)
				if (locItems.length === 0) return null
				return (
					<div key={loc}>
						<LocationSectionHeader
							location={loc}
							count={locItems.length}
							isFirst={loc === firstLocation}
						/>
						<div className="divide-y divide-border/40">
							{locItems.map((item) => (
								<InventoryItemCard key={item.id} item={item} />
							))}
						</div>
					</div>
				)
			})}
		</div>
	)
}

type ExpiringItem = {
	id: string
	name: string
	expiresAt: string | null
	daysLeft: number
	coveredBy: {
		recipeTitle: string
		date: string
		mealType: string
	} | null
}

function formatCoverageDay(dateStr: string): string {
	const date = new Date(dateStr + 'T12:00:00') // avoid timezone issues
	const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
	return days[date.getDay()] ?? dateStr
}

function ExpiringItemsCallout({
	items,
	dismissedIds,
	onDismiss,
}: {
	items: ExpiringItem[]
	dismissedIds: Set<string>
	onDismiss: (item: ExpiringItem) => void
}) {
	const visible = items.filter((item) => !dismissedIds.has(item.id))
	if (visible.length === 0) return null

	const uncovered = visible.filter((item) => !item.coveredBy)
	const covered = visible.filter((item) => item.coveredBy)

	return (
		<div className="mb-6 rounded-lg bg-accent/8 p-4">
			<h2 className="mb-2 text-[0.75rem] font-medium tracking-[0.08em] uppercase text-accent">
				Use these up soon
			</h2>

			{/* Uncovered items — prominent */}
			{uncovered.length > 0 && (
				<ul className="mb-3 space-y-1">
					{uncovered.map((item) => (
						<li
							key={item.id}
							className="flex items-center gap-2 text-sm"
						>
							<span className="min-w-0 flex-1">
								<span className="font-medium">{item.name}</span>
								<span className="text-muted-foreground">
									{' — '}
									{item.daysLeft === 0
										? 'expires today'
										: item.daysLeft === 1
											? 'expires tomorrow'
											: `${item.daysLeft} days left`}
								</span>
							</span>
							<button
								type="button"
								onClick={() => onDismiss(item)}
								className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
								aria-label={`Dismiss ${item.name}`}
							>
								<Icon name="cross-1" size="xs" />
							</button>
						</li>
					))}
				</ul>
			)}

			{/* "Find recipes" CTA — only show if there are uncovered items */}
			{uncovered.length > 0 && (
				<Link
					to="/recipes"
					className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
				>
					<Icon name="cookie" size="sm" />
					Find recipes to use these
				</Link>
			)}

			{/* Covered items — muted */}
			{covered.length > 0 && (
				<ul className="space-y-1">
					{covered.map((item) => (
						<li
							key={item.id}
							className="flex items-center gap-2 text-sm text-muted-foreground"
						>
							<span className="min-w-0 flex-1">
								<span className="font-medium">{item.name}</span>
								<span>
									{' — in '}
									{item.coveredBy!.recipeTitle}
									{' on '}
									{formatCoverageDay(item.coveredBy!.date)}
									{' ('}
									{MEAL_TYPE_LABELS[
										item.coveredBy!.mealType as MealType
									]?.toLowerCase() ?? item.coveredBy!.mealType}
									{')'}
								</span>
							</span>
							<button
								type="button"
								onClick={() => onDismiss(item)}
								className="shrink-0 rounded-md p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
								aria-label={`Dismiss ${item.name}`}
							>
								<Icon name="cross-1" size="xs" />
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
