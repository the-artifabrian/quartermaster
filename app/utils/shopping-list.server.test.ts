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
	function householdStaples(displayNames: string[]): ShoppingAvailability {
		return { staples: displayNames.map((displayName) => ({ displayName })) }
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

	test('a Staple match is omitted and every other line remains', () => {
		const lines = [
			makeDemandLine('salt'),
			makeDemandLine('olive oil'),
			makeDemandLine('chicken'),
		]
		const result = annotateShoppingDemand(
			lines,
			householdStaples(['salt', 'olive oil']),
		)

		expect(result.lines.map((line) => line.name)).toEqual(['chicken'])
		expect(result.stapleCount).toBe(2)
		expect(result.neededCount).toBe(1)
	})

	test('saved Staples replace the hard-coded staple assumptions', () => {
		// The ingredient heuristic still calls salt and water basics, but this
		// seam answers only from what the household saved. The Plan picker is
		// where the heuristic gets its say, as an unticked default.
		const result = annotateShoppingDemand(
			[makeDemandLine('salt'), makeDemandLine('water')],
			householdStaples([]),
		)

		expect(result.lines.map((line) => line.name)).toEqual(['salt', 'water'])
		expect(result.stapleCount).toBe(0)
	})

	test('a Staple match is omitted from generated note demand too', () => {
		const noteLine = { ...makeDemandLine('salt'), fromNote: true }

		expect(
			annotateShoppingDemand([noteLine], householdStaples(['salt'])).lines,
		).toHaveLength(0)
		expect(
			annotateShoppingDemand([noteLine], householdStaples([])).lines,
		).toEqual([noteLine])
	})

	test('an unresolved identity is kept unless it is itself a Staple', () => {
		const unresolved = makeDemandLine('medium/small peaches')

		expect(
			annotateShoppingDemand([unresolved], householdStaples(['salt'])).lines,
		).toEqual([unresolved])
		expect(
			annotateShoppingDemand(
				[unresolved],
				householdStaples(['medium/small peaches']),
			).lines,
		).toHaveLength(0)
	})

	test('exact household identities converging on one demand identity both match', () => {
		// cilantro/coriander are separate household identities that share a
		// demand identity; either one saved means the household has it.
		expect(
			annotateShoppingDemand(
				[makeDemandLine('cilantro')],
				householdStaples(['coriander']),
			).lines,
		).toHaveLength(0)
	})
})
