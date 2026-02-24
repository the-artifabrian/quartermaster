import { prisma } from './db.server.ts'
import {
	ingredientMatchesInventoryItem,
	isStapleIngredient,
} from './recipe-matching.server.ts'

export type CheckInItem = {
	id: string
	name: string
	location: string
	quantity: number | null
	unit: string | null
	lowStock: boolean
}

/**
 * After cooking a recipe, find inventory items that match the recipe's
 * ingredients. Returns a list of items for the user to review
 * ("Anything running low?") — no quantity math involved.
 */
export async function getPostCookCheckInItems(
	recipeId: string,
	householdId: string,
): Promise<CheckInItem[]> {
	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		include: { ingredients: true },
	})

	if (!recipe) return []

	const inventoryItems = await prisma.inventoryItem.findMany({
		where: { householdId },
	})

	const matchedIds = new Set<string>()
	const result: CheckInItem[] = []

	for (const ingredient of recipe.ingredients) {
		if (ingredient.isHeading) continue
		if (isStapleIngredient(ingredient)) continue

		const match = inventoryItems.find(
			(item) =>
				!matchedIds.has(item.id) &&
				ingredientMatchesInventoryItem(ingredient, item),
		)
		if (!match) continue

		matchedIds.add(match.id)
		result.push({
			id: match.id,
			name: match.name,
			location: match.location,
			quantity: match.quantity,
			unit: match.unit,
			lowStock: match.lowStock,
		})
	}

	return result
}
