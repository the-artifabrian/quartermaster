import { prisma } from './db.server.ts'
import { parseAmount } from './fractions.ts'
import {
	ingredientMatchesInventoryItem,
	isStapleIngredient,
} from './recipe-matching.server.ts'
import { normalizeUnit, getUnitFamily, isCountUnit } from './unit-conversion.ts'

export type SkipReason = 'no_quantity' | 'incompatible_units'

export type SubtractionSummary = {
	removed: string[]
	updated: string[]
	skipped: Array<{
		name: string
		inventoryItemId: string
		reason: SkipReason
	}>
}

/**
 * After cooking a recipe, subtract its ingredients from the user's inventory.
 *
 * @param recipeId - The recipe that was cooked
 * @param householdId - The household whose inventory to subtract from
 * @param servingRatio - Ratio of cooked servings to recipe default (e.g., 2.0 if doubled)
 *
 * For each non-staple ingredient:
 * - Find a matching inventory item
 * - If both have numeric quantities with compatible units, subtract
 * - If the inventory quantity drops to 0 or below, delete the item
 * - If units are incompatible or quantities are missing, report as skipped
 *
 * Returns a summary of what changed, including skipped items with reasons.
 */
export async function subtractRecipeIngredientsFromInventory(
	recipeId: string,
	householdId: string,
	servingRatio: number = 1,
): Promise<SubtractionSummary> {
	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		include: { ingredients: true },
	})

	if (!recipe) return { removed: [], updated: [], skipped: [] }

	const inventoryItems = await prisma.inventoryItem.findMany({
		where: { householdId },
	})

	const removed: string[] = []
	const updated: string[] = []
	const skipped: SubtractionSummary['skipped'] = []

	for (const ingredient of recipe.ingredients) {
		if (ingredient.isHeading) continue
		if (isStapleIngredient(ingredient)) continue

		const match = inventoryItems.find((item) =>
			ingredientMatchesInventoryItem(ingredient, item),
		)
		if (!match) continue

		// If inventory has no tracked quantity, report as skipped
		if (match.quantity === null) {
			skipped.push({
				name: match.name,
				inventoryItemId: match.id,
				reason: 'no_quantity',
			})
			continue
		}

		if (!ingredient.amount) continue

		const ingredientAmount = parseAmount(ingredient.amount)
		if (ingredientAmount === null) continue

		// Scale by serving ratio
		const scaledAmount = ingredientAmount * servingRatio

		const ingredientUnit = ingredient.unit ? normalizeUnit(ingredient.unit) : ''
		const inventoryUnit = match.unit ? normalizeUnit(match.unit) : ''

		// Same unit after normalization, or both are count-like — subtract directly
		if (
			ingredientUnit === inventoryUnit ||
			(isCountUnit(ingredientUnit) && isCountUnit(inventoryUnit))
		) {
			const newQuantity = match.quantity - scaledAmount
			if (newQuantity <= 0) {
				await prisma.inventoryItem.delete({ where: { id: match.id } })
				removed.push(match.name)
			} else {
				await prisma.inventoryItem.update({
					where: { id: match.id },
					data: { quantity: newQuantity },
				})
				updated.push(match.name)
			}
			continue
		}

		// Try unit conversion within the same family
		if (ingredientUnit && inventoryUnit) {
			const ingFamily = getUnitFamily(ingredientUnit)
			const invFamily = getUnitFamily(inventoryUnit)

			if (
				ingFamily &&
				invFamily &&
				ingFamily.family.name === invFamily.family.name
			) {
				// Convert ingredient amount to inventory's unit
				const ingredientInBase = scaledAmount * ingFamily.factor
				const ingredientInInventoryUnit = ingredientInBase / invFamily.factor

				const newQuantity = match.quantity - ingredientInInventoryUnit
				if (newQuantity <= 0) {
					await prisma.inventoryItem.delete({ where: { id: match.id } })
					removed.push(match.name)
				} else {
					await prisma.inventoryItem.update({
						where: { id: match.id },
						data: { quantity: newQuantity },
					})
					updated.push(match.name)
				}
				continue
			}
		}

		// Units are incompatible but name matched — report as skipped
		skipped.push({
			name: match.name,
			inventoryItemId: match.id,
			reason: 'incompatible_units',
		})
	}

	return { removed, updated, skipped }
}

export type SubtractionPreview = {
	willSubtract: Array<{
		name: string
		currentQuantity: number | null
		currentUnit: string | null
		subtractAmount: number | null
		newQuantity: number | null
		willBeRemoved: boolean
	}>
	noMatch: string[]
	willSkip: Array<{ name: string; reason: SkipReason }>
}

/**
 * Preview what inventory subtraction WOULD do without actually writing to the DB.
 * Used to show the user an impact summary before confirming "I Made This".
 */
export async function previewInventorySubtraction(
	recipeId: string,
	householdId: string,
	servingRatio: number = 1,
): Promise<SubtractionPreview> {
	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		include: { ingredients: true },
	})

	if (!recipe) return { willSubtract: [], noMatch: [], willSkip: [] }

	const inventoryItems = await prisma.inventoryItem.findMany({
		where: { householdId },
	})

	const willSubtract: SubtractionPreview['willSubtract'] = []
	const noMatch: string[] = []
	const willSkip: SubtractionPreview['willSkip'] = []

	for (const ingredient of recipe.ingredients) {
		if (ingredient.isHeading) continue
		if (isStapleIngredient(ingredient)) continue

		const match = inventoryItems.find((item) =>
			ingredientMatchesInventoryItem(ingredient, item),
		)
		if (!match) {
			noMatch.push(ingredient.name)
			continue
		}

		// If inventory has no tracked quantity, report as willSkip
		if (match.quantity === null) {
			willSkip.push({ name: match.name, reason: 'no_quantity' })
			continue
		}

		if (!ingredient.amount) continue

		const ingredientAmount = parseAmount(ingredient.amount)
		if (ingredientAmount === null) continue

		const scaledAmount = ingredientAmount * servingRatio
		const ingredientUnit = ingredient.unit ? normalizeUnit(ingredient.unit) : ''
		const inventoryUnit = match.unit ? normalizeUnit(match.unit) : ''

		// Same unit after normalization, or both are count-like — subtract directly
		if (
			ingredientUnit === inventoryUnit ||
			(isCountUnit(ingredientUnit) && isCountUnit(inventoryUnit))
		) {
			const newQuantity = match.quantity - scaledAmount
			willSubtract.push({
				name: match.name,
				currentQuantity: match.quantity,
				currentUnit: match.unit,
				subtractAmount: scaledAmount,
				newQuantity: newQuantity <= 0 ? 0 : newQuantity,
				willBeRemoved: newQuantity <= 0,
			})
			continue
		}

		// Try unit conversion within the same family
		if (ingredientUnit && inventoryUnit) {
			const ingFamily = getUnitFamily(ingredientUnit)
			const invFamily = getUnitFamily(inventoryUnit)

			if (
				ingFamily &&
				invFamily &&
				ingFamily.family.name === invFamily.family.name
			) {
				const ingredientInBase = scaledAmount * ingFamily.factor
				const ingredientInInventoryUnit = ingredientInBase / invFamily.factor
				const newQuantity = match.quantity - ingredientInInventoryUnit
				willSubtract.push({
					name: match.name,
					currentQuantity: match.quantity,
					currentUnit: match.unit,
					subtractAmount: ingredientInInventoryUnit,
					newQuantity: newQuantity <= 0 ? 0 : newQuantity,
					willBeRemoved: newQuantity <= 0,
				})
				continue
			}
		}

		// Units are incompatible but name matched — report as willSkip
		willSkip.push({ name: match.name, reason: 'incompatible_units' })
	}

	return { willSubtract, noMatch, willSkip }
}
