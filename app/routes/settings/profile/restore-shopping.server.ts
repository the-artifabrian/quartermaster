// Restores the Shopping items in an export file and their links to Meals.

import { createId } from '@paralleldrive/cuid2'
import { type z } from 'zod'
import { prisma } from '#app/utils/db.server.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { type ImportShoppingListSchema } from './+backup-format.ts'
import {
	type RecordFailure,
	refusedWriteCode,
} from './restore-results.server.ts'

type ShoppingListItemImport = {
	name: string
	quantity: string | null
	unit: string | null
	category: string | null
	checked: boolean
	source: string
	horizon: string
}

function getShoppingListItemImportKey(item: ShoppingListItemImport) {
	return JSON.stringify([
		item.name.trim().toLocaleLowerCase(),
		item.quantity?.trim() || null,
		item.unit?.trim().toLocaleLowerCase() || null,
		item.category?.trim().toLocaleLowerCase() || null,
		item.checked,
		item.source.trim().toLocaleLowerCase(),
		item.horizon,
	])
}

type ImportShoppingList = z.infer<typeof ImportShoppingListSchema>

/**
 * Restores Shopping items into the household's one list, skipping rows it
 * already has, then reconnects their Meal contributions. The schema has
 * already checked every item, so a write that fails here is unexpected and
 * stops the restore.
 */
export async function importShopping(
	shoppingLists: ImportShoppingList[],
	mealIdByRef: Map<string, string>,
	userId: string,
	householdId: string,
	recordFailure: RecordFailure,
) {
	const stats = { created: 0, skipped: 0 }
	const shoppingList = await ensureShoppingList(prisma, {
		userId,
		householdId,
		name: shoppingLists[0]!.name,
	})
	const existingItems = await prisma.shoppingListItem.findMany({
		where: { listId: shoppingList.id },
		select: {
			id: true,
			name: true,
			quantity: true,
			unit: true,
			category: true,
			checked: true,
			source: true,
			horizon: true,
		},
	})
	const itemIdByKey = new Map(
		existingItems.map((item) => [getShoppingListItemImportKey(item), item.id]),
	)
	const contributionSeeds: Array<{
		itemId: string
		contribution: NonNullable<
			(typeof shoppingLists)[number]['items'][number]['mealContributions']
		>[number]
	}> = []

	for (const list of shoppingLists) {
		let skipped = 0
		const newItems: Array<ShoppingListItemImport & { id: string }> = []
		for (const item of list.items) {
			const normalizedItem = {
				name: item.name,
				quantity: item.quantity || null,
				unit: item.unit || null,
				category: item.category || null,
				checked: item.checked ?? false,
				source: item.source || 'manual',
				horizon: item.horizon,
			}
			const key = getShoppingListItemImportKey(normalizedItem)
			let targetItemId = itemIdByKey.get(key)
			if (targetItemId) {
				skipped++
			} else {
				targetItemId = createId()
				itemIdByKey.set(key, targetItemId)
				newItems.push({ id: targetItemId, ...normalizedItem })
			}
			for (const contribution of item.mealContributions ?? []) {
				contributionSeeds.push({
					itemId: targetItemId,
					contribution,
				})
			}
		}

		if (newItems.length > 0) {
			await prisma.shoppingListItem.createMany({
				data: newItems.map((item) => ({
					...item,
					listId: shoppingList.id,
				})),
			})
		}
		stats.created += newItems.length
		stats.skipped += skipped
	}

	const existingContributions = await prisma.mealShoppingContribution.findMany({
		where: { item: { listId: shoppingList.id } },
		select: {
			itemId: true,
			mealId: true,
			canonicalName: true,
			name: true,
			quantity: true,
			unit: true,
		},
	})
	const contributionKey = (entry: {
		itemId: string
		mealId: string | null
		canonicalName: string
		name: string
		quantity: string | null
		unit: string | null
	}) =>
		entry.mealId
			? JSON.stringify(['meal', entry.mealId, entry.canonicalName])
			: JSON.stringify([
					'orphan',
					entry.itemId,
					entry.canonicalName,
					entry.name,
					entry.quantity,
					entry.unit,
				])
	const liveContributionKeys = new Set(
		existingContributions
			.filter((entry) => entry.mealId != null)
			.map(contributionKey),
	)
	// Orphan contributions have no unique source Meal key. Identical
	// records may represent several deleted Meals and each still counts
	// toward the displayed total, so reconcile them as a multiset.
	const availableOrphanCounts = new Map<string, number>()
	for (const entry of existingContributions) {
		if (entry.mealId != null) continue
		const key = contributionKey(entry)
		availableOrphanCounts.set(key, (availableOrphanCounts.get(key) ?? 0) + 1)
	}
	const newContributions = []
	for (const seed of contributionSeeds) {
		const { contribution } = seed
		const mealId = contribution.orphaned
			? contribution.sourceMealRef == null
				? null
				: undefined
			: contribution.sourceMealRef != null
				? mealIdByRef.get(contribution.sourceMealRef)
				: undefined
		if (mealId === undefined) continue
		const candidate = {
			id: createId(),
			itemId: seed.itemId,
			mealId,
			...contribution.fingerprint,
		}
		const key = contributionKey(candidate)
		if (mealId != null) {
			if (liveContributionKeys.has(key)) continue
			liveContributionKeys.add(key)
		} else {
			const available = availableOrphanCounts.get(key) ?? 0
			if (available > 0) {
				availableOrphanCounts.set(key, available - 1)
				continue
			}
		}
		newContributions.push(candidate)
	}
	if (newContributions.length > 0) {
		try {
			await prisma.mealShoppingContribution.createMany({
				data: newContributions,
			})
		} catch (error) {
			const code = refusedWriteCode(error)
			if (!code) throw error
			// createMany is all or nothing: Prisma splits a large one into several
			// INSERTs inside one transaction (10,000 rows with a bad last one keep
			// none), so the retry can't write a link twice.
			// A Meal restored above was deleted before its links were written, or
			// someone saved the same link meanwhile. Drop the links to Meals that
			// are gone and the ones already there, and write the rest once more.
			const mealIds = [
				...new Set(
					newContributions.flatMap((c) => (c.mealId ? [c.mealId] : [])),
				),
			]
			const liveMealIds = new Set(
				(
					await prisma.meal.findMany({
						where: { id: { in: mealIds } },
						select: { id: true },
					})
				).map((meal) => meal.id),
			)
			const savedKeys = new Set(
				(
					await prisma.mealShoppingContribution.findMany({
						where: { item: { listId: shoppingList.id }, mealId: { not: null } },
						select: { itemId: true, mealId: true, canonicalName: true },
					})
				).map((entry) =>
					contributionKey({ ...entry, name: '', quantity: null, unit: null }),
				),
			)
			const toMissingMeals = newContributions.filter(
				(c) => c.mealId != null && !liveMealIds.has(c.mealId),
			)
			const retry = newContributions.filter(
				(c) =>
					c.mealId == null ||
					(liveMealIds.has(c.mealId) && !savedKeys.has(contributionKey(c))),
			)
			if (toMissingMeals.length > 0) {
				recordFailure({
					at: 'shoppingLists',
					reason: 'meal-gone',
					count: toMissingMeals.length,
					code,
				})
			}
			if (retry.length > 0) {
				await prisma.mealShoppingContribution.createMany({ data: retry })
			}
		}
	}

	return stats
}
