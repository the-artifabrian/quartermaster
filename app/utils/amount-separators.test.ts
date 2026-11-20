/**
 * Comma decimals, thousands separators and pack sizes. The app never shows a
 * false total, so an amount either reads as exactly one number or stays as
 * written and out of every sum. parseAmount in fractions.ts is the one place
 * that decides; the ingredient, typed-item, speech and range parsers only
 * find where an amount starts and ends, and must not split a number on its
 * comma.
 *
 * Failure list (the rules these tests hold):
 * - "1,5" is 1.5, and "0,5" and "0,500" are 0.5: a group that starts with 0
 *   is never thousands.
 * - "1,25" and "1,0000" are decimals: only exactly three digits after the
 *   comma could be thousands.
 * - "1,000,000" and "1,000.5" can only be thousands.
 * - One to three digits, one comma or dot, then exactly three digits has no
 *   single value, so it keeps its spelling and stays out of sums:
 *   - "1,250", "1,000" and "10,000": a Romanian scale writes 1.25 kg as
 *     "1,250", and an English recipe means 1250;
 *   - "1.000" and "1.500": a thousands dot in Romanian, a decimal in
 *     English;
 *   - "1.333" and "1.125", the shape some sites give a fraction turned into
 *     a decimal.
 *   "0.125" and "1234.5" are plain decimals.
 * - "1.000,5", "1,00,000", "1.5.3", "1e3", "Infinity", "~2" and "2 large"
 *   are not one number. Nothing reads a number off the front of a string.
 * - "1 1⁄2" with a fraction slash reads like "1 1/2".
 * - "1,5–2" is a range: both ends scale, and neither sums. A range with an
 *   end that has no single value ("800–1,000", "1.000-2") or whose low end is
 *   above its high end ("2-1", "1,5-1,25") stays as written.
 * - "2 x 400" (also "2x400" and "2 × 400") is a count times a size. There is
 *   no pack-size idea in the app, so it stays as written: unscaled, unsummed.
 * - parseIngredient keeps "1,5 kg flour", "800–1,000 g flour" and
 *   "2 x 400 g tomatoes" whole instead of splitting the name at the comma or
 *   the "x". It takes "N x M" as one amount only when a unit follows, so
 *   "9x13 baking dish" and "20x30 cm tray" read as before. It still reads
 *   "2, chopped" style commas as notes, never starts an amount with a comma
 *   (",1 cup flour"), and reads "1 1⁄2 cups flour" as 1 1/2 cups.
 * - Shopping quick-add reads "1,5 kg flour" and "2 x 400 g tomatoes" the
 *   same way, and "9x13 pan" as before.
 * - Voice input that comes back as "1,5 kg făină" keeps 1,5 as one amount
 *   instead of splitting into two items at the comma.
 * - Shopping totals: "1,5 kg" + "500 g" is 2 kg; "1,000.5 g" + "500 g" is
 *   1.5 kg; "1,250 kg", "1.000 g", "2 x 400 g" and "2 large" sit beside a sum
 *   instead of joining it.
 * - Recipe display and scaling: "1,5" kg shows 1.5, and 3 at 2×.
 *
 * Spaces between thousands, as French sites write them, with a plain space,
 * a no-break space (U+00A0) or a narrow no-break space (U+202F):
 * - A space is never a decimal mark, so "1 000", "1 000 000" and "2 050" read
 *   as thousands: no size is written "000" or "050", and two groups can't be
 *   a count times a size. "1 000,5" and "1 000.5" are 1000.5, since after
 *   space groups the mark can only be a decimal.
 * - One group that doesn't start with 0 ("1 500", "2 400", "1 250") has no
 *   single value: "2 400 g" can be 2400 g or two 400 g tins, and "1 250 ml
 *   can" one 250 ml can. It stays as written and out of sums.
 * - "1 1/2" is still 1.5. "1 0000", "1000 000", "12 34" and "1 000 x" are not
 *   one number.
 * - parseIngredient keeps the groups together as the amount, with the space
 *   the source used, when a unit follows ("1 000 g flour", "1 000g flour",
 *   "2 400 g tomatoes", "1 250 ml can coconut milk"). With no unit it groups
 *   only an amount that reads as one number ("1 000 eggs"), so "6 100 calorie
 *   packs" is still six of them. "1 1/2 cups flour" reads as before.
 * - Shopping quick-add does the same: "1 000 g flour", "2 400 g tomatoes",
 *   "1 000 eggs", and "6 100 calorie packs" as before.
 * - Voice input keeps its reading ("2 400 gram cans" is two cans): Whisper
 *   writes a thousand as "1000" or "1,000", and a spoken count before a size
 *   is common.
 * - Shopping totals: "1 000 g" + "500 g" is 1.5 kg, and "2 400 g" sits beside
 *   a sum. Scaling "1 000" g by 2 shows 2000, and "2 400" g keeps its
 *   spelling.
 */
import { describe, expect, test } from 'vitest'
import {
	isRangeAmount,
	parseAmount,
	scaleAmount,
	scaleAmountKitchen,
} from './fractions.ts'
import { parseIngredient } from './ingredient-parser.ts'
import { parseSpeechItems, parseTypedItem } from './parse-speech-item.ts'
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
		['1,000,000', 1_000_000],
		['1,000.5', 1000.5],
		['1 1⁄2', 1.5],
		['1⁄2', 0.5],
		['0.125', 0.125],
		['1234.5', 1234.5],
		['1.5', 1.5],
		['.5', 0.5],
		[' 2 ', 2],
	])('%s reads as %d', (amount, value) => {
		expect(parseAmount(amount)).toBe(value)
	})

	test.each([
		'1,250',
		'1,000',
		'10,000',
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
	test('a range with a comma decimal scales end by end', () => {
		expect(isRangeAmount('1,5-2')).toBe(true)
		expect(scaleAmount('1,5-2', 2, 'kg')).toBe('3-4')
	})

	test.each(['800–1,000', '1.000-2', '2-1', '1,5-1,25', '1 to 1,500'])(
		'%s stays as written',
		(amount) => {
			expect(isRangeAmount(amount)).toBe(true)
			expect(scaleAmount(amount, 2, 'kg')).toBe(amount)
			expect(scaleAmountKitchen(amount, 2, 'kg')).toMatchObject({
				display: amount,
			})
		},
	)
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
		['1 9x13 baking dish', { amount: '1', name: '9x13 baking dish' }],
		['9x13 baking dish', { name: '9x13 baking dish' }],
		['1 20x30 cm tray', { amount: '1', name: '20x30 cm tray' }],
		['2 x 400 tomatoes', { amount: '2', name: 'x 400 tomatoes' }],
		[',1 cup flour', { name: '', notes: '1 cup flour' }],
		['1 1⁄2 cups flour', { amount: '1 1/2', unit: 'cups', name: 'flour' }],
		['1⁄2 cup sugar', { amount: '1/2', unit: 'cup', name: 'sugar' }],
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
		['9x13 pan', null],
		['2 9x13 pans', { quantity: '2', unit: '', name: '9x13 pans' }],
		['1 1⁄2 lb beef', { quantity: '1 1/2', unit: 'lb', name: 'beef' }],
		[
			'2 x 400 g tomatoes',
			{ quantity: '2 x 400', unit: 'g', name: 'tomatoes' },
		],
		['2 lemons', { quantity: '2', unit: '', name: 'lemons' }],
	])('%s', (text, parsed) => {
		expect(parseTypedItem(text)).toEqual(parsed)
	})
})

describe('voice input', () => {
	test('a comma decimal stays one amount', () => {
		expect(parseSpeechItems('1,5 kg făină')).toEqual([
			{ quantity: '1,5', unit: 'kg', name: 'făină' },
		])
	})

	test('a comma between items still splits them', () => {
		expect(parseSpeechItems('2 lemons, 3 eggs')).toEqual([
			{ quantity: '2', unit: '', name: 'lemons' },
			{ quantity: '3', unit: '', name: 'eggs' },
		])
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
			quantityOf(
				{ amount: '1,000.5', unit: 'g' },
				{ amount: '500', unit: 'g' },
			),
		).toEqual([{ quantity: '1.5', unit: 'kg' }])
	})

	test('a Romanian scale weight stays beside the sum', () => {
		expect(
			quantityOf({ amount: '1,250', unit: 'kg' }, { amount: '500', unit: 'g' }),
		).toEqual([{ quantity: '1,250 kg + 500 g', unit: null }])
	})

	test.each(['1,000', '1.000', '2 x 400', '2 large'])(
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

describe('spaces between thousands', () => {
	const NBSP = '\u00a0'
	const NNBSP = '\u202f'

	test.each([
		['1 000', 1000],
		[`1${NBSP}000`, 1000],
		[`1${NNBSP}000`, 1000],
		['1 000 000', 1_000_000],
		['12 500 000', 12_500_000],
		['2 050', 2050],
		['1 000,5', 1000.5],
		['1 000.5', 1000.5],
		['1 1/2', 1.5],
	])('%s reads as %d', (amount, value) => {
		expect(parseAmount(amount)).toBe(value)
	})

	test.each([
		'1 500',
		'2 400',
		`1${NBSP}250`,
		'12 345',
		'1 0000',
		'1000 000',
		'12 34',
		'1 000 x',
		'1  000',
		'0 500',
		'1 000,000',
	])('%s is not one number', (amount) => {
		expect(parseAmount(amount)).toBeNull()
	})

	test.each([
		['1 000 g flour', { amount: '1 000', unit: 'g', name: 'flour' }],
		['1 000g flour', { amount: '1 000', unit: 'g', name: 'flour' }],
		[
			`1${NBSP}000 g flour`,
			{ amount: `1${NBSP}000`, unit: 'g', name: 'flour' },
		],
		[
			`1${NNBSP}000 g flour`,
			{ amount: `1${NNBSP}000`, unit: 'g', name: 'flour' },
		],
		['1 000 000 g flour', { amount: '1 000 000', unit: 'g', name: 'flour' }],
		['~1 000 g flour', { amount: '~1 000', unit: 'g', name: 'flour' }],
		['2 400 g tomatoes', { amount: '2 400', unit: 'g', name: 'tomatoes' }],
		[
			'1 250 ml can coconut milk',
			{ amount: '1 250', unit: 'ml', name: 'can coconut milk' },
		],
		['1 000 eggs', { amount: '1 000', name: 'eggs' }],
		[
			'1 000 g flour, sifted',
			{ amount: '1 000', unit: 'g', name: 'flour', notes: 'sifted' },
		],
		['6 100 calorie packs', { amount: '6', name: '100 calorie packs' }],
		['1 1/2 cups flour', { amount: '1 1/2', unit: 'cups', name: 'flour' }],
		['12 345 g x', { amount: '12 345', unit: 'g', name: 'x' }],
		['1234 567 g x', { amount: '1234', name: '567 g x' }],
	])('parseIngredient reads %s', (line, parsed) => {
		expect(parseIngredient(line)).toEqual(parsed)
	})

	test.each([
		['1 000 g flour', { quantity: '1 000', unit: 'g', name: 'flour' }],
		[
			`1${NNBSP}000 g flour`,
			{ quantity: `1${NNBSP}000`, unit: 'g', name: 'flour' },
		],
		['2 400 g tomatoes', { quantity: '2 400', unit: 'g', name: 'tomatoes' }],
		['1 000 eggs', { quantity: '1 000', unit: '', name: 'eggs' }],
		[
			'6 100 calorie packs',
			{ quantity: '6', unit: '', name: '100 calorie packs' },
		],
		['1 1/2 lb beef', { quantity: '1 1/2', unit: 'lb', name: 'beef' }],
	])('Shopping quick-add reads %s', (text, parsed) => {
		expect(parseTypedItem(text)).toEqual(parsed)
	})

	test('voice input keeps a spoken count before a size', () => {
		expect(parseSpeechItems('2 400 gram cans')).toEqual([
			{ quantity: '2', unit: '', name: '400 gram cans' },
		])
	})

	const quantityOf = (...rows: Array<{ amount: string; unit: string }>) =>
		buildShoppingDemand({
			recipeBatches: [
				{
					ingredients: rows.map((row) => ({ name: 'flour', ...row })),
				},
			],
		}).map(({ quantity, unit }) => ({ quantity, unit }))

	test('thousands with a space sum with grams', () => {
		expect(
			quantityOf({ amount: '1 000', unit: 'g' }, { amount: '500', unit: 'g' }),
		).toEqual([{ quantity: '1.5', unit: 'kg' }])
	})

	test('one group that could be a count times a size stays beside the sum', () => {
		expect(
			quantityOf({ amount: '2 400', unit: 'g' }, { amount: '500', unit: 'g' }),
		).toEqual([{ quantity: '2 400 g + 500 g', unit: null }])
	})

	test('scaling', () => {
		expect(scaleAmount('1 000', 2, 'g')).toBe('2000')
		expect(scaleAmount('2 400', 2, 'g')).toBe('2 400')
	})
})
