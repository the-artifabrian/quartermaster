import { describe, expect, test } from 'vitest'
import {
	demandIdentity,
	type ShoppingDemandLine,
} from './shopping-demand.server.ts'
import {
	annotateShoppingDemand,
	type ShoppingAvailability,
} from './shopping-list.server.ts'

describe('annotateShoppingDemand', () => {
	function legacy(names: string[]): ShoppingAvailability {
		return {
			kind: 'legacy-pantry',
			inventoryItems: names.map((name) => ({ name })),
		}
	}

	function householdStaples(
		items: Array<{ displayName: string; isOut?: boolean }>,
	): ShoppingAvailability {
		return {
			kind: 'household-staples',
			staples: items.map((item) => ({
				displayName: item.displayName,
				isOut: item.isOut ?? false,
			})),
		}
	}

	function makeDemandLine(name: string): ShoppingDemandLine {
		return {
			name,
			canonicalName: demandIdentity(name),
			quantity: '1',
			unit: 'cup',
			category: 'other',
		}
	}

	test('legacy recovery strips hard-coded staple ingredients', () => {
		const lines = [makeDemandLine('salt'), makeDemandLine('chicken')]
		const result = annotateShoppingDemand(lines, legacy([]))
		expect(result.lines).toHaveLength(1)
		expect(result.lines[0]!.name).toBe('chicken')
		expect(result.lines[0]!.inStock).toBe(false)
		expect(result.stapleCount).toBe(1)
	})

	test('legacy recovery keeps explicit staple-looking note demand (#109)', () => {
		const noteLine = { ...makeDemandLine('salt'), fromNote: true }
		const result = annotateShoppingDemand(
			[noteLine, makeDemandLine('salt')],
			legacy([]),
		)
		expect(result.lines).toHaveLength(1)
		expect(result.lines[0]!.name).toBe('salt')
		expect(result.stapleCount).toBe(1)
	})

	test('legacy recovery annotates Pantry matches as inStock', () => {
		const lines = [makeDemandLine('chicken'), makeDemandLine('rice')]
		const result = annotateShoppingDemand(lines, legacy(['chicken']))
		expect(result.lines).toHaveLength(2)
		const chicken = result.lines.find((line) => line.name === 'chicken')!
		const rice = result.lines.find((line) => line.name === 'rice')!
		expect(chicken.inStock).toBe(true)
		expect(rice.inStock).toBe(false)
		expect(result.inStockCount).toBe(1)
	})

	test('a pantry "red wine" does not put "red wine vinegar" in stock', () => {
		const lines = [makeDemandLine('red wine vinegar')]
		const result = annotateShoppingDemand(lines, legacy(['red wine']))
		expect(result.lines[0]!.inStock).toBe(false)
		expect(result.inStockCount).toBe(0)
	})

	test('legacy recovery returns correct staple and Pantry counts', () => {
		const lines = [
			makeDemandLine('salt'),
			makeDemandLine('water'),
			makeDemandLine('chicken'),
			makeDemandLine('broccoli'),
		]
		const result = annotateShoppingDemand(lines, legacy(['chicken']))
		expect(result.stapleCount).toBe(2) // salt, water
		expect(result.lines).toHaveLength(2) // chicken, broccoli
		expect(result.inStockCount).toBe(1) // chicken
	})

	test('empty legacy Pantry only strips hard-coded staples', () => {
		const lines = [makeDemandLine('chicken'), makeDemandLine('olive oil')]
		const result = annotateShoppingDemand(lines, legacy([]))
		expect(result.lines).toHaveLength(1)
		expect(result.lines[0]!.name).toBe('chicken')
		expect(result.lines[0]!.inStock).toBe(false)
		expect(result.stapleCount).toBe(1) // olive oil is a staple
	})

	test('post-cutover normal Staples are omitted while Out Staples and non-Staples remain', () => {
		const lines = [
			makeDemandLine('salt'),
			makeDemandLine('olive oil'),
			makeDemandLine('chicken'),
		]
		const result = annotateShoppingDemand(
			lines,
			householdStaples([
				{ displayName: 'salt' },
				{ displayName: 'olive oil', isOut: true },
			]),
		)

		expect(result.lines.map((line) => line.name)).toEqual([
			'olive oil',
			'chicken',
		])
		expect(result.lines.every((line) => !line.inStock)).toBe(true)
		expect(result.stapleCount).toBe(1)
		expect(result.inStockCount).toBe(0)
	})

	test('post-cutover saved state replaces hard-coded staple assumptions', () => {
		const result = annotateShoppingDemand(
			[makeDemandLine('salt'), makeDemandLine('water')],
			householdStaples([]),
		)

		expect(result.lines.map((line) => line.name)).toEqual(['salt', 'water'])
		expect(result.stapleCount).toBe(0)
	})

	test('post-cutover Staple state applies to generated note demand too', () => {
		const noteLine = { ...makeDemandLine('salt'), fromNote: true }
		const normal = annotateShoppingDemand(
			[noteLine],
			householdStaples([{ displayName: 'salt' }]),
		)
		const out = annotateShoppingDemand(
			[noteLine],
			householdStaples([{ displayName: 'salt', isOut: true }]),
		)

		expect(normal.lines).toHaveLength(0)
		expect(out.lines.map((line) => line.name)).toEqual(['salt'])
	})

	test('unresolved identities remain visible unless that exact household Staple is normal', () => {
		const unresolved = makeDemandLine('medium/small peaches')
		expect(
			annotateShoppingDemand(
				[unresolved],
				householdStaples([{ displayName: 'salt' }]),
			).lines,
		).toEqual([{ ...unresolved, inStock: false }])
		expect(
			annotateShoppingDemand(
				[unresolved],
				householdStaples([{ displayName: 'medium/small peaches' }]),
			).lines,
		).toHaveLength(0)
	})

	test('an Out match wins when exact household identities converge on one demand identity', () => {
		const result = annotateShoppingDemand(
			[makeDemandLine('cilantro')],
			householdStaples([
				{ displayName: 'cilantro' },
				{ displayName: 'coriander', isOut: true },
			]),
		)
		expect(result.lines.map((line) => line.name)).toEqual(['cilantro'])
	})

	test('neededCount includes non-Staples, Out Staples, and unresolved demand', () => {
		const result = annotateShoppingDemand(
			[
				makeDemandLine('salt'),
				makeDemandLine('olive oil'),
				makeDemandLine('chicken'),
				makeDemandLine('medium/small peaches'),
			],
			householdStaples([
				{ displayName: 'salt' },
				{ displayName: 'olive oil', isOut: true },
			]),
		)

		expect(result.neededCount).toBe(3)
	})
})
