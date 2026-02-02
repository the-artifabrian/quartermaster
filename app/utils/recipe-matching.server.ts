import { type Recipe, type Ingredient, type InventoryItem } from '@prisma/client'

/**
 * Common ingredient synonyms for better matching
 */
const INGREDIENT_SYNONYMS: Record<string, string[]> = {
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
}

/**
 * Normalize ingredient name for fuzzy matching
 * - Converts to lowercase
 * - Trims whitespace
 * - Removes parenthetical notes
 * - Handles "or" and "/" alternatives (takes first option)
 * - Removes common modifiers (optional, fresh, dried, etc.)
 * - Handles pluralization
 */
export function normalizeIngredientName(name: string): string {
	let normalized = name.toLowerCase().trim()

	// Remove parenthetical notes: "flour (for tangzhong)" → "flour"
	normalized = normalized.replace(/\([^)]*\)/g, '').trim()

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
		'fresh',
		'dried',
		'frozen',
		'canned',
		'optional',
		'chopped',
		'diced',
		'sliced',
		'minced',
		'grated',
		'shredded',
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
function ingredientMatchesInventoryItem(
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
	// But "rice" should NOT match "rice vinegar"
	const ingredientWords = normalizedIngredient.split(' ')
	const inventoryWords = normalizedInventory.split(' ')

	// If the shorter name is just one word, it must match a word in the longer name
	// AND be the first significant word (not a modifier like "vinegar" in "rice vinegar")
	if (ingredientWords.length === 1 && inventoryWords.length > 1) {
		// Check if ingredient word is the FIRST word in inventory
		return inventoryWords[0] === ingredientWords[0]
	}

	if (inventoryWords.length === 1 && ingredientWords.length > 1) {
		// Check if inventory word is the FIRST word in ingredient
		return ingredientWords[0] === inventoryWords[0]
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
			const totalIngredientsCount = recipe.ingredients.length
			let matchedIngredientsCount = 0
			const missingIngredients: Ingredient[] = []

			// Check each ingredient against inventory
			for (const ingredient of recipe.ingredients) {
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
