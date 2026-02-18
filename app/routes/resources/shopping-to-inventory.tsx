import { invariantResponse } from '@epic-web/invariant'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { parseAmount } from '#app/utils/fractions.ts'
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

	const operations = [
		// Create inventory items for food only
		...foodItems.map((item) => {
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
					expiresAt: parseExpiresAt(item.expiresAt),
					userId,
					householdId,
				},
			})
		}),
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
		payload: { count: foodItems.length },
		userId,
		householdId,
	})

	const parts: string[] = []
	if (foodItems.length > 0) {
		parts.push(
			`${foodItems.length} item${foodItems.length !== 1 ? 's' : ''} added to inventory`,
		)
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
