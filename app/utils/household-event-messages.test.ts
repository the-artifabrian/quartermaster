import { describe, expect, test } from 'vitest'
import {
	formatEventBatch,
	formatEventMessage,
	MAX_INDIVIDUAL_TOASTS,
} from './household-event-messages.ts'

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

describe('formatEventBatch', () => {
	const event = (type: string, payload: Record<string, unknown> = {}) => ({
		type,
		payload,
		username: 'Sam',
	})

	test('small batches toast one message per event', () => {
		const result = formatEventBatch([
			event('shopping_list_item_added', { name: 'Butter' }),
			event('household_member_joined'),
		])
		expect(result).toHaveLength(2)
		expect(result[0]?.message).toBe('Sam added Butter to the shopping list')
		expect(result[1]?.message).toBe('Sam joined the household')
	})

	test('a batch at the cap is still one toast per event', () => {
		const events = Array.from({ length: MAX_INDIVIDUAL_TOASTS }, () =>
			event('shopping_list_item_added', { name: 'Butter' }),
		)
		expect(formatEventBatch(events)).toHaveLength(MAX_INDIVIDUAL_TOASTS)
	})

	test('a burst past the cap collapses into one summary toast', () => {
		const events = Array.from({ length: 50 }, (_, i) =>
			event('shopping_list_item_toggled', { name: `Item ${i}`, checked: true }),
		)
		const result = formatEventBatch(events)
		expect(result).toHaveLength(1)
		expect(result[0]?.message).toBe('50 household updates while you were away')
		// Every event points at /shopping, so the summary can link there.
		expect(result[0]?.url).toBe('/shopping')
	})

	test('a mixed burst drops the View link rather than guessing', () => {
		const result = formatEventBatch([
			event('shopping_list_item_added', { name: 'Butter' }),
			event('shopping_list_item_added', { name: 'Eggs' }),
			event('shopping_list_to_inventory', { count: 3 }),
			event('household_member_joined'),
		])
		expect(result).toHaveLength(1)
		expect(result[0]?.message).toBe('4 household updates while you were away')
		expect(result[0]?.url).toBeNull()
	})

	test('an empty batch produces no toasts', () => {
		expect(formatEventBatch([])).toEqual([])
	})
})
