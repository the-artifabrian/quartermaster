import { describe, expect, test } from 'vitest'
import {
	formatTargetYieldAmount,
	getTypedYield,
	scaleMultiplierToTargetYield,
} from './target-yield.ts'

describe('typed yield conversion', () => {
	test('derives the friendly target from the stored multiplier', () => {
		const pieces = getTypedYield({ yieldAmount: 12, yieldLabel: 'pieces' })
		const cakes = getTypedYield({ yieldAmount: 2, yieldLabel: 'cakes' })

		expect(scaleMultiplierToTargetYield(1.5, pieces)).toBe(18)
		expect(scaleMultiplierToTargetYield(1.5, cakes)).toBe(3)
	})

	test('keeps missing or incomplete metadata unknown', () => {
		expect(getTypedYield({ yieldAmount: null, yieldLabel: null })).toBeNull()
		expect(getTypedYield({ yieldAmount: 12, yieldLabel: null })).toBeNull()
		expect(
			getTypedYield({ yieldAmount: null, yieldLabel: 'pieces' }),
		).toBeNull()
	})

	test('formats derived targets without floating-point noise', () => {
		expect(formatTargetYieldAmount(3.125)).toBe('3.13')
		expect(formatTargetYieldAmount(12)).toBe('12')
		expect(formatTargetYieldAmount(0.1 + 0.2)).toBe('0.3')
	})
})
