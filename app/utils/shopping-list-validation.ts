import { z } from 'zod'

export const ShoppingListItemSchema = z.object({
	name: z.string().min(1, { message: 'Item name is required' }).max(100),
	quantity: z
		.string()
		.max(50)
		.optional()
		.transform((v) => (v === '' ? null : v))
		.nullable(),
	unit: z
		.string()
		.max(20)
		.optional()
		.transform((v) => (v === '' ? null : v))
		.nullable(),
	category: z
		.enum([
			'produce',
			'dairy',
			'meat',
			'pantry',
			'frozen',
			'bakery',
			'household',
			'other',
		])
		.optional(),
})

export type ShoppingListItemFormData = z.infer<typeof ShoppingListItemSchema>

// Categorize ingredients by name
export function guessCategory(ingredientName: string): string {
	const name = ingredientName.toLowerCase()

	if (
		name.match(
			/lettuce|tomato|onion|garlic|pepper|carrot|potato|cucumber|spinach|broccoli|celery|mushroom|avocado|zucchini|herb|cilantro|parsley|basil|fruit|apple|banana|orange|lemon|lime/,
		)
	) {
		return 'produce'
	}
	if (
		name.match(
			/milk|cheese|butter|cream|yogurt|sour cream|cottage cheese|mozzarella|parmesan|cheddar/,
		)
	) {
		return 'dairy'
	}
	if (
		name.match(
			/chicken|beef|pork|turkey|lamb|fish|salmon|shrimp|tuna|bacon|sausage|steak|ground/,
		)
	) {
		return 'meat'
	}
	if (name.match(/frozen|ice cream/)) {
		return 'frozen'
	}
	if (name.match(/bread|bun|roll|bagel|tortilla|pita/)) {
		return 'bakery'
	}
	// Household check before pantry — "toilet" contains "oil" which would
	// otherwise match the pantry pattern.
	if (
		name.match(
			/toilet paper|paper towel|tissues|napkins|paper plates|paper cups|dish soap|laundry detergent|bleach|cleaner|disinfect|wipes|sponge|dryer sheets|fabric softener|shampoo|conditioner|body wash|toothpaste|deodorant|floss|razor|sunscreen|trash bag|garbage bag|aluminum foil|plastic wrap|ziplock|batteries|light bulb|candle|dog food|cat food|cat litter|pet food|pet treats/,
		)
	) {
		return 'household'
	}
	if (
		name.match(
			/flour|sugar|rice|pasta|oil|sauce|can|jar|spice|salt|pepper|stock|broth|bean|lentil|oat/,
		)
	) {
		return 'pantry'
	}

	return 'other'
}
