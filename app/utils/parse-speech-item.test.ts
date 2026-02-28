import { describe, expect, test } from 'vitest'
import { parseSpeechItem, parseSpeechItems } from './parse-speech-item.ts'

describe('parseSpeechItem', () => {
	describe('basic parsing', () => {
		test.each([
			['milk', { name: 'milk', quantity: '', unit: '' }],
			['eggs', { name: 'eggs', quantity: '', unit: '' }],
			['chicken thighs', { name: 'chicken thighs', quantity: '', unit: '' }],
		])('bare name: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})

		test.each([
			['3 eggs', { name: 'eggs', quantity: '3', unit: '' }],
			['12 bananas', { name: 'bananas', quantity: '12', unit: '' }],
			['2 chicken breasts', { name: 'chicken breasts', quantity: '2', unit: '' }],
		])('quantity + name: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})

		test.each([
			[
				'2 pounds of chicken',
				{ name: 'chicken', quantity: '2', unit: 'lb' },
			],
			['1 cup of flour', { name: 'flour', quantity: '1', unit: 'cup' }],
			[
				'3 tablespoons of olive oil',
				{ name: 'olive oil', quantity: '3', unit: 'tbsp' },
			],
			['2 bags of chips', { name: 'chips', quantity: '2', unit: 'bags' }],
			[
				'1 can of tomatoes',
				{ name: 'tomatoes', quantity: '1', unit: 'can' },
			],
		])('quantity + unit + name: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})

		test.each([
			[
				'2 lbs chicken',
				{ name: 'chicken', quantity: '2', unit: 'lb' },
			],
			[
				'500 g flour',
				{ name: 'flour', quantity: '500', unit: 'g' },
			],
		])('quantity + unit + name without "of": "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})
	})

	describe('word number normalization', () => {
		test.each([
			['one egg', { name: 'egg', quantity: '1', unit: '' }],
			['two bananas', { name: 'bananas', quantity: '2', unit: '' }],
			['three apples', { name: 'apples', quantity: '3', unit: '' }],
			['twelve eggs', { name: 'eggs', quantity: '12', unit: '' }],
			['an avocado', { name: 'avocado', quantity: '1', unit: '' }],
			['a lemon', { name: 'lemon', quantity: '1', unit: '' }],
		])('basic word numbers: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})

		test.each([
			['thirteen eggs', { name: 'eggs', quantity: '13', unit: '' }],
			['fourteen oranges', { name: 'oranges', quantity: '14', unit: '' }],
			['fifteen apples', { name: 'apples', quantity: '15', unit: '' }],
			['sixteen lemons', { name: 'lemons', quantity: '16', unit: '' }],
			['seventeen limes', { name: 'limes', quantity: '17', unit: '' }],
			['eighteen pears', { name: 'pears', quantity: '18', unit: '' }],
			['nineteen plums', { name: 'plums', quantity: '19', unit: '' }],
		])('teen numbers: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})

		test.each([
			[
				'two pounds of chicken',
				{ name: 'chicken', quantity: '2', unit: 'lb' },
			],
			[
				'three cups of flour',
				{ name: 'flour', quantity: '3', unit: 'cup' },
			],
		])('word number + unit: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})
	})

	describe('compound numbers', () => {
		test.each([
			['a dozen eggs', { name: 'eggs', quantity: '12', unit: '' }],
			['half a dozen oranges', { name: 'oranges', quantity: '6', unit: '' }],
			[
				'a hundred grams of flour',
				{ name: 'flour', quantity: '100', unit: 'g' },
			],
		])('existing compounds: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})

		test.each([
			[
				'three hundred grams of flour',
				{ name: 'flour', quantity: '300', unit: 'g' },
			],
			[
				'two hundred grams of sugar',
				{ name: 'sugar', quantity: '200', unit: 'g' },
			],
		])('word-number + hundred: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})

		test.each([
			['a couple bananas', { name: 'bananas', quantity: '2', unit: '' }],
			[
				'a couple of bananas',
				{ name: 'bananas', quantity: '2', unit: '' },
			],
		])('a couple: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})
	})

	describe('mixed numbers', () => {
		test.each([
			[
				'1 1/2 cups of flour',
				{ name: 'flour', quantity: '1 1/2', unit: 'cup' },
			],
			[
				'2 1/2 pounds of chicken',
				{ name: 'chicken', quantity: '2 1/2', unit: 'lb' },
			],
			['1/2 cup of sugar', { name: 'sugar', quantity: '1/2', unit: 'cup' }],
		])('mixed fractions: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})
	})

	describe('filler word stripping', () => {
		test.each([
			['um three apples', { name: 'apples', quantity: '3', unit: '' }],
			['uh milk', { name: 'milk', quantity: '', unit: '' }],
			['like 2 eggs', { name: 'eggs', quantity: '2', unit: '' }],
			[
				'um like three apples',
				{ name: 'apples', quantity: '3', unit: '' },
			],
			[
				'oh um well 2 pounds of chicken',
				{ name: 'chicken', quantity: '2', unit: 'lb' },
			],
		])('strips filler words: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})
	})

	describe('comma-laden Whisper output', () => {
		test.each([
			[
				'Um, like, some Cheerios',
				{ name: 'cheerios', quantity: '', unit: '' },
			],
			[
				'Oh, three eggs',
				{ name: 'eggs', quantity: '3', unit: '' },
			],
			[
				'Okay, two pounds of chicken',
				{ name: 'chicken', quantity: '2', unit: 'lb' },
			],
		])('strips commas from Whisper output: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})
	})

	describe('instructional prefixes', () => {
		test.each([
			['I need milk', { name: 'milk', quantity: '', unit: '' }],
			['we need eggs', { name: 'eggs', quantity: '', unit: '' }],
			[
				'get two pounds of chicken',
				{ name: 'chicken', quantity: '2', unit: 'lb' },
			],
			['add butter', { name: 'butter', quantity: '', unit: '' }],
			['buy some bread', { name: 'bread', quantity: '', unit: '' }],
			['grab a dozen eggs', { name: 'eggs', quantity: '12', unit: '' }],
			[
				'oh I need three bags of chips',
				{ name: 'chips', quantity: '3', unit: 'bags' },
			],
		])('strips instructional prefix: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})
	})

	describe('additional filler words', () => {
		test.each([
			['yeah milk', { name: 'milk', quantity: '', unit: '' }],
			['yep 3 eggs', { name: 'eggs', quantity: '3', unit: '' }],
			[
				'actually two pounds of chicken',
				{ name: 'chicken', quantity: '2', unit: 'lb' },
			],
		])('strips extended fillers: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})
	})

	describe('combined filler + prefix + quantifier chains', () => {
		test.each([
			[
				'Um, yeah, I need like, some garlic.',
				{ name: 'garlic', quantity: '', unit: '' },
			],
			[
				'oh yeah and like goldfish crackers',
				{ name: 'goldfish crackers', quantity: '', unit: '' },
			],
			[
				'oh I need some milk',
				{ name: 'milk', quantity: '', unit: '' },
			],
			[
				'well actually grab a dozen eggs',
				{ name: 'eggs', quantity: '12', unit: '' },
			],
		])('strips interleaved noise: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})
	})

	describe('quantifier phrases', () => {
		test.each([
			['some milk', { name: 'milk', quantity: '', unit: '' }],
			['some chicken', { name: 'chicken', quantity: '', unit: '' }],
			['a few lemons', { name: 'lemons', quantity: '', unit: '' }],
			['a bit of salt', { name: 'salt', quantity: '', unit: '' }],
			['a lot of garlic', { name: 'garlic', quantity: '', unit: '' }],
		])('strips vague quantifiers: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})
	})

	describe('unit normalization', () => {
		test.each([
			['1 pound of butter', 'lb'],
			['2 pounds of chicken', 'lb'],
			['1 lb of beef', 'lb'],
			['2 lbs of pork', 'lb'],
			['8 ounces of cream cheese', 'oz'],
			['1 kilogram of rice', 'kg'],
			['500 grams of flour', 'g'],
			['1 liter of milk', 'l'],
			['2 liters of water', 'l'],
			['1 tablespoon of oil', 'tbsp'],
			['2 teaspoons of salt', 'tsp'],
		])('normalizes "%s" → unit "%s"', (input, expectedUnit) => {
			expect(parseSpeechItem(input).unit).toBe(expectedUnit)
		})
	})

	describe('additional units', () => {
		test.each([
			['1 pint of cream', { name: 'cream', quantity: '1', unit: 'pint' }],
			[
				'2 quarts of broth',
				{ name: 'broth', quantity: '2', unit: 'quart' },
			],
			[
				'1 package of bacon',
				{ name: 'bacon', quantity: '1', unit: 'package' },
			],
			[
				'2 tins of sardines',
				{ name: 'sardines', quantity: '2', unit: 'tins' },
			],
			[
				'1 tube of tomato paste',
				{ name: 'tomato paste', quantity: '1', unit: 'tube' },
			],
		])('additional units: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})
	})

	describe('trailing punctuation', () => {
		test.each([
			['milk.', { name: 'milk', quantity: '', unit: '' }],
			['3 eggs!', { name: 'eggs', quantity: '3', unit: '' }],
			['2 pounds of chicken,', { name: 'chicken', quantity: '2', unit: 'lb' }],
		])('strips punctuation: "%s"', (input, expected) => {
			expect(parseSpeechItem(input)).toEqual(expected)
		})
	})

	describe('empty / edge cases', () => {
		test('empty string', () => {
			expect(parseSpeechItem('')).toEqual({
				name: '',
				quantity: '',
				unit: '',
			})
		})
		test('whitespace only', () => {
			expect(parseSpeechItem('   ')).toEqual({
				name: '',
				quantity: '',
				unit: '',
			})
		})
	})
})

describe('parseSpeechItems', () => {
	test('single item', () => {
		expect(parseSpeechItems('3 eggs')).toEqual([
			{ name: 'eggs', quantity: '3', unit: '' },
		])
	})

	test('comma-separated items', () => {
		expect(parseSpeechItems('3 eggs, milk, 2 pounds of chicken')).toEqual([
			{ name: 'eggs', quantity: '3', unit: '' },
			{ name: 'milk', quantity: '', unit: '' },
			{ name: 'chicken', quantity: '2', unit: 'lb' },
		])
	})

	test('and-separated items', () => {
		expect(parseSpeechItems('apples and oranges')).toEqual([
			{ name: 'apples', quantity: '', unit: '' },
			{ name: 'oranges', quantity: '', unit: '' },
		])
	})

	test('comma and "and" together', () => {
		expect(
			parseSpeechItems('eggs, milk, and bread'),
		).toEqual([
			{ name: 'eggs', quantity: '', unit: '' },
			{ name: 'milk', quantity: '', unit: '' },
			{ name: 'bread', quantity: '', unit: '' },
		])
	})

	describe('compound grocery names with "and"', () => {
		test.each([
			['mac and cheese', [{ name: 'mac and cheese', quantity: '', unit: '' }]],
			[
				'macaroni and cheese',
				[{ name: 'macaroni and cheese', quantity: '', unit: '' }],
			],
			[
				'salt and pepper',
				[{ name: 'salt and pepper', quantity: '', unit: '' }],
			],
			[
				'peanut butter and jelly',
				[
					{ name: 'peanut butter', quantity: '', unit: '' },
					{ name: 'jelly', quantity: '', unit: '' },
				],
			],
			[
				'oil and vinegar',
				[{ name: 'oil and vinegar', quantity: '', unit: '' }],
			],
		])('preserves compound: "%s"', (input, expected) => {
			expect(parseSpeechItems(input)).toEqual(expected)
		})

		test('compound name in a list', () => {
			expect(
				parseSpeechItems('eggs, mac and cheese, and milk'),
			).toEqual([
				{ name: 'eggs', quantity: '', unit: '' },
				{ name: 'mac and cheese', quantity: '', unit: '' },
				{ name: 'milk', quantity: '', unit: '' },
			])
		})

		test('compound name with quantity', () => {
			expect(
				parseSpeechItems('2 boxes of mac and cheese'),
			).toEqual([
				{ name: 'mac and cheese', quantity: '2', unit: 'boxes' },
			])
		})

		test('multiple compound names in one transcript', () => {
			expect(
				parseSpeechItems('mac and cheese, salt and pepper, and milk'),
			).toEqual([
				{ name: 'mac and cheese', quantity: '', unit: '' },
				{ name: 'salt and pepper', quantity: '', unit: '' },
				{ name: 'milk', quantity: '', unit: '' },
			])
		})
	})

	test('does not split "and" inside words', () => {
		expect(parseSpeechItems('mandarin oranges')).toEqual([
			{ name: 'mandarin oranges', quantity: '', unit: '' },
		])
	})

	test('empty string returns empty array', () => {
		expect(parseSpeechItems('')).toEqual([])
	})

	test('whitespace only returns empty array', () => {
		expect(parseSpeechItems('   ')).toEqual([])
	})
})
