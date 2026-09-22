import { type Ingredient } from '#app/generated/prisma/client.ts'

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
	// Ground proteins — "ground" changes the product category, not just preparation
	'ground chicken',
	'ground beef',
	'ground pork',
	'ground turkey',
	'ground lamb',
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
	'ground',
	'grated',
	'shredded',
	'crushed',
	'mashed',
	'peeled',
	'deveined',
	'trimmed',
	'pitted',
	'seeded',
	'julienned',
	'cubed',
	'torn',
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

// Set of single-word modifiers for quick lookup (used in "or" split heuristic)
const SINGLE_MODIFIER_WORDS = new Set(MODIFIERS.filter((m) => !m.includes(' ')))

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

// Normalization cache — ingredient names repeat heavily across recipes.
// Bounded with FIFO eviction (same idiom as the event dedup set in
// household-event-source.client.tsx): the key is an arbitrary user-supplied
// ingredient name, so an unbounded cache ratchets for the life of the server
// process. The 512MB production box has already lost two rounds to slow heap
// growth (see server/memory-watchdog.ts), and a cache keyed on user text is
// exactly that shape. The working set is one household's ingredient
// vocabulary — a few hundred names — so this ceiling never evicts in practice.
const NORMALIZATION_CACHE_MAX = 5000
const normalizationCache = new Map<string, string>()

function cacheNormalization(name: string, normalized: string): string {
	if (normalizationCache.size >= NORMALIZATION_CACHE_MAX) {
		// Delete oldest (first inserted)
		const oldest = normalizationCache.keys().next().value
		if (oldest !== undefined) normalizationCache.delete(oldest)
	}
	normalizationCache.set(name, normalized)
	return normalized
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
	// Take the first option before "or", BUT skip when the first part is only
	// modifiers/numbers (e.g. "large or 2 medium yellow onions" — the "or" is
	// a quantity alternative, not an ingredient alternative).
	let hasQuantityOr = false
	if (normalized.includes(' or ')) {
		const firstPart = normalized.split(' or ')[0]!.trim()
		const isOnlyModifiersOrNumbers = firstPart
			.split(/\s+/)
			.every((w) => SINGLE_MODIFIER_WORDS.has(w) || /^\d+([./]\d+)?$/.test(w))
		if (!isOnlyModifiersOrNumbers) {
			normalized = firstPart
		} else {
			hasQuantityOr = true
		}
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

	// Strip compound prep phrases like "separated into bite-sized florets"
	normalized = normalized.replace(
		/\s+(?:separated|cut|torn|broken|divided|pulled|trimmed)\s+(?:into|in|for)\s+.+$/i,
		'',
	)

	// Strip standalone numbers and "or" that leak from quantity descriptions
	// e.g. "large or 2 medium yellow onions" → after modifier stripping → "or 2 yellow onion"
	if (hasQuantityOr) {
		normalized = normalized.replace(/\b\d+([./]\d+)?\b/g, '')
		normalized = normalized.replace(/\bor\b/g, '')
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
		return cacheNormalization(name, irregular)
	}

	// Handle -ies -> -y (berries -> berry)
	if (normalized.endsWith('ies')) {
		const result = normalized.slice(0, -3) + 'y'
		return cacheNormalization(name, result)
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
		return cacheNormalization(name, result)
	}

	// Simple plural removal (remove trailing 's')
	if (normalized.endsWith('s') && normalized.length > 3) {
		const result = normalized.slice(0, -1)
		return cacheNormalization(name, result)
	}

	return cacheNormalization(name, normalized)
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
 * Optional ingredients are excluded from generated Shopping demand.
 */
export function isOptionalIngredient(
	ingredient: Pick<Ingredient, 'notes'> & Partial<Pick<Ingredient, 'name'>>,
): boolean {
	if (ingredient.notes && /\boptional\b/i.test(ingredient.notes)) return true
	if (ingredient.name && /\boptional\b/i.test(ingredient.name)) return true
	return false
}
