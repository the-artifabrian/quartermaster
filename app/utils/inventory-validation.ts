import { z } from 'zod'

export const InventoryItemNameSchema = z
	.string({ required_error: 'Name is required' })
	.min(1, { message: 'Name is required' })
	.max(100, { message: 'Name is too long' })

export const InventoryItemSchema = z.object({
	name: InventoryItemNameSchema,
})

export type InventoryItemFormData = z.infer<typeof InventoryItemSchema>

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
