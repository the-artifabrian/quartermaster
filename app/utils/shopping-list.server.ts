import {
	type HouseholdIngredient,
	type InventoryItem,
	type PrismaClient,
} from '#app/generated/prisma/client.ts'
import {
	buildInventoryLookup,
	ingredientMatchesAnyInventoryItem,
	isStapleIngredient,
} from './recipe-matching.server.ts'
import {
	demandIdentity,
	type ShoppingDemandLine,
} from './shopping-demand.server.ts'

type LegacyPantryAvailability = {
	kind: 'legacy-pantry'
	inventoryItems: Array<Pick<InventoryItem, 'name'>>
}

type HouseholdStaplesAvailability = {
	kind: 'household-staples'
	staples: Array<Pick<HouseholdIngredient, 'displayName' | 'isOut'>>
}

export type ShoppingAvailability =
	LegacyPantryAvailability | HouseholdStaplesAvailability

/**
 * Load one household-scoped availability snapshot for an explicit Shopping
 * action or demand-status read. The cutover timestamp selects exactly one
 * mode: archived Inventory rows never leak into post-cutover behavior, while
 * clearing the timestamp restores the legacy Pantry mode intact.
 */
export async function loadShoppingAvailability(
	db: PrismaClient,
	householdId: string,
): Promise<ShoppingAvailability> {
	const household = await db.household.findUniqueOrThrow({
		where: { id: householdId },
		select: {
			staplesCutoverAt: true,
			inventoryItems: { select: { name: true } },
			householdIngredients: {
				where: { isStaple: true },
				select: { displayName: true, isOut: true },
			},
		},
	})

	return household.staplesCutoverAt == null
		? { kind: 'legacy-pantry', inventoryItems: household.inventoryItems }
		: {
				kind: 'household-staples',
				staples: household.householdIngredients,
			}
}

/**
 * Availability annotation — the internal seam that consumes pure
 * buildShoppingDemand output (#108/#116). The demand module itself never sees
 * Inventory, household Staples, displayed rows, or persistence state.
 *
 * Before cutover, legacy hard-coded staple and Pantry pre-check behavior stays
 * recoverable. After cutover, saved household rows are the only Staple source:
 * normal Staples are omitted, Out Staples and every non-Staple remain, and no
 * line is pre-checked as Inventory. Manual Shopping rows never cross this seam.
 */
export function annotateShoppingDemand(
	lines: ShoppingDemandLine[],
	availability: ShoppingAvailability,
): {
	lines: Array<ShoppingDemandLine & { inStock: boolean }>
	stapleCount: number
	inStockCount: number
} {
	let stapleCount = 0
	const result: Array<ShoppingDemandLine & { inStock: boolean }> = []
	const legacyLookup =
		availability.kind === 'legacy-pantry'
			? buildInventoryLookup(availability.inventoryItems)
			: null
	const householdStaples = new Map<string, boolean>()
	if (availability.kind === 'household-staples') {
		for (const staple of availability.staples) {
			const identity = demandIdentity(staple.displayName)
			// Exact household identities can temporarily converge on one demand
			// identity (for example cilantro/coriander). Include demand if any
			// matching saved Staple is Out; hiding a required Out item is unsafe.
			householdStaples.set(
				identity,
				(householdStaples.get(identity) ?? false) || staple.isOut,
			)
		}
	}

	for (const line of lines) {
		if (availability.kind === 'household-staples') {
			const matchingStapleIsOut = householdStaples.get(line.canonicalName)
			if (matchingStapleIsOut === false) {
				stapleCount++
				continue
			}
			result.push({ ...line, inStock: false })
			continue
		}

		// Legacy recovery retains the pre-cutover exception for explicit note
		// Shopping text. Post-cutover household Staple state applies uniformly
		// to generated Recipe and note demand.
		if (!line.fromNote && isStapleIngredient({ name: line.name })) {
			stapleCount++
			continue
		}

		const hasInInventory = ingredientMatchesAnyInventoryItem(
			{ name: line.name },
			legacyLookup!,
		)

		result.push({ ...line, inStock: hasInInventory })
	}

	return {
		lines: result,
		stapleCount,
		inStockCount: result.filter((line) => line.inStock).length,
	}
}
