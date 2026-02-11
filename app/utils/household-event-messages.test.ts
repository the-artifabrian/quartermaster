import { describe, expect, test } from 'vitest'
import { formatEventMessage } from './household-event-messages.ts'

describe('formatEventMessage', () => {
	test('recipe_created', () => {
		const result = formatEventMessage(
			'recipe_created',
			{ recipeId: '123', title: 'Chicken Tikka' },
			'Alex',
		)
		expect(result.message).toBe('Alex added "Chicken Tikka"')
		expect(result.url).toBe('/recipes/123')
	})

	test('recipe_updated', () => {
		const result = formatEventMessage(
			'recipe_updated',
			{ recipeId: '123', title: 'Chicken Tikka' },
			'Alex',
		)
		expect(result.message).toBe('Alex updated "Chicken Tikka"')
		expect(result.url).toBe('/recipes/123')
	})

	test('recipe_deleted', () => {
		const result = formatEventMessage(
			'recipe_deleted',
			{ recipeId: '123', title: 'Chicken Tikka' },
			'Alex',
		)
		expect(result.message).toBe('Alex deleted "Chicken Tikka"')
		expect(result.url).toBeNull()
	})

	test('recipe_imported', () => {
		const result = formatEventMessage(
			'recipe_imported',
			{ recipeId: '123', title: 'Pad Thai' },
			'Sam',
		)
		expect(result.message).toBe('Sam imported "Pad Thai"')
		expect(result.url).toBe('/recipes/123')
	})

	test('recipe_favorited - favorite', () => {
		const result = formatEventMessage(
			'recipe_favorited',
			{ recipeId: '123', title: 'Pasta', isFavorite: true },
			'Alex',
		)
		expect(result.message).toBe('Alex favorited "Pasta"')
		expect(result.url).toBe('/recipes/123')
	})

	test('recipe_favorited - unfavorite', () => {
		const result = formatEventMessage(
			'recipe_favorited',
			{ recipeId: '123', title: 'Pasta', isFavorite: false },
			'Alex',
		)
		expect(result.message).toBe('Alex unfavorited "Pasta"')
	})

	test('cook_logged', () => {
		const result = formatEventMessage(
			'cook_logged',
			{ recipeId: '123', title: 'Stir Fry' },
			'Alex',
		)
		expect(result.message).toBe('Alex cooked "Stir Fry"')
		expect(result.url).toBe('/recipes/123')
	})

	test('inventory_item_added', () => {
		const result = formatEventMessage(
			'inventory_item_added',
			{ name: 'Chicken', location: 'fridge' },
			'Alex',
		)
		expect(result.message).toBe('Alex added Chicken to the fridge')
		expect(result.url).toBe('/inventory?location=fridge')
	})

	test('inventory_items_bulk_added', () => {
		const result = formatEventMessage(
			'inventory_items_bulk_added',
			{ count: 5, location: 'pantry' },
			'Alex',
		)
		expect(result.message).toBe('Alex added 5 items to the pantry')
		expect(result.url).toBe('/inventory?location=pantry')
	})

	test('inventory_item_updated', () => {
		const result = formatEventMessage(
			'inventory_item_updated',
			{ name: 'Milk' },
			'Alex',
		)
		expect(result.message).toBe('Alex updated Milk')
		expect(result.url).toBe('/inventory')
	})

	test('inventory_item_deleted', () => {
		const result = formatEventMessage(
			'inventory_item_deleted',
			{ name: 'Eggs' },
			'Alex',
		)
		expect(result.message).toBe('Alex removed Eggs from the inventory')
		expect(result.url).toBe('/inventory')
	})

	test('meal_plan_assigned', () => {
		const result = formatEventMessage(
			'meal_plan_assigned',
			{ title: 'Chicken Tikka', day: 'Thursday', mealType: 'dinner' },
			'Alex',
		)
		expect(result.message).toBe(
			'Alex planned Chicken Tikka for Thursday dinner',
		)
		expect(result.url).toBe('/plan')
	})

	test('meal_plan_removed', () => {
		const result = formatEventMessage(
			'meal_plan_removed',
			{ title: 'Chicken Tikka' },
			'Alex',
		)
		expect(result.message).toBe(
			'Alex removed Chicken Tikka from the meal plan',
		)
		expect(result.url).toBe('/plan')
	})

	test('meal_plan_cooked', () => {
		const result = formatEventMessage(
			'meal_plan_cooked',
			{ title: 'Stir Fry', cooked: true },
			'Alex',
		)
		expect(result.message).toBe('Alex marked Stir Fry as cooked')
		expect(result.url).toBe('/plan')
	})

	test('meal_plan_cooked - uncooked', () => {
		const result = formatEventMessage(
			'meal_plan_cooked',
			{ title: 'Stir Fry', cooked: false },
			'Alex',
		)
		expect(result.message).toBe('Alex marked Stir Fry as uncooked')
	})

	test('meal_plan_week_copied', () => {
		const result = formatEventMessage(
			'meal_plan_week_copied',
			{},
			'Alex',
		)
		expect(result.message).toBe('Alex copied the meal plan to next week')
		expect(result.url).toBe('/plan')
	})

	test('shopping_list_generated', () => {
		const result = formatEventMessage(
			'shopping_list_generated',
			{ count: 24 },
			'Alex',
		)
		expect(result.message).toBe(
			'Alex generated the shopping list (24 items)',
		)
		expect(result.url).toBe('/plan/shopping-list')
	})

	test('shopping_list_item_added', () => {
		const result = formatEventMessage(
			'shopping_list_item_added',
			{ name: 'Butter' },
			'Alex',
		)
		expect(result.message).toBe('Alex added Butter to the shopping list')
		expect(result.url).toBe('/plan/shopping-list')
	})

	test('shopping_list_cleared', () => {
		const result = formatEventMessage(
			'shopping_list_cleared',
			{},
			'Alex',
		)
		expect(result.message).toBe(
			'Alex cleared checked items from the shopping list',
		)
		expect(result.url).toBe('/plan/shopping-list')
	})

	test('shopping_list_to_inventory', () => {
		const result = formatEventMessage(
			'shopping_list_to_inventory',
			{ count: 3 },
			'Alex',
		)
		expect(result.message).toBe(
			'Alex moved 3 items from the shopping list to inventory',
		)
		expect(result.url).toBe('/inventory')
	})

	test('household_member_joined', () => {
		const result = formatEventMessage(
			'household_member_joined',
			{},
			'Sam',
		)
		expect(result.message).toBe('Sam joined the household')
		expect(result.url).toBeNull()
	})

	test('household_member_left', () => {
		const result = formatEventMessage(
			'household_member_left',
			{},
			'Sam',
		)
		expect(result.message).toBe('Sam left the household')
		expect(result.url).toBeNull()
	})

	test('meal_plan_template_saved', () => {
		const result = formatEventMessage(
			'meal_plan_template_saved',
			{ name: 'Weeknight Easy' },
			'Alex',
		)
		expect(result.message).toBe(
			'Alex saved meal plan template "Weeknight Easy"',
		)
		expect(result.url).toBe('/plan')
	})

	test('meal_plan_template_applied', () => {
		const result = formatEventMessage(
			'meal_plan_template_applied',
			{ name: 'Entertaining Week' },
			'Sam',
		)
		expect(result.message).toBe('Sam applied template "Entertaining Week"')
		expect(result.url).toBe('/plan')
	})

	test('unknown event type', () => {
		const result = formatEventMessage('something_unknown', {}, 'Alex')
		expect(result.message).toBe('Alex performed an action')
		expect(result.url).toBeNull()
	})
})
