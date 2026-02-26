import { type Ingredient } from '@prisma/client'
import {
	isOptionalIngredient,
	isStapleIngredient,
	normalizeIngredientName,
} from '#app/utils/recipe-matching.server.ts'

// --- Recipe classification via title heuristics ---

const CONDIMENT_HEAD_NOUNS = new Set([
	'sauce',
	'mayo',
	'mayonnaise',
	'dressing',
	'vinaigrette',
	'aioli',
	'pesto',
	'salsa',
	'glaze',
	'marinade',
	'rub',
	'chutney',
	'relish',
	'gravy',
	'coulis',
	'reduction',
	'drizzle',
	'topping',
	'spread',
	'syrup',
	'ketchup',
	'jam',
	'jelly',
	'preserve',
	'preserves',
	'compote',
	'hummus',
	'guacamole',
	'tzatziki',
	'raita',
	'chimichurri',
	'gremolata',
])

// Also catch pickled/preserved items as condiments
const CONDIMENT_WORDS = new Set(['pickles', 'pickled'])

/** Beverages — hard-filtered from all meal types like condiments */
const BEVERAGE_WORDS = new Set([
	'limoncello',
	'cocktail',
	'smoothie',
	'lemonade',
	'punch',
	'sangria',
	'margarita',
	'mojito',
	'daiquiri',
	'spritz',
	'eggnog',
	'cider',
	'kombucha',
	'latte',
	'espresso',
	'milkshake',
	'horchata',
	'lassi',
	'chai',
])

const DESSERT_HEAD_NOUNS = new Set([
	'tart',
	'cake',
	'pie',
	'galette',
	'pudding',
	'mousse',
	'crumble',
	'crisp',
	'cobbler',
	'sorbet',
	'fudge',
	'cheesecake',
	'tiramisu',
	'brownie',
	'brownies',
	'cookie',
	'cookies',
	'cupcake',
	'cupcakes',
	'muffin',
	'muffins',
	'scone',
	'scones',
	'donut',
	'donuts',
	'parfait',
])

const SIDE_HEAD_NOUNS = new Set([
	'rice',
	'spaetzle',
	'coleslaw',
	'slaw',
	'naan',
	'focaccia',
	'cornbread',
	'polenta',
	'grits',
])

const PROTEIN_WORDS = new Set([
	'chicken',
	'beef',
	'pork',
	'lamb',
	'fish',
	'salmon',
	'shrimp',
	'tofu',
	'steak',
	'turkey',
	'duck',
	'sausage',
	'meatball',
	'meatballs',
	'meatloaf',
	'ribs',
	'brisket',
	'tenderloin',
	'drumstick',
	'drumsticks',
	'thigh',
	'thighs',
	'breast',
	'wing',
	'wings',
	'prawn',
	'prawns',
	'scallop',
	'scallops',
	'crab',
	'lobster',
	'clam',
	'clams',
	'mussel',
	'mussels',
	'tempeh',
	'seitan',
])

const MAIN_DISH_WORDS = new Set([
	'curry',
	'stew',
	'chili',
	'casserole',
	'lasagna',
	'lasagne',
	'soup',
	'burger',
	'burgers',
	'tacos',
	'taco',
	'ramen',
	'risotto',
	'paella',
	'biryani',
	'enchilada',
	'enchiladas',
	'burrito',
	'burritos',
	'quesadilla',
	'quesadillas',
	'pizza',
	'pasta',
	'spaghetti',
	'fettuccine',
	'penne',
	'linguine',
	'carbonara',
	'bolognese',
	'goulash',
	'tagine',
	'rendang',
	'katsu',
	'gyoza',
	'dumpling',
	'dumplings',
	'potpie',
	'sandwich',
	'sandwiches',
	'wrap',
	'wraps',
	'bowl',
	'skillet',
	'roast',
	'braise',
	'braised',
	'stuffed',
])

const MAIN_DISH_PHRASES = [
	'pad thai',
	'lo mein',
	'chow mein',
	'fried rice',
	'pot roast',
	'pot pie',
	'mac and cheese',
	'pulled pork',
	'kung pao',
	'general tso',
	'tikka masala',
	'butter chicken',
	'orange chicken',
	'sesame chicken',
	'beef stir fry',
	'chicken stir fry',
	'stir fry',
	'shepherd pie',
	'shepherds pie',
	"shepherd's pie",
	'biscuits and gravy',
]

const BREAKFAST_WORDS = new Set([
	'pancake',
	'pancakes',
	'waffle',
	'waffles',
	'omelette',
	'omelet',
	'oatmeal',
	'frittata',
	'quiche',
	'granola',
	'porridge',
	'crepe',
	'crepes',
	'shakshuka',
	'breakfast',
])

const BREAKFAST_PHRASES = [
	'french toast',
	'eggs benedict',
	'overnight oats',
	'breakfast burrito',
	'breakfast sandwich',
	'scrambled eggs',
	'fried egg',
	'fried eggs',
	'poached egg',
	'poached eggs',
	'hash brown',
	'hash browns',
	'smoothie bowl',
	'acai bowl',
]

/** Dessert words detected anywhere in title (not just head noun).
 *  Catches "carrot cake loaf", "brownie bites", etc.
 *  Only checked AFTER protein/main indicators, so "chicken pot pie" stays main. */
const DESSERT_WORDS = new Set([
	'cake',
	'brownie',
	'brownies',
	'cookie',
	'cookies',
	'cupcake',
	'cupcakes',
	'cheesecake',
	'tiramisu',
	'muffin',
	'muffins',
	'scone',
	'scones',
	'donut',
	'donuts',
	'pastry',
	'macaron',
	'macarons',
	'meringue',
])

type RecipeCategory =
	| 'main'
	| 'condiment'
	| 'dessert'
	| 'side'
	| 'breakfast'
	| 'beverage'
	| 'unclassified'

/**
 * Classify a recipe by its title using head-noun heuristics.
 *
 * Priority order:
 * 1. Multi-word phrases — highest confidence ("pot pie", "biscuits and gravy")
 * 2. Head noun condiment/beverage — hard-filtered categories ("sauce", "glaze")
 * 3. Condiment words anywhere ("pickles", "pickled")
 * 4. Single-word protein/main/breakfast indicators
 * 5. Single-word beverage/dessert indicators
 * 6. Head noun dessert/side
 */
export function classifyRecipe(title: string): RecipeCategory {
	const lower = title.toLowerCase()
	// Split on whitespace/hyphens/dashes, strip trailing punctuation from each word
	const words = lower
		.split(/[\s\-–—]+/)
		.map((w) => w.replace(/[^a-z]/g, ''))
		.filter(Boolean)

	// 1. Phrases first — multi-word matches are highest confidence and override
	// head-noun classification (e.g. "biscuits and gravy" is a meal, not a condiment)
	for (const phrase of MAIN_DISH_PHRASES) {
		if (lower.includes(phrase)) return 'main'
	}
	for (const phrase of BREAKFAST_PHRASES) {
		if (lower.includes(phrase)) return 'breakfast'
	}

	// 2. Head noun condiment/beverage — "Gyoza dipping sauce" should be condiment
	// even though "gyoza" is a main-dish word. The last word determines the actual
	// dish type when it's a condiment/beverage term.
	const headNoun = words[words.length - 1]
	if (headNoun) {
		if (CONDIMENT_HEAD_NOUNS.has(headNoun)) return 'condiment'
		if (BEVERAGE_WORDS.has(headNoun)) return 'beverage'
	}

	// 3. Condiment words anywhere in title (e.g. "quick cucumber pickles")
	for (const word of words) {
		if (CONDIMENT_WORDS.has(word)) return 'condiment'
	}

	// 4. Single-word positive indicators
	for (const word of words) {
		if (PROTEIN_WORDS.has(word)) return 'main'
	}
	for (const word of words) {
		if (MAIN_DISH_WORDS.has(word)) return 'main'
	}
	for (const word of words) {
		if (BREAKFAST_WORDS.has(word)) return 'breakfast'
	}

	// 5. Beverage/dessert words anywhere in title (catches non-final beverage
	// words like "chai" in "Chai with Cream"; final-position already caught above)
	for (const word of words) {
		if (BEVERAGE_WORDS.has(word)) return 'beverage'
	}
	for (const word of words) {
		if (DESSERT_WORDS.has(word)) return 'dessert'
	}

	// 6. Head noun classification for remaining categories
	if (headNoun) {
		if (DESSERT_HEAD_NOUNS.has(headNoun)) return 'dessert'
		if (SIDE_HEAD_NOUNS.has(headNoun)) return 'side'
	}

	return 'unclassified'
}

// --- Meal type fit scoring ---

type MealType = 'dinner' | 'lunch' | 'breakfast' | 'snack'

// Scoring matrix: category → mealType → score
const MEAL_TYPE_SCORES: Record<RecipeCategory, Record<MealType, number>> = {
	main: { dinner: 1.0, lunch: 1.0, breakfast: 0.2, snack: 0.3 },
	dessert: { dinner: 0.15, lunch: 0.2, breakfast: 0.6, snack: 0.9 },
	breakfast: { dinner: 0.2, lunch: 0.5, breakfast: 1.0, snack: 0.6 },
	side: { dinner: 0.2, lunch: 0.2, breakfast: 0.2, snack: 0.6 },
	condiment: { dinner: 0, lunch: 0, breakfast: 0, snack: 0 },
	beverage: { dinner: 0, lunch: 0, breakfast: 0, snack: 0 },
	// Unclassified handled separately based on ingredient count
	unclassified: { dinner: 0, lunch: 0, breakfast: 0, snack: 0 },
}

/** Minimum fit score to suggest a recipe. Below this, better to leave slot empty. */
export const MIN_FIT_THRESHOLD = 0.35

/**
 * Score how well a recipe fits a given meal type (0-1).
 * Condiments always return 0 (hard filter).
 */
export function scoreMealTypeFit(
	title: string,
	ingredientCount: number,
	mealType: string,
): number {
	const category = classifyRecipe(title)
	const mt = (mealType as MealType) || 'dinner'

	if (category === 'condiment' || category === 'beverage') return 0

	if (category === 'unclassified') {
		if (ingredientCount >= 4) {
			return mt === 'dinner' || mt === 'lunch' ? 0.7 : 0.5
		} else {
			return mt === 'lunch' ? 0.4 : mt === 'dinner' ? 0.3 : 0.5
		}
	}

	return MEAL_TYPE_SCORES[category][mt] ?? 0.5
}

// --- Variety checking ---

const PROTEIN_KEYWORDS = [
	'chicken',
	'beef',
	'pork',
	'lamb',
	'fish',
	'salmon',
	'shrimp',
	'prawn',
	'tofu',
	'turkey',
	'duck',
	'sausage',
	'tempeh',
	'seitan',
	'crab',
	'lobster',
	'scallop',
	'tuna',
	'cod',
	'tilapia',
	'halibut',
	'mahi',
	'trout',
]

/** Words that turn a protein into a non-protein compound ingredient.
 *  "chicken broth", "fish sauce", "duck fat" → not actual proteins. */
const NON_PROTEIN_SUFFIXES = new Set([
	'broth',
	'stock',
	'sauce',
	'oil',
	'fat',
	'dripping',
	'drippings',
	'powder',
	'seasoning',
	'bouillon',
	'extract',
	'paste',
])

/**
 * Check if a normalized ingredient name represents an actual protein,
 * not a compound like "chicken broth" or "fish sauce".
 */
function isProteinIngredient(normalized: string, protein: string): boolean {
	if (normalized === protein) return true
	const words = normalized.split(' ')
	if (!words.includes(protein)) return false
	return !words.some((w) => NON_PROTEIN_SUFFIXES.has(w))
}

/**
 * Extract the primary protein from a recipe's ingredients.
 * Returns the first protein keyword found, or null.
 */
export function extractPrimaryProtein(
	ingredients: Array<Pick<Ingredient, 'name' | 'isHeading' | 'notes'>>,
): string | null {
	for (const ing of ingredients) {
		if (ing.isHeading) continue
		if (isStapleIngredient(ing)) continue
		if (isOptionalIngredient(ing)) continue

		const normalized = normalizeIngredientName(ing.name)
		for (const protein of PROTEIN_KEYWORDS) {
			if (isProteinIngredient(normalized, protein)) {
				return protein
			}
		}
	}
	return null
}

/**
 * Get normalized ingredient set for a recipe, excluding headings/staples/optional.
 */
export function getNormalizedIngredientSet(
	ingredients: Array<Pick<Ingredient, 'name' | 'isHeading' | 'notes'>>,
): Set<string> {
	const result = new Set<string>()
	for (const ing of ingredients) {
		if (ing.isHeading) continue
		if (isStapleIngredient(ing)) continue
		if (isOptionalIngredient(ing)) continue
		result.add(normalizeIngredientName(ing.name))
	}
	return result
}

/**
 * Compute Jaccard similarity between two sets.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 0
	let intersection = 0
	for (const item of a) {
		if (b.has(item)) intersection++
	}
	const union = a.size + b.size - intersection
	return union === 0 ? 0 : intersection / union
}

type VarietyState = {
	proteinCounts: Map<string, number>
	ingredientSets: Array<Set<string>>
}

export function createVarietyState(): VarietyState {
	return {
		proteinCounts: new Map(),
		ingredientSets: [],
	}
}

/**
 * Check if a candidate recipe is too similar to already-selected recipes.
 * - Same protein appears 2+ times already → too similar
 * - Jaccard similarity > 0.5 with any selected recipe → too similar
 */
export function isTooSimilar(
	candidateIngredients: Array<
		Pick<Ingredient, 'name' | 'isHeading' | 'notes'>
	>,
	state: VarietyState,
): boolean {
	// Check protein duplication
	const protein = extractPrimaryProtein(candidateIngredients)
	if (protein) {
		const count = state.proteinCounts.get(protein) ?? 0
		if (count >= 2) return true
	}

	// Check ingredient overlap
	const candidateSet = getNormalizedIngredientSet(candidateIngredients)
	for (const existingSet of state.ingredientSets) {
		if (jaccardSimilarity(candidateSet, existingSet) > 0.5) {
			return true
		}
	}

	return false
}

/**
 * Record a selected recipe into the variety state for future checks.
 */
export function recordSelection(
	ingredients: Array<Pick<Ingredient, 'name' | 'isHeading' | 'notes'>>,
	state: VarietyState,
): void {
	const protein = extractPrimaryProtein(ingredients)
	if (protein) {
		state.proteinCounts.set(
			protein,
			(state.proteinCounts.get(protein) ?? 0) + 1,
		)
	}
	state.ingredientSets.push(getNormalizedIngredientSet(ingredients))
}
