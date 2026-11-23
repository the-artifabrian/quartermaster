import { type PrismaClient } from '#app/generated/prisma/client.ts'
import {
	buildShoppingDemand,
	type ShoppingDemandLine,
} from './shopping-demand.server.ts'

export type MealShoppingDemand = {
	/**
	 * What this Meal can put on Shopping, in demand-module order: its Recipe
	 * items not cooked yet, at their stored batch multipliers, and its note
	 * cards' Shopping lines.
	 */
	lines: ShoppingDemandLine[]
	/**
	 * Demand identities a cooked Recipe item of this Meal needs. Update
	 * Shopping leaves this Meal's existing amounts for them as they are.
	 */
	cookedIdentities: Set<string>
	/**
	 * A cooked Recipe item whose Recipe has since been deleted. What it needed
	 * can't be known, so Update Shopping never withdraws or lowers an amount
	 * this Meal already put on Shopping. Increases and new lines still apply.
	 */
	cookedRecipeGone: boolean
}

/**
 * Build Shopping demand for one or more Meals: Recipe items at their stored
 * batch multipliers, and note cards' Shopping lines (#109).
 *
 * The cooked rule lives here so every path follows it. A cooked Recipe item
 * has been made, so it never adds new amounts anywhere (Add to Shopping,
 * From Plan, the picker, Update Shopping). On Update Shopping, amounts it
 * already put on Shopping stay as they are, checked or not. The caller
 * passes `cookedIdentities` on, and an identity in it is neither added to
 * nor withdrawn. An ingredient a cooked and an uncooked item share counts as
 * cooked there, so an existing amount stays, even when the uncooked item
 * changed; with none on Shopping, only the uncooked share is added. A cooked
 * item whose Recipe was deleted could have needed anything, so then no
 * amount the Meal already has on Shopping is withdrawn or lowered
 * (`cookedRecipeGone`); larger amounts and new lines still apply.
 *
 * Missing cards (recipeId null) and text-only Meals simply contribute nothing.
 * Every Meal id must already be resolved through the caller's household.
 */
export async function loadMealShoppingDemand(
	db: Pick<PrismaClient, 'mealRecipeItem' | 'mealShoppingLine'>,
	{ mealIds }: { mealIds: string[] },
): Promise<Map<string, MealShoppingDemand>> {
	const ids = [...new Set(mealIds)]
	if (ids.length === 0) return new Map()

	const [recipeItems, noteLines] = await Promise.all([
		db.mealRecipeItem.findMany({
			where: { mealId: { in: ids } },
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

	const batches = (items: typeof recipeItems) =>
		items.flatMap((item) =>
			item.recipe
				? [
						{
							ingredients: item.recipe.ingredients,
							scaleMultiplier: item.scaleMultiplier,
						},
					]
				: [],
		)

	const demand = new Map<string, MealShoppingDemand>()
	for (const mealId of ids) {
		const items = recipeItems.filter((item) => item.mealId === mealId)
		const cooked = items.filter((item) => item.cooked)
		demand.set(mealId, {
			lines: buildShoppingDemand({
				recipeBatches: batches(items.filter((item) => !item.cooked)),
				noteLines: noteLines
					.filter((line) => line.noteItem.mealId === mealId)
					.map(({ name, quantity, unit }) => ({ name, quantity, unit })),
			}),
			cookedIdentities: new Set(
				buildShoppingDemand({ recipeBatches: batches(cooked) }).map(
					(line) => line.canonicalName,
				),
			),
			cookedRecipeGone: cooked.some((item) => !item.recipe),
		})
	}
	return demand
}
