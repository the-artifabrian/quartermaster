import { describe, expect, test } from 'vitest'
import { parseAmount, formatAmount, scaleAmount } from './fractions.ts'

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
})
