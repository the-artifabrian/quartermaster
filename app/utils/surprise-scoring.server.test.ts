import { describe, expect, test } from 'vitest'
import {
	scoreRecipe,
	weightedRandomSelect,
	type CookingLogSummary,
} from './surprise-scoring.server.ts'

const NO_COOKING_HISTORY: CookingLogSummary = {
	avgRating: null,
	lastCookedAt: null,
}

describe('scoreRecipe', () => {
	test('base score with no bonuses', () => {
		const score = scoreRecipe(0, false, NO_COOKING_HISTORY)
		// base(1) + exploration(0.5) = 1.5
		expect(score).toBe(1.5)
	})

	test('inventory match bonus', () => {
		const score = scoreRecipe(100, false, NO_COOKING_HISTORY)
		// base(1) + inventory(3) + exploration(0.5) = 4.5
		expect(score).toBe(4.5)
	})

	test('partial inventory match', () => {
		const score = scoreRecipe(50, false, NO_COOKING_HISTORY)
		// base(1) + inventory(1.5) + exploration(0.5) = 3.0
		expect(score).toBe(3.0)
	})

	test('favorite bonus', () => {
		const score = scoreRecipe(0, true, NO_COOKING_HISTORY)
		// base(1) + favorite(2) + exploration(0.5) = 3.5
		expect(score).toBe(3.5)
	})

	test('rating bonus', () => {
		const score = scoreRecipe(0, false, {
			avgRating: 5,
			lastCookedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
		})
		// base(1) + rating(2) = 3.0 (no exploration bonus since it was cooked, no recency penalty >30d)
		expect(score).toBe(3.0)
	})

	test('partial rating bonus', () => {
		const score = scoreRecipe(0, false, {
			avgRating: 2.5,
			lastCookedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
		})
		// base(1) + rating(1) = 2.0
		expect(score).toBe(2.0)
	})

	test('exploration bonus for never-cooked recipe', () => {
		const withHistory: CookingLogSummary = {
			avgRating: null,
			lastCookedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
		}
		const scoreWithHistory = scoreRecipe(0, false, withHistory)
		const scoreWithout = scoreRecipe(0, false, NO_COOKING_HISTORY)
		// Without history: base(1) + exploration(0.5) = 1.5
		// With history: base(1) = 1.0
		expect(scoreWithout).toBe(1.5)
		expect(scoreWithHistory).toBe(1.0)
	})

	test('recency penalty: cooked within 7 days', () => {
		const score = scoreRecipe(0, false, {
			avgRating: null,
			lastCookedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
		})
		// base(1) * 0.1 = 0.1
		expect(score).toBeCloseTo(0.1)
	})

	test('recency penalty: cooked within 14 days', () => {
		const score = scoreRecipe(0, false, {
			avgRating: null,
			lastCookedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
		})
		// base(1) * 0.3 = 0.3
		expect(score).toBeCloseTo(0.3)
	})

	test('recency penalty: cooked within 30 days', () => {
		const score = scoreRecipe(0, false, {
			avgRating: null,
			lastCookedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), // 20 days ago
		})
		// base(1) * 0.6 = 0.6
		expect(score).toBeCloseTo(0.6)
	})

	test('no recency penalty after 30 days', () => {
		const score = scoreRecipe(0, false, {
			avgRating: null,
			lastCookedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
		})
		// base(1) = 1.0 (no penalty, no exploration bonus)
		expect(score).toBe(1.0)
	})

	test('minimum score floor', () => {
		// Recipe cooked yesterday, 0% match, not favorite, no rating
		const score = scoreRecipe(0, false, {
			avgRating: null,
			lastCookedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
		})
		// base(1) * 0.1 = 0.1, which is above floor
		expect(score).toBeGreaterThanOrEqual(0.01)
	})

	test('all bonuses combined', () => {
		const score = scoreRecipe(100, true, {
			avgRating: 5,
			lastCookedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
		})
		// base(1) + inventory(3) + favorite(2) + rating(2) = 8.0
		expect(score).toBe(8.0)
	})

	test('all bonuses with recency penalty', () => {
		const score = scoreRecipe(100, true, {
			avgRating: 5,
			lastCookedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
		})
		// (base(1) + inventory(3) + favorite(2) + rating(2)) * 0.1 = 0.8
		expect(score).toBeCloseTo(0.8)
	})
})

describe('weightedRandomSelect', () => {
	test('returns null for empty list', () => {
		expect(weightedRandomSelect([])).toBeNull()
	})

	test('returns the only item for single-item list', () => {
		const result = weightedRandomSelect([{ recipeId: 'abc', score: 1 }])
		expect(result).toBe('abc')
	})

	test('returns a valid recipe id', () => {
		const items = [
			{ recipeId: 'a', score: 1 },
			{ recipeId: 'b', score: 2 },
			{ recipeId: 'c', score: 3 },
		]
		const result = weightedRandomSelect(items)
		expect(['a', 'b', 'c']).toContain(result)
	})

	test('higher scored items are selected more often', () => {
		const items = [
			{ recipeId: 'low', score: 1 },
			{ recipeId: 'high', score: 99 },
		]

		const counts: Record<string, number> = { low: 0, high: 0 }
		const iterations = 1000

		for (let i = 0; i < iterations; i++) {
			const result = weightedRandomSelect(items)!
			counts[result]!++
		}

		// "high" should be selected much more often (99x the weight)
		expect(counts.high).toBeGreaterThan(counts.low! * 5)
	})
})
