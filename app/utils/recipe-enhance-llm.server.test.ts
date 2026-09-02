import { describe, expect, it, vi } from 'vitest'
import { consoleError } from '#tests/setup/setup-test-env.ts'
import {
	buildEnhancePrompt,
	enhanceRecipeMetadata,
	parseEnhanceResponse,
	type RecipeInput,
} from './recipe-enhance-llm.server.ts'

const sampleInput: RecipeInput = {
	title: 'Pasta Carbonara',
	description: null,
	activeTime: null,
	totalTime: null,
	ingredients: [
		{ name: 'spaghetti', amount: '400', unit: 'g' },
		{ name: 'guanciale', amount: '200', unit: 'g' },
		{ name: 'egg yolks', amount: '6', unit: null },
		{ name: 'pecorino romano', amount: '100', unit: 'g' },
		{ name: 'black pepper', amount: null, unit: null },
	],
	instructions: [
		{ content: 'Boil a large pot of salted water and cook spaghetti.' },
		{
			content:
				'Cut guanciale into strips and cook until crispy, about 8 minutes.',
		},
		{ content: 'Mix egg yolks with grated pecorino and pepper.' },
		{
			content: 'Toss hot pasta with guanciale, then add egg mixture off heat.',
		},
	],
}

describe('buildEnhancePrompt', () => {
	it('includes title, ingredients, and instructions', () => {
		const prompt = buildEnhancePrompt(sampleInput)
		expect(prompt).toContain('Pasta Carbonara')
		expect(prompt).toContain('spaghetti')
		expect(prompt).toContain('guanciale')
		expect(prompt).toContain('Boil a large pot')
	})

	it('shows missing description and time values and asks for current metadata', () => {
		const prompt = buildEnhancePrompt(sampleInput)
		expect(prompt).toContain('Current description: None')
		expect(prompt).toContain('Current active time: None')
		expect(prompt).toContain('Current total time: None')
		expect(prompt).toContain('"activeTime": 15')
		expect(prompt).toContain('"totalTime": 45')
		expect(prompt).not.toContain('Current prep time')
		expect(prompt).not.toContain('Current cook time')
	})

	it('shows existing values when present', () => {
		const input: RecipeInput = {
			...sampleInput,
			description: 'A classic Roman pasta dish',
			activeTime: 20,
			totalTime: 35,
		}
		const prompt = buildEnhancePrompt(input)
		expect(prompt).toContain('Current description: A classic Roman pasta dish')
		expect(prompt).toContain('Current active time: 20 minutes')
		expect(prompt).toContain('Current total time: 35 minutes')
	})
})

describe('parseEnhanceResponse', () => {
	it('keeps current time suggestions and ignores legacy metadata', () => {
		const result = parseEnhanceResponse(
			JSON.stringify({
				description: 'A concise description.',
				activeTime: 15,
				totalTime: 45,
				servings: 12,
				prepTime: 15,
				cookTime: 30,
			}),
		)

		expect(result).toEqual({
			description: 'A concise description.',
			activeTime: 15,
			totalTime: 45,
		})
	})

	it('parses valid JSON response', () => {
		const text = JSON.stringify({
			description: 'A rich, creamy Roman pasta with guanciale and pecorino.',
			activeTime: 12.4,
			totalTime: 30.6,
		})
		const result = parseEnhanceResponse(text)
		expect(result).toEqual({
			description: 'A rich, creamy Roman pasta with guanciale and pecorino.',
			activeTime: 12,
			totalTime: 31,
		})
	})

	it('returns null for empty/non-JSON text', () => {
		expect(parseEnhanceResponse('not json')).toBeNull()
		expect(parseEnhanceResponse('')).toBeNull()
	})

	it('handles markdown code block wrapping', () => {
		const text = '```json\n{"description": "A test recipe."}\n```'
		const result = parseEnhanceResponse(text)
		expect(result?.description).toBe('A test recipe.')
	})

	it('returns null for invalid field types gracefully', () => {
		const text = JSON.stringify({
			description: 123,
			activeTime: '15',
			totalTime: -1,
		})
		const result = parseEnhanceResponse(text)
		expect(result).toEqual({
			description: null,
			activeTime: null,
			totalTime: null,
		})
	})

	it('rejects a total estimate shorter than the active estimate', () => {
		expect(
			parseEnhanceResponse(JSON.stringify({ activeTime: 30, totalTime: 20 })),
		).toEqual({ description: null, activeTime: 30, totalTime: null })
	})

	it('treats null description as null', () => {
		const text = JSON.stringify({
			description: null,
		})
		const result = parseEnhanceResponse(text)
		expect(result?.description).toBeNull()
	})

	it('trims whitespace in description', () => {
		const text = JSON.stringify({
			description: '  A tasty dish.  ',
		})
		const result = parseEnhanceResponse(text)
		expect(result?.description).toBe('A tasty dish.')
	})
})

describe('enhanceRecipeMetadata', () => {
	it('returns validated suggestions from Anthropic', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								description: 'A classic Roman pasta.',
								activeTime: 10,
								totalTime: 20,
							}),
						},
					],
				}),
				{ status: 200 },
			),
		)

		await expect(enhanceRecipeMetadata(sampleInput)).resolves.toEqual({
			description: 'A classic Roman pasta.',
			activeTime: 10,
			totalTime: 20,
		})
	})

	it('preserves feature-local wording for configuration and rate limits', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY', '')
		await expect(enhanceRecipeMetadata(sampleInput)).resolves.toEqual({
			error: expect.stringContaining('not configured'),
		})

		vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
		consoleError.mockImplementation(() => {})
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('', { status: 429 }),
		)
		await expect(enhanceRecipeMetadata(sampleInput)).resolves.toEqual({
			error: expect.stringContaining('rate limit'),
		})
	})
})
