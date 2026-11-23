/**
 * Failure list for the Meal → Shopping toasts:
 * - One skipped checked row is named, with a verb that fits a plural name
 *   ("Onions are") and a singular one ("Rice is", "Hummus is", "Swiss
 *   chard is").
 * - Several skipped rows are counted, not listed.
 * - No skipped rows gives no message.
 * - The attach-only toast carries a count with the right plural.
 * - A refused Edit on a row with its own amount says what Meals add on top
 *   of the amount in the field, not the row total. A Meal-only row says the
 *   total it now shows; with no amount at all, a plain message.
 */
import { expect, test } from 'vitest'
import {
	addedToExistingMessage,
	rowChangedMessage,
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

test('a refused Edit says what Meals add to a row with its own amount', () => {
	const display = { quantity: '500', unit: 'g', combined: true }
	expect(
		rowChangedMessage({ display, mealShare: { quantity: '300', unit: 'g' } }),
	).toBe('This item changed. Meals now add 300 g on top of your amount.')
	expect(rowChangedMessage({ display, mealShare: null })).toBe(
		'This item changed and now says 500 g. Check your amount, then save again.',
	)
	expect(
		rowChangedMessage({
			display: { quantity: null, unit: null, combined: false },
			mealShare: null,
		}),
	).toBe('This item changed. Check your amount, then save again.')
})
