import { type Recipe, type Ingredient } from '@prisma/client'
import {
	getCanonicalIngredientName,
	isStapleIngredient,
} from './recipe-matching.server.ts'
import {
	consolidateQuantities,
	scaleAmountString,
} from './shopping-list.server.ts'

/**
 * Ingredients that don't benefit from advance preparation.
 * These are shelf-stable items you just measure/pour — not items you
 * chop, peel, or otherwise physically prep.
 *
 * Uses post-normalization canonical names (lowercase, modifiers stripped).
 * Separate from STAPLE_INGREDIENTS in recipe-matching so these still
 * appear on shopping lists and count toward recipe match percentages.
 */
const NON_PREPPABLE_INGREDIENTS = new Set([
	// Sauces & condiments (canonical: shoyu < soy sauce < tamari)
	'shoyu',
	'fish sauce',
	'oyster sauce',
	'worcestershire sauce',
	'hot sauce',
	'sriracha',
	'ketchup',
	'mustard',
	'hoisin sauce',
	'teriyaki sauce',
	'tomato paste',
	'tomato sauce',
	'chili paste',
	'miso',
	'tahini',
	'mayonnaise',

	// Oils (beyond cooking oils already in STAPLE_INGREDIENTS)
	'sesame oil',
	'coconut oil',
	'avocado oil', // also covers peanut oil (synonym → avocado oil)
	'chili oil',

	// Vinegars
	'vinegar',
	'rice vinegar',
	'balsamic vinegar',
	'apple cider vinegar',
	'wine vinegar',
	'sherry vinegar',

	// Sugars & sweeteners (canonical: icing sugar < sugar)
	'icing sugar',
	'honey',
	'maple syrup',
	'agave',
	'molass', // canonical: "molasses" → "molass" via pluralization stripping
	'corn syrup',

	// Wines & cooking alcohols
	'wine',
	'rice wine',
	'mirin', // also covers sake (synonym → mirin)
	'sherry',
	'cooking wine',

	// Dairy staples (measured/scooped, not prepped)
	'butter',
	'milk',
	'cream',
	'heavy cream',
	'sour cream',
	'greek yogurt', // canonical: yogurt → greek yogurt (synonym)

	// Flours & starches
	'all-purpose flour', // canonical: flour → all-purpose flour (synonym)
	'corn starch', // canonical: cornstarch → corn starch
	'baking soda',
	'baking powder',

	// Dried spices & seasonings
	'cumin',
	'paprika',
	'chili powder',
	'curry powder',
	'turmeric',
	'oregano',
	'thyme',
	'cinnamon',
	'nutmeg',
	'cayenne',
	'pepper flake', // canonical: "red pepper flakes" → "pepper flake" (red stripped, depluralized)
	'bay leaf',
	'garlic powder',
	'onion powder',

	// Dried blends
	'italian seasoning',

	// Seeds (just measured/sprinkled)
	'sesame seed',

	// Other pantry items
	'vanilla extract',
	'broth', // also covers stock (synonym → broth)
	'breadcrumb', // canonical: breadcrumbs → breadcrumb (depluralized)
	'cocoa powder',
	'coconut milk',
])

/**
 * Storage tips keyed by canonical ingredient name.
 * Covers common preppable ingredients with practical fridge/freezer advice.
 */
const STORAGE_TIPS = new Map<string, string>([
	// Alliums
	['garlic', 'Airtight container in fridge, up to 3 days'],
	['onion', 'Airtight container in fridge, up to 5 days'],
	['ginger', 'Wrapped in plastic wrap in fridge, up to 1 week'],
	['leek', 'Wrapped in damp paper towel in fridge, up to 3 days'],
	['shallot', 'Airtight container in fridge, up to 5 days'],
	// Root vegetables
	['carrot', 'Submerged in water in fridge, up to 1 week'],
	['celery', 'Wrapped in foil in fridge, up to 2 weeks'],
	['potato', 'Cool dark place; do not refrigerate raw'],
	// Peppers
	['bell pepper', 'Airtight container in fridge, up to 4 days'],
	// Cruciferous
	['broccoli', 'Airtight container in fridge, up to 3 days'],
	['cauliflower', 'Airtight container in fridge, up to 4 days'],
	['cabbage', 'Airtight container in fridge, up to 5 days'],
	// Proteins
	['chicken', 'Covered in fridge, cook within 2 days'],
	['chicken breast', 'Covered in fridge, cook within 2 days'],
	['chicken thigh', 'Covered in fridge, cook within 2 days'],
	['beef', 'Covered in fridge, cook within 2 days'],
	['pork', 'Covered in fridge, cook within 2 days'],
	['salmon', 'Covered in fridge, cook within 1 day'],
	['shrimp', 'Covered in fridge, cook within 1 day'],
	['tofu', 'Submerged in water in fridge, change water daily, up to 3 days'],
	// Other produce
	['mushroom', 'Paper bag in fridge, up to 5 days'],
	['zucchini', 'Airtight container in fridge, up to 4 days'],
	['cucumber', 'Wrapped in paper towel in fridge, up to 3 days'],
	['tomato', 'Room temperature until cut; cut tomato in fridge, up to 2 days'],
	['spinach', 'Paper towel–lined container in fridge, up to 3 days'],
	['kale', 'Paper towel–lined container in fridge, up to 5 days'],
	['corn', 'Airtight container in fridge, up to 3 days'],
	// Herbs
	['parsley', 'Stems in water in fridge, loosely covered, up to 1 week'],
	['chinese parsley', 'Stems in water in fridge, loosely covered, up to 1 week'],
	['basil', 'Stems in water at room temperature, up to 1 week'],
	['mint', 'Stems in water in fridge, loosely covered, up to 1 week'],
	// Other
	['avocado', 'Rub cut side with lemon, wrap tightly, fridge up to 1 day'],
	['lemon', 'Airtight container in fridge, up to 4 days once cut'],
	['lime', 'Airtight container in fridge, up to 4 days once cut'],
	['egg', 'Keep in shell in fridge; hard-boiled up to 1 week'],
])

/**
 * Known prep verbs to extract from ingredient notes.
 * Multi-word patterns checked first so "thinly sliced" matches before "sliced".
 */
const PREP_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
	{ pattern: /\bthinly sliced\b/i, label: 'Thinly sliced' },
	{ pattern: /\bfinely chopped\b/i, label: 'Finely chopped' },
	{ pattern: /\bfinely diced\b/i, label: 'Finely diced' },
	{ pattern: /\broughly chopped\b/i, label: 'Roughly chopped' },
	{ pattern: /\bfinely minced\b/i, label: 'Finely minced' },
	{ pattern: /\bminced\b/i, label: 'Minced' },
	{ pattern: /\bdiced\b/i, label: 'Diced' },
	{ pattern: /\bsliced\b/i, label: 'Sliced' },
	{ pattern: /\bchopped\b/i, label: 'Chopped' },
	{ pattern: /\bgrated\b/i, label: 'Grated' },
	{ pattern: /\bjulienned\b/i, label: 'Julienned' },
	{ pattern: /\bcrushed\b/i, label: 'Crushed' },
	{ pattern: /\bcubed\b/i, label: 'Cubed' },
	{ pattern: /\bhalved\b/i, label: 'Halved' },
	{ pattern: /\bquartered\b/i, label: 'Quartered' },
	{ pattern: /\bpeeled\b/i, label: 'Peeled' },
	{ pattern: /\bzested\b/i, label: 'Zested' },
	{ pattern: /\btorn\b/i, label: 'Torn' },
	{ pattern: /\bshredded\b/i, label: 'Shredded' },
]

/**
 * Extract a prep method from ingredient notes.
 * Returns null for non-prep notes like "room temperature" or "to taste".
 */
export function extractPrepMethod(notes: string | null): string | null {
	if (!notes) return null
	for (const { pattern, label } of PREP_PATTERNS) {
		if (pattern.test(notes)) return label
	}
	return null
}

type RecipeWithIngredients = Recipe & { ingredients: Ingredient[] }

export type PrepEntry = {
	recipe: RecipeWithIngredients
	servings: number | null
	date: Date
	mealType: string
}

export type PrepItemUsage = {
	recipeTitle: string
	date: Date
	mealType: string
	quantity: string | null
	unit: string | null
	notes: string | null
}

export type PrepMethodGroup = {
	method: string
	totalQuantity: string | null
	totalUnit: string | null
	recipes: string[]
}

export type PrepItem = {
	ingredientName: string
	canonicalName: string
	totalQuantity: string | null
	totalUnit: string | null
	usedIn: PrepItemUsage[]
	prepMethods: PrepMethodGroup[]
	storageTip: string | null
}

/**
 * Group usages by their extracted prep method, consolidate quantities per group,
 * and deduplicate recipe titles within each group.
 */
function groupByPrepMethod(
	usages: Array<{
		recipeTitle: string
		amount: string | null
		unit: string | null
		notes: string | null
	}>,
): PrepMethodGroup[] {
	const groups = new Map<
		string,
		{ quantities: Array<{ amount: string | null; unit: string | null }>; recipes: Set<string> }
	>()

	for (const usage of usages) {
		const method = extractPrepMethod(usage.notes) ?? 'Whole'
		const existing = groups.get(method)
		if (existing) {
			existing.quantities.push({ amount: usage.amount, unit: usage.unit })
			existing.recipes.add(usage.recipeTitle)
		} else {
			groups.set(method, {
				quantities: [{ amount: usage.amount, unit: usage.unit }],
				recipes: new Set([usage.recipeTitle]),
			})
		}
	}

	return [...groups.entries()].map(([method, data]) => {
		const consolidated = consolidateQuantities(data.quantities)
		return {
			method,
			totalQuantity: consolidated.quantity ?? null,
			totalUnit: consolidated.unit ?? null,
			recipes: [...data.recipes],
		}
	})
}

/**
 * Generate a unified prep list from meal plan entries.
 *
 * Identifies ingredients shared across 2+ recipes (excluding staples),
 * aggregates their quantities, and attributes them back to each recipe.
 * This is the "Sunday prep" feature: prep shared ingredients once,
 * store them, assemble meals throughout the week.
 */
export function generatePrepList(entries: PrepEntry[]): PrepItem[] {
	if (entries.length === 0) return []

	// Map canonical name → { displayName, usages across all entries }
	const ingredientMap = new Map<
		string,
		{
			displayName: string
			recipeIds: Set<string>
			usages: Array<{
				recipeTitle: string
				date: Date
				mealType: string
				amount: string | null
				unit: string | null
				notes: string | null
			}>
		}
	>()

	for (const entry of entries) {
		const { recipe, servings } = entry
		const ratio =
			servings && recipe.servings > 0 ? servings / recipe.servings : 1

		for (const ingredient of recipe.ingredients) {
			if (isStapleIngredient(ingredient)) continue

			const canonical = getCanonicalIngredientName(ingredient.name)
			if (NON_PREPPABLE_INGREDIENTS.has(canonical)) continue

			const scaledAmount = scaleAmountString(ingredient.amount, ratio)

			const existing = ingredientMap.get(canonical)
			if (existing) {
				existing.recipeIds.add(recipe.id)
				// Prefer shorter display name (e.g., "garlic" over "garlic cloves")
				if (ingredient.name.length < existing.displayName.length) {
					existing.displayName = ingredient.name
				}
				existing.usages.push({
					recipeTitle: recipe.title,
					date: entry.date,
					mealType: entry.mealType,
					amount: scaledAmount,
					unit: ingredient.unit,
					notes: ingredient.notes,
				})
			} else {
				ingredientMap.set(canonical, {
					displayName: ingredient.name,
					recipeIds: new Set([recipe.id]),
					usages: [
						{
							recipeTitle: recipe.title,
							date: entry.date,
							mealType: entry.mealType,
							amount: scaledAmount,
							unit: ingredient.unit,
							notes: ingredient.notes,
						},
					],
				})
			}
		}
	}

	// Filter to only ingredients used in 2+ distinct recipes
	const prepItems: PrepItem[] = []

	for (const [canonical, data] of ingredientMap) {
		if (data.recipeIds.size < 2) continue

		// Aggregate total quantity
		const quantities = data.usages.map((u) => ({
			amount: u.amount,
			unit: u.unit,
		}))
		const consolidated = consolidateQuantities(quantities)

		// Group by prep method
		const prepMethods = groupByPrepMethod(data.usages)

		// Look up storage tip
		const storageTip = STORAGE_TIPS.get(canonical) ?? null

		prepItems.push({
			ingredientName: data.displayName,
			canonicalName: canonical,
			totalQuantity: consolidated.quantity ?? null,
			totalUnit: consolidated.unit ?? null,
			usedIn: data.usages.map((u) => ({
				recipeTitle: u.recipeTitle,
				date: u.date,
				mealType: u.mealType,
				quantity: u.amount,
				unit: u.unit,
				notes: u.notes,
			})),
			prepMethods,
			storageTip,
		})
	}

	// Sort by number of usages across meal plan entries (most-shared first)
	return prepItems.sort((a, b) => b.usedIn.length - a.usedIn.length)
}
