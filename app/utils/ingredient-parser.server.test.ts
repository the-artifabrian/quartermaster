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

	test('parses mixed ASCII fraction with unit: "1 3/4 cups flour"', () => {
		const result = parseIngredient('1 3/4 cups flour')
		expect(result).toEqual({
			name: 'flour',
			amount: '1 3/4',
			unit: 'cups',
			notes: undefined,
		})
	})

	test('parses mixed ASCII fraction: "1 1/2 tsp cinnamon"', () => {
		const result = parseIngredient('1 1/2 tsp cinnamon')
		expect(result).toEqual({
			name: 'cinnamon',
			amount: '1 1/2',
			unit: 'tsp',
			notes: undefined,
		})
	})

	test('parses mixed ASCII fraction without unit: "1 1/2 eggs"', () => {
		const result = parseIngredient('1 1/2 eggs')
		expect(result).toEqual({
			name: 'eggs',
			amount: '1 1/2',
			notes: undefined,
		})
	})

	test('parses mixed ASCII fraction with notes: "1 3/4 cups carrots, finely shredded"', () => {
		const result = parseIngredient('1 3/4 cups carrots, finely shredded')
		expect(result).toEqual({
			name: 'carrots',
			amount: '1 3/4',
			unit: 'cups',
			notes: 'finely shredded',
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

	test('extracts trailing parenthetical as notes: "4 oz cream cheese (at room temp)"', () => {
		const result = parseIngredient('4 oz cream cheese (at room temp)')
		expect(result).toEqual({
			name: 'cream cheese',
			amount: '4',
			unit: 'oz',
			notes: 'at room temp',
		})
	})

	test('extracts parenthetical from name with unit: "2 cups carrots (finely shredded)"', () => {
		const result = parseIngredient('2 cups carrots (finely shredded)')
		expect(result).toEqual({
			name: 'carrots',
			amount: '2',
			unit: 'cups',
			notes: 'finely shredded',
		})
	})

	test('extracts parenthetical alternative: "1/2 cup olive oil (or vegetable oil)"', () => {
		const result = parseIngredient('1/2 cup olive oil (or vegetable oil)')
		expect(result).toEqual({
			name: 'olive oil',
			amount: '1/2',
			unit: 'cup',
			notes: 'or vegetable oil',
		})
	})

	test('extracts parenthetical from no-amount ingredient: "salt (to taste)"', () => {
		const result = parseIngredient('salt (to taste)')
		expect(result).toEqual({
			name: 'salt',
			notes: 'to taste',
		})
	})

	test('mixed fraction + comma notes + parenthetical: "1 3/4 cups cream cheese (softened), divided"', () => {
		const result = parseIngredient(
			'1 3/4 cups cream cheese (softened), divided',
		)
		expect(result).toEqual({
			name: 'cream cheese',
			amount: '1 3/4',
			unit: 'cups',
			notes: 'divided, softened',
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

	// Fix 1: Trailing periods on unit abbreviations
	test('strips trailing period from unit: "2 tbsp. butter"', () => {
		expect(parseIngredient('2 tbsp. butter')).toEqual({
			name: 'butter',
			amount: '2',
			unit: 'tbsp',
			notes: undefined,
		})
	})

	test('strips trailing period from unit: "1 oz. cheddar"', () => {
		expect(parseIngredient('1 oz. cheddar')).toEqual({
			name: 'cheddar',
			amount: '1',
			unit: 'oz',
			notes: undefined,
		})
	})

	// Fix 2: New unit aliases
	test('recognizes plural abbreviation: "2 tsps sugar"', () => {
		expect(parseIngredient('2 tsps sugar')).toEqual({
			name: 'sugar',
			amount: '2',
			unit: 'tsps',
			notes: undefined,
		})
	})

	test('recognizes short form: "1 qt stock"', () => {
		expect(parseIngredient('1 qt stock')).toEqual({
			name: 'stock',
			amount: '1',
			unit: 'qt',
			notes: undefined,
		})
	})

	test('recognizes spelled out: "500 milliliters water"', () => {
		expect(parseIngredient('500 milliliters water')).toEqual({
			name: 'water',
			amount: '500',
			unit: 'milliliters',
			notes: undefined,
		})
	})

	// Fix 3: "X to Y" word ranges
	test('normalizes "2 to 3 tablespoons oil" to range', () => {
		expect(parseIngredient('2 to 3 tablespoons oil')).toEqual({
			name: 'oil',
			amount: '2-3',
			unit: 'tablespoons',
			notes: undefined,
		})
	})

	test('normalizes "1/2 to 3/4 cup milk" to range', () => {
		expect(parseIngredient('1/2 to 3/4 cup milk')).toEqual({
			name: 'milk',
			amount: '1/2-3/4',
			unit: 'cup',
			notes: undefined,
		})
	})

	// Fix 4: fl oz multi-word unit
	test('parses "2 fl oz lime juice"', () => {
		expect(parseIngredient('2 fl oz lime juice')).toEqual({
			name: 'lime juice',
			amount: '2',
			unit: 'fl oz',
			notes: undefined,
		})
	})

	test('parses "4 fl. oz. cream" with periods', () => {
		expect(parseIngredient('4 fl. oz. cream')).toEqual({
			name: 'cream',
			amount: '4',
			unit: 'fl oz',
			notes: undefined,
		})
	})

	test('parses "8 fluid ounces milk"', () => {
		expect(parseIngredient('8 fluid ounces milk')).toEqual({
			name: 'milk',
			amount: '8',
			unit: 'fl oz',
			notes: undefined,
		})
	})

	// Fix 5: Leading parenthetical equivalents
	test('extracts leading parenthetical: "2 cups (about 8 ounces) shredded cheddar"', () => {
		expect(
			parseIngredient('2 cups (about 8 ounces) shredded cheddar'),
		).toEqual({
			name: 'shredded cheddar',
			amount: '2',
			unit: 'cups',
			notes: 'about 8 ounces',
		})
	})

	// Fix 6: "Juice of" / "Zest of" patterns
	test('parses "Juice of 1 lemon"', () => {
		expect(parseIngredient('Juice of 1 lemon')).toEqual({
			name: 'lemon',
			amount: '1',
			notes: 'juice',
		})
	})

	test('parses "Zest of 2 limes"', () => {
		expect(parseIngredient('Zest of 2 limes')).toEqual({
			name: 'limes',
			amount: '2',
			notes: 'zest',
		})
	})

	test('parses "juice and zest of 1 orange"', () => {
		expect(parseIngredient('juice and zest of 1 orange')).toEqual({
			name: 'orange',
			amount: '1',
			notes: 'juice and zest',
		})
	})

	// Fix 7: Written-out numbers
	test('converts "Two cloves garlic"', () => {
		expect(parseIngredient('Two cloves garlic')).toEqual({
			name: 'garlic',
			amount: '2',
			unit: 'cloves',
			notes: undefined,
		})
	})

	test('converts "One 14-ounce can coconut milk"', () => {
		expect(parseIngredient('One 14-ounce can coconut milk')).toEqual({
			name: '14-ounce can coconut milk',
			amount: '1',
			unit: undefined,
			notes: undefined,
		})
	})

	test('converts "three eggs"', () => {
		expect(parseIngredient('three eggs')).toEqual({
			name: 'eggs',
			amount: '3',
			unit: undefined,
			notes: undefined,
		})
	})

	// Fix 8: extractTrailingParenthetical in nested match path
	test('nested match with trailing parenthetical: "1 (15 oz) can black beans (rinsed and drained)"', () => {
		expect(
			parseIngredient(
				'1 (15 oz) can black beans (rinsed and drained)',
			),
		).toEqual({
			name: 'black beans',
			amount: '1',
			unit: 'can',
			notes: '15 oz, rinsed and drained',
		})
	})

	// Edge case: mixed fraction + fl oz
	test('mixed fraction with fl oz: "1 1/2 fl oz cream"', () => {
		expect(parseIngredient('1 1/2 fl oz cream')).toEqual({
			name: 'cream',
			amount: '1 1/2',
			unit: 'fl oz',
			notes: undefined,
		})
	})

	// Edge case: fl oz with comma notes
	test('fl oz with comma notes: "2 fl oz lime juice, freshly squeezed"', () => {
		expect(
			parseIngredient('2 fl oz lime juice, freshly squeezed'),
		).toEqual({
			name: 'lime juice',
			amount: '2',
			unit: 'fl oz',
			notes: 'freshly squeezed',
		})
	})

	// Edge case: unicode fraction range
	test('unicode fraction range: "½ to ¾ cup milk"', () => {
		expect(parseIngredient('½ to ¾ cup milk')).toEqual({
			name: 'milk',
			amount: '½-¾',
			unit: 'cup',
			notes: undefined,
		})
	})

	// Edge case: written-out number + direct ingredient name
	test('written-out number with no unit: "One potato"', () => {
		expect(parseIngredient('One potato')).toEqual({
			name: 'potato',
			amount: '1',
			unit: undefined,
			notes: undefined,
		})
	})

	// Edge case: "to" in ingredient names should not trigger range normalization
	test('"to" in ingredient name is not confused with range: "2 cups tofu"', () => {
		expect(parseIngredient('2 cups tofu')).toEqual({
			name: 'tofu',
			amount: '2',
			unit: 'cups',
			notes: undefined,
		})
	})

	// Comma+paren stripping: JSON-LD sites wrap notes in parens after commas
	test('strips parens from comma notes: "1 tablespoon capers, (drained)"', () => {
		expect(parseIngredient('1 tablespoon capers, (drained)')).toEqual({
			name: 'capers',
			amount: '1',
			unit: 'tablespoon',
			notes: 'drained',
		})
	})

	test('strips parens from comma notes: "1 large egg, (beaten)"', () => {
		expect(parseIngredient('1 large egg, (beaten)')).toEqual({
			name: 'large egg',
			amount: '1',
			notes: 'beaten',
		})
	})

	// "whole" is not a unit — it's an adjective
	test('"whole" is not treated as a unit: "2 whole eggs"', () => {
		expect(parseIngredient('2 whole eggs')).toEqual({
			name: 'whole eggs',
			amount: '2',
			unit: undefined,
			notes: undefined,
		})
	})

	// Embedded parenthetical extraction
	test('extracts embedded parenthetical: "2 whole (8 ounces each) boneless chicken"', () => {
		expect(
			parseIngredient('2 whole (8 ounces each) boneless chicken'),
		).toEqual({
			name: 'whole boneless chicken',
			amount: '2',
			unit: undefined,
			notes: '8 ounces each',
		})
	})

	// Adjective comma lists should stay in name
	test('keeps "boneless, skinless" together in ingredient name', () => {
		expect(
			parseIngredient(
				'2 whole (8 ounces each) boneless, skinless chicken breasts, halved horizontally to make a total of 4 cutlets',
			),
		).toEqual({
			name: 'whole boneless, skinless chicken breasts',
			amount: '2',
			unit: undefined,
			notes: '8 ounces each, halved horizontally to make a total of 4 cutlets',
		})
	})

	// Broken parenthetical fragments from poorly-formatted JSON-LD
	test('fixes broken paren fragments: "chicken cutlets, sliced thin), (approx."', () => {
		expect(
			parseIngredient(
				'1 1/2 lbs chicken cutlets, sliced thin), (approx.',
			),
		).toEqual({
			name: 'chicken cutlets',
			amount: '1 1/2',
			unit: 'lbs',
			notes: 'sliced thin, approx.',
		})
	})

	// Double parentheses from JSON-LD
	test('strips double parens: "bread crumbs ((I like to use panko crumbs))"', () => {
		expect(
			parseIngredient(
				'1½ -2 cups bread crumbs ((I like to use panko crumbs))',
			),
		).toEqual({
			name: 'bread crumbs',
			amount: '1½-2',
			unit: 'cups',
			notes: 'I like to use panko crumbs',
		})
	})

	// Orphaned parentheses from broken HTML
	test('strips orphaned closing paren: "chicken, sliced thin) approx."', () => {
		expect(
			parseIngredient('1 1/2 lbs chicken cutlets, sliced thin) approx.'),
		).toEqual({
			name: 'chicken cutlets',
			amount: '1 1/2',
			unit: 'lbs',
			notes: 'sliced thin approx.',
		})
	})

	test('strips orphaned opening paren: "bread crumbs (I like panko"', () => {
		expect(
			parseIngredient('2 cups bread crumbs (I like panko'),
		).toEqual({
			name: 'bread crumbs I like panko',
			amount: '2',
			unit: 'cups',
			notes: undefined,
		})
	})

	// Double opening paren with comma inside: "((approx.), sliced thin)"
	test('handles nested double-open paren from JSON-LD', () => {
		expect(
			parseIngredient(
				'1½ lbs. chicken cutlets ((approx.), sliced thin)',
			),
		).toEqual({
			name: 'chicken cutlets',
			amount: '1½',
			unit: 'lbs',
			notes: 'sliced thin',
		})
	})

	test('strips (approx.) from ingredient', () => {
		expect(
			parseIngredient('1½ lbs chicken cutlets (approx.), sliced thin'),
		).toEqual({
			name: 'chicken cutlets',
			amount: '1½',
			unit: 'lbs',
			notes: 'sliced thin',
		})
	})

	// Range with space before dash
	test('normalizes range with space-dash: "1½ -2 cups flour"', () => {
		expect(parseIngredient('1½ -2 cups flour')).toEqual({
			name: 'flour',
			amount: '1½-2',
			unit: 'cups',
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
