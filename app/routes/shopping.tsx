import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useState } from 'react'
import { Form, Link, useFetcher } from 'react-router'
import { ShoppingListItemCard } from '#app/components/shopping-list-item.tsx'
import { ShoppingListToInventory } from '#app/components/shopping-list-to-inventory.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireProTier } from '#app/utils/subscription.server.ts'
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
import { useIsPending } from '#app/utils/misc.tsx'
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
	subtractInventoryFromShoppingList,
} from '#app/utils/shopping-list.server.ts'
import { type Route } from './+types/shopping.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Shopping List | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireProTier(request)

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

	// Low-stock inventory items as suggestions
	const lowStockItems = await prisma.inventoryItem.findMany({
		where: { householdId, lowStock: true },
		select: {
			id: true,
			name: true,
			location: true,
			quantity: true,
			unit: true,
		},
	})

	// Filter out items already on the shopping list by canonical name
	const shoppingCanonicals = new Set(
		shoppingList.items.map((item) => getCanonicalIngredientName(item.name)),
	)
	const lowStockSuggestions = lowStockItems.filter(
		(item) => !shoppingCanonicals.has(getCanonicalIngredientName(item.name)),
	)

	return {
		shoppingList,
		hasMealPlan,
		weeksWithPlans,
		lowStockSuggestions,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireProTier(request)
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

		// Create new items
		await prisma.shoppingListItem.createMany({
			data: dedupedItems.map((item) => ({
				...item,
				listId: shoppingList.id,
			})),
		})

		void emitHouseholdEvent({
			type: 'shopping_list_generated',
			payload: { count: dedupedItems.length },
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
					inventoryQuantity: inInventory.quantity,
					inventoryUnit: inInventory.unit,
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
	const { shoppingList, hasMealPlan, weeksWithPlans, lowStockSuggestions } =
		loaderData
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
	const [quickAddOpen, setQuickAddOpen] = useState(true)

	// Warning dismiss state
	const [warningDismissed, setWarningDismissed] = useState(false)

	const allItems = shoppingList.items
	const totalItems = allItems.length
	const checkedItemsList = allItems.filter((item) => item.checked)
	const checkedItems = checkedItemsList.length

	// Flat filtered list (no category grouping)
	const searchLower = search.toLowerCase()
	const filteredItems = search
		? allItems.filter((i) => i.name.toLowerCase().includes(searchLower))
		: allItems

	// Determine if we should show a warning
	const showWarning =
		!warningDismissed &&
		actionData &&
		'warningType' in actionData &&
		actionData.status === 'warning'

	return (
		<div className="pb-20 md:pb-6">
			{/* Page Header */}
			<div className="from-card to-background border-border/50 border-b bg-linear-to-b print:border-0">
				<div className="container py-4">
					<div className="flex items-center gap-3">
						<h1 className="text-2xl font-bold">
							Shopping List
							{totalItems > 0 && (
								<span className="text-muted-foreground ml-2 text-base font-normal">
									{checkedItems}/{totalItems}
								</span>
							)}
						</h1>
						<div className="ml-auto flex items-center gap-2 print:hidden">
							{hasMealPlan && (
								<Form method="POST" className="flex items-center gap-2">
									<input type="hidden" name="intent" value="generate" />
									<input type="hidden" name="weekStart" value={selectedWeek} />
									{weeksWithPlans.length > 1 && (
										<select
											value={selectedWeek}
											onChange={(e) => setSelectedWeek(e.target.value)}
											className="border-input bg-background hidden h-9 rounded-md border px-2 text-sm sm:block"
										>
											{weeksWithPlans.map((week) => (
												<option key={week.weekStart} value={week.weekStart}>
													{week.label}
													{week.isCurrent ? ' (this week)' : ''}
												</option>
											))}
										</select>
									)}
									<Button
										type="submit"
										variant="outline"
										size="icon"
										className="sm:hidden"
										aria-label="Generate from meal plan"
									>
										<Icon name="update" size="sm" />
									</Button>
									<Button
										type="submit"
										variant="outline"
										size="sm"
										className="hidden sm:inline-flex"
									>
										<Icon name="update" size="sm" />
										Generate
									</Button>
								</Form>
							)}
							{totalItems > 0 && (
								<Button
									variant="outline"
									size="icon"
									onClick={() => window.print()}
									aria-label="Print shopping list"
									className="sm:hidden"
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
				{actionData &&
					'removedCount' in actionData &&
					typeof actionData.removedCount === 'number' &&
					actionData.removedCount > 0 && (
						<p className="text-muted-foreground container pb-4 text-center text-sm">
							{actionData.removedCount} items already in inventory or staples
						</p>
					)}
			</div>

			<div className="container py-6">
				{/* Quick Add — collapsible */}
				<div className="mb-6 print:hidden">
					<button
						type="button"
						onClick={() => setQuickAddOpen((v) => !v)}
						className="bg-card flex w-full items-center gap-2 rounded-lg border px-4 py-3 text-left text-sm font-semibold"
					>
						<Icon name="plus" size="sm" />
						Quick Add
						<Icon
							name="chevron-down"
							size="sm"
							className={`text-muted-foreground ml-auto transition-transform ${!quickAddOpen ? '-rotate-90' : ''}`}
						/>
					</button>
					{quickAddOpen && (
						<div className="bg-card rounded-b-lg border border-t-0 p-4">
							{/* Warning banner */}
							{showWarning && (
								<WarningBanner
									actionData={actionData}
									onDismiss={() => setWarningDismissed(true)}
								/>
							)}

							<Form
								key={totalItems}
								method="POST"
								{...getFormProps(form)}
								onChange={() => setWarningDismissed(false)}
							>
								<input type="hidden" name="intent" value="add" />
								{showWarning && (
									<input type="hidden" name="force" value="true" />
								)}
								<div className="space-y-3">
									<div>
										<Label htmlFor={fields.name.id}>Item Name</Label>
										<Input
											{...getInputProps(fields.name, { type: 'text' })}
											placeholder="e.g., Milk, Eggs, Toilet Paper"
											defaultValue={
												showWarning && 'submittedName' in actionData
													? (actionData.submittedName as string)
													: undefined
											}
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
												defaultValue={
													showWarning && 'submittedQuantity' in actionData
														? ((actionData.submittedQuantity as string) ?? '')
														: undefined
												}
											/>
										</div>
										<div className="flex-1">
											<Label htmlFor={fields.unit.id}>Unit</Label>
											<Input
												{...getInputProps(fields.unit, { type: 'text' })}
												placeholder="e.g., cups, lbs"
												defaultValue={
													showWarning && 'submittedUnit' in actionData
														? ((actionData.submittedUnit as string) ?? '')
														: undefined
												}
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
										{showWarning ? 'Add Anyway' : 'Add to List'}
									</StatusButton>
								</div>
							</Form>
						</div>
					)}
				</div>

				{/* Low Stock Nudge */}
				{lowStockSuggestions.length > 0 && !showReview && (
					<LowStockNudge items={lowStockSuggestions} />
				)}

				{/* Search */}
				{totalItems > 0 && (
					<div className="relative mb-4 print:hidden">
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

				{/* Item List — flat, no category headers */}
				{totalItems > 0 ? (
					<div className="space-y-4">
						{search && filteredItems.length === 0 ? (
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
							<div className="space-y-2">
								{filteredItems.map((item) => (
									<ShoppingListItemCard key={item.id} item={item} />
								))}
							</div>
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
							<Icon name="cart" className="text-accent/50 size-10" />
						</div>
						<h3 className="mt-4 font-serif text-lg font-semibold">
							Nothing on the list
						</h3>
						<p className="text-muted-foreground mx-auto mt-2 max-w-sm text-sm">
							{hasMealPlan ? (
								<>
									Hit Generate to build your list from the meal plan, or add
									items manually.
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
									to auto-generate your list, or add items manually.
								</>
							)}
						</p>
					</div>
				)}
			</div>
		</div>
	)
}

// --- Low stock nudge ---

type LowStockItem = {
	id: string
	name: string
	location: string
	quantity: number | null
	unit: string | null
}

function LowStockNudge({ items }: { items: LowStockItem[] }) {
	const addAllFetcher = useFetcher()
	const isAddingAll = addAllFetcher.state !== 'idle'

	return (
		<div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30 print:hidden">
			<div className="mb-3 flex items-center justify-between gap-2">
				<h3 className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
					<Icon name="question-mark-circled" className="size-4" />
					Running low
				</h3>
				<addAllFetcher.Form method="POST">
					<input type="hidden" name="intent" value="add-all-low-stock" />
					<input
						type="hidden"
						name="names"
						value={JSON.stringify(items.map((i) => i.name))}
					/>
					<Button
						type="submit"
						variant="ghost"
						size="sm"
						className="h-7 text-xs text-amber-800 dark:text-amber-200"
						disabled={isAddingAll}
					>
						{isAddingAll ? 'Adding...' : `Add All (${items.length})`}
					</Button>
				</addAllFetcher.Form>
			</div>
			<div className="flex flex-wrap gap-2">
				{items.map((item) => (
					<LowStockChip key={item.id} item={item} />
				))}
			</div>
		</div>
	)
}

function LowStockChip({ item }: { item: LowStockItem }) {
	const fetcher = useFetcher()
	const isAdding = fetcher.state !== 'idle'

	if (isAdding) {
		return (
			<span className="inline-flex items-center gap-1 rounded-full border border-green-300 bg-green-50 px-3 py-1 text-xs font-medium text-green-700 dark:border-green-700 dark:bg-green-950/30 dark:text-green-400">
				<Icon name="check" className="size-3" />
				{item.name}
			</span>
		)
	}

	return (
		<fetcher.Form method="POST">
			<input type="hidden" name="intent" value="add-low-stock" />
			<input type="hidden" name="itemName" value={item.name} />
			<button
				type="submit"
				className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
			>
				{item.name}
				<Icon name="plus" className="size-3" />
			</button>
		</fetcher.Form>
	)
}

// --- Warning banner for duplicate/inventory items ---

function WarningBanner({
	actionData,
	onDismiss,
}: {
	actionData: Record<string, unknown>
	onDismiss: () => void
}) {
	if (actionData.warningType === 'already_on_list') {
		const qty = actionData.existingQuantity
			? `${actionData.existingQuantity}${actionData.existingUnit ? ` ${actionData.existingUnit}` : ''}`
			: null
		return (
			<div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
				<Icon
					name="question-mark-circled"
					className="mt-0.5 size-4 shrink-0 text-amber-600"
				/>
				<div className="flex-1 text-sm">
					<p className="font-medium text-amber-800 dark:text-amber-200">
						{actionData.existingName as string} is already on your list
						{qty ? ` (${qty})` : ''}.
					</p>
					<p className="text-muted-foreground mt-0.5">
						Submit again to add anyway, or{' '}
						<button
							type="button"
							onClick={onDismiss}
							className="text-primary underline"
						>
							cancel
						</button>
						.
					</p>
				</div>
			</div>
		)
	}

	if (actionData.warningType === 'in_inventory') {
		const loc = actionData.inventoryLocation as string
		const qty = actionData.inventoryQuantity
			? `${actionData.inventoryQuantity}${actionData.inventoryUnit ? ` ${actionData.inventoryUnit}` : ''}`
			: null
		return (
			<div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
				<Icon
					name="question-mark-circled"
					className="mt-0.5 size-4 shrink-0 text-amber-600"
				/>
				<div className="flex-1 text-sm">
					<p className="font-medium text-amber-800 dark:text-amber-200">
						{actionData.inventoryName as string} is in your {loc}
						{qty ? ` (${qty})` : ''}.
					</p>
					<p className="text-muted-foreground mt-0.5">
						Submit again to add anyway, or{' '}
						<button
							type="button"
							onClick={onDismiss}
							className="text-primary underline"
						>
							cancel
						</button>
						.
					</p>
				</div>
			</div>
		)
	}

	return null
}
