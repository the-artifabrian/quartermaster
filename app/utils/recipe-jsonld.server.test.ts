import { describe, expect, test } from 'vitest'
import {
	cleanJsonLdText,
	extractRecipe,
	findRecipeInJsonLd,
	RecipeShapeError,
} from './recipe-jsonld.server.ts'
import { MAX_RAW_TEXT_LENGTH } from './recipe-validation.ts'

const SOURCE_URL = 'https://example.com/recipe'

function recipe(fields: Record<string, unknown> = {}) {
	return extractRecipe(
		{ '@type': 'Recipe', name: 'Weeknight Chili', ...fields },
		SOURCE_URL,
	)
}

describe('finding the Recipe node', () => {
	test('a top-level Recipe node', () => {
		const node = { '@type': 'Recipe', name: 'Soup' }
		expect(findRecipeInJsonLd(node)).toBe(node)
	})

	test('@type given as an array that includes Recipe', () => {
		const node = { '@type': ['Recipe', 'NewsArticle'], name: 'Soup' }
		expect(findRecipeInJsonLd(node)).toBe(node)
	})

	test('a Recipe inside @graph after other nodes', () => {
		const node = { '@type': 'Recipe', name: 'Soup' }
		const page = {
			'@context': 'https://schema.org',
			'@graph': [{ '@type': 'WebPage' }, { '@type': 'Person' }, node],
		}
		expect(findRecipeInJsonLd(page)).toBe(node)
	})

	test('a top-level array of blocks with the Recipe not first', () => {
		const node = { '@type': 'Recipe', name: 'Soup' }
		expect(
			findRecipeInJsonLd([{ '@type': 'Organization' }, { '@graph': [node] }]),
		).toBe(node)
	})

	test('no Recipe anywhere, or not an object at all', () => {
		expect(findRecipeInJsonLd({ '@graph': [{ '@type': 'WebPage' }] })).toBe(
			null,
		)
		expect(findRecipeInJsonLd({ '@type': 'Article' })).toBe(null)
		expect(findRecipeInJsonLd(null)).toBe(null)
		expect(findRecipeInJsonLd('Recipe')).toBe(null)
	})
})

test('HTML tags, named entities and numeric entities become plain text', () => {
	expect(
		cleanJsonLdText(
			'Salt &amp; pepper&nbsp;<b>to taste</b><br/>&#40;optional&#x29; &quot;fine&quot; &#39;sea&#x27;',
		),
	).toBe(`Salt & pepper to taste (optional) "fine" 'sea'`)
})

test('double-encoded entities, as WordPress sends them, decode fully on purpose', () => {
	expect(cleanJsonLdText('Mom&amp;#8217;s &amp;quot;best&amp;quot; pie')).toBe(
		'Mom’s "best" pie',
	)
})

describe('yield', () => {
	test('a number with a label', () => {
		expect(recipe({ recipeYield: '4 servings' })).toMatchObject({
			yieldAmount: 4,
			yieldLabel: 'servings',
		})
	})

	test('"Serves 6" reads as servings', () => {
		expect(recipe({ recipeYield: 'Serves 6' })).toMatchObject({
			yieldAmount: 6,
			yieldLabel: 'servings',
		})
	})

	test('an array holding one labelled entry', () => {
		expect(recipe({ recipeYield: ['12 cookies'] })).toMatchObject({
			yieldAmount: 12,
			yieldLabel: 'cookies',
		})
	})

	test('a decimal comma', () => {
		expect(recipe({ recipeYield: '1,5 litres' })).toMatchObject({
			yieldAmount: 1.5,
			yieldLabel: 'litres',
		})
	})

	test('the WP Recipe Maker array reads the labelled entry', () => {
		expect(recipe({ recipeYield: ['24', '24 cookies'] })).toMatchObject({
			yieldAmount: 24,
			yieldLabel: 'cookies',
		})
	})

	test('a bare number, as a JSON number or a string, means servings', () => {
		expect(recipe({ recipeYield: 4 })).toMatchObject({
			yieldAmount: 4,
			yieldLabel: 'servings',
		})
		expect(recipe({ recipeYield: '4' })).toMatchObject({
			yieldAmount: 4,
			yieldLabel: 'servings',
		})
	})

	test('a labelled range is refused, so the bare number gives the yield', () => {
		expect(recipe({ recipeYield: ['4-6 servings', '4'] })).toMatchObject({
			yieldAmount: 4,
			yieldLabel: 'servings',
		})
	})

	test('an unreadable recipeYield still falls back to the title', () => {
		expect(
			recipe({ recipeYield: ['about'], name: 'Weeknight Chili (Serves 4)' }),
		).toMatchObject({ yieldAmount: 4, yieldLabel: 'servings' })
	})

	test('with no recipeYield, a "(Serves 4)" title gives the yield', () => {
		expect(recipe({ name: 'Weeknight Chili (Serves 4)' })).toMatchObject({
			title: 'Weeknight Chili',
			yieldAmount: 4,
			yieldLabel: 'servings',
		})
	})
})

describe('times', () => {
	test('a zero duration means no time', () => {
		expect(recipe({ prepTime: 'PT0M', totalTime: 'PT0S' })).toMatchObject({
			activeTime: null,
			totalTime: null,
		})
	})

	test('an ISO duration with a zero day part', () => {
		expect(recipe({ totalTime: 'P0DT1H30M' }).totalTime).toBe(90)
	})

	test('bare minutes, as a string or a JSON number', () => {
		expect(recipe({ prepTime: '30', totalTime: 45 })).toMatchObject({
			activeTime: 30,
			totalTime: 45,
		})
	})

	test('zero or negative bare minutes mean no time', () => {
		expect(recipe({ prepTime: '0', totalTime: -5 })).toMatchObject({
			activeTime: null,
			totalTime: null,
		})
		expect(recipe({ prepTime: 0 }).activeTime).toBe(null)
	})
})

describe('instructions', () => {
	test('one string with line breaks becomes one step per line', () => {
		expect(
			recipe({ recipeInstructions: 'Chop the onion.\nFry it.\nServe.' })
				.instructions,
		).toEqual([
			{ content: 'Chop the onion.' },
			{ content: 'Fry it.' },
			{ content: 'Serve.' },
		])
	})

	test('one string with blank lines between steps keeps the steps apart', () => {
		expect(
			recipe({ recipeInstructions: 'Chop the onion.\n\nFry it.\n\n\nServe.' })
				.instructions,
		).toEqual([
			{ content: 'Chop the onion.' },
			{ content: 'Fry it.' },
			{ content: 'Serve.' },
		])
		expect(
			recipe({ recipeInstructions: 'Chop the onion.\r\n\r\nFry it.' })
				.instructions,
		).toEqual([{ content: 'Chop the onion.' }, { content: 'Fry it.' }])
	})

	test('a HowToStep with its text only in name is kept; text wins over name', () => {
		expect(
			recipe({
				recipeInstructions: [
					{ '@type': 'HowToStep', name: 'Preheat the oven.' },
					{ '@type': 'HowToStep', name: 'Bake', text: 'Bake for 20 minutes.' },
				],
			}).instructions,
		).toEqual([
			{ content: 'Preheat the oven.' },
			{ content: 'Bake for 20 minutes.' },
		])
	})

	test('a named HowToSection with no children gives no steps', () => {
		expect(
			recipe({
				recipeInstructions: [
					{ '@type': 'HowToSection', name: 'Sauce' },
					{ '@type': ['HowToSection'], name: 'Pasta', itemListElement: null },
				],
			}).instructions,
		).toEqual([])
	})

	test('HowToStep objects and plain strings, with markup cleaned', () => {
		expect(
			recipe({
				recipeInstructions: [
					{ '@type': 'HowToStep', text: '<p>Heat the oil &amp; garlic.</p>' },
					'Add the beans.',
					{ '@type': 'HowToStep', text: '   ' },
				],
			}).instructions,
		).toEqual([
			{ content: 'Heat the oil & garlic.' },
			{ content: 'Add the beans.' },
		])
	})

	test('HowToSection steps are flattened in order', () => {
		expect(
			recipe({
				recipeInstructions: [
					{
						'@type': 'HowToSection',
						name: 'Sauce',
						itemListElement: [
							{ '@type': 'HowToStep', text: 'Simmer the tomatoes.' },
							{ '@type': 'HowToStep', text: 'Season.' },
						],
					},
					{
						'@type': 'HowToSection',
						name: 'Pasta',
						itemListElement: [{ '@type': 'HowToStep', text: 'Boil.' }],
					},
				],
			}).instructions,
		).toEqual([
			{ content: 'Simmer the tomatoes.' },
			{ content: 'Season.' },
			{ content: 'Boil.' },
		])
	})
})

test('a sub-section header in recipeIngredient stays a heading', () => {
	const { ingredients } = recipe({
		recipeIngredient: ['For the crust:', '200 g flour', '1 tsp salt'],
	})
	expect(ingredients.map((ing) => ing.isHeading ?? false)).toEqual([
		true,
		false,
		false,
	])
})

test('a recipeIngredient that is not a list is refused, not half-read', () => {
	expect(() =>
		recipe({ recipeIngredient: '2 cans chickpeas\n1 lemon' }),
	).toThrow(RecipeShapeError)
	expect(() => recipe({ recipeIngredient: { text: '1 lemon' } })).toThrow(
		RecipeShapeError,
	)
	expect(() => recipe({ recipeIngredient: ['1 egg', 5] })).toThrow(
		RecipeShapeError,
	)
	expect(() =>
		recipe({ recipeIngredient: ['1 egg', { text: '1 lemon' }] }),
	).toThrow(RecipeShapeError)
	expect(recipe({ recipeIngredient: null }).ingredients).toEqual([])
	expect(recipe({ recipeIngredient: '' }).ingredients).toEqual([])
})

test('an all-capitals ingredient list is house style, so no line is a heading', () => {
	const { ingredients } = recipe({
		recipeIngredient: ['2 CUPS FLOUR', 'SALT', 'BLACK PEPPER', 'OLIVE OIL'],
	})
	expect(ingredients).toHaveLength(4)
	expect(ingredients.some((ing) => ing.isHeading)).toBe(false)
})

test('a Recipe with only @type has empty lists, nulls and a fallback title', () => {
	expect(extractRecipe({ '@type': 'Recipe' }, SOURCE_URL)).toMatchObject({
		title: 'Untitled Recipe',
		description: null,
		notes: null,
		activeTime: null,
		totalTime: null,
		yieldAmount: null,
		yieldLabel: null,
		sourceUrl: SOURCE_URL,
		metadataValueIds: [],
		ingredients: [],
		instructions: [],
	})
})

test('an enormous JSON-LD blob is cut to the saved raw-text limit', () => {
	const { rawText } = recipe({ description: 'x'.repeat(MAX_RAW_TEXT_LENGTH) })
	expect(rawText).toHaveLength(MAX_RAW_TEXT_LENGTH)
})
