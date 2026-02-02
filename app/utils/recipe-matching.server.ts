import { type Recipe, type Ingredient, type InventoryItem } from '@prisma/client'

/**
 * Normalize ingredient name for fuzzy matching
 * - Converts to lowercase
 * - Trims whitespace
 * - Removes trailing 's' for simple singularization
 */
export function normalizeIngredientName(name: string): string {
	return name.toLowerCase().trim().replace(/s$/, '')
}

/**
 * Check if an ingredient matches an inventory item using fuzzy matching
 */
function ingredientMatchesInventoryItem(
	ingredient: Pick<Ingredient, 'name'>,
	inventoryItem: Pick<InventoryItem, 'name'>,
): boolean {
	const normalizedIngredient = normalizeIngredientName(ingredient.name)
	const normalizedInventory = normalizeIngredientName(inventoryItem.name)

	// Exact match after normalization
	if (normalizedIngredient === normalizedInventory) {
		return true
	}

	// Check if either contains the other (partial match)
	if (
		normalizedIngredient.includes(normalizedInventory) ||
		normalizedInventory.includes(normalizedIngredient)
	) {
		return true
	}

	return false
}

export type RecipeMatch = {
	recipe: Recipe & {
		ingredients: Ingredient[]
		image?: { objectKey: string } | null
		tags?: Array<{ id: string; name: string }>
	}
	matchPercentage: number
	matchedIngredientsCount: number
	totalIngredientsCount: number
	missingIngredients: Ingredient[]
	canMake: boolean
}

/**
 * Match recipes against user's inventory
 * Returns recipes with match percentage and missing ingredients
 */
export function matchRecipesWithInventory(
	recipes: Array<
		Recipe & {
			ingredients: Ingredient[]
			image?: { objectKey: string } | null
			tags?: Array<{ id: string; name: string }>
		}
	>,
	inventoryItems: InventoryItem[],
): RecipeMatch[] {
	return recipes
		.map((recipe) => {
			const totalIngredientsCount = recipe.ingredients.length
			let matchedIngredientsCount = 0
			const missingIngredients: Ingredient[] = []

			// Check each ingredient against inventory
			for (const ingredient of recipe.ingredients) {
				const hasMatch = inventoryItems.some((item) =>
					ingredientMatchesInventoryItem(ingredient, item),
				)

				if (hasMatch) {
					matchedIngredientsCount++
				} else {
					missingIngredients.push(ingredient)
				}
			}

			const matchPercentage =
				totalIngredientsCount > 0
					? Math.round((matchedIngredientsCount / totalIngredientsCount) * 100)
					: 0

			const canMake = matchedIngredientsCount === totalIngredientsCount

			return {
				recipe,
				matchPercentage,
				matchedIngredientsCount,
				totalIngredientsCount,
				missingIngredients,
				canMake,
			}
		})
		.sort((a, b) => {
			// Sort by match percentage (descending)
			if (b.matchPercentage !== a.matchPercentage) {
				return b.matchPercentage - a.matchPercentage
			}
			// Then by total ingredients (fewer ingredients first)
			return a.totalIngredientsCount - b.totalIngredientsCount
		})
}
