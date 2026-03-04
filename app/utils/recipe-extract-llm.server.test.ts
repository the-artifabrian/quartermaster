import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('sharp', () => ({
	default: () => ({
		resize: () => ({
			jpeg: () => ({
				toBuffer: () => Promise.resolve(Buffer.from('optimized')),
			}),
		}),
	}),
}))

import {
	buildExtractPrompt,
	parseExtractResponse,
	extractRecipeFromText,
	extractRecipeFromImage,
} from './recipe-extract-llm.server.ts'

const validResponse = {
	title: 'Creamy Garlic Pasta',
	description: 'A quick creamy pasta with garlic and parmesan.',
	servings: 2,
	prepTime: 5,
	cookTime: 15,
	ingredients: [
		{ name: 'pasta', amount: '200', unit: 'g', notes: null },
		{ name: 'garlic', amount: '4', unit: null, notes: 'cloves, minced' },
		{ name: 'cream', amount: '200', unit: 'ml', notes: null },
		{ name: 'parmesan', amount: '50', unit: 'g', notes: 'grated' },
	],
	instructions: [
		{ content: 'Cook pasta according to package directions.' },
		{ content: 'Sauté garlic in olive oil until fragrant.' },
		{ content: 'Add cream and simmer for 3 minutes.' },
		{ content: 'Toss with pasta and parmesan.' },
	],
}

describe('buildExtractPrompt', () => {
	test('includes raw text in output for text mode', () => {
		const prompt = buildExtractPrompt('text', 'My recipe caption here')
		expect(prompt).toContain('My recipe caption here')
		expect(prompt).toContain('---')
	})

	test('truncates text at 16000 chars', () => {
		const longText = 'x'.repeat(20_000)
		const prompt = buildExtractPrompt('text', longText)
		// The text between delimiters should be capped
		expect(prompt).not.toContain('x'.repeat(20_000))
		expect(prompt).toContain('x'.repeat(16_000))
	})

	test('contains JSON structure template', () => {
		const prompt = buildExtractPrompt('text', 'some text')
		expect(prompt).toContain('"title"')
		expect(prompt).toContain('"ingredients"')
		expect(prompt).toContain('"instructions"')
	})

	test('works for image mode', () => {
		const prompt = buildExtractPrompt('image')
		expect(prompt).toContain('Extract a structured recipe from this image')
		expect(prompt).not.toContain('---')
	})

	test('text mode has different intro than image mode', () => {
		const textPrompt = buildExtractPrompt('text', 'some text')
		const imagePrompt = buildExtractPrompt('image')
		expect(textPrompt).toContain(
			'Extract a structured recipe from the following text',
		)
		expect(imagePrompt).toContain(
			'Extract a structured recipe from this image',
		)
	})

	test('includes key extraction rules', () => {
		const prompt = buildExtractPrompt('text', 'some text')
		expect(prompt).toContain('Infer the recipe title')
		expect(prompt).toContain('original units')
		expect(prompt).toContain('no_recipe_found')
	})
})

describe('parseExtractResponse', () => {
	test('parses valid recipe JSON', () => {
		const result = parseExtractResponse(JSON.stringify(validResponse))
		expect(result).not.toBeNull()
		expect(result!.title).toBe('Creamy Garlic Pasta')
		expect(result!.servings).toBe(2)
		expect(result!.ingredients).toHaveLength(4)
		expect(result!.instructions).toHaveLength(4)
	})

	test('returns null for missing title', () => {
		const noTitle = { ...validResponse, title: '' }
		expect(parseExtractResponse(JSON.stringify(noTitle))).toBeNull()
	})

	test('returns null for no ingredients', () => {
		const noIngs = { ...validResponse, ingredients: [] }
		expect(parseExtractResponse(JSON.stringify(noIngs))).toBeNull()
	})

	test('returns null for no instructions', () => {
		const noInsts = { ...validResponse, instructions: [] }
		expect(parseExtractResponse(JSON.stringify(noInsts))).toBeNull()
	})

	test('returns null for invalid JSON', () => {
		expect(parseExtractResponse('not json at all')).toBeNull()
	})

	test('returns null for error no_recipe_found', () => {
		expect(
			parseExtractResponse(JSON.stringify({ error: 'no_recipe_found' })),
		).toBeNull()
	})

	test('caps ingredients at 50', () => {
		const manyIngs = {
			...validResponse,
			ingredients: Array.from({ length: 60 }, (_, i) => ({
				name: `ingredient-${i}`,
				amount: '1',
				unit: 'cup',
				notes: null,
			})),
		}
		const result = parseExtractResponse(JSON.stringify(manyIngs))
		expect(result!.ingredients).toHaveLength(50)
	})

	test('caps instructions at 30', () => {
		const manyInsts = {
			...validResponse,
			instructions: Array.from({ length: 40 }, (_, i) => ({
				content: `Step ${i + 1}`,
			})),
		}
		const result = parseExtractResponse(JSON.stringify(manyInsts))
		expect(result!.instructions).toHaveLength(30)
	})

	test('defaults servings to 4 when invalid', () => {
		const badServings = { ...validResponse, servings: -1 }
		const result = parseExtractResponse(JSON.stringify(badServings))
		expect(result!.servings).toBe(4)
	})

	test('handles null times', () => {
		const nullTimes = {
			...validResponse,
			prepTime: null,
			cookTime: null,
		}
		const result = parseExtractResponse(JSON.stringify(nullTimes))
		expect(result!.prepTime).toBeNull()
		expect(result!.cookTime).toBeNull()
	})

	test('coerces numeric amounts to strings', () => {
		const numericAmounts = {
			...validResponse,
			ingredients: [
				{ name: 'flour', amount: 2, unit: 'cups', notes: null },
				{ name: 'sugar', amount: 0.5, unit: 'cup', notes: null },
			],
		}
		const result = parseExtractResponse(JSON.stringify(numericAmounts))
		expect(result!.ingredients[0]!.amount).toBe('2')
		expect(result!.ingredients[1]!.amount).toBe('0.5')
	})

	test('handles null description', () => {
		const noDesc = { ...validResponse, description: null }
		const result = parseExtractResponse(JSON.stringify(noDesc))
		expect(result!.description).toBeNull()
	})

	test('truncates overlong title', () => {
		const longTitle = { ...validResponse, title: 'A'.repeat(500) }
		const result = parseExtractResponse(JSON.stringify(longTitle))
		expect(result!.title).toHaveLength(200)
	})

	test('truncates overlong description', () => {
		const longDesc = { ...validResponse, description: 'B'.repeat(5000) }
		const result = parseExtractResponse(JSON.stringify(longDesc))
		expect(result!.description).toHaveLength(2000)
	})

	test('truncates overlong ingredient fields', () => {
		const longIng = {
			...validResponse,
			ingredients: [
				{
					name: 'N'.repeat(500),
					amount: '9'.repeat(100),
					unit: 'U'.repeat(100),
					notes: 'X'.repeat(1000),
				},
			],
		}
		const result = parseExtractResponse(JSON.stringify(longIng))
		expect(result!.ingredients[0]!.name).toHaveLength(200)
		expect(result!.ingredients[0]!.amount).toHaveLength(20)
		expect(result!.ingredients[0]!.unit).toHaveLength(30)
		expect(result!.ingredients[0]!.notes).toHaveLength(500)
	})

	test('truncates overlong instruction content', () => {
		const longInst = {
			...validResponse,
			instructions: [{ content: 'S'.repeat(10_000) }],
		}
		const result = parseExtractResponse(JSON.stringify(longInst))
		expect(result!.instructions[0]!.content).toHaveLength(5000)
	})

	test('strips HTML in fields without executing it', () => {
		const xssAttempt = {
			...validResponse,
			title: '<script>alert(1)</script>Pasta',
			ingredients: [
				{
					name: '<img onerror=alert(1) src=x>garlic',
					amount: '1',
					unit: 'clove',
					notes: null,
				},
			],
			instructions: [{ content: '<b onmouseover=alert(1)>Mix</b>' }],
		}
		const result = parseExtractResponse(JSON.stringify(xssAttempt))
		// Should parse — HTML is stored as plain text, not executed
		expect(result).not.toBeNull()
		expect(result!.title).toContain('<script>')
		// Verify it's stored as a raw string (React text nodes will escape on render)
		expect(typeof result!.title).toBe('string')
	})
})

describe('extractRecipeFromText', () => {
	const originalEnv = process.env.ANTHROPIC_API_KEY

	beforeEach(() => {
		vi.restoreAllMocks()
	})

	afterEach(() => {
		if (originalEnv !== undefined) {
			process.env.ANTHROPIC_API_KEY = originalEnv
		} else {
			delete process.env.ANTHROPIC_API_KEY
		}
	})

	test('returns error when API key is missing', async () => {
		delete process.env.ANTHROPIC_API_KEY
		const result = await extractRecipeFromText('some recipe text')
		expect(result).toEqual({ error: expect.stringContaining('not configured') })
	})

	test('returns error on non-OK response', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('', { status: 500 }),
		)

		const result = await extractRecipeFromText('some recipe text')
		expect(result).toHaveProperty('error')
	})

	test('returns parsed recipe on success', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					content: [{ type: 'text', text: JSON.stringify(validResponse) }],
				}),
				{ status: 200 },
			),
		)

		const result = await extractRecipeFromText('some recipe text')
		expect(result).not.toHaveProperty('error')
		expect((result as { title: string }).title).toBe('Creamy Garlic Pasta')
	})

	test('returns user-friendly error when LLM cannot find recipe', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					content: [
						{
							type: 'text',
							text: JSON.stringify({ error: 'no_recipe_found' }),
						},
					],
				}),
				{ status: 200 },
			),
		)

		const result = await extractRecipeFromText('random non-recipe text')
		expect(result).toHaveProperty('error')
		expect((result as { error: string }).error).toContain(
			"Couldn't find a recipe",
		)
	})

	test('returns rate limit error on 429', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('', { status: 429 }),
		)

		const result = await extractRecipeFromText('some text')
		expect((result as { error: string }).error).toContain('rate limit')
	})
})

describe('extractRecipeFromImage', () => {
	const originalEnv = process.env.ANTHROPIC_API_KEY

	beforeEach(() => {
		vi.restoreAllMocks()
	})

	afterEach(() => {
		if (originalEnv !== undefined) {
			process.env.ANTHROPIC_API_KEY = originalEnv
		} else {
			delete process.env.ANTHROPIC_API_KEY
		}
	})

	test('sends image content block with correct media type', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		let capturedBody: string | undefined
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
			capturedBody = opts?.body as string
			return new Response(
				JSON.stringify({
					content: [{ type: 'text', text: JSON.stringify(validResponse) }],
				}),
				{ status: 200 },
			)
		})

		await extractRecipeFromImage('base64data', 'image/jpeg')

		const body = JSON.parse(capturedBody!) as {
			messages: Array<{
				content: Array<{
					type: string
					source?: { media_type: string; data: string }
				}>
			}>
		}
		const imageBlock = body.messages[0]!.content[0]!
		expect(imageBlock.type).toBe('image')
		expect(imageBlock.source!.media_type).toBe('image/jpeg')
		expect(imageBlock.source!.data).toBe(Buffer.from('optimized').toString('base64'))
	})

	test('rejects unsupported media type without calling API', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		const fetchSpy = vi.spyOn(globalThis, 'fetch')

		const result = await extractRecipeFromImage('base64', 'image/gif')
		expect(result).toHaveProperty('error')
		expect((result as { error: string }).error).toContain('Unsupported')
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	test('rejects arbitrary media type strings', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		const fetchSpy = vi.spyOn(globalThis, 'fetch')

		const result = await extractRecipeFromImage(
			'base64',
			'application/x-executable',
		)
		expect(result).toHaveProperty('error')
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	test('returns error when API key is missing', async () => {
		delete process.env.ANTHROPIC_API_KEY
		const result = await extractRecipeFromImage('base64', 'image/png')
		expect(result).toEqual({ error: expect.stringContaining('not configured') })
	})

	test('returns error on non-OK response', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('', { status: 500 }),
		)

		const result = await extractRecipeFromImage('base64', 'image/png')
		expect(result).toHaveProperty('error')
	})

	test('returns parsed recipe on success', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					content: [{ type: 'text', text: JSON.stringify(validResponse) }],
				}),
				{ status: 200 },
			),
		)

		const result = await extractRecipeFromImage('base64', 'image/png')
		expect(result).not.toHaveProperty('error')
		expect((result as { title: string }).title).toBe('Creamy Garlic Pasta')
		expect((result as { ingredients: unknown[] }).ingredients).toHaveLength(4)
	})
})
