/**
 * Maps shopping list categories to default inventory storage locations.
 */
const CATEGORY_LOCATION: Record<string, 'pantry' | 'fridge' | 'freezer'> = {
	produce: 'fridge',
	dairy: 'fridge',
	meat: 'fridge',
	pantry: 'pantry',
	frozen: 'freezer',
	bakery: 'pantry',
	household: 'pantry',
	other: 'pantry',
}

export function categoryToLocation(
	category: string,
): 'pantry' | 'fridge' | 'freezer' {
	return CATEGORY_LOCATION[category] ?? 'pantry'
}
