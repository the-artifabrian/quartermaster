import { describe, expect, test } from 'vitest'
import { getShelfLifeDays, suggestExpiryDate } from './shelf-life.ts'

describe('getShelfLifeDays', () => {
	test('returns correct shelf life for known items', () => {
		expect(getShelfLifeDays('milk', 'fridge')).toBe(7)
		expect(getShelfLifeDays('chicken', 'fridge')).toBe(2)
		expect(getShelfLifeDays('rice', 'pantry')).toBe(365)
		expect(getShelfLifeDays('bread', 'pantry')).toBe(5)
	})

	test('handles plural forms', () => {
		expect(getShelfLifeDays('eggs', 'fridge')).toBe(28)
		expect(getShelfLifeDays('carrots', 'fridge')).toBe(21)
		expect(getShelfLifeDays('tomatoes', 'fridge')).toBe(10)
		expect(getShelfLifeDays('berries', 'fridge')).toBe(5)
	})

	test('matches modifier-laden names via substring', () => {
		expect(getShelfLifeDays('fresh chicken breast', 'fridge')).toBe(2)
		expect(getShelfLifeDays('organic whole milk', 'fridge')).toBe(7)
		expect(getShelfLifeDays('baby spinach', 'fridge')).toBe(5)
		expect(getShelfLifeDays('sharp cheddar cheese', 'fridge')).toBe(21)
	})

	test('returns null for unknown items', () => {
		expect(getShelfLifeDays('baking soda', 'fridge')).toBeNull()
		expect(getShelfLifeDays('xyz', 'pantry')).toBeNull()
	})

	test('returns null when item has no data for given location', () => {
		expect(getShelfLifeDays('cucumber', 'pantry')).toBeNull()
		expect(getShelfLifeDays('cucumber', 'freezer')).toBeNull()
		expect(getShelfLifeDays('mayonnaise', 'pantry')).toBeNull()
	})

	test('location changes produce different shelf lives', () => {
		const butterFridge = getShelfLifeDays('butter', 'fridge')
		const butterFreezer = getShelfLifeDays('butter', 'freezer')
		expect(butterFridge).toBe(30)
		expect(butterFreezer).toBe(270)
		expect(butterFridge).not.toBe(butterFreezer)
	})

	test('prefers longer key matches (cream cheese before cream)', () => {
		expect(getShelfLifeDays('cream cheese', 'fridge')).toBe(14)
		expect(getShelfLifeDays('heavy cream', 'fridge')).toBe(7)
	})
})

describe('suggestExpiryDate', () => {
	test('returns ISO date string for known items', () => {
		const result = suggestExpiryDate('milk', 'fridge')
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
	})

	test('returns null for unknown items', () => {
		expect(suggestExpiryDate('baking soda', 'fridge')).toBeNull()
	})

	test('date is in the future', () => {
		const result = suggestExpiryDate('chicken', 'fridge')
		expect(result).not.toBeNull()
		const date = new Date(result!)
		const today = new Date()
		today.setHours(0, 0, 0, 0)
		expect(date.getTime()).toBeGreaterThan(today.getTime())
	})
})
