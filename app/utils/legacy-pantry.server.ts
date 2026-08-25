import { type Prisma } from '#app/generated/prisma/client.ts'

/**
 * The sole query boundary for product reads of legacy InventoryItem data.
 * Clearing staplesCutoverAt re-enables these rows; confirming cutover makes
 * every caller observe an empty legacy Pantry without deleting recoverable
 * data. The later #116 Staple/Out demand rules do not belong here.
 */
export function activeLegacyPantryWhere(
	householdId: string,
): Prisma.InventoryItemWhereInput {
	return {
		householdId,
		household: { staplesCutoverAt: null },
	}
}
