import { prisma } from './db.server.ts'
import { parseAmount } from './fractions.ts'
import {
	ingredientMatchesInventoryItem,
	isStapleIngredient,
} from './recipe-matching.server.ts'
import { normalizeUnit, getUnitFamily } from './unit-conversion.ts'

/**
 * After cooking a recipe, subtract its ingredients from the user's inventory.
 *
 * @param recipeId - The recipe that was cooked
 * @param userId - The user who cooked it
 * @param servingRatio - Ratio of cooked servings to recipe default (e.g., 2.0 if doubled)
 *
 * For each non-staple ingredient:
 * - Find a matching inventory item
 * - If both have numeric quantities with compatible units, subtract
 * - If the inventory quantity drops to 0 or below, mark as low stock
 * - If units are incompatible or quantities are missing, skip silently
 */
export async function subtractRecipeIngredientsFromInventory(
	recipeId: string,
	userId: string,
	servingRatio: number = 1,
) {
	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		include: { ingredients: true },
	})

	if (!recipe) return

	const inventoryItems = await prisma.inventoryItem.findMany({
		where: { userId },
	})

	for (const ingredient of recipe.ingredients) {
		if (isStapleIngredient(ingredient)) continue

		const match = inventoryItems.find((item) =>
			ingredientMatchesInventoryItem(ingredient, item),
		)
		if (!match) continue

		// Both need numeric quantities
		if (match.quantity === null || !ingredient.amount) continue

		const ingredientAmount = parseAmount(ingredient.amount)
		if (ingredientAmount === null) continue

		// Scale by serving ratio
		const scaledAmount = ingredientAmount * servingRatio

		const ingredientUnit = ingredient.unit
			? normalizeUnit(ingredient.unit)
			: ''
		const inventoryUnit = match.unit ? normalizeUnit(match.unit) : ''

		// Same unit after normalization — subtract directly
		if (ingredientUnit === inventoryUnit) {
			const newQuantity = match.quantity - scaledAmount
			await prisma.inventoryItem.update({
				where: { id: match.id },
				data: {
					quantity: Math.max(0, newQuantity),
					lowStock: newQuantity <= 0,
				},
			})
			continue
		}

		// Try unit conversion within the same family
		if (ingredientUnit && inventoryUnit) {
			const ingFamily = getUnitFamily(ingredientUnit)
			const invFamily = getUnitFamily(inventoryUnit)

			if (
				ingFamily &&
				invFamily &&
				ingFamily.family.name === invFamily.family.name
			) {
				// Convert ingredient amount to inventory's unit
				const ingredientInBase = scaledAmount * ingFamily.factor
				const ingredientInInventoryUnit = ingredientInBase / invFamily.factor

				const newQuantity = match.quantity - ingredientInInventoryUnit
				await prisma.inventoryItem.update({
					where: { id: match.id },
					data: {
						quantity: Math.max(0, newQuantity),
						lowStock: newQuantity <= 0,
					},
				})
				continue
			}
		}

		// Units are incompatible — skip silently
	}
}
