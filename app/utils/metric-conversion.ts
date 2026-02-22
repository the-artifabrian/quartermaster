/**
 * Pure client-side metric conversion for recipe ingredients.
 *
 * Converts imperial measurements (cups, oz, lb) to metric (g, ml, kg, L).
 * Uses ingredient density for accurate cup→gram conversions.
 * Falls back to volume→volume (cup→ml) for unknown ingredients.
 */

import { getDensity } from '#app/utils/ingredient-densities.ts'
import { normalizeUnit } from '#app/utils/unit-conversion.ts'

export type MetricResult = {
	amount: number
	unit: string // "g", "ml", "kg", "L"
	approximate: boolean // true when density unknown (volume fallback)
}

/** Units that stay as-is (same in metric/imperial practice) */
const SKIP_UNITS = new Set(['tsp', 'tbsp'])

/** Units already in metric */
const METRIC_UNITS = new Set(['g', 'kg', 'ml', 'l'])

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
	if (METRIC_UNITS.has(normalized)) return null

	if (normalized === 'cup') {
		return convertCup(amount, ingredientName)
	}

	if (normalized === 'oz') {
		// Treat oz as weight (most common in recipes)
		return scaleUp(amount * 28.35, 'g')
	}

	if (normalized === 'fl oz') {
		return scaleUp(amount * 29.57, 'ml')
	}

	if (normalized === 'lb') {
		return scaleUp(amount * 453.6, 'g')
	}

	if (normalized === 'pint') {
		return scaleUp(amount * 473.18, 'ml')
	}

	if (normalized === 'quart') {
		return scaleUp(amount * 946.35, 'ml')
	}

	if (normalized === 'gallon') {
		return scaleUp(amount * 3785.41, 'ml')
	}

	// Unknown unit — no conversion
	return null
}

function convertCup(
	amount: number,
	ingredientName: string,
): MetricResult {
	const density = getDensity(ingredientName)

	if (density) {
		if (density.isLiquid) {
			return scaleUp(amount * 240, 'ml')
		}
		return scaleUp(amount * density.gramsPerCup, 'g')
	}

	// Unknown ingredient — fall back to volume (cup → 240ml)
	return { ...scaleUp(amount * 240, 'ml'), approximate: true }
}

/**
 * Scale up small units to larger ones when appropriate.
 * g→kg at 1000g, ml→L at 1000ml.
 */
function scaleUp(
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
 * Format a metric result for display.
 * Rounds to nearest 5 for amounts >50, nearest 1 below.
 */
export function formatMetricAmount(result: MetricResult): string {
	let value: number

	if (result.unit === 'kg' || result.unit === 'L') {
		// For kg/L, show 1 decimal when fractional
		value = Math.round(result.amount * 10) / 10
		const formatted = value % 1 === 0 ? value.toString() : value.toFixed(1)
		return `${formatted} ${result.unit}`
	}

	if (result.amount > 50) {
		value = Math.round(result.amount / 5) * 5
	} else {
		value = Math.round(result.amount)
	}

	return `${value} ${result.unit}`
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
