import {
	type Recipe,
	type Ingredient,
	type InventoryItem,
} from '@prisma/client'
import { parseAmount, formatAmount } from './fractions.ts'
import {
	getCanonicalIngredientName,
	ingredientMatchesInventoryItem,
	isStapleIngredient,
} from './recipe-matching.server.ts'
import { guessCategory } from './shopping-list-validation.ts'
import {
	normalizeUnit,
	getUnitFamily,
	convertAndSum,
} from './unit-conversion.ts'

type RecipeWithIngredients = Recipe & {
	ingredients: Ingredient[]
}

type RecipeEntry = {
	recipe: RecipeWithIngredients
	servings?: number | null
}

export type ShoppingListItemInput = {
	name: string
	quantity?: string | null
	unit?: string | null
	category: string
	source: string
}

// Generate shopping list from recipe entries, consolidate duplicates
// Accepts either RecipeWithIngredients[] (backwards-compatible) or RecipeEntry[]
export function generateShoppingListFromRecipes(
	input: RecipeWithIngredients[] | RecipeEntry[],
): ShoppingListItemInput[] {
	// Normalize input to RecipeEntry[]
	const entries: RecipeEntry[] = isRecipeArray(input)
		? input.map((recipe) => ({ recipe }))
		: input

	const ingredientMap = new Map<
		string,
		{
			name: string
			quantities: Array<{ amount?: string | null; unit?: string | null }>
			category: string
		}
	>()

	for (const entry of entries) {
		const { recipe, servings } = entry
		const ratio =
			servings && recipe.servings > 0 ? servings / recipe.servings : 1

		for (const ingredient of recipe.ingredients) {
			if (ingredient.isHeading) continue
			const normalizedName = getCanonicalIngredientName(ingredient.name)

			// Scale the amount by the serving ratio
			const scaledAmount = scaleAmountString(ingredient.amount, ratio)

			if (ingredientMap.has(normalizedName)) {
				ingredientMap.get(normalizedName)!.quantities.push({
					amount: scaledAmount,
					unit: ingredient.unit,
				})
			} else {
				ingredientMap.set(normalizedName, {
					name: ingredient.name,
					quantities: [{ amount: scaledAmount, unit: ingredient.unit }],
					category: guessCategory(ingredient.name),
				})
			}
		}
	}

	const items: ShoppingListItemInput[] = []

	for (const [, data] of ingredientMap) {
		const consolidated = consolidateQuantities(data.quantities)

		items.push({
			name: data.name,
			quantity: consolidated.quantity,
			unit: consolidated.unit,
			category: data.category,
			source: 'generated',
		})
	}

	return items.sort((a, b) => a.category.localeCompare(b.category))
}

function isRecipeArray(
	input: RecipeWithIngredients[] | RecipeEntry[],
): input is RecipeWithIngredients[] {
	if (input.length === 0) return true
	return 'ingredients' in input[0]! && !('recipe' in input[0]!)
}

export function scaleAmountString(
	amount: string | null,
	ratio: number,
): string | null {
	if (!amount || ratio === 1) return amount
	const parsed = parseAmount(amount)
	if (parsed === null) return amount
	return formatAmount(parsed * ratio)
}

// Sum numeric quantities with same unit, or convert compatible units, or show count
export function consolidateQuantities(
	quantities: Array<{ amount?: string | null; unit?: string | null }>,
): { quantity?: string; unit?: string } {
	if (quantities.length === 0) return {}
	if (quantities.length === 1) {
		return {
			quantity: quantities[0]!.amount ?? undefined,
			unit: quantities[0]!.unit ?? undefined,
		}
	}

	// Normalize all units
	const normalized = quantities.map((q) => ({
		amount: q.amount,
		unit: q.unit,
		normalizedUnit: q.unit ? normalizeUnit(q.unit) : '',
	}))

	// Check if all have the same normalized unit
	const firstNormUnit = normalized[0]!.normalizedUnit
	const sameNormUnit = normalized.every(
		(q) => q.normalizedUnit === firstNormUnit,
	)

	if (sameNormUnit) {
		const numericQuantities = normalized
			.map((q) => parseAmount(q.amount ?? ''))
			.filter((n): n is number => n !== null)

		if (numericQuantities.length === quantities.length) {
			const sum = numericQuantities.reduce((a, b) => a + b, 0)
			return {
				quantity: formatAmount(sum),
				unit: normalized[0]!.unit ?? undefined,
			}
		}
	}

	// Try unit conversion within the same family
	const parsed = normalized.map((q) => {
		const amount = parseAmount(q.amount ?? '')
		if (amount === null) return null
		const family = q.normalizedUnit ? getUnitFamily(q.normalizedUnit) : null
		if (!family) return null
		return {
			amount,
			normalizedUnit: q.normalizedUnit,
			familyName: family.family.name,
			family: family.family,
		}
	})

	// All must be parseable and in the same family
	if (parsed.every((p) => p !== null)) {
		const firstFamily = parsed[0]!.familyName
		if (parsed.every((p) => p!.familyName === firstFamily)) {
			const result = convertAndSum(
				parsed.map((p) => ({
					amount: p!.amount,
					normalizedUnit: p!.normalizedUnit,
				})),
				parsed[0]!.family,
			)
			return {
				quantity: formatAmount(result.value),
				unit: result.unit,
			}
		}
	}

	return { quantity: `${quantities.length}×`, unit: undefined }
}

/**
 * Remove items from the shopping list that the user already has in inventory
 * (unless low stock) and items that are common staples.
 */
export function subtractInventoryFromShoppingList(
	items: ShoppingListItemInput[],
	inventoryItems: InventoryItem[],
): {
	items: ShoppingListItemInput[]
	removedCount: number
	removedItems: string[]
} {
	const availableInventory = inventoryItems.filter((item) => !item.lowStock)
	const removedItems: string[] = []

	const filtered = items.filter((item) => {
		// Remove staple ingredients
		if (isStapleIngredient({ name: item.name })) {
			removedItems.push(item.name)
			return false
		}

		// Remove items the user already has (not low stock)
		const hasInInventory = availableInventory.some((inv) =>
			ingredientMatchesInventoryItem({ name: item.name }, inv),
		)
		if (hasInInventory) {
			removedItems.push(item.name)
			return false
		}

		return true
	})

	return {
		items: filtered,
		removedCount: removedItems.length,
		removedItems,
	}
}
