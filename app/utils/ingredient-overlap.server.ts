import {
	type Ingredient,
	type Recipe,
} from '#app/generated/prisma/client.ts'
import {
	getCanonicalIngredientName,
	isOptionalIngredient,
	isStapleIngredient,
} from './recipe-matching.server.ts'

type RecipeWithIngredients = Recipe & { ingredients: Ingredient[] }

export type OverlapAnalysis = {
	/** Canonical ingredient names found in 2+ recipes */
	sharedIngredients: Map<string, string[]>
	/** Canonical ingredient names found in only 1 recipe */
	singleUseIngredients: Map<string, string>
	/** Ratio of unique non-staple ingredients to total non-staple ingredient slots */
	efficiencyScore: number
	/** Number of unique non-staple ingredients */
	uniqueCount: number
	/** Total non-staple ingredient slots across all recipes */
	totalSlots: number
}

export type PairingScore = {
	recipeId: string
	overlapCount: number
	overlapIngredients: string[]
	/** overlapCount / candidate's non-staple ingredient count */
	score: number
}

export type WasteAlert = {
	ingredientName: string
	usedInRecipeId: string
	usedInRecipeTitle: string
	suggestedRecipes: Array<{ id: string; title: string }>
}

/**
 * Get canonical non-staple ingredient names for a recipe
 */
function getRecipeCanonicalIngredients(
	recipe: RecipeWithIngredients,
): Set<string> {
	const result = new Set<string>()
	for (const ing of recipe.ingredients) {
		if (!ing.isHeading && !isStapleIngredient(ing) && !isOptionalIngredient(ing)) {
			result.add(getCanonicalIngredientName(ing.name))
		}
	}
	return result
}

/**
 * Analyze ingredient overlap across a set of planned recipes.
 *
 * Builds a map of canonical ingredient → recipe IDs. Returns shared ingredients
 * (in 2+ recipes), single-use ingredients (in only 1 recipe), and an efficiency
 * score (unique/total ratio). Staple ingredients are excluded.
 */
export function analyzeIngredientOverlap(
	recipes: RecipeWithIngredients[],
): OverlapAnalysis {
	// Map canonical ingredient name → set of recipe IDs that use it
	const ingredientToRecipes = new Map<string, Set<string>>()
	let totalSlots = 0

	for (const recipe of recipes) {
		const canonical = getRecipeCanonicalIngredients(recipe)
		totalSlots += canonical.size
		for (const name of canonical) {
			const existing = ingredientToRecipes.get(name) ?? new Set()
			existing.add(recipe.id)
			ingredientToRecipes.set(name, existing)
		}
	}

	const sharedIngredients = new Map<string, string[]>()
	const singleUseIngredients = new Map<string, string>()

	for (const [name, recipeIds] of ingredientToRecipes) {
		if (recipeIds.size > 1) {
			sharedIngredients.set(name, [...recipeIds])
		} else {
			singleUseIngredients.set(name, [...recipeIds][0]!)
		}
	}

	const uniqueCount = ingredientToRecipes.size
	const efficiencyScore =
		totalSlots > 0 ? Math.round((uniqueCount / totalSlots) * 100) / 100 : 1

	return {
		sharedIngredients,
		singleUseIngredients,
		efficiencyScore,
		uniqueCount,
		totalSlots,
	}
}

/**
 * Score candidate recipes by how many of their non-staple ingredients overlap
 * with the already-planned recipes. Returns candidates sorted by overlap count
 * (descending). Already-planned recipes are excluded from candidates.
 */
export function scoreRecipePairings(
	plannedRecipes: RecipeWithIngredients[],
	candidateRecipes: RecipeWithIngredients[],
): PairingScore[] {
	// Collect canonical ingredient set from all planned recipes
	const plannedIngredients = new Set<string>()
	const plannedIds = new Set(plannedRecipes.map((r) => r.id))

	for (const recipe of plannedRecipes) {
		for (const name of getRecipeCanonicalIngredients(recipe)) {
			plannedIngredients.add(name)
		}
	}

	const scores: PairingScore[] = []

	for (const candidate of candidateRecipes) {
		// Skip recipes already in the plan
		if (plannedIds.has(candidate.id)) continue

		const candidateIngredients = getRecipeCanonicalIngredients(candidate)
		const overlapIngredients: string[] = []

		for (const name of candidateIngredients) {
			if (plannedIngredients.has(name)) {
				overlapIngredients.push(name)
			}
		}

		const score =
			candidateIngredients.size > 0
				? Math.round(
						(overlapIngredients.length / candidateIngredients.size) * 100,
					)
				: 0

		scores.push({
			recipeId: candidate.id,
			overlapCount: overlapIngredients.length,
			overlapIngredients,
			score,
		})
	}

	return scores.sort((a, b) => b.overlapCount - a.overlapCount)
}

/**
 * Generate waste alerts for single-use ingredients in the planned recipes.
 * For each single-use ingredient, searches the user's other recipes for ones
 * that also use that ingredient, suggesting them as additions to the plan.
 */
export function generateWasteAlerts(
	plannedRecipes: RecipeWithIngredients[],
	allUserRecipes: RecipeWithIngredients[],
): WasteAlert[] {
	const { singleUseIngredients } = analyzeIngredientOverlap(plannedRecipes)

	const plannedIds = new Set(plannedRecipes.map((r) => r.id))
	const recipeById = new Map(allUserRecipes.map((r) => [r.id, r]))

	// Pre-compute canonical ingredient sets for all recipes once
	const recipeCanonicalCache = new Map<string, Set<string>>()
	for (const recipe of allUserRecipes) {
		if (!plannedIds.has(recipe.id)) {
			recipeCanonicalCache.set(recipe.id, getRecipeCanonicalIngredients(recipe))
		}
	}

	const alerts: WasteAlert[] = []

	for (const [ingredientName, recipeId] of singleUseIngredients) {
		const sourceRecipe = recipeById.get(recipeId)
		if (!sourceRecipe) continue

		// Search unplanned recipes for ones that use this ingredient
		const suggestions: Array<{ id: string; title: string }> = []
		for (const recipe of allUserRecipes) {
			if (plannedIds.has(recipe.id)) continue

			const canonical = recipeCanonicalCache.get(recipe.id)!
			if (canonical.has(ingredientName)) {
				suggestions.push({ id: recipe.id, title: recipe.title })
			}
		}

		// Only alert if there are suggestions — nothing actionable otherwise
		if (suggestions.length > 0) {
			alerts.push({
				ingredientName,
				usedInRecipeId: recipeId,
				usedInRecipeTitle: sourceRecipe.title,
				suggestedRecipes: suggestions,
			})
		}
	}

	// Sort by number of suggestions (most actionable first)
	return alerts.sort(
		(a, b) => b.suggestedRecipes.length - a.suggestedRecipes.length,
	)
}
