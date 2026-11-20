/**
 * Comma decimals, thousands separators and pack sizes. The app never shows a
 * false total, so an amount either reads as exactly one number or stays as
 * written and out of every sum. parseAmount in fractions.ts is the one place
 * that decides; the ingredient, typed-item and range parsers only find where
 * an amount starts and ends, and must not split a number on its comma.
 *
 * Failure list (the rules these tests hold):
 * - "1,5" is 1.5, and "0,5" and "0,500" are 0.5: a group that starts with 0
 *   is never thousands.
 * - "1,25" and "1,0000" are decimals: a comma takes thousands only before
 *   exactly three digits.
 * - "1,000", "10,000", "1,000,000" and "1,000.5" use thousands separators.
 *   "1,250" is 1250 by the same rule, even though a Romanian cook may mean
 *   1.25.
 * - "1.000" and "1.500" are ambiguous (a thousands dot in Romanian, a
 *   decimal in English), so they keep their spelling and stay out of sums.
 *   So do "1.333" and "1.125", the shape some sites give a fraction turned
 *   into a decimal: the shape alone can't tell them from thousands.
 *   "0.125" and "1234.5" are plain decimals.
 * - "1.000,5", "1,00,000", "1.5.3", "1e3", "Infinity", "~2" and "2 large"
 *   are not one number. Nothing reads a number off the front of a string.
 * - "800–1,000" and "1,5–2" are ranges: both ends scale, and neither sums.
 * - "2 x 400" (also "2x400" and "2 × 400") is a count times a size. There is
 *   no pack-size idea in the app, so it stays as written: unscaled, unsummed.
 * - parseIngredient keeps "1,5 kg flour", "800–1,000 g flour" and
 *   "2 x 400 g tomatoes" whole instead of splitting the name at the comma or
 *   the "x", and still reads "2, chopped" style commas as notes.
 * - Shopping quick-add reads "1,5 kg flour" and "2 x 400 g tomatoes" the
 *   same way.
 * - Shopping totals: "1,5 kg" + "500 g" is 2 kg; "1,000 g" + "500 g" is
 *   1.5 kg; "1.000 g", "2 x 400 g" and "2 large" sit beside a sum instead of
 *   joining it.
 * - Recipe display and scaling: "1,5" kg shows 1.5, and 3 at 2×.
 */
import { describe, expect, test } from 'vitest'
import {
	isRangeAmount,
	parseAmount,
	scaleAmount,
	scaleAmountKitchen,
} from './fractions.ts'
import { parseIngredient } from './ingredient-parser.ts'
import { parseTypedItem } from './parse-speech-item.ts'
import {
	buildShoppingDemand,
	combineRowDisplay,
} from './shopping-demand.server.ts'

describe('parseAmount', () => {
	test.each([
		['1,5', 1.5],
		['0,5', 0.5],
		['0,500', 0.5],
		['1,25', 1.25],
		['1,0000', 1],
		['1,000', 1000],
		['10,000', 10000],
		['1,000,000', 1_000_000],
		['1,000.5', 1000.5],
		['1,250', 1250],
		['0.125', 0.125],
		['1234.5', 1234.5],
		['1.5', 1.5],
		['.5', 0.5],
		[' 2 ', 2],
	])('%s reads as %d', (amount, value) => {
		expect(parseAmount(amount)).toBe(value)
	})

	test.each([
		'1.000',
		'1.500',
		'1.333',
		'1.125',
		'1.000,5',
		'1,00,000',
		'1.5.3',
		'1e3',
		'Infinity',
		'~2',
		'2 large',
		'2 x 400',
		'2x400',
		'2 × 400',
		'1,',
		',5',
	])('%s is not one number', (amount) => {
		expect(parseAmount(amount)).toBeNull()
	})
})

describe('ranges', () => {
	test('a range with a thousands separator scales end by end', () => {
		expect(isRangeAmount('800–1,000')).toBe(true)
		expect(scaleAmount('800–1,000', 2, 'g')).toBe('1600–2000')
	})

	test('a range with a comma decimal scales end by end', () => {
		expect(isRangeAmount('1,5-2')).toBe(true)
		expect(scaleAmount('1,5-2', 2, 'kg')).toBe('3-4')
	})

	test('a range with an ambiguous end stays as written', () => {
		expect(scaleAmount('1.000-2', 2, 'kg')).toBe('1.000-2')
	})
})

describe('Recipe display and scaling', () => {
	test('a comma decimal shows as one number and scales', () => {
		expect(scaleAmountKitchen('1,5', 1, 'kg')).toMatchObject({
			display: '1.5',
			value: 1.5,
		})
		expect(scaleAmountKitchen('1,5', 2, 'kg')).toMatchObject({
			display: '3',
			value: 3,
		})
		expect(scaleAmount('1,5', 2, 'kg')).toBe('3')
	})

	test('a pack size and an ambiguous amount keep their spelling when scaled', () => {
		expect(scaleAmount('2 x 400', 2, 'g')).toBe('2 x 400')
		expect(scaleAmountKitchen('1.000', 2, 'g')).toMatchObject({
			display: '1.000',
			value: null,
		})
	})

	test('words after a number no longer scale the number alone', () => {
		expect(scaleAmount('2 large', 2, null)).toBe('2 large')
	})
})

describe('parseIngredient', () => {
	test.each([
		['1,5 kg flour', { amount: '1,5', unit: 'kg', name: 'flour' }],
		['800–1,000 g flour', { amount: '800-1,000', unit: 'g', name: 'flour' }],
		['1,5–2 kg potatoes', { amount: '1,5-2', unit: 'kg', name: 'potatoes' }],
		['1,000.5 g sugar', { amount: '1,000.5', unit: 'g', name: 'sugar' }],
		['2 x 400 g tomatoes', { amount: '2 x 400', unit: 'g', name: 'tomatoes' }],
		['2x400g tomatoes', { amount: '2x400', unit: 'g', name: 'tomatoes' }],
		['2 × 400 g tomatoes', { amount: '2 × 400', unit: 'g', name: 'tomatoes' }],
		['2 x large eggs', { amount: '2', name: 'x large eggs' }],
		['2, chopped onions', { name: '2', notes: 'chopped onions' }],
		['1 onion, chopped', { amount: '1', name: 'onion', notes: 'chopped' }],
	])('%s', (line, parsed) => {
		expect(parseIngredient(line)).toEqual(parsed)
	})
})

describe('Shopping quick-add', () => {
	test.each([
		['1,5 kg flour', { quantity: '1,5', unit: 'kg', name: 'flour' }],
		['1,000 g sugar', { quantity: '1,000', unit: 'g', name: 'sugar' }],
		[
			'2 x 400 g tomatoes',
			{ quantity: '2 x 400', unit: 'g', name: 'tomatoes' },
		],
		['2 lemons', { quantity: '2', unit: '', name: 'lemons' }],
	])('%s', (text, parsed) => {
		expect(parseTypedItem(text)).toEqual(parsed)
	})
})

describe('Shopping totals', () => {
	const flour = (amount: string, unit: string) => ({
		name: 'flour',
		amount,
		unit,
	})
	const quantityOf = (...rows: Array<{ amount: string; unit: string }>) =>
		buildShoppingDemand({
			recipeBatches: [
				{ ingredients: rows.map((row) => flour(row.amount, row.unit)) },
			],
		}).map(({ quantity, unit }) => ({ quantity, unit }))

	test('a comma decimal sums with grams', () => {
		expect(
			quantityOf({ amount: '1,5', unit: 'kg' }, { amount: '500', unit: 'g' }),
		).toEqual([{ quantity: '2', unit: 'kg' }])
	})

	test('a thousands separator sums with grams', () => {
		expect(
			quantityOf({ amount: '1,000', unit: 'g' }, { amount: '500', unit: 'g' }),
		).toEqual([{ quantity: '1.5', unit: 'kg' }])
	})

	test.each(['1.000', '2 x 400', '2 large'])(
		'%s g stays beside the sum',
		(amount) => {
			expect(
				quantityOf(
					{ amount, unit: 'g' },
					{ amount: '500', unit: 'g' },
					{ amount: '250', unit: 'g' },
				),
			).toEqual([{ quantity: `${amount} g + 750 g`, unit: null }])
		},
	)

	test('a manual row combines with a comma-decimal contribution', () => {
		expect(
			combineRowDisplay({
				source: 'manual',
				quantity: '500',
				unit: 'g',
				contributions: [{ quantity: '1,5', unit: 'kg' }],
			}),
		).toEqual({ quantity: '2', unit: 'kg', combined: true })
	})
})
