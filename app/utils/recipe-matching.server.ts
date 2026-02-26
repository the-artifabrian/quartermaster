import { type Ingredient, type InventoryItem } from '@prisma/client'

/**
 * Common staple ingredients that are assumed to be available
 * These won't count against recipe matching percentage
 */
const STAPLE_INGREDIENTS = new Set([
	'water',
	'ice water',
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
	'cooking spray',
	'nonstick spray',
	'nonstick cooking spray',
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
	'beef stock': ['beef broth'],
	'beef broth': ['beef stock'],
	'vegetable stock': ['vegetable broth'],
	'vegetable broth': ['vegetable stock'],
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
	// Soy sauces — "dark soy sauce" and "light soy sauce" are protected compounds
	// (dark/light preserved), so they normalize to themselves, not "soy sauce".
	// tamari/shoyu are synonyms for generic "soy sauce" only.
	'soy sauce': ['tamari', 'shoyu'],
	tamari: ['soy sauce', 'shoyu'],
	shoyu: ['soy sauce', 'tamari'],
	// Proteins — bare "chicken" matches common cuts via synonyms.
	// Specific cuts do NOT match each other (breast ≠ thigh ≠ back).
	// Core-word matching is blocked for proteins via CUT_SENSITIVE_WORDS.
	chicken: ['chicken breast', 'chicken thigh'],
	'chicken breast': ['chicken'],
	'chicken thigh': ['chicken'],
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
	// "green beans" normalizes to "green bean" (protected compound, plural stripped).
	// "bean" (from other sources) still matches via multi-word last-word matching.
	bean: ['string bean', 'french bean'],
	'string bean': ['bean', 'french bean'],
	'french bean': ['bean', 'string bean'],
	// Alliums — "small onion" normalizes to "onion" via modifier stripping
	shallot: ['onion'],
	// Don't add onion→shallot since that would make any onion match shallot
	// Count-unit variants — "garlic cloves" normalizes to "garlic clove"
	'garlic clove': ['garlic'],
	garlic: ['garlic clove'],
	'celery stalk': ['celery'],
	celery: ['celery stalk'],
}

/**
 * Compound ingredients where color/type modifiers are part of the identity.
 * These are checked BEFORE modifier stripping — if the pre-stripped name
 * matches, modifiers are left intact.
 */
const PROTECTED_COMPOUNDS = new Set([
	'green onion',
	'green bean',
	'green pepper',
	'green chile',
	'green lentil',
	'green tea',
	'red onion',
	'red pepper',
	'red chile',
	'red lentil',
	'red wine',
	'red wine vinegar',
	'yellow onion',
	'yellow pepper',
	'white onion',
	'white pepper',
	'white wine',
	'white wine vinegar',
	'white bean',
	'white chocolate',
	'brown sugar',
	'brown rice',
	'brown butter',
	'brown lentil',
	'dark chocolate',
	'dark soy sauce',
	'light soy sauce',
	'black bean',
	'black tea',
	'hot sauce',
	'hot pepper',
	'hot dog',
	'cold brew',
])

// Common descriptive words that don't affect ingredient identity
const MODIFIERS = [
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
	// Meat descriptors
	'boneless',
	'skinless',
	'skin-on',
	'bone-in',
	// Temperature
	'cold',
	'warm',
	'hot',
	'lukewarm',
	'boiling',
	'room temperature',
	// Processing
	'smoked',
	'roasted',
	'toasted',
	'cracked',
	'freshly',
] as const

// Pre-compile modifier regexes once at module level (~50 regexes, not per call)
const MODIFIER_REGEXES = MODIFIERS.map((m) => ({
	modifier: m,
	regex: new RegExp(`\\b${m}\\b`, 'gi'),
}))

// Pre-compute which modifiers appear in each protected compound
const PROTECTED_COMPOUND_MODIFIERS = new Map<string, Set<string>>()
for (const compound of PROTECTED_COMPOUNDS) {
	const mods = new Set<string>()
	for (const m of MODIFIERS) {
		if (compound.includes(m)) {
			mods.add(m)
		}
	}
	if (mods.size > 0) {
		PROTECTED_COMPOUND_MODIFIERS.set(compound, mods)
	}
}

// Normalization cache — ingredient names repeat heavily across recipes
const normalizationCache = new Map<string, string>()

/**
 * Normalize ingredient name for fuzzy matching
 * - Converts to lowercase
 * - Trims whitespace
 * - Removes parenthetical notes
 * - Removes comma-separated preparation instructions
 * - Handles "or" and "/" alternatives (takes first option)
 * - Removes common modifiers (optional, fresh, dried, etc.)
 * - Handles pluralization
 *
 * Results are cached since ingredient names repeat heavily across recipes.
 */
export function normalizeIngredientName(name: string): string {
	const cached = normalizationCache.get(name)
	if (cached !== undefined) return cached

	let normalized = name.toLowerCase().trim()

	// Strip leading "of " from ingredient names: "of garlic" → "garlic"
	normalized = normalized.replace(/^of\s+/, '')

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

	// Strip trailing "to taste": "ginger to taste" → "ginger"
	normalized = normalized.replace(/\s+to\s+taste$/i, '')

	// Protect compound ingredients where modifiers are part of the identity.
	// Find which modifiers are "protected" (part of a compound like "green onion").
	const protectedModifiers = new Set<string>()
	// Check normalized text (and depluralized variant) against protected compounds
	const variants = [normalized]
	if (normalized.endsWith('s')) variants.push(normalized.slice(0, -1))
	for (const variant of variants) {
		for (const compound of PROTECTED_COMPOUNDS) {
			if (variant === compound || variant.endsWith(' ' + compound)) {
				// The compound's words include modifiers — protect them
				const mods = PROTECTED_COMPOUND_MODIFIERS.get(compound)
				if (mods) {
					for (const mod of mods) {
						protectedModifiers.add(mod)
					}
				}
			}
		}
	}
	for (const { modifier, regex } of MODIFIER_REGEXES) {
		if (protectedModifiers.has(modifier)) continue
		normalized = normalized.replace(regex, '')
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
		'bay leaves': 'bay leaf',
	}
	const irregular = irregularPlurals[normalized]
	if (irregular) {
		normalizationCache.set(name, irregular)
		return irregular
	}

	// Handle -ies -> -y (berries -> berry)
	if (normalized.endsWith('ies')) {
		const result = normalized.slice(0, -3) + 'y'
		normalizationCache.set(name, result)
		return result
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
		const result = normalized.slice(0, -2)
		normalizationCache.set(name, result)
		return result
	}

	// Simple plural removal (remove trailing 's')
	if (normalized.endsWith('s') && normalized.length > 3) {
		const result = normalized.slice(0, -1)
		normalizationCache.set(name, result)
		return result
	}

	normalizationCache.set(name, normalized)
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
 * Compounds where the bare core word is NOT equivalent to the compound.
 * e.g. "rice" is NOT "rice vinegar", "coconut" is NOT "coconut milk".
 */
const NON_EQUIVALENT_COMPOUNDS = new Map<string, string[]>([
	[
		'rice',
		['rice vinegar', 'rice wine', 'rice paper', 'rice noodle', 'rice flour'],
	],
	['sesame', ['sesame oil', 'sesame seed']],
	[
		'coconut',
		['coconut milk', 'coconut oil', 'coconut cream', 'coconut flour'],
	],
	['soy', ['soy sauce', 'soy milk']],
	['tomato', ['tomato paste', 'tomato sauce', 'tomato puree']],
	['peanut', ['peanut oil', 'peanut butter']],
	['almond', ['almond milk', 'almond flour', 'almond butter']],
	['chili', ['chili oil', 'chili paste', 'chili flake']],
])

/**
 * Core words for proteins where different compound forms are NOT interchangeable.
 * "chicken breast" should NOT match "chicken thigh" via core-word or
 * word-containment matching — only explicit synonyms or exact normalization.
 */
const CUT_SENSITIVE_WORDS = new Set([
	'chicken',
	'beef',
	'pork',
	'lamb',
	'turkey',
	'duck',
	'fish',
	'salmon',
	'tuna',
])

function isNonEquivalentCompoundMatch(
	normalizedA: string,
	normalizedB: string,
): boolean {
	if (normalizedA === normalizedB) return false
	// Check if either name is a bare core word and the other is a non-equivalent compound
	for (const [bareWord, compounds] of NON_EQUIVALENT_COMPOUNDS) {
		const aIsBare = normalizedA === bareWord
		const bIsBare = normalizedB === bareWord
		const aIsCompound = compounds.includes(normalizedA)
		const bIsCompound = compounds.includes(normalizedB)
		if ((aIsBare && bIsCompound) || (bIsBare && aIsCompound)) {
			return true
		}
	}
	return false
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

	// Match on core words, but exclude non-equivalent compounds and
	// cut-sensitive proteins (chicken breast ≠ chicken thigh)
	if (
		ingredientCore === inventoryCore &&
		!CUT_SENSITIVE_WORDS.has(ingredientCore) &&
		!isNonEquivalentCompoundMatch(normalizedIngredient, normalizedInventory)
	) {
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
	// But skip non-equivalent compounds like "rice" vs "rice vinegar"
	if (ingredientWords.length === 1 && inventoryWords.length > 1) {
		if (isNonEquivalentCompoundMatch(normalizedIngredient, normalizedInventory))
			return false
		if (CUT_SENSITIVE_WORDS.has(ingredientWords[0]!)) return false
		const word = ingredientWords[0]
		return (
			inventoryWords[0] === word ||
			inventoryWords[inventoryWords.length - 1] === word
		)
	}

	if (inventoryWords.length === 1 && ingredientWords.length > 1) {
		if (isNonEquivalentCompoundMatch(normalizedIngredient, normalizedInventory))
			return false
		if (CUT_SENSITIVE_WORDS.has(inventoryWords[0]!)) return false
		const word = inventoryWords[0]
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

/** Minimal recipe shape needed for matching and display */
export type MatchableRecipe = {
	id: string
	title: string
	description?: string | null
	prepTime?: number | null
	cookTime?: number | null
	servings?: number | null
	isFavorite?: boolean
	ingredients: Ingredient[]
	image?: { objectKey: string } | null
}

export type RecipeMatch<R extends MatchableRecipe = MatchableRecipe> = {
	recipe: R
	matchPercentage: number
	matchedIngredientsCount: number
	totalIngredientsCount: number
	canMake: boolean
}

/**
 * Check if an ingredient is a common staple that should be ignored in matching
 */
export function isStapleIngredient(
	ingredient: Pick<Ingredient, 'name'>,
): boolean {
	const normalized = normalizeIngredientName(ingredient.name)
	if (STAPLE_INGREDIENTS.has(normalized)) return true

	// Compound splitting: "salt and black pepper" → ["salt", "black pepper"]
	const parts = normalized.split(/\s+(?:and|&)\s+/)
	if (parts.length > 1) {
		return parts.every((part) => STAPLE_INGREDIENTS.has(part.trim()))
	}

	return false
}

/**
 * Check if an ingredient is marked as optional in its notes field.
 * Optional ingredients are excluded from inventory matching and shopping lists.
 */
export function isOptionalIngredient(
	ingredient: Pick<Ingredient, 'notes'> & Partial<Pick<Ingredient, 'name'>>,
): boolean {
	if (ingredient.notes && /\boptional\b/i.test(ingredient.notes)) return true
	if (ingredient.name && /\boptional\b/i.test(ingredient.name)) return true
	return false
}

/**
 * Pre-built lookup structure for O(1) inventory matching.
 * Instead of scanning all inventory items for each ingredient,
 * we pre-normalize all inventory names and build sets for fast lookup.
 */
type InventoryLookup = {
	/** Normalized inventory item names */
	normalizedNames: Set<string>
	/** All synonym expansions of inventory items */
	synonymNames: Set<string>
	/** Core words from inventory items (for core-word matching) */
	coreWords: Set<string>
	/** Map from normalized name to item, for non-equivalent compound checks */
	normalizedToItem: Map<string, Pick<InventoryItem, 'name'>>
	/** The full available items list, for rare multi-word fallback */
	items: Array<Pick<InventoryItem, 'name'>>
}

export function buildInventoryLookup(
	items: Array<Pick<InventoryItem, 'name'>>,
): InventoryLookup {
	const normalizedNames = new Set<string>()
	const synonymNames = new Set<string>()
	const coreWords = new Set<string>()
	const normalizedToItem = new Map<string, Pick<InventoryItem, 'name'>>()

	for (const item of items) {
		const normalized = normalizeIngredientName(item.name)
		normalizedNames.add(normalized)
		normalizedToItem.set(normalized, item)

		// Add all synonyms
		const synonyms = INGREDIENT_SYNONYMS[normalized]
		if (synonyms) {
			for (const syn of synonyms) {
				synonymNames.add(syn)
			}
		}

		// Add core word
		const core = getCoreIngredientWord(item.name)
		coreWords.add(core)
	}

	return { normalizedNames, synonymNames, coreWords, normalizedToItem, items }
}

/**
 * Check if an ingredient matches ANY inventory item using the pre-built lookup.
 * Uses O(1) set lookups for the common case, falls back to per-item comparison
 * only for multi-word containment matching.
 */
export function ingredientMatchesAnyInventoryItem(
	ingredient: Pick<Ingredient, 'name'>,
	lookup: InventoryLookup,
): boolean {
	const normalizedIngredient = normalizeIngredientName(ingredient.name)

	// 1. Exact match after normalization — O(1) set lookup
	if (lookup.normalizedNames.has(normalizedIngredient)) {
		return true
	}

	// 2. Synonym match — check if any inventory synonym matches the ingredient
	const synonymsForIngredient = INGREDIENT_SYNONYMS[normalizedIngredient] || []
	for (const syn of synonymsForIngredient) {
		if (lookup.normalizedNames.has(syn)) {
			return true
		}
	}
	// Check if the ingredient is a synonym of any inventory item
	if (lookup.synonymNames.has(normalizedIngredient)) {
		return true
	}

	// 3. Core word match — O(1) set lookup
	const ingredientCore = getCoreIngredientWord(ingredient.name)
	if (lookup.coreWords.has(ingredientCore)) {
		// But need to verify it's not a non-equivalent compound match
		// Find the matching inventory item by core word and check
		for (const [invNorm, invItem] of lookup.normalizedToItem) {
			const invCore = getCoreIngredientWord(invItem.name)
			if (
				ingredientCore === invCore &&
				!isNonEquivalentCompoundMatch(normalizedIngredient, invNorm)
			) {
				return true
			}
		}
	}

	// 4. Multi-word containment — fall back to per-item comparison for edge cases
	const ingredientWords = normalizedIngredient.split(' ')
	for (const invItem of lookup.items) {
		const normalizedInventory = normalizeIngredientName(invItem.name)
		const inventoryWords = normalizedInventory.split(' ')

		// Single ingredient word vs multi-word inventory
		if (ingredientWords.length === 1 && inventoryWords.length > 1) {
			if (
				isNonEquivalentCompoundMatch(normalizedIngredient, normalizedInventory)
			)
				continue
			const word = ingredientWords[0]
			if (
				inventoryWords[0] === word ||
				inventoryWords[inventoryWords.length - 1] === word
			)
				return true
		}

		// Multi-word ingredient vs single inventory word
		if (inventoryWords.length === 1 && ingredientWords.length > 1) {
			if (
				isNonEquivalentCompoundMatch(normalizedIngredient, normalizedInventory)
			)
				continue
			const word = inventoryWords[0]
			if (
				ingredientWords[0] === word ||
				ingredientWords[ingredientWords.length - 1] === word
			)
				return true
		}

		// Multi-word vs multi-word containment
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
	}

	return false
}

/**
 * Match recipes against user's inventory
 * Returns recipes with match percentage and missing ingredients
 */
export function matchRecipesWithInventory<R extends MatchableRecipe>(
	recipes: R[],
	inventoryItems: Array<Pick<InventoryItem, 'name'>>,
): RecipeMatch<R>[] {
	// Pre-build lookup structure for O(1) matching instead of O(n) per ingredient
	const lookup = buildInventoryLookup(inventoryItems)

	return recipes
		.map((recipe) => {
			// Filter out headings, staples, and optional ingredients from matching
			const nonStapleIngredients = recipe.ingredients.filter(
				(ing) =>
					!ing.isHeading &&
					!isStapleIngredient(ing) &&
					!isOptionalIngredient(ing),
			)

			const totalIngredientsCount = nonStapleIngredients.length
			let matchedIngredientsCount = 0

			// Check each non-staple ingredient against inventory via lookup
			for (const ingredient of nonStapleIngredients) {
				if (ingredientMatchesAnyInventoryItem(ingredient, lookup)) {
					matchedIngredientsCount++
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
