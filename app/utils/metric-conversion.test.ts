import { describe, expect, test } from 'vitest'
import { parseAmount, scaleAmount } from '#app/utils/fractions.ts'
import { getDensity } from '#app/utils/ingredient-densities.ts'
import {
	convertTemperatures,
	convertToMetric,
	formatMetricAmount,
} from '#app/utils/metric-conversion.ts'

describe('getDensity', () => {
	test('returns density for known ingredient', () => {
		const result = getDensity('flour')
		expect(result).toEqual({ gramsPerCup: 120, isLiquid: false })
	})

	test('returns density for known liquid', () => {
		const result = getDensity('milk')
		expect(result).toEqual({ gramsPerCup: 240, isLiquid: true })
	})

	test('returns null for unknown ingredient', () => {
		expect(getDensity('unicorn dust')).toBeNull()
	})

	test('handles plurals', () => {
		expect(getDensity('almonds')).not.toBeNull()
	})

	test('handles substring matching', () => {
		// "organic whole wheat flour" contains "whole wheat flour"
		expect(getDensity('organic whole wheat flour')).toEqual({
			gramsPerCup: 128,
			isLiquid: false,
		})
	})

	test('case insensitive', () => {
		expect(getDensity('BUTTER')).toEqual({ gramsPerCup: 227, isLiquid: false })
	})
})

describe('convertToMetric', () => {
	test('cup of flour → grams', () => {
		const result = convertToMetric(1, 'cup', 'flour')
		expect(result).toEqual({ amount: 120, unit: 'g', approximate: false })
	})

	test('2 cups flour → 240g', () => {
		const result = convertToMetric(2, 'cup', 'flour')
		expect(result).toEqual({ amount: 240, unit: 'g', approximate: false })
	})

	test('cup of sugar → 200g', () => {
		const result = convertToMetric(1, 'cup', 'sugar')
		expect(result).toEqual({ amount: 200, unit: 'g', approximate: false })
	})

	test('cup of water → ml (liquid)', () => {
		const result = convertToMetric(1, 'cup', 'water')
		expect(result).toEqual({ amount: 240, unit: 'ml', approximate: false })
	})

	test('cup of milk → ml (liquid)', () => {
		const result = convertToMetric(1, 'cup', 'milk')
		expect(result).toEqual({ amount: 240, unit: 'ml', approximate: false })
	})

	test('cup of unknown ingredient → ml with approximate', () => {
		const result = convertToMetric(1, 'cup', 'unicorn dust')
		expect(result).toEqual({ amount: 240, unit: 'ml', approximate: true })
	})

	test('oz → grams', () => {
		const result = convertToMetric(8, 'oz', 'chicken')
		expect(result).not.toBeNull()
		expect(result!.unit).toBe('g')
		expect(result!.amount).toBeCloseTo(226.8, 0)
		expect(result!.approximate).toBe(false)
	})

	test('fl oz → ml', () => {
		const result = convertToMetric(4, 'fl oz', 'water')
		expect(result).not.toBeNull()
		expect(result!.unit).toBe('ml')
		expect(result!.amount).toBeCloseTo(118.28, 0)
	})

	test('lb → grams', () => {
		const result = convertToMetric(1, 'lb', 'chicken')
		expect(result).not.toBeNull()
		expect(result!.unit).toBe('g')
		expect(result!.amount).toBeCloseTo(453.6, 0)
	})

	test('large lb → kg', () => {
		const result = convertToMetric(3, 'lb', 'chicken')
		expect(result).not.toBeNull()
		expect(result!.unit).toBe('kg')
		expect(result!.amount).toBeCloseTo(1.361, 1)
	})

	test('tsp → null (no conversion)', () => {
		expect(convertToMetric(1, 'tsp', 'salt')).toBeNull()
	})

	test('tbsp → null (no conversion)', () => {
		expect(convertToMetric(2, 'tbsp', 'butter')).toBeNull()
	})

	test('already metric g → null', () => {
		expect(convertToMetric(100, 'g', 'flour')).toBeNull()
	})

	test('already metric ml → null', () => {
		expect(convertToMetric(250, 'ml', 'water')).toBeNull()
	})

	test('pint → ml', () => {
		const result = convertToMetric(1, 'pint', 'cream')
		expect(result).not.toBeNull()
		expect(result!.unit).toBe('ml')
		expect(result!.amount).toBeCloseTo(473.18, 0)
	})

	test('quart → ml', () => {
		const result = convertToMetric(1, 'quart', 'broth')
		expect(result).not.toBeNull()
		expect(result!.unit).toBe('ml')
		expect(result!.amount).toBeCloseTo(946.35, 0)
	})

	test('gallon → L', () => {
		const result = convertToMetric(1, 'gallon', 'water')
		expect(result).not.toBeNull()
		expect(result!.unit).toBe('L')
		expect(result!.amount).toBeCloseTo(3.785, 1)
	})

	test('handles unit aliases', () => {
		// "cups" → normalized to "cup"
		const result = convertToMetric(1, 'cups', 'flour')
		expect(result).toEqual({ amount: 120, unit: 'g', approximate: false })
	})

	test('handles pound alias', () => {
		const result = convertToMetric(1, 'pounds', 'beef')
		expect(result).not.toBeNull()
		expect(result!.unit).toBe('g')
	})

	test('unknown unit returns null', () => {
		expect(convertToMetric(1, 'bunch', 'parsley')).toBeNull()
	})

	test('5 cups liquid → L', () => {
		const result = convertToMetric(5, 'cup', 'water')
		expect(result).not.toBeNull()
		expect(result!.unit).toBe('L')
		expect(result!.amount).toBeCloseTo(1.2, 1)
	})
})

describe('formatMetricAmount', () => {
	test('small gram amount', () => {
		expect(
			formatMetricAmount({ amount: 28.35, unit: 'g', approximate: false }),
		).toBe('28 g')
	})

	test('rounds to nearest 5 above 50', () => {
		expect(
			formatMetricAmount({ amount: 227, unit: 'g', approximate: false }),
		).toBe('225 g')
	})

	test('rounds to nearest 5 above 50 (round up)', () => {
		expect(
			formatMetricAmount({ amount: 203, unit: 'g', approximate: false }),
		).toBe('205 g')
	})

	test('exact multiple of 5 stays', () => {
		expect(
			formatMetricAmount({ amount: 120, unit: 'g', approximate: false }),
		).toBe('120 g')
	})

	test('ml amount below 50', () => {
		expect(
			formatMetricAmount({ amount: 29.57, unit: 'ml', approximate: false }),
		).toBe('30 ml')
	})

	test('kg with decimal', () => {
		expect(
			formatMetricAmount({ amount: 1.36, unit: 'kg', approximate: false }),
		).toBe('1.4 kg')
	})

	test('kg whole number', () => {
		expect(
			formatMetricAmount({ amount: 2.0, unit: 'kg', approximate: false }),
		).toBe('2 kg')
	})

	test('L with decimal', () => {
		expect(
			formatMetricAmount({ amount: 1.2, unit: 'L', approximate: false }),
		).toBe('1.2 L')
	})
})

describe('convertTemperatures', () => {
	test('converts 350°F to 175°C', () => {
		expect(convertTemperatures('Preheat oven to 350°F')).toBe(
			'Preheat oven to 175°C',
		)
	})

	test('converts 425 F to 220°C', () => {
		expect(convertTemperatures('Bake at 425 F for 20 minutes')).toBe(
			'Bake at 220°C for 20 minutes',
		)
	})

	test('converts 375F (no space)', () => {
		expect(convertTemperatures('Set oven to 375F')).toBe(
			'Set oven to 190°C',
		)
	})

	test('does not match small numbers', () => {
		expect(convertTemperatures('Add 15 F of sugar')).toBe(
			'Add 15 F of sugar',
		)
	})

	test('converts multiple temperatures', () => {
		expect(
			convertTemperatures('Start at 450°F, then reduce to 350°F'),
		).toBe('Start at 230°C, then reduce to 175°C')
	})

	test('no temperatures returns unchanged text', () => {
		const text = 'Mix ingredients well'
		expect(convertTemperatures(text)).toBe(text)
	})

	test('converts "degrees F" phrasing', () => {
		expect(convertTemperatures('Preheat to 350 degrees F')).toBe(
			'Preheat to 175°C',
		)
	})

	test('converts "degrees Fahrenheit" phrasing', () => {
		expect(convertTemperatures('Bake at 400 degrees Fahrenheit')).toBe(
			'Bake at 205°C',
		)
	})

	test('case insensitive', () => {
		expect(convertTemperatures('Set oven to 350 degrees f')).toBe(
			'Set oven to 175°C',
		)
	})
})

describe('getDensity edge cases', () => {
	test('handles "molasses" (ends in -ses)', () => {
		expect(getDensity('molasses')).not.toBeNull()
	})

	test('handles "sauces" pluralization', () => {
		// "sauces" -> "sauce" (not "sauc")
		expect(getDensity('tomato sauces')).not.toBeNull()
	})
})

describe('pipeline: scaleAmount → parseAmount → convertToMetric', () => {
	test('scaled mixed fraction converts correctly', () => {
		const scaled = scaleAmount('1 3/4', 2) // "3 1/2"
		expect(scaled).toBe('3 1/2')
		const parsed = parseAmount(scaled!)
		expect(parsed).toBe(3.5)
		const result = convertToMetric(parsed!, 'cups', 'flour')
		expect(result).toEqual({ amount: 420, unit: 'g', approximate: false })
	})
})
