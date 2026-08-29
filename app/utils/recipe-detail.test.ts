import { expect, test } from 'vitest'
import { getRecipeJsonLd } from './recipe-detail.ts'

const baseRecipe = {
	title: 'Braided loaf',
	description: null,
	image: null,
	ingredients: [{ name: 'flour', amount: '500', unit: 'g' }],
	instructions: [{ content: 'Knead the dough.' }],
}

test('Recipe JSON-LD publishes only explicit Active, Total, and typed Yield metadata', () => {
	const jsonLd = getRecipeJsonLd(
		{
			...baseRecipe,
			activeTime: 25,
			totalTime: 180,
			yieldAmount: 2.5,
			yieldLabel: 'large braided loaves',
		},
		undefined,
	)

	expect(jsonLd).toEqual(
		expect.objectContaining({
			prepTime: 'PT25M',
			totalTime: 'PT3H',
			recipeYield: '2.5 large braided loaves',
		}),
	)
	expect(jsonLd).not.toHaveProperty('cookTime')
})

test('Recipe JSON-LD keeps unknown time and yield absent', () => {
	const jsonLd = getRecipeJsonLd(
		{
			...baseRecipe,
			activeTime: null,
			totalTime: null,
			yieldAmount: null,
			yieldLabel: null,
		},
		undefined,
	)

	expect(jsonLd).not.toHaveProperty('prepTime')
	expect(jsonLd).not.toHaveProperty('totalTime')
	expect(jsonLd).not.toHaveProperty('recipeYield')
})
