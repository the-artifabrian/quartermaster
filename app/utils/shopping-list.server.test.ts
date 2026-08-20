import { describe, expect, test } from 'vitest'
import { type ShoppingDemandLine } from './shopping-demand.server.ts'
import { annotateInventoryMatches } from './shopping-list.server.ts'

describe('annotateInventoryMatches', () => {
	function makeInventory(items: Array<{ name: string }>) {
		return items.map((item) => ({ name: item.name }))
	}

	function makeDemandLine(name: string): ShoppingDemandLine {
		return {
			name,
			canonicalName: name,
			quantity: '1',
			unit: 'cup',
			category: 'other',
		}
	}

	test('strips staple ingredients entirely', () => {
		const lines = [makeDemandLine('salt'), makeDemandLine('chicken')]
		const result = annotateInventoryMatches(lines, [])
		expect(result.lines).toHaveLength(1)
		expect(result.lines[0]!.name).toBe('chicken')
		expect(result.lines[0]!.inStock).toBe(false)
		expect(result.stapleCount).toBe(1)
	})

	test('a staple-looking note Shopping line is explicit intent and is kept (#109)', () => {
		const noteLine = { ...makeDemandLine('salt'), fromNote: true }
		const result = annotateInventoryMatches(
			[noteLine, makeDemandLine('salt')],
			[],
		)
		expect(result.lines).toHaveLength(1)
		expect(result.lines[0]!.name).toBe('salt')
		expect(result.stapleCount).toBe(1)
	})

	test('annotates items in inventory as inStock instead of removing', () => {
		const lines = [makeDemandLine('chicken'), makeDemandLine('rice')]
		const inventory = makeInventory([{ name: 'chicken' }])
		const result = annotateInventoryMatches(lines, inventory)
		expect(result.lines).toHaveLength(2)
		const chicken = result.lines.find((line) => line.name === 'chicken')!
		const rice = result.lines.find((line) => line.name === 'rice')!
		expect(chicken.inStock).toBe(true)
		expect(rice.inStock).toBe(false)
		expect(result.inStockCount).toBe(1)
	})

	test('a pantry "red wine" does not put "red wine vinegar" in stock', () => {
		const lines = [makeDemandLine('red wine vinegar')]
		const inventory = makeInventory([{ name: 'red wine' }])
		const result = annotateInventoryMatches(lines, inventory)
		expect(result.lines[0]!.inStock).toBe(false)
		expect(result.inStockCount).toBe(0)
	})

	test('returns correct stapleCount and inStockCount', () => {
		const lines = [
			makeDemandLine('salt'),
			makeDemandLine('water'),
			makeDemandLine('chicken'),
			makeDemandLine('broccoli'),
		]
		const inventory = makeInventory([{ name: 'chicken' }])
		const result = annotateInventoryMatches(lines, inventory)
		expect(result.stapleCount).toBe(2) // salt, water
		expect(result.lines).toHaveLength(2) // chicken, broccoli
		expect(result.inStockCount).toBe(1) // chicken
	})

	test('empty inventory only strips staples, marks nothing as inStock', () => {
		const lines = [makeDemandLine('chicken'), makeDemandLine('olive oil')]
		const result = annotateInventoryMatches(lines, [])
		expect(result.lines).toHaveLength(1)
		expect(result.lines[0]!.name).toBe('chicken')
		expect(result.lines[0]!.inStock).toBe(false)
		expect(result.stapleCount).toBe(1) // olive oil is a staple
	})
})
