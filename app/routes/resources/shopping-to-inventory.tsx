import { invariantResponse } from '@epic-web/invariant'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { findMatchingInventoryItem } from '#app/utils/inventory-dedup.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type Route } from './+types/shopping-to-inventory.ts'

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

	let items: Array<{
		itemId: string
	}>
	try {
		items = JSON.parse(rawItems) as Array<{
			itemId: string
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
	const validItems = items.filter((i) => itemMap.has(i.itemId))
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
	let skippedCount = 0

	for (const item of foodItems) {
		const shoppingItem = itemMap.get(item.itemId)!

		const match = findMatchingInventoryItem(
			shoppingItem.name,
			trackingItems,
		)

		if (match) {
			skippedCount++
		} else {
			const normalizedName = shoppingItem.name.toLowerCase()
			creates.push({
				data: {
					name: normalizedName,
					userId,
					householdId,
				},
			})
			// Add to tracking for intra-batch dedup
			trackingItems.push({
				id: `pending-${creates.length}`,
				name: normalizedName,
				userId,
				householdId,
				createdAt: new Date(),
				updatedAt: new Date(),
			} as typeof existingInventory[number])
		}
	}

	const operations = [
		...creates.map((c) => prisma.inventoryItem.create(c)),
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
		payload: { count: creates.length },
		userId,
		householdId,
	})

	const parts: string[] = []
	if (creates.length > 0) {
		parts.push(
			`${creates.length} item${creates.length !== 1 ? 's' : ''} added to inventory`,
		)
	}
	if (skippedCount > 0) {
		parts.push(`${skippedCount} already in inventory`)
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
