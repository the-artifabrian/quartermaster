import { describe, expect, test } from 'vitest'
import { findMatchingInventoryItem } from './inventory-dedup.server.ts'

function makeItem(
	overrides: Partial<{
		id: string
		name: string
	}> = {},
) {
	return {
		id: overrides.id ?? 'item-1',
		name: overrides.name ?? 'Chicken Breast',
	}
}

describe('findMatchingInventoryItem', () => {
	test('exact match (same case)', () => {
		const items = [makeItem({ name: 'Chicken Breast' })]
		const result = findMatchingInventoryItem('Chicken Breast', items)
		expect(result).toBe(items[0])
	})

	test('case-insensitive match', () => {
		const items = [makeItem({ name: 'Chicken Breast' })]
		const result = findMatchingInventoryItem('chicken breast', items)
		expect(result).toBe(items[0])
	})

	test('synonym match (cilantro → coriander)', () => {
		const items = [makeItem({ name: 'cilantro' })]
		const result = findMatchingInventoryItem('coriander', items)
		expect(result).toBe(items[0])
	})

	test('modifier-stripped match (fresh chicken breast → chicken breast)', () => {
		const items = [makeItem({ name: 'Chicken Breast' })]
		const result = findMatchingInventoryItem('fresh chicken breast', items)
		expect(result).toBe(items[0])
	})

	test('modifier-stripped match (boneless chicken breast → chicken breast)', () => {
		const items = [makeItem({ name: 'Chicken Breast' })]
		const result = findMatchingInventoryItem('boneless chicken breast', items)
		expect(result).toBe(items[0])
	})

	test('no match returns null', () => {
		const items = [makeItem({ name: 'Chicken Breast' })]
		const result = findMatchingInventoryItem('Milk', items)
		expect(result).toBeNull()
	})

	test('empty items list returns null', () => {
		const result = findMatchingInventoryItem('Chicken Breast', [])
		expect(result).toBeNull()
	})

	test('pluralization match (tomato → tomatoes)', () => {
		const items = [makeItem({ name: 'tomatoes' })]
		const result = findMatchingInventoryItem('tomato', items)
		expect(result).toBe(items[0])
	})

	test('returns first match when multiple exist', () => {
		const items = [
			makeItem({ id: 'item-1', name: 'Chicken Breast' }),
			makeItem({ id: 'item-2', name: 'chicken breast' }),
		]
		const result = findMatchingInventoryItem('Chicken Breast', items)
		expect(result?.id).toBe('item-1')
	})
})
