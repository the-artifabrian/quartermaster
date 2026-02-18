import { describe, expect, test } from 'vitest'
import { getStaticSubstitutions } from './ingredient-substitutions.ts'

describe('getStaticSubstitutions', () => {
	test('returns substitutions for exact match', () => {
		const result = getStaticSubstitutions('buttermilk')
		expect(result).not.toBeNull()
		expect(result!.length).toBeGreaterThanOrEqual(2)
		expect(result![0]!.replacement).toContain('milk')
	})

	test('returns null for unknown ingredient', () => {
		expect(getStaticSubstitutions('dragon fruit')).toBeNull()
	})

	test('handles pluralization', () => {
		const result = getStaticSubstitutions('eggs')
		expect(result).not.toBeNull()
		expect(result![0]!.replacement).toContain('flax')
	})

	test('handles case insensitivity', () => {
		const result = getStaticSubstitutions('Buttermilk')
		expect(result).not.toBeNull()
	})

	test('substring matching works for longer ingredient names', () => {
		const result = getStaticSubstitutions('low sodium chicken stock')
		expect(result).not.toBeNull()
		expect(result!.some((s) => s.replacement.includes('vegetable broth'))).toBe(
			true,
		)
	})

	test('longest key matches first (heavy cream before cream)', () => {
		const result = getStaticSubstitutions('heavy cream')
		expect(result).not.toBeNull()
		expect(result!.some((s) => s.replacement.includes('coconut cream'))).toBe(
			true,
		)
	})

	test('each substitution has a replacement string', () => {
		const result = getStaticSubstitutions('butter')
		expect(result).not.toBeNull()
		for (const sub of result!) {
			expect(sub.replacement).toBeTruthy()
			expect(typeof sub.replacement).toBe('string')
		}
	})

	test('returns substitutions for soy sauce', () => {
		const result = getStaticSubstitutions('soy sauce')
		expect(result).not.toBeNull()
		expect(result!.some((s) => s.replacement === 'tamari')).toBe(true)
	})

	test('returns substitutions for honey', () => {
		const result = getStaticSubstitutions('honey')
		expect(result).not.toBeNull()
		expect(result!.some((s) => s.replacement === 'maple syrup')).toBe(true)
	})

	test('returns substitutions for dijon mustard', () => {
		const result = getStaticSubstitutions('dijon mustard')
		expect(result).not.toBeNull()
	})

	test('returns substitutions for garlic', () => {
		const result = getStaticSubstitutions('garlic')
		expect(result).not.toBeNull()
		expect(result!.some((s) => s.replacement === 'garlic powder')).toBe(true)
	})

	test('returns substitutions for ginger', () => {
		const result = getStaticSubstitutions('ginger')
		expect(result).not.toBeNull()
		expect(result!.some((s) => s.replacement === 'ground ginger')).toBe(true)
	})

	test('returns substitutions for cinnamon', () => {
		const result = getStaticSubstitutions('cinnamon')
		expect(result).not.toBeNull()
		expect(result!.some((s) => s.replacement === 'allspice')).toBe(true)
	})

	test('returns substitutions for ground beef', () => {
		const result = getStaticSubstitutions('ground beef')
		expect(result).not.toBeNull()
		expect(result!.some((s) => s.replacement === 'ground turkey')).toBe(true)
	})

	test('returns substitutions for cheddar', () => {
		const result = getStaticSubstitutions('cheddar')
		expect(result).not.toBeNull()
	})

	test('returns substitutions for tofu', () => {
		const result = getStaticSubstitutions('tofu')
		expect(result).not.toBeNull()
		expect(result!.some((s) => s.replacement === 'tempeh')).toBe(true)
	})
})
