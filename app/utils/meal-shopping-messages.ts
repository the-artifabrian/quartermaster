import { type ShoppingItemDisplay } from './shopping-optimistic.ts'

/**
 * Copy for Meal → Shopping toasts and a refused row Edit. Kept apart from
 * the components so the wording can be tested.
 */

/** Rows that Meal demand joined without adding a row of its own. */
export function addedToExistingMessage(count: number) {
	return `Added to ${count} item${count === 1 ? '' : 's'} already on Shopping`
}

/**
 * Update Shopping left these checked rows alone. One row is named; a row
 * name ending in s (but not ss or us) reads as plural.
 */
export function skippedCheckedMessage(names: string[]) {
	if (names.length === 0) return null
	if (names.length > 1) {
		return `${names.length} items are already checked off, so they weren’t changed.`
	}
	const name = names[0]!.trim()
	const plural = /[^su]s$/i.test(name)
	const shown = name.charAt(0).toUpperCase() + name.slice(1)
	return plural
		? `${shown} are already checked off, so they weren’t changed.`
		: `${shown} is already checked off, so it wasn’t changed.`
}

/**
 * The row changed while it was open in Edit. A row with its own amount says
 * what Meals add on top of the amount in the field; a Meal-only row says
 * the total it now shows.
 */
export function rowChangedMessage({
	display,
	mealShare,
}: {
	display: ShoppingItemDisplay
	mealShare: { quantity: string | null; unit: string | null } | null
}) {
	const amountOf = (value: { quantity: string | null; unit: string | null }) =>
		[value.quantity, value.unit].filter(Boolean).join(' ')
	const share = mealShare ? amountOf(mealShare) : ''
	if (share) {
		return `This item changed. Meals now add ${share} on top of your amount.`
	}
	const amount = amountOf(display)
	return amount
		? `This item changed and now says ${amount}. Check your amount, then save again.`
		: 'This item changed. Check your amount, then save again.'
}
