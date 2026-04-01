import { prisma } from '#app/utils/db.server.ts'
import {
	ingredientMatchesInventoryItem,
	isOptionalIngredient,
	isStapleIngredient,
} from '#app/utils/recipe-matching.server.ts'
import { guessCategory } from '#app/utils/shopping-list-validation.ts'

/**
 * After a recipe is cooked, find which of its non-staple, non-optional
 * ingredients are currently in the household's inventory.
 * Returns the matched inventory items for the user to review.
 * `preChecked` is true for perishables (produce, dairy, meat) and false
 * for pantry staples (sugar, oil, spices, stock) that last many uses.
 */
export async function getPostCookInventoryMatches(
	recipeId: string,
	householdId: string,
): Promise<Array<{ id: string; name: string; preChecked: boolean }>> {
	const [ingredients, inventoryItems] = await Promise.all([
		prisma.ingredient.findMany({
			where: { recipeId },
			select: { name: true, notes: true, isHeading: true },
		}),
		prisma.inventoryItem.findMany({
			where: { householdId },
			select: { id: true, name: true },
		}),
	])

	if (ingredients.length === 0 || inventoryItems.length === 0) return []

	const relevantIngredients = ingredients.filter(
		(ing) =>
			!ing.isHeading &&
			!isStapleIngredient(ing) &&
			!isOptionalIngredient(ing),
	)

	const matchedIds = new Set<string>()
	const matched: Array<{ id: string; name: string; preChecked: boolean }> = []

	for (const ingredient of relevantIngredients) {
		for (const item of inventoryItems) {
			if (matchedIds.has(item.id)) continue
			if (ingredientMatchesInventoryItem(ingredient, item)) {
				// Skip if the matched inventory item itself is a staple
				// (e.g., recipe says "peanut oil" matching inventory "vegetable oil")
				if (isStapleIngredient(item)) continue
				matchedIds.add(item.id)
				const category = guessCategory(item.name)
				matched.push({
					id: item.id,
					name: item.name,
					preChecked: category !== 'pantry',
				})
				break
			}
		}
	}

	return matched
}
