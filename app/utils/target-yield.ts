import { scaledYieldLabel } from './ingredient-plural.ts'

export type TypedYield = {
	amount: number
	label: string
}

/**
 * A Recipe has a usable typed yield only when both halves of the explicit
 * metadata pair are present.
 */
export function getTypedYield(recipe: {
	yieldAmount: number | null
	yieldLabel: string | null
}): TypedYield | null {
	const label = recipe.yieldLabel?.trim()
	if (
		recipe.yieldAmount == null ||
		!Number.isFinite(recipe.yieldAmount) ||
		recipe.yieldAmount <= 0 ||
		!label
	) {
		return null
	}
	return { amount: recipe.yieldAmount, label }
}

/** Derive the friendly target from the stored source-of-truth multiplier. */
export function scaleMultiplierToTargetYield(
	scaleMultiplier: number,
	recipeYield: TypedYield | null,
): number | null {
	if (
		recipeYield == null ||
		!Number.isFinite(scaleMultiplier) ||
		scaleMultiplier <= 0
	) {
		return null
	}
	return scaleMultiplier * recipeYield.amount
}

/** Human/form rendering for a derived target: at most two decimal places. */
export function formatTargetYieldAmount(value: number): string {
	const epsilon = Number.EPSILON * Math.max(1, Math.abs(value))
	return String(Math.round((value + epsilon) * 100) / 100)
}

/**
 * What a typed yield makes at this scale, worded as the scale control words
 * it ("Makes 2 loaves", not "2 loaf"). Null without a typed yield.
 */
export function scaledYield(
	scaleMultiplier: number,
	recipe: { yieldAmount: number | null; yieldLabel: string | null },
) {
	const recipeYield = getTypedYield(recipe)
	const target = scaleMultiplierToTargetYield(scaleMultiplier, recipeYield)
	if (target == null || !recipeYield) return null
	return {
		amount: formatTargetYieldAmount(target),
		label: scaledYieldLabel(recipeYield.label, target, scaleMultiplier),
		original: recipeYield,
	}
}
