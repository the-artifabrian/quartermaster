import { describe, expect, test } from 'vitest'
import {
	normalizeUnit,
	getUnitFamily,
	convertAndSum,
} from './unit-conversion.ts'

describe('normalizeUnit', () => {
	test('normalizes common aliases', () => {
		expect(normalizeUnit('tablespoons')).toBe('tbsp')
		expect(normalizeUnit('Tablespoon')).toBe('tbsp')
		expect(normalizeUnit('teaspoons')).toBe('tsp')
		expect(normalizeUnit('cups')).toBe('cup')
		expect(normalizeUnit('Cup')).toBe('cup')
		expect(normalizeUnit('ounces')).toBe('oz')
		expect(normalizeUnit('pounds')).toBe('lb')
		expect(normalizeUnit('lbs')).toBe('lb')
		expect(normalizeUnit('grams')).toBe('g')
		expect(normalizeUnit('kilograms')).toBe('kg')
		expect(normalizeUnit('milliliters')).toBe('ml')
		expect(normalizeUnit('liters')).toBe('l')
		expect(normalizeUnit('litres')).toBe('l')
	})

	test('passes through unknown units', () => {
		expect(normalizeUnit('cloves')).toBe('cloves')
		expect(normalizeUnit('bunch')).toBe('bunch')
		expect(normalizeUnit('pinch')).toBe('pinch')
	})

	test('handles already-normalized units', () => {
		expect(normalizeUnit('tsp')).toBe('tsp')
		expect(normalizeUnit('tbsp')).toBe('tbsp')
		expect(normalizeUnit('cup')).toBe('cup')
	})
})

describe('getUnitFamily', () => {
	test('finds US volume family', () => {
		const result = getUnitFamily('tsp')
		expect(result).not.toBeNull()
		expect(result!.family.name).toBe('us-volume')
		expect(result!.factor).toBe(1)

		const cup = getUnitFamily('cup')
		expect(cup!.family.name).toBe('us-volume')
		expect(cup!.factor).toBe(48)
	})

	test('finds US weight family', () => {
		expect(getUnitFamily('oz')!.family.name).toBe('us-weight')
		expect(getUnitFamily('lb')!.family.name).toBe('us-weight')
	})

	test('finds metric families', () => {
		expect(getUnitFamily('ml')!.family.name).toBe('metric-volume')
		expect(getUnitFamily('g')!.family.name).toBe('metric-weight')
		expect(getUnitFamily('kg')!.family.name).toBe('metric-weight')
	})

	test('returns null for unknown units', () => {
		expect(getUnitFamily('cloves')).toBeNull()
		expect(getUnitFamily('bunch')).toBeNull()
	})
})

describe('convertAndSum', () => {
	test('converts tbsp + cup to cups', () => {
		const family = getUnitFamily('tbsp')!.family
		const result = convertAndSum(
			[
				{ amount: 2, normalizedUnit: 'tbsp' },
				{ amount: 1, normalizedUnit: 'cup' },
			],
			family,
		)
		// 2 tbsp = 6 tsp, 1 cup = 48 tsp, total = 54 tsp
		// Best unit: 54/48 = 1.125 cups → picks cup since ≥ 1
		expect(result.unit).toBe('cup')
		expect(result.value).toBeCloseTo(1.125)
	})

	test('converts tsp + tbsp preferring input units', () => {
		const family = getUnitFamily('tsp')!.family
		const result = convertAndSum(
			[
				{ amount: 3, normalizedUnit: 'tsp' },
				{ amount: 2, normalizedUnit: 'tbsp' },
			],
			family,
		)
		// 3 tsp + 6 tsp = 9 tsp = 3 tbsp (prefers tbsp since it was an input unit)
		expect(result.unit).toBe('tbsp')
		expect(result.value).toBeCloseTo(3)
	})

	test('converts oz + lb to lb', () => {
		const family = getUnitFamily('oz')!.family
		const result = convertAndSum(
			[
				{ amount: 8, normalizedUnit: 'oz' },
				{ amount: 1, normalizedUnit: 'lb' },
			],
			family,
		)
		// 8 oz + 16 oz = 24 oz = 1.5 lb
		expect(result.unit).toBe('lb')
		expect(result.value).toBeCloseTo(1.5)
	})

	test('converts g + kg to kg', () => {
		const family = getUnitFamily('g')!.family
		const result = convertAndSum(
			[
				{ amount: 500, normalizedUnit: 'g' },
				{ amount: 1, normalizedUnit: 'kg' },
			],
			family,
		)
		expect(result.unit).toBe('kg')
		expect(result.value).toBeCloseTo(1.5)
	})

	test('stays in small units when result is less than 1 of next unit', () => {
		const family = getUnitFamily('tsp')!.family
		const result = convertAndSum(
			[
				{ amount: 1, normalizedUnit: 'tsp' },
				{ amount: 1, normalizedUnit: 'tsp' },
			],
			family,
		)
		expect(result.unit).toBe('tsp')
		expect(result.value).toBe(2)
	})

	test('converts ml + l to l', () => {
		const family = getUnitFamily('ml')!.family
		const result = convertAndSum(
			[
				{ amount: 250, normalizedUnit: 'ml' },
				{ amount: 1, normalizedUnit: 'l' },
			],
			family,
		)
		expect(result.unit).toBe('l')
		expect(result.value).toBeCloseTo(1.25)
	})
})
