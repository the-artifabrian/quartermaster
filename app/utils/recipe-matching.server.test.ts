import { describe, expect, test } from 'vitest'
import {
	normalizeIngredientName,
	getCanonicalIngredientName,
	ingredientMatchesInventoryItem,
	isStapleIngredient,
	matchRecipesWithInventory,
	INGREDIENT_SYNONYMS,
} from './recipe-matching.server.ts'

describe('normalizeIngredientName', () => {
	test('lowercases and trims', () => {
		expect(normalizeIngredientName('  Chicken  ')).toBe('chicken')
	})

	test('removes parenthetical notes', () => {
		expect(normalizeIngredientName('flour (for tangzhong)')).toBe('flour')
	})

	test('removes comma-separated preparation instructions', () => {
		expect(normalizeIngredientName('scallions, finely diced')).toBe('scallion')
	})

	test('handles "or" alternatives — takes first option', () => {
		// "plain" is not a modifier, so "plain flour" stays as-is
		expect(normalizeIngredientName('plain flour or all purpose flour')).toBe(
			'plain flour',
		)
		expect(normalizeIngredientName('mirin or sake')).toBe('mirin')
	})

	test('handles slash alternatives — takes first option', () => {
		expect(normalizeIngredientName('mirin/sake/white wine')).toBe('mirin')
	})

	test('strips freshness/state modifiers', () => {
		expect(normalizeIngredientName('fresh basil')).toBe('basil')
		expect(normalizeIngredientName('dried oregano')).toBe('oregano')
		expect(normalizeIngredientName('frozen peas')).toBe('pea')
	})

	test('strips preparation modifiers', () => {
		expect(normalizeIngredientName('chopped onion')).toBe('onion')
		expect(normalizeIngredientName('minced garlic')).toBe('garlic')
		expect(normalizeIngredientName('grated parmesan')).toBe('parmesan')
	})

	test('strips size modifiers', () => {
		expect(normalizeIngredientName('large eggs')).toBe('egg')
		expect(normalizeIngredientName('medium onion')).toBe('onion')
	})

	test('strips color modifiers for non-protected compounds', () => {
		expect(normalizeIngredientName('yellow bell pepper')).toBe('bell pepper')
		expect(normalizeIngredientName('red bell peppers')).toBe('bell pepper')
	})

	test('protects compound ingredients from modifier stripping', () => {
		expect(normalizeIngredientName('green onion')).toBe('green onion')
		expect(normalizeIngredientName('green onions')).toBe('green onion')
		expect(normalizeIngredientName('red pepper')).toBe('red pepper')
		expect(normalizeIngredientName('red onion')).toBe('red onion')
		expect(normalizeIngredientName('brown sugar')).toBe('brown sugar')
		expect(normalizeIngredientName('white wine')).toBe('white wine')
		expect(normalizeIngredientName('dark chocolate')).toBe('dark chocolate')
		expect(normalizeIngredientName('black bean')).toBe('black bean')
		expect(normalizeIngredientName('black beans')).toBe('black bean')
	})

	test('strips non-identity modifiers but keeps protected compound parts', () => {
		// "large green onions" — "large" is stripped, "green" is protected via "green onion"
		expect(normalizeIngredientName('large green onions')).toBe('green onion')
	})

	test('strips sugar/grain type modifiers', () => {
		expect(normalizeIngredientName('granulated sugar')).toBe('sugar')
		expect(normalizeIngredientName('powdered sugar')).toBe('sugar')
		expect(normalizeIngredientName('confectioners sugar')).toBe('sugar')
	})

	test('handles irregular plurals', () => {
		expect(normalizeIngredientName('tomatoes')).toBe('tomato')
		expect(normalizeIngredientName('potatoes')).toBe('potato')
	})

	test('handles -ies plurals', () => {
		expect(normalizeIngredientName('berries')).toBe('berry')
	})

	test('handles -es plurals for sibilant endings', () => {
		expect(normalizeIngredientName('peaches')).toBe('peach')
	})

	test('handles simple -s plurals', () => {
		expect(normalizeIngredientName('carrots')).toBe('carrot')
		expect(normalizeIngredientName('onions')).toBe('onion')
	})

	test('does not strip short words (<=3 chars)', () => {
		expect(normalizeIngredientName('egg')).toBe('egg')
	})

	test('combines multiple normalizations', () => {
		expect(normalizeIngredientName('Fresh Garlic, minced')).toBe('garlic')
		expect(normalizeIngredientName('large red bell peppers (roasted)')).toBe(
			'bell pepper',
		)
	})

	test('strips leading "of " from ingredient names', () => {
		expect(normalizeIngredientName('of garlic')).toBe('garlic')
		expect(normalizeIngredientName('of celery')).toBe('celery')
	})

	test('strips meat descriptors', () => {
		expect(normalizeIngredientName('boneless chicken thighs')).toBe(
			'chicken thigh',
		)
		expect(normalizeIngredientName('skinless chicken breast')).toBe(
			'chicken breast',
		)
		expect(normalizeIngredientName('bone-in pork chops')).toBe('pork chop')
	})

	test('strips processing modifiers', () => {
		expect(normalizeIngredientName('smoked paprika')).toBe('paprika')
		expect(normalizeIngredientName('roasted peanuts')).toBe('peanut')
		expect(normalizeIngredientName('toasted sesame seeds')).toBe(
			'sesame seed',
		)
	})
})

describe('getCanonicalIngredientName', () => {
	test('returns normalized name when no synonyms exist', () => {
		expect(getCanonicalIngredientName('carrots')).toBe('carrot')
	})

	test('bidirectional: cilantro and coriander map to the same canonical name', () => {
		const fromCilantro = getCanonicalIngredientName('cilantro')
		const fromCoriander = getCanonicalIngredientName('coriander')
		expect(fromCilantro).toBe(fromCoriander)
	})

	test('scallion and green onion share canonical name (compound protection fix)', () => {
		// "green onion" → protected compound, "green" NOT stripped → "green onion"
		// "scallion" → synonyms: green onion, spring onion → canonical: "green onion"
		const fromScallion = getCanonicalIngredientName('scallion')
		const fromGreenOnion = getCanonicalIngredientName('green onion')
		expect(fromScallion).toBe(fromGreenOnion)
	})

	test('bidirectional: stock and broth map to the same canonical name', () => {
		const fromStock = getCanonicalIngredientName('stock')
		const fromBroth = getCanonicalIngredientName('broth')
		expect(fromStock).toBe(fromBroth)
	})

	test('canonical name is alphabetically first among equivalents', () => {
		// cilantro's synonyms: coriander, chinese parsley
		// equivalents: cilantro, coriander, chinese parsley → sorted: chinese parsley
		expect(getCanonicalIngredientName('cilantro')).toBe('chinese parsley')
	})

	test('handles modifier-stripped names that land on synonym keys', () => {
		// "powdered sugar" → modifier stripped → "sugar" → synonym: "icing sugar"
		expect(getCanonicalIngredientName('powdered sugar')).toBe(
			getCanonicalIngredientName('icing sugar'),
		)
	})

	test('"garlic cloves" and "garlic" share canonical name', () => {
		// "garlic cloves" → depluralized → "garlic clove" → synonym → "garlic"
		const fromCloves = getCanonicalIngredientName('garlic cloves')
		const fromGarlic = getCanonicalIngredientName('garlic')
		expect(fromCloves).toBe(fromGarlic)
	})

	test('"celery stalks" and "celery" share canonical name', () => {
		const fromStalks = getCanonicalIngredientName('celery stalks')
		const fromCelery = getCanonicalIngredientName('celery')
		expect(fromStalks).toBe(fromCelery)
	})
})

describe('ingredientMatchesInventoryItem', () => {
	const match = (ingredientName: string, inventoryName: string) =>
		ingredientMatchesInventoryItem(
			{ name: ingredientName },
			{ name: inventoryName },
		)

	test('exact match after normalization', () => {
		expect(match('Carrots', 'carrots')).toBe(true)
		expect(match('Fresh Basil', 'basil')).toBe(true)
	})

	test('synonym match', () => {
		expect(match('cilantro', 'coriander')).toBe(true)
		expect(match('coriander', 'cilantro')).toBe(true)
		expect(match('soy sauce', 'tamari')).toBe(true)
		expect(match('stock', 'broth')).toBe(true)
	})

	test('scallion matches green onion (compound protection + synonym)', () => {
		// "green onion" → protected compound, stays "green onion" after normalization
		// "scallion" synonyms include "green onion" → match
		expect(match('scallion', 'green onion')).toBe(true)
	})

	test('core word match', () => {
		expect(match('chicken breast', 'chicken thigh')).toBe(true)
	})

	test('single-word ingredient matches multi-word inventory (first/last word)', () => {
		expect(match('butter', 'unsalted butter')).toBe(true)
		expect(match('cucumber', 'persian cucumber')).toBe(true)
	})

	test('multi-word ingredient matches single-word inventory', () => {
		expect(match('unsalted butter', 'butter')).toBe(true)
	})

	test('multi-word containment', () => {
		expect(match('chicken stock', 'chicken stock')).toBe(true)
	})

	test('negative: rice does NOT match rice vinegar', () => {
		expect(match('rice', 'rice vinegar')).toBe(false)
	})

	test('negative: coconut does NOT match coconut milk', () => {
		expect(match('coconut', 'coconut milk')).toBe(false)
	})

	test('negative: tomato does NOT match tomato paste', () => {
		expect(match('tomato', 'tomato paste')).toBe(false)
	})

	test('negative: completely unrelated ingredients do not match', () => {
		expect(match('chicken', 'flour')).toBe(false)
		expect(match('milk', 'garlic')).toBe(false)
	})

	test('negative: partial word overlap does not match', () => {
		expect(match('corn', 'cornstarch')).toBe(false)
	})
})

describe('isStapleIngredient', () => {
	test('recognizes common staples', () => {
		expect(isStapleIngredient({ name: 'salt' })).toBe(true)
		expect(isStapleIngredient({ name: 'water' })).toBe(true)
		expect(isStapleIngredient({ name: 'olive oil' })).toBe(true)
		expect(isStapleIngredient({ name: 'black pepper' })).toBe(true)
	})

	test('handles case and modifiers', () => {
		expect(isStapleIngredient({ name: 'Kosher Salt' })).toBe(true)
		expect(isStapleIngredient({ name: 'freshly ground black pepper' })).toBe(
			true,
		)
	})

	test('non-staples return false', () => {
		expect(isStapleIngredient({ name: 'chicken' })).toBe(false)
		expect(isStapleIngredient({ name: 'flour' })).toBe(false)
		expect(isStapleIngredient({ name: 'butter' })).toBe(false)
	})
})

describe('matchRecipesWithInventory', () => {
	// Helper to create a minimal recipe-like object
	function makeRecipe(
		id: string,
		ingredients: string[],
	): Parameters<typeof matchRecipesWithInventory>[0][number] {
		return {
			id,
			title: `Recipe ${id}`,
			description: null,
			servings: 4,
			prepTime: null,
			cookTime: null,
			isFavorite: false,
			ingredients: ingredients.map((name, i) => ({
				id: `${id}-ing-${i}`,
				name,
				amount: '1',
				unit: 'cup',
				notes: null,
				isHeading: false,
				order: i,
				recipeId: id,
			})),
		}
	}

	function makeInventory(
		names: string[],
	): Parameters<typeof matchRecipesWithInventory>[1] {
		return names.map((name, i) => ({
			name,
			quantity: null,
		}))
	}

	test('calculates match percentage correctly', () => {
		const recipes = [makeRecipe('r1', ['chicken', 'rice', 'soy sauce'])]
		const inventory = makeInventory(['chicken', 'rice'])

		const results = matchRecipesWithInventory(recipes, inventory)
		expect(results).toHaveLength(1)
		expect(results[0]!.matchPercentage).toBe(67) // 2/3
		expect(results[0]!.matchedIngredientsCount).toBe(2)
		expect(results[0]!.totalIngredientsCount).toBe(3)
	})

	test('excludes staple ingredients from matching calculation', () => {
		const recipes = [makeRecipe('r1', ['chicken', 'salt', 'water'])]
		const inventory = makeInventory(['chicken'])

		const results = matchRecipesWithInventory(recipes, inventory)
		expect(results[0]!.totalIngredientsCount).toBe(1) // only chicken counted
		expect(results[0]!.matchPercentage).toBe(100)
		expect(results[0]!.canMake).toBe(true)
	})

	test('canMake is true when all non-staple ingredients are available', () => {
		const recipes = [makeRecipe('r1', ['chicken', 'rice', 'salt'])]
		const inventory = makeInventory(['chicken', 'rice'])

		const results = matchRecipesWithInventory(recipes, inventory)
		expect(results[0]!.canMake).toBe(true)
	})

	test('canMake is false when non-staple ingredients are missing', () => {
		const recipes = [makeRecipe('r1', ['chicken', 'rice', 'broccoli'])]
		const inventory = makeInventory(['chicken'])

		const results = matchRecipesWithInventory(recipes, inventory)
		expect(results[0]!.canMake).toBe(false)
	})

	test('sorts by match percentage descending', () => {
		const recipes = [
			makeRecipe('low', ['chicken', 'rice', 'broccoli', 'soy sauce']),
			makeRecipe('high', ['chicken', 'rice']),
		]
		const inventory = makeInventory(['chicken', 'rice'])

		const results = matchRecipesWithInventory(recipes, inventory)
		expect(results[0]!.recipe.id).toBe('high')
		expect(results[1]!.recipe.id).toBe('low')
	})

	test('breaks tie by total ingredients ascending', () => {
		const recipes = [
			makeRecipe('more', ['chicken', 'rice', 'extra']),
			makeRecipe('fewer', ['chicken', 'rice']),
		]
		// Both 100% match, but "fewer" has fewer total ingredients
		const inventory = makeInventory(['chicken', 'rice', 'extra'])

		const results = matchRecipesWithInventory(recipes, inventory)
		expect(results[0]!.recipe.id).toBe('fewer')
		expect(results[1]!.recipe.id).toBe('more')
	})

	test('missing ingredients are listed', () => {
		const recipes = [makeRecipe('r1', ['chicken', 'rice', 'broccoli'])]
		const inventory = makeInventory(['chicken'])

		const results = matchRecipesWithInventory(recipes, inventory)
		const missingNames = results[0]!.missingIngredients.map((i) => i.name)
		expect(missingNames).toContain('rice')
		expect(missingNames).toContain('broccoli')
		expect(missingNames).not.toContain('chicken')
	})

	test('excludes depleted items (quantity 0) from matching', () => {
		const recipes = [makeRecipe('r1', ['chicken', 'rice'])]
		const inventory = makeInventory(['chicken', 'rice'])
		// Mark rice as depleted
		inventory[1]!.quantity = 0

		const results = matchRecipesWithInventory(recipes, inventory)
		expect(results[0]!.matchedIngredientsCount).toBe(1) // only chicken
		expect(results[0]!.matchPercentage).toBe(50)
		expect(results[0]!.missingIngredients.map((i) => i.name)).toContain('rice')
	})

	test('includes items with null quantity in matching', () => {
		const recipes = [makeRecipe('r1', ['chicken', 'rice'])]
		const inventory = makeInventory(['chicken', 'rice'])
		// null quantity = user has it but didn't track amount

		const results = matchRecipesWithInventory(recipes, inventory)
		expect(results[0]!.matchedIngredientsCount).toBe(2)
		expect(results[0]!.matchPercentage).toBe(100)
	})

	test('recipe with only staple ingredients gets 0% with no inventory', () => {
		const recipes = [makeRecipe('r1', ['salt', 'water', 'olive oil'])]
		const inventory = makeInventory([])

		const results = matchRecipesWithInventory(recipes, inventory)
		expect(results[0]!.totalIngredientsCount).toBe(0)
		expect(results[0]!.matchPercentage).toBe(0)
	})
})
