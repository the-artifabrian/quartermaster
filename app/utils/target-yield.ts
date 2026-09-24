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
