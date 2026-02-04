/**
 * Parse a string amount into a number.
 * Handles fractions ("1/2"), mixed numbers ("1 1/2"), and decimals ("1.5").
 */
export function parseAmount(amount: string): number | null {
	const trimmed = amount.trim()
	if (!trimmed) return null

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
 */
export function formatAmount(value: number): string {
	if (value <= 0) return '0'

	const whole = Math.floor(value)
	const fractional = value - whole

	// If close to a whole number
	if (fractional < 0.05) {
		return whole.toString()
	}
	if (fractional > 0.95) {
		return (whole + 1).toString()
	}

	// Find the nearest common fraction
	let closest = COMMON_FRACTIONS[0]!
	let minDiff = Math.abs(fractional - closest.value)

	for (const frac of COMMON_FRACTIONS) {
		const diff = Math.abs(fractional - frac.value)
		if (diff < minDiff) {
			minDiff = diff
			closest = frac
		}
	}

	// If not close enough to any common fraction, use decimal
	if (minDiff > 0.05) {
		// Round to 1 decimal
		const rounded = Math.round(value * 10) / 10
		return rounded.toString()
	}

	if (whole === 0) {
		return closest.display
	}
	return `${whole} ${closest.display}`
}

/**
 * Scale an ingredient amount string by a ratio.
 * Returns the scaled amount as a formatted string, or the original if unparseable.
 */
export function scaleAmount(
	amount: string | null | undefined,
	ratio: number,
): string | null {
	if (!amount) return null
	const parsed = parseAmount(amount)
	if (parsed === null) return amount
	return formatAmount(parsed * ratio)
}
