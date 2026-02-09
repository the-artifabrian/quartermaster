import { describe, expect, test } from 'vitest'
import { generatePrepList, type PrepEntry } from './prep-list.server.ts'

function makeRecipe(
	id: string,
	title: string,
	ingredients: Array<{ name: string; amount?: string; unit?: string }>,
	servings = 4,
) {
	return {
		id,
		title,
		description: null,
		servings,
		prepTime: null,
		cookTime: null,
		isFavorite: false,
		sourceUrl: null,
		rawText: null,
		notes: null,
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

function makeEntry(
	recipe: ReturnType<typeof makeRecipe>,
	date: Date,
	mealType: string,
	servings: number | null = null,
): PrepEntry {
	return { recipe, servings, date, mealType }
}

const monday = new Date('2026-02-09')
const tuesday = new Date('2026-02-10')
const wednesday = new Date('2026-02-11')

describe('generatePrepList', () => {
	test('shared ingredients produce prep items', () => {
		const stirFry = makeRecipe('r1', 'Stir Fry', [
			{ name: 'garlic', amount: '3', unit: 'cloves' },
			{ name: 'soy sauce', amount: '2', unit: 'tbsp' },
		])
		const pasta = makeRecipe('r2', 'Pasta', [
			{ name: 'garlic', amount: '2', unit: 'cloves' },
			{ name: 'parmesan', amount: '1', unit: 'cup' },
		])
		const soup = makeRecipe('r3', 'Soup', [
			{ name: 'garlic', amount: '4', unit: 'cloves' },
			{ name: 'carrots', amount: '2', unit: 'cups' },
		])

		const entries = [
			makeEntry(stirFry, monday, 'dinner'),
			makeEntry(pasta, tuesday, 'dinner'),
			makeEntry(soup, wednesday, 'lunch'),
		]

		const items = generatePrepList(entries)

		expect(items).toHaveLength(1)
		expect(items[0]!.canonicalName).toBe('garlic')
		expect(items[0]!.usedIn).toHaveLength(3)
		expect(items[0]!.totalQuantity).toBe('9')
		expect(items[0]!.totalUnit).toBe('cloves')
	})

	test('single-use ingredients are excluded', () => {
		const stirFry = makeRecipe('r1', 'Stir Fry', [
			{ name: 'garlic', amount: '3', unit: 'cloves' },
			{ name: 'soy sauce', amount: '2', unit: 'tbsp' },
		])
		const pasta = makeRecipe('r2', 'Pasta', [
			{ name: 'garlic', amount: '2', unit: 'cloves' },
			{ name: 'parsley', amount: '1', unit: 'bunch' },
		])

		const entries = [
			makeEntry(stirFry, monday, 'dinner'),
			makeEntry(pasta, tuesday, 'dinner'),
		]

		const items = generatePrepList(entries)

		// Only garlic is shared; soy sauce and parsley are single-use
		expect(items).toHaveLength(1)
		expect(items[0]!.canonicalName).toBe('garlic')
	})

	test('staples are excluded', () => {
		const r1 = makeRecipe('r1', 'Recipe 1', [
			{ name: 'salt', amount: '1', unit: 'tsp' },
			{ name: 'black pepper', amount: '1/2', unit: 'tsp' },
			{ name: 'onion', amount: '1', unit: '' },
		])
		const r2 = makeRecipe('r2', 'Recipe 2', [
			{ name: 'salt', amount: '2', unit: 'tsp' },
			{ name: 'pepper', amount: '1', unit: 'tsp' },
			{ name: 'onion', amount: '2', unit: '' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
		]

		const items = generatePrepList(entries)

		// Only onion is shared and non-staple
		expect(items).toHaveLength(1)
		expect(items[0]!.canonicalName).toBe('onion')
	})

	test('synonyms are consolidated', () => {
		const r1 = makeRecipe('r1', 'Mexican Bowl', [
			{ name: 'cilantro', amount: '1', unit: 'bunch' },
		])
		const r2 = makeRecipe('r2', 'Thai Curry', [
			{ name: 'coriander', amount: '1', unit: 'bunch' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
		]

		const items = generatePrepList(entries)

		expect(items).toHaveLength(1)
		expect(items[0]!.totalQuantity).toBe('2')
		expect(items[0]!.usedIn).toHaveLength(2)
	})

	test('quantities are aggregated correctly', () => {
		const r1 = makeRecipe('r1', 'Stir Fry', [
			{ name: 'garlic', amount: '2', unit: 'cloves' },
		])
		const r2 = makeRecipe('r2', 'Pasta', [
			{ name: 'garlic', amount: '3', unit: 'cloves' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
		]

		const items = generatePrepList(entries)

		expect(items[0]!.totalQuantity).toBe('5')
		expect(items[0]!.totalUnit).toBe('cloves')
	})

	test('serving scaling is applied', () => {
		const r1 = makeRecipe(
			'r1',
			'Stir Fry',
			[{ name: 'garlic', amount: '2', unit: 'cloves' }],
			4,
		)
		const r2 = makeRecipe(
			'r2',
			'Pasta',
			[{ name: 'garlic', amount: '2', unit: 'cloves' }],
			4,
		)

		const entries = [
			makeEntry(r1, monday, 'dinner', 8), // doubled
			makeEntry(r2, tuesday, 'dinner', 2), // halved
		]

		const items = generatePrepList(entries)

		// r1: 2 cloves * (8/4) = 4 cloves, r2: 2 cloves * (2/4) = 1 clove → total 5
		expect(items[0]!.totalQuantity).toBe('5')
		expect(items[0]!.usedIn[0]!.quantity).toBe('4')
		expect(items[0]!.usedIn[1]!.quantity).toBe('1')
	})

	test('recipe attribution includes correct date and mealType', () => {
		const r1 = makeRecipe('r1', 'Stir Fry', [
			{ name: 'onion', amount: '1', unit: '' },
		])
		const r2 = makeRecipe('r2', 'Soup', [
			{ name: 'onion', amount: '2', unit: '' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'lunch'),
		]

		const items = generatePrepList(entries)

		expect(items[0]!.usedIn[0]!.recipeTitle).toBe('Stir Fry')
		expect(items[0]!.usedIn[0]!.date).toEqual(monday)
		expect(items[0]!.usedIn[0]!.mealType).toBe('dinner')
		expect(items[0]!.usedIn[1]!.recipeTitle).toBe('Soup')
		expect(items[0]!.usedIn[1]!.date).toEqual(tuesday)
		expect(items[0]!.usedIn[1]!.mealType).toBe('lunch')
	})

	test('empty entries returns empty list', () => {
		expect(generatePrepList([])).toEqual([])
	})

	test('single entry returns empty list (no shared ingredients possible)', () => {
		const r1 = makeRecipe('r1', 'Stir Fry', [
			{ name: 'garlic', amount: '3', unit: 'cloves' },
			{ name: 'onion', amount: '1', unit: '' },
		])

		const items = generatePrepList([makeEntry(r1, monday, 'dinner')])

		expect(items).toEqual([])
	})

	test('all staples yields empty list', () => {
		const r1 = makeRecipe('r1', 'Recipe 1', [
			{ name: 'salt', amount: '1', unit: 'tsp' },
			{ name: 'olive oil', amount: '1', unit: 'tbsp' },
		])
		const r2 = makeRecipe('r2', 'Recipe 2', [
			{ name: 'salt', amount: '2', unit: 'tsp' },
			{ name: 'olive oil', amount: '2', unit: 'tbsp' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
		]

		expect(generatePrepList(entries)).toEqual([])
	})

	test('sorted by number of usages (most-shared first)', () => {
		const r1 = makeRecipe('r1', 'Recipe A', [
			{ name: 'garlic', amount: '1', unit: 'cloves' },
			{ name: 'onion', amount: '1', unit: '' },
		])
		const r2 = makeRecipe('r2', 'Recipe B', [
			{ name: 'garlic', amount: '1', unit: 'cloves' },
			{ name: 'onion', amount: '1', unit: '' },
		])
		const r3 = makeRecipe('r3', 'Recipe C', [
			{ name: 'garlic', amount: '1', unit: 'cloves' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
			makeEntry(r3, wednesday, 'dinner'),
		]

		const items = generatePrepList(entries)

		// garlic used in 3 recipes, onion in 2
		expect(items[0]!.canonicalName).toBe('garlic')
		expect(items[1]!.canonicalName).toBe('onion')
	})

	test('same recipe in multiple slots counts usages but still requires 2+ distinct recipes', () => {
		const r1 = makeRecipe('r1', 'Stir Fry', [
			{ name: 'garlic', amount: '2', unit: 'cloves' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r1, tuesday, 'dinner'),
		]

		const items = generatePrepList(entries)

		// garlic only appears in 1 distinct recipe, so no prep items
		expect(items).toEqual([])
	})

	test('handles ingredients without amounts', () => {
		const r1 = makeRecipe('r1', 'Recipe A', [
			{ name: 'garlic' },
		])
		const r2 = makeRecipe('r2', 'Recipe B', [
			{ name: 'garlic' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
		]

		const items = generatePrepList(entries)

		expect(items).toHaveLength(1)
		// consolidateQuantities returns count when amounts aren't parseable
		expect(items[0]!.totalQuantity).toBe('2×')
	})
})
