import { expect, test } from 'vitest'
import { formatRecipeForCopy } from './recipe-copy.ts'

test('formats a Recipe with its displayed ingredient scale as clean plain text', () => {
	expect(
		formatRecipeForCopy(
			{
				title: 'Scaled Tomato Soup',
				ingredients: [
					{
						id: 'heading-id',
						name: 'For the soup',
						amount: null,
						unit: null,
						notes: null,
						isHeading: true,
					},
					{
						id: 'tomatoes-id',
						name: 'tomatoes',
						amount: '1/2',
						unit: 'cup',
						notes: 'internal preparation note',
						isHeading: false,
					},
					{
						id: 'onion-id',
						name: 'onion',
						amount: '2',
						unit: null,
						notes: null,
						isHeading: false,
					},
				],
				instructions: [
					{ id: 'step-1-id', content: 'Simmer gently.' },
					{ id: 'step-2-id', content: 'Serve warm.' },
				],
			},
			1.5,
		),
	).toBe(`Scaled Tomato Soup

Ingredients
- 3/4 cup tomatoes
- 3 onion

Instructions
1. Simmer gently.
2. Serve warm.`)
})

test('omits empty fields, empty rows, headings, and crossed-off state', () => {
	expect(
		formatRecipeForCopy(
			{
				title: '  Mint Tea  ',
				ingredients: [
					{
						name: '   ',
						amount: '2',
						unit: 'sprigs',
						isHeading: false,
					},
					{
						name: 'Garnish',
						amount: null,
						unit: null,
						isHeading: true,
					},
					{
						name: 'mint leaves',
						amount: null,
						unit: null,
						isHeading: false,
						checked: true,
					},
				],
				instructions: [
					{ content: '   ' },
					{ content: '  Steep.  ', checked: true },
				],
			},
			2,
		),
	).toBe(`Mint Tea

Ingredients
- mint leaves

Instructions
1. Steep.`)
})
