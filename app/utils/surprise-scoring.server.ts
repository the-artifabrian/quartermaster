export type CookingLogSummary = {
	lastCookedAt: Date | null
}

export type ScoredRecipe = {
	recipeId: string
	score: number
}

/**
 * Score a recipe for "Surprise Me" weighted random selection.
 *
 * Factors:
 * - Base: 1 point (everyone has a chance)
 * - Inventory match: matchPercentage/100 * 3 (0-3 points)
 * - Favorite: +2
 * - Never cooked: +0.5 exploration bonus
 * - Recency penalty (multiplicative): <7d => x0.1, <14d => x0.3, <30d => x0.6
 * - Minimum score floor: 0.01
 */
export function scoreRecipe(
	matchPercentage: number,
	isFavorite: boolean,
	cookingLogSummary: CookingLogSummary,
): number {
	let score = 1

	// Inventory match bonus (0-3)
	score += (matchPercentage / 100) * 3

	// Favorite bonus
	if (isFavorite) {
		score += 2
	}

	// Exploration bonus for never-cooked recipes
	if (!cookingLogSummary.lastCookedAt) {
		score += 0.5
	}

	// Recency penalty (multiplicative)
	if (cookingLogSummary.lastCookedAt) {
		const daysSinceCooked = Math.floor(
			(Date.now() - cookingLogSummary.lastCookedAt.getTime()) /
				(1000 * 60 * 60 * 24),
		)
		if (daysSinceCooked < 7) {
			score *= 0.1
		} else if (daysSinceCooked < 14) {
			score *= 0.3
		} else if (daysSinceCooked < 30) {
			score *= 0.6
		}
	}

	return Math.max(0.01, score)
}

/**
 * Weighted random selection from scored recipes.
 * Higher-scored recipes are more likely to be selected.
 */
export function weightedRandomSelect(
	items: ScoredRecipe[],
): string | null {
	if (items.length === 0) return null

	const totalWeight = items.reduce((sum, item) => sum + item.score, 0)
	let random = Math.random() * totalWeight

	for (const item of items) {
		random -= item.score
		if (random <= 0) {
			return item.recipeId
		}
	}

	// Fallback to last item (floating point edge case)
	return items[items.length - 1]!.recipeId
}
