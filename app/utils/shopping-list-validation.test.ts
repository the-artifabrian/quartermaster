import { describe, expect, test } from 'vitest'
import { guessCategory } from './shopping-list-validation.ts'

describe('guessCategory', () => {
	test('categorizes produce', () => {
		expect(guessCategory('tomato')).toBe('produce')
		expect(guessCategory('Fresh Garlic')).toBe('produce')
		expect(guessCategory('red onion')).toBe('produce')
		expect(guessCategory('baby spinach')).toBe('produce')
		expect(guessCategory('avocado')).toBe('produce')
	})

	test('categorizes dairy', () => {
		expect(guessCategory('whole milk')).toBe('dairy')
		expect(guessCategory('cheddar cheese')).toBe('dairy')
		expect(guessCategory('unsalted butter')).toBe('dairy')
		expect(guessCategory('heavy cream')).toBe('dairy')
		expect(guessCategory('greek yogurt')).toBe('dairy')
	})

	test('categorizes meat', () => {
		expect(guessCategory('chicken breast')).toBe('meat')
		expect(guessCategory('ground beef')).toBe('meat')
		expect(guessCategory('pork chops')).toBe('meat')
		expect(guessCategory('salmon fillet')).toBe('meat')
		expect(guessCategory('shrimp')).toBe('meat')
		expect(guessCategory('bacon')).toBe('meat')
	})

	test('categorizes frozen', () => {
		expect(guessCategory('frozen peas')).toBe('frozen')
		expect(guessCategory('frozen corn')).toBe('frozen')
	})

	test('ice cream matches dairy before frozen due to regex order', () => {
		// "ice cream" matches "cream" in dairy regex before reaching frozen
		expect(guessCategory('ice cream')).toBe('dairy')
	})

	test('categorizes bakery', () => {
		expect(guessCategory('sourdough bread')).toBe('bakery')
		expect(guessCategory('hamburger bun')).toBe('bakery')
		expect(guessCategory('flour tortilla')).toBe('bakery')
		expect(guessCategory('pita')).toBe('bakery')
	})

	test('categorizes pantry', () => {
		expect(guessCategory('all-purpose flour')).toBe('pantry')
		expect(guessCategory('brown sugar')).toBe('pantry')
		expect(guessCategory('jasmine rice')).toBe('pantry')
		expect(guessCategory('spaghetti pasta')).toBe('pantry')
		expect(guessCategory('olive oil')).toBe('pantry')
		expect(guessCategory('soy sauce')).toBe('pantry')
		expect(guessCategory('black beans')).toBe('pantry')
		expect(guessCategory('oats')).toBe('pantry')
	})

	test('categorizes household items', () => {
		expect(guessCategory('toilet paper')).toBe('household')
		expect(guessCategory('Paper Towels')).toBe('household')
		expect(guessCategory('dish soap')).toBe('household')
		expect(guessCategory('laundry detergent')).toBe('household')
		expect(guessCategory('all-purpose cleaner')).toBe('household')
		expect(guessCategory('disinfecting wipes')).toBe('household')
		expect(guessCategory('sponge')).toBe('household')
		expect(guessCategory('shampoo')).toBe('household')
		expect(guessCategory('toothpaste')).toBe('household')
		expect(guessCategory('trash bags')).toBe('household')
		expect(guessCategory('aluminum foil')).toBe('household')
		expect(guessCategory('batteries')).toBe('household')
		expect(guessCategory('dog food')).toBe('household')
		expect(guessCategory('cat litter')).toBe('household')
		expect(guessCategory('dryer sheets')).toBe('household')
		expect(guessCategory('plastic wrap')).toBe('household')
		expect(guessCategory('Toilet Paper')).toBe('household')
	})

	test('falls back to "other" for unknown items', () => {
		expect(guessCategory('tofu')).toBe('other')
		expect(guessCategory('tempeh')).toBe('other')
	})

	test('categorizes expanded pantry items', () => {
		expect(guessCategory('nutritional yeast')).toBe('pantry')
		expect(guessCategory('baking powder')).toBe('pantry')
		expect(guessCategory('baking soda')).toBe('pantry')
		expect(guessCategory('vanilla extract')).toBe('pantry')
		expect(guessCategory('cornstarch')).toBe('pantry')
		expect(guessCategory('cumin')).toBe('pantry')
		expect(guessCategory('honey')).toBe('pantry')
		expect(guessCategory('white vinegar')).toBe('pantry')
		expect(guessCategory('cinnamon')).toBe('pantry')
		expect(guessCategory('maple syrup')).toBe('pantry')
	})
})
