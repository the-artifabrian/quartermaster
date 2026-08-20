import { describe, expect, test, vi } from 'vitest'
import {
	buildQuantityProposalPrompt,
	parseQuantityProposalResponse,
	proposeContextualMealQuantities,
	type QuantityPlanningInput,
} from './meal-quantity-proposal.server.ts'

function makeInput(): QuantityPlanningInput {
	return {
		context: 'planned-meal',
		guestCount: 6,
		sections: [
			{
				name: 'Mains',
				items: [
					{
						kind: 'recipe',
						itemKey: 'item-kofta',
						recipe: {
							title: 'Chicken kofta',
							description: 'Grilled skewers for the table',
							note: 'Make enough for dinner',
							currentScaleMultiplier: 1,
							ingredients: [
								{
									name: 'chicken',
									amount: '750',
									unit: 'g',
									notes: 'ground',
									isHeading: false,
								},
							],
							instructions: [{ content: 'Shape 18 kofta and grill.' }],
						},
					},
					{ kind: 'note', text: 'Serve family style.' },
					{
						kind: 'recipe',
						itemKey: 'item-cake',
						recipe: {
							title: 'Orange cake',
							description: 'One whole cake',
							note: null,
							currentScaleMultiplier: 1,
							ingredients: [
								{
									name: 'oranges',
									amount: '2',
									unit: null,
									notes: null,
									isHeading: false,
								},
							],
							instructions: [{ content: 'Bake in one 23 cm tin.' }],
						},
					},
				],
			},
		],
	}
}

function proposalText() {
	return JSON.stringify({
		status: 'proposal',
		assumptions: ['The meal includes side dishes.'],
		items: [
			{
				itemKey: 'item-kofta',
				scaleMultiplier: 1.5,
				scalingMode: 'flexible',
				rationale: 'Twenty-seven pieces leaves a modest buffer.',
				assumptions: ['Most guests eat four pieces.'],
			},
			{
				itemKey: 'item-cake',
				scaleMultiplier: 1,
				scalingMode: 'fixed',
				rationale: 'Keep the cake whole.',
				assumptions: ['One cake is enough alongside the rest of the meal.'],
			},
		],
	})
}

describe('contextual Meal quantity proposals', () => {
	test('prompt includes guest context, order, roles, content, current multipliers, and generic fixed/batch rules without supplying legacy servings', () => {
		const prompt = buildQuantityProposalPrompt(makeInput())

		expect(prompt).toContain('"guestCount": 6')
		expect(prompt).toContain('"role": "Mains"')
		expect(prompt).toContain('"order": 0')
		expect(prompt).toContain('"currentScaleMultiplier": 1')
		expect(prompt).toContain('"title": "Chicken kofta"')
		expect(prompt).toContain('"name": "chicken"')
		expect(prompt).toContain('Shape 18 kofta and grill.')
		expect(prompt).toContain('"fixedBatchConstraints"')
		expect(prompt).not.toMatch(/"servings"\s*:/)
		expect(prompt).not.toMatch(/"yield"\s*:/)
	})

	test('validated proposal covers exact item keys with positive decimal multipliers and visible reasoning', () => {
		const result = parseQuantityProposalResponse(proposalText(), makeInput())

		expect(result).toEqual({
			ok: true,
			data: expect.objectContaining({
				status: 'proposal',
				items: [
					expect.objectContaining({
						itemKey: 'item-kofta',
						scaleMultiplier: 1.5,
					}),
					expect.objectContaining({
						itemKey: 'item-cake',
						scaleMultiplier: 1,
						scalingMode: 'fixed',
					}),
				],
			}),
		})
	})

	test('rejects missing/forged keys and nonsensical fractional fixed or whole-batch multipliers', () => {
		const base = JSON.parse(proposalText()) as {
			items: Array<Record<string, unknown>>
		}
		base.items[1]!.scaleMultiplier = 0.5
		expect(
			parseQuantityProposalResponse(JSON.stringify(base), makeInput()),
		).toMatchObject({ ok: false, failure: { kind: 'schema' } })

		base.items[1]!.scaleMultiplier = 1
		base.items[1]!.itemKey = 'forged-item'
		expect(
			parseQuantityProposalResponse(JSON.stringify(base), makeInput()),
		).toMatchObject({ ok: false, failure: { kind: 'schema' } })

		base.items[1]!.itemKey = 'item-cake'
		base.items[1]!.targetYield = 12
		expect(
			parseQuantityProposalResponse(JSON.stringify(base), makeInput()),
		).toMatchObject({ ok: false, failure: { kind: 'schema' } })
	})

	test('allows one structured clarification but rejects a second round', () => {
		const clarification = JSON.stringify({
			status: 'clarification',
			question: 'Should the kofta be the main course?',
			choices: ['Yes, it is the main', 'No, it is one of several mains'],
		})

		expect(
			parseQuantityProposalResponse(clarification, makeInput(), true),
		).toMatchObject({ ok: true, data: { status: 'clarification' } })
		expect(
			parseQuantityProposalResponse(clarification, makeInput(), false),
		).toMatchObject({ ok: false, failure: { kind: 'schema' } })
	})

	test('uses the shared Anthropic seam and includes the one clarification answer on the final call', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
			new Response(
				JSON.stringify({
					content: [{ type: 'text', text: proposalText() }],
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			),
		)
		const result = await proposeContextualMealQuantities(makeInput(), {
			clarification: {
				question: 'Should the kofta be the main course?',
				answer: 'Yes, it is the main',
			},
			adapter: { apiKey: () => 'test-key', fetch, logError: vi.fn() },
		})

		expect(result).toMatchObject({ ok: true, data: { status: 'proposal' } })
		const requestBody = JSON.parse(
			String((fetch.mock.calls[0]![1] as RequestInit).body),
		) as { messages: Array<{ content: string }> }
		expect(requestBody.messages[0]!.content).toContain(
			'"answer": "Yes, it is the main"',
		)
		expect(requestBody.messages[0]!.content).toContain(
			'You may not ask another question',
		)
	})

	test('provider and parse failures return complete manual fallback wording', async () => {
		const providerFailure = await proposeContextualMealQuantities(makeInput(), {
			adapter: {
				apiKey: () => 'test-key',
				fetch: vi
					.fn<typeof globalThis.fetch>()
					.mockResolvedValue(new Response('', { status: 503 })),
				logError: vi.fn(),
			},
		})
		expect(providerFailure).toEqual({
			ok: false,
			error:
				'Plan quantities is temporarily unavailable. Manual multipliers are unchanged.',
		})

		const parseFailure = await proposeContextualMealQuantities(makeInput(), {
			adapter: {
				apiKey: () => 'test-key',
				fetch: vi
					.fn<typeof globalThis.fetch>()
					.mockResolvedValue(
						new Response(
							JSON.stringify({ content: [{ type: 'text', text: 'not json' }] }),
							{ status: 200 },
						),
					),
				logError: vi.fn(),
			},
		})
		expect(parseFailure).toEqual({
			ok: false,
			error:
				'Plan quantities could not produce a safe proposal. Manual multipliers are unchanged.',
		})
	})
})
