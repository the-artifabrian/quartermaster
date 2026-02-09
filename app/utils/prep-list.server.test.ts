import { describe, expect, test } from 'vitest'
import {
	generatePrepList,
	extractPrepMethod,
	type PrepEntry,
} from './prep-list.server.ts'

function makeRecipe(
	id: string,
	title: string,
	ingredients: Array<{
		name: string
		amount?: string
		unit?: string
		notes?: string
	}>,
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
		householdId: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		userId: 'user-1',
		ingredients: ingredients.map((ing, i) => ({
			id: `ing-${id}-${i}`,
			name: ing.name,
			amount: ing.amount ?? null,
			unit: ing.unit ?? null,
			notes: ing.notes ?? null,
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

describe('extractPrepMethod', () => {
	test('returns null for null notes', () => {
		expect(extractPrepMethod(null)).toBeNull()
	})

	test('returns null for non-prep notes', () => {
		expect(extractPrepMethod('room temperature')).toBeNull()
		expect(extractPrepMethod('to taste')).toBeNull()
	})

	test('extracts single-word prep methods', () => {
		expect(extractPrepMethod('minced')).toBe('Minced')
		expect(extractPrepMethod('diced')).toBe('Diced')
		expect(extractPrepMethod('sliced')).toBe('Sliced')
		expect(extractPrepMethod('chopped')).toBe('Chopped')
		expect(extractPrepMethod('grated')).toBe('Grated')
		expect(extractPrepMethod('crushed')).toBe('Crushed')
		expect(extractPrepMethod('peeled')).toBe('Peeled')
		expect(extractPrepMethod('zested')).toBe('Zested')
		expect(extractPrepMethod('shredded')).toBe('Shredded')
	})

	test('extracts multi-word prep methods first', () => {
		expect(extractPrepMethod('thinly sliced')).toBe('Thinly sliced')
		expect(extractPrepMethod('finely chopped')).toBe('Finely chopped')
		expect(extractPrepMethod('finely diced')).toBe('Finely diced')
		expect(extractPrepMethod('roughly chopped')).toBe('Roughly chopped')
	})

	test('extracts prep method from longer notes', () => {
		// "diced" appears before "peeled" in the pattern priority list
		expect(extractPrepMethod('peeled and diced into 1-inch cubes')).toBe(
			'Diced',
		)
		expect(extractPrepMethod('about 3 cloves, minced')).toBe('Minced')
	})
})

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

	test('non-preppable ingredients are excluded', () => {
		const r1 = makeRecipe('r1', 'Stir Fry', [
			{ name: 'garlic', amount: '3', unit: 'cloves' },
			{ name: 'soy sauce', amount: '2', unit: 'tbsp' },
			{ name: 'sesame oil', amount: '1', unit: 'tsp' },
			{ name: 'rice vinegar', amount: '1', unit: 'tbsp' },
			{ name: 'sugar', amount: '1', unit: 'tsp' },
		])
		const r2 = makeRecipe('r2', 'Fried Rice', [
			{ name: 'garlic', amount: '2', unit: 'cloves' },
			{ name: 'soy sauce', amount: '3', unit: 'tbsp' },
			{ name: 'sesame oil', amount: '1', unit: 'tsp' },
			{ name: 'rice vinegar', amount: '2', unit: 'tbsp' },
			{ name: 'sugar', amount: '2', unit: 'tsp' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
		]

		const items = generatePrepList(entries)

		// Only garlic should appear — soy sauce, sesame oil, rice vinegar,
		// and sugar are all non-preppable (just measured/poured)
		expect(items).toHaveLength(1)
		expect(items[0]!.canonicalName).toBe('garlic')
	})

	test('sesame seeds are filtered as non-preppable', () => {
		const r1 = makeRecipe('r1', 'Stir Fry', [
			{ name: 'sesame seeds', amount: '1', unit: 'tbsp' },
			{ name: 'garlic', amount: '2', unit: 'cloves' },
		])
		const r2 = makeRecipe('r2', 'Noodles', [
			{ name: 'sesame seeds', amount: '2', unit: 'tbsp' },
			{ name: 'garlic', amount: '3', unit: 'cloves' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
		]

		const items = generatePrepList(entries)

		expect(items).toHaveLength(1)
		expect(items[0]!.canonicalName).toBe('garlic')
	})

	test('smoked paprika is filtered (smoked stripped → paprika → non-preppable)', () => {
		const r1 = makeRecipe('r1', 'Recipe A', [
			{ name: 'smoked paprika', amount: '1', unit: 'tsp' },
			{ name: 'onion', amount: '1', unit: '' },
		])
		const r2 = makeRecipe('r2', 'Recipe B', [
			{ name: 'smoked paprika', amount: '2', unit: 'tsp' },
			{ name: 'onion', amount: '1', unit: '' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
		]

		const items = generatePrepList(entries)

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

	test('"of garlic" consolidates with "garlic"', () => {
		const r1 = makeRecipe('r1', 'Recipe A', [
			{ name: 'of garlic', amount: '3', unit: 'cloves' },
		])
		const r2 = makeRecipe('r2', 'Recipe B', [
			{ name: 'garlic', amount: '2', unit: 'cloves' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
		]

		const items = generatePrepList(entries)

		expect(items).toHaveLength(1)
		expect(items[0]!.totalQuantity).toBe('5')
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
		const r1 = makeRecipe('r1', 'Recipe A', [{ name: 'garlic' }])
		const r2 = makeRecipe('r2', 'Recipe B', [{ name: 'garlic' }])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
		]

		const items = generatePrepList(entries)

		expect(items).toHaveLength(1)
		// consolidateQuantities returns count when amounts aren't parseable
		expect(items[0]!.totalQuantity).toBe('2×')
	})

	test('prep methods grouped from notes', () => {
		const r1 = makeRecipe('r1', 'Stir Fry', [
			{ name: 'garlic', amount: '5', unit: 'cloves', notes: 'minced' },
		])
		const r2 = makeRecipe('r2', 'Fried Rice', [
			{ name: 'garlic', amount: '2', unit: 'cloves', notes: 'sliced' },
		])
		const r3 = makeRecipe('r3', 'Kebab', [
			{ name: 'garlic', amount: '6', unit: 'cloves' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
			makeEntry(r3, wednesday, 'dinner'),
		]

		const items = generatePrepList(entries)

		expect(items).toHaveLength(1)
		const methods = items[0]!.prepMethods
		expect(methods).toHaveLength(3)

		const minced = methods.find((m) => m.method === 'Minced')
		expect(minced).toBeDefined()
		expect(minced!.totalQuantity).toBe('5')
		expect(minced!.recipes).toEqual(['Stir Fry'])

		const sliced = methods.find((m) => m.method === 'Sliced')
		expect(sliced).toBeDefined()
		expect(sliced!.totalQuantity).toBe('2')
		expect(sliced!.recipes).toEqual(['Fried Rice'])

		const whole = methods.find((m) => m.method === 'Whole')
		expect(whole).toBeDefined()
		expect(whole!.totalQuantity).toBe('6')
		expect(whole!.recipes).toEqual(['Kebab'])
	})

	test('prep methods deduplicate recipe titles within group', () => {
		const r1 = makeRecipe('r1', 'Stir Fry', [
			{ name: 'garlic', amount: '3', unit: 'cloves', notes: 'minced' },
		])
		const r2 = makeRecipe('r2', 'Pasta', [
			{ name: 'garlic', amount: '2', unit: 'cloves', notes: 'minced' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
		]

		const items = generatePrepList(entries)
		const minced = items[0]!.prepMethods.find((m) => m.method === 'Minced')
		expect(minced!.totalQuantity).toBe('5')
		expect(minced!.recipes).toEqual(['Stir Fry', 'Pasta'])
	})

	test('storage tip present for known ingredients', () => {
		const r1 = makeRecipe('r1', 'Recipe A', [
			{ name: 'garlic', amount: '2', unit: 'cloves' },
		])
		const r2 = makeRecipe('r2', 'Recipe B', [
			{ name: 'garlic', amount: '3', unit: 'cloves' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
		]

		const items = generatePrepList(entries)

		expect(items[0]!.storageTip).toBe(
			'Airtight container in fridge, up to 3 days',
		)
	})

	test('storage tip null for unknown ingredients', () => {
		const r1 = makeRecipe('r1', 'Recipe A', [
			{ name: 'jicama', amount: '1', unit: '' },
		])
		const r2 = makeRecipe('r2', 'Recipe B', [
			{ name: 'jicama', amount: '1', unit: '' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
		]

		const items = generatePrepList(entries)

		expect(items[0]!.storageTip).toBeNull()
	})

	test('notes are passed through to usages', () => {
		const r1 = makeRecipe('r1', 'Recipe A', [
			{ name: 'garlic', amount: '2', unit: 'cloves', notes: 'minced' },
		])
		const r2 = makeRecipe('r2', 'Recipe B', [
			{ name: 'garlic', amount: '3', unit: 'cloves', notes: 'sliced' },
		])

		const entries = [
			makeEntry(r1, monday, 'dinner'),
			makeEntry(r2, tuesday, 'dinner'),
		]

		const items = generatePrepList(entries)

		expect(items[0]!.usedIn[0]!.notes).toBe('minced')
		expect(items[0]!.usedIn[1]!.notes).toBe('sliced')
	})
})
