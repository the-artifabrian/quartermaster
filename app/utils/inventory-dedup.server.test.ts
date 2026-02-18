import { describe, expect, test } from 'vitest'
import { findMatchingInventoryItem, buildMergeData } from './inventory-dedup.server.ts'

function makeItem(
	overrides: Partial<{
		id: string
		name: string
		location: string
		quantity: number | null
		unit: string | null
		expiresAt: Date | null
	}> = {},
) {
	return {
		id: overrides.id ?? 'item-1',
		name: overrides.name ?? 'Chicken Breast',
		location: overrides.location ?? 'fridge',
		quantity: overrides.quantity ?? null,
		unit: overrides.unit ?? null,
		expiresAt: overrides.expiresAt ?? null,
	}
}

describe('findMatchingInventoryItem', () => {
	test('exact match (same case)', () => {
		const items = [makeItem({ name: 'Chicken Breast' })]
		const result = findMatchingInventoryItem('Chicken Breast', 'fridge', items)
		expect(result).toBe(items[0])
	})

	test('case-insensitive match', () => {
		const items = [makeItem({ name: 'Chicken Breast' })]
		const result = findMatchingInventoryItem('chicken breast', 'fridge', items)
		expect(result).toBe(items[0])
	})

	test('synonym match (cilantro → coriander)', () => {
		const items = [makeItem({ name: 'cilantro', location: 'fridge' })]
		const result = findMatchingInventoryItem('coriander', 'fridge', items)
		expect(result).toBe(items[0])
	})

	test('modifier-stripped match (fresh chicken breast → chicken breast)', () => {
		const items = [makeItem({ name: 'Chicken Breast' })]
		const result = findMatchingInventoryItem(
			'fresh chicken breast',
			'fridge',
			items,
		)
		expect(result).toBe(items[0])
	})

	test('modifier-stripped match (boneless chicken breast → chicken breast)', () => {
		const items = [makeItem({ name: 'Chicken Breast' })]
		const result = findMatchingInventoryItem(
			'boneless chicken breast',
			'fridge',
			items,
		)
		expect(result).toBe(items[0])
	})

	test('different location returns null', () => {
		const items = [makeItem({ name: 'Chicken Breast', location: 'fridge' })]
		const result = findMatchingInventoryItem(
			'Chicken Breast',
			'freezer',
			items,
		)
		expect(result).toBeNull()
	})

	test('no match returns null', () => {
		const items = [makeItem({ name: 'Chicken Breast' })]
		const result = findMatchingInventoryItem('Milk', 'fridge', items)
		expect(result).toBeNull()
	})

	test('empty items list returns null', () => {
		const result = findMatchingInventoryItem('Chicken Breast', 'fridge', [])
		expect(result).toBeNull()
	})

	test('pluralization match (tomato → tomatoes)', () => {
		const items = [makeItem({ name: 'tomatoes', location: 'fridge' })]
		const result = findMatchingInventoryItem('tomato', 'fridge', items)
		expect(result).toBe(items[0])
	})

	test('returns first match when multiple exist', () => {
		const items = [
			makeItem({ id: 'item-1', name: 'Chicken Breast' }),
			makeItem({ id: 'item-2', name: 'chicken breast' }),
		]
		const result = findMatchingInventoryItem('Chicken Breast', 'fridge', items)
		expect(result?.id).toBe('item-1')
	})
})

describe('buildMergeData', () => {
	test('adds quantities with same unit', () => {
		const existing = makeItem({ quantity: 2, unit: 'lbs' })
		const result = buildMergeData(existing, 3, 'lbs', null)
		expect(result.quantity).toBe(5)
	})

	test('adds quantities with no unit', () => {
		const existing = makeItem({ quantity: 2, unit: null })
		const result = buildMergeData(existing, 3, null, null)
		expect(result.quantity).toBe(5)
	})

	test('converts compatible units (oz + lb)', () => {
		const existing = makeItem({ quantity: 1, unit: 'lb' })
		const result = buildMergeData(existing, 8, 'oz', null)
		// 8 oz = 0.5 lb, so total = 1.5 lb
		expect(result.quantity).toBe(1.5)
	})

	test('converts compatible volume units (cup + tbsp)', () => {
		const existing = makeItem({ quantity: 1, unit: 'cup' })
		const result = buildMergeData(existing, 4, 'tbsp', null)
		// 4 tbsp ≈ 0.25 cup, so total ≈ 1.25 cup
		expect(result.quantity).toBeCloseTo(1.25, 1)
	})

	test('adds quantities with incompatible units', () => {
		const existing = makeItem({ quantity: 2, unit: 'lbs' })
		const result = buildMergeData(existing, 3, 'cups', null)
		// Incompatible (weight vs volume) — just adds numerically
		expect(result.quantity).toBe(5)
	})

	test('sets quantity when existing has none', () => {
		const existing = makeItem({ quantity: null, unit: null })
		const result = buildMergeData(existing, 2, 'lbs', null)
		expect(result.quantity).toBe(2)
		expect(result.unit).toBe('lbs')
	})

	test('no-op when new quantity is null', () => {
		const existing = makeItem({ quantity: 2, unit: 'lbs' })
		const result = buildMergeData(existing, null, null, null)
		expect(result.quantity).toBeUndefined()
	})

	test('picks later expiry date (new is later)', () => {
		const existing = makeItem({
			expiresAt: new Date('2025-03-01'),
		})
		const newExpiry = new Date('2025-04-01')
		const result = buildMergeData(existing, null, null, newExpiry)
		expect(result.expiresAt).toEqual(newExpiry)
	})

	test('keeps existing expiry when it is later', () => {
		const existing = makeItem({
			expiresAt: new Date('2025-04-01'),
		})
		const newExpiry = new Date('2025-03-01')
		const result = buildMergeData(existing, null, null, newExpiry)
		expect(result.expiresAt).toBeUndefined()
	})

	test('sets expiry when existing has none', () => {
		const existing = makeItem({ expiresAt: null })
		const newExpiry = new Date('2025-04-01')
		const result = buildMergeData(existing, null, null, newExpiry)
		expect(result.expiresAt).toEqual(newExpiry)
	})

	test('returns empty object when nothing to merge', () => {
		const existing = makeItem({ quantity: 2, unit: 'lbs' })
		const result = buildMergeData(existing, null, null, null)
		expect(Object.keys(result)).toHaveLength(0)
	})

	test('clears lowStock when adding quantity', () => {
		const existing = makeItem({ quantity: 1, unit: 'lbs' })
		const result = buildMergeData(existing, 2, 'lbs', null)
		expect(result.lowStock).toBe(false)
	})

	test('handles unit aliases (pounds → lb)', () => {
		const existing = makeItem({ quantity: 1, unit: 'pounds' })
		const result = buildMergeData(existing, 2, 'lbs', null)
		expect(result.quantity).toBe(3)
	})
})
