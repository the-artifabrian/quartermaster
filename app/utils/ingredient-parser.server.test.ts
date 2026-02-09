import { describe, expect, test } from 'vitest'
import {
	parseIngredient,
	parseISODuration,
} from './ingredient-parser.server.ts'

describe('parseIngredient', () => {
	test('parses standard "amount unit name" format', () => {
		const result = parseIngredient('2 cups flour')
		expect(result).toEqual({
			name: 'flour',
			amount: '2',
			unit: 'cups',
			notes: undefined,
		})
	})

	test('parses no-space metric like "600g broccoli"', () => {
		const result = parseIngredient('600g broccoli')
		expect(result).toEqual({
			name: 'broccoli',
			amount: '600',
			unit: 'g',
			notes: undefined,
		})
	})

	test('parses amount + name without unit', () => {
		const result = parseIngredient('3 eggs')
		expect(result).toEqual({
			name: 'eggs',
			amount: '3',
			unit: undefined,
			notes: undefined,
		})
	})

	test('parses ingredient with no amount', () => {
		const result = parseIngredient('salt')
		expect(result).toEqual({
			name: 'salt',
			notes: undefined,
		})
	})

	test('parses comma-separated notes', () => {
		const result = parseIngredient('2 cups chicken, cooked and shredded')
		expect(result).toEqual({
			name: 'chicken',
			amount: '2',
			unit: 'cups',
			notes: 'cooked and shredded',
		})
	})

	test('parses comma notes for name-only ingredients', () => {
		const result = parseIngredient('parsley, chopped')
		expect(result).toEqual({
			name: 'parsley',
			notes: 'chopped',
		})
	})

	test('parses unicode fractions', () => {
		const result = parseIngredient('½ tsp salt')
		expect(result).toEqual({
			name: 'salt',
			amount: '½',
			unit: 'tsp',
			notes: undefined,
		})
	})

	test('parses fraction amounts', () => {
		const result = parseIngredient('1/2 cup milk')
		expect(result).toEqual({
			name: 'milk',
			amount: '1/2',
			unit: 'cup',
			notes: undefined,
		})
	})

	test('strips markdown checkbox syntax - [ ]', () => {
		const result = parseIngredient('- [ ] 2 cups flour')
		expect(result).toEqual({
			name: 'flour',
			amount: '2',
			unit: 'cups',
			notes: undefined,
		})
	})

	test('strips checked checkbox syntax - [x]', () => {
		const result = parseIngredient('- [x] 1 tsp salt')
		expect(result).toEqual({
			name: 'salt',
			amount: '1',
			unit: 'tsp',
			notes: undefined,
		})
	})

	test('strips markdown link syntax', () => {
		const result = parseIngredient('[butter](http://example.com)')
		expect(result).toEqual({
			name: 'butter',
			notes: undefined,
		})
	})

	test('handles non-unit word attached to amount', () => {
		const result = parseIngredient('2 large eggs')
		expect(result).toEqual({
			name: 'large eggs',
			amount: '2',
			unit: undefined,
			notes: undefined,
		})
	})

	test('returns null for empty input', () => {
		expect(parseIngredient('')).toBeNull()
		expect(parseIngredient('   ')).toBeNull()
	})

	test('handles clove as a unit', () => {
		const result = parseIngredient('3 cloves garlic')
		expect(result).toEqual({
			name: 'garlic',
			amount: '3',
			unit: 'cloves',
			notes: undefined,
		})
	})
})

describe('parseISODuration', () => {
	test('parses minutes only', () => {
		expect(parseISODuration('PT30M')).toBe(30)
	})

	test('parses hours only', () => {
		expect(parseISODuration('PT1H')).toBe(60)
		expect(parseISODuration('PT2H')).toBe(120)
	})

	test('parses hours and minutes', () => {
		expect(parseISODuration('PT1H15M')).toBe(75)
		expect(parseISODuration('PT1H30M')).toBe(90)
	})

	test('rounds up seconds', () => {
		expect(parseISODuration('PT30M45S')).toBe(31)
		expect(parseISODuration('PT1H0M30S')).toBe(61)
	})

	test('returns undefined for PT0M (zero duration)', () => {
		expect(parseISODuration('PT0M')).toBeUndefined()
	})

	test('returns undefined for invalid input', () => {
		expect(parseISODuration('')).toBeUndefined()
		expect(parseISODuration('invalid')).toBeUndefined()
		expect(parseISODuration('P1D')).toBeUndefined()
		expect(parseISODuration('30')).toBeUndefined()
	})

	test('parses seconds only', () => {
		expect(parseISODuration('PT45S')).toBe(1)
	})
})
