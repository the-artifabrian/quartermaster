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

	test('parses nested parenthetical quantity: "1 (14.5 oz) can diced tomatoes"', () => {
		const result = parseIngredient('1 (14.5 oz) can diced tomatoes')
		expect(result).toEqual({
			name: 'diced tomatoes',
			amount: '1',
			unit: 'can',
			notes: '14.5 oz',
		})
	})

	test('parses nested parenthetical with comma notes: "2 (15 oz) cans black beans, drained"', () => {
		const result = parseIngredient('2 (15 oz) cans black beans, drained')
		expect(result).toEqual({
			name: 'black beans',
			amount: '2',
			unit: 'cans',
			notes: '15 oz; drained',
		})
	})

	test('parses "salt to taste"', () => {
		const result = parseIngredient('salt to taste')
		expect(result).toEqual({
			name: 'salt',
			notes: 'to taste',
		})
	})

	test('"to taste" extracts to notes when amount+unit present', () => {
		const result = parseIngredient('2 tsp salt to taste')
		expect(result).toEqual({
			name: 'salt',
			amount: '2',
			unit: 'tsp',
			notes: 'to taste',
		})
	})

	test('parses tilde amounts: "~350g lemon curd"', () => {
		const result = parseIngredient('~350g lemon curd')
		expect(result).toEqual({
			name: 'lemon curd',
			amount: '~350',
			unit: 'g',
			notes: undefined,
		})
	})

	test('parses range amounts: "1-2 tsp vanilla"', () => {
		const result = parseIngredient('1-2 tsp vanilla')
		expect(result).toEqual({
			name: 'vanilla',
			amount: '1-2',
			unit: 'tsp',
			notes: undefined,
		})
	})

	test('parses mixed unicode fraction with space: "1 ½ cups flour"', () => {
		const result = parseIngredient('1 ½ cups flour')
		expect(result).toEqual({
			name: 'flour',
			amount: '1½',
			unit: 'cups',
			notes: undefined,
		})
	})

	test('parses mixed unicode fraction without space: "1½ cups flour"', () => {
		const result = parseIngredient('1½ cups flour')
		expect(result).toEqual({
			name: 'flour',
			amount: '1½',
			unit: 'cups',
			notes: undefined,
		})
	})

	test('parses standalone unicode fraction: "¾ cup butter"', () => {
		const result = parseIngredient('¾ cup butter')
		expect(result).toEqual({
			name: 'butter',
			amount: '¾',
			unit: 'cup',
			notes: undefined,
		})
	})

	test('strips "about" prefix: "about 2 cups flour"', () => {
		const result = parseIngredient('about 2 cups flour')
		expect(result).toEqual({
			name: 'flour',
			amount: '2',
			unit: 'cups',
			notes: undefined,
		})
	})

	test('strips "approximately" prefix: "approximately 500g chicken"', () => {
		const result = parseIngredient('approximately 500g chicken')
		expect(result).toEqual({
			name: 'chicken',
			amount: '500',
			unit: 'g',
			notes: undefined,
		})
	})

	test('parses "2 tbsp ginger to taste" with to-taste in notes', () => {
		const result = parseIngredient('2 tbsp ginger to taste')
		expect(result).toEqual({
			name: 'ginger',
			amount: '2',
			unit: 'tbsp',
			notes: 'to taste',
		})
	})

	test('parses stick as a unit: "2 sticks butter"', () => {
		const result = parseIngredient('2 sticks butter')
		expect(result).toEqual({
			name: 'butter',
			amount: '2',
			unit: 'sticks',
			notes: undefined,
		})
	})

	test('handles all uncommon unicode fractions', () => {
		expect(parseIngredient('⅜ tsp nutmeg')).toEqual({
			name: 'nutmeg',
			amount: '⅜',
			unit: 'tsp',
			notes: undefined,
		})
		expect(parseIngredient('⅝ cup cream')).toEqual({
			name: 'cream',
			amount: '⅝',
			unit: 'cup',
			notes: undefined,
		})
		expect(parseIngredient('⅞ lb beef')).toEqual({
			name: 'beef',
			amount: '⅞',
			unit: 'lb',
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
