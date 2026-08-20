import { createId } from '@paralleldrive/cuid2'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { isUniqueConstraintError } from './menu-validation.ts'
import {
	demandIdentity,
	type ShoppingDemandLine,
} from './shopping-demand.server.ts'
import { guessCategory } from './shopping-list-validation.ts'

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
		const canonical = demandIdentity(item.name)
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

/**
 * Replace one Meal's current contribution with freshly built demand. Existing
 * normalized display rows are reused so their checked state survives; rows
 * created for demand that no longer exists disappear only when no manual or
 * other-Meal component still needs them. Newly introduced groups start
 * unchecked even when the ordinary initial-add availability seam would have
 * pre-checked them.
 */
export async function replaceMealShoppingContributions(
	db: PrismaClient,
	{
		mealId,
		listId,
		lines,
	}: {
		mealId: string
		listId: string
		lines: Array<ShoppingDemandLine & { inStock: boolean }>
	},
): Promise<{
	createdRowCount: number
	attachedCount: number
	updatedContributionCount: number
	removedContributionCount: number
}> {
	const [existingItems, existingContributions] = await Promise.all([
		db.shoppingListItem.findMany({
			where: { listId },
			select: {
				id: true,
				name: true,
				source: true,
				quantity: true,
				unit: true,
				category: true,
			},
		}),
		db.mealShoppingContribution.findMany({
			where: { mealId },
			select: {
				id: true,
				itemId: true,
				canonicalName: true,
				name: true,
				quantity: true,
				unit: true,
			},
		}),
	])

	const rowById = new Map(existingItems.map((item) => [item.id, item]))
	const rowByCanonical = new Map<string, (typeof existingItems)[number]>()
	for (const item of existingItems) {
		const identity = demandIdentity(item.name)
		if (!rowByCanonical.has(identity)) rowByCanonical.set(identity, item)
	}
	const contributionByCanonical = new Map(
		existingContributions.map((contribution) => [
			contribution.canonicalName,
			contribution,
		]),
	)
	const freshByCanonical = new Map<string, (typeof lines)[number]>()
	for (const line of lines) {
		if (!freshByCanonical.has(line.canonicalName)) {
			freshByCanonical.set(line.canonicalName, line)
		}
	}

	const writes = []
	let createdRowCount = 0
	let attachedCount = 0
	let updatedContributionCount = 0
	let removedContributionCount = 0
	const possiblyEmptyMealRows = new Set<string>()

	for (const contribution of existingContributions) {
		const line = freshByCanonical.get(contribution.canonicalName)
		if (!line) {
			writes.push(
				db.mealShoppingContribution.delete({
					where: { id: contribution.id },
				}),
			)
			possiblyEmptyMealRows.add(contribution.itemId)
			removedContributionCount++
			continue
		}

		if (
			contribution.name !== line.name ||
			contribution.quantity !== line.quantity ||
			contribution.unit !== line.unit
		) {
			writes.push(
				db.mealShoppingContribution.update({
					where: { id: contribution.id },
					data: {
						name: line.name,
						quantity: line.quantity,
						unit: line.unit,
					},
				}),
			)
			updatedContributionCount++
		}

		const row = rowById.get(contribution.itemId)
		if (row?.source === 'meal') {
			writes.push(
				db.shoppingListItem.update({
					where: { id: row.id },
					data: {
						name: line.name,
						quantity: line.quantity,
						unit: line.unit,
						category: line.category,
					},
				}),
			)
		}
	}

	for (const line of freshByCanonical.values()) {
		if (contributionByCanonical.has(line.canonicalName)) continue

		const existingRow = rowByCanonical.get(line.canonicalName)
		const contribution = {
			id: createId(),
			mealId,
			canonicalName: line.canonicalName,
			name: line.name,
			quantity: line.quantity,
			unit: line.unit,
		}
		if (existingRow) {
			writes.push(
				db.mealShoppingContribution.create({
					data: { ...contribution, itemId: existingRow.id },
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
						checked: false,
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

	if (possiblyEmptyMealRows.size > 0) {
		writes.push(
			db.shoppingListItem.deleteMany({
				where: {
					id: { in: [...possiblyEmptyMealRows] },
					source: 'meal',
					mealContributions: { none: {} },
				},
			}),
		)
	}
	if (writes.length > 0) await db.$transaction(writes)

	return {
		createdRowCount,
		attachedCount,
		updatedContributionCount,
		removedContributionCount,
	}
}

/**
 * Edit one displayed Shopping group without letting later Meal refreshes
 * overwrite the user's correction. Generated-only groups become one manual
 * row and shed every represented contribution. A mixed group's existing
 * manual component alone is edited; if its name moves to another identity,
 * the generated component is split back into its own checked-state-preserving
 * group.
 */
export async function editShoppingDisplayGroup(
	db: PrismaClient,
	{
		itemId,
		name,
		quantity,
		unit,
	}: {
		itemId: string
		name: string
		quantity: string | null
		unit: string | null
	},
) {
	const item = await db.shoppingListItem.findUniqueOrThrow({
		where: { id: itemId },
		include: {
			mealContributions: { orderBy: { id: 'asc' } },
		},
	})

	if (item.source !== 'manual') {
		await db.$transaction([
			db.shoppingListItem.update({
				where: { id: item.id },
				data: { name, quantity, unit, source: 'manual' },
			}),
			db.mealShoppingContribution.deleteMany({
				where: { itemId: item.id },
			}),
		])
		return
	}

	const oldIdentity = demandIdentity(item.name)
	const newIdentity = demandIdentity(name)
	if (item.mealContributions.length === 0 || oldIdentity === newIdentity) {
		await db.shoppingListItem.update({
			where: { id: item.id },
			data: { name, quantity, unit },
		})
		return
	}

	const otherRows = await db.shoppingListItem.findMany({
		where: { listId: item.listId, id: { not: item.id } },
		select: { id: true, name: true },
	})
	const existingByIdentity = new Map<string, string>()
	for (const row of otherRows) {
		const identity = demandIdentity(row.name)
		if (!existingByIdentity.has(identity)) {
			existingByIdentity.set(identity, row.id)
		}
	}

	const writes = []
	writes.push(
		db.shoppingListItem.update({
			where: { id: item.id },
			data: { name, quantity, unit },
		}),
	)
	const contributionsByIdentity = new Map<
		string,
		typeof item.mealContributions
	>()
	for (const contribution of item.mealContributions) {
		const group = contributionsByIdentity.get(contribution.canonicalName) ?? []
		group.push(contribution)
		contributionsByIdentity.set(contribution.canonicalName, group)
	}
	for (const [identity, contributions] of contributionsByIdentity) {
		let targetId = existingByIdentity.get(identity)
		if (!targetId) {
			targetId = createId()
			const first = contributions[0]!
			writes.push(
				db.shoppingListItem.create({
					data: {
						id: targetId,
						listId: item.listId,
						name: first.name,
						quantity: first.quantity,
						unit: first.unit,
						category: guessCategory(first.name),
						checked: item.checked,
						source: 'meal',
					},
				}),
			)
		}
		writes.push(
			db.mealShoppingContribution.updateMany({
				where: { id: { in: contributions.map((entry) => entry.id) } },
				data: { itemId: targetId },
			}),
		)
	}
	await db.$transaction(writes)
}

/** Remove only the generated component of a mixed manual/display group. */
export async function removeGeneratedShoppingAmount(
	db: PrismaClient,
	{ itemId }: { itemId: string },
) {
	await db.mealShoppingContribution.deleteMany({ where: { itemId } })
}

/** Delete a Meal and its chosen generated Shopping component atomically. */
export async function removeMealWithShoppingContributions(
	db: PrismaClient,
	{ mealId }: { mealId: string },
) {
	const contributions = await db.mealShoppingContribution.findMany({
		where: { mealId },
		select: { itemId: true },
	})
	const itemIds = [...new Set(contributions.map((entry) => entry.itemId))]
	await db.$transaction([
		db.mealShoppingContribution.deleteMany({ where: { mealId } }),
		db.meal.delete({ where: { id: mealId } }),
		...(itemIds.length > 0
			? [
					db.shoppingListItem.deleteMany({
						where: {
							id: { in: itemIds },
							source: 'meal',
							mealContributions: { none: {} },
						},
					}),
				]
			: []),
	])
}
