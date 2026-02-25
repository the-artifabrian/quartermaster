import { getCanonicalIngredientName } from './recipe-matching.server.ts'

type InventoryItemLike = {
	id: string
	name: string
	location: string
}

/**
 * Find an existing inventory item that matches the given name in the same location.
 * Uses getCanonicalIngredientName() for fuzzy matching (synonyms, modifier stripping, etc.).
 * Returns null if no match or if the match is in a different location (intentional duplicates).
 */
export function findMatchingInventoryItem(
	name: string,
	location: string,
	existingItems: InventoryItemLike[],
): InventoryItemLike | null {
	const canonical = getCanonicalIngredientName(name)

	for (const item of existingItems) {
		if (item.location !== location) continue
		if (getCanonicalIngredientName(item.name) === canonical) {
			return item
		}
	}

	return null
}
