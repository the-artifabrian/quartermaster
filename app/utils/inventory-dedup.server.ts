import { getCanonicalIngredientName } from './recipe-matching.server.ts'
import { normalizeUnit, getUnitFamily } from './unit-conversion.ts'

type InventoryItemLike = {
	id: string
	name: string
	location: string
	quantity: number | null
	unit: string | null
	expiresAt: Date | null
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

/**
 * Compute Prisma update data for merging a new item into an existing one.
 * - Adds quantities when units match or are convertible
 * - Picks the later expiry date
 * - Returns an empty object when nothing meaningful to merge
 */
export function buildMergeData(
	existing: InventoryItemLike,
	newQty: number | null | undefined,
	newUnit: string | null | undefined,
	newExpiresAt: Date | null | undefined,
): Record<string, unknown> {
	const updates: Record<string, unknown> = {}

	// Merge quantities
	if (newQty != null && newQty > 0) {
		if (existing.quantity == null) {
			// Existing has no quantity — set it
			updates.quantity = newQty
			if (newUnit) updates.unit = newUnit
		} else {
			const existingNormUnit = existing.unit
				? normalizeUnit(existing.unit)
				: null
			const newNormUnit = newUnit ? normalizeUnit(newUnit) : null

			if (existingNormUnit === newNormUnit) {
				// Same unit (or both null) — simple addition
				updates.quantity = existing.quantity + newQty
			} else if (existingNormUnit && newNormUnit) {
				// Try unit conversion
				const existingFamily = getUnitFamily(existingNormUnit)
				const newFamily = getUnitFamily(newNormUnit)

				if (
					existingFamily &&
					newFamily &&
					existingFamily.family.name === newFamily.family.name
				) {
					// Convert new quantity to existing unit
					const newInBase = newQty * newFamily.factor
					const newInExistingUnit =
						newInBase / existingFamily.factor
					updates.quantity = Math.round(
						(existing.quantity + newInExistingUnit) * 100,
					) / 100
				} else {
					// Incompatible units — just add the quantity as-is
					updates.quantity = existing.quantity + newQty
				}
			} else {
				// One has a unit, the other doesn't — just add
				updates.quantity = existing.quantity + newQty
			}
		}
	}

	// Merge expiry dates — keep the later one
	if (newExpiresAt) {
		if (
			!existing.expiresAt ||
			newExpiresAt.getTime() > existing.expiresAt.getTime()
		) {
			updates.expiresAt = newExpiresAt
		}
	}

	// Clear lowStock if we're adding quantity
	if (updates.quantity != null) {
		updates.lowStock = false
	}

	return updates
}
