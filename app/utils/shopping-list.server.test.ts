import { describe, expect, test } from 'vitest'
import {
	generateShoppingListFromRecipes,
	annotateInventoryMatches,
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

	test('re-parses ingredients with amount baked into name', () => {
		const recipe = makeRecipe('r1', [
			{ name: '1 (14.5 oz) can crushed tomatoes' },
		])
		const items = generateShoppingListFromRecipes([recipe])
		const tomato = items.find((i) =>
			i.name.toLowerCase().includes('tomato'),
		)!
		expect(tomato.name).toBe('crushed tomatoes')
		expect(tomato.quantity).toBe('1')
		expect(tomato.unit).toBe('can')
	})

	test('re-parses "2 cups flour" baked into name', () => {
		const recipe = makeRecipe('r1', [{ name: '2 cups flour' }])
		const items = generateShoppingListFromRecipes([recipe])
		const flour = items.find((i) => i.name.toLowerCase().includes('flour'))!
		expect(flour.name).toBe('flour')
		expect(flour.quantity).toBe('2')
		expect(flour.unit).toBe('cups')
	})

	test('does NOT re-parse when amount is already set', () => {
		const recipe = makeRecipe('r1', [
			{ name: 'crushed tomatoes', amount: '1', unit: 'can' },
		])
		const items = generateShoppingListFromRecipes([recipe])
		const tomato = items.find((i) =>
			i.name.toLowerCase().includes('tomato'),
		)!
		expect(tomato.name).toBe('crushed tomatoes')
		expect(tomato.quantity).toBe('1')
	})

	test('does NOT re-parse names not starting with quantity', () => {
		const recipe = makeRecipe('r1', [{ name: 'fresh basil leaves' }])
		const items = generateShoppingListFromRecipes([recipe])
		expect(items[0]!.name).toBe('fresh basil leaves')
		expect(items[0]!.quantity).toBeUndefined()
	})

	test('strips leading "of " from display name', () => {
		// parseIngredient("1 stalk of celery") → name="of celery"
		const recipe = makeRecipe('r1', [{ name: '1 stalk of celery' }])
		const items = generateShoppingListFromRecipes([recipe])
		const celery = items.find((i) =>
			i.name.toLowerCase().includes('celery'),
		)!
		expect(celery.name).toBe('celery')
	})

	test('re-parsed items consolidate with properly-parsed ones', () => {
		const recipes = [
			makeRecipe('r1', [{ name: '2 cups flour' }]),
			makeRecipe('r2', [{ name: 'flour', amount: '1', unit: 'cups' }]),
		]
		const items = generateShoppingListFromRecipes(recipes)
		const flourItems = items.filter((i) =>
			i.name.toLowerCase().includes('flour'),
		)
		expect(flourItems).toHaveLength(1)
		expect(flourItems[0]!.quantity).toBe('3')
	})

	test('scaling works on re-parsed ingredients', () => {
		const recipe = makeRecipe('r1', [{ name: '2 cups flour' }])
		// recipe.servings = 4, entry servings = 8 → ratio = 2
		const items = generateShoppingListFromRecipes([{ recipe, servings: 8 }])
		const flour = items.find((i) => i.name.toLowerCase().includes('flour'))!
		expect(flour.quantity).toBe('4')
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

describe('annotateInventoryMatches', () => {
	function makeInventory(items: Array<{ name: string; lowStock?: boolean }>) {
		return items.map((item, i) => ({
			id: `inv-${i}`,
			name: item.name,
			location: 'pantry' as const,
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

	test('strips staple ingredients entirely', () => {
		const items = [makeShoppingItem('salt'), makeShoppingItem('chicken')]
		const result = annotateInventoryMatches(items, [])
		expect(result.items).toHaveLength(1)
		expect(result.items[0]!.name).toBe('chicken')
		expect(result.items[0]!.inStock).toBe(false)
		expect(result.stapleCount).toBe(1)
	})

	test('annotates items in inventory as inStock instead of removing', () => {
		const items = [makeShoppingItem('chicken'), makeShoppingItem('rice')]
		const inventory = makeInventory([{ name: 'chicken' }])
		const result = annotateInventoryMatches(items, inventory)
		expect(result.items).toHaveLength(2)
		const chicken = result.items.find((i) => i.name === 'chicken')!
		const rice = result.items.find((i) => i.name === 'rice')!
		expect(chicken.inStock).toBe(true)
		expect(rice.inStock).toBe(false)
		expect(result.inStockCount).toBe(1)
	})

	test('keeps low-stock inventory items as not inStock', () => {
		const items = [makeShoppingItem('chicken')]
		const inventory = makeInventory([{ name: 'chicken', lowStock: true }])
		const result = annotateInventoryMatches(items, inventory)
		expect(result.items).toHaveLength(1)
		expect(result.items[0]!.inStock).toBe(false)
	})

	test('returns correct stapleCount and inStockCount', () => {
		const items = [
			makeShoppingItem('salt'),
			makeShoppingItem('water'),
			makeShoppingItem('chicken'),
			makeShoppingItem('broccoli'),
		]
		const inventory = makeInventory([{ name: 'chicken' }])
		const result = annotateInventoryMatches(items, inventory)
		expect(result.stapleCount).toBe(2) // salt, water
		expect(result.items).toHaveLength(2) // chicken, broccoli
		expect(result.inStockCount).toBe(1) // chicken
	})

	test('empty inventory only strips staples, marks nothing as inStock', () => {
		const items = [makeShoppingItem('chicken'), makeShoppingItem('olive oil')]
		const result = annotateInventoryMatches(items, [])
		expect(result.items).toHaveLength(1)
		expect(result.items[0]!.name).toBe('chicken')
		expect(result.items[0]!.inStock).toBe(false)
		expect(result.stapleCount).toBe(1) // olive oil is a staple
	})
})
