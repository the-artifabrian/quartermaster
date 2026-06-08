import { describe, expect, test } from 'vitest'
import { type ShoppingListItem } from '#app/generated/prisma/client.ts'
import { guessCategory } from '#app/utils/shopping-list-validation.ts'
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
		source: 'manual',
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

	test('derives category via guessCategory so the optimistic row matches the server', () => {
		// category is the one field the optimistic item COMPUTES rather than echoes
		// from the form, so it must agree with what the server stores or the temp
		// row would visibly jump to a different group on revalidation.
		for (const name of ['Milk', 'Bananas', 'Chicken breast', 'zzqxunknown']) {
			expect(makeOptimisticShoppingItem({ name, listId: 'list1' }).category).toBe(
				guessCategory(name),
			)
		}
	})
})

describe('mergeOptimisticShoppingItems', () => {
	test('returns the real array unchanged when nothing is pending', () => {
		const real = [realItem('apples')]
		expect(mergeOptimisticShoppingItems(real, [])).toBe(real)
	})

	test('inserts pending items at the end of the unchecked group', () => {
		const real = [realItem('apples'), realItem('zucchini', true)]
		const pending = [makeOptimisticShoppingItem({ name: 'bread', listId: 'list1' })]
		const merged = mergeOptimisticShoppingItems(real, pending)
		expect(merged.map((i) => i.name)).toEqual(['apples', 'bread', 'zucchini'])
	})

	test('appends at the end when there are no checked items', () => {
		const real = [realItem('apples')]
		const pending = [makeOptimisticShoppingItem({ name: 'bread', listId: 'list1' })]
		expect(mergeOptimisticShoppingItems(real, pending).map((i) => i.name)).toEqual(
			['apples', 'bread'],
		)
	})

	test('drops a pending item whose name already exists server-side (case-insensitive)', () => {
		const real = [realItem('Milk')]
		const pending = [makeOptimisticShoppingItem({ name: 'milk', listId: 'list1' })]
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

	test('ignores blank names', () => {
		const pending = [makeOptimisticShoppingItem({ name: '   ', listId: 'list1' })]
		expect(mergeOptimisticShoppingItems([], pending)).toHaveLength(0)
	})
})
