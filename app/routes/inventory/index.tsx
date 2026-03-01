import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { z } from 'zod'
import { InventoryItemCard } from '#app/components/inventory-item-card.tsx'
import { InventoryMobileFab } from '#app/components/inventory-mobile-fab.tsx'
import { InventoryQuickAdd } from '#app/components/inventory-quick-add.tsx'
import { OnboardingNudge } from '#app/components/onboarding-nudge.tsx'
import { PantryStaplesOnboarding } from '#app/components/pantry-staples-onboarding.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { findMatchingInventoryItem } from '#app/utils/inventory-dedup.server.ts'
import {
	InventoryItemNameSchema,
	InventoryItemSchema,
} from '#app/utils/inventory-validation.ts'
import { STALE_DAYS } from '#app/utils/date.ts'
import { guessCategory } from '#app/utils/shopping-list-validation.ts'
import { cn } from '#app/utils/misc.tsx'
import {
	getInventoryUsage,
	getUserTier,
} from '#app/utils/subscription.server.ts'
import { useUser } from '#app/utils/user.ts'
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

	const items = await prisma.inventoryItem.findMany({
		where: { householdId },
		orderBy: [{ name: 'asc' }],
	})

	const mealPlanEntryCount = await prisma.mealPlanEntry.count({
		where: { mealPlan: { householdId } },
	})

	return {
		items,
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
				where: { householdId },
			})
			const match = findMatchingInventoryItem(
				submission.value.name,
				existingItems,
			)
			if (match) {
				return {
					status: 'duplicate_warning' as const,
					existingItem: {
						id: match.id,
						name: match.name,
					},
				}
			}
		}

		if (force === 'merge') {
			// Acknowledge the existing item — don't create a duplicate
			const existingItems = await prisma.inventoryItem.findMany({
				where: { householdId },
			})
			const match = findMatchingInventoryItem(
				submission.value.name,
				existingItems,
			)
			if (match) {
				return { status: 'merged' as const, mergedInto: match.name }
			}
		}

		// force === 'add' or no duplicate found — create normally
		await prisma.inventoryItem.create({
			data: {
				name: submission.value.name,
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
					userId,
					householdId,
					createdAt: new Date(),
					updatedAt: new Date(),
				} as typeof existingItems[number])
			}
		}

		if (toCreate.length > 0) {
			await prisma.$transaction(
				toCreate.map((item) =>
					prisma.inventoryItem.create({
						data: {
							name: item.name,
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

		// Dedup check: another item with the same canonical name
		const existingItems = await prisma.inventoryItem.findMany({
			where: { householdId },
		})
		const match = findMatchingInventoryItem(
			parsed.data,
			existingItems.filter((i) => i.id !== itemId),
		)
		if (match) {
			return {
				status: 'error' as const,
				message: `"${match.name}" already exists in your inventory`,
			}
		}

		await prisma.inventoryItem.update({
			where: { id: itemId },
			data: { name: parsed.data },
		})

		return { status: 'success' as const }
	}

	if (intent === 'add-to-shopping') {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')

		const item = await prisma.inventoryItem.findFirst({
			where: { id: itemId, householdId },
		})
		invariantResponse(item, 'Item not found', { status: 404 })

		let shoppingList = await prisma.shoppingList.findFirst({
			where: { householdId },
		})
		if (!shoppingList) {
			shoppingList = await prisma.shoppingList.create({
				data: { userId, householdId },
			})
		}

		await prisma.shoppingListItem.create({
			data: {
				name: item.name,
				category: guessCategory(item.name),
				source: 'manual',
				listId: shoppingList.id,
			},
		})

		void emitHouseholdEvent({
			type: 'shopping_list_item_added',
			payload: { name: item.name },
			userId,
			householdId,
		})

		return { status: 'success' as const, action: 'add-to-shopping' as const }
	}

	return { status: 'error' as const }
}

const SEARCH_THRESHOLD = 15

export default function InventoryIndex({ loaderData }: Route.ComponentProps) {
	const {
		items,
		inventoryUsage,
		isProActive,
		mealPlanEntryCount,
	} = loaderData

	const user = useUser()
	const [search, setSearch] = useState('')
	const [fabOpen, setFabOpen] = useState(false)
	const [reviewingStale, setReviewingStale] = useState(false)
	const [staleBannerVisible, setStaleBannerVisible] = useState(false)

	const [showStaplesSuccess, setShowStaplesSuccess] = useState(false)
	const handleStaplesSuccess = useCallback(
		() => setShowStaplesSuccess(true),
		[],
	)
	const handleStaplesDismiss = useCallback(
		() => setShowStaplesSuccess(false),
		[],
	)

	const staleItems = items.filter((item) => {
		const ageMs = Date.now() - new Date(item.createdAt).getTime()
		return ageMs >= STALE_DAYS * 24 * 60 * 60 * 1000
	})

	const staleDismissKey = `stale-review-dismissed:${user.id}`

	useEffect(() => {
		if (staleItems.length < 5) {
			setStaleBannerVisible(false)
			return
		}
		const dismissed = localStorage.getItem(staleDismissKey)
		if (dismissed) {
			const elapsed = Date.now() - Number(dismissed)
			if (elapsed < 7 * 24 * 60 * 60 * 1000) return
		}
		setStaleBannerVisible(true)
	}, [staleDismissKey, staleItems.length])

	const handleDismissStale = useCallback(() => {
		localStorage.setItem(staleDismissKey, String(Date.now()))
		setStaleBannerVisible(false)
	}, [staleDismissKey])

	const handleReviewStale = useCallback(() => {
		localStorage.setItem(staleDismissKey, String(Date.now()))
		setStaleBannerVisible(false)
		setReviewingStale(true)
		setSearch('')
	}, [staleDismissKey])

	const handleExitReview = useCallback(() => {
		setReviewingStale(false)
		setSearch('')
	}, [])

	if (items.length === 0 || showStaplesSuccess) {
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

	const baseItems = reviewingStale ? staleItems : items
	const filteredItems = search
		? baseItems.filter((item) =>
				item.name.toLowerCase().includes(search.toLowerCase()),
			)
		: baseItems

	const showSearch = items.length >= SEARCH_THRESHOLD

	return (
		<div className="pb-28 md:pb-6">
			{/* Page Header */}
			<div className="container-content flex items-center justify-between gap-3 py-3 md:py-4">
				<div>
					<h1 className="font-serif text-2xl font-normal">Inventory</h1>
					{/* Item count for Pro users (free users see X/Y below) */}
					{items.length > 0 && inventoryUsage.limit === null && (
						<p className="mt-0.5 text-sm text-muted-foreground">
							{items.length} {items.length === 1 ? 'item' : 'items'}
						</p>
					)}
					{/* Status line */}
					{inventoryUsage.limit !== null && (
						<p className="mt-0.5 text-sm text-muted-foreground">
							<span
								className={cn(
									inventoryUsage.isAtLimit
										? 'text-amber-600 dark:text-amber-400'
										: '',
								)}
							>
								{inventoryUsage.count}/{inventoryUsage.limit} free items
							</span>
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

				{items.length > 0 && mealPlanEntryCount === 0 && (
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

				{/* Stale items review banner */}
				{staleBannerVisible && !reviewingStale && (
					<div className="mb-4 rounded-lg bg-amber-50 p-4 dark:bg-amber-950/30">
						<p className="text-sm font-medium text-amber-800 dark:text-amber-200">
							{staleItems.length} items over a month old
						</p>
						<p className="mt-0.5 text-xs text-amber-700/70 dark:text-amber-300/60">
							Still in your kitchen? A quick review keeps your
							inventory useful.
						</p>
						<div className="mt-3 flex items-center gap-2">
							<Button
								size="sm"
								className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700"
								onClick={handleReviewStale}
							>
								Review
							</Button>
							<Button
								size="sm"
								variant="ghost"
								className="text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
								onClick={handleDismissStale}
							>
								Not now
							</Button>
						</div>
					</div>
				)}

				{/* Search */}
				<div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

				{/* Quick Add (desktop only — mobile uses FAB) */}
				{!inventoryUsage.isAtLimit && (
					<div className="hidden md:block mb-2">
						<InventoryQuickAdd isProActive={isProActive} />
					</div>
				)}

				{/* Review mode header */}
				{reviewingStale && staleItems.length > 0 && (
					<div className="mb-3 flex items-center justify-between rounded-lg bg-amber-50 px-4 py-2.5 dark:bg-amber-950/30">
						<p className="text-sm font-medium text-amber-800 dark:text-amber-200">
							Reviewing {staleItems.length} stale{' '}
							{staleItems.length === 1 ? 'item' : 'items'}
						</p>
						<Button
							size="sm"
							variant="ghost"
							className="text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
							onClick={handleExitReview}
						>
							Show all
						</Button>
					</div>
				)}

				{/* Items List */}
				{reviewingStale && staleItems.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-16 text-center">
						<div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950/30">
							<Icon
								name="check"
								className="size-6 text-emerald-600 dark:text-emerald-400"
							/>
						</div>
						<h2 className="mt-4 font-serif text-xl font-normal">
							All caught up!
						</h2>
						<p className="mt-2 max-w-sm text-muted-foreground">
							No more stale items to review.
						</p>
						<Button
							variant="outline"
							className="mt-4"
							onClick={handleExitReview}
						>
							Back to inventory
						</Button>
					</div>
				) : filteredItems.length > 0 ? (
					<div>
						{groupByFirstLetter(filteredItems).map(({ letter, items: groupItems }) => (
							<div key={letter}>
								<div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-1 py-0.5">
									<span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
										{letter}
									</span>
								</div>
								<div className="divide-y divide-border/40">
									{groupItems.map((item) => (
										<InventoryItemCard key={item.id} item={item} />
									))}
								</div>
							</div>
						))}
					</div>
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
							Add what you have on hand. No need to count, just the items. We'll match them to your recipes and keep your shopping list smart.
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

			{!inventoryUsage.isAtLimit && (
				<InventoryMobileFab
					open={fabOpen}
					onOpenChange={setFabOpen}
					isProActive={isProActive}
				/>
			)}
		</div>
	)
}

function groupByFirstLetter<T extends { name: string }>(items: T[]) {
	const groups: Array<{ letter: string; items: T[] }> = []
	let currentLetter = ''
	for (const item of items) {
		const letter = item.name[0]?.toUpperCase() ?? '#'
		if (letter !== currentLetter) {
			currentLetter = letter
			groups.push({ letter, items: [] })
		}
		groups[groups.length - 1]!.items.push(item)
	}
	return groups
}
