import { describe, expect, test } from 'vitest'
import {
	cleanJsonLdText,
	extractRecipe,
	findRecipeInJsonLd,
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
