import { describe, expect, test } from 'vitest'
import {
	buildShoppingDemand,
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

	test('shows count when units are incompatible', () => {
		const lines = buildShoppingDemand({
			recipeBatches: [
				batch([{ name: 'butter', amount: '2', unit: 'tbsp' }]),
				batch([{ name: 'butter', amount: '100', unit: 'g' }]),
			],
		})

		expect(lines).toHaveLength(1)
		expect(lines[0]!.quantity).toBe('2×')
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
			},
		])
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

	test('note lines are never merged into false totals', () => {
		const lines = buildShoppingDemand({
			noteLines: [
				{ name: 'wine', quantity: '2', unit: 'bottles' },
				{ name: 'wine', quantity: '1', unit: 'bottle' },
			],
		})
		// Both preserved individually — richer aggregation is #109's job.
		expect(lines).toHaveLength(2)
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
