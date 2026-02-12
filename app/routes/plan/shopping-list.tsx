import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useState } from 'react'
import { Form, Link } from 'react-router'
import { ShoppingListItemCard } from '#app/components/shopping-list-item.tsx'
import { ShoppingListToInventory } from '#app/components/shopping-list-to-inventory.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
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
import { parseAmount } from '#app/utils/fractions.ts'
import { useIsPending } from '#app/utils/misc.tsx'
import {
	ShoppingListItemSchema,
	CATEGORY_LABELS,
} from '#app/utils/shopping-list-validation.ts'
import {
	generateShoppingListFromRecipes,
	subtractInventoryFromShoppingList,
} from '#app/utils/shopping-list.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type Route } from './+types/shopping-list.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Shopping List | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)

	// Get or create shopping list
	let shoppingList = await prisma.shoppingList.findFirst({
		where: { householdId },
		include: {
			items: {
				orderBy: [{ checked: 'asc' }, { category: 'asc' }, { name: 'asc' }],
			},
		},
	})

	if (!shoppingList) {
		shoppingList = await prisma.shoppingList.create({
			data: { userId, householdId },
			include: { items: true },
		})
	}

	// Group items by category
	const itemsByCategory = shoppingList.items.reduce(
		(acc, item) => {
			const category = item.category || 'other'
			if (!acc[category]) {
				acc[category] = []
			}
			acc[category].push(item)
			return acc
		},
		{} as Record<string, typeof shoppingList.items>,
	)

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
					mp.weekStart.getTime() === week.getTime() &&
					mp._count.entries > 0,
			),
		)
		.map((week) => ({
			weekStart: serializeDate(week),
			label: formatWeekRange(week),
			isCurrent: week.getTime() === currentWeek.getTime(),
		}))

	const hasMealPlan = weeksWithPlans.length > 0

	return {
		shoppingList,
		itemsByCategory,
		hasMealPlan,
		weeksWithPlans,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
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

		// Subtract items already in inventory (unless low stock) and staples
		const inventoryItems = await prisma.inventoryItem.findMany({
			where: { householdId },
		})
		const { items, removedCount } = subtractInventoryFromShoppingList(
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

		// Create new items
		await prisma.shoppingListItem.createMany({
			data: items.map((item) => ({
				...item,
				listId: shoppingList.id,
			})),
		})

		void emitHouseholdEvent({
			type: 'shopping_list_generated',
			payload: { count: items.length },
			userId,
			householdId,
		})

		return { status: 'success' as const, removedCount }
	}

	if (intent === 'add') {
		const submission = parseWithZod(formData, {
			schema: ShoppingListItemSchema,
		})
		if (submission.status !== 'success') {
			return { status: 'error' as const, submission: submission.reply() }
		}

		await prisma.shoppingListItem.create({
			data: {
				...submission.value,
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

		return { status: 'success' as const }
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

	if (intent === 'add-to-inventory') {
		const rawItems = formData.get('items')
		invariantResponse(typeof rawItems === 'string', 'Items are required')

		const VALID_LOCATIONS = new Set(['pantry', 'fridge', 'freezer'])

		let items: Array<{ itemId: string; location: string }>
		try {
			items = JSON.parse(rawItems) as Array<{
				itemId: string
				location: string
			}>
		} catch {
			throw new Response('Invalid items data', { status: 400 })
		}
		invariantResponse(Array.isArray(items) && items.length > 0, 'No items')

		// Verify all items belong to user's shopping list
		const shoppingListItems = await prisma.shoppingListItem.findMany({
			where: {
				id: { in: items.map((i) => i.itemId) },
				listId: shoppingList.id,
			},
		})

		const itemMap = new Map(shoppingListItems.map((i) => [i.id, i]))
		const validItems = items.filter(
			(i) => itemMap.has(i.itemId) && VALID_LOCATIONS.has(i.location),
		)
		invariantResponse(validItems.length > 0, 'No valid items found')

		await prisma.$transaction([
			// Create inventory items
			...validItems.map((item) => {
				const shoppingItem = itemMap.get(item.itemId)!
				const quantity = shoppingItem.quantity
					? parseAmount(shoppingItem.quantity)
					: null
				return prisma.inventoryItem.create({
					data: {
						name: shoppingItem.name,
						location: item.location,
						quantity,
						unit: shoppingItem.unit,
						userId,
						householdId,
					},
				})
			}),
			// Delete those shopping list items
			prisma.shoppingListItem.deleteMany({
				where: {
					id: { in: validItems.map((i) => i.itemId) },
				},
			}),
		])

		void emitHouseholdEvent({
			type: 'shopping_list_to_inventory',
			payload: { count: validItems.length },
			userId,
			householdId,
		})

		return redirectWithToast('/plan/shopping-list', {
			type: 'success',
			description: `${validItems.length} item${validItems.length !== 1 ? 's' : ''} added to inventory`,
		})
	}

	return { status: 'error' as const }
}

export default function ShoppingListRoute({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { itemsByCategory, hasMealPlan, weeksWithPlans } = loaderData
	const [selectedWeek, setSelectedWeek] = useState(
		() =>
			weeksWithPlans.find((w) => w.isCurrent)?.weekStart ??
			weeksWithPlans[0]?.weekStart ??
			'',
	)
	const isPending = useIsPending()

	const [form, fields] = useForm({
		lastResult: actionData?.status === 'error' ? actionData.submission : null,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: ShoppingListItemSchema })
		},
		shouldValidate: 'onBlur',
		shouldRevalidate: 'onInput',
	})

	const [search, setSearch] = useState('')
	const [showReview, setShowReview] = useState(false)
	// Tracks explicit user overrides: true = forced open, false = forced closed
	const [sectionOverrides, setSectionOverrides] = useState<
		Map<string, boolean>
	>(new Map())

	const categories = Object.keys(itemsByCategory).sort()
	const allItems = Object.values(itemsByCategory).flat()
	const totalItems = allItems.length
	const checkedItemsList = allItems.filter((item) => item.checked)
	const checkedItems = checkedItemsList.length
	const progressPercent =
		totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0

	const searchLower = search.toLowerCase()
	const filteredCategories = categories
		.map((category) => {
			const items = itemsByCategory[category]
			if (!items || items.length === 0) return null
			const filtered = search
				? items.filter((i) => i.name.toLowerCase().includes(searchLower))
				: items
			if (filtered.length === 0) return null
			return { category, filtered }
		})
		.filter(Boolean) as Array<{
		category: string
		filtered: (typeof allItems)[number][]
	}>

	const toggleSection = (category: string) => {
		setSectionOverrides((prev) => {
			const next = new Map(prev)
			const currentlyOpen = isSectionOpen(category)
			next.set(category, !currentlyOpen)
			return next
		})
	}

	// A section is "open" if: user explicitly set it, or default (open unless fully checked)
	const isSectionOpen = (category: string) => {
		const override = sectionOverrides.get(category)
		if (override !== undefined) return override
		const items = itemsByCategory[category]
		if (!items) return false
		// Auto-collapse fully checked sections by default
		return !items.every((item) => item.checked)
	}

	return (
		<div className="pb-20 md:pb-6">
			{/* Page Header */}
			<div className="from-card to-background border-border/50 border-b bg-gradient-to-b">
				<div className="container flex items-center gap-3 py-6">
					<Button asChild variant="ghost" size="icon" className="print:hidden">
						<Link to="/plan">
							<Icon name="arrow-left" size="sm" />
						</Link>
					</Button>
					<div className="flex-1">
						<h1 className="text-2xl font-bold">Shopping List</h1>
						{totalItems > 0 && (
							<p className="text-muted-foreground mt-1 text-sm">
								{checkedItems} of {totalItems} checked
							</p>
						)}
					</div>
					<div className="flex gap-2 print:hidden">
						{totalItems > 0 && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => window.print()}
							>
								<Icon name="file-text" size="sm" />
								Print
							</Button>
						)}
					</div>
				</div>
			</div>

			<div className="container py-6">
				{/* Progress Bar */}
				{totalItems > 0 && (
					<div className="mb-6 print:hidden">
						<div className="flex items-center gap-3">
							<div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
								<div
									className="bg-accent h-full rounded-full transition-all duration-300"
									style={{ width: `${progressPercent}%` }}
								/>
							</div>
							<span className="text-muted-foreground w-10 text-right text-sm tabular-nums">
								{progressPercent}%
							</span>
						</div>
					</div>
				)}

				{/* Generate from Meal Plan */}
				{hasMealPlan && (
					<div className="mb-6 print:hidden">
						<Form method="POST">
							<input type="hidden" name="intent" value="generate" />
							<input type="hidden" name="weekStart" value={selectedWeek} />
							{weeksWithPlans.length > 1 && (
								<div className="mb-2">
									<select
										value={selectedWeek}
										onChange={(e) => setSelectedWeek(e.target.value)}
										className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
									>
										{weeksWithPlans.map((week) => (
											<option key={week.weekStart} value={week.weekStart}>
												{week.label}
												{week.isCurrent ? ' (this week)' : ''}
											</option>
										))}
									</select>
								</div>
							)}
							<Button type="submit" variant="outline" className="w-full">
								<Icon name="update" size="sm" />
								Generate from Meal Plan
							</Button>
						</Form>
						{actionData &&
							'removedCount' in actionData &&
							typeof actionData.removedCount === 'number' &&
							actionData.removedCount > 0 && (
								<p className="text-muted-foreground mt-2 text-center text-sm">
									{actionData.removedCount} items removed (already in inventory
									or staples)
								</p>
							)}
					</div>
				)}

				{/* Add Manual Item */}
				<div className="bg-card mb-6 rounded-lg border p-4 print:hidden">
					<h2 className="mb-3 font-semibold">Add Item</h2>
					<Form method="POST" {...getFormProps(form)}>
						<input type="hidden" name="intent" value="add" />
						<div className="space-y-3">
							<div>
								<Label htmlFor={fields.name.id}>Item Name</Label>
								<Input
									{...getInputProps(fields.name, { type: 'text' })}
									placeholder="e.g., Milk, Eggs, Flour"
								/>
								{fields.name.errors && (
									<p className="text-destructive mt-1 text-sm">
										{fields.name.errors}
									</p>
								)}
							</div>
							<div className="flex gap-2">
								<div className="flex-1">
									<Label htmlFor={fields.quantity.id}>Quantity</Label>
									<Input
										{...getInputProps(fields.quantity, { type: 'text' })}
										placeholder="e.g., 2, 1/2"
									/>
								</div>
								<div className="flex-1">
									<Label htmlFor={fields.unit.id}>Unit</Label>
									<Input
										{...getInputProps(fields.unit, { type: 'text' })}
										placeholder="e.g., cups, lbs"
									/>
								</div>
							</div>
							<StatusButton
								type="submit"
								status={isPending ? 'pending' : 'idle'}
								disabled={isPending}
								className="w-full"
							>
								<Icon name="plus" size="sm" />
								Add to List
							</StatusButton>
						</div>
					</Form>
				</div>

				{/* Search */}
				{totalItems > 0 && (
					<div className="relative mb-6 print:hidden">
						<Icon
							name="magnifying-glass"
							size="sm"
							className="text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2"
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

				{/* Items by Category */}
				{totalItems > 0 ? (
					<div className="space-y-6">
						{search && filteredCategories.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-16 text-center">
								<div className="bg-accent/10 flex size-20 items-center justify-center rounded-2xl">
									<Icon
										name="magnifying-glass"
										className="text-accent/50 size-10"
									/>
								</div>
								<h3 className="mt-4 font-serif text-lg font-semibold">
									No items matching &ldquo;{search}&rdquo;
								</h3>
								<p className="text-muted-foreground mt-2 max-w-sm text-sm">
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
							<>
								{filteredCategories.map(({ category, filtered }) => {
									const categoryChecked = filtered.filter(
										(i) => i.checked,
									).length
									const isOpen = isSectionOpen(category)

									return (
										<div key={category}>
											<button
												type="button"
												onClick={() => toggleSection(category)}
												className="mb-2 flex w-full items-center gap-2 text-left"
											>
												<Icon
													name="chevron-down"
													size="sm"
													className={`text-muted-foreground transition-transform ${!isOpen ? '-rotate-90' : ''}`}
												/>
												<h3 className="text-sm font-semibold capitalize">
													{CATEGORY_LABELS[category] || category}
												</h3>
												<span className="text-muted-foreground text-xs">
													({categoryChecked}/{filtered.length})
												</span>
											</button>
											{isOpen && (
												<div className="space-y-2 pl-6">
													{filtered.map((item) => (
														<ShoppingListItemCard
															key={item.id}
															item={item}
														/>
													))}
												</div>
											)}
										</div>
									)
								})}
							</>
						)}

						{/* Checked Item Actions */}
						{checkedItems > 0 && !showReview && !search && (
							<div className="space-y-2 print:hidden">
								<Button
									variant="default"
									className="w-full"
									onClick={() => setShowReview(true)}
								>
									<Icon name="plus" size="sm" />
									Add Checked to Inventory ({checkedItems})
								</Button>
								<Form method="POST">
									<input type="hidden" name="intent" value="clear-checked" />
									<Button type="submit" variant="outline" className="w-full">
										<Icon name="trash" size="sm" />
										Clear Checked Items ({checkedItems})
									</Button>
								</Form>
							</div>
						)}

						{/* Inventory Review Panel */}
						{showReview && checkedItems > 0 && !search && (
							<div className="print:hidden">
								<ShoppingListToInventory
									items={checkedItemsList}
									onCancel={() => setShowReview(false)}
								/>
							</div>
						)}
					</div>
				) : (
					<div className="rounded-2xl border border-dashed p-8 text-center">
						<div className="bg-accent/10 mx-auto flex size-20 items-center justify-center rounded-2xl">
							<Icon name="file-text" className="text-accent/50 size-10" />
						</div>
						<h3 className="mt-4 font-serif text-lg font-semibold">
							Nothing on the list
						</h3>
						<p className="text-muted-foreground mx-auto mt-2 max-w-sm text-sm">
							{hasMealPlan ? (
								<>
									Generate one from your meal plan above, or add items manually.
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
									to auto-generate your list, or add items manually above.
								</>
							)}
						</p>
					</div>
				)}
			</div>
		</div>
	)
}
