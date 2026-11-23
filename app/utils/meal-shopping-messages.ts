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
 * Update Shopping left these checked rows alone. The verb needs no
 * agreement, so a row name of any shape reads right, and it stays as stored.
 * After other changes the toast leads with "Shopping updated".
 */
export function skippedCheckedMessage(
	names: string[],
	{ afterChanges = false }: { afterChanges?: boolean } = {},
) {
	if (names.length === 0) return null
	const what =
		names.length === 1
			? `checked-off ${names[0]}`
			: `${names.length} checked-off items`
	return afterChanges
		? `Shopping updated. Didn’t change ${what}.`
		: `Didn’t change ${what}. Uncheck to update.`
}

/**
 * The row changed while it was open in Edit. It says what the row now
 * shows, and for a row with its own amount how much of that is from Meals,
 * since the field holds only the row's own amount.
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
	const amount = amountOf(display)
	if (!amount) return 'This item changed. Check it before saving again.'
	const share = mealShare ? amountOf(mealShare) : ''
	return share
		? `This item changed. It now says ${amount}, with ${share} from Meals.`
		: `This item changed. It now says ${amount}.`
}
