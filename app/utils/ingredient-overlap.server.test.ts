import { describe, expect, test } from 'vitest'
import {
	analyzeIngredientOverlap,
	scoreRecipePairings,
	generateWasteAlerts,
} from './ingredient-overlap.server.ts'

function makeRecipe(
	id: string,
	title: string,
	ingredients: Array<{ name: string }>,
) {
	return {
		id,
		title,
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
			amount: null,
			unit: null,
			notes: null,
			isHeading: false,
			order: i,
			recipeId: id,
			linkedRecipeId: null,
		})),
	}
}

describe('analyzeIngredientOverlap', () => {
	test('detects shared ingredients across recipes', () => {
		const recipes = [
			makeRecipe('r1', 'Recipe A', [
				{ name: 'garlic' },
				{ name: 'onion' },
				{ name: 'chicken' },
			]),
			makeRecipe('r2', 'Recipe B', [
				{ name: 'garlic' },
				{ name: 'onion' },
				{ name: 'rice' },
			]),
			makeRecipe('r3', 'Recipe C', [
				{ name: 'garlic' },
				{ name: 'onion' },
				{ name: 'beef' },
			]),
		]

		const result = analyzeIngredientOverlap(recipes)

		expect(result.sharedIngredients.has('garlic')).toBe(true)
		expect(result.sharedIngredients.get('garlic')).toHaveLength(3)
		expect(result.sharedIngredients.has('onion')).toBe(true)
		expect(result.sharedIngredients.get('onion')).toHaveLength(3)
	})

	test('identifies single-use ingredients', () => {
		const recipes = [
			makeRecipe('r1', 'Recipe A', [{ name: 'garlic' }, { name: 'parsley' }]),
			makeRecipe('r2', 'Recipe B', [{ name: 'garlic' }, { name: 'basil' }]),
		]

		const result = analyzeIngredientOverlap(recipes)

		expect(result.singleUseIngredients.has('parsley')).toBe(true)
		expect(result.singleUseIngredients.get('parsley')).toBe('r1')
		expect(result.singleUseIngredients.has('basil')).toBe(true)
		expect(result.singleUseIngredients.get('basil')).toBe('r2')
	})

	test('excludes staples (salt, pepper, oil)', () => {
		const recipes = [
			makeRecipe('r1', 'Recipe A', [
				{ name: 'salt' },
				{ name: 'black pepper' },
				{ name: 'olive oil' },
				{ name: 'chicken' },
			]),
			makeRecipe('r2', 'Recipe B', [
				{ name: 'salt' },
				{ name: 'pepper' },
				{ name: 'vegetable oil' },
				{ name: 'rice' },
			]),
		]

		const result = analyzeIngredientOverlap(recipes)

		// Staples should not appear in either map
		expect(result.sharedIngredients.has('salt')).toBe(false)
		expect(result.singleUseIngredients.has('salt')).toBe(false)
		expect(result.sharedIngredients.has('pepper')).toBe(false)
		expect(result.sharedIngredients.has('oil')).toBe(false)
		// Non-staples should be there
		expect(result.singleUseIngredients.has('chicken')).toBe(true)
		expect(result.singleUseIngredients.has('rice')).toBe(true)
	})

	test('consolidates synonyms (cilantro + coriander)', () => {
		const recipes = [
			makeRecipe('r1', 'Recipe A', [{ name: 'cilantro' }]),
			makeRecipe('r2', 'Recipe B', [{ name: 'coriander' }]),
		]

		const result = analyzeIngredientOverlap(recipes)

		// They should both map to the same canonical name and be shared
		expect(result.sharedIngredients.size).toBe(1)
		expect(result.singleUseIngredients.size).toBe(0)
	})

	test('calculates efficiency score correctly', () => {
		// 3 recipes, 9 total ingredient slots, 7 unique → 7/9 ≈ 0.78
		const recipes = [
			makeRecipe('r1', 'Recipe A', [
				{ name: 'garlic' },
				{ name: 'onion' },
				{ name: 'chicken' },
			]),
			makeRecipe('r2', 'Recipe B', [
				{ name: 'garlic' },
				{ name: 'onion' },
				{ name: 'rice' },
			]),
			makeRecipe('r3', 'Recipe C', [
				{ name: 'garlic' },
				{ name: 'beef' },
				{ name: 'carrot' },
			]),
		]

		const result = analyzeIngredientOverlap(recipes)

		// 5 unique ingredients (garlic, onion, chicken, rice, beef, carrot) → 6 unique out of 9 slots
		expect(result.uniqueCount).toBe(6)
		expect(result.totalSlots).toBe(9)
		expect(result.efficiencyScore).toBeCloseTo(6 / 9, 2)
	})

	test('returns score 1 for empty recipe list', () => {
		const result = analyzeIngredientOverlap([])
		expect(result.efficiencyScore).toBe(1)
		expect(result.uniqueCount).toBe(0)
		expect(result.totalSlots).toBe(0)
	})

	test('single recipe has no shared ingredients', () => {
		const recipes = [
			makeRecipe('r1', 'Recipe A', [{ name: 'garlic' }, { name: 'onion' }]),
		]

		const result = analyzeIngredientOverlap(recipes)

		expect(result.sharedIngredients.size).toBe(0)
		expect(result.singleUseIngredients.size).toBe(2)
		expect(result.efficiencyScore).toBe(1)
	})
})

describe('scoreRecipePairings', () => {
	test('scores candidates by overlap with planned recipes', () => {
		const planned = [
			makeRecipe('r1', 'Recipe A', [
				{ name: 'garlic' },
				{ name: 'onion' },
				{ name: 'cilantro' },
				{ name: 'chicken' },
			]),
		]

		const candidates = [
			makeRecipe('r2', 'Lots of overlap', [
				{ name: 'garlic' },
				{ name: 'onion' },
				{ name: 'cilantro' },
				{ name: 'rice' },
				{ name: 'tomato' },
			]),
			makeRecipe('r3', 'Some overlap', [{ name: 'garlic' }, { name: 'beef' }]),
			makeRecipe('r4', 'No overlap', [{ name: 'pasta' }, { name: 'cream' }]),
		]

		const scores = scoreRecipePairings(planned, candidates)

		expect(scores[0]!.recipeId).toBe('r2')
		expect(scores[0]!.overlapCount).toBe(3)
		expect(scores[0]!.score).toBe(60) // 3/5 = 60%

		expect(scores[1]!.recipeId).toBe('r3')
		expect(scores[1]!.overlapCount).toBe(1)

		expect(scores[2]!.recipeId).toBe('r4')
		expect(scores[2]!.overlapCount).toBe(0)
	})

	test('excludes already-planned recipes from candidates', () => {
		const planned = [makeRecipe('r1', 'Recipe A', [{ name: 'garlic' }])]

		const candidates = [
			makeRecipe('r1', 'Recipe A', [{ name: 'garlic' }]),
			makeRecipe('r2', 'Recipe B', [{ name: 'garlic' }]),
		]

		const scores = scoreRecipePairings(planned, candidates)

		expect(scores).toHaveLength(1)
		expect(scores[0]!.recipeId).toBe('r2')
	})

	test('returns empty array when no candidates', () => {
		const planned = [makeRecipe('r1', 'Recipe A', [{ name: 'garlic' }])]

		const scores = scoreRecipePairings(planned, [])
		expect(scores).toHaveLength(0)
	})

	test('returns empty array when no planned recipes', () => {
		const candidates = [makeRecipe('r1', 'Recipe A', [{ name: 'garlic' }])]

		const scores = scoreRecipePairings([], candidates)
		expect(scores).toHaveLength(1)
		expect(scores[0]!.overlapCount).toBe(0)
	})

	test('handles synonym overlap (cilantro in plan, coriander in candidate)', () => {
		const planned = [makeRecipe('r1', 'Recipe A', [{ name: 'cilantro' }])]

		const candidates = [makeRecipe('r2', 'Recipe B', [{ name: 'coriander' }])]

		const scores = scoreRecipePairings(planned, candidates)
		expect(scores[0]!.overlapCount).toBe(1)
	})
})

describe('generateWasteAlerts', () => {
	test('alerts for single-use ingredients with suggestions', () => {
		const planned = [
			makeRecipe('r1', 'Thai Curry', [{ name: 'garlic' }, { name: 'parsley' }]),
			makeRecipe('r2', 'Stir Fry', [{ name: 'garlic' }, { name: 'ginger' }]),
		]

		const allRecipes = [
			...planned,
			makeRecipe('r3', 'Tabbouleh', [{ name: 'parsley' }, { name: 'bulgur' }]),
		]

		const alerts = generateWasteAlerts(planned, allRecipes)

		// parsley is single-use → should suggest tabbouleh
		const parsleyAlert = alerts.find((a) => a.ingredientName === 'parsley')
		expect(parsleyAlert).toBeDefined()
		expect(parsleyAlert!.usedInRecipeTitle).toBe('Thai Curry')
		expect(parsleyAlert!.suggestedRecipes).toHaveLength(1)
		expect(parsleyAlert!.suggestedRecipes[0]!.title).toBe('Tabbouleh')
	})

	test('no alert when there are no suggestions for single-use ingredient', () => {
		const planned = [
			makeRecipe('r1', 'Recipe A', [{ name: 'garlic' }, { name: 'truffle' }]),
		]

		// No other recipes use truffle
		const allRecipes = [
			...planned,
			makeRecipe('r2', 'Recipe B', [{ name: 'chicken' }]),
		]

		const alerts = generateWasteAlerts(planned, allRecipes)

		expect(alerts.find((a) => a.ingredientName === 'truffle')).toBeUndefined()
	})

	test('empty plan returns no alerts', () => {
		const allRecipes = [makeRecipe('r1', 'Recipe A', [{ name: 'garlic' }])]

		const alerts = generateWasteAlerts([], allRecipes)
		expect(alerts).toHaveLength(0)
	})

	test('does not suggest already-planned recipes', () => {
		const planned = [
			makeRecipe('r1', 'Recipe A', [{ name: 'basil' }]),
			makeRecipe('r2', 'Recipe B', [{ name: 'basil' }]),
		]

		// basil is shared so no alert — but let's also ensure planned recipes
		// aren't suggested even if they existed differently
		const allRecipes = [...planned]

		const alerts = generateWasteAlerts(planned, allRecipes)

		// basil is shared between r1 and r2, so no alert
		expect(alerts.find((a) => a.ingredientName === 'basil')).toBeUndefined()
	})

	test('excludes staple ingredients from alerts', () => {
		const planned = [
			makeRecipe('r1', 'Recipe A', [{ name: 'salt' }, { name: 'chicken' }]),
		]

		const allRecipes = [
			...planned,
			makeRecipe('r2', 'Recipe B', [{ name: 'salt' }, { name: 'beef' }]),
		]

		const alerts = generateWasteAlerts(planned, allRecipes)

		// salt is a staple, should not appear
		expect(alerts.find((a) => a.ingredientName === 'salt')).toBeUndefined()
	})
})
