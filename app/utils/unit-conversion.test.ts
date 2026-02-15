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
	test('finds volume family for US and metric units', () => {
		const tsp = getUnitFamily('tsp')
		expect(tsp).not.toBeNull()
		expect(tsp!.family.name).toBe('volume')
		expect(tsp!.factor).toBeCloseTo(4.929)

		const cup = getUnitFamily('cup')
		expect(cup!.family.name).toBe('volume')
		expect(cup!.factor).toBeCloseTo(236.588)

		const ml = getUnitFamily('ml')
		expect(ml!.family.name).toBe('volume')
		expect(ml!.factor).toBe(1)

		const l = getUnitFamily('l')
		expect(l!.family.name).toBe('volume')
		expect(l!.factor).toBe(1000)
	})

	test('finds weight family for US and metric units', () => {
		expect(getUnitFamily('oz')!.family.name).toBe('weight')
		expect(getUnitFamily('lb')!.family.name).toBe('weight')
		expect(getUnitFamily('g')!.family.name).toBe('weight')
		expect(getUnitFamily('kg')!.family.name).toBe('weight')
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
		// 2 tbsp ≈ 29.574 ml, 1 cup ≈ 236.588 ml, total ≈ 266.162 ml
		// Best unit: 266.162/236.588 ≈ 1.125 cups → picks cup since ≥ 1
		expect(result.unit).toBe('cup')
		expect(result.value).toBeCloseTo(1.125, 2)
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
		// 3 tsp ≈ 14.787 ml, 2 tbsp ≈ 29.574 ml, total ≈ 44.361 ml
		// 44.361/14.787 ≈ 3 tbsp (prefers tbsp since it was an input unit)
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
		// 8 oz ≈ 226.796 g, 1 lb ≈ 453.592 g, total ≈ 680.388 g
		// 680.388/453.592 ≈ 1.5 lb
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

	test('converts tsp + ml cross-system', () => {
		const family = getUnitFamily('tsp')!.family
		const result = convertAndSum(
			[
				{ amount: 1, normalizedUnit: 'tsp' },
				{ amount: 100, normalizedUnit: 'ml' },
			],
			family,
		)
		// 1 tsp ≈ 4.929 ml + 100 ml = 104.929 ml
		// pickBestUnit prefers largest input unit where value ≥1: tsp (4.929) > ml (1)
		// 104.929/4.929 ≈ 21.3 tsp
		expect(result.unit).toBe('tsp')
		expect(result.value).toBeCloseTo(21.3, 0)
	})

	test('converts oz + g cross-system', () => {
		const family = getUnitFamily('oz')!.family
		const result = convertAndSum(
			[
				{ amount: 4, normalizedUnit: 'oz' },
				{ amount: 200, normalizedUnit: 'g' },
			],
			family,
		)
		// 4 oz ≈ 113.398 g + 200 g = 313.398 g
		// pickBestUnit prefers largest input unit where value ≥1: oz (28.3) > g (1)
		// 313.398/28.3495 ≈ 11.06 oz
		expect(result.unit).toBe('oz')
		expect(result.value).toBeCloseTo(11.06, 0)
	})

	test('tsp and ml are in the same family', () => {
		const tsp = getUnitFamily('tsp')
		const ml = getUnitFamily('ml')
		expect(tsp!.family.name).toBe(ml!.family.name)
	})

	test('oz and g are in the same family', () => {
		const oz = getUnitFamily('oz')
		const g = getUnitFamily('g')
		expect(oz!.family.name).toBe(g!.family.name)
	})
})
