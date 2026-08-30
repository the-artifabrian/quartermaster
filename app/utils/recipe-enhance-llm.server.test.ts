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

	it('shows "None" for a missing description without asking for other metadata', () => {
		const prompt = buildEnhancePrompt(sampleInput)
		expect(prompt).toContain('Current description: None')
		expect(prompt).not.toContain('Current prep time')
		expect(prompt).not.toContain('Current cook time')
	})

	it('shows existing values when present', () => {
		const input: RecipeInput = {
			...sampleInput,
			description: 'A classic Roman pasta dish',
		}
		const prompt = buildEnhancePrompt(input)
		expect(prompt).toContain('Current description: A classic Roman pasta dish')
	})
})

describe('parseEnhanceResponse', () => {
	it('ignores legacy metadata suggestions and returns description only', () => {
		const result = parseEnhanceResponse(
			JSON.stringify({
				description: 'A concise description.',
				servings: 12,
				prepTime: 15,
				cookTime: 30,
			}),
		)

		expect(result).toEqual({ description: 'A concise description.' })
	})

	it('parses valid JSON response', () => {
		const text = JSON.stringify({
			description: 'A rich, creamy Roman pasta with guanciale and pecorino.',
		})
		const result = parseEnhanceResponse(text)
		expect(result).toEqual({
			description: 'A rich, creamy Roman pasta with guanciale and pecorino.',
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
		})
		const result = parseEnhanceResponse(text)
		expect(result).toEqual({ description: null })
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
								servings: 4,
								prepTime: 10,
								cookTime: 20,
							}),
						},
					],
				}),
				{ status: 200 },
			),
		)

		await expect(enhanceRecipeMetadata(sampleInput)).resolves.toEqual({
			description: 'A classic Roman pasta.',
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
