import { createId } from '@paralleldrive/cuid2'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { isUniqueConstraintError } from './menu-validation.ts'
import { getCanonicalIngredientName } from './recipe-matching.server.ts'
import { type ShoppingDemandLine } from './shopping-demand.server.ts'

/**
 * Transactional contribution reconciliation — the second internal seam that
 * consumes buildShoppingDemand output (#108). It records one current-state
 * MealShoppingContribution per (Meal, canonical demand identity) between the
 * source Meal and the displayed Shopping row its demand feeds. NOT an event
 * ledger: re-adding is idempotent, no history accumulates. Manual Shopping
 * rows stay durable manual rows — a matching row is only pointed at, never
 * rewritten. Explicit refresh/replacement semantics arrive with #110.
 */
export async function reconcileMealShoppingContributions(
	db: PrismaClient,
	{
		mealId,
		listId,
		lines,
	}: {
		mealId: string
		listId: string
		/** Demand lines after availability annotation (staples already gone). */
		lines: Array<ShoppingDemandLine & { inStock: boolean }>
	},
): Promise<{
	/** New Shopping rows created (in-stock ones arrive pre-checked). */
	createdRowCount: number
	/** Demand recorded against an already-displayed row (no visual change). */
	attachedCount: number
	/** Demand this Meal had already contributed — left untouched. */
	alreadyContributedCount: number
}> {
	const [existingItems, existingContributions] = await Promise.all([
		db.shoppingListItem.findMany({
			where: { listId },
			select: { id: true, name: true },
		}),
		db.mealShoppingContribution.findMany({
			where: { mealId },
			select: { canonicalName: true },
		}),
	])

	// Dedup against all existing rows (checked or not) by canonical identity —
	// the generator's long-standing rule.
	const existingRowByCanonical = new Map<string, string>()
	for (const item of existingItems) {
		const canonical = getCanonicalIngredientName(item.name)
		if (!existingRowByCanonical.has(canonical)) {
			existingRowByCanonical.set(canonical, item.id)
		}
	}
	const contributed = new Set(existingContributions.map((c) => c.canonicalName))

	const writes = []
	let createdRowCount = 0
	let attachedCount = 0
	let alreadyContributedCount = 0
	const seen = new Set<string>()

	for (const line of lines) {
		// Respect the (mealId, canonicalName) identity within one call too.
		if (seen.has(line.canonicalName)) continue
		seen.add(line.canonicalName)

		if (contributed.has(line.canonicalName)) {
			// Current-state record already exists — this is not a refresh (#110).
			alreadyContributedCount++
			continue
		}

		const contribution = {
			id: createId(),
			mealId,
			canonicalName: line.canonicalName,
			name: line.name,
			quantity: line.quantity,
			unit: line.unit,
		}

		const existingRowId = existingRowByCanonical.get(line.canonicalName)
		if (existingRowId) {
			// A compatible row is already displayed (manual or generated) — record
			// provenance against it without creating a visual duplicate or
			// rewriting the row.
			writes.push(
				db.mealShoppingContribution.create({
					data: { ...contribution, itemId: existingRowId },
				}),
			)
			attachedCount++
		} else {
			const itemId = createId()
			writes.push(
				db.shoppingListItem.create({
					data: {
						id: itemId,
						listId,
						name: line.name,
						quantity: line.quantity,
						unit: line.unit,
						category: line.category,
						checked: line.inStock,
						source: 'meal',
					},
				}),
				db.mealShoppingContribution.create({
					data: { ...contribution, itemId },
				}),
			)
			createdRowCount++
		}
	}

	if (writes.length > 0) {
		try {
			// One short batch transaction: a row and its contribution land
			// together or not at all.
			await db.$transaction(writes)
		} catch (error) {
			// A concurrent identical add hit the (mealId, canonicalName) unique
			// index first — its transaction already recorded this demand.
			if (isUniqueConstraintError(error)) {
				return {
					createdRowCount: 0,
					attachedCount: 0,
					alreadyContributedCount: lines.length,
				}
			}
			throw error
		}
	}

	return { createdRowCount, attachedCount, alreadyContributedCount }
}
