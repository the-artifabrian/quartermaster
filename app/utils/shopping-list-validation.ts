import { z } from 'zod'

export const ShoppingListItemSchema = z.object({
	name: z.string().min(1, { message: 'Item name is required' }).max(100),
	quantity: z.string().max(50).optional(),
	unit: z.string().max(20).optional(),
	category: z
		.enum([
			'produce',
			'dairy',
			'meat',
			'pantry',
			'frozen',
			'bakery',
			'other',
		])
		.optional(),
})

export type ShoppingListItemFormData = z.infer<typeof ShoppingListItemSchema>

export const CATEGORY_LABELS: Record<string, string> = {
	produce: 'Produce',
	dairy: 'Dairy',
	meat: 'Meat & Seafood',
	pantry: 'Pantry',
	frozen: 'Frozen',
	bakery: 'Bakery',
	other: 'Other',
}

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
	if (
		name.match(
			/flour|sugar|rice|pasta|oil|sauce|can|jar|spice|salt|pepper|stock|broth|bean|lentil|oat/,
		)
	) {
		return 'pantry'
	}

	return 'other'
}
