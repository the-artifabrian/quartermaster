import { cache, cachified } from './cache.server.ts'
import {
	type Substitution,
	getStaticSubstitutions,
} from './ingredient-substitutions.ts'
import { normalizeIngredientName } from './recipe-matching.server.ts'
import {
	type RecipeContext,
	getLLMSubstitutions,
} from './substitution-llm.server.ts'

export type EnrichedSubstitution = Substitution & {
	/** true if the user's inventory contains (some of) the replacement ingredients */
	inInventory: boolean
}

export type SubstitutionResult = {
	substitutions: EnrichedSubstitution[]
	source: 'static' | 'cached' | 'llm' | 'none'
}

/**
 * Look up substitutions for an ingredient, cross-referenced against inventory.
 *
 * Cascade: static database → SQLite cache → LLM.
 * Inventory-matched substitutions are sorted to the top.
 */
export async function getSubstitutions(
	ingredientName: string,
	inventoryItems: Array<{ name: string }>,
	recipeContext?: RecipeContext,
): Promise<SubstitutionResult> {
	const normalized = normalizeIngredientName(ingredientName)

	// 1. Static database lookup (instant, no API cost)
	const staticSubs = getStaticSubstitutions(normalized)
	if (staticSubs) {
		return {
			substitutions: enrichWithInventory(staticSubs, inventoryItems),
			source: 'static',
		}
	}

	// 2. Cache + LLM fallback (with optional recipe context for better results)
	const llmResult = await getLLMSubstitutionsWithCache(
		normalized,
		recipeContext,
	)
	if (llmResult) {
		return {
			substitutions: enrichWithInventory(llmResult.substitutions, inventoryItems),
			source: llmResult.source,
		}
	}

	return { substitutions: [], source: 'none' }
}

export { type RecipeContext } from './substitution-llm.server.ts'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Sentinel value for negative caching: when the LLM returns no substitutions,
 * we cache this to avoid repeated failed API calls for the same ingredient.
 */
const EMPTY_SENTINEL: Substitution[] = []

/**
 * Cache-wrapped LLM substitution lookup.
 * Uses SQLite cache (persists across restarts) with 30-day TTL.
 *
 * Cache key includes recipe title when context is provided, so "water in
 * Peach Coffee Cake" and "water in Fried Rice" cache separately.
 *
 * Negative results (LLM returns nothing) are also cached to prevent
 * repeated API calls for ingredients with no known substitutions.
 */
async function getLLMSubstitutionsWithCache(
	normalizedName: string,
	recipeContext?: RecipeContext,
): Promise<{ substitutions: Substitution[]; source: 'cached' | 'llm' } | null> {
	if (!process.env.ANTHROPIC_API_KEY) return null

	const cacheKey = recipeContext
		? `substitution:${normalizedName}:recipe:${recipeContext.title.toLowerCase().trim()}`
		: `substitution:${normalizedName}`

	const result = await cachified({
		key: cacheKey,
		cache,
		ttl: THIRTY_DAYS_MS,
		staleWhileRevalidate: THIRTY_DAYS_MS,
		async getFreshValue() {
			const llmResult = await getLLMSubstitutions(
				normalizedName,
				recipeContext,
			)
			// Cache empty array as negative result (prevents repeated failed calls)
			return llmResult ?? EMPTY_SENTINEL
		},
	})

	// Distinguish fresh LLM call from cache hit by checking if cachified
	// returned a previously-stored value (it sets metadata.createdTime).
	// For source tracking, we check if the value was already in cache
	// before this call. This is imperfect but the source field is only
	// used for usage tracking, not user-facing logic.
	const isFresh = await isFreshResult(cacheKey)

	if (result.length === 0) return null

	return {
		substitutions: result,
		source: isFresh ? 'llm' : 'cached',
	}
}

/**
 * Check if a cache entry was just written (within the last 5 seconds).
 * Used to distinguish fresh LLM results from cached ones for usage tracking.
 */
async function isFreshResult(cacheKey: string): Promise<boolean> {
	const entry = await cache.get(cacheKey)
	if (!entry?.metadata?.createdTime) return true
	return Date.now() - entry.metadata.createdTime < 5_000
}

/**
 * Post-process substitutions: check if replacement ingredients exist in inventory.
 * Inventory-matched items are sorted to the top.
 */
function enrichWithInventory(
	substitutions: Substitution[],
	inventoryItems: Array<{ name: string }>,
): EnrichedSubstitution[] {
	const normalizedInventory = inventoryItems.map((item) =>
		normalizeIngredientName(item.name),
	)

	const enriched = substitutions.map((sub) => ({
		...sub,
		inInventory: checkReplacementInInventory(
			sub.replacement,
			normalizedInventory,
		),
	}))

	// Sort inventory-matched to top, preserving relative order within each group
	return enriched.sort((a, b) => {
		if (a.inInventory && !b.inInventory) return -1
		if (!a.inInventory && b.inInventory) return 1
		return 0
	})
}

/**
 * Tokenize replacement text into individual ingredients, normalize each,
 * and check if any appear in the user's inventory.
 *
 * "1 cup milk + 1 tbsp lemon juice" → checks "milk" and "lemon juice".
 */
function checkReplacementInInventory(
	replacement: string,
	normalizedInventory: string[],
): boolean {
	// Split on common separators: +, &, "and", "with"
	const parts = replacement
		.split(/\s*(?:\+|&)\s*|\s+(?:and|with)\s+/i)
		.map((p) => p.trim())
		.filter(Boolean)

	for (const part of parts) {
		// Strip leading amounts/units: "1 cup milk" → "milk"
		const stripped = stripAmountAndUnit(part)
		if (!stripped) continue

		const normalized = normalizeIngredientName(stripped)
		// Use substring matching: "yogurt" matches inventory "plain yogurt"
		// and vice versa, similar to the codebase's matching approach
		for (const invName of normalizedInventory) {
			if (invName.includes(normalized) || normalized.includes(invName)) {
				return true
			}
		}
	}

	return false
}

/**
 * Strip leading numeric amounts and common units from a string.
 * "1 cup milk" → "milk", "½ tsp vanilla" → "vanilla"
 */
function stripAmountAndUnit(text: string): string {
	const units = new Set([
		'cup',
		'cups',
		'tbsp',
		'tablespoon',
		'tablespoons',
		'tsp',
		'teaspoon',
		'teaspoons',
		'oz',
		'ounce',
		'ounces',
		'lb',
		'pound',
		'pounds',
		'g',
		'gram',
		'grams',
		'ml',
		'liter',
		'liters',
	])

	const words = text.trim().split(/\s+/)
	let i = 0

	// Skip numeric tokens (1, ½, 1/2, ¾, etc.)
	while (i < words.length && /^[\d½¼¾⅓⅔⅛⅜⅝⅞/.-]+$/.test(words[i]!)) {
		i++
	}

	// Skip unit token
	if (i < words.length && units.has(words[i]!.toLowerCase())) {
		i++
	}

	return words.slice(i).join(' ')
}
