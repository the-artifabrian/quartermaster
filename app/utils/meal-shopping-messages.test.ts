/**
 * Failure list for the Meal → Shopping toasts:
 * - One skipped checked row is named, with a verb that fits a plural name
 *   ("Onions are") and a singular one ("Rice is", "Hummus is", "Swiss
 *   chard is").
 * - Several skipped rows are counted, not listed.
 * - No skipped rows gives no message.
 * - The attach-only toast carries a count with the right plural.
 */
import { expect, test } from 'vitest'
import {
	addedToExistingMessage,
	skippedCheckedMessage,
} from './meal-shopping-messages.ts'

test('one skipped checked row is named with a verb that fits it', () => {
	expect(skippedCheckedMessage(['onions'])).toBe(
		'Onions are already checked off, so they weren’t changed.',
	)
	expect(skippedCheckedMessage(['rice'])).toBe(
		'Rice is already checked off, so it wasn’t changed.',
	)
	expect(skippedCheckedMessage(['hummus'])).toBe(
		'Hummus is already checked off, so it wasn’t changed.',
	)
	expect(skippedCheckedMessage(['Swiss chard'])).toBe(
		'Swiss chard is already checked off, so it wasn’t changed.',
	)
})

test('several skipped rows are counted, and none gives no message', () => {
	expect(skippedCheckedMessage(['onions', 'rice'])).toBe(
		'2 items are already checked off, so they weren’t changed.',
	)
	expect(skippedCheckedMessage([])).toBeNull()
})

test('the attach-only toast carries a count', () => {
	expect(addedToExistingMessage(1)).toBe('Added to 1 item already on Shopping')
	expect(addedToExistingMessage(2)).toBe('Added to 2 items already on Shopping')
})
