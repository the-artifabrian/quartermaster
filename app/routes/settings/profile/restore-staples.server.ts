// Restores the Staples and other household ingredients in an export file.

import { type z } from 'zod'
import { prisma } from '#app/utils/db.server.ts'
import { writeTransaction } from '#app/utils/write-transaction.server.ts'
import { type ImportHouseholdIngredientSchema } from './+backup-format.ts'

type ImportHouseholdIngredient = z.infer<typeof ImportHouseholdIngredientSchema>

/**
 * Household ingredients (Staples included): rows the Household already has
 * win, so a restore never rewrites a choice the Household has already made.
 */
export async function importHouseholdIngredients(
	householdIngredients: ImportHouseholdIngredient[],
	householdId: string,
) {
	const stats = { created: 0, skipped: 0 }
	await writeTransaction(prisma, async (tx) => {
		const existing = await tx.householdIngredient.findMany({
			where: { householdId },
			select: { canonicalKey: true },
		})
		const existingKeys = new Set(existing.map((item) => item.canonicalKey))
		for (const ingredient of householdIngredients) {
			if (existingKeys.has(ingredient.canonicalKey)) {
				stats.skipped++
				continue
			}
			await tx.householdIngredient.create({
				data: { ...ingredient, householdId },
			})
			existingKeys.add(ingredient.canonicalKey)
			stats.created++
		}
	})
	return stats
}
