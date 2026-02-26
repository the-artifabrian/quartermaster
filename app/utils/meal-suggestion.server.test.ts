import { describe, expect, test } from 'vitest'
import {
	classifyRecipe,
	createVarietyState,
	extractPrimaryProtein,
	getNormalizedIngredientSet,
	isTooSimilar,
	MIN_FIT_THRESHOLD,
	recordSelection,
	scoreMealTypeFit,
} from './meal-suggestion.server.ts'

// Helper to create ingredient arrays for variety-checking tests
function makeIngredients(
	names: string[],
): Array<{ name: string; isHeading: boolean; notes: string | null }> {
	return names.map((name) => ({ name, isHeading: false, notes: null }))
}

// --- classifyRecipe ---

describe('classifyRecipe', () => {
	describe('condiments — head noun detection', () => {
		test('basic condiment titles', () => {
			expect(classifyRecipe('Teriyaki Sauce')).toBe('condiment')
			expect(classifyRecipe('Ranch Dressing')).toBe('condiment')
			expect(classifyRecipe('Balsamic Vinaigrette')).toBe('condiment')
			expect(classifyRecipe('Garlic Aioli')).toBe('condiment')
			expect(classifyRecipe('Mango Chutney')).toBe('condiment')
			expect(classifyRecipe('Chimichurri')).toBe('condiment')
		})

		test('condiments with main-dish modifier words', () => {
			// The bug that started it all — head noun "sauce" should win
			expect(classifyRecipe('Gyoza dipping sauce')).toBe('condiment')
			expect(classifyRecipe('Dumpling Sauce')).toBe('condiment')
			expect(classifyRecipe('Pizza Sauce')).toBe('condiment')
			expect(classifyRecipe('Pasta Sauce')).toBe('condiment')
			expect(classifyRecipe('Burger Sauce')).toBe('condiment')
			expect(classifyRecipe('Taco Sauce')).toBe('condiment')
		})

		test('condiments with protein modifier words', () => {
			expect(classifyRecipe('Fish Sauce')).toBe('condiment')
			expect(classifyRecipe('Salmon Glaze')).toBe('condiment')
			expect(classifyRecipe('Turkey Gravy')).toBe('condiment')
			expect(classifyRecipe('Chicken Marinade')).toBe('condiment')
			expect(classifyRecipe('Beef Marinade')).toBe('condiment')
			expect(classifyRecipe('Pork Rub')).toBe('condiment')
		})

		test('condiment words anywhere in title', () => {
			expect(classifyRecipe('Quick Cucumber Pickles')).toBe('condiment')
			expect(classifyRecipe('Pickled Red Onions')).toBe('condiment')
		})

		test('dips and spreads', () => {
			expect(classifyRecipe('Garlic Hummus')).toBe('condiment')
			expect(classifyRecipe('Classic Guacamole')).toBe('condiment')
			expect(classifyRecipe('Tzatziki')).toBe('condiment')
			expect(classifyRecipe('Herb Butter Spread')).toBe('condiment')
		})

		test('sweet condiments', () => {
			expect(classifyRecipe('Strawberry Jam')).toBe('condiment')
			expect(classifyRecipe('Maple Syrup')).toBe('condiment')
			expect(classifyRecipe('Berry Compote')).toBe('condiment')
		})
	})

	describe('main dishes — proteins', () => {
		test('protein as primary word', () => {
			expect(classifyRecipe('Grilled Chicken')).toBe('main')
			expect(classifyRecipe('Pan-Seared Salmon')).toBe('main')
			expect(classifyRecipe('Braised Short Ribs')).toBe('main')
			expect(classifyRecipe('Roast Turkey')).toBe('main')
			expect(classifyRecipe('Crispy Tofu')).toBe('main')
		})

		test('protein with preparation style', () => {
			expect(classifyRecipe('Honey Glazed Pork')).toBe('main')
			expect(classifyRecipe('Lemon Herb Chicken')).toBe('main')
			expect(classifyRecipe('Blackened Fish Tacos')).toBe('main')
		})
	})

	describe('main dishes — dish words', () => {
		test('classic main dish words', () => {
			expect(classifyRecipe('Chicken Curry')).toBe('main')
			expect(classifyRecipe('Beef Stew')).toBe('main')
			expect(classifyRecipe('Vegetable Soup')).toBe('main')
			expect(classifyRecipe('Margherita Pizza')).toBe('main')
			expect(classifyRecipe('Mushroom Risotto')).toBe('main')
			expect(classifyRecipe('Pork Ramen')).toBe('main')
		})

		test('wrapped/container dishes', () => {
			expect(classifyRecipe('Chicken Burrito')).toBe('main')
			expect(classifyRecipe('Veggie Wrap')).toBe('main')
			expect(classifyRecipe('Turkey Sandwich')).toBe('main')
			expect(classifyRecipe('Cheese Quesadilla')).toBe('main')
		})

		test('skillet and one-pot', () => {
			expect(classifyRecipe('Sausage Skillet')).toBe('main')
			expect(classifyRecipe('Three Bean Chili')).toBe('main')
			expect(classifyRecipe('Chicken Casserole')).toBe('main')
		})
	})

	describe('main dishes — phrases', () => {
		test('multi-word dish names', () => {
			expect(classifyRecipe('Pad Thai')).toBe('main')
			expect(classifyRecipe('Chicken Lo Mein')).toBe('main')
			expect(classifyRecipe('Vegetable Fried Rice')).toBe('main')
			expect(classifyRecipe('Mac and Cheese')).toBe('main')
			expect(classifyRecipe('Tikka Masala')).toBe('main')
		})

		test('phrases override dessert head nouns', () => {
			// "pie" is a dessert head noun, but "pot pie" is a main dish phrase
			expect(classifyRecipe('Chicken Pot Pie')).toBe('main')
			expect(classifyRecipe("Shepherd's Pie")).toBe('main')
		})

		test('phrases override condiment head nouns', () => {
			// "gravy" is a condiment head noun, but "biscuits and gravy" is a meal
			expect(classifyRecipe('Biscuits and Gravy')).toBe('main')
		})
	})

	describe('breakfast', () => {
		test('breakfast words', () => {
			expect(classifyRecipe('Blueberry Pancakes')).toBe('breakfast')
			expect(classifyRecipe('Belgian Waffles')).toBe('breakfast')
			expect(classifyRecipe('Spinach Frittata')).toBe('breakfast')
			expect(classifyRecipe('Mushroom Quiche')).toBe('breakfast')
			expect(classifyRecipe('Homemade Granola')).toBe('breakfast')
		})

		test('breakfast phrases', () => {
			expect(classifyRecipe('French Toast')).toBe('breakfast')
			expect(classifyRecipe('Eggs Benedict')).toBe('breakfast')
			expect(classifyRecipe('Overnight Oats')).toBe('breakfast')
			expect(classifyRecipe('Breakfast Burrito')).toBe('breakfast')
		})

		test('smoothie/acai bowls are breakfast', () => {
			expect(classifyRecipe('Smoothie Bowl')).toBe('breakfast')
			expect(classifyRecipe('Berry Smoothie Bowl')).toBe('breakfast')
			expect(classifyRecipe('Acai Bowl')).toBe('breakfast')
		})
	})

	describe('beverages', () => {
		test('beverage head noun', () => {
			expect(classifyRecipe('Mango Smoothie')).toBe('beverage')
			expect(classifyRecipe('Strawberry Lemonade')).toBe('beverage')
			expect(classifyRecipe('Iced Latte')).toBe('beverage')
			expect(classifyRecipe('Pumpkin Spice Chai')).toBe('beverage')
		})

		test('alcoholic beverages', () => {
			expect(classifyRecipe('Classic Margarita')).toBe('beverage')
			expect(classifyRecipe('Homemade Limoncello')).toBe('beverage')
			expect(classifyRecipe('Summer Sangria')).toBe('beverage')
		})
	})

	describe('desserts', () => {
		test('dessert head nouns', () => {
			expect(classifyRecipe('Chocolate Cake')).toBe('dessert')
			expect(classifyRecipe('Apple Pie')).toBe('dessert')
			expect(classifyRecipe('Lemon Tart')).toBe('dessert')
			expect(classifyRecipe('Peach Cobbler')).toBe('dessert')
			expect(classifyRecipe('Mango Sorbet')).toBe('dessert')
		})

		test('dessert words anywhere in title', () => {
			expect(classifyRecipe('Carrot Cake Loaf')).toBe('dessert')
			expect(classifyRecipe('Brownie Bites')).toBe('dessert')
			expect(classifyRecipe('Cookie Dough Truffles')).toBe('dessert')
		})
	})

	describe('sides', () => {
		test('side head nouns', () => {
			expect(classifyRecipe('Steamed Rice')).toBe('side')
			expect(classifyRecipe('Garlic Naan')).toBe('side')
			expect(classifyRecipe('Buttery Focaccia')).toBe('side')
			expect(classifyRecipe('Cheesy Polenta')).toBe('side')
			expect(classifyRecipe('Creamy Coleslaw')).toBe('side')
		})
	})

	describe('unclassified', () => {
		test('recipes with no matching keywords', () => {
			expect(classifyRecipe('Grilled Vegetables')).toBe('unclassified')
			expect(classifyRecipe('Roasted Beets')).toBe('unclassified')
		})
	})

	describe('edge cases', () => {
		test('case insensitivity', () => {
			expect(classifyRecipe('CHICKEN CURRY')).toBe('main')
			expect(classifyRecipe('gyoza dipping sauce')).toBe('condiment')
			expect(classifyRecipe('FRENCH TOAST')).toBe('breakfast')
		})

		test('hyphenated words', () => {
			expect(classifyRecipe('Pan-Seared Salmon')).toBe('main')
			expect(classifyRecipe('Slow-Braised Beef')).toBe('main')
		})

		test('single-word titles', () => {
			expect(classifyRecipe('Ramen')).toBe('main')
			expect(classifyRecipe('Shakshuka')).toBe('breakfast')
			expect(classifyRecipe('Hummus')).toBe('condiment')
			expect(classifyRecipe('Guacamole')).toBe('condiment')
		})

		test('empty string returns unclassified', () => {
			expect(classifyRecipe('')).toBe('unclassified')
		})
	})
})

// --- scoreMealTypeFit ---

describe('scoreMealTypeFit', () => {
	test('condiments always return 0', () => {
		expect(scoreMealTypeFit('Teriyaki Sauce', 5, 'dinner')).toBe(0)
		expect(scoreMealTypeFit('Ranch Dressing', 5, 'lunch')).toBe(0)
		expect(scoreMealTypeFit('Gyoza dipping sauce', 3, 'dinner')).toBe(0)
		expect(scoreMealTypeFit('Fish Sauce', 2, 'snack')).toBe(0)
	})

	test('beverages always return 0', () => {
		expect(scoreMealTypeFit('Mango Smoothie', 4, 'dinner')).toBe(0)
		expect(scoreMealTypeFit('Strawberry Lemonade', 3, 'breakfast')).toBe(0)
	})

	test('main dishes score high for dinner and lunch', () => {
		const dinnerScore = scoreMealTypeFit('Chicken Curry', 8, 'dinner')
		const lunchScore = scoreMealTypeFit('Chicken Curry', 8, 'lunch')
		expect(dinnerScore).toBe(1.0)
		expect(lunchScore).toBe(1.0)
	})

	test('main dishes score low for breakfast', () => {
		const score = scoreMealTypeFit('Beef Stew', 10, 'breakfast')
		expect(score).toBeLessThan(MIN_FIT_THRESHOLD)
	})

	test('breakfast items score high for breakfast', () => {
		const score = scoreMealTypeFit('Blueberry Pancakes', 6, 'breakfast')
		expect(score).toBe(1.0)
	})

	test('breakfast items score OK for lunch', () => {
		const score = scoreMealTypeFit('Spinach Frittata', 6, 'lunch')
		expect(score).toBe(0.5)
		expect(score).toBeGreaterThanOrEqual(MIN_FIT_THRESHOLD)
	})

	test('desserts score high for snack', () => {
		const score = scoreMealTypeFit('Chocolate Cake', 8, 'snack')
		expect(score).toBe(0.9)
	})

	test('desserts score low for dinner', () => {
		const score = scoreMealTypeFit('Apple Pie', 6, 'dinner')
		expect(score).toBeLessThan(MIN_FIT_THRESHOLD)
	})

	test('sides score low for dinner (standalone)', () => {
		const score = scoreMealTypeFit('Steamed Rice', 2, 'dinner')
		expect(score).toBeLessThan(MIN_FIT_THRESHOLD)
	})

	test('unclassified with many ingredients passes threshold for dinner/lunch', () => {
		const dinner = scoreMealTypeFit('Grilled Vegetables', 6, 'dinner')
		const lunch = scoreMealTypeFit('Grilled Vegetables', 6, 'lunch')
		expect(dinner).toBeGreaterThanOrEqual(MIN_FIT_THRESHOLD)
		expect(lunch).toBeGreaterThanOrEqual(MIN_FIT_THRESHOLD)
	})

	test('unclassified with few ingredients falls below threshold for dinner', () => {
		const dinner = scoreMealTypeFit('Roasted Beets', 2, 'dinner')
		expect(dinner).toBeLessThan(MIN_FIT_THRESHOLD)
	})
})

// --- Variety checking ---

describe('extractPrimaryProtein', () => {
	test('finds protein in ingredients', () => {
		expect(extractPrimaryProtein(makeIngredients(['chicken breast', 'garlic', 'olive oil']))).toBe('chicken')
		expect(extractPrimaryProtein(makeIngredients(['salmon fillet', 'lemon', 'dill']))).toBe('salmon')
		expect(extractPrimaryProtein(makeIngredients(['ground beef', 'onion', 'tomato']))).toBe('beef')
	})

	test('ignores non-protein compounds', () => {
		// "chicken broth" is not a protein — broth is a non-protein suffix
		expect(extractPrimaryProtein(makeIngredients(['chicken broth', 'noodles', 'carrots']))).toBe(null)
		expect(extractPrimaryProtein(makeIngredients(['fish sauce', 'rice', 'lime']))).toBe(null)
		expect(extractPrimaryProtein(makeIngredients(['duck fat', 'potatoes', 'rosemary']))).toBe(null)
	})

	test('skips heading ingredients', () => {
		const ingredients = [
			{ name: 'For the chicken', isHeading: true, notes: null },
			{ name: 'garlic', isHeading: false, notes: null },
		]
		expect(extractPrimaryProtein(ingredients)).toBe(null)
	})

	test('returns null when no protein found', () => {
		expect(extractPrimaryProtein(makeIngredients(['pasta', 'garlic', 'olive oil', 'parmesan']))).toBe(null)
	})
})

describe('isTooSimilar', () => {
	test('rejects third recipe with same protein', () => {
		const state = createVarietyState()
		// Add two chicken recipes
		recordSelection(makeIngredients(['chicken', 'garlic', 'lemon']), state)
		recordSelection(makeIngredients(['chicken', 'soy sauce', 'ginger']), state)

		// Third chicken recipe is too similar
		expect(isTooSimilar(makeIngredients(['chicken', 'paprika', 'onion']), state)).toBe(true)
	})

	test('allows second recipe with same protein', () => {
		const state = createVarietyState()
		recordSelection(makeIngredients(['chicken', 'garlic', 'lemon']), state)

		// Second chicken recipe is fine
		expect(isTooSimilar(makeIngredients(['chicken', 'paprika', 'onion']), state)).toBe(false)
	})

	test('allows different proteins', () => {
		const state = createVarietyState()
		recordSelection(makeIngredients(['chicken', 'garlic', 'lemon']), state)
		recordSelection(makeIngredients(['chicken', 'soy sauce', 'ginger']), state)

		// Beef recipe is fine even though we have 2 chicken
		expect(isTooSimilar(makeIngredients(['beef', 'onion', 'potato']), state)).toBe(false)
	})

	test('rejects high ingredient overlap', () => {
		const state = createVarietyState()
		recordSelection(makeIngredients(['pasta', 'tomato', 'basil', 'garlic']), state)

		// Same core ingredients = too similar (Jaccard > 0.5)
		expect(isTooSimilar(makeIngredients(['pasta', 'tomato', 'basil', 'mozzarella']), state)).toBe(true)
	})

	test('allows low ingredient overlap', () => {
		const state = createVarietyState()
		recordSelection(makeIngredients(['pasta', 'tomato', 'basil', 'garlic']), state)

		// Completely different ingredients
		expect(isTooSimilar(makeIngredients(['rice', 'soy sauce', 'sesame', 'ginger']), state)).toBe(false)
	})
})

describe('getNormalizedIngredientSet', () => {
	test('skips headings', () => {
		const ingredients = [
			{ name: 'For the sauce', isHeading: true, notes: null },
			{ name: 'chicken breast', isHeading: false, notes: null },
			{ name: 'broccoli', isHeading: false, notes: null },
		]
		const result = getNormalizedIngredientSet(ingredients)
		expect(result.has('chicken breast')).toBe(true)
		expect(result.has('broccoli')).toBe(true)
		expect(result.size).toBe(2)
	})
})
