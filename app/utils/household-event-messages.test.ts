import { describe, expect, test } from 'vitest'
import { formatEventMessage } from './household-event-messages.ts'

describe('formatEventMessage', () => {
	test('shopping_list_generated', () => {
		const result = formatEventMessage(
			'shopping_list_generated',
			{ count: 24 },
			'Alex',
		)
		expect(result.message).toBe('Alex generated the shopping list (24 items)')
		expect(result.url).toBe('/shopping')
	})

	test('shopping_list_item_added', () => {
		const result = formatEventMessage(
			'shopping_list_item_added',
			{ name: 'Butter' },
			'Alex',
		)
		expect(result.message).toBe('Alex added Butter to the shopping list')
		expect(result.url).toBe('/shopping')
	})

	test('shopping_list_item_toggled - checked', () => {
		const result = formatEventMessage(
			'shopping_list_item_toggled',
			{ name: 'Milk', checked: true },
			'Alex',
		)
		expect(result.message).toBe('Alex checked off Milk on the shopping list')
		expect(result.url).toBe('/shopping')
	})

	test('shopping_list_item_toggled - unchecked', () => {
		const result = formatEventMessage(
			'shopping_list_item_toggled',
			{ name: 'Milk', checked: false },
			'Alex',
		)
		expect(result.message).toBe('Alex unchecked Milk on the shopping list')
	})

	test('shopping_list_item_edited', () => {
		const result = formatEventMessage(
			'shopping_list_item_edited',
			{ name: 'Whole Milk' },
			'Alex',
		)
		expect(result.message).toBe('Alex edited Whole Milk on the shopping list')
		expect(result.url).toBe('/shopping')
	})

	test('shopping_list_item_deleted', () => {
		const result = formatEventMessage(
			'shopping_list_item_deleted',
			{ name: 'Butter' },
			'Alex',
		)
		expect(result.message).toBe('Alex removed Butter from the shopping list')
		expect(result.url).toBe('/shopping')
	})

	test('shopping_list_cleared', () => {
		const result = formatEventMessage('shopping_list_cleared', {}, 'Alex')
		expect(result.message).toBe(
			'Alex cleared checked items from the shopping list',
		)
		expect(result.url).toBe('/shopping')
	})

	test('shopping_list_to_inventory', () => {
		const result = formatEventMessage(
			'shopping_list_to_inventory',
			{ count: 3 },
			'Alex',
		)
		expect(result.message).toBe(
			'Alex added 3 items to Pantry from the shopping list',
		)
		expect(result.url).toBe('/inventory')
	})

	test('household_member_joined', () => {
		const result = formatEventMessage('household_member_joined', {}, 'Sam')
		expect(result.message).toBe('Sam joined the household')
		expect(result.url).toBeNull()
	})

	test('household_member_left', () => {
		const result = formatEventMessage('household_member_left', {}, 'Sam')
		expect(result.message).toBe('Sam left the household')
		expect(result.url).toBeNull()
	})

	test('unknown event type', () => {
		const result = formatEventMessage('something_unknown', {}, 'Alex')
		expect(result.message).toBe('Alex performed an action')
		expect(result.url).toBeNull()
	})
})
