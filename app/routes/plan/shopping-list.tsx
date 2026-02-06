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
import { requireUserId } from '#app/utils/auth.server.ts'
import { getCurrentWeekStart } from '#app/utils/date.ts'
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
	const userId = await requireUserId(request)

	// Get or create shopping list
	let shoppingList = await prisma.shoppingList.findFirst({
		where: { userId },
		include: {
			items: {
				orderBy: [{ checked: 'asc' }, { category: 'asc' }, { name: 'asc' }],
			},
		},
	})

	if (!shoppingList) {
		shoppingList = await prisma.shoppingList.create({
			data: { userId },
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

	// Check if user has a current meal plan
	const weekStart = getCurrentWeekStart()
	const mealPlan = await prisma.mealPlan.findFirst({
		where: { userId, weekStart },
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

	const hasMealPlan = mealPlan && mealPlan.entries.length > 0

	return {
		shoppingList,
		itemsByCategory,
		hasMealPlan,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	// Get user's shopping list
	let shoppingList = await prisma.shoppingList.findFirst({
		where: { userId },
	})

	if (!shoppingList) {
		shoppingList = await prisma.shoppingList.create({
			data: { userId },
		})
	}

	if (intent === 'generate') {
		// Get current week's meal plan
		const weekStart = getCurrentWeekStart()
		const mealPlan = await prisma.mealPlan.findFirst({
			where: { userId, weekStart },
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
			where: { userId },
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

		return { status: 'success' as const }
	}

	if (intent === 'toggle') {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Item ID is required')

		const item = await prisma.shoppingListItem.findFirst({
			where: {
				id: itemId,
				list: { userId },
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
				list: { userId },
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
	const { itemsByCategory, hasMealPlan } = loaderData
	const isPending = useIsPending()

	const [form, fields] = useForm({
		lastResult: actionData?.status === 'error' ? actionData.submission : null,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: ShoppingListItemSchema })
		},
		shouldValidate: 'onBlur',
		shouldRevalidate: 'onInput',
	})

	const [showReview, setShowReview] = useState(false)

	const categories = Object.keys(itemsByCategory).sort()
	const allItems = Object.values(itemsByCategory).flat()
	const totalItems = allItems.length
	const checkedItemsList = allItems.filter((item) => item.checked)
	const checkedItems = checkedItemsList.length

	return (
		<div className="pb-20 md:pb-6">
			{/* Page Header */}
			<div className="bg-muted/30">
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
					{totalItems > 0 && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => window.print()}
							className="print:hidden"
						>
							<Icon name="file-text" size="sm" />
							Print
						</Button>
					)}
				</div>
			</div>

			<div className="container py-6">

			{/* Generate from Meal Plan */}
			{hasMealPlan && (
				<div className="mb-6 print:hidden">
					<Form method="POST">
						<input type="hidden" name="intent" value="generate" />
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
								{actionData.removedCount} items removed (already in inventory or
								staples)
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

			{/* Items by Category */}
			{totalItems > 0 ? (
				<div className="space-y-6">
					{categories.map((category) => {
						const items = itemsByCategory[category]
						if (!items || items.length === 0) return null

						return (
							<div key={category}>
								<h3 className="text-muted-foreground mb-3 text-sm font-semibold uppercase">
									{CATEGORY_LABELS[category] || category}
								</h3>
								<div className="space-y-2">
									{items.map((item) => (
										<ShoppingListItemCard key={item.id} item={item} />
									))}
								</div>
							</div>
						)
					})}

					{/* Checked Item Actions */}
					{checkedItems > 0 && !showReview && (
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
					{showReview && checkedItems > 0 && (
						<div className="print:hidden">
							<ShoppingListToInventory
								items={checkedItemsList}
								onCancel={() => setShowReview(false)}
							/>
						</div>
					)}
				</div>
			) : (
				<div className="rounded-lg border border-dashed p-8 text-center">
					<div className="bg-muted/50 mx-auto flex size-20 items-center justify-center rounded-full">
						<Icon
							name="file-text"
							className="text-muted-foreground size-10"
						/>
					</div>
					<h3 className="mt-4 font-semibold">Your shopping list is empty</h3>
					<p className="text-muted-foreground mt-2 mx-auto max-w-sm text-sm">
						{hasMealPlan
							? 'Generate items from your meal plan or add items manually above.'
							: 'Create a meal plan first to auto-generate your list, or add items manually above.'}
					</p>
				</div>
			)}
			</div>
		</div>
	)
}
