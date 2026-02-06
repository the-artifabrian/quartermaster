import {
	type Recipe,
	type Ingredient,
	type InventoryItem,
} from '@prisma/client'

/**
 * Common staple ingredients that are assumed to be available
 * These won't count against recipe matching percentage
 */
const STAPLE_INGREDIENTS = new Set([
	'water',
	'salt',
	'sea salt',
	'kosher salt',
	'table salt',
	'black pepper',
	'pepper',
	'ground black pepper',
	'freshly ground black pepper',
	'vegetable oil',
	'cooking oil',
	'olive oil',
	'canola oil',
])

/**
 * Common ingredient synonyms for better matching
 */
export const INGREDIENT_SYNONYMS: Record<string, string[]> = {
	cilantro: ['coriander', 'chinese parsley'],
	coriander: ['cilantro', 'chinese parsley'],
	'green onion': ['scallion', 'spring onion'],
	scallion: ['green onion', 'spring onion'],
	'heavy cream': ['heavy whipping cream', 'whipping cream'],
	'bell pepper': ['sweet pepper', 'capsicum'],
	flour: ['all-purpose flour', 'plain flour', 'ap flour'],
	'all-purpose flour': ['flour', 'plain flour', 'ap flour'],
	'plain flour': ['flour', 'all-purpose flour', 'ap flour'],
	water: ['water'],
	stock: ['broth'],
	broth: ['stock'],
	'chicken stock': ['chicken broth'],
	'chicken broth': ['chicken stock'],
	mirin: ['sake', 'white wine', 'rice wine'],
	sake: ['mirin', 'white wine', 'rice wine'],
	// Cooking oils - neutral oils are interchangeable
	oil: [
		'vegetable oil',
		'canola oil',
		'grapeseed oil',
		'sunflower oil',
		'peanut oil',
		'avocado oil',
		'safflower oil',
	],
	'vegetable oil': [
		'oil',
		'canola oil',
		'grapeseed oil',
		'sunflower oil',
		'peanut oil',
		'avocado oil',
	],
	'canola oil': [
		'oil',
		'vegetable oil',
		'grapeseed oil',
		'sunflower oil',
		'peanut oil',
		'avocado oil',
	],
	'grapeseed oil': [
		'oil',
		'vegetable oil',
		'canola oil',
		'sunflower oil',
		'peanut oil',
		'avocado oil',
	],
	'sunflower oil': [
		'oil',
		'vegetable oil',
		'canola oil',
		'grapeseed oil',
		'peanut oil',
		'avocado oil',
	],
	'peanut oil': [
		'oil',
		'vegetable oil',
		'canola oil',
		'grapeseed oil',
		'sunflower oil',
		'avocado oil',
	],
	'avocado oil': [
		'oil',
		'vegetable oil',
		'canola oil',
		'grapeseed oil',
		'sunflower oil',
		'peanut oil',
	],
	// Soy sauces — "dark soy sauce" and "light soy sauce" normalize to "soy sauce"
	// via modifier stripping, so only tamari/shoyu need explicit synonyms
	'soy sauce': ['tamari', 'shoyu'],
	tamari: ['soy sauce', 'shoyu'],
	shoyu: ['soy sauce', 'tamari'],
	// Proteins — "chicken breast" and "chicken thigh" already match "chicken"
	// via the core-word matching logic, but explicit synonyms help the reverse case
	chicken: ['chicken breast', 'chicken thigh'],
	'chicken breast': ['chicken', 'chicken thigh'],
	'chicken thigh': ['chicken', 'chicken breast'],
	// Hard cheeses
	parmesan: ['pecorino', 'parmigiano reggiano', 'grana padano'],
	pecorino: ['parmesan', 'parmigiano reggiano', 'grana padano'],
	'parmigiano reggiano': ['parmesan', 'pecorino', 'grana padano'],
	'grana padano': ['parmesan', 'pecorino', 'parmigiano reggiano'],
	// Yogurt — "greek yogurt" normalizes to "yogurt" via modifier stripping
	yogurt: ['greek yogurt'],
	'greek yogurt': ['yogurt'],
	// Sugars — "powdered sugar" and "confectioners sugar" normalize to "sugar"
	// via modifier stripping; "icing sugar" stays as "icing sugar"
	sugar: ['icing sugar'],
	'icing sugar': ['sugar'],
	// Leavening
	'baking soda': ['bicarbonate of soda'],
	'bicarbonate of soda': ['baking soda'],
	// Starch
	cornstarch: ['corn starch'],
	'corn starch': ['cornstarch'],
	// Vegetables
	eggplant: ['aubergine'],
	aubergine: ['eggplant'],
	arugula: ['rocket'],
	rocket: ['arugula'],
	// "green beans" normalizes to "bean" (green stripped, plurals stripped)
	bean: ['string bean', 'french bean'],
	'string bean': ['bean', 'french bean'],
	'french bean': ['bean', 'string bean'],
	// Alliums — "small onion" normalizes to "onion" via modifier stripping
	shallot: ['onion'],
	// Don't add onion→shallot since that would make any onion match shallot
}

/**
 * Normalize ingredient name for fuzzy matching
 * - Converts to lowercase
 * - Trims whitespace
 * - Removes parenthetical notes
 * - Removes comma-separated preparation instructions
 * - Handles "or" and "/" alternatives (takes first option)
 * - Removes common modifiers (optional, fresh, dried, etc.)
 * - Handles pluralization
 */
export function normalizeIngredientName(name: string): string {
	let normalized = name.toLowerCase().trim()

	// Remove parenthetical notes: "flour (for tangzhong)" → "flour"
	normalized = normalized.replace(/\([^)]*\)/g, '').trim()

	// Remove comma-separated preparation instructions: "scallions, finely diced" → "scallions"
	// This handles cases like "beans, rinsed" or "onion, chopped"
	if (normalized.includes(',')) {
		normalized = normalized.split(',')[0]!.trim()
	}

	// Handle "or" alternatives: "plain flour or all purpose flour" → "plain flour"
	// Take the first option before "or"
	if (normalized.includes(' or ')) {
		normalized = normalized.split(' or ')[0]!.trim()
	}

	// Handle slash alternatives: "mirin/sake/white wine" → "mirin"
	// Take the first option before "/"
	if (normalized.includes('/')) {
		normalized = normalized.split('/')[0]!.trim()
	}

	// Remove common descriptive words that don't affect ingredient identity
	const modifiers = [
		// Freshness/state
		'fresh',
		'dried',
		'frozen',
		'canned',
		'raw',
		'cooked',
		'optional',
		// Preparation
		'chopped',
		'diced',
		'sliced',
		'minced',
		'grated',
		'shredded',
		'crushed',
		'whole',
		'halved',
		'quartered',
		// Size
		'large',
		'medium',
		'small',
		'extra large',
		'baby',
		'jumbo',
		// Color (for vegetables/produce)
		'yellow',
		'red',
		'green',
		'white',
		'orange',
		'purple',
		'brown',
		// Quality descriptors
		'ripe',
		'unripe',
		'firm',
		'soft',
		'neutral',
		'mild',
		'strong',
		'light',
		'dark',
		'extra virgin',
		'virgin',
		'pure',
		'unsalted',
		'salted',
		'sweetened',
		'unsweetened',
		// Sugar/grain types
		'granulated',
		'powdered',
		'confectioners',
		'superfine',
		'caster',
		'demerara',
		'turbinado',
		'muscovado',
		// Grain descriptors
		'long grain',
		'short grain',
		'jasmine',
		'basmati',
		'arborio',
	]
	for (const modifier of modifiers) {
		normalized = normalized.replace(new RegExp(`\\b${modifier}\\b`, 'gi'), '')
	}

	// Clean up extra spaces
	normalized = normalized.replace(/\s+/g, ' ').trim()

	// Better pluralization
	// Handle common irregular plurals
	const irregularPlurals: Record<string, string> = {
		tomatoes: 'tomato',
		potatoes: 'potato',
		knives: 'knife',
		loaves: 'loaf',
	}
	const irregular = irregularPlurals[normalized]
	if (irregular) {
		return irregular
	}

	// Handle -ies -> -y (berries -> berry)
	if (normalized.endsWith('ies')) {
		return normalized.slice(0, -3) + 'y'
	}

	// Handle -es -> '' for words ending in s, x, z, ch, sh
	if (
		normalized.endsWith('es') &&
		(normalized.endsWith('ses') ||
			normalized.endsWith('xes') ||
			normalized.endsWith('zes') ||
			normalized.endsWith('ches') ||
			normalized.endsWith('shes'))
	) {
		return normalized.slice(0, -2)
	}

	// Simple plural removal (remove trailing 's')
	if (normalized.endsWith('s') && normalized.length > 3) {
		return normalized.slice(0, -1)
	}

	return normalized
}

/**
 * Get a canonical name for an ingredient, mapping synonyms to a stable key.
 * Both "cilantro" and "coriander" map to the same canonical name,
 * enabling proper consolidation in shopping lists.
 */
export function getCanonicalIngredientName(name: string): string {
	const normalized = normalizeIngredientName(name)

	// Collect all equivalent names: the normalized name + its synonyms
	const equivalents = new Set<string>([normalized])
	const synonyms = INGREDIENT_SYNONYMS[normalized]
	if (synonyms) {
		for (const syn of synonyms) {
			equivalents.add(syn)
		}
	}

	// Sort alphabetically and return the first — gives a stable canonical key
	return [...equivalents].sort()[0]!
}

/**
 * Extract core ingredient word (first significant word after articles)
 */
function getCoreIngredientWord(name: string): string {
	const normalized = normalizeIngredientName(name)
	const words = normalized.split(' ').filter((w) => w.length > 2)

	// Skip articles and common small words
	const skipWords = ['a', 'an', 'the', 'of']
	for (const word of words) {
		if (!skipWords.includes(word)) {
			return word
		}
	}

	return normalized
}

/**
 * Check if an ingredient matches an inventory item using improved fuzzy matching
 */
export function ingredientMatchesInventoryItem(
	ingredient: Pick<Ingredient, 'name'>,
	inventoryItem: Pick<InventoryItem, 'name'>,
): boolean {
	const normalizedIngredient = normalizeIngredientName(ingredient.name)
	const normalizedInventory = normalizeIngredientName(inventoryItem.name)

	// Exact match after normalization
	if (normalizedIngredient === normalizedInventory) {
		return true
	}

	// Check for synonyms
	const synonymsForIngredient = INGREDIENT_SYNONYMS[normalizedIngredient] || []
	const synonymsForInventory = INGREDIENT_SYNONYMS[normalizedInventory] || []

	if (
		synonymsForIngredient.includes(normalizedInventory) ||
		synonymsForInventory.includes(normalizedIngredient)
	) {
		return true
	}

	// Get core ingredient words for both
	const ingredientCore = getCoreIngredientWord(ingredient.name)
	const inventoryCore = getCoreIngredientWord(inventoryItem.name)

	// Match on core words (prevents "rice" matching "rice vinegar")
	if (ingredientCore === inventoryCore) {
		return true
	}

	// Check if one is a multi-word version of the other
	// e.g., "butter" should match "unsalted butter" or "butter unsalted"
	// e.g., "cucumber" should match "fabio cucumber" or "persian cucumber"
	// But "rice" should NOT match "rice vinegar"
	const ingredientWords = normalizedIngredient.split(' ')
	const inventoryWords = normalizedInventory.split(' ')

	// If the shorter name is just one word, check if it matches the first OR last word
	// This handles both "unsalted butter" (match first) and "fabio cucumber" (match last)
	if (ingredientWords.length === 1 && inventoryWords.length > 1) {
		const word = ingredientWords[0]
		// Check first or last word (main ingredient is usually first or last)
		return (
			inventoryWords[0] === word ||
			inventoryWords[inventoryWords.length - 1] === word
		)
	}

	if (inventoryWords.length === 1 && ingredientWords.length > 1) {
		const word = inventoryWords[0]
		// Check first or last word (main ingredient is usually first or last)
		return (
			ingredientWords[0] === word ||
			ingredientWords[ingredientWords.length - 1] === word
		)
	}

	// For multi-word matches, check if one contains all words of the other
	if (ingredientWords.length > 1 && inventoryWords.length > 1) {
		const allIngredientWordsInInventory = ingredientWords.every((word) =>
			inventoryWords.includes(word),
		)
		const allInventoryWordsInIngredient = inventoryWords.every((word) =>
			ingredientWords.includes(word),
		)

		if (allIngredientWordsInInventory || allInventoryWordsInIngredient) {
			return true
		}
	}

	return false
}

export type RecipeMatch = {
	recipe: Recipe & {
		ingredients: Ingredient[]
		image?: { objectKey: string } | null
		tags?: Array<{ id: string; name: string }>
	}
	matchPercentage: number
	matchedIngredientsCount: number
	totalIngredientsCount: number
	missingIngredients: Ingredient[]
	canMake: boolean
}

/**
 * Check if an ingredient is a common staple that should be ignored in matching
 */
export function isStapleIngredient(
	ingredient: Pick<Ingredient, 'name'>,
): boolean {
	const normalized = normalizeIngredientName(ingredient.name)
	return STAPLE_INGREDIENTS.has(normalized)
}

/**
 * Match recipes against user's inventory
 * Returns recipes with match percentage and missing ingredients
 */
export function matchRecipesWithInventory(
	recipes: Array<
		Recipe & {
			ingredients: Ingredient[]
			image?: { objectKey: string } | null
			tags?: Array<{ id: string; name: string }>
		}
	>,
	inventoryItems: InventoryItem[],
): RecipeMatch[] {
	return recipes
		.map((recipe) => {
			// Filter out staple ingredients from the matching calculation
			const nonStapleIngredients = recipe.ingredients.filter(
				(ing) => !isStapleIngredient(ing),
			)

			const totalIngredientsCount = nonStapleIngredients.length
			let matchedIngredientsCount = 0
			const missingIngredients: Ingredient[] = []

			// Check each non-staple ingredient against inventory
			for (const ingredient of nonStapleIngredients) {
				const hasMatch = inventoryItems.some((item) =>
					ingredientMatchesInventoryItem(ingredient, item),
				)

				if (hasMatch) {
					matchedIngredientsCount++
				} else {
					missingIngredients.push(ingredient)
				}
			}

			const matchPercentage =
				totalIngredientsCount > 0
					? Math.round((matchedIngredientsCount / totalIngredientsCount) * 100)
					: 0

			const canMake = matchedIngredientsCount === totalIngredientsCount

			return {
				recipe,
				matchPercentage,
				matchedIngredientsCount,
				totalIngredientsCount,
				missingIngredients,
				canMake,
			}
		})
		.sort((a, b) => {
			// Sort by match percentage (descending)
			if (b.matchPercentage !== a.matchPercentage) {
				return b.matchPercentage - a.matchPercentage
			}
			// Then by total ingredients (fewer ingredients first)
			return a.totalIngredientsCount - b.totalIngredientsCount
		})
}
