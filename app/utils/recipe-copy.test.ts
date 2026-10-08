import { expect, test } from 'vitest'
import { formatRecipeForCopy } from './recipe-copy.ts'

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
