import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useRef, useState } from 'react'
import { Form, Link, useFetcher, useRevalidator } from 'react-router'
import { ShoppingListItemCard } from '#app/components/shopping-list-item.tsx'
import { ShoppingListToInventory } from '#app/components/shopping-list-to-inventory.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { subscribeToHouseholdEvents } from '#app/utils/household-event-source.client.tsx'
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

const CATEGORY_LABELS: Record<string, string> = {
	produce: 'Produce',
	dairy: 'Dairy',
	meat: 'Meat & Seafood',
	pantry: 'Pantry',
	frozen: 'Frozen',
	bakery: 'Bakery',
	household: 'Household',
	other: 'Other',
}

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
		lastResult:
			actionData?.status === 'error' || actionData?.status === 'success'
				? actionData.submission
				: null,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: ShoppingListItemSchema })
		},
		shouldValidate: 'onBlur',
		shouldRevalidate: 'onInput',
	})

	const [search, setSearch] = useState('')
	const [showReview, setShowReview] = useState(false)
	const [quickAddOpen, setQuickAddOpen] = useState(false)

	// Warning dismiss state
	const [warningDismissed, setWarningDismissed] = useState(false)

	const allItems = shoppingList.items
	const totalItems = allItems.length
	const checkedItemsList = allItems.filter((item) => item.checked)
	const checkedItems = checkedItemsList.length

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
			<ShoppingListLiveRefresh />
			{/* Page Header */}
			<div className="border-border/50 border-b print:border-0">
				<div className="container-narrow py-4">
					<div className="flex items-center gap-3">
						<h1 className="font-serif text-2xl font-normal">
							Shopping List
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
											className="h-8 rounded-md border border-border bg-background px-2 text-sm"
										>
											{weeksWithPlans.map((week) => (
												<option key={week.weekStart} value={week.weekStart}>
													{week.label}
													{week.isCurrent ? ' (this week)' : ''}
												</option>
											))}
										</select>
									)}
									<Button type="submit" variant="outline" size="sm">
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
				{actionData &&
					'removedCount' in actionData &&
					typeof actionData.removedCount === 'number' &&
					actionData.removedCount > 0 && (
						<p className="text-muted-foreground container-narrow pb-4 text-center text-sm">
							{actionData.removedCount} items already in inventory or staples
						</p>
					)}
			</div>

			{/* Progress bar */}
			{totalItems > 0 && (
				<div className="container-narrow pt-5 print:hidden">
					<div className="h-1 overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full bg-primary transition-all duration-300"
							style={{
								width: `${(checkedItems / totalItems) * 100}%`,
							}}
						/>
					</div>
				</div>
			)}

			<div className="container-narrow py-4">
				{/* Low Stock Nudge */}
				{lowStockSuggestions.length > 0 && !showReview && (
					<div className="mb-4">
						<LowStockNudge items={lowStockSuggestions} />
					</div>
				)}

				{/* Quick Add — ruled line */}
				<div className="mb-2 print:hidden">
					{/* Warning banner */}
					{showWarning && (
						<WarningBanner
							actionData={actionData}
							onDismiss={() => setWarningDismissed(true)}
						/>
					)}

					<Form
						method="POST"
						{...getFormProps(form)}
						onChange={() => setWarningDismissed(false)}
					>
						<input type="hidden" name="intent" value="add" />
						{showWarning && (
							<input type="hidden" name="force" value="true" />
						)}
						<div className="flex items-end gap-2 border-b border-border pb-2">
							<div className="min-w-0 flex-1">
								<Input
									{...getInputProps(fields.name, { type: 'text' })}
									placeholder="Add an item..."
									defaultValue={
										showWarning && 'submittedName' in actionData
											? (actionData.submittedName as string)
											: undefined
									}
									className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
								/>
								{fields.name.errors && (
									<p className="text-destructive mt-1 text-sm">
										{fields.name.errors}
									</p>
								)}
							</div>
							<button
								type="submit"
								disabled={isPending}
								className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
								aria-label={showWarning ? 'Add anyway' : 'Add to list'}
							>
								<Icon name="plus" className="size-5" />
							</button>
						</div>
						{quickAddOpen && (
							<div className="flex items-end gap-3 border-b border-border/50 pt-1 pb-2">
								<div className="min-w-0 flex-1">
									<Input
										{...getInputProps(fields.quantity, { type: 'text' })}
										placeholder="Qty"
										defaultValue={
											showWarning && 'submittedQuantity' in actionData
												? ((actionData.submittedQuantity as string) ?? '')
												: undefined
										}
										className="border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
									/>
								</div>
								<div className="min-w-0 flex-1">
									<Input
										{...getInputProps(fields.unit, { type: 'text' })}
										placeholder="Unit"
										defaultValue={
											showWarning && 'submittedUnit' in actionData
												? ((actionData.submittedUnit as string) ?? '')
												: undefined
										}
										className="border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
									/>
								</div>
								<button
									type="button"
									onClick={() => setQuickAddOpen(false)}
									className="mb-0.5 shrink-0 text-xs text-muted-foreground/50 hover:text-muted-foreground"
								>
									Hide
								</button>
							</div>
						)}
						{!quickAddOpen && (
							<button
								type="button"
								onClick={() => setQuickAddOpen(true)}
								className="pt-1 text-xs text-muted-foreground/50 hover:text-muted-foreground"
							>
								+ Qty / Unit
							</button>
						)}
					</Form>
				</div>

				{/* Search — only shown with 15+ items */}
				{totalItems >= 15 && (
					<div className="relative mt-4 print:hidden">
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
								{filteredItems.map((item, index) => {
									const prevCategory =
										index > 0 ? filteredItems[index - 1]?.category : null
									const showHeader =
										!search && item.category !== prevCategory
									return (
										<div key={item.id}>
											{showHeader && (
												<h3
													className={`text-[0.75rem] font-medium tracking-[0.08em] uppercase ${index > 0 ? 'pt-5' : 'pt-1'} pb-0 text-[#A69B8F] dark:text-[#8A7F73]`}
												>
													{CATEGORY_LABELS[item.category ?? 'other'] ??
														'Other'}
												</h3>
											)}
											<ShoppingListItemCard item={item} />
										</div>
									)
								})}
							</div>
						)}

						{/* Checked Item Actions */}
						{checkedItems > 0 && !showReview && !search && (
							<div className="flex items-center justify-center gap-4 pt-4 animate-slide-up-reveal print:hidden">
								<button
									type="button"
									onClick={() => setShowReview(true)}
									className="text-sm text-primary hover:text-primary/80 underline underline-offset-2"
								>
									Add to inventory ({checkedItems})
								</button>
								<span className="text-border">·</span>
								<Form method="POST" className="inline">
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
									Hit Generate to build your list from the meal plan, or
									type above to add items.
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
									to auto-generate your list, or type above to add items.
								</>
							)}
						</p>
					</div>
				)}

				{/* Inventory Review Panel */}
				{showReview && checkedItems > 0 && !search && (
					<div className="mt-4 print:hidden">
						<ShoppingListToInventory
							items={checkedItemsList}
							onCancel={() => setShowReview(false)}
						/>
					</div>
				)}

				{/* Print footer */}
				<p className="hidden pt-8 text-center text-xs text-muted-foreground print:block">
					Quartermaster
				</p>
			</div>
		</div>
	)
}

// --- Live refresh via SSE ---

const SHOPPING_EVENT_TYPES = new Set([
	'shopping_list_generated',
	'shopping_list_item_added',
	'shopping_list_cleared',
	'shopping_list_to_inventory',
	'shopping_list_item_toggled',
	'shopping_list_item_edited',
	'shopping_list_item_deleted',
])

function ShoppingListLiveRefresh() {
	const { revalidate } = useRevalidator()
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		const unsubscribe = subscribeToHouseholdEvents((event) => {
			if (!SHOPPING_EVENT_TYPES.has(event.type)) return
			if (debounceRef.current) clearTimeout(debounceRef.current)
			debounceRef.current = setTimeout(() => {
				debounceRef.current = null
				void revalidate()
			}, 500)
		})

		return () => {
			unsubscribe()
			if (debounceRef.current) clearTimeout(debounceRef.current)
		}
	}, [revalidate])

	return null
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
		<div className="mb-6 rounded-lg bg-accent/8 p-4 print:hidden">
			<div className="mb-3 flex items-center justify-between gap-2">
				<h3 className="text-[0.75rem] font-medium tracking-[0.08em] uppercase text-accent">
					Running low
				</h3>
				<addAllFetcher.Form method="POST">
					<input type="hidden" name="intent" value="add-all-low-stock" />
					<input
						type="hidden"
						name="names"
						value={JSON.stringify(items.map((i) => i.name))}
					/>
					<button
						type="submit"
						className="text-xs text-accent underline underline-offset-2 hover:text-accent/80 disabled:opacity-50"
						disabled={isAddingAll}
					>
						{isAddingAll ? 'Adding...' : `Add all (${items.length})`}
					</button>
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
			<span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
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
				className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium transition-colors hover:border-accent/30 hover:bg-accent/5"
			>
				{item.name}
				<Icon name="plus" className="size-3 text-muted-foreground" />
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
			<div className="mb-3 flex items-start gap-2 rounded-lg bg-accent/10 p-3">
				<Icon
					name="question-mark-circled"
					className="mt-0.5 size-4 shrink-0 text-accent"
				/>
				<div className="flex-1 text-sm">
					<p className="font-medium">
						{actionData.existingName as string} is already on your list
						{qty ? ` (${qty})` : ''}.
					</p>
					<p className="text-muted-foreground mt-0.5">
						Tap + to add anyway, or{' '}
						<button
							type="button"
							onClick={onDismiss}
							className="text-primary underline underline-offset-2"
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
			<div className="mb-3 flex items-start gap-2 rounded-lg bg-accent/10 p-3">
				<Icon
					name="question-mark-circled"
					className="mt-0.5 size-4 shrink-0 text-accent"
				/>
				<div className="flex-1 text-sm">
					<p className="font-medium">
						{actionData.inventoryName as string} is in your {loc}
						{qty ? ` (${qty})` : ''}.
					</p>
					<p className="text-muted-foreground mt-0.5">
						Tap + to add anyway, or{' '}
						<button
							type="button"
							onClick={onDismiss}
							className="text-primary underline underline-offset-2"
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
