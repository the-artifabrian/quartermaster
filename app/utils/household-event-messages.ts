type EventPayload = Record<string, unknown>

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
