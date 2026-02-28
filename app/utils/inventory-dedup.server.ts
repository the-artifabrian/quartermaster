import { getCanonicalIngredientName } from './recipe-matching.server.ts'

type InventoryItemLike = {
	id: string
	name: string
}

/**
 * Find an existing inventory item that matches the given name.
 * Uses getCanonicalIngredientName() for fuzzy matching (synonyms, modifier stripping, etc.).
 */
export function findMatchingInventoryItem(
	name: string,
	existingItems: InventoryItemLike[],
): InventoryItemLike | null {
	const canonical = getCanonicalIngredientName(name)

	for (const item of existingItems) {
		if (getCanonicalIngredientName(item.name) === canonical) {
			return item
		}
	}

	return null
}
