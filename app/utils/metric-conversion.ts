/**
 * Pure client-side metric conversion for recipe ingredients.
 *
 * Converts imperial measurements to metric by weight (grams/kg).
 * All volume units use ingredient density for accurate weight conversion.
 * Falls back to volume (ml/L) only for unknown ingredients.
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
	if (METRIC_UNITS.has(normalized)) return null

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
			return scaleUp(totalMl * gramsPerMl, 'g')
		}
		return scaleUp(amount * 28.35, 'g')
	}

	if (normalized === 'lb') {
		return scaleUp(amount * 453.6, 'g')
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
		return scaleUp(totalMl * gramsPerMl, 'g')
	}

	// Unknown ingredient — fall back to volume
	return { ...scaleUp(totalMl, 'ml'), approximate: true }
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

/** Round a metric amount to a display-friendly number. */
export function roundMetricAmount(result: MetricResult): number {
	if (result.unit === 'kg' || result.unit === 'L') {
		return Math.round(result.amount * 10) / 10
	}
	if (result.amount > 50) {
		return Math.round(result.amount / 5) * 5
	}
	return Math.round(result.amount)
}

export function formatMetricAmount(result: MetricResult): string {
	const value = roundMetricAmount(result)

	// Post-rounding scale-up: rounding can push values to 1000+
	if (result.unit === 'g' && value >= 1000) {
		const kg = value / 1000
		const formatted = kg % 1 === 0 ? kg.toString() : kg.toFixed(1)
		return `${formatted} kg`
	}
	if (result.unit === 'ml' && value >= 1000) {
		const l = value / 1000
		const formatted = l % 1 === 0 ? l.toString() : l.toFixed(1)
		return `${formatted} L`
	}

	if (result.unit === 'kg' || result.unit === 'L') {
		const formatted = value % 1 === 0 ? value.toString() : value.toFixed(1)
		return `${formatted} ${result.unit}`
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
