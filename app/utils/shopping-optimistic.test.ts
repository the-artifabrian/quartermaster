import { describe, expect, test } from 'vitest'
import { type ShoppingListItem } from '#app/generated/prisma/client.ts'
import {
	makeOptimisticShoppingItem,
	mergeOptimisticShoppingItems,
} from './shopping-optimistic.ts'

function realItem(name: string, checked = false): ShoppingListItem {
	return {
		id: `real:${name}`,
		name,
		quantity: null,
		unit: null,
		category: 'other',
		checked,
		checkVersion: 0,
		lastCheckMutationId: null,
		source: 'manual',
		horizon: 'next',
		listId: 'list1',
		createdAt: new Date(0),
	}
}

describe('makeOptimisticShoppingItem', () => {
	test('builds an unchecked manual item with a stable optimistic id', () => {
		const item = makeOptimisticShoppingItem({
			name: '  Milk ',
			quantity: ' 2 ',
			unit: '',
			listId: 'list1',
		})
		expect(item.id).toBe('optimistic:milk')
		expect(item.name).toBe('  Milk ') // name preserved exactly as typed
		expect(item.quantity).toBe('2')
		expect(item.unit).toBeNull()
		expect(item.checked).toBe(false)
		expect(item.source).toBe('manual')
		expect(item.listId).toBe('list1')
		expect(typeof item.category).toBe('string')
	})
})

describe('mergeOptimisticShoppingItems', () => {
	test('inserts pending items at the end of the unchecked group', () => {
		const real = [realItem('apples'), realItem('zucchini', true)]
		const pending = [
			makeOptimisticShoppingItem({ name: 'bread', listId: 'list1' }),
		]
		const merged = mergeOptimisticShoppingItems(real, pending)
		expect(merged.map((i) => i.name)).toEqual(['apples', 'bread', 'zucchini'])
	})

	test('appends at the end when there are no checked items', () => {
		const real = [realItem('apples')]
		const pending = [
			makeOptimisticShoppingItem({ name: 'bread', listId: 'list1' }),
		]
		expect(
			mergeOptimisticShoppingItems(real, pending).map((i) => i.name),
		).toEqual(['apples', 'bread'])
	})

	test('drops a pending item whose name already exists server-side (case-insensitive)', () => {
		const real = [realItem('Milk')]
		const pending = [
			makeOptimisticShoppingItem({ name: 'milk', listId: 'list1' }),
		]
		const merged = mergeOptimisticShoppingItems(real, pending)
		expect(merged).toHaveLength(1)
		expect(merged[0]!.id).toBe('real:Milk')
	})

	test('dedups pending items against each other by name', () => {
		const pending = [
			makeOptimisticShoppingItem({ name: 'eggs', listId: 'list1' }),
			makeOptimisticShoppingItem({ name: 'Eggs', listId: 'list1' }),
		]
		expect(mergeOptimisticShoppingItems([], pending)).toHaveLength(1)
	})
})
