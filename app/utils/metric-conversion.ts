/**
 * Pure client-side metric conversion for recipe ingredients.
 *
 * Converts imperial measurements to metric by weight (grams/kg).
 * All volume units use ingredient density for accurate weight conversion.
 * Falls back to volume (ml/L) only for unknown ingredients.
 */

import { getDensity } from '#app/utils/ingredient-densities.ts'
import {
	isMetricUnit,
	normalizeUnit,
	round2,
} from '#app/utils/unit-conversion.ts'

export type MetricResult = {
	amount: number
	unit: string // "g", "ml", "kg", "L"
	approximate: boolean // true when density unknown (volume fallback)
}

/** Units that stay as-is (same in metric/imperial practice) */
const SKIP_UNITS = new Set(['tsp', 'tbsp'])

/** ml per US cup — matches the density table's gramsPerCup baseline */
const ML_PER_CUP = 240

/** Volume unit → ml conversion factors */
const VOLUME_ML_FACTORS: Record<string, number> = {
	'fl oz': 29.57,
	cup: ML_PER_CUP,
	pint: 473.18,
	quart: 946.35,
	gallon: 3785.41,
}

/**
 * Convert an imperial amount+unit to metric.
 *
 * Returns null when no conversion is needed (tsp/tbsp, already metric,
 * or unknown unit).
 */
export function convertToMetric(
	amount: number,
	unit: string,
	ingredientName: string,
): MetricResult | null {
	const normalized = normalizeUnit(unit)

	if (SKIP_UNITS.has(normalized)) return null
	if (isMetricUnit(normalized)) return null

	// Volume units — convert to weight via density, fall back to ml
	const volumeResult = convertVolume(amount, normalized, ingredientName)
	if (volumeResult) return volumeResult

	// Weight units — direct conversion
	if (normalized === 'oz') {
		// "oz" is ambiguous: weight ounces for solids, fluid ounces for liquids.
		// Use density table to disambiguate — known liquids get volume→weight.
		const density = getDensity(ingredientName)
		if (density?.isLiquid) {
			const totalMl = amount * 29.57 // fl oz → ml
			const gramsPerMl = density.gramsPerCup / ML_PER_CUP
			return scaleUpMetric(totalMl * gramsPerMl, 'g')
		}
		return scaleUpMetric(amount * 28.35, 'g')
	}

	if (normalized === 'lb') {
		return scaleUpMetric(amount * 453.6, 'g')
	}

	// Unknown unit — no conversion
	return null
}

/**
 * Convert a volume amount to weight (grams) using ingredient density.
 * Falls back to ml for unknown ingredients.
 * Returns null if the unit isn't a known volume unit.
 */
function convertVolume(
	amount: number,
	normalizedUnit: string,
	ingredientName: string,
): MetricResult | null {
	const mlFactor = VOLUME_ML_FACTORS[normalizedUnit]
	if (mlFactor === undefined) return null

	const totalMl = amount * mlFactor
	const density = getDensity(ingredientName)

	if (density) {
		const gramsPerMl = density.gramsPerCup / ML_PER_CUP
		return scaleUpMetric(totalMl * gramsPerMl, 'g')
	}

	// Unknown ingredient — fall back to volume
	return { ...scaleUpMetric(totalMl, 'ml'), approximate: true }
}

/**
 * Scale up small units to larger ones when appropriate.
 * g→kg at 1000g, ml→L at 1000ml.
 */
export function scaleUpMetric(
	value: number,
	baseUnit: 'g' | 'ml',
): MetricResult {
	if (baseUnit === 'g' && value >= 1000) {
		return { amount: value / 1000, unit: 'kg', approximate: false }
	}
	if (baseUnit === 'ml' && value >= 1000) {
		return { amount: value / 1000, unit: 'L', approximate: false }
	}
	return { amount: value, unit: baseUnit, approximate: false }
}

/**
 * Round a metric amount to a display-friendly number.
 *
 * This is the APPROXIMATE policy, for density-converted amounts where extra
 * digits are false precision: g/ml round to integers, nearest 5 above 50.
 * Sub-1 amounts keep 2 decimals so tiny quantities don't collapse to "0"
 * or "1". Exact (author-written) amounts use formatAmount in fractions.ts,
 * which preserves precision instead.
 */
export function roundMetricAmount(result: MetricResult): number {
	if (result.unit === 'kg' || result.unit === 'L') {
		return Math.round(result.amount * 10) / 10
	}
	if (result.amount > 50) {
		return Math.round(result.amount / 5) * 5
	}
	if (result.amount < 1) {
		return round2(result.amount)
	}
	return Math.round(result.amount)
}

/** kg/L display: whole numbers stay bare, otherwise 1 decimal. */
function formatKgL(value: number): string {
	return value % 1 === 0 ? value.toString() : value.toFixed(1)
}

/**
 * Round + scale a metric result for display, returning quantity and unit
 * separately (for callers that store them in separate fields).
 */
export function displayMetricAmount(result: MetricResult): {
	quantity: string
	unit: string
} {
	const value = roundMetricAmount(result)

	// Post-rounding scale-up: rounding can push values to 1000+
	if (result.unit === 'g' && value >= 1000) {
		return { quantity: formatKgL(value / 1000), unit: 'kg' }
	}
	if (result.unit === 'ml' && value >= 1000) {
		return { quantity: formatKgL(value / 1000), unit: 'L' }
	}
	if (result.unit === 'kg' || result.unit === 'L') {
		return { quantity: formatKgL(value), unit: result.unit }
	}
	return { quantity: value.toString(), unit: result.unit }
}

export function formatMetricAmount(result: MetricResult): string {
	const { quantity, unit } = displayMetricAmount(result)
	return `${quantity} ${unit}`
}

/**
 * Convert Fahrenheit temperatures in instruction text to Celsius.
 * Matches 3+ digit numbers followed by °F or F.
 * Avoids matching small numbers that aren't temperatures.
 */
export function convertTemperatures(text: string): string {
	return text.replace(
		/(\d{3,})\s*(?:°|degrees?\s*)?\s*F(?:ahrenheit)?\b/gi,
		(_, digits: string) => {
			const f = parseInt(digits, 10)
			// Round to nearest 5°C for oven temperatures (cooking convention)
			const c = Math.round((f - 32) * 5 / 9 / 5) * 5
			return `${c}°C`
		},
	)
}
