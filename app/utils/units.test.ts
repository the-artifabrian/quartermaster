import { describe, expect, test } from 'vitest'
import { CANONICAL_UNITS } from './unit-conversion.ts'
import { normalizeUnit, UNIT_WORDS } from './units.ts'

describe('normalizeUnit', () => {
	test('maps measure words to the unit conversion works in', () => {
		expect(normalizeUnit('tablespoons')).toBe('tbsp')
		expect(normalizeUnit('Tablespoon')).toBe('tbsp')
		expect(normalizeUnit('teaspoons')).toBe('tsp')
		expect(normalizeUnit('Cup')).toBe('cup')
		expect(normalizeUnit('ounces')).toBe('oz')
		expect(normalizeUnit('lbs')).toBe('lb')
		expect(normalizeUnit('grams')).toBe('g')
		expect(normalizeUnit('kilograms')).toBe('kg')
		expect(normalizeUnit('millilitres')).toBe('ml')
		expect(normalizeUnit('litres')).toBe('l')
		expect(normalizeUnit('gal')).toBe('gallon')
	})

	test('reads milligrams as mg', () => {
		expect(normalizeUnit('milligrams')).toBe('mg')
		expect(normalizeUnit('milligram')).toBe('mg')
		expect(normalizeUnit('mg')).toBe('mg')
	})

	test('reads fluid ounces however the spaces fall', () => {
		expect(normalizeUnit('fluid ounces')).toBe('fl oz')
		expect(normalizeUnit(' Fl  Oz ')).toBe('fl oz')
	})

	test('keeps a count unit as written, so Shopping never shows "3 can"', () => {
		expect(normalizeUnit('cloves')).toBe('cloves')
		expect(normalizeUnit('Cans')).toBe('cans')
		expect(normalizeUnit('pinch')).toBe('pinch')
	})
})

test('every unit conversion sums is a word the parsers read as a unit', () => {
	for (const unit of CANONICAL_UNITS) {
		expect(UNIT_WORDS.has(unit)).toBe(true)
	}
})
