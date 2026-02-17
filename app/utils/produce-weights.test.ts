import { describe, expect, test } from 'vitest'
import { getProduceCountDisplay, isWeightUnit } from './produce-weights.ts'

describe('isWeightUnit', () => {
	test('recognizes grams', () => {
		expect(isWeightUnit('g')).toBe(true)
		expect(isWeightUnit('gram')).toBe(true)
		expect(isWeightUnit('grams')).toBe(true)
	})

	test('recognizes kilograms', () => {
		expect(isWeightUnit('kg')).toBe(true)
		expect(isWeightUnit('kilogram')).toBe(true)
	})

	test('recognizes ounces and pounds', () => {
		expect(isWeightUnit('oz')).toBe(true)
		expect(isWeightUnit('ounce')).toBe(true)
		expect(isWeightUnit('lb')).toBe(true)
		expect(isWeightUnit('lbs')).toBe(true)
		expect(isWeightUnit('pound')).toBe(true)
	})

	test('rejects non-weight units', () => {
		expect(isWeightUnit('cup')).toBe(false)
		expect(isWeightUnit('tsp')).toBe(false)
		expect(isWeightUnit('ml')).toBe(false)
		expect(isWeightUnit('')).toBe(false)
	})
})

describe('getProduceCountDisplay', () => {
	test('converts grams to count for carrot', () => {
		// 150g per carrot, 300g = ~2 carrots
		expect(getProduceCountDisplay('carrot', 300, 'g')).toBe('~2 carrots')
	})

	test('converts grams to singular count', () => {
		// 150g per carrot, 150g = ~1 carrot
		expect(getProduceCountDisplay('carrot', 150, 'g')).toBe('~1 carrot')
	})

	test('converts kg to count', () => {
		// 170g per onion, 0.5kg = 500g ≈ 3 onions
		expect(getProduceCountDisplay('onion', 0.5, 'kg')).toBe('~3 onions')
	})

	test('converts oz to count', () => {
		// 60g per lemon, 4oz ≈ 113g ≈ 2 lemons
		expect(getProduceCountDisplay('lemon', 4, 'oz')).toBe('~2 lemons')
	})

	test('converts lb to count', () => {
		// 170g per potato, 1lb ≈ 454g ≈ 3 potatoes
		expect(getProduceCountDisplay('potato', 1, 'lb')).toBe('~3 potatoes')
	})

	test('uses correct weight for tomato variants', () => {
		// regular tomato: 150g each, 300g = ~2
		expect(getProduceCountDisplay('tomato', 300, 'g')).toBe('~2 tomatoes')
		// cherry tomato: 10g each, 100g = ~10
		expect(getProduceCountDisplay('cherry tomato', 100, 'g')).toBe(
			'~10 cherry tomatoes',
		)
		// plural form should also match cherry, not regular
		expect(getProduceCountDisplay('cherry tomatoes', 946, 'g')).toBe(
			'~95 cherry tomatoes',
		)
		// plum/roma tomato: 60g each, 300g = ~5
		expect(getProduceCountDisplay('plum tomato', 300, 'g')).toBe(
			'~5 plum tomatoes',
		)
		expect(getProduceCountDisplay('roma tomato', 300, 'g')).toBe(
			'~5 plum tomatoes',
		)
	})

	test('handles color variant aliases', () => {
		expect(getProduceCountDisplay('red bell pepper', 300, 'g')).toBe(
			'~2 bell peppers',
		)
		expect(getProduceCountDisplay('red onion', 170, 'g')).toBe('~1 onion')
	})

	test('handles substring matching (e.g., "large carrot")', () => {
		expect(getProduceCountDisplay('large carrot', 300, 'g')).toBe('~2 carrots')
	})

	test('returns null for non-weight units', () => {
		expect(getProduceCountDisplay('carrot', 2, 'cup')).toBeNull()
	})

	test('returns null for unknown produce', () => {
		expect(getProduceCountDisplay('chicken breast', 500, 'g')).toBeNull()
	})

	test('returns null for very small amounts', () => {
		// 150g per carrot, 10g < 0.3 count
		expect(getProduceCountDisplay('carrot', 10, 'g')).toBeNull()
	})

	test('rounds to nearest whole number', () => {
		// 150g per carrot, 75g = 0.5 → rounds to 1
		expect(getProduceCountDisplay('carrot', 75, 'g')).toBe('~1 carrot')
	})
})
