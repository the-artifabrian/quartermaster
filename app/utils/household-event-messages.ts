type EventPayload = Record<string, unknown>

const NOTIFY_EVENT_TYPES = new Set([
	'shopping_list_generated',
	'shopping_list_item_added',
	'shopping_list_cleared',
	'shopping_list_to_inventory',
	'meal_plan_assigned',
	'meal_plan_template_applied',
	'meal_plan_week_copied',
	'household_member_joined',
	'household_member_left',
	'recipe_created',
	'recipe_imported',
	'recipes_bulk_imported',
	'data_imported',
])

export type EventPriority = 'notify' | 'silent'

export function getEventPriority(type: string): EventPriority {
	return NOTIFY_EVENT_TYPES.has(type) ? 'notify' : 'silent'
}

export const NOTIFY_EVENT_TYPES_LIST = [...NOTIFY_EVENT_TYPES]

export function formatEventMessage(
	type: string,
	payload: EventPayload,
	username: string,
): { message: string; url: string | null } {
	switch (type) {
		case 'recipe_created':
			return {
				message: `${username} added "${payload.title}"`,
				url: `/recipes/${payload.recipeId}`,
			}
		case 'recipe_updated':
			return {
				message: `${username} updated "${payload.title}"`,
				url: `/recipes/${payload.recipeId}`,
			}
		case 'recipe_deleted':
			return {
				message: `${username} deleted "${payload.title}"`,
				url: null,
			}
		case 'recipe_imported':
			return {
				message: `${username} imported "${payload.title}"`,
				url: `/recipes/${payload.recipeId}`,
			}
		case 'recipe_favorited':
			return {
				message: `${username} ${payload.isFavorite ? 'favorited' : 'unfavorited'} "${payload.title}"`,
				url: `/recipes/${payload.recipeId}`,
			}
		case 'cook_logged':
			return {
				message: `${username} cooked "${payload.title}"`,
				url: `/recipes/${payload.recipeId}`,
			}
		case 'inventory_item_added':
			return {
				message: `${username} added ${payload.name} to the ${payload.location}`,
				url: `/inventory?location=${payload.location}`,
			}
		case 'inventory_items_bulk_added':
			return {
				message: `${username} added ${payload.count} items to the ${payload.location}`,
				url: `/inventory?location=${payload.location}`,
			}
		case 'inventory_item_updated':
			return {
				message: `${username} updated ${payload.name}`,
				url: '/inventory',
			}
		case 'inventory_item_deleted':
			return {
				message: `${username} removed ${payload.name} from the inventory`,
				url: '/inventory',
			}
		case 'meal_plan_assigned':
			return {
				message: `${username} planned ${payload.title} for ${payload.day} ${payload.mealType}`,
				url: '/plan',
			}
		case 'meal_plan_removed':
			return {
				message: `${username} removed ${payload.title} from the meal plan`,
				url: '/plan',
			}
		case 'meal_plan_cooked':
			return {
				message: `${username} marked ${payload.title} as ${payload.cooked ? 'cooked' : 'uncooked'}`,
				url: '/plan',
			}
		case 'meal_plan_week_copied':
			return {
				message: `${username} copied the meal plan to next week`,
				url: '/plan',
			}
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
		case 'shopping_list_cleared':
			return {
				message: `${username} cleared checked items from the shopping list`,
				url: '/shopping',
			}
		case 'shopping_list_to_inventory':
			return {
				message: `${username} moved ${payload.count} items from the shopping list to inventory`,
				url: '/inventory',
			}
		case 'recipes_bulk_imported':
			return {
				message: `${username} imported ${payload.count} recipes`,
				url: '/recipes',
			}
		case 'data_imported': {
			const parts: string[] = []
			if (payload.recipeCount) parts.push(`${payload.recipeCount} recipes`)
			if (payload.inventoryCount)
				parts.push(`${payload.inventoryCount} inventory items`)
			const summary = parts.length > 0 ? parts.join(' and ') : 'data'
			return {
				message: `${username} imported ${summary}`,
				url: '/recipes',
			}
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
		case 'meal_plan_template_saved':
			return {
				message: `${username} saved meal plan template "${payload.name}"`,
				url: '/plan',
			}
		case 'meal_plan_template_applied':
			return {
				message: `${username} applied template "${payload.name}"`,
				url: '/plan',
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
		case 'inventory_item_low_stock_toggled':
			return {
				message: `${username} marked ${payload.name} as ${payload.lowStock ? 'low stock' : 'in stock'}`,
				url: '/inventory',
			}
		default:
			return {
				message: `${username} performed an action`,
				url: null,
			}
	}
}
