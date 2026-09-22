import {
	type HouseholdIngredient,
	type PrismaClient,
} from '#app/generated/prisma/client.ts'
import {
	demandIdentity,
	type ShoppingDemandLine,
} from './shopping-demand.server.ts'

/**
 * The household's Staples, as the availability seam needs them: one snapshot
 * of the quick-add list, read once per Shopping action or demand-status read.
 */
export type ShoppingAvailability = {
	staples: Array<Pick<HouseholdIngredient, 'displayName'>>
}

export async function loadShoppingAvailability(
	db: PrismaClient,
	householdId: string,
): Promise<ShoppingAvailability> {
	const staples = await db.householdIngredient.findMany({
		where: { householdId, isStaple: true },
		select: { displayName: true },
	})

	return { staples }
}

/** Demand identities of the household's Staples. */
function stapleIdentities(availability: ShoppingAvailability): Set<string> {
	return new Set(
		availability.staples.map((staple) => demandIdentity(staple.displayName)),
	)
}

/**
 * Availability annotation — the internal seam that consumes pure
 * buildShoppingDemand output (#108/#116). The demand module itself never sees
 * household Staples, displayed rows, or persistence state.
 *
 * Since #289 it answers one question: does this line match a Staple? A match
 * is something the household usually has, so generated demand leaves it out —
 * the Plan picker offers it unticked instead, and adding a whole Meal omits
 * it. Manual Shopping rows never cross this seam.
 */
export function annotateShoppingDemand(
	lines: ShoppingDemandLine[],
	availability: ShoppingAvailability,
): {
	lines: ShoppingDemandLine[]
	stapleCount: number
	neededCount: number
} {
	const staples = stapleIdentities(availability)
	const result = lines.filter((line) => !staples.has(line.canonicalName))

	return {
		lines: result,
		stapleCount: lines.length - result.length,
		neededCount: result.length,
	}
}
