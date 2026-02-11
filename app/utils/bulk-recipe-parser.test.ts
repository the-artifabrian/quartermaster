import { describe, expect, test } from 'vitest'
import {
	parseRecipeText,
	splitMultipleRecipes,
} from './bulk-recipe-parser.ts'

describe('splitMultipleRecipes', () => {
	test('returns single recipe when no separator', () => {
		const result = splitMultipleRecipes('My Recipe\nIngredients\n- flour')
		expect(result).toHaveLength(1)
		expect(result[0]).toBe('My Recipe\nIngredients\n- flour')
	})

	test('splits on --- separator', () => {
		const text = `Recipe One
Ingredients
- flour

---

Recipe Two
Ingredients
- sugar`
		const result = splitMultipleRecipes(text)
		expect(result).toHaveLength(2)
		expect(result[0]).toContain('Recipe One')
		expect(result[1]).toContain('Recipe Two')
	})

	test('handles --- with surrounding whitespace', () => {
		const text = `Recipe One
Ingredients
- flour
  ---
Recipe Two
Ingredients
- sugar`
		const result = splitMultipleRecipes(text)
		expect(result).toHaveLength(2)
	})

	test('filters out empty sections from multiple separators', () => {
		const text = `Recipe One
Ingredients
- flour

---

---

Recipe Two
Ingredients
- sugar`
		const result = splitMultipleRecipes(text)
		expect(result).toHaveLength(2)
	})
})

describe('parseRecipeText', () => {
	test('parses standard Apple Notes recipe format', () => {
		const text = `Chicken Stir Fry

Ingredients
- 2 cups chicken breast, diced
- 1 tbsp soy sauce
- 3 cloves garlic

Instructions
1. Heat oil in a pan.
2. Add chicken and cook until browned.
3. Add garlic and soy sauce.`

		const result = parseRecipeText(text)
		expect(result.title).toBe('Chicken Stir Fry')
		expect(result.ingredients).toHaveLength(3)
		expect(result.ingredients[0]).toEqual({
			name: 'chicken breast',
			amount: '2',
			unit: 'cups',
			notes: 'diced',
		})
		expect(result.instructions).toHaveLength(3)
		expect(result.instructions[0]!.content).toBe('Heat oil in a pan.')
		expect(result.warnings).toHaveLength(0)
	})

	test('handles "Ingredients:" with colon', () => {
		const text = `My Recipe

Ingredients:
- 1 cup flour

Instructions:
1. Mix it.`

		const result = parseRecipeText(text)
		expect(result.title).toBe('My Recipe')
		expect(result.ingredients).toHaveLength(1)
		expect(result.instructions).toHaveLength(1)
	})

	test('handles INGREDIENTS heading (uppercase)', () => {
		const text = `My Recipe

INGREDIENTS
- 1 cup flour

INSTRUCTIONS
1. Mix it.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(1)
		expect(result.instructions).toHaveLength(1)
	})

	test('handles "Directions" heading', () => {
		const text = `Pasta

Ingredients
- 2 cups pasta

Directions
1. Boil water.
2. Cook pasta.`

		const result = parseRecipeText(text)
		expect(result.instructions).toHaveLength(2)
	})

	test('handles "Steps" heading', () => {
		const text = `Salad

Ingredients
- lettuce

Steps
1. Wash lettuce.
2. Serve.`

		const result = parseRecipeText(text)
		expect(result.instructions).toHaveLength(2)
	})

	test('handles "Method" heading', () => {
		const text = `Soup

Ingredients
- 1 can tomatoes

Method
Blend tomatoes.
Heat until warm.`

		const result = parseRecipeText(text)
		expect(result.instructions).toHaveLength(2)
	})

	test('handles bullet styles: dash, bullet, asterisk', () => {
		const text = `Test Recipe

Ingredients
- 1 cup flour
• 2 eggs
* 1 tsp salt

Instructions
1. Mix.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(3)
		expect(result.ingredients[0]!.name).toBe('flour')
		expect(result.ingredients[1]!.name).toBe('eggs')
		expect(result.ingredients[2]!.name).toBe('salt')
	})

	test('handles plain ingredients (no bullets)', () => {
		const text = `Simple Recipe

Ingredients
1 cup flour
2 eggs
salt

Instructions
1. Mix everything.`

		const result = parseRecipeText(text)
		expect(result.ingredients).toHaveLength(3)
	})

	test('strips numbered instruction prefixes', () => {
		const text = `Recipe

Ingredients
- flour

Instructions
1. First step
2) Second step
3 Third step`

		const result = parseRecipeText(text)
		expect(result.instructions[0]!.content).toBe('First step')
		expect(result.instructions[1]!.content).toBe('Second step')
		// "3 Third step" — the "3" is stripped as bullet prefix with "3 " pattern
		// but stripBullet only handles "3." and "3)", not "3 " — so it stays
		// Actually: /^\s*\d+[.)]\s+/ only matches "3." or "3)" not "3 "
		expect(result.instructions[2]!.content).toBe('3 Third step')
	})

	test('extracts description between title and first heading', () => {
		const text = `Grandma's Cookies
A family favorite passed down for generations.

Ingredients
- 2 cups flour

Instructions
1. Mix and bake.`

		const result = parseRecipeText(text)
		expect(result.title).toBe("Grandma's Cookies")
		expect(result.description).toBe(
			'A family favorite passed down for generations.',
		)
	})

	test('no description when title is directly above heading', () => {
		const text = `Quick Salad
Ingredients
- lettuce

Instructions
1. Serve.`

		const result = parseRecipeText(text)
		expect(result.title).toBe('Quick Salad')
		expect(result.description).toBeUndefined()
	})

	test('warns when no title found', () => {
		const text = `Ingredients
- 1 cup flour

Instructions
1. Mix.`

		const result = parseRecipeText(text)
		expect(result.title).toBe('')
		expect(result.warnings).toContain('No title found')
	})

	test('warns when no ingredients found', () => {
		const text = `My Recipe

Instructions
1. Do something.`

		const result = parseRecipeText(text)
		expect(result.warnings).toContain('No ingredients found')
	})

	test('warns when no instructions found', () => {
		const text = `My Recipe

Ingredients
- flour`

		const result = parseRecipeText(text)
		expect(result.warnings).toContain('No instructions found')
	})

	test('handles empty input', () => {
		const result = parseRecipeText('')
		expect(result.title).toBe('')
		expect(result.ingredients).toHaveLength(0)
		expect(result.instructions).toHaveLength(0)
		expect(result.warnings).toContain('No title found')
	})

	test('handles text with no headings', () => {
		const text = `Just Some Title
And some random text
Nothing structured here`

		const result = parseRecipeText(text)
		expect(result.title).toBe('Just Some Title')
		expect(result.warnings).toContain('No ingredients found')
		expect(result.warnings).toContain('No instructions found')
	})

	test('normalizes smart quotes', () => {
		const text = `Grandma\u2019s Cookies

Ingredients
- 1 cup flour

Instructions
1. Mix the \u201Cdough\u201D.`

		const result = parseRecipeText(text)
		expect(result.title).toBe("Grandma's Cookies")
		expect(result.instructions[0]!.content).toBe('Mix the "dough".')
	})

	test('normalizes non-breaking spaces', () => {
		const text = `My\u00A0Recipe

Ingredients
- 1\u00A0cup flour

Instructions
1. Mix.`

		const result = parseRecipeText(text)
		expect(result.title).toBe('My Recipe')
		expect(result.ingredients[0]!.unit).toBe('cup')
	})

	test('handles "Preparation" heading', () => {
		const text = `Cake

Ingredients
- flour

Preparation
1. Preheat oven.
2. Mix batter.`

		const result = parseRecipeText(text)
		expect(result.instructions).toHaveLength(2)
	})
})
