import { type InventoryItem } from '@prisma/client'
import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { z } from 'zod'
import { InventoryItemCard } from '#app/components/inventory-item-card.tsx'
import { InventoryLocationTabs } from '#app/components/inventory-location-tabs.tsx'
import { InventoryQuickAdd } from '#app/components/inventory-quick-add.tsx'
import { OnboardingNudge } from '#app/components/onboarding-nudge.tsx'
import { PantryStaplesOnboarding } from '#app/components/pantry-staples-onboarding.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { findMatchingInventoryItem } from '#app/utils/inventory-dedup.server.ts'
import {
	InventoryItemLocationSchema,
	InventoryItemNameSchema,
	InventoryItemSchema,
	LOCATION_LABELS,
} from '#app/utils/inventory-validation.ts'
import { cn } from '#app/utils/misc.tsx'
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

	// Single query for all items — filter by location in JS
	const allItems = await prisma.inventoryItem.findMany({
		where: { householdId },
		orderBy: [{ lowStock: 'desc' }, { name: 'asc' }],
	})

	const totalItemCount = allItems.length
	const items =
		location && location !== 'all'
			? allItems.filter((item) => item.location === location)
			: allItems

	const lowStockCount = allItems.filter((item) => item.lowStock).length

	const mealPlanEntryCount = await prisma.mealPlanEntry.count({
		where: { mealPlan: { householdId } },
	})

	return {
		items,
		totalItemCount,
		selectedLocation: location || 'all',
		lowStockCount,
		inventoryUsage,
		isProActive,
		mealPlanEntryCount,
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
					},
				}
			}
		}

		if (force === 'merge') {
			// Find the existing item and refresh it
			const existingItems = await prisma.inventoryItem.findMany({
				where: { householdId, location: submission.value.location },
			})
			const match = findMatchingInventoryItem(
				submission.value.name,
				submission.value.location,
				existingItems,
			)
			if (match) {
				await prisma.inventoryItem.update({
					where: { id: match.id },
					data: { lowStock: false },
				})
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

		return { status: 'success' as const }
	}

	if (intent === 'rename') {
		const itemId = formData.get('itemId')
		const name = formData.get('name')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')
		invariantResponse(typeof name === 'string', 'Name is required')

		const parsed = InventoryItemNameSchema.safeParse(name)
		if (!parsed.success) {
			return { status: 'error' as const, message: 'Invalid name' }
		}

		const item = await prisma.inventoryItem.findFirst({
			where: { id: itemId, householdId },
		})
		invariantResponse(item, 'Item not found', { status: 404 })

		// Dedup check: another item with the same canonical name in the same location
		const existingItems = await prisma.inventoryItem.findMany({
			where: { householdId, location: item.location },
		})
		const match = findMatchingInventoryItem(
			parsed.data,
			item.location,
			existingItems.filter((i) => i.id !== itemId),
		)
		if (match) {
			return {
				status: 'error' as const,
				message: `"${match.name}" already exists in this location`,
			}
		}

		await prisma.inventoryItem.update({
			where: { id: itemId },
			data: { name: parsed.data },
		})

		return { status: 'success' as const }
	}

	if (intent === 'move') {
		const itemId = formData.get('itemId')
		const location = formData.get('location')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')
		invariantResponse(typeof location === 'string', 'Location is required')

		const parsed = InventoryItemLocationSchema.safeParse(location)
		if (!parsed.success) {
			return { status: 'error' as const, message: 'Invalid location' }
		}

		const item = await prisma.inventoryItem.findFirst({
			where: { id: itemId, householdId },
		})
		invariantResponse(item, 'Item not found', { status: 404 })

		// Dedup check: same canonical name in target location
		const existingItems = await prisma.inventoryItem.findMany({
			where: { householdId, location: parsed.data },
		})
		const match = findMatchingInventoryItem(
			item.name,
			parsed.data,
			existingItems,
		)
		if (match) {
			return {
				status: 'error' as const,
				message: `"${item.name}" already exists in ${LOCATION_LABELS[parsed.data]}`,
			}
		}

		await prisma.inventoryItem.update({
			where: { id: itemId },
			data: { location: parsed.data },
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

const SEARCH_THRESHOLD = 15

export default function InventoryIndex({ loaderData }: Route.ComponentProps) {
	const {
		items,
		totalItemCount,
		selectedLocation,
		lowStockCount,
		inventoryUsage,
		isProActive,
		mealPlanEntryCount,
	} = loaderData

	const [search, setSearch] = useState('')
	const [fabOpen, setFabOpen] = useState(false)

	const [showStaplesSuccess, setShowStaplesSuccess] = useState(false)
	const handleStaplesSuccess = useCallback(
		() => setShowStaplesSuccess(true),
		[],
	)
	const handleStaplesDismiss = useCallback(
		() => setShowStaplesSuccess(false),
		[],
	)

	if (totalItemCount === 0 || showStaplesSuccess) {
		return (
			<div className="container-content py-6 pb-20 md:pb-6">
				<PantryStaplesOnboarding
					maxItems={inventoryUsage.limit ?? undefined}
					onSuccess={handleStaplesSuccess}
					onDismiss={handleStaplesDismiss}
				/>
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
					{(lowStockCount > 0 || inventoryUsage.limit !== null) && (
						<p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
							{lowStockCount > 0 && (
								<span className="text-amber-600 dark:text-amber-400">
									{lowStockCount} low stock
								</span>
							)}
							{lowStockCount > 0 && inventoryUsage.limit !== null && (
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
						className="hidden sm:inline-flex"
					>
						<Link to="/inventory/new">
							<Icon name="plus" size="sm" />
							Add Item
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
								Upgrade to Pro for unlimited inventory, smart suggestions,
								and advanced shopping features.
							</p>
						</div>
						<Button asChild size="sm" className="shrink-0">
							<Link to="/upgrade">Upgrade to Pro</Link>
						</Button>
					</div>
				)}

				{totalItemCount > 0 && mealPlanEntryCount === 0 && (
					<OnboardingNudge
						nudgeId="plan-your-week"
						icon="calendar"
						title="Ready to plan your week?"
						description="Add recipes to your meal plan and we'll generate a shopping list, so you only buy what you actually need."
						ctaText="Plan Meals"
						ctaHref="/plan"
						className="mb-4"
					/>
				)}

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
								? "Add what you have on hand. No need to count, just the items. We'll match them to your recipes and keep your shopping list smart."
								: `Your ${selectedLocation} is empty. Add what you have and we'll match it to your recipes.`}
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

			{/* Mobile FAB + quick-add popover */}
			{!inventoryUsage.isAtLimit && (
				<InventoryMobileFabAdd
					open={fabOpen}
					onOpenChange={setFabOpen}
					defaultLocation={selectedLocation}
				/>
			)}
		</div>
	)
}

const FAB_LOCATIONS = [
	{ value: 'pantry', label: 'Pantry' },
	{ value: 'fridge', label: 'Fridge' },
	{ value: 'freezer', label: 'Freezer' },
] as const

function InventoryMobileFabAdd({
	open,
	onOpenChange,
	defaultLocation,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	defaultLocation: string
}) {
	const fetcher = useFetcher<{ status: string }>()
	const [name, setName] = useState('')
	const [location, setLocation] = useState(
		defaultLocation && defaultLocation !== 'all' ? defaultLocation : 'pantry',
	)
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (open) {
			setTimeout(() => inputRef.current?.focus(), 50)
		}
	}, [open])

	useEffect(() => {
		if (defaultLocation && defaultLocation !== 'all') {
			setLocation(defaultLocation)
		}
	}, [defaultLocation])

	const prevState = useRef(fetcher.state)
	useEffect(() => {
		if (
			prevState.current !== 'idle' &&
			fetcher.state === 'idle' &&
			fetcher.data?.status === 'success'
		) {
			setName('')
			inputRef.current?.focus()
		}
		prevState.current = fetcher.state
	}, [fetcher.state, fetcher.data])

	return (
		<div className="md:hidden print:hidden">
			{open && (
				<div
					className="fixed inset-0 z-40"
					onClick={() => onOpenChange(false)}
				/>
			)}
			{open && (
				<div className="fixed bottom-[9rem] right-4 z-50 w-[calc(100vw-2rem)] max-w-xs animate-fade-up-reveal rounded-xl border border-border/60 bg-card p-3 shadow-warm-lg">
					<fetcher.Form
						method="POST"
						onSubmit={(e) => {
							if (!name.trim()) e.preventDefault()
						}}
					>
						<input type="hidden" name="intent" value="create" />
						<input type="hidden" name="location" value={location} />
						<input type="hidden" name="force" value="add" />
						<div className="flex items-center gap-2">
							<input
								ref={inputRef}
								name="name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Add an item..."
								className="h-10 min-w-0 flex-1 rounded-lg border border-border/50 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/30 focus:ring-1 focus:ring-primary/20"
							/>
							<button
								type="submit"
								disabled={!name.trim() || fetcher.state !== 'idle'}
								className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
							>
								<Icon name="plus" className="size-5" />
							</button>
						</div>
						<div className="mt-2 flex gap-1.5">
							{FAB_LOCATIONS.map((loc) => (
								<button
									key={loc.value}
									type="button"
									onClick={() => setLocation(loc.value)}
									className={cn(
										'rounded-full px-3 py-1 text-xs font-medium transition-colors',
										location === loc.value
											? 'bg-primary text-primary-foreground'
											: 'bg-muted text-muted-foreground',
									)}
								>
									{loc.label}
								</button>
							))}
						</div>
					</fetcher.Form>
				</div>
			)}
			<button
				type="button"
				className={cn(
					'fixed bottom-[5.5rem] right-4 z-50 flex size-12 items-center justify-center rounded-full shadow-warm-md transition-all active:scale-95',
					open
						? 'bg-muted text-muted-foreground'
						: 'bg-primary text-primary-foreground',
				)}
				aria-label={open ? 'Close' : 'Add item'}
				onClick={() => onOpenChange(!open)}
			>
				<Icon name={open ? 'cross-1' : 'plus'} className="size-6" />
			</button>
		</div>
	)
}

const locationDotColors: Record<string, string> = {
	pantry: 'bg-amber-500',
	fridge: 'bg-blue-500',
	freezer: 'bg-cyan-500',
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
		<div className={cn('sticky top-0 z-10 border-b border-border/30 bg-background pb-3', isFirst ? 'pt-1' : 'pt-8')}>
			<div className="flex items-center gap-2">
				<span
					className={cn(
						'size-2 rounded-full',
						locationDotColors[location] ?? 'bg-muted-foreground',
					)}
				/>
				<span className="text-[0.75rem] font-medium tracking-[0.08em] uppercase text-muted-foreground">
					{LOCATION_LABELS[location as keyof typeof LOCATION_LABELS] ?? location}
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

