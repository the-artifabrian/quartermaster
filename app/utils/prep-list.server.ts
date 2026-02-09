import { type Recipe, type Ingredient } from '@prisma/client'
import {
	getCanonicalIngredientName,
	isStapleIngredient,
} from './recipe-matching.server.ts'
import {
	consolidateQuantities,
	scaleAmountString,
} from './shopping-list.server.ts'

type RecipeWithIngredients = Recipe & { ingredients: Ingredient[] }

export type PrepEntry = {
	recipe: RecipeWithIngredients
	servings: number | null
	date: Date
	mealType: string
}

export type PrepItemUsage = {
	recipeTitle: string
	date: Date
	mealType: string
	quantity: string | null
	unit: string | null
}

export type PrepItem = {
	ingredientName: string
	canonicalName: string
	totalQuantity: string | null
	totalUnit: string | null
	usedIn: PrepItemUsage[]
}

/**
 * Generate a unified prep list from meal plan entries.
 *
 * Identifies ingredients shared across 2+ recipes (excluding staples),
 * aggregates their quantities, and attributes them back to each recipe.
 * This is the "Sunday prep" feature: prep shared ingredients once,
 * store them, assemble meals throughout the week.
 */
export function generatePrepList(entries: PrepEntry[]): PrepItem[] {
	if (entries.length === 0) return []

	// Map canonical name → { displayName, usages across all entries }
	const ingredientMap = new Map<
		string,
		{
			displayName: string
			recipeIds: Set<string>
			usages: Array<{
				recipeTitle: string
				date: Date
				mealType: string
				amount: string | null
				unit: string | null
			}>
		}
	>()

	for (const entry of entries) {
		const { recipe, servings } = entry
		const ratio =
			servings && recipe.servings > 0 ? servings / recipe.servings : 1

		for (const ingredient of recipe.ingredients) {
			if (isStapleIngredient(ingredient)) continue

			const canonical = getCanonicalIngredientName(ingredient.name)
			const scaledAmount = scaleAmountString(ingredient.amount, ratio)

			const existing = ingredientMap.get(canonical)
			if (existing) {
				existing.recipeIds.add(recipe.id)
				existing.usages.push({
					recipeTitle: recipe.title,
					date: entry.date,
					mealType: entry.mealType,
					amount: scaledAmount,
					unit: ingredient.unit,
				})
			} else {
				ingredientMap.set(canonical, {
					displayName: ingredient.name,
					recipeIds: new Set([recipe.id]),
					usages: [
						{
							recipeTitle: recipe.title,
							date: entry.date,
							mealType: entry.mealType,
							amount: scaledAmount,
							unit: ingredient.unit,
						},
					],
				})
			}
		}
	}

	// Filter to only ingredients used in 2+ distinct recipes
	const prepItems: PrepItem[] = []

	for (const [canonical, data] of ingredientMap) {
		if (data.recipeIds.size < 2) continue

		// Aggregate total quantity
		const quantities = data.usages.map((u) => ({
			amount: u.amount,
			unit: u.unit,
		}))
		const consolidated = consolidateQuantities(quantities)

		prepItems.push({
			ingredientName: data.displayName,
			canonicalName: canonical,
			totalQuantity: consolidated.quantity ?? null,
			totalUnit: consolidated.unit ?? null,
			usedIn: data.usages.map((u) => ({
				recipeTitle: u.recipeTitle,
				date: u.date,
				mealType: u.mealType,
				quantity: u.amount,
				unit: u.unit,
			})),
		})
	}

	// Sort by number of usages across meal plan entries (most-shared first)
	return prepItems.sort((a, b) => b.usedIn.length - a.usedIn.length)
}
