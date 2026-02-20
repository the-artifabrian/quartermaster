import { invariantResponse } from '@epic-web/invariant'
import { prisma } from '#app/utils/db.server.ts'
import { parseAmount } from '#app/utils/fractions.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import {
	findMatchingInventoryItem,
	buildMergeData,
} from '#app/utils/inventory-dedup.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type Route } from './+types/shopping-to-inventory.ts'

function parseExpiresAt(value?: string | null): Date | null {
	if (!value) return null
	const d = new Date(value)
	if (isNaN(d.getTime())) return null
	return d
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireProTier(request)
	const formData = await request.formData()

	// Get user's shopping list
	const shoppingList = await prisma.shoppingList.findFirst({
		where: { householdId },
	})
	invariantResponse(shoppingList, 'Shopping list not found', { status: 404 })

	const rawItems = formData.get('items')
	invariantResponse(typeof rawItems === 'string', 'Items are required')

	const VALID_LOCATIONS = new Set(['pantry', 'fridge', 'freezer'])

	let items: Array<{
		itemId: string
		location: string
		expiresAt?: string | null
	}>
	try {
		items = JSON.parse(rawItems) as Array<{
			itemId: string
			location: string
			expiresAt?: string | null
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

	// Separate household items (skip inventory creation) from food items
	const foodItems = validItems.filter(
		(i) => itemMap.get(i.itemId)!.category !== 'household',
	)
	const householdItems = validItems.filter(
		(i) => itemMap.get(i.itemId)!.category === 'household',
	)

	// Load existing inventory for dedup
	const existingInventory = await prisma.inventoryItem.findMany({
		where: { householdId },
	})
	const trackingItems = [...existingInventory]

	const creates: Array<Parameters<typeof prisma.inventoryItem.create>[0]> = []
	// Accumulate merges per inventory item to avoid redundant updates
	const updateMap = new Map<string, Record<string, unknown>>()
	let mergedCount = 0

	for (const item of foodItems) {
		const shoppingItem = itemMap.get(item.itemId)!
		const quantity = shoppingItem.quantity
			? parseAmount(shoppingItem.quantity)
			: null
		const expiresAt = parseExpiresAt(item.expiresAt)

		const match = findMatchingInventoryItem(
			shoppingItem.name,
			item.location,
			trackingItems,
		)

		if (match) {
			const mergeData = buildMergeData(
				match,
				quantity,
				shoppingItem.unit,
				expiresAt,
			)
			// Always clear lowStock — buying from shopping list means restocked
			mergeData.lowStock = false
			// Update tracking item in-place so subsequent matches see accumulated state
			Object.assign(match, mergeData)
			// Store only the latest accumulated state per item
			updateMap.set(match.id, { ...mergeData })
			mergedCount++
		} else {
			creates.push({
				data: {
					name: shoppingItem.name,
					location: item.location,
					quantity,
					unit: shoppingItem.unit,
					expiresAt,
					userId,
					householdId,
				},
			})
			// Add to tracking for intra-batch dedup
			trackingItems.push({
				id: `pending-${creates.length}`,
				name: shoppingItem.name,
				location: item.location,
				quantity,
				unit: shoppingItem.unit,
				expiresAt,
				lowStock: false,
				userId,
				householdId,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
		}
	}

	const operations = [
		...creates.map((c) => prisma.inventoryItem.create(c)),
		...[...updateMap.entries()].map(([id, data]) =>
			prisma.inventoryItem.update({ where: { id }, data }),
		),
		// Delete all checked items from shopping list (both food and household)
		prisma.shoppingListItem.deleteMany({
			where: {
				id: { in: validItems.map((i) => i.itemId) },
			},
		}),
	]

	await prisma.$transaction(operations)

	void emitHouseholdEvent({
		type: 'shopping_list_to_inventory',
		payload: { count: creates.length + mergedCount },
		userId,
		householdId,
	})

	const parts: string[] = []
	if (creates.length > 0) {
		parts.push(
			`${creates.length} item${creates.length !== 1 ? 's' : ''} added to inventory`,
		)
	}
	if (mergedCount > 0) {
		parts.push(`${mergedCount} merged with existing`)
	}
	if (householdItems.length > 0) {
		parts.push(
			`${householdItems.length} household item${householdItems.length !== 1 ? 's' : ''} cleared`,
		)
	}

	return redirectWithToast('/shopping', {
		type: 'success',
		description: parts.join(', '),
	})
}
