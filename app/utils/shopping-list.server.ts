import { type Recipe, type Ingredient, type InventoryItem } from '@prisma/client'
import {
	ingredientMatchesInventoryItem,
	isStapleIngredient,
} from './recipe-matching.server.ts'
import { guessCategory } from './shopping-list-validation.ts'

type RecipeWithIngredients = Recipe & {
	ingredients: Ingredient[]
}

export type ShoppingListItemInput = {
	name: string
	quantity?: string | null
	unit?: string | null
	category: string
	source: string
}

// Generate shopping list from recipes, consolidate duplicates
export function generateShoppingListFromRecipes(
	recipes: RecipeWithIngredients[],
): ShoppingListItemInput[] {
	const ingredientMap = new Map<
		string,
		{
			name: string
			quantities: Array<{ amount?: string | null; unit?: string | null }>
			category: string
		}
	>()

	for (const recipe of recipes) {
		for (const ingredient of recipe.ingredients) {
			const normalizedName = ingredient.name.toLowerCase().trim()

			if (ingredientMap.has(normalizedName)) {
				ingredientMap.get(normalizedName)!.quantities.push({
					amount: ingredient.amount,
					unit: ingredient.unit,
				})
			} else {
				ingredientMap.set(normalizedName, {
					name: ingredient.name,
					quantities: [{ amount: ingredient.amount, unit: ingredient.unit }],
					category: guessCategory(ingredient.name),
				})
			}
		}
	}

	const items: ShoppingListItemInput[] = []

	for (const [_, data] of ingredientMap) {
		const consolidated = consolidateQuantities(data.quantities)

		items.push({
			name: data.name,
			quantity: consolidated.quantity,
			unit: consolidated.unit,
			category: data.category,
			source: 'generated',
		})
	}

	return items.sort((a, b) => a.category.localeCompare(b.category))
}

// Sum numeric quantities with same unit, or show count
function consolidateQuantities(
	quantities: Array<{ amount?: string | null; unit?: string | null }>,
): { quantity?: string; unit?: string } {
	if (quantities.length === 0) return {}
	if (quantities.length === 1) {
		return {
			quantity: quantities[0]!.amount ?? undefined,
			unit: quantities[0]!.unit ?? undefined,
		}
	}

	const firstUnit = quantities[0]!.unit ?? ''
	const sameUnit = quantities.every(q => (q.unit ?? '') === firstUnit)

	if (sameUnit) {
		const numericQuantities = quantities
			.map(q => parseFloat(q.amount ?? ''))
			.filter(n => !isNaN(n))

		if (numericQuantities.length === quantities.length) {
			const sum = numericQuantities.reduce((a, b) => a + b, 0)
			return {
				quantity: sum.toString(),
				unit: firstUnit || undefined,
			}
		}
	}

	return { quantity: `${quantities.length}×`, unit: undefined }
}

/**
 * Remove items from the shopping list that the user already has in inventory
 * (unless low stock) and items that are common staples.
 */
export function subtractInventoryFromShoppingList(
	items: ShoppingListItemInput[],
	inventoryItems: InventoryItem[],
): {
	items: ShoppingListItemInput[]
	removedCount: number
	removedItems: string[]
} {
	const availableInventory = inventoryItems.filter((item) => !item.lowStock)
	const removedItems: string[] = []

	const filtered = items.filter((item) => {
		// Remove staple ingredients
		if (isStapleIngredient({ name: item.name })) {
			removedItems.push(item.name)
			return false
		}

		// Remove items the user already has (not low stock)
		const hasInInventory = availableInventory.some((inv) =>
			ingredientMatchesInventoryItem({ name: item.name }, inv),
		)
		if (hasInInventory) {
			removedItems.push(item.name)
			return false
		}

		return true
	})

	return {
		items: filtered,
		removedCount: removedItems.length,
		removedItems,
	}
}
