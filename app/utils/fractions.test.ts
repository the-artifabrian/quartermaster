import { describe, expect, test } from 'vitest'
import {
	parseAmount,
	formatAmount,
	scaleAmount,
	scaleAmountKitchen,
} from './fractions.ts'

describe('parseAmount', () => {
	test('parses integers', () => {
		expect(parseAmount('3')).toBe(3)
		expect(parseAmount('10')).toBe(10)
	})

	test('parses decimals', () => {
		expect(parseAmount('1.5')).toBe(1.5)
		expect(parseAmount('0.25')).toBe(0.25)
	})

	test('parses simple fractions', () => {
		expect(parseAmount('1/2')).toBe(0.5)
		expect(parseAmount('1/4')).toBe(0.25)
		expect(parseAmount('3/4')).toBe(0.75)
	})

	test('parses mixed numbers', () => {
		expect(parseAmount('1 1/2')).toBe(1.5)
		expect(parseAmount('2 3/4')).toBe(2.75)
	})

	test('returns null for division by zero', () => {
		expect(parseAmount('1/0')).toBeNull()
		expect(parseAmount('3 1/0')).toBeNull()
	})

	test('returns null for empty string', () => {
		expect(parseAmount('')).toBeNull()
		expect(parseAmount('   ')).toBeNull()
	})

	test('returns null for non-numeric input', () => {
		expect(parseAmount('abc')).toBeNull()
		expect(parseAmount('cups')).toBeNull()
	})

	test('handles whitespace', () => {
		expect(parseAmount('  3  ')).toBe(3)
	})

	test('parses standalone unicode fractions', () => {
		expect(parseAmount('½')).toBe(0.5)
		expect(parseAmount('⅓')).toBeCloseTo(1 / 3)
		expect(parseAmount('⅔')).toBeCloseTo(2 / 3)
		expect(parseAmount('¼')).toBe(0.25)
		expect(parseAmount('¾')).toBe(0.75)
		expect(parseAmount('⅛')).toBe(0.125)
		expect(parseAmount('⅜')).toBe(0.375)
		expect(parseAmount('⅝')).toBe(0.625)
		expect(parseAmount('⅞')).toBe(0.875)
	})

	test('parses mixed unicode fractions (no space)', () => {
		expect(parseAmount('1½')).toBe(1.5)
		expect(parseAmount('2¾')).toBe(2.75)
		expect(parseAmount('3⅓')).toBeCloseTo(3 + 1 / 3)
	})

	test('parses mixed unicode fractions (with space)', () => {
		expect(parseAmount('1 ½')).toBe(1.5)
		expect(parseAmount('2 ¼')).toBe(2.25)
	})
})

describe('formatAmount', () => {
	test('formats whole numbers', () => {
		expect(formatAmount(1)).toBe('1')
		expect(formatAmount(5)).toBe('5')
	})

	test('formats zero', () => {
		expect(formatAmount(0)).toBe('0')
	})

	test('formats common fractions', () => {
		expect(formatAmount(0.5)).toBe('1/2')
		expect(formatAmount(0.25)).toBe('1/4')
		expect(formatAmount(0.75)).toBe('3/4')
		expect(formatAmount(1 / 3)).toBe('1/3')
		expect(formatAmount(2 / 3)).toBe('2/3')
		expect(formatAmount(0.125)).toBe('1/8')
	})

	test('formats mixed numbers', () => {
		expect(formatAmount(1.5)).toBe('1 1/2')
		expect(formatAmount(2.25)).toBe('2 1/4')
		expect(formatAmount(3.75)).toBe('3 3/4')
	})

	test('snaps to nearest whole number when fractional part is tiny', () => {
		expect(formatAmount(2.01)).toBe('2')
		expect(formatAmount(2.99)).toBe('3')
	})

	test('negative or zero returns "0"', () => {
		expect(formatAmount(-1)).toBe('0')
	})

	test('keeps decimals for metric units instead of snapping to fractions', () => {
		expect(formatAmount(0.15, 'g')).toBe('0.15')
		expect(formatAmount(0.4, 'g')).toBe('0.4')
		expect(formatAmount(0.5, 'ml')).toBe('0.5')
		expect(formatAmount(1.5, 'kg')).toBe('1.5')
	})

	test('recognizes metric unit aliases', () => {
		expect(formatAmount(0.4, 'grams')).toBe('0.4')
		expect(formatAmount(0.25, 'milliliters')).toBe('0.25')
	})

	test('rounds metric decimals to 2 places', () => {
		expect(formatAmount(0.225, 'g')).toBe('0.23')
		expect(formatAmount(1 / 3, 'g')).toBe('0.33')
	})

	test('still uses fractions for imperial units', () => {
		expect(formatAmount(0.5, 'cup')).toBe('1/2')
		expect(formatAmount(0.25, 'tsp')).toBe('1/4')
	})

	test('decimal fallback keeps 2 decimals when no fraction is close', () => {
		expect(formatAmount(0.06)).toBe('0.06')
		expect(formatAmount(2.06)).toBe('2.06')
	})
})

describe('scaleAmount', () => {
	test('scales a parseable amount', () => {
		expect(scaleAmount('1', 2)).toBe('2')
		expect(scaleAmount('1/2', 2)).toBe('1')
		expect(scaleAmount('1 1/2', 2)).toBe('3')
	})

	test('returns null for null or undefined input', () => {
		expect(scaleAmount(null, 2)).toBeNull()
		expect(scaleAmount(undefined, 2)).toBeNull()
	})

	test('returns original string for unparseable input', () => {
		expect(scaleAmount('a pinch', 2)).toBe('a pinch')
		expect(scaleAmount('some', 3)).toBe('some')
	})

	test('returns null for empty string', () => {
		expect(scaleAmount('', 2)).toBeNull()
	})

	test('scales by fractional ratios', () => {
		expect(scaleAmount('1', 0.5)).toBe('1/2')
		expect(scaleAmount('2', 1.5)).toBe('3')
	})

	test('keeps metric amounts as decimals', () => {
		expect(scaleAmount('0.15', 1, 'g')).toBe('0.15')
		expect(scaleAmount('0.4', 1, 'g')).toBe('0.4')
		expect(scaleAmount('0.4', 2, 'g')).toBe('0.8')
		expect(scaleAmount('1', 0.5, 'ml')).toBe('0.5')
	})
})

describe('scaleAmountKitchen', () => {
	test('rounds scaled metric amounts to measurable values', () => {
		// The review's flagship case: 250 g flour at 4→5 servings
		expect(scaleAmountKitchen('250', 1.25, 'g')).toEqual({
			display: '310',
			approximate: true,
			value: 312.5,
		})
		// 75 g sugar at 4→5
		expect(scaleAmountKitchen('75', 1.25, 'g')).toEqual({
			display: '95',
			approximate: true,
			value: 93.75,
		})
	})

	test('does not flag metric values that needed no rounding', () => {
		expect(scaleAmountKitchen('200', 1.5, 'g')).toEqual({
			display: '300',
			approximate: false,
			value: 300,
		})
	})

	test('kg and liters round to one decimal', () => {
		expect(scaleAmountKitchen('1', 1.25, 'kg')).toEqual({
			display: '1.3',
			approximate: true,
			value: 1.25,
		})
	})

	test('translates spoonless eighths into cook qualifiers', () => {
		// 1/2 tsp at 4→5 servings = 5/8 tsp — a spoon that doesn't exist
		expect(scaleAmountKitchen('1/2', 1.25, 'tsp')?.display).toBe('generous 1/2')
		expect(scaleAmountKitchen('1/2', 0.75, 'tsp')?.display).toBe('generous 1/3')
		expect(scaleAmountKitchen('3/4', 2.5, 'tsp')?.display).toBe('scant 2')
	})

	test('keeps measurable fractions as-is when scaled', () => {
		expect(scaleAmountKitchen('1/2', 1.5, 'tsp')?.display).toBe('3/4')
		expect(scaleAmountKitchen('1', 0.5, 'cup')?.display).toBe('1/2')
		expect(scaleAmountKitchen('2', 1.5)?.display).toBe('3')
	})

	test('ratio 1 keeps author precision exactly', () => {
		expect(scaleAmountKitchen('312.5', 1, 'g')).toEqual({
			display: '312.5',
			approximate: false,
			value: 312.5,
		})
		expect(scaleAmountKitchen('5/8', 1, 'tsp')?.display).toBe('5/8')
	})

	test('passes unparseable amounts through untouched', () => {
		expect(scaleAmountKitchen('a pinch', 2)).toEqual({
			display: 'a pinch',
			approximate: false,
			value: null,
		})
	})

	test('returns null for empty input', () => {
		expect(scaleAmountKitchen(null, 2)).toBeNull()
		expect(scaleAmountKitchen('', 2)).toBeNull()
	})

	test('decimal fallback keeps precision when nothing snaps', () => {
		// 0.19 sits >0.05 from every common fraction
		expect(scaleAmountKitchen('0.38', 0.5)?.display).toBe('0.19')
	})
})
