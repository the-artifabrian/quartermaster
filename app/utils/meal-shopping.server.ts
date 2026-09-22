import { type PrismaClient } from '#app/generated/prisma/client.ts'
import {
	buildShoppingDemand,
	type ShoppingDemandLine,
} from './shopping-demand.server.ts'

export type MealShoppingDemand = {
	/** Normalized demand lines for this Meal, in demand-module order. */
	lines: ShoppingDemandLine[]
	/**
	 * True when a Recipe card points at a deleted Recipe. Such a card produces
	 * no fresh demand, so an explicit refresh must be blocked rather than
	 * silently dropping what it used to contribute.
	 */
	hasMissingRecipeCards: boolean
}

/**
 * Build Shopping demand for one or more Meals from the two inputs the Meal-add
 * path has always read: Recipe items at their stored batch multipliers, and
 * note cards' Shopping lines (#109). The Plan picker (#288) passes
 * `includeCooked: false` to reproduce From Plan's eligible set — a cooked
 * Recipe item has already been made, so it is not something to shop for.
 *
 * Missing cards (recipeId null) and text-only Meals simply contribute nothing.
 * Every Meal id must already be resolved through the caller's household.
 */
export async function loadMealShoppingDemand(
	db: PrismaClient,
	{ mealIds, includeCooked }: { mealIds: string[]; includeCooked: boolean },
): Promise<Map<string, MealShoppingDemand>> {
	const ids = [...new Set(mealIds)]
	if (ids.length === 0) return new Map()

	const [recipeItems, noteLines] = await Promise.all([
		db.mealRecipeItem.findMany({
			where: {
				mealId: { in: ids },
				...(includeCooked ? {} : { cooked: false }),
			},
			// Demand part order (and so composite quantities) must be
			// deterministic across identical adds.
			orderBy: [{ order: 'asc' }, { id: 'asc' }],
			include: { recipe: { include: { ingredients: true } } },
		}),
		db.mealShoppingLine.findMany({
			where: { noteItem: { mealId: { in: ids } } },
			// noteItemId breaks ties between note items sharing an order value.
			orderBy: [
				{ noteItem: { order: 'asc' } },
				{ noteItemId: 'asc' },
				{ order: 'asc' },
			],
			select: {
				name: true,
				quantity: true,
				unit: true,
				noteItem: { select: { mealId: true } },
			},
		}),
	])

	const demand = new Map<string, MealShoppingDemand>()
	for (const mealId of ids) {
		const items = recipeItems.filter((item) => item.mealId === mealId)
		demand.set(mealId, {
			lines: buildShoppingDemand({
				recipeBatches: items.flatMap((item) =>
					item.recipe
						? [
								{
									ingredients: item.recipe.ingredients,
									scaleMultiplier: item.scaleMultiplier,
								},
							]
						: [],
				),
				noteLines: noteLines
					.filter((line) => line.noteItem.mealId === mealId)
					.map(({ name, quantity, unit }) => ({ name, quantity, unit })),
			}),
			hasMissingRecipeCards: items.some((item) => item.recipe == null),
		})
	}
	return demand
}
