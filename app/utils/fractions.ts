import { isMetricUnit, round2 } from './unit-conversion.ts'

/** Unicode fraction characters → numeric values */
const UNICODE_FRACTIONS: Record<string, number> = {
	'½': 1 / 2,
	'⅓': 1 / 3,
	'⅔': 2 / 3,
	'¼': 1 / 4,
	'¾': 3 / 4,
	'⅛': 1 / 8,
	'⅜': 3 / 8,
	'⅝': 5 / 8,
	'⅞': 7 / 8,
}

const UNICODE_FRACTION_PATTERN = /[½⅓⅔¼¾⅛⅜⅝⅞]/

/**
 * Parse a string amount into a number.
 * Handles fractions ("1/2"), mixed numbers ("1 1/2"), decimals ("1.5"),
 * unicode fractions ("½", "¾"), and mixed unicode ("1½", "1 ½").
 */
export function parseAmount(amount: string): number | null {
	const trimmed = amount.trim()
	if (!trimmed) return null

	// Unicode fraction (standalone): "½", "¾"
	if (trimmed.length === 1 && UNICODE_FRACTIONS[trimmed] !== undefined) {
		return UNICODE_FRACTIONS[trimmed]!
	}

	// Mixed unicode fraction: "1½", "1 ½", "2¾", "2 ¼"
	if (UNICODE_FRACTION_PATTERN.test(trimmed)) {
		const mixedUnicode = trimmed.match(/^(\d+)\s*([½⅓⅔¼¾⅛⅜⅝⅞])$/)
		if (mixedUnicode) {
			const whole = parseInt(mixedUnicode[1]!, 10)
			const frac = UNICODE_FRACTIONS[mixedUnicode[2]!]
			if (frac !== undefined) return whole + frac
		}
	}

	// Mixed number: "1 1/2"
	const mixedMatch = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/)
	if (mixedMatch) {
		const whole = parseInt(mixedMatch[1]!, 10)
		const num = parseInt(mixedMatch[2]!, 10)
		const den = parseInt(mixedMatch[3]!, 10)
		if (den === 0) return null
		return whole + num / den
	}

	// Simple fraction: "1/2"
	const fractionMatch = trimmed.match(/^(\d+)\/(\d+)$/)
	if (fractionMatch) {
		const num = parseInt(fractionMatch[1]!, 10)
		const den = parseInt(fractionMatch[2]!, 10)
		if (den === 0) return null
		return num / den
	}

	// Decimal or integer
	const n = parseFloat(trimmed)
	return isNaN(n) ? null : n
}

// Common fractions for display, ordered by denominator then numerator
const COMMON_FRACTIONS: Array<{ value: number; display: string }> = [
	{ value: 1 / 8, display: '1/8' },
	{ value: 1 / 4, display: '1/4' },
	{ value: 1 / 3, display: '1/3' },
	{ value: 3 / 8, display: '3/8' },
	{ value: 1 / 2, display: '1/2' },
	{ value: 5 / 8, display: '5/8' },
	{ value: 2 / 3, display: '2/3' },
	{ value: 3 / 4, display: '3/4' },
	{ value: 7 / 8, display: '7/8' },
]

/**
 * Format a number as a human-readable amount.
 * Snaps to nearest common fraction (1/8, 1/4, 1/3, 1/2, 2/3, 3/4).
 * Returns mixed numbers for values > 1 (e.g., "1 1/2").
 * Metric units (g, kg, ml, l) are kept as decimals — "0.4 g", not "3/8 g".
 *
 * This is the EXACT policy: author-written and scaled amounts keep their
 * precision. Approximate density conversions use roundMetricAmount in
 * metric-conversion.ts, which rounds shopper-friendly instead.
 */
export function formatAmount(value: number, unit?: string | null): string {
	if (value <= 0) return '0'

	if (unit && isMetricUnit(unit)) {
		return round2(value).toString()
	}

	const whole = Math.floor(value)
	const fractional = value - whole

	// If close to a whole number
	if (fractional < 0.05) {
		return whole.toString()
	}
	if (fractional > 0.95) {
		return (whole + 1).toString()
	}

	const snapped = snapToCommonFraction(fractional)

	// If not close enough to any common fraction, use decimal
	if (!snapped) {
		return round2(value).toString()
	}

	if (whole === 0) {
		return snapped.display
	}
	return `${whole} ${snapped.display}`
}

function snapToCommonFraction(
	fractional: number,
): { value: number; display: string } | null {
	let closest = COMMON_FRACTIONS[0]!
	let minDiff = Math.abs(fractional - closest.value)

	for (const frac of COMMON_FRACTIONS) {
		const diff = Math.abs(fractional - frac.value)
		if (diff < minDiff) {
			minDiff = diff
			closest = frac
		}
	}

	return minDiff > 0.05 ? null : closest
}

/**
 * Scale an ingredient amount string by a ratio.
 * Returns the scaled amount as a formatted string, or the original if unparseable.
 */
export function scaleAmount(
	amount: string | null | undefined,
	ratio: number,
	unit?: string | null,
): string | null {
	if (!amount) return null
	const parsed = parseAmount(amount)
	if (parsed === null) return amount
	return formatAmount(parsed * ratio, unit)
}

export type KitchenAmount = {
	display: string
	/**
	 * True when the display was numerically rounded away from the exact scaled
	 * value (callers prefix ≈). Fraction translations ("generous 1/2") stay
	 * false — the qualifier word already carries the approximation.
	 */
	approximate: boolean
	/** Exact scaled numeric value, for downstream conversion (e.g. metric). */
	value: number | null
}

/**
 * Eighths that no measuring-spoon set has, translated to the nearest spoon
 * that exists with a cook's qualifier: 5/8 tsp is "generous 1/2 tsp".
 * 7/8 carries into "scant <next whole>".
 */
const KITCHEN_FRACTION_QUALIFIERS: Record<
	string,
	{ qualifier: 'generous' | 'scant'; display: string; carry?: boolean }
> = {
	'3/8': { qualifier: 'generous', display: '1/3' },
	'5/8': { qualifier: 'generous', display: '1/2' },
	'7/8': { qualifier: 'scant', display: '', carry: true },
}

/**
 * Round a scaled metric amount to a measurable kitchen quantity. Slightly
 * coarser than roundMetricAmount in metric-conversion.ts: scaling already
 * introduced false precision, so 312.5 g reads better as "≈310 g" than as
 * a number no scale shows.
 */
function roundKitchenMetric(value: number, unit: string): number {
	if (isKgOrLiter(unit)) {
		return Math.round(value * 10) / 10
	}
	if (value >= 200) return Math.round(value / 10) * 10
	if (value > 50) return Math.round(value / 5) * 5
	if (value < 1) return round2(value)
	return Math.round(value)
}

function isKgOrLiter(unit: string): boolean {
	return /^(kg|kilograms?|l|liters?|litres?)$/i.test(unit.trim())
}

/**
 * Scale an ingredient amount for *display while cooking*: rounds to
 * quantities a kitchen can actually measure (312.5 g → ≈310 g, 5/8 tsp →
 * "generous 1/2" tsp). Author-written amounts (ratio 1) keep their exact
 * precision — kitchen rounding only smooths what scaling itself invented.
 * Shopping-list quantities keep using scaleAmount (exact policy).
 */
export function scaleAmountKitchen(
	amount: string | null | undefined,
	ratio: number,
	unit?: string | null,
): KitchenAmount | null {
	if (!amount) return null
	const parsed = parseAmount(amount)
	if (parsed === null)
		return { display: amount, approximate: false, value: null }

	const value = parsed * ratio
	if (ratio === 1) {
		return { display: formatAmount(value, unit), approximate: false, value }
	}

	if (unit && isMetricUnit(unit)) {
		const rounded = roundKitchenMetric(value, unit)
		return {
			display: rounded.toString(),
			approximate: rounded !== round2(value),
			value,
		}
	}

	const exact = formatAmount(value, unit)
	const whole = Math.floor(value)
	const fractional = value - whole
	if (fractional < 0.05 || fractional > 0.95) {
		return { display: exact, approximate: false, value }
	}

	const snapped = snapToCommonFraction(fractional)
	const kitchen = snapped ? KITCHEN_FRACTION_QUALIFIERS[snapped.display] : null
	if (!kitchen) {
		return { display: exact, approximate: false, value }
	}

	if (kitchen.carry) {
		return { display: `scant ${whole + 1}`, approximate: false, value }
	}
	const fractionPart =
		whole === 0 ? kitchen.display : `${whole} ${kitchen.display}`
	return {
		display: `${kitchen.qualifier} ${fractionPart}`,
		approximate: false,
		value,
	}
}
