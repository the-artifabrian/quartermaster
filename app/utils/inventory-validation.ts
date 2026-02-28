import { z } from 'zod'

export const InventoryItemNameSchema = z
	.string({ required_error: 'Name is required' })
	.min(1, { message: 'Name is required' })
	.max(100, { message: 'Name is too long' })

export const InventoryItemLocationSchema = z.enum(
	['pantry', 'fridge', 'freezer'],
	{
		required_error: 'Location is required',
	},
)

export const InventoryItemSchema = z.object({
	name: InventoryItemNameSchema,
	location: InventoryItemLocationSchema,
})

export type InventoryItemFormData = z.infer<typeof InventoryItemSchema>

export const LOCATION_LABELS = {
	pantry: 'Pantry',
	fridge: 'Fridge',
	freezer: 'Freezer',
} as const

export const COMMON_INGREDIENTS = [
	// Proteins
	'chicken breast',
	'ground beef',
	'eggs',
	'bacon',
	'salmon',
	// Dairy
	'milk',
	'butter',
	'cheese',
	'yogurt',
	// Vegetables
	'onion',
	'garlic',
	'tomato',
	'potato',
	'carrot',
	'bell pepper',
	'lettuce',
	// Pantry Staples
	'flour',
	'sugar',
	'salt',
	'pepper',
	'olive oil',
	'rice',
	'pasta',
	'bread',
	// Condiments
	'ketchup',
	'mayonnaise',
	'mustard',
	'soy sauce',
] as const
