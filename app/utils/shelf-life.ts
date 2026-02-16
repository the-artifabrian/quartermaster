/**
 * Shelf-life lookup table and expiry date suggestion.
 *
 * Client-importable — uses lightweight inline normalization (lowercase, trim,
 * strip trailing "s"/"es") instead of the heavier recipe-matching normalizer.
 * Substring matching against table keys compensates for the simpler approach.
 */

type ShelfLifeEntry = {
	pantry?: number
	fridge?: number
	freezer?: number
}

/**
 * Maps normalized ingredient substrings to shelf life in days by location.
 * Entries are checked via substring match, so "chicken" matches
 * "fresh chicken breast", "chicken thigh", etc.
 */
const SHELF_LIFE_TABLE: Record<string, ShelfLifeEntry> = {
	// Produce — fruits
	apple: { pantry: 7, fridge: 28, freezer: 240 },
	banana: { pantry: 5, fridge: 7, freezer: 180 },
	berry: { fridge: 5, freezer: 240 },
	blueberry: { fridge: 7, freezer: 240 },
	strawberry: { fridge: 5, freezer: 240 },
	raspberry: { fridge: 3, freezer: 240 },
	grape: { fridge: 10, freezer: 180 },
	lemon: { pantry: 7, fridge: 21, freezer: 120 },
	lime: { pantry: 7, fridge: 21, freezer: 120 },
	orange: { pantry: 7, fridge: 21, freezer: 120 },
	avocado: { pantry: 4, fridge: 7, freezer: 120 },
	melon: { pantry: 3, fridge: 7, freezer: 180 },
	peach: { pantry: 3, fridge: 5, freezer: 180 },
	pear: { pantry: 4, fridge: 7, freezer: 180 },

	// Produce — vegetables
	lettuce: { fridge: 7, freezer: 30 },
	spinach: { fridge: 5, freezer: 180 },
	kale: { fridge: 7, freezer: 180 },
	broccoli: { fridge: 7, freezer: 240 },
	cauliflower: { fridge: 7, freezer: 240 },
	carrot: { fridge: 21, freezer: 300 },
	celery: { fridge: 14, freezer: 180 },
	cucumber: { fridge: 7 },
	tomato: { pantry: 5, fridge: 10, freezer: 180 },
	'bell pepper': { fridge: 10, freezer: 240 },
	pepper: { fridge: 10, freezer: 240 },
	onion: { pantry: 30, fridge: 45, freezer: 240 },
	garlic: { pantry: 60, fridge: 90, freezer: 300 },
	potato: { pantry: 21, fridge: 60, freezer: 300 },
	'sweet potato': { pantry: 14, fridge: 30, freezer: 300 },
	mushroom: { fridge: 7, freezer: 240 },
	zucchini: { fridge: 7, freezer: 240 },
	corn: { fridge: 3, freezer: 240 },
	'green bean': { fridge: 7, freezer: 240 },
	asparagus: { fridge: 4, freezer: 240 },
	cabbage: { fridge: 14, freezer: 240 },
	ginger: { pantry: 7, fridge: 21, freezer: 180 },

	// Herbs
	basil: { fridge: 5, freezer: 120 },
	cilantro: { fridge: 7, freezer: 120 },
	parsley: { fridge: 10, freezer: 120 },
	rosemary: { fridge: 14, freezer: 120 },
	thyme: { fridge: 14, freezer: 120 },
	mint: { fridge: 7, freezer: 120 },

	// Dairy
	milk: { fridge: 7, freezer: 90 },
	cream: { fridge: 7, freezer: 90 },
	yogurt: { fridge: 14, freezer: 60 },
	butter: { fridge: 30, freezer: 270 },
	cheese: { fridge: 21, freezer: 180 },
	'cream cheese': { fridge: 14, freezer: 60 },
	'sour cream': { fridge: 14, freezer: 60 },
	egg: { fridge: 28, freezer: 360 },

	// Meat & poultry
	chicken: { fridge: 2, freezer: 270 },
	turkey: { fridge: 2, freezer: 270 },
	beef: { fridge: 3, freezer: 270 },
	steak: { fridge: 3, freezer: 180 },
	pork: { fridge: 3, freezer: 180 },
	bacon: { fridge: 7, freezer: 180 },
	sausage: { fridge: 3, freezer: 180 },
	lamb: { fridge: 3, freezer: 270 },
	'ground meat': { fridge: 2, freezer: 120 },
	'ground beef': { fridge: 2, freezer: 120 },
	'ground turkey': { fridge: 2, freezer: 120 },

	// Seafood
	fish: { fridge: 2, freezer: 180 },
	salmon: { fridge: 2, freezer: 180 },
	shrimp: { fridge: 2, freezer: 180 },
	tuna: { fridge: 2, freezer: 180 },

	// Bread & bakery
	bread: { pantry: 5, fridge: 10, freezer: 180 },
	tortilla: { pantry: 7, fridge: 21, freezer: 180 },
	pita: { pantry: 5, fridge: 10, freezer: 180 },
	bagel: { pantry: 5, fridge: 7, freezer: 180 },

	// Pantry staples (long shelf life, mostly useful for fridge/freezer variants)
	rice: { pantry: 365 },
	pasta: { pantry: 730 },
	flour: { pantry: 180, freezer: 365 },
	sugar: { pantry: 730 },
	oil: { pantry: 365 },
	vinegar: { pantry: 730 },
	'soy sauce': { pantry: 730 },
	honey: { pantry: 730 },
	'maple syrup': { pantry: 365, fridge: 365 },
	'peanut butter': { pantry: 180, fridge: 270 },
	jam: { pantry: 365, fridge: 180 },
	canned: { pantry: 730 },

	// Condiments & sauces
	ketchup: { pantry: 365, fridge: 180 },
	mustard: { pantry: 365, fridge: 365 },
	mayonnaise: { fridge: 60 },
	salsa: { fridge: 14, freezer: 120 },
	'hot sauce': { pantry: 365, fridge: 365 },
	'salad dressing': { fridge: 60 },

	// Frozen
	'ice cream': { freezer: 60 },

	// Tofu & plant-based
	tofu: { fridge: 7, freezer: 150 },
	tempeh: { fridge: 7, freezer: 180 },
}

// Pre-sorted keys: longest first so "cream cheese" matches before "cream"
const SORTED_KEYS = Object.keys(SHELF_LIFE_TABLE).sort(
	(a, b) => b.length - a.length,
)

/**
 * Lightweight normalization: lowercase, trim, strip trailing "s" or "es".
 */
function simplifyName(name: string): string {
	let s = name.toLowerCase().trim()
	if (s.endsWith('ies')) {
		s = s.slice(0, -3) + 'y'
	} else if (s.endsWith('es') && !s.endsWith('ches') && !s.endsWith('shes')) {
		s = s.slice(0, -2)
	} else if (s.endsWith('s') && !s.endsWith('ss')) {
		s = s.slice(0, -1)
	}
	return s
}

/**
 * Get the shelf life in days for a given ingredient name and storage location.
 * Uses substring matching: "fresh chicken breast" matches "chicken".
 *
 * Returns `null` if no match is found for the given name+location combo.
 */
export function getShelfLifeDays(
	name: string,
	location: 'pantry' | 'fridge' | 'freezer',
): number | null {
	const simplified = simplifyName(name)

	for (const key of SORTED_KEYS) {
		if (simplified.includes(key)) {
			const entry = SHELF_LIFE_TABLE[key]!
			return entry[location] ?? null
		}
	}

	return null
}

/**
 * Suggest an expiry date for an ingredient being added to inventory.
 * Returns an ISO date string (YYYY-MM-DD) or null if no shelf-life data.
 */
export function suggestExpiryDate(
	name: string,
	location: 'pantry' | 'fridge' | 'freezer',
): string | null {
	const days = getShelfLifeDays(name, location)
	if (days == null) return null

	const date = new Date()
	date.setDate(date.getDate() + days)
	return date.toISOString().slice(0, 10)
}
