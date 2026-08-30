import { describe, expect, test } from 'vitest'
import {
	formatTargetYieldAmount,
	getTypedYield,
	scaleMultiplierToTargetYield,
	targetYieldToScaleMultiplier,
} from './target-yield.ts'

describe('typed yield conversion', () => {
	test('converts a count target to the stored batch multiplier', () => {
		const recipeYield = getTypedYield({
			yieldAmount: 12,
			yieldLabel: 'pieces',
		})

		expect(targetYieldToScaleMultiplier(18, recipeYield)).toBe(1.5)
		expect(scaleMultiplierToTargetYield(1.5, recipeYield)).toBe(18)
	})

	test('uses the same rule for fixed batch dishes', () => {
		const recipeYield = getTypedYield({
			yieldAmount: 2,
			yieldLabel: 'cakes',
		})

		expect(targetYieldToScaleMultiplier(3, recipeYield)).toBe(1.5)
		expect(scaleMultiplierToTargetYield(1.5, recipeYield)).toBe(3)
	})

	test('keeps missing or incomplete metadata unknown', () => {
		expect(getTypedYield({ yieldAmount: null, yieldLabel: null })).toBeNull()
		expect(getTypedYield({ yieldAmount: 12, yieldLabel: null })).toBeNull()
		expect(
			getTypedYield({ yieldAmount: null, yieldLabel: 'pieces' }),
		).toBeNull()
	})

	test('rounds converted multipliers at the existing two-decimal boundary', () => {
		const recipeYield = getTypedYield({
			yieldAmount: 1,
			yieldLabel: 'batch',
		})

		expect(targetYieldToScaleMultiplier(1.004, recipeYield)).toBe(1)
		expect(targetYieldToScaleMultiplier(1.005, recipeYield)).toBe(1.01)
		expect(targetYieldToScaleMultiplier(0.004, recipeYield)).toBeNull()
		expect(targetYieldToScaleMultiplier(0.005, recipeYield)).toBe(0.01)
		expect(targetYieldToScaleMultiplier(100.004, recipeYield)).toBe(100)
		expect(targetYieldToScaleMultiplier(100.005, recipeYield)).toBeNull()
	})

	test('formats derived targets without floating-point noise', () => {
		expect(formatTargetYieldAmount(3.125)).toBe('3.13')
		expect(formatTargetYieldAmount(12)).toBe('12')
		expect(formatTargetYieldAmount(0.1 + 0.2)).toBe('0.3')
	})
})
