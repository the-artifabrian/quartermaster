type EventPayload = Record<string, unknown>

/**
 * Above this many events in one burst we collapse to a single summary toast.
 * A burst that big means catch-up (returning to the app after a while, or a
 * reconnect), not something the user can read one line at a time — and sonner
 * only renders 3 toasts at once, so the rest would drip over the content for
 * a minute.
 */
export const MAX_INDIVIDUAL_TOASTS = 3

export type FormattedEvent = {
	type: string
	payload: EventPayload
	username: string
}

/** Toasts to show for one burst of events: either one each, or one summary. */
export function formatEventBatch(
	events: Array<FormattedEvent>,
): Array<{ message: string; url: string | null }> {
	const formatted = events.map((event) =>
		formatEventMessage(event.type, event.payload, event.username),
	)
	if (formatted.length <= MAX_INDIVIDUAL_TOASTS) return formatted

	// Only offer "View" when every event points at the same place — otherwise
	// the link would be arbitrary.
	const [first, ...rest] = formatted
	const sharedUrl =
		first?.url && rest.every((item) => item.url === first.url)
			? first.url
			: null

	return [
		{
			message: `${formatted.length} household updates while you were away`,
			url: sharedUrl,
		},
	]
}

export function formatEventMessage(
	type: string,
	payload: EventPayload,
	username: string,
): { message: string; url: string | null } {
	switch (type) {
		case 'shopping_list_generated':
			return {
				message: `${username} generated the shopping list (${payload.count} items)`,
				url: '/shopping',
			}
		case 'shopping_list_item_added':
			return {
				message: `${username} added ${payload.name} to the shopping list`,
				url: '/shopping',
			}
		case 'shopping_list_item_toggled':
			return {
				message: `${username} ${payload.checked ? 'checked off' : 'unchecked'} ${payload.name} on the shopping list`,
				url: '/shopping',
			}
		case 'shopping_list_item_edited':
			return {
				message: `${username} edited ${payload.name} on the shopping list`,
				url: '/shopping',
			}
		case 'shopping_list_item_deleted':
			return {
				message: `${username} removed ${payload.name} from the shopping list`,
				url: '/shopping',
			}
		case 'shopping_list_cleared':
			return {
				message: `${username} cleared checked items from the shopping list`,
				url: '/shopping',
			}
		case 'shopping_list_to_inventory':
			return {
				message: `${username} added ${payload.count} items to Pantry from the shopping list`,
				url: '/inventory',
			}
		case 'household_member_joined':
			return {
				message: `${username} joined the household`,
				url: null,
			}
		case 'household_member_left':
			return {
				message: `${username} left the household`,
				url: null,
			}
		default:
			return {
				message: `${username} performed an action`,
				url: null,
			}
	}
}
