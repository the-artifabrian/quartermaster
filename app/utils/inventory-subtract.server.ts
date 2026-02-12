import { prisma } from './db.server.ts'
import { parseAmount } from './fractions.ts'
import {
	ingredientMatchesInventoryItem,
	isStapleIngredient,
} from './recipe-matching.server.ts'
import { normalizeUnit, getUnitFamily } from './unit-conversion.ts'

export type SubtractionSummary = {
	removed: string[]
	flaggedLow: string[]
	updated: string[]
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
 * - If units are incompatible or quantities are missing, skip silently
 *
 * Returns a summary of what changed.
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

	if (!recipe) return { removed: [], flaggedLow: [], updated: [] }

	const inventoryItems = await prisma.inventoryItem.findMany({
		where: { householdId },
	})

	const removed: string[] = []
	const flaggedLow: string[] = []
	const updated: string[] = []

	for (const ingredient of recipe.ingredients) {
		if (isStapleIngredient(ingredient)) continue

		const match = inventoryItems.find((item) =>
			ingredientMatchesInventoryItem(ingredient, item),
		)
		if (!match) continue

		// If inventory has no tracked quantity, just flag as low stock
		if (match.quantity === null) {
			await prisma.inventoryItem.update({
				where: { id: match.id },
				data: { lowStock: true },
			})
			flaggedLow.push(match.name)
			continue
		}

		if (!ingredient.amount) continue

		const ingredientAmount = parseAmount(ingredient.amount)
		if (ingredientAmount === null) continue

		// Scale by serving ratio
		const scaledAmount = ingredientAmount * servingRatio

		const ingredientUnit = ingredient.unit ? normalizeUnit(ingredient.unit) : ''
		const inventoryUnit = match.unit ? normalizeUnit(match.unit) : ''

		// Same unit after normalization — subtract directly
		if (ingredientUnit === inventoryUnit) {
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

		// Units are incompatible — skip silently
	}

	return { removed, flaggedLow, updated }
}

export type SubtractionPreview = {
	willSubtract: Array<{
		name: string
		currentQuantity: number | null
		currentUnit: string | null
		subtractAmount: number | null
		newQuantity: number | null
		willBeRemoved: boolean
		willBeFlaggedLow: boolean
	}>
	noMatch: string[]
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

	if (!recipe) return { willSubtract: [], noMatch: [] }

	const inventoryItems = await prisma.inventoryItem.findMany({
		where: { householdId },
	})

	const willSubtract: SubtractionPreview['willSubtract'] = []
	const noMatch: string[] = []

	for (const ingredient of recipe.ingredients) {
		if (isStapleIngredient(ingredient)) continue

		const match = inventoryItems.find((item) =>
			ingredientMatchesInventoryItem(ingredient, item),
		)
		if (!match) {
			noMatch.push(ingredient.name)
			continue
		}

		// If inventory has no tracked quantity, will be flagged as low stock
		if (match.quantity === null) {
			willSubtract.push({
				name: match.name,
				currentQuantity: null,
				currentUnit: match.unit,
				subtractAmount: null,
				newQuantity: null,
				willBeRemoved: false,
				willBeFlaggedLow: true,
			})
			continue
		}

		if (!ingredient.amount) continue

		const ingredientAmount = parseAmount(ingredient.amount)
		if (ingredientAmount === null) continue

		const scaledAmount = ingredientAmount * servingRatio
		const ingredientUnit = ingredient.unit
			? normalizeUnit(ingredient.unit)
			: ''
		const inventoryUnit = match.unit ? normalizeUnit(match.unit) : ''

		// Same unit after normalization
		if (ingredientUnit === inventoryUnit) {
			const newQuantity = match.quantity - scaledAmount
			willSubtract.push({
				name: match.name,
				currentQuantity: match.quantity,
				currentUnit: match.unit,
				subtractAmount: scaledAmount,
				newQuantity: newQuantity <= 0 ? 0 : newQuantity,
				willBeRemoved: newQuantity <= 0,
				willBeFlaggedLow: false,
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
				const ingredientInInventoryUnit =
					ingredientInBase / invFamily.factor
				const newQuantity = match.quantity - ingredientInInventoryUnit
				willSubtract.push({
					name: match.name,
					currentQuantity: match.quantity,
					currentUnit: match.unit,
					subtractAmount: ingredientInInventoryUnit,
					newQuantity: newQuantity <= 0 ? 0 : newQuantity,
					willBeRemoved: newQuantity <= 0,
					willBeFlaggedLow: false,
				})
				continue
			}
		}

		// Units are incompatible — treat as no match for preview
		noMatch.push(ingredient.name)
	}

	return { willSubtract, noMatch }
}
