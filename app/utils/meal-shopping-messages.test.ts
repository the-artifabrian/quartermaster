// The toasts shown after a Meal → Shopping write.
import { expect, test } from 'vitest'
import {
	addedToExistingMessage,
	rowChangedMessage,
	skippedCheckedMessage,
} from './meal-shopping-messages.ts'

test('one skipped checked row is named as stored, whatever its shape', () => {
	for (const name of [
		'onions',
		'Lentils (red)',
		'Tomatoes, chopped',
		'molasses',
	]) {
		expect(skippedCheckedMessage([name])).toBe(
			`Didn’t change checked-off ${name}. Uncheck to update.`,
		)
	}
})

test('several skipped rows are counted, none gives no message, and other changes lead', () => {
	expect(skippedCheckedMessage(['onions', 'rice', 'leeks'])).toBe(
		'Didn’t change 3 checked-off items. Uncheck to update.',
	)
	expect(skippedCheckedMessage(['onions'], { afterChanges: true })).toBe(
		'Shopping updated. Didn’t change checked-off onions.',
	)
	expect(skippedCheckedMessage([])).toBeNull()
})

test('the attach-only toast carries a count', () => {
	expect(addedToExistingMessage(1)).toBe('Added to 1 item already on Shopping')
	expect(addedToExistingMessage(2)).toBe('Added to 2 items already on Shopping')
})

test('a refused Edit says what the row now shows, and how much is from Meals', () => {
	const display = { quantity: '500', unit: 'g', combined: true }
	expect(
		rowChangedMessage({ display, mealShare: { quantity: '300', unit: 'g' } }),
	).toBe('This item changed. It now says 500 g, with 300 g from Meals.')
	expect(rowChangedMessage({ display, mealShare: null })).toBe(
		'This item changed. It now says 500 g.',
	)
	expect(
		rowChangedMessage({
			display: { quantity: null, unit: null, combined: false },
			mealShare: null,
		}),
	).toBe('This item changed. Check it before saving again.')
})
