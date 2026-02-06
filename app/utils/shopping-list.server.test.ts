import { describe, expect, test } from 'vitest'
import { generateShoppingListFromRecipes } from './shopping-list.server.ts'

function makeRecipe(
	id: string,
	ingredients: Array<{ name: string; amount?: string; unit?: string }>,
) {
	return {
		id,
		title: `Recipe ${id}`,
		description: null,
		servings: 4,
		prepTime: null,
		cookTime: null,
		isFavorite: false,
		sourceUrl: null,
		rawText: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		userId: 'user-1',
		ingredients: ingredients.map((ing, i) => ({
			id: `ing-${id}-${i}`,
			name: ing.name,
			amount: ing.amount ?? null,
			unit: ing.unit ?? null,
			notes: null,
			order: i,
			recipeId: id,
		})),
	}
}

describe('generateShoppingListFromRecipes', () => {
	test('consolidates "Fresh Garlic" and "garlic, minced" into one entry', () => {
		const recipes = [
			makeRecipe('r1', [{ name: 'Fresh Garlic', amount: '3', unit: 'cloves' }]),
			makeRecipe('r2', [
				{ name: 'garlic, minced', amount: '2', unit: 'cloves' },
			]),
		]

		const items = generateShoppingListFromRecipes(recipes)
		const garlicItems = items.filter((i) =>
			i.name.toLowerCase().includes('garlic'),
		)

		expect(garlicItems).toHaveLength(1)
		expect(garlicItems[0]!.quantity).toBe('5')
		expect(garlicItems[0]!.unit).toBe('cloves')
	})

	test('consolidates "cilantro" and "coriander" as synonyms', () => {
		const recipes = [
			makeRecipe('r1', [{ name: 'cilantro', amount: '1', unit: 'bunch' }]),
			makeRecipe('r2', [{ name: 'coriander', amount: '1', unit: 'bunch' }]),
		]

		const items = generateShoppingListFromRecipes(recipes)
		const matches = items.filter(
			(i) =>
				i.name.toLowerCase().includes('cilantro') ||
				i.name.toLowerCase().includes('coriander'),
		)

		expect(matches).toHaveLength(1)
		expect(matches[0]!.quantity).toBe('2')
	})

	test('sums quantities when units match', () => {
		const recipes = [
			makeRecipe('r1', [{ name: 'flour', amount: '2', unit: 'cups' }]),
			makeRecipe('r2', [{ name: 'Flour', amount: '1', unit: 'cups' }]),
		]

		const items = generateShoppingListFromRecipes(recipes)
		const flourItems = items.filter((i) =>
			i.name.toLowerCase().includes('flour'),
		)

		expect(flourItems).toHaveLength(1)
		expect(flourItems[0]!.quantity).toBe('3')
		expect(flourItems[0]!.unit).toBe('cups')
	})

	test('shows count when units differ', () => {
		const recipes = [
			makeRecipe('r1', [{ name: 'butter', amount: '2', unit: 'tbsp' }]),
			makeRecipe('r2', [{ name: 'butter', amount: '1', unit: 'cup' }]),
		]

		const items = generateShoppingListFromRecipes(recipes)
		const butterItems = items.filter((i) =>
			i.name.toLowerCase().includes('butter'),
		)

		expect(butterItems).toHaveLength(1)
		expect(butterItems[0]!.quantity).toBe('2×')
	})

	test('treats different ingredients as separate items', () => {
		const recipes = [
			makeRecipe('r1', [
				{ name: 'chicken breast', amount: '2', unit: 'lbs' },
				{ name: 'rice', amount: '1', unit: 'cup' },
			]),
		]

		const items = generateShoppingListFromRecipes(recipes)
		expect(items).toHaveLength(2)
	})
})
