import {
	type Recipe,
	type Ingredient,
	type InventoryItem,
} from '@prisma/client'
import { parseAmount, formatAmount } from './fractions.ts'
import { parseIngredient } from './ingredient-parser.ts'
import {
	getCanonicalIngredientName,
	ingredientMatchesInventoryItem,
	isOptionalIngredient,
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

// Safety net: detect ingredients that look like section headings but aren't
// marked with isHeading (e.g. from manual entry or import paths that don't
// detect headings).
const HEADING_EXACT =
	/^(?:sauce|marinade|filling|topping|glaze|garnish|dressing|batter|crust|frosting|assembly|spice mix|dry ingredients|wet ingredients|meat and marinade|stir[- ]?fry|quick marinade|broth)$/i
const HEADING_PREFIX =
	/^(?:for the |for |the |quick (?:marinade|sauce|dressing) )/i

function looksLikeHeading(ingredient: {
	name: string
	amount: string | null
	unit: string | null
}): boolean {
	if (ingredient.amount || ingredient.unit) return false
	const name = ingredient.name.trim()
	if (!name || name.length > 60) return false
	// Ends with colon (e.g. "For the sauce:")
	if (name.endsWith(':')) return true
	// Matches known heading patterns
	if (HEADING_EXACT.test(name)) return true
	if (HEADING_PREFIX.test(name)) return true
	return false
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
			if (looksLikeHeading(ingredient)) continue
			if (isOptionalIngredient(ingredient)) continue

			// Re-parse ingredients that have no amount but name starts with a quantity
			let effectiveName = ingredient.name
			let effectiveAmount = ingredient.amount
			let effectiveUnit = ingredient.unit
			if (
				!effectiveAmount &&
				/^(?:~?\d|[½⅓⅔¼¾⅛⅜⅝⅞])/.test(effectiveName)
			) {
				const reparsed = parseIngredient(effectiveName)
				if (reparsed?.name && reparsed?.amount) {
					effectiveName = reparsed.name
					effectiveAmount = reparsed.amount
					effectiveUnit = reparsed.unit ?? null
				}
			}

			// Strip leading "of " from display names (parser artifact)
			if (effectiveName.startsWith('of ')) {
				effectiveName = effectiveName.slice(3)
			}

			const normalizedName = getCanonicalIngredientName(effectiveName)

			// Scale the amount by the serving ratio
			const scaledAmount = scaleAmountString(effectiveAmount, ratio)

			if (ingredientMap.has(normalizedName)) {
				ingredientMap.get(normalizedName)!.quantities.push({
					amount: scaledAmount,
					unit: effectiveUnit,
				})
			} else {
				ingredientMap.set(normalizedName, {
					name: effectiveName,
					quantities: [{ amount: scaledAmount, unit: effectiveUnit }],
					category: guessCategory(effectiveName),
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
 * Annotate shopping list items with inventory match info instead of filtering.
 * - Staples (salt, pepper, water, oil) are still removed entirely.
 * - Items matching inventory get `inStock: true` (will be pre-checked).
 * - Everything else gets `inStock: false`.
 */
export function annotateInventoryMatches(
	items: ShoppingListItemInput[],
	inventoryItems: InventoryItem[],
): {
	items: Array<ShoppingListItemInput & { inStock: boolean }>
	stapleCount: number
	inStockCount: number
} {
	let stapleCount = 0
	const result: Array<ShoppingListItemInput & { inStock: boolean }> = []

	for (const item of items) {
		// Still strip staples entirely — nobody needs "salt" on their list
		if (isStapleIngredient({ name: item.name })) {
			stapleCount++
			continue
		}

		const hasInInventory = inventoryItems.some((inv) =>
			ingredientMatchesInventoryItem({ name: item.name }, inv),
		)

		result.push({ ...item, inStock: hasInInventory })
	}

	return {
		items: result,
		stapleCount,
		inStockCount: result.filter((i) => i.inStock).length,
	}
}
