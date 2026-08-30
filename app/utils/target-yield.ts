export type TypedYield = {
	amount: number
	label: string
}

const MULTIPLIER_DECIMAL_PLACES = 2
const MULTIPLIER_FACTOR = 10 ** MULTIPLIER_DECIMAL_PLACES
const MIN_SCALE_MULTIPLIER = 0.01
const MAX_SCALE_MULTIPLIER = 100

/**
 * A Recipe has a usable typed yield only when both halves of the explicit
 * metadata pair are present. Legacy servings is deliberately outside this
 * interface: it cannot turn unknown yield into known yield.
 */
export function getTypedYield(recipe: {
	yieldAmount: number | null
	yieldLabel: string | null
	servings?: unknown
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

function roundScaleMultiplier(value: number) {
	// Scale epsilon with the value so decimal half boundaries such as 1.005 and
	// 100.005 behave consistently despite their binary floating representation.
	const epsilon = Number.EPSILON * Math.max(1, Math.abs(value))
	return Math.round((value + epsilon) * MULTIPLIER_FACTOR) / MULTIPLIER_FACTOR
}

/**
 * The one target-yield write rule. A target is presentation input; the result
 * remains the positive, bounded multiplier every downstream consumer stores.
 */
export function targetYieldToScaleMultiplier(
	targetAmount: number,
	recipeYield: TypedYield | null,
): number | null {
	if (
		recipeYield == null ||
		!Number.isFinite(targetAmount) ||
		targetAmount <= 0
	) {
		return null
	}
	const multiplier = roundScaleMultiplier(targetAmount / recipeYield.amount)
	return multiplier >= MIN_SCALE_MULTIPLIER &&
		multiplier <= MAX_SCALE_MULTIPLIER
		? multiplier
		: null
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
