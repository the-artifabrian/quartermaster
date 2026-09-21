import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

type SharpChain = {
	rotate: () => SharpChain
	resize: (...args: unknown[]) => SharpChain
	jpeg: (...args: unknown[]) => SharpChain
	toBuffer: () => Promise<Buffer>
}

const sharpCalls: Array<{
	rotated: boolean
	resize: unknown[]
	jpeg: unknown[]
}> = []

vi.mock('sharp', () => ({
	default: () => {
		const call = {
			rotated: false,
			resize: [] as unknown[],
			jpeg: [] as unknown[],
		}
		const chain: SharpChain = {
			rotate: () => {
				call.rotated = true
				return chain
			},
			resize: (...resize: unknown[]) => {
				call.resize = resize
				return chain
			},
			jpeg: (...jpeg: unknown[]) => {
				call.jpeg = jpeg
				sharpCalls.push(call)
				return chain
			},
			toBuffer: () => Promise.resolve(Buffer.from('optimized')),
		}
		return chain
	},
}))

import {
	MAX_RAW_TEXT_LENGTH,
	MAX_RECIPE_DESCRIPTION_LENGTH,
	MAX_RECIPE_INGREDIENTS,
	MAX_RECIPE_INSTRUCTIONS,
	MAX_RECIPE_NOTES_LENGTH,
	MAX_RECIPE_TITLE_LENGTH,
	RecipeDescriptionSchema,
	RecipeNotesSchema,
	RecipeTitleSchema,
} from './recipe-validation.ts'
import { CANONICAL_COUNT_UNITS, CANONICAL_UNITS } from './unit-conversion.ts'
import {
	buildExtractPrompt,
	parseExtractResponse,
	extractRecipeFromText,
	extractRecipeFromImages,
} from './recipe-extract-llm.server.ts'

const validResponse = {
	title: 'Creamy Garlic Pasta',
	description: 'A quick creamy pasta with garlic and parmesan.',
	activeTime: 5,
	totalTime: 20,
	yieldAmount: 2,
	yieldLabel: 'servings',
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

	test('carries the whole paste the box accepts, and truncates beyond it', () => {
		const longText = 'x'.repeat(MAX_RAW_TEXT_LENGTH + 10_000)
		const prompt = buildExtractPrompt('text', longText)
		// A blog post puts the recipe card last: cutting below the paste limit
		// drops exactly the part that matters.
		expect(prompt).toContain('x'.repeat(MAX_RAW_TEXT_LENGTH))
		expect(prompt).not.toContain('x'.repeat(MAX_RAW_TEXT_LENGTH + 1))
	})

	test('contains JSON structure template', () => {
		const prompt = buildExtractPrompt('text', 'some text')
		expect(prompt).toContain('"title"')
		expect(prompt).toContain('"ingredients"')
		expect(prompt).toContain('"instructions"')
	})

	test('works for image mode', () => {
		const prompt = buildExtractPrompt('image')
		expect(prompt).toContain(
			'Extract a structured recipe from the provided image(s)',
		)
		expect(prompt).not.toContain('---')
	})

	test('text mode has different intro than image mode', () => {
		const textPrompt = buildExtractPrompt('text', 'some text')
		const imagePrompt = buildExtractPrompt('image')
		expect(textPrompt).toContain(
			'Extract a structured recipe from the following text',
		)
		expect(imagePrompt).toContain(
			'Extract a structured recipe from the provided image(s)',
		)
	})

	test('includes key extraction rules', () => {
		const prompt = buildExtractPrompt('text', 'some text')
		expect(prompt).toContain('Infer the recipe title')
		expect(prompt).toContain('no_recipe_found')
	})

	test('names every canonical unit consolidation understands', () => {
		const prompt = buildExtractPrompt('text', 'some text')
		// The joined lists, not each unit on its own: "l" and "g" would match
		// anywhere in the prose and prove nothing.
		expect(prompt).toContain(CANONICAL_UNITS.join(', '))
		expect(prompt).toContain(CANONICAL_COUNT_UNITS.join(', '))
		expect(CANONICAL_UNITS).toContain('tbsp')
		expect(CANONICAL_COUNT_UNITS).toContain('each')
		// The canonical list replaces the old "never use 'unit' as a unit" patch.
		expect(prompt).not.toContain('Never use "unit" as a unit')
		expect(prompt).toContain('linguri')
		expect(prompt).toContain('Never convert between metric and imperial')
	})

	test('asks for an amount format parseAmount actually reads', () => {
		const prompt = buildExtractPrompt('text', 'some text')
		expect(prompt).toContain('1.5')
		expect(prompt).toContain('never "1,5"')
		expect(prompt).toContain('1 1/2')
		// "1 to 2" parses as 1, so the range has to survive in notes.
		expect(prompt).toContain('lower bound')
	})

	test('separates the bare ingredient name from its preparation', () => {
		const prompt = buildExtractPrompt('text', 'some text')
		expect(prompt).toContain('name is the bare ingredient')
		expect(prompt).toContain('belong in notes')
	})

	test('says which fields are written in English', () => {
		const prompt = buildExtractPrompt('text', 'some text')
		expect(prompt).toContain(
			'Write the title, description, instructions, ingredient names and notes in English',
		)
	})

	test('states the caps the save path enforces', () => {
		const prompt = buildExtractPrompt('text', 'some text')
		expect(prompt).toContain(`under ${MAX_RECIPE_TITLE_LENGTH} characters`)
		expect(prompt).toContain(
			`at most ${MAX_RECIPE_INGREDIENTS} ingredient rows`,
		)
		expect(prompt).toContain(
			`at most ${MAX_RECIPE_INSTRUCTIONS} instruction steps`,
		)
		expect(prompt).toContain(`under ${MAX_RECIPE_NOTES_LENGTH} characters`)
	})

	test("asks for the cook's notes as a top-level field", () => {
		const prompt = buildExtractPrompt('text', 'some text')
		expect(prompt).toContain('"notes"')
		expect(prompt).toContain('substitutions, storage, make-ahead')
	})

	test('rules out a Total time shorter than Active time', () => {
		const prompt = buildExtractPrompt('text', 'some text')
		expect(prompt).toContain('Total time must not be shorter than Active time')
	})

	test('asks for times as whole minutes, which is all the schema accepts', () => {
		const prompt = buildExtractPrompt('text', 'some text')
		// Sonnet returns "20 min" / "1 hr 15 min" without this rule, and a string
		// is discarded, so the stated time silently disappears from the review.
		expect(prompt).toContain('plain whole numbers of minutes')
		expect(prompt).toContain('"1 hr 15 min" is 75')
		// The template keeps nulls: a worked example here would invite the model
		// to default times the source never stated.
		expect(prompt).toContain('"activeTime": null')
	})

	test('discards a time the model sent as a string rather than guessing', () => {
		const stringTimes = {
			...validResponse,
			activeTime: '20 min',
			totalTime: '1 hr 15 min',
		}
		expect(parseExtractResponse(JSON.stringify(stringTimes))).toMatchObject({
			activeTime: null,
			totalTime: null,
		})
	})

	test('includes sub-section handling rule', () => {
		const prompt = buildExtractPrompt('text', 'some text')
		expect(prompt).toContain('do NOT merge or sum quantities')
		expect(prompt).toContain('sub-section')
	})

	test('instructs heading rows instead of section-in-notes', () => {
		const prompt = buildExtractPrompt('text', 'some text')
		expect(prompt).toContain('isHeading')
		expect(prompt).toContain('heading row')
		expect(prompt).toContain('Do NOT put the section name into the notes field')
	})
})

describe('parseExtractResponse', () => {
	test('returns only explicit Active, Total, and paired Yield metadata', () => {
		const result = parseExtractResponse(
			JSON.stringify({
				...validResponse,
				servings: 97,
				prepTime: 5,
				cookTime: 15,
				activeTime: 5,
				totalTime: 20,
				yieldAmount: 2,
				yieldLabel: 'servings',
			}),
		)

		expect(result).toEqual(
			expect.objectContaining({
				activeTime: 5,
				totalTime: 20,
				yieldAmount: 2,
				yieldLabel: 'servings',
			}),
		)
		expect(result).not.toHaveProperty('servings')
		expect(result).not.toHaveProperty('prepTime')
		expect(result).not.toHaveProperty('cookTime')
	})

	test('parses valid recipe JSON', () => {
		const result = parseExtractResponse(JSON.stringify(validResponse))
		expect(result).not.toBeNull()
		expect(result!.title).toBe('Creamy Garlic Pasta')
		expect(result).toMatchObject({
			activeTime: 5,
			totalTime: 20,
			yieldAmount: 2,
			yieldLabel: 'servings',
		})
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

	test('keeps every row the creation form would accept', () => {
		const manyRows = {
			...validResponse,
			ingredients: Array.from({ length: 60 }, (_, i) => ({
				name: `ingredient-${i}`,
				amount: '1',
				unit: 'cup',
				notes: null,
			})),
			instructions: Array.from({ length: 40 }, (_, i) => ({
				content: `Step ${i + 1}`,
			})),
		}
		const result = parseExtractResponse(JSON.stringify(manyRows))
		expect(result!.ingredients).toHaveLength(60)
		expect(result!.instructions).toHaveLength(40)
	})

	test('caps rows at the form limits', () => {
		const tooManyRows = {
			...validResponse,
			ingredients: Array.from(
				{ length: MAX_RECIPE_INGREDIENTS + 20 },
				(_, i) => ({
					name: `ingredient-${i}`,
					amount: '1',
					unit: 'cup',
					notes: null,
				}),
			),
			instructions: Array.from(
				{ length: MAX_RECIPE_INSTRUCTIONS + 20 },
				(_, i) => ({ content: `Step ${i + 1}` }),
			),
		}
		const result = parseExtractResponse(JSON.stringify(tooManyRows))
		expect(result!.ingredients).toHaveLength(MAX_RECIPE_INGREDIENTS)
		expect(result!.instructions).toHaveLength(MAX_RECIPE_INSTRUCTIONS)
	})

	test('keeps incomplete yield metadata unknown', () => {
		const incompleteYield = { ...validResponse, yieldLabel: null }
		const result = parseExtractResponse(JSON.stringify(incompleteYield))
		expect(result).toMatchObject({ yieldAmount: null, yieldLabel: null })
	})

	test('handles null Active and Total times', () => {
		const nullTimes = {
			...validResponse,
			activeTime: null,
			totalTime: null,
		}
		const result = parseExtractResponse(JSON.stringify(nullTimes))
		expect(result!.activeTime).toBeNull()
		expect(result!.totalTime).toBeNull()
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

	test('truncates title and description to what a save accepts', () => {
		const overlong = {
			...validResponse,
			title: 'A'.repeat(500),
			description: 'B'.repeat(5000),
		}
		const result = parseExtractResponse(JSON.stringify(overlong))
		expect(result!.title).toHaveLength(MAX_RECIPE_TITLE_LENGTH)
		expect(result!.description).toHaveLength(MAX_RECIPE_DESCRIPTION_LENGTH)
		// The review page must never hand the save path a value it will reject.
		expect(RecipeTitleSchema.safeParse(result!.title).success).toBe(true)
		expect(RecipeDescriptionSchema.safeParse(result!.description).success).toBe(
			true,
		)
	})

	test("keeps the cook's notes and caps them at the save limit", () => {
		const withNotes = {
			...validResponse,
			notes: 'Swap the cream for coconut milk. Keeps three days, covered.',
		}
		expect(parseExtractResponse(JSON.stringify(withNotes))!.notes).toBe(
			'Swap the cream for coconut milk. Keeps three days, covered.',
		)

		const longNotes = { ...validResponse, notes: 'N'.repeat(5000) }
		const capped = parseExtractResponse(JSON.stringify(longNotes))!.notes
		expect(capped).toHaveLength(MAX_RECIPE_NOTES_LENGTH)
		expect(RecipeNotesSchema.safeParse(capped).success).toBe(true)
	})

	test('returns null notes when the source has no tips', () => {
		expect(
			parseExtractResponse(JSON.stringify(validResponse))!.notes,
		).toBeNull()
		expect(
			parseExtractResponse(JSON.stringify({ ...validResponse, notes: '   ' }))!
				.notes,
		).toBeNull()
	})

	test('drops a Total time shorter than the Active time it is paired with', () => {
		const impossible = { ...validResponse, activeTime: 30, totalTime: 10 }
		const result = parseExtractResponse(JSON.stringify(impossible))
		expect(result).toMatchObject({ activeTime: 30, totalTime: null })
	})

	test('keeps a Total time equal to or longer than Active time', () => {
		const fine = { ...validResponse, activeTime: 30, totalTime: 30 }
		expect(parseExtractResponse(JSON.stringify(fine))).toMatchObject({
			activeTime: 30,
			totalTime: 30,
		})
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

	test('preserves heading rows and marks them isHeading: true', () => {
		const grouped = {
			...validResponse,
			ingredients: [
				{
					name: 'Pie Dough',
					amount: null,
					unit: null,
					notes: null,
					isHeading: true,
				},
				{ name: 'flour', amount: '212', unit: 'g', notes: null },
				{
					name: 'Streusel Topping',
					amount: null,
					unit: null,
					notes: null,
					isHeading: true,
				},
				{ name: 'brown sugar', amount: '80', unit: 'g', notes: null },
			],
		}
		const result = parseExtractResponse(JSON.stringify(grouped))
		expect(result).not.toBeNull()
		expect(result!.ingredients).toHaveLength(4)
		expect(result!.ingredients[0]!.isHeading).toBe(true)
		expect(result!.ingredients[0]!.name).toBe('Pie Dough')
		expect(result!.ingredients[0]!.amount).toBeNull()
		expect(result!.ingredients[1]!.isHeading).toBe(false)
		expect(result!.ingredients[1]!.name).toBe('flour')
		expect(result!.ingredients[2]!.isHeading).toBe(true)
		expect(result!.ingredients[3]!.isHeading).toBe(false)
	})

	test('defaults isHeading to false when omitted', () => {
		const result = parseExtractResponse(JSON.stringify(validResponse))
		expect(result).not.toBeNull()
		for (const ing of result!.ingredients) {
			expect(ing.isHeading).toBe(false)
		}
	})

	test('returns null when response has only heading rows', () => {
		const headingsOnly = {
			...validResponse,
			ingredients: [
				{
					name: 'Pie Dough',
					amount: null,
					unit: null,
					notes: null,
					isHeading: true,
				},
				{
					name: 'Streusel',
					amount: null,
					unit: null,
					notes: null,
					isHeading: true,
				},
			],
		}
		expect(parseExtractResponse(JSON.stringify(headingsOnly))).toBeNull()
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

	test('reports a truncated answer as too long, not as no recipe found', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					stop_reason: 'max_tokens',
					// Cut mid-array, exactly as the provider returns it.
					content: [
						{
							type: 'text',
							text: JSON.stringify(validResponse).slice(0, 120),
						},
					],
				}),
				{ status: 200 },
			),
		)

		const error = (await extractRecipeFromText('a very long recipe')) as {
			error: string
		}
		expect(error.error).toContain('too long to extract')
		expect(error.error).not.toContain("Couldn't find a recipe")
	})

	test('asks for enough output tokens to carry a full recipe', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		let capturedBody: string | undefined
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
			capturedBody = opts?.body as string
			return new Response(
				JSON.stringify({
					stop_reason: 'end_turn',
					content: [{ type: 'text', text: JSON.stringify(validResponse) }],
				}),
				{ status: 200 },
			)
		})

		await extractRecipeFromText('some recipe text')
		const body = JSON.parse(capturedBody!) as {
			max_tokens: number
			model: string
		}
		expect(body.max_tokens).toBeGreaterThanOrEqual(8192)
		expect(body.model).toBe('claude-haiku-4-5-20251001')
	})
})

describe('extractRecipeFromImages', () => {
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

		await extractRecipeFromImages([
			{ base64: 'base64data', mediaType: 'image/jpeg' },
		])

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
		expect(imageBlock.source!.data).toBe(
			Buffer.from('optimized').toString('base64'),
		)
	})

	test('sends multiple image content blocks for multiple images', async () => {
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

		// Use same base64 data for all images to work with the sharp mock
		await extractRecipeFromImages([
			{ base64: 'base64data', mediaType: 'image/jpeg' },
			{ base64: 'base64data', mediaType: 'image/jpeg' },
			{ base64: 'base64data', mediaType: 'image/jpeg' },
		])

		const body = JSON.parse(capturedBody!) as {
			messages: Array<{
				content: Array<{
					type: string
					source?: { media_type: string; data: string }
				}>
			}>
		}
		const contentBlocks = body.messages[0]!.content
		// 3 image blocks + 1 text block
		expect(contentBlocks).toHaveLength(4)
		expect(contentBlocks[0]!.type).toBe('image')
		expect(contentBlocks[1]!.type).toBe('image')
		expect(contentBlocks[2]!.type).toBe('image')
		expect(contentBlocks[3]!.type).toBe('text')
	})

	test('rejects unsupported media type without calling API', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		const fetchSpy = vi.spyOn(globalThis, 'fetch')

		const result = await extractRecipeFromImages([
			{ base64: 'base64', mediaType: 'image/gif' },
		])
		expect(result).toHaveProperty('error')
		expect((result as { error: string }).error).toContain('Unsupported')
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	test('rejects arbitrary media type strings', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		const fetchSpy = vi.spyOn(globalThis, 'fetch')

		const result = await extractRecipeFromImages([
			{ base64: 'base64', mediaType: 'application/x-executable' },
		])
		expect(result).toHaveProperty('error')
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	test('returns error when API key is missing', async () => {
		delete process.env.ANTHROPIC_API_KEY
		const result = await extractRecipeFromImages([
			{ base64: 'base64', mediaType: 'image/png' },
		])
		expect(result).toEqual({ error: expect.stringContaining('not configured') })
	})

	test('returns error on non-OK response', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('', { status: 500 }),
		)

		const result = await extractRecipeFromImages([
			{ base64: 'base64', mediaType: 'image/png' },
		])
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

		const result = await extractRecipeFromImages([
			{ base64: 'base64', mediaType: 'image/png' },
		])
		expect(result).not.toHaveProperty('error')
		expect((result as { title: string }).title).toBe('Creamy Garlic Pasta')
		expect((result as { ingredients: unknown[] }).ingredients).toHaveLength(4)
	})

	test('keeps a phone screenshot large enough to read', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		sharpCalls.length = 0
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

		await extractRecipeFromImages([
			{ base64: 'base64data', mediaType: 'image/jpeg' },
		])

		// 1568px is what Sonnet accepts before downsampling on its own; anything
		// smaller throws away recipe text on a 1170×2532 screenshot.
		expect(sharpCalls).toHaveLength(1)
		expect(sharpCalls[0]!.resize.slice(0, 2)).toEqual([1568, 1568])
		// Without auto-orientation a portrait photo arrives on its side: sharp
		// drops the EXIF tag on write and leaves the pixels as they were.
		expect(sharpCalls[0]!.rotated).toBe(true)
		expect(sharpCalls[0]!.jpeg[0]).toMatchObject({
			quality: expect.any(Number),
		})
		expect(
			(sharpCalls[0]!.jpeg[0] as { quality: number }).quality,
		).toBeGreaterThan(80)
		expect((JSON.parse(capturedBody!) as { model: string }).model).toBe(
			'claude-sonnet-5',
		)
	})
})
