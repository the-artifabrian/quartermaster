import { type InventoryItem } from '#app/generated/prisma/client.ts'
import {
	buildInventoryLookup,
	ingredientMatchesAnyInventoryItem,
	isStapleIngredient,
} from './recipe-matching.server.ts'
import { type ShoppingDemandLine } from './shopping-demand.server.ts'

/**
 * Availability annotation — one of the two internal seams that consume
 * buildShoppingDemand output (#108). This is deliberately where Inventory
 * and Staples enter: the demand module itself never sees them.
 * - Staples (salt, pepper, water, oil) are removed entirely.
 * - Lines matching inventory get `inStock: true` (will be pre-checked).
 * - Everything else gets `inStock: false`.
 */
export function annotateInventoryMatches(
	lines: ShoppingDemandLine[],
	inventoryItems: Array<Pick<InventoryItem, 'name'>>,
): {
	lines: Array<ShoppingDemandLine & { inStock: boolean }>
	stapleCount: number
	inStockCount: number
} {
	let stapleCount = 0
	const result: Array<ShoppingDemandLine & { inStock: boolean }> = []
	const lookup = buildInventoryLookup(inventoryItems)

	for (const line of lines) {
		// Still strip staples entirely — nobody needs "salt" on their list
		if (isStapleIngredient({ name: line.name })) {
			stapleCount++
			continue
		}

		const hasInInventory = ingredientMatchesAnyInventoryItem(
			{ name: line.name },
			lookup,
		)

		result.push({ ...line, inStock: hasInInventory })
	}

	return {
		lines: result,
		stapleCount,
		inStockCount: result.filter((line) => line.inStock).length,
	}
}
