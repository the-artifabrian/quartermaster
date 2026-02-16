import { describe, expect, test, vi } from 'vitest'

vi.mock('./substitution-llm.server.ts', () => ({
	getLLMSubstitutions: vi.fn().mockResolvedValue(null),
}))

import { getSubstitutions } from './substitution-lookup.server.ts'

describe('getSubstitutions', () => {
	test('returns static substitutions for known ingredient', async () => {
		const result = await getSubstitutions('buttermilk', [])
		expect(result.source).toBe('static')
		expect(result.substitutions.length).toBeGreaterThanOrEqual(2)
	})

	test('returns none for unknown ingredient without LLM', async () => {
		const result = await getSubstitutions('dragon fruit', [])
		expect(result.source).toBe('none')
		expect(result.substitutions).toEqual([])
	})

	test('enriches substitutions with inventory awareness', async () => {
		const result = await getSubstitutions('buttermilk', [
			{ name: 'Whole Milk' },
		])
		expect(result.source).toBe('static')
		// "milk + lemon juice" should be marked as inInventory (user has milk)
		const milkSub = result.substitutions.find((s) =>
			s.replacement.toLowerCase().includes('milk'),
		)
		expect(milkSub).toBeDefined()
		expect(milkSub!.inInventory).toBe(true)
	})

	test('sorts inventory-matched substitutions to top', async () => {
		const result = await getSubstitutions('buttermilk', [
			{ name: 'Plain Yogurt' },
		])
		// Yogurt sub should be first since it's in inventory
		expect(result.substitutions[0]!.inInventory).toBe(true)
		expect(result.substitutions[0]!.replacement).toContain('yogurt')
	})

	test('marks substitutions as not inInventory when no match', async () => {
		const result = await getSubstitutions('buttermilk', [
			{ name: 'Chicken Breast' },
		])
		for (const sub of result.substitutions) {
			expect(sub.inInventory).toBe(false)
		}
	})

	test('handles heavy cream (longest-key matching)', async () => {
		const result = await getSubstitutions('heavy whipping cream', [])
		expect(result.source).toBe('static')
		expect(
			result.substitutions.some((s) => s.replacement.includes('coconut cream')),
		).toBe(true)
	})
})
