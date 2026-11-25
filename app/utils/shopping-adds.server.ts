import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { loadMealShoppingDemand } from './meal-shopping.server.ts'
import {
	reconcileMealShoppingContributionsInTransaction,
	replaceMealShoppingContributionsInTransaction,
} from './shopping-contribution.server.ts'
import { demandIdentity } from './shopping-demand.server.ts'
import { resolveNextShopDemandTargets } from './shopping-horizon.server.ts'
import { NEXT_SHOP } from './shopping-horizon.ts'
import {
	annotateShoppingDemand,
	loadShoppingAvailability,
} from './shopping-list.server.ts'
import { guessCategory } from './shopping-list-validation.ts'
import { writeTransaction } from './write-transaction.server.ts'

/**
 * Add to Shopping for one Meal, or Update Shopping when `refresh` is set.
 *
 * The Meal, its demand (cooked state included) and the Household's Staples
 * are read in the same transaction as the Shopping write, under the write
 * lock. A Meal deleted or cooked by someone else lands wholly before (the
 * add sees it) or wholly after (it sees the add), never in between.
 *
 * Returns null when the Meal is gone by the time the lock is held.
 */
export function addMealToShopping(
	db: PrismaClient,
	{
		mealId,
		householdId,
		listId,
		refresh,
	}: { mealId: string; householdId: string; listId: string; refresh: boolean },
) {
	return writeTransaction(db, async (tx) => {
		const meal = await tx.meal.findFirst({
			where: { id: mealId, mealPlan: { householdId }, genericText: null },
			select: { id: true },
		})
		if (!meal) return null
		// Missing cards (recipeId null) contribute nothing, so an update drops
		// a deleted Recipe's lines. Note-card Shopping lines contribute
		// alongside Recipe items, and a note-only snapshot Meal can add to
		// Shopping too.
		const demand = (
			await loadMealShoppingDemand(tx, { mealIds: [mealId] })
		).get(mealId)!
		const availability = await loadShoppingAvailability(tx, householdId)
		const { lines } = annotateShoppingDemand(demand.lines, availability)
		return refresh
			? await replaceMealShoppingContributionsInTransaction(tx, {
					mealId,
					listId,
					lines,
					keepIdentities: demand.cookedIdentities,
					neverLower: demand.cookedRecipeGone,
				})
			: await reconcileMealShoppingContributionsInTransaction(tx, {
					mealId,
					listId,
					lines,
				})
	})
}

/**
 * From Plan: puts each picked Meal's ticked lines on Shopping, through the
 * same Meal-add path as Add to Shopping. Only Household Meals with Recipe or
 * note content count; cooked Recipe items add nothing.
 *
 * Each Meal is read and written in its own transaction, in order, so each
 * reconcile sees the list the previous one left. If one fails, the Meals
 * before it stay on Shopping and the rest are not added; picking them again
 * adds only what is missing.
 */
export async function addPickedMealsToShopping(
	db: PrismaClient,
	{
		householdId,
		listId,
		pickedByMeal,
	}: {
		householdId: string
		listId: string
		/** Each Meal id with the canonical names of the lines ticked for it. */
		pickedByMeal: Map<string, Set<string>>
	},
) {
	const totals = {
		createdRowCount: 0,
		attachedCount: 0,
		alreadyContributedCount: 0,
		promotedRowCount: 0,
	}
	for (const [mealId, picked] of pickedByMeal) {
		const result = await writeTransaction(db, async (tx) => {
			// Every Meal id is re-resolved through the household before any
			// write. A text-only Meal puts nothing on Shopping.
			const meal = await tx.meal.findFirst({
				where: { id: mealId, mealPlan: { householdId }, genericText: null },
				select: { id: true },
			})
			if (!meal) return null
			const demand = (
				await loadMealShoppingDemand(tx, { mealIds: [mealId] })
			).get(mealId)!
			// The tick set decides what is added. A Staple match the household
			// ticked anyway is still added. Leaving Staples out is a default
			// for generated demand, and a tick overrides it.
			const lines = demand.lines.filter((line) =>
				picked.has(line.canonicalName),
			)
			if (lines.length === 0) return null
			return reconcileMealShoppingContributionsInTransaction(tx, {
				mealId,
				listId,
				lines,
			})
		})
		if (!result) continue
		totals.createdRowCount += result.createdRowCount
		totals.attachedCount += result.attachedCount
		totals.alreadyContributedCount += result.alreadyContributedCount
		totals.promotedRowCount += result.promotedRowCount
	}
	return totals
}

/**
 * Puts one Recipe line on Shopping: onto an outstanding row for the same
 * ingredient when there is one (a Later row moves up to Next shop), or as a
 * new row. The read and the write share one transaction, so two adds at once
 * make one row.
 */
export function addRecipeLineToShopping(
	db: PrismaClient,
	{
		listId,
		item,
	}: {
		listId: string
		item: { name: string; quantity: string | null; unit: string | null }
	},
) {
	return writeTransaction(db, async (tx) => {
		const canonicalName = demandIdentity(item.name)
		const { targets, promotedIds } = await resolveNextShopDemandTargets(tx, {
			listId,
			canonicalNames: [canonicalName],
		})
		const isNew = !targets.has(canonicalName)
		if (isNew) {
			await tx.shoppingListItem.create({
				data: {
					name: item.name,
					quantity: item.quantity,
					unit: item.unit,
					category: guessCategory(item.name),
					source: 'recipe',
					horizon: NEXT_SHOP,
					listId,
				},
			})
		}
		return { isNew, promoted: promotedIds.length > 0 }
	})
}
