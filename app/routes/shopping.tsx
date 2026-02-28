import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useRef, useState } from 'react'
import { Form, Link, useFetcher } from 'react-router'
import { ShoppingListItemCard } from '#app/components/shopping-list-item.tsx'
import { ShoppingListToInventory } from '#app/components/shopping-list-to-inventory.tsx'
import { ShoppingListLiveRefresh } from '#app/components/shopping-live-refresh.tsx'
import { OnboardingNudge } from '#app/components/onboarding-nudge.tsx'
import { LowStockNudge } from '#app/components/shopping-low-stock-nudge.tsx'
import { MobileFabAdd } from '#app/components/shopping-mobile-fab.tsx'
import { WarningBanner } from '#app/components/shopping-warning-banner.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import {
	getCurrentWeekStart,
	getPreviousWeek,
	getNextWeek,
	getWeekStart,
	parseDate,
	serializeDate,
	formatWeekRange,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import {
	getCanonicalIngredientName,
	ingredientMatchesInventoryItem,
} from '#app/utils/recipe-matching.server.ts'
import {
	ShoppingListItemSchema,
	guessCategory,
} from '#app/utils/shopping-list-validation.ts'
import {
	generateShoppingListFromRecipes,
	annotateInventoryMatches,
} from '#app/utils/shopping-list.server.ts'
import { requireUserWithTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/shopping.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Shopping List | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId, isProActive } = await requireUserWithTier(request)

	// Get or create shopping list
	let shoppingList = await prisma.shoppingList.findFirst({
		where: { householdId },
		include: {
			items: {
				orderBy: [{ checked: 'asc' }, { name: 'asc' }],
			},
		},
	})

	if (!shoppingList) {
		shoppingList = await prisma.shoppingList.create({
			data: { userId, householdId },
			include: { items: true },
		})
	}

	// Check prev/current/next weeks for meal plans
	const currentWeek = getCurrentWeekStart()
	const prevWeek = getPreviousWeek(currentWeek)
	const nextWeek = getNextWeek(currentWeek)

	const mealPlans = await prisma.mealPlan.findMany({
		where: {
			householdId,
			weekStart: { in: [prevWeek, currentWeek, nextWeek] },
		},
		select: {
			weekStart: true,
			_count: { select: { entries: true } },
		},
	})

	const weeksWithPlans = [prevWeek, currentWeek, nextWeek]
		.filter((week) =>
			mealPlans.some(
				(mp) =>
					mp.weekStart.getTime() === week.getTime() && mp._count.entries > 0,
			),
		)
		.map((week) => ({
			weekStart: serializeDate(week),
			label: formatWeekRange(week),
			isCurrent: week.getTime() === currentWeek.getTime(),
		}))

	const hasMealPlan = weeksWithPlans.length > 0

	// Pro-only: low-stock suggestions + review panel matching
	let lowStockSuggestions: Array<{
		id: string
		name: string
		location: string
		lowStock: boolean
	}> = []
	let inventoryByCanonical: Record<string, string[]> = {}
	let itemCanonicals: Record<string, string> = {}

	if (isProActive) {
		const allInventoryItems = await prisma.inventoryItem.findMany({
			where: { householdId },
			select: { id: true, name: true, location: true, lowStock: true },
		})

		// Filter out items already on the shopping list by canonical name
		const shoppingCanonicals = new Set(
			shoppingList.items.map((item) =>
				getCanonicalIngredientName(item.name),
			),
		)
		lowStockSuggestions = allInventoryItems
			.filter((item) => item.lowStock)
			.filter(
				(item) =>
					!shoppingCanonicals.has(
						getCanonicalIngredientName(item.name),
					),
			)

		// Canonical inventory lookup for review panel "already stocked" indicator
		for (const inv of allInventoryItems) {
			const canonical = getCanonicalIngredientName(inv.name)
			if (!inventoryByCanonical[canonical]) {
				inventoryByCanonical[canonical] = []
			}
			if (!inventoryByCanonical[canonical].includes(inv.location)) {
				inventoryByCanonical[canonical].push(inv.location)
			}
		}
		for (const item of shoppingList.items) {
			itemCanonicals[item.id] = getCanonicalIngredientName(item.name)
		}
	}

	return {
		shoppingList,
		hasMealPlan,
		weeksWithPlans,
		lowStockSuggestions,
		inventoryByCanonical,
		itemCanonicals,
		isProActive,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithTier(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	// Get user's shopping list
	let shoppingList = await prisma.shoppingList.findFirst({
		where: { householdId },
	})

	if (!shoppingList) {
		shoppingList = await prisma.shoppingList.create({
			data: { userId, householdId },
		})
	}

	if (intent === 'generate') {
		// Get meal plan for specified week (or current week)
		const weekStartParam = formData.get('weekStart')
		const weekStart =
			typeof weekStartParam === 'string' && weekStartParam
				? getWeekStart(parseDate(weekStartParam))
				: getCurrentWeekStart()
		const mealPlan = await prisma.mealPlan.findFirst({
			where: { householdId, weekStart },
			include: {
				entries: {
					where: { cooked: false },
					include: {
						recipe: {
							include: {
								ingredients: true,
							},
						},
					},
				},
			},
		})

		invariantResponse(mealPlan, 'No meal plan found for this week', {
			status: 404,
		})

		const recipeEntries = mealPlan.entries.map((entry) => ({
			recipe: entry.recipe,
			servings: entry.servings,
		}))
		const rawItems = generateShoppingListFromRecipes(recipeEntries)

		// Annotate items with inventory match info (staples still stripped)
		const inventoryItems = await prisma.inventoryItem.findMany({
			where: { householdId },
		})
		const { items, inStockCount } = annotateInventoryMatches(
			rawItems,
			inventoryItems,
		)

		// Delete existing generated items
		await prisma.shoppingListItem.deleteMany({
			where: {
				listId: shoppingList.id,
				source: 'generated',
			},
		})

		// Dedup against remaining unchecked items (manual, recipe, discover sources)
		const existingItems = await prisma.shoppingListItem.findMany({
			where: { listId: shoppingList.id, checked: false },
			select: { name: true },
		})
		const existingCanonicals = new Set(
			existingItems.map((i) => getCanonicalIngredientName(i.name)),
		)
		const dedupedItems = items.filter(
			(item) => !existingCanonicals.has(getCanonicalIngredientName(item.name)),
		)

		// Create new items — in-stock items are pre-checked
		await prisma.shoppingListItem.createMany({
			data: dedupedItems.map(({ inStock, ...item }) => ({
				...item,
				checked: inStock,
				listId: shoppingList.id,
			})),
		})

		void emitHouseholdEvent({
			type: 'shopping_list_generated',
			payload: { count: dedupedItems.length },
			userId,
			householdId,
		})

		return { status: 'success' as const, inStockCount, weekLabel: formatWeekRange(weekStart) }
	}

	if (intent === 'add') {
		const submission = parseWithZod(formData, {
			schema: ShoppingListItemSchema,
		})
		if (submission.status !== 'success') {
			return { status: 'error' as const, submission: submission.reply() }
		}

		const force = formData.get('force') === 'true'

		if (!force) {
			const canonicalName = getCanonicalIngredientName(submission.value.name)

			// Check for existing unchecked shopping list items
			const existingItems = await prisma.shoppingListItem.findMany({
				where: { listId: shoppingList.id, checked: false },
			})
			const duplicate = existingItems.find(
				(item) => getCanonicalIngredientName(item.name) === canonicalName,
			)
			if (duplicate) {
				return {
					status: 'warning' as const,
					warningType: 'already_on_list' as const,
					existingName: duplicate.name,
					existingQuantity: duplicate.quantity,
					existingUnit: duplicate.unit,
					submittedName: submission.value.name,
					submittedQuantity: submission.value.quantity,
					submittedUnit: submission.value.unit,
				}
			}

			// Check inventory
			const inventoryItems = await prisma.inventoryItem.findMany({
				where: { householdId },
			})
			const inInventory = inventoryItems.find((inv) =>
				ingredientMatchesInventoryItem({ name: submission.value.name }, inv),
			)
			if (inInventory) {
				return {
					status: 'warning' as const,
					warningType: 'in_inventory' as const,
					inventoryName: inInventory.name,
					inventoryLocation: inInventory.location,
					submittedName: submission.value.name,
					submittedQuantity: submission.value.quantity,
					submittedUnit: submission.value.unit,
				}
			}
		}

		// Auto-categorize if no category provided
		const category =
			submission.value.category || guessCategory(submission.value.name)

		await prisma.shoppingListItem.create({
			data: {
				name: submission.value.name,
				quantity: submission.value.quantity,
				unit: submission.value.unit,
				category,
				listId: shoppingList.id,
				source: 'manual',
			},
		})

		void emitHouseholdEvent({
			type: 'shopping_list_item_added',
			payload: { name: submission.value.name },
			userId,
			householdId,
		})

		return {
			status: 'success' as const,
			submission: submission.reply({ resetForm: true }),
		}
	}

	if (intent === 'toggle') {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')

		const item = await prisma.shoppingListItem.findFirst({
			where: {
				id: itemId,
				list: { householdId },
			},
		})
		invariantResponse(item, 'Item not found', { status: 404 })

		await prisma.shoppingListItem.update({
			where: { id: itemId },
			data: { checked: !item.checked },
		})

		void emitHouseholdEvent({
			type: 'shopping_list_item_toggled',
			payload: { name: item.name, checked: !item.checked },
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'delete') {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')

		const item = await prisma.shoppingListItem.findFirst({
			where: {
				id: itemId,
				list: { householdId },
			},
		})
		invariantResponse(item, 'Item not found', { status: 404 })

		await prisma.shoppingListItem.delete({ where: { id: itemId } })

		void emitHouseholdEvent({
			type: 'shopping_list_item_deleted',
			payload: { name: item.name },
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'edit') {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')

		const item = await prisma.shoppingListItem.findFirst({
			where: {
				id: itemId,
				list: { householdId },
			},
		})
		invariantResponse(item, 'Item not found', { status: 404 })

		const submission = parseWithZod(formData, {
			schema: ShoppingListItemSchema,
		})
		if (submission.status !== 'success') {
			return { status: 'error' as const, submission: submission.reply() }
		}

		await prisma.shoppingListItem.update({
			where: { id: itemId },
			data: {
				name: submission.value.name,
				quantity: submission.value.quantity,
				unit: submission.value.unit,
			},
		})

		void emitHouseholdEvent({
			type: 'shopping_list_item_edited',
			payload: { name: submission.value.name },
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'clear-checked') {
		await prisma.shoppingListItem.deleteMany({
			where: {
				listId: shoppingList.id,
				checked: true,
			},
		})

		void emitHouseholdEvent({
			type: 'shopping_list_cleared',
			payload: {},
			userId,
			householdId,
		})

		return { status: 'success' as const }
	}

	if (intent === 'add-low-stock') {
		const itemName = formData.get('itemName')
		invariantResponse(
			typeof itemName === 'string' && itemName.trim(),
			'Item name is required',
		)

		const trimmed = itemName.trim()
		const canonicalName = getCanonicalIngredientName(trimmed)

		// Dedup: skip if already on the list
		const existingItems = await prisma.shoppingListItem.findMany({
			where: { listId: shoppingList.id, checked: false },
			select: { name: true },
		})
		const alreadyOnList = existingItems.some(
			(item) => getCanonicalIngredientName(item.name) === canonicalName,
		)
		if (!alreadyOnList) {
			await prisma.shoppingListItem.create({
				data: {
					name: trimmed,
					category: guessCategory(trimmed),
					listId: shoppingList.id,
					source: 'manual',
				},
			})

			void emitHouseholdEvent({
				type: 'shopping_list_item_added',
				payload: { name: trimmed },
				userId,
				householdId,
			})
		}

		return { status: 'success' as const }
	}

	if (intent === 'add-all-low-stock') {
		const rawNames = formData.get('names')
		invariantResponse(typeof rawNames === 'string', 'Names are required')

		let names: string[]
		try {
			names = JSON.parse(rawNames) as string[]
		} catch {
			throw new Response('Invalid names data', { status: 400 })
		}
		invariantResponse(Array.isArray(names) && names.length > 0, 'No names')

		// Dedup: filter out items already on the list
		const existingItems = await prisma.shoppingListItem.findMany({
			where: { listId: shoppingList.id, checked: false },
			select: { name: true },
		})
		const existingCanonicals = new Set(
			existingItems.map((item) => getCanonicalIngredientName(item.name)),
		)
		const newNames = names.filter(
			(name) => !existingCanonicals.has(getCanonicalIngredientName(name)),
		)

		if (newNames.length > 0) {
			await prisma.shoppingListItem.createMany({
				data: newNames.map((name) => ({
					name,
					category: guessCategory(name),
					listId: shoppingList.id,
					source: 'manual' as const,
				})),
			})

			void emitHouseholdEvent({
				type: 'shopping_list_item_added',
				payload: { count: newNames.length, source: 'low-stock' },
				userId,
				householdId,
			})
		}

		return { status: 'success' as const }
	}

	return { status: 'error' as const }
}

export default function ShoppingListRoute({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		shoppingList,
		hasMealPlan,
		weeksWithPlans,
		lowStockSuggestions,
		inventoryByCanonical,
		itemCanonicals,
		isProActive,
	} = loaderData
	const defaultWeek =
		weeksWithPlans.find((w) => w.isCurrent)?.weekStart ??
		weeksWithPlans[0]?.weekStart ??
		''
	// Quick-add uses fetcher so form state survives SSE-triggered revalidations
	const quickAddFetcher = useFetcher<Record<string, unknown>>()
	const [qaName, setQaName] = useState('')
	const [qaQuantity, setQaQuantity] = useState('')
	const [qaUnit, setQaUnit] = useState('')
	const qaInputRef = useRef<HTMLInputElement>(null)

	const [search, setSearch] = useState('')
	const [showReview, setShowReview] = useState(false)
	const [quickAddOpen, setQuickAddOpen] = useState(false)
	const [fabOpen, setFabOpen] = useState(false)
	const [warningDismissed, setWarningDismissed] = useState(false)

	// Reset quick-add on success, preserve values on warning
	const prevQaState = useRef(quickAddFetcher.state)
	useEffect(() => {
		if (
			prevQaState.current !== 'idle' &&
			quickAddFetcher.state === 'idle' &&
			quickAddFetcher.data?.status === 'success'
		) {
			setQaName('')
			setQaQuantity('')
			setQaUnit('')
			setWarningDismissed(false)
			qaInputRef.current?.focus()
		}
		prevQaState.current = quickAddFetcher.state
	}, [quickAddFetcher.state, quickAddFetcher.data])

	const allItems = shoppingList.items
	const totalItems = allItems.length
	const checkedItemsList = allItems.filter((item) => item.checked)
	const checkedItems = checkedItemsList.length

	const searchLower = search.toLowerCase()
	const filteredItems = search
		? allItems.filter((i) => i.name.toLowerCase().includes(searchLower))
		: allItems

	// Determine if we should show a warning (from quick-add fetcher, not route actionData)
	const showWarning =
		!warningDismissed &&
		quickAddFetcher.data &&
		'warningType' in quickAddFetcher.data &&
		quickAddFetcher.data.status === 'warning'

	return (
		<div className="pb-28 md:pb-6">
			{isProActive && <ShoppingListLiveRefresh />}
			{/* Page Header */}
			<div className="border-border/50 border-b print:border-0">
				<div className="container-narrow py-4">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<h1 className="font-serif text-2xl font-normal">
							Shopping List
							{totalItems > 0 && (
								<span className="ml-2 text-lg font-sans font-normal tabular-nums text-muted-foreground">
									({checkedItems}/{totalItems})
								</span>
							)}
						</h1>
						<div className="flex items-center gap-2 sm:ml-auto print:hidden">
							{hasMealPlan && (
								<Form method="POST" className="flex items-center gap-2">
									<input type="hidden" name="intent" value="generate" />
									<input type="hidden" name="weekStart" value={defaultWeek} />
									<Button type="submit" variant="outline" size="sm" aria-label="Generate shopping list from meal plan">
										<Icon name="calendar" size="sm" />
										From Plan
									</Button>
								</Form>
							)}
							{totalItems > 0 && (
								<Button
									variant="outline"
									size="icon"
									onClick={() => window.print()}
									aria-label="Print shopping list"
									className="h-9 w-9 sm:hidden"
								>
									<Icon name="file-text" size="sm" />
								</Button>
							)}
							{totalItems > 0 && (
								<Button
									variant="outline"
									size="sm"
									onClick={() => window.print()}
									className="hidden sm:inline-flex"
								>
									<Icon name="file-text" size="sm" />
									Print
								</Button>
							)}
						</div>
					</div>
				</div>
				{actionData?.status === 'success' && 'weekLabel' in actionData && (
					<p className="text-muted-foreground container-narrow pb-4 text-center text-sm">
						Generated for {actionData.weekLabel}
						{typeof actionData.inStockCount === 'number' &&
							actionData.inStockCount > 0 &&
							` · ${actionData.inStockCount} pre-checked (in stock)`}
					</p>
				)}
			</div>

			<div className="container-narrow py-4">
				{/* Low Stock Nudge (Pro) */}
				{isProActive && lowStockSuggestions.length > 0 && !showReview && (
					<div className="mb-4">
						<LowStockNudge items={lowStockSuggestions} />
					</div>
				)}

				{shoppingList.items.length > 0 &&
					shoppingList.items.every((i) => !i.checked) && (
						<OnboardingNudge
							nudgeId="check-items-off"
							icon="check"
							title="Check items off as you shop"
							description="Tap items as you shop. When you're done, checked items flow into your inventory, keeping everything in sync."
							dismissText="Got it"
							className="mb-4"
						/>
					)}

				{/* Quick Add — desktop only, FAB replaces this on mobile */}
				<div className="mb-2 hidden border-b border-border/30 print:hidden md:block">
					{/* Warning banner */}
					{showWarning && (
						<WarningBanner
							actionData={
								quickAddFetcher.data as Record<string, unknown>
							}
							onDismiss={() => setWarningDismissed(true)}
						/>
					)}

					<quickAddFetcher.Form
						method="POST"
						onSubmit={(e) => {
							if (!qaName.trim()) e.preventDefault()
						}}
					>
						<input type="hidden" name="intent" value="add" />
						{showWarning && (
							<input type="hidden" name="force" value="true" />
						)}
						<div className="flex items-center gap-2">
							<div className="min-w-0 flex-1">
								<Input
									ref={qaInputRef}
									name="name"
									value={qaName}
									onChange={(e) => {
										setQaName(e.target.value)
										setWarningDismissed(false)
									}}
									placeholder="Add an item..."
									className="h-10 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
								/>
							</div>
							{!quickAddOpen && (
								<button
									type="button"
									onClick={() => setQuickAddOpen(true)}
									className="shrink-0 text-xs text-muted-foreground/40 hover:text-muted-foreground"
								>
									+ Qty
								</button>
							)}
							<button
								type="submit"
								disabled={
									!qaName.trim() ||
									quickAddFetcher.state !== 'idle'
								}
								className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
								aria-label={showWarning ? 'Add anyway' : 'Add to list'}
							>
								<Icon name="plus" className="size-5" />
							</button>
						</div>
						{quickAddOpen && (
							<div className="flex items-center gap-3 pb-1">
								<div className="min-w-0 flex-1">
									<Input
										name="quantity"
										value={qaQuantity}
										onChange={(e) => setQaQuantity(e.target.value)}
										placeholder="Qty"
										className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
									/>
								</div>
								<div className="min-w-0 flex-1">
									<Input
										name="unit"
										value={qaUnit}
										onChange={(e) => setQaUnit(e.target.value)}
										placeholder="Unit"
										className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
									/>
								</div>
								<button
									type="button"
									onClick={() => setQuickAddOpen(false)}
									className="shrink-0 text-xs text-muted-foreground/40 hover:text-muted-foreground"
								>
									Hide
								</button>
							</div>
						)}
					</quickAddFetcher.Form>
				</div>

				{/* Search — only shown with 15+ items */}
				{totalItems >= 15 && (
					<div className="relative mt-2 print:hidden">
						<Icon
							name="magnifying-glass"
							size="sm"
							className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
						/>
						<Input
							type="search"
							placeholder="Search shopping list..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="pl-9"
						/>
					</div>
				)}

				{/* Item List */}
				{totalItems > 0 ? (
					<div className="mt-2">
						{search && filteredItems.length === 0 ? (
							<div className="py-12 text-center">
								<p className="text-muted-foreground text-sm">
									No items matching &ldquo;{search}&rdquo;
								</p>
								<button
									type="button"
									className="mt-2 text-sm text-primary underline underline-offset-2"
									onClick={() => setSearch('')}
								>
									Clear search
								</button>
							</div>
						) : (
							<div>
								{filteredItems.map((item) => (
									<ShoppingListItemCard key={item.id} item={item} />
								))}
							</div>
						)}

						{/* Checked Item Actions */}
						{checkedItems > 0 && !showReview && !search && (
							<div className="flex items-center justify-center gap-4 pt-4 animate-slide-up-reveal print:hidden">
								{isProActive && (
									<>
										<button
											type="button"
											onClick={() => setShowReview(true)}
											className="text-sm text-primary hover:text-primary/80 underline underline-offset-2"
										>
											Add to inventory ({checkedItems})
										</button>
										<span className="text-border">·</span>
									</>
								)}
								<Form
									method="POST"
									className="inline"
									onSubmit={(e) => {
										if (
											!confirm(
												`Clear ${checkedItems} checked item${checkedItems !== 1 ? 's' : ''}?`,
											)
										) {
											e.preventDefault()
										}
									}}
								>
									<input
										type="hidden"
										name="intent"
										value="clear-checked"
									/>
									<button
										type="submit"
										className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
									>
										Clear checked
									</button>
								</Form>
							</div>
						)}
					</div>
				) : (
					<div className="py-12 text-center">
						<div className="mx-auto flex size-16 items-center justify-center rounded-full border-2 border-dashed border-border">
							<Icon
								name="cart"
								className="size-7 text-muted-foreground/40"
							/>
						</div>
						<h2 className="mt-4 font-serif text-lg">
							Nothing on the list
						</h2>
						<p className="text-muted-foreground mx-auto mt-2 max-w-sm text-sm">
							{hasMealPlan ? (
								<>
									Hit <strong>From Plan</strong> to generate your list from the
									meal plan. Things you already have are pre-checked. Add
									anything else you need by hand.
								</>
							) : (
								<>
									Create a{' '}
									<Link
										to="/plan"
										className="text-primary hover:text-primary/80 font-medium underline underline-offset-2"
									>
										meal plan
									</Link>{' '}
									to auto-generate your list, or add items by hand. Check
									things off at the store and they'll flow into your
									inventory.
								</>
							)}
						</p>
					</div>
				)}

				{/* Inventory Review Panel (Pro) */}
				{isProActive && showReview && checkedItems > 0 && !search && (
					<div className="mt-4 print:hidden">
						<ShoppingListToInventory
							items={checkedItemsList}
							inventoryByCanonical={inventoryByCanonical}
							itemCanonicals={itemCanonicals}
							onCancel={() => setShowReview(false)}
						/>
					</div>
				)}

				{/* Print footer */}
				<p className="hidden pt-8 text-center text-xs text-muted-foreground print:block">
					Quartermaster
				</p>
			</div>

			{/* Mobile FAB + quick-add popover */}
			<MobileFabAdd
				open={fabOpen}
				onOpenChange={setFabOpen}
			/>
		</div>
	)
}
