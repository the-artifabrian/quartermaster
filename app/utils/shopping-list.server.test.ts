import { describe, expect, test } from 'vitest'
import {
	generateShoppingListFromRecipes,
	subtractInventoryFromShoppingList,
	type ShoppingListItemInput,
} from './shopping-list.server.ts'

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
		isAiGenerated: false,
		sourceUrl: null,
		rawText: null,
		notes: null,
		householdId: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		userId: 'user-1',
		ingredients: ingredients.map((ing, i) => ({
			id: `ing-${id}-${i}`,
			name: ing.name,
			amount: ing.amount ?? null,
			unit: ing.unit ?? null,
			notes: null,
			isHeading: false,
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

	test('consolidates compatible units via conversion (tbsp + cup)', () => {
		const recipes = [
			makeRecipe('r1', [{ name: 'butter', amount: '2', unit: 'tbsp' }]),
			makeRecipe('r2', [{ name: 'butter', amount: '1', unit: 'cup' }]),
		]

		const items = generateShoppingListFromRecipes(recipes)
		const butterItems = items.filter((i) =>
			i.name.toLowerCase().includes('butter'),
		)

		expect(butterItems).toHaveLength(1)
		// 2 tbsp + 1 cup = 6 tsp + 48 tsp = 54 tsp = 1.125 cups
		expect(butterItems[0]!.unit).toBe('cup')
		expect(butterItems[0]!.quantity).toBe('1 1/8')
	})

	test('shows count when units are incompatible', () => {
		const recipes = [
			makeRecipe('r1', [{ name: 'butter', amount: '2', unit: 'tbsp' }]),
			makeRecipe('r2', [{ name: 'butter', amount: '100', unit: 'g' }]),
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

	test('scales ingredients by serving ratio', () => {
		const recipe = makeRecipe('r1', [
			{ name: 'flour', amount: '2', unit: 'cups' },
		])
		// recipe.servings = 4, entry servings = 8 → ratio = 2
		const items = generateShoppingListFromRecipes([{ recipe, servings: 8 }])
		const flourItem = items.find((i) => i.name.toLowerCase().includes('flour'))
		expect(flourItem!.quantity).toBe('4')
	})

	test('scales down by serving ratio', () => {
		const recipe = makeRecipe('r1', [
			{ name: 'flour', amount: '2', unit: 'cups' },
		])
		// recipe.servings = 4, entry servings = 2 → ratio = 0.5
		const items = generateShoppingListFromRecipes([{ recipe, servings: 2 }])
		const flourItem = items.find((i) => i.name.toLowerCase().includes('flour'))
		expect(flourItem!.quantity).toBe('1')
	})

	test('no scaling when entry servings is null', () => {
		const recipe = makeRecipe('r1', [
			{ name: 'flour', amount: '2', unit: 'cups' },
		])
		const items = generateShoppingListFromRecipes([{ recipe, servings: null }])
		const flourItem = items.find((i) => i.name.toLowerCase().includes('flour'))
		expect(flourItem!.quantity).toBe('2')
	})

	test('passes through amount when unparseable', () => {
		const recipe = makeRecipe('r1', [
			{ name: 'salt', amount: undefined, unit: undefined },
		])
		const items = generateShoppingListFromRecipes([{ recipe, servings: 8 }])
		expect(items[0]!.quantity).toBeUndefined()
	})

	test('servings=0 falls back to ratio=1', () => {
		const recipe = {
			...makeRecipe('r1', [{ name: 'flour', amount: '2', unit: 'cups' }]),
			servings: 0,
		}
		const items = generateShoppingListFromRecipes([{ recipe, servings: 4 }])
		const flourItem = items.find((i) => i.name.toLowerCase().includes('flour'))
		// ratio = servings && recipe.servings > 0 → false, so ratio = 1
		expect(flourItem!.quantity).toBe('2')
	})
})

describe('subtractInventoryFromShoppingList', () => {
	function makeInventory(items: Array<{ name: string; lowStock?: boolean }>) {
		return items.map((item, i) => ({
			id: `inv-${i}`,
			name: item.name,
			location: 'pantry' as const,
			quantity: null,
			unit: null,
			expiresAt: null,
			lowStock: item.lowStock ?? false,
			householdId: null,
			userId: 'user-1',
			createdAt: new Date(),
			updatedAt: new Date(),
		}))
	}

	function makeShoppingItem(name: string): ShoppingListItemInput {
		return {
			name,
			quantity: '1',
			unit: 'cup',
			category: 'other',
			source: 'generated',
		}
	}

	test('removes staple ingredients', () => {
		const items = [makeShoppingItem('salt'), makeShoppingItem('chicken')]
		const result = subtractInventoryFromShoppingList(items, [])
		expect(result.items).toHaveLength(1)
		expect(result.items[0]!.name).toBe('chicken')
		expect(result.removedCount).toBe(1)
		expect(result.removedItems).toContain('salt')
	})

	test('removes items already in inventory', () => {
		const items = [makeShoppingItem('chicken'), makeShoppingItem('rice')]
		const inventory = makeInventory([{ name: 'chicken' }])
		const result = subtractInventoryFromShoppingList(items, inventory)
		expect(result.items).toHaveLength(1)
		expect(result.items[0]!.name).toBe('rice')
	})

	test('keeps low-stock inventory items on the list', () => {
		const items = [makeShoppingItem('chicken')]
		const inventory = makeInventory([{ name: 'chicken', lowStock: true }])
		const result = subtractInventoryFromShoppingList(items, inventory)
		expect(result.items).toHaveLength(1)
		expect(result.items[0]!.name).toBe('chicken')
	})

	test('returns correct removedCount', () => {
		const items = [
			makeShoppingItem('salt'),
			makeShoppingItem('water'),
			makeShoppingItem('chicken'),
			makeShoppingItem('broccoli'),
		]
		const inventory = makeInventory([{ name: 'chicken' }])
		const result = subtractInventoryFromShoppingList(items, inventory)
		expect(result.removedCount).toBe(3) // salt, water, chicken
		expect(result.items).toHaveLength(1) // broccoli
	})

	test('empty inventory only removes staples', () => {
		const items = [makeShoppingItem('chicken'), makeShoppingItem('olive oil')]
		const result = subtractInventoryFromShoppingList(items, [])
		expect(result.items).toHaveLength(1)
		expect(result.items[0]!.name).toBe('chicken')
	})
})
