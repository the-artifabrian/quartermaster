import { describe, expect, test } from 'vitest'
import {
	buildShoppingDemand,
	combineRowDisplay,
	type DemandIngredient,
} from './shopping-demand.server.ts'

function makeIngredients(
	ingredients: Array<{
		name: string
		amount?: string
		unit?: string
		isHeading?: boolean
		notes?: string
	}>,
): DemandIngredient[] {
	return ingredients.map((ing) => ({
		name: ing.name,
		amount: ing.amount ?? null,
		unit: ing.unit ?? null,
		isHeading: ing.isHeading ?? false,
		notes: ing.notes ?? null,
	}))
}

function batch(
	ingredients: Parameters<typeof makeIngredients>[0],
	scaleMultiplier?: number | null,
) {
	return { ingredients: makeIngredients(ingredients), scaleMultiplier }
}

describe('buildShoppingDemand — Recipe ingredient batches', () => {
	test('consolidates "Fresh Garlic" and "garlic, minced" into one line', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'Fresh Garlic', amount: '3', unit: 'cloves' }]),
				batch([{ name: 'garlic, minced', amount: '2', unit: 'cloves' }]),
			],
		})
		const garlic = lines.filter((line) =>
			line.name.toLowerCase().includes('garlic'),
		)

		expect(garlic).toHaveLength(1)
		expect(garlic[0]!.quantity).toBe('5')
		expect(garlic[0]!.unit).toBe('cloves')
	})

	test('consolidates "cilantro" and "coriander" as synonyms', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'cilantro', amount: '1', unit: 'bunch' }]),
				batch([{ name: 'coriander', amount: '1', unit: 'bunch' }]),
			],
		})
		const matches = lines.filter(
			(line) =>
				line.name.toLowerCase().includes('cilantro') ||
				line.name.toLowerCase().includes('coriander'),
		)

		expect(matches).toHaveLength(1)
		expect(matches[0]!.quantity).toBe('2')
	})

	test('sums quantities when units match', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'flour', amount: '2', unit: 'cups' }]),
				batch([{ name: 'Flour', amount: '1', unit: 'cups' }]),
			],
		})
		const flour = lines.filter((line) =>
			line.name.toLowerCase().includes('flour'),
		)

		expect(flour).toHaveLength(1)
		expect(flour[0]!.quantity).toBe('3')
		expect(flour[0]!.unit).toBe('cups')
	})

	test('metric sums scale up: 750g + 750g → 1.5 kg', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'flour', amount: '750', unit: 'g' }]),
				batch([{ name: 'flour', amount: '750', unit: 'g' }]),
			],
		})

		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('1.5')
		expect(lines[0]!.unit).toBe('kg')
	})

	test('metric sums below 1000 keep their unit', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'flour', amount: '400', unit: 'g' }]),
				batch([{ name: 'flour', amount: '500', unit: 'g' }]),
			],
		})

		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('900')
		expect(lines[0]!.unit).toBe('g')
	})

	test('ml sums scale up to L', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'vegetable stock', amount: '600', unit: 'ml' }]),
				batch([{ name: 'vegetable stock', amount: '600', unit: 'ml' }]),
			],
		})

		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('1.2')
		expect(lines[0]!.unit).toBe('L')
	})

	test('consolidates compatible units via conversion (tbsp + cup)', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'butter', amount: '2', unit: 'tbsp' }]),
				batch([{ name: 'butter', amount: '1', unit: 'cup' }]),
			],
		})

		expect(lines).toHaveLength(1)
		// 2 tbsp + 1 cup = 6 tsp + 48 tsp = 54 tsp = 1.125 cups
		expect(lines[0]!.unit).toBe('cup')
		expect(lines[0]!.quantity).toBe('1 1/8')
	})

	test('incompatible units stay visible as separate parts, never a count or false total', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'butter', amount: '2', unit: 'tbsp' }]),
				batch([{ name: 'butter', amount: '100', unit: 'g' }]),
			],
		})

		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('2 tbsp + 100 g')
		expect(lines[0]!.unit).toBeNull()
	})

	test('compatible parts sum and only the leftover stays a separate part', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'chicken', amount: '500', unit: 'g' }]),
				batch([{ name: 'chicken', amount: '300', unit: 'g' }]),
				batch([{ name: 'chicken', amount: '1', unit: 'cup' }]),
			],
		})

		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('800 g + 1 cup')
		expect(lines[0]!.unit).toBeNull()
	})

	test('a range is never summed — it stays a visible separate part', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'lemons', amount: '2' }]),
				batch([{ name: 'lemons', amount: '1-2' }]),
			],
		})

		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('2 + 1-2')
	})

	test('a lone range passes through verbatim', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [batch([{ name: 'green chilies', amount: '2-3' }])],
		})
		expect(lines[0]!.quantity).toBe('2-3')
	})

	test('a range scales end-by-end instead of collapsing to one end', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [batch([{ name: 'green chilies', amount: '2-3' }], 2)],
		})
		expect(lines[0]!.quantity).toBe('4-6')
	})

	test('"2 to 3" reads as a range too', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'shallots', amount: '2 to 3' }], 2),
				batch([{ name: 'shallots', amount: '1' }]),
			],
		})
		expect(lines).toHaveLength(1)
		// Parts keep first-appearance order — the range batch came first.
		expect(lines[0]!.quantity).toBe('4-6 + 1')
	})

	test('an amountless duplicate adds no quantitative information', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'parsley', amount: '1', unit: 'bunch' }]),
				batch([{ name: 'parsley' }]),
			],
		})
		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('1')
		expect(lines[0]!.unit).toBe('bunch')
	})

	test('count-like units fold into plain counts', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'eggs', amount: '2' }]),
				batch([{ name: 'eggs', amount: '1', unit: 'piece' }]),
			],
		})
		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('3')
		expect(lines[0]!.unit).toBeNull()
	})

	test('treats different ingredients as separate lines', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([
					{ name: 'chicken breast', amount: '2', unit: 'lbs' },
					{ name: 'rice', amount: '1', unit: 'cup' },
				]),
			],
		})
		expect(lines).toHaveLength(2)
	})

	test('every line carries its normalized demand identity', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'Fresh Garlic', amount: '3', unit: 'cloves' }]),
			],
		})
		expect(lines[0]!.canonicalName).toBeTruthy()
		// Same canonical identity as its consolidation partner would get.
		const partner = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'garlic, minced', amount: '2', unit: 'cloves' }]),
			],
		})
		expect(lines[0]!.canonicalName).toBe(partner[0]!.canonicalName)
	})

	test('a name that defeats canonicalization keeps its own identity instead of an empty one', () => {
		// normalizeIngredientName('medium/small peaches') is '' — unrelated
		// ingredients must not collapse into one shared empty identity.
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([
					{ name: 'medium/small peaches', amount: '3' },
					{ name: 'red/green chilies', amount: '2' },
				]),
			],
		})
		expect(lines).toHaveLength(2)
		expect(lines.map((line) => line.canonicalName).sort()).toEqual([
			'medium/small peaches',
			'red/green chilies',
		])
	})

	test('scales ingredients by the stored batch multiplier', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [batch([{ name: 'flour', amount: '2', unit: 'cups' }], 2)],
		})
		expect(lines[0]!.quantity).toBe('4')
	})

	test('scales down by a fractional multiplier', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'flour', amount: '2', unit: 'cups' }], 0.5),
			],
		})
		expect(lines[0]!.quantity).toBe('1')
	})

	test('no scaling when the multiplier is absent', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'flour', amount: '2', unit: 'cups' }], null),
			],
		})
		expect(lines[0]!.quantity).toBe('2')
	})

	test('a non-positive multiplier falls back to one batch', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [batch([{ name: 'flour', amount: '2', unit: 'cups' }], 0)],
		})
		expect(lines[0]!.quantity).toBe('2')
	})

	test('an amountless ingredient is preserved, not dropped', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [batch([{ name: 'fresh basil leaves' }], 2)],
		})
		expect(lines).toHaveLength(1)
		expect(lines[0]!.name).toBe('fresh basil leaves')
		expect(lines[0]!.quantity).toBeNull()
	})

	test('an unparseable amount passes through unresolved instead of becoming a false total', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'chili flakes', amount: 'a generous pinch' }]),
			],
		})
		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('a generous pinch')
	})

	test('skips heading rows and heading-looking names', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([
					{ name: 'For the sauce:', isHeading: true },
					{ name: 'Marinade' },
					{ name: 'soy sauce', amount: '2', unit: 'tbsp' },
				]),
			],
		})
		expect(lines.map((line) => line.name)).toEqual(['soy sauce'])
	})

	test('skips optional ingredients (current explicit exclusion behavior)', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([
					{ name: 'sesame seeds', notes: 'optional' },
					{ name: 'scallions (optional)', amount: '2' },
					{ name: 'tofu', amount: '200', unit: 'g' },
				]),
			],
		})
		expect(lines.map((line) => line.name)).toEqual(['tofu'])
	})

	test('re-parses ingredients with amount baked into name', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [batch([{ name: '1 (14.5 oz) can crushed tomatoes' }])],
		})
		const tomato = lines.find((line) =>
			line.name.toLowerCase().includes('tomato'),
		)!
		expect(tomato.name).toBe('crushed tomatoes')
		expect(tomato.quantity).toBe('1')
		expect(tomato.unit).toBe('can')
	})

	test('re-parses "2 cups flour" baked into name', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [batch([{ name: '2 cups flour' }])],
		})
		const flour = lines.find((line) =>
			line.name.toLowerCase().includes('flour'),
		)!
		expect(flour.name).toBe('flour')
		expect(flour.quantity).toBe('2')
		expect(flour.unit).toBe('cups')
	})

	test('does NOT re-parse when amount is already set', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'crushed tomatoes', amount: '1', unit: 'can' }]),
			],
		})
		expect(lines[0]!.name).toBe('crushed tomatoes')
		expect(lines[0]!.quantity).toBe('1')
	})

	test('strips leading "of " from display name', () => {
		// parseIngredient("1 stalk of celery") → name="of celery"
		const lines = buildShoppingDemand({
			recipeBatches: [batch([{ name: '1 stalk of celery' }])],
		})
		expect(lines[0]!.name).toBe('celery')
	})

	test('re-parsed lines consolidate with properly-parsed ones', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: '2 cups flour' }]),
				batch([{ name: 'flour', amount: '1', unit: 'cups' }]),
			],
		})
		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('3')
	})

	test('scaling works on re-parsed ingredients', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [batch([{ name: '2 cups flour' }], 2)],
		})
		expect(lines[0]!.quantity).toBe('4')
	})

	test('duplicate ingredients within one Recipe consolidate too', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([
					{ name: 'butter', amount: '2', unit: 'tbsp' },
					{ name: 'butter', amount: '1', unit: 'tbsp' },
				]),
			],
		})
		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('3')
	})
})

describe('buildShoppingDemand — ordinary note Shopping lines', () => {
	test('note lines pass through trimmed with their free-text quantity/unit', () => {
		const lines = buildShoppingDemand({
			noteLines: [
				{ name: '  pita bread ', quantity: ' 12 ', unit: ' pieces ' },
			],
		})
		expect(lines).toEqual([
			{
				name: 'pita bread',
				canonicalName: expect.any(String),
				quantity: '12',
				unit: 'pieces',
				category: expect.any(String),
				fromNote: true,
			},
		])
	})

	test('recipe-only lines carry no note marker', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [batch([{ name: 'hummus', amount: '400', unit: 'g' }])],
		})
		expect(lines[0]!.fromNote).toBeUndefined()
	})

	test('unresolved free text is preserved as given', () => {
		const lines = buildShoppingDemand({
			noteLines: [{ name: 'something nice for dessert' }],
		})
		expect(lines).toHaveLength(1)
		expect(lines[0]!.name).toBe('something nice for dessert')
		expect(lines[0]!.quantity).toBeNull()
		expect(lines[0]!.unit).toBeNull()
	})

	test('empty and whitespace-only names are dropped', () => {
		const lines = buildShoppingDemand({
			noteLines: [{ name: '' }, { name: '   ' }, { name: 'candles' }],
		})
		expect(lines.map((line) => line.name)).toEqual(['candles'])
	})

	test('compatible note lines merge deterministically (#109)', () => {
		const lines = buildShoppingDemand({
			noteLines: [
				{ name: 'wine', quantity: '2', unit: 'bottles' },
				{ name: 'wine', quantity: '1', unit: 'bottle' },
			],
		})
		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('3')
		expect(lines[0]!.unit).toBe('bottles')
	})

	test('incompatible note demand stays visible, never a false total', () => {
		const lines = buildShoppingDemand({
			noteLines: [
				{ name: 'wine', quantity: '2', unit: 'bottles' },
				{ name: 'wine', quantity: '750', unit: 'ml' },
			],
		})
		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('2 bottles + 750 ml')
		expect(lines[0]!.unit).toBeNull()
	})

	test('unresolved note free text survives a merge as a visible part', () => {
		const lines = buildShoppingDemand({
			noteLines: [
				{ name: 'olives', quantity: '200', unit: 'g' },
				{ name: 'olives', quantity: 'a good handful' },
			],
		})
		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('200 g + a good handful')
	})

	test('a note line and a Recipe ingredient for the same thing become one line', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [batch([{ name: 'hummus', amount: '400', unit: 'g' }])],
			noteLines: [{ name: 'hummus', quantity: '200', unit: 'g' }],
		})
		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('600')
		expect(lines[0]!.unit).toBe('g')
		expect(lines[0]!.fromNote).toBe(true)
	})

	test('note identity falls back to trimmed-lowercase without canonical ingredients', () => {
		const lines = buildShoppingDemand({
			noteLines: [
				{ name: 'Birthday candles', quantity: '1', unit: 'pack' },
				{ name: 'birthday candles ', quantity: '1', unit: 'pack' },
			],
		})
		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('2')
		expect(lines[0]!.unit).toBe('pack')
	})

	test('recipe batches and note lines combine in one call', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [batch([{ name: 'hummus', amount: '400', unit: 'g' }])],
			noteLines: [{ name: 'pita bread', quantity: '12' }],
		})
		expect(lines.map((line) => line.name).sort()).toEqual([
			'hummus',
			'pita bread',
		])
	})
})

describe('combineRowDisplay — grouped display without rewriting identities (#109)', () => {
	test('a row without contributions displays itself', () => {
		expect(
			combineRowDisplay({
				source: 'manual',
				quantity: '1',
				unit: 'kg',
				contributions: [],
			}),
		).toEqual({ quantity: '1', unit: 'kg', combined: false })
	})

	test('a compatible manual row and generated contribution display one combined total', () => {
		expect(
			combineRowDisplay({
				source: 'manual',
				quantity: '1',
				unit: 'kg',
				contributions: [{ quantity: '500', unit: 'g' }],
			}),
		).toEqual({ quantity: '1.5', unit: 'kg', combined: true })
	})

	test('incompatible manual and generated demand stays visibly separate', () => {
		expect(
			combineRowDisplay({
				source: 'manual',
				quantity: '1',
				unit: 'pack',
				contributions: [{ quantity: '500', unit: 'g' }],
			}),
		).toEqual({ quantity: '1 pack + 500 g', unit: null, combined: true })
	})

	test('an amountless manual row displays the generated demand', () => {
		expect(
			combineRowDisplay({
				source: 'manual',
				quantity: null,
				unit: null,
				contributions: [{ quantity: '500', unit: 'g' }],
			}),
		).toEqual({ quantity: '500', unit: 'g', combined: true })
	})

	test('a meal-born row sums its contributions without double-counting its own seeded quantity', () => {
		// The row's stored quantity duplicates the first contribution — the
		// display is the contributions alone.
		expect(
			combineRowDisplay({
				source: 'meal',
				quantity: '500',
				unit: 'g',
				contributions: [
					{ quantity: '500', unit: 'g' },
					{ quantity: '300', unit: 'g' },
				],
			}),
		).toEqual({ quantity: '800', unit: 'g', combined: true })
	})

	test('a meal-born row with one contribution reads exactly as itself', () => {
		expect(
			combineRowDisplay({
				source: 'meal',
				quantity: '500',
				unit: 'g',
				contributions: [{ quantity: '500', unit: 'g' }],
			}),
		).toEqual({ quantity: '500', unit: 'g', combined: false })
	})

	test('a week-generated row keeps its own quantity — its value may already include the same demand', () => {
		expect(
			combineRowDisplay({
				source: 'generated',
				quantity: '800',
				unit: 'g',
				contributions: [{ quantity: '500', unit: 'g' }],
			}),
		).toEqual({ quantity: '800', unit: 'g', combined: false })
	})
})

describe('the canonical Levantine Meal (#109)', () => {
	// Mirrors the dev DB's 'Levantine Feast' Menu: several Recipes at accepted
	// multipliers plus a note card's ordinary Shopping lines. The acceptance
	// bar is one comprehensible combined list: shared ingredients merge into
	// honest totals, everything unresolvable stays visible.
	const hummus = batch(
		[
			{ name: 'chickpeas', amount: '400', unit: 'g' },
			{ name: 'tahini', amount: '4', unit: 'tbsp' },
			{ name: 'lemons', amount: '1' },
			{ name: 'garlic', amount: '2', unit: 'cloves' },
			{ name: 'olive oil', amount: '3', unit: 'tbsp' },
		],
		2,
	)
	const fattoush = batch([
		{ name: 'For the salad:', isHeading: true },
		{ name: 'romaine lettuce', amount: '1', unit: 'head' },
		{ name: 'lemons', amount: '1-2' },
		{ name: 'garlic', amount: '1', unit: 'clove' },
		{ name: 'olive oil', amount: '60', unit: 'ml' },
		{ name: 'sumac', amount: 'a generous pinch' },
		{ name: 'pomegranate seeds', notes: 'optional' },
	])
	const kofta = batch(
		[
			{ name: 'ground lamb', amount: '500', unit: 'g' },
			{ name: 'garlic', amount: '2', unit: 'cloves' },
			{ name: 'parsley', amount: '1', unit: 'bunch' },
		],
		1.5,
	)
	const noteLines = [
		{ name: 'pita bread', quantity: '12' },
		{ name: 'olives', quantity: '200', unit: 'g' },
		{ name: 'parsley', quantity: '1', unit: 'bunch' },
		{ name: 'candles' },
	]

	test('produces one comprehensible combined list', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [hummus, fattoush, kofta],
			noteLines,
		})

		const byName = new Map(lines.map((line) => [line.name, line]))

		// One line per distinct ingredient — nothing duplicated, heading and
		// optional rows excluded.
		expect(lines).toHaveLength(12)
		expect(byName.has('For the salad:')).toBe(false)
		expect(byName.has('pomegranate seeds')).toBe(false)

		// Multiplier scaling: hummus at 2×, kofta at 1.5×.
		expect(byName.get('chickpeas')!.quantity).toBe('800')
		expect(byName.get('ground lamb')!.quantity).toBe('750')

		// Canonical matching + compatible-unit summation across Recipes:
		// garlic 2×2 + 1 + 1.5×2 cloves = 8 cloves.
		expect(byName.get('garlic')!.quantity).toBe('8')
		// olive oil: 3 tbsp ×2 + 60 ml — same family, converted and summed
		// (conversion prefers the largest unit that appeared in the input).
		expect(byName.get('olive oil')!.quantity).toBe('10.06')
		expect(byName.get('olive oil')!.unit).toBe('tbsp')

		// A range never sums: 2 whole lemons + "1-2" stay visible apart.
		expect(byName.get('lemons')!.quantity).toBe('2 + 1-2')

		// A note line merges with Recipe demand for the same ingredient:
		// kofta's 1 bunch ×1.5 + the note card's 1 bunch.
		expect(byName.get('parsley')!.quantity).toBe('2 1/2')
		expect(byName.get('parsley')!.unit).toBe('bunch')

		// Unresolved input stays visible instead of vanishing into a total.
		expect(byName.get('sumac')!.quantity).toBe('a generous pinch')
		expect(byName.get('candles')!.quantity).toBeNull()

		// Note-only lines pass through with their free text.
		expect(byName.get('pita bread')!.quantity).toBe('12')
		expect(byName.get('olives')!.quantity).toBe('200')
	})
})
