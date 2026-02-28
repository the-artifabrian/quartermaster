import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
	generateRecipeFromInventory,
	buildPrompt,
	parseRecipeResponse,
	type InventoryInput,
} from './recipe-generation-llm.server.ts'

const validResponse = {
	title: 'Chicken Stir Fry',
	description: 'A quick and easy stir fry with tender chicken and vegetables.',
	servings: 4,
	prepTime: 10,
	cookTime: 15,
	ingredients: [
		{ name: 'chicken breast', amount: '2', unit: 'lbs', notes: 'sliced' },
		{ name: 'bell pepper', amount: '1', unit: null, notes: 'diced' },
		{ name: 'soy sauce', amount: '3', unit: 'tbsp', notes: null },
	],
	instructions: [
		{ content: 'Slice the chicken into thin strips.' },
		{ content: 'Heat oil in a large pan over high heat.' },
		{ content: 'Cook chicken until golden, about 5 minutes.' },
		{ content: 'Add vegetables and soy sauce, cook for 3 more minutes.' },
	],
}

function makeInventory(
	overrides?: Partial<InventoryInput>[],
): InventoryInput[] {
	const defaults: InventoryInput[] = [
		{ name: 'chicken breast' },
		{ name: 'bell pepper' },
		{ name: 'rice' },
	]
	if (overrides) {
		return overrides.map((o, i) => ({
			...defaults[i % defaults.length]!,
			...o,
		}))
	}
	return defaults
}

describe('buildPrompt', () => {
	test('includes all inventory items', () => {
		const inventory = makeInventory()
		const prompt = buildPrompt(inventory)

		expect(prompt).toContain('chicken breast')
		expect(prompt).toContain('bell pepper')
		expect(prompt).toContain('rice')
	})

	test('caps inventory at 80 items', () => {
		const inventory: InventoryInput[] = Array.from({ length: 100 }, (_, i) => ({
			name: `item-${i}`,
		}))
		const prompt = buildPrompt(inventory)

		expect(prompt).toContain('item-0')
		expect(prompt).toContain('item-79')
		expect(prompt).not.toContain('item-80')
	})

	test('includes meal type preference', () => {
		const prompt = buildPrompt(makeInventory(), { mealType: 'breakfast' })
		expect(prompt).toContain('Meal type: breakfast')
	})

	test('includes quick meal preference', () => {
		const prompt = buildPrompt(makeInventory(), { quickMeal: true })
		expect(prompt).toContain('30 minutes or less')
	})

	test('includes both preferences', () => {
		const prompt = buildPrompt(makeInventory(), {
			mealType: 'dinner',
			quickMeal: true,
		})
		expect(prompt).toContain('Meal type: dinner')
		expect(prompt).toContain('30 minutes or less')
	})

	test('omits preferences section when none given', () => {
		const prompt = buildPrompt(makeInventory())
		expect(prompt).not.toContain('Preferences:')
	})

	test('includes description in preferences', () => {
		const prompt = buildPrompt(makeInventory(), {
			description: 'gyoza dipping sauce',
		})
		expect(prompt).toContain('Description: gyoza dipping sauce')
	})

	test('description relaxes ingredient rules', () => {
		const prompt = buildPrompt(makeInventory(), {
			description: 'gyoza dipping sauce',
		})
		expect(prompt).not.toContain('Use ONLY')
		expect(prompt).toContain('MAY include common ingredients not listed')
	})

	test('no description keeps strict rules', () => {
		const prompt = buildPrompt(makeInventory())
		expect(prompt).toContain('Use ONLY')
		expect(prompt).not.toContain('MAY include')
	})

	test('description combines with other preferences', () => {
		const prompt = buildPrompt(makeInventory(), {
			description: 'quick pasta',
			mealType: 'dinner',
			quickMeal: true,
		})
		expect(prompt).toContain('Description: quick pasta')
		expect(prompt).toContain('Meal type: dinner')
		expect(prompt).toContain('30 minutes or less')
	})
})

describe('parseRecipeResponse', () => {
	test('parses valid JSON response', () => {
		const result = parseRecipeResponse(JSON.stringify(validResponse))
		expect(result).not.toBeNull()
		expect(result!.title).toBe('Chicken Stir Fry')
		expect(result!.servings).toBe(4)
		expect(result!.ingredients).toHaveLength(3)
		expect(result!.instructions).toHaveLength(4)
	})

	test('handles markdown-wrapped JSON', () => {
		const wrapped = '```json\n' + JSON.stringify(validResponse) + '\n```'
		const result = parseRecipeResponse(wrapped)
		expect(result).not.toBeNull()
		expect(result!.title).toBe('Chicken Stir Fry')
	})

	test('returns null for missing title', () => {
		const noTitle = { ...validResponse, title: '' }
		expect(parseRecipeResponse(JSON.stringify(noTitle))).toBeNull()
	})

	test('returns null for no ingredients', () => {
		const noIngs = { ...validResponse, ingredients: [] }
		expect(parseRecipeResponse(JSON.stringify(noIngs))).toBeNull()
	})

	test('returns null for no instructions', () => {
		const noInsts = { ...validResponse, instructions: [] }
		expect(parseRecipeResponse(JSON.stringify(noInsts))).toBeNull()
	})

	test('returns null for invalid JSON', () => {
		expect(parseRecipeResponse('not json at all')).toBeNull()
	})

	test('returns null for non-object JSON', () => {
		expect(parseRecipeResponse('[1, 2, 3]')).toBeNull()
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
		const result = parseRecipeResponse(JSON.stringify(manyIngs))
		expect(result!.ingredients).toHaveLength(50)
	})

	test('caps instructions at 30', () => {
		const manyInsts = {
			...validResponse,
			instructions: Array.from({ length: 40 }, (_, i) => ({
				content: `Step ${i + 1}`,
			})),
		}
		const result = parseRecipeResponse(JSON.stringify(manyInsts))
		expect(result!.instructions).toHaveLength(30)
	})

	test('defaults servings to 4 when invalid', () => {
		const badServings = { ...validResponse, servings: -1 }
		const result = parseRecipeResponse(JSON.stringify(badServings))
		expect(result!.servings).toBe(4)
	})

	test('handles null prepTime and cookTime', () => {
		const nullTimes = {
			...validResponse,
			prepTime: null,
			cookTime: null,
		}
		const result = parseRecipeResponse(JSON.stringify(nullTimes))
		expect(result!.prepTime).toBeNull()
		expect(result!.cookTime).toBeNull()
	})

	test('handles string instructions', () => {
		const stringInsts = {
			...validResponse,
			instructions: ['Step 1', 'Step 2', 'Step 3'],
		}
		const result = parseRecipeResponse(JSON.stringify(stringInsts))
		expect(result!.instructions).toHaveLength(3)
		expect(result!.instructions[0]!.content).toBe('Step 1')
	})

	test('coerces numeric amounts to strings', () => {
		const numericAmounts = {
			...validResponse,
			ingredients: [
				{ name: 'flour', amount: 2, unit: 'cups', notes: null },
				{ name: 'sugar', amount: 0.5, unit: 'cup', notes: null },
			],
		}
		const result = parseRecipeResponse(JSON.stringify(numericAmounts))
		expect(result!.ingredients[0]!.amount).toBe('2')
		expect(result!.ingredients[1]!.amount).toBe('0.5')
	})

	test('skips ingredients with missing name', () => {
		const badIngs = {
			...validResponse,
			ingredients: [
				{ name: 'valid', amount: '1', unit: 'cup', notes: null },
				{ amount: '2', unit: 'tbsp', notes: null }, // missing name
				{ name: 'also valid', amount: '3', unit: 'oz', notes: null },
			],
		}
		const result = parseRecipeResponse(JSON.stringify(badIngs))
		expect(result!.ingredients).toHaveLength(2)
	})
})

describe('generateRecipeFromInventory', () => {
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

	test('returns error when API key is not set', async () => {
		delete process.env.ANTHROPIC_API_KEY
		const result = await generateRecipeFromInventory(makeInventory())
		expect(result).toEqual({ error: expect.stringContaining('not configured') })
	})

	test('returns error on fetch error', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))

		const result = await generateRecipeFromInventory(makeInventory())
		expect(result).toHaveProperty('error')
	})

	test('returns error on non-OK response', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('', { status: 500 }),
		)

		const result = await generateRecipeFromInventory(makeInventory())
		expect(result).toHaveProperty('error')
	})

	test('returns parsed recipe on successful response', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					content: [{ type: 'text', text: JSON.stringify(validResponse) }],
				}),
				{ status: 200 },
			),
		)

		const result = await generateRecipeFromInventory(makeInventory())
		expect(result).not.toHaveProperty('error')
		expect((result as { title: string }).title).toBe('Chicken Stir Fry')
		expect((result as { ingredients: unknown[] }).ingredients).toHaveLength(3)
	})

	test('returns error when response has no content', async () => {
		process.env.ANTHROPIC_API_KEY = 'test-key'
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ content: [] }), { status: 200 }),
		)

		const result = await generateRecipeFromInventory(makeInventory())
		expect(result).toHaveProperty('error')
	})

	test('description changes system message', async () => {
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

		await generateRecipeFromInventory(makeInventory(), {
			description: 'gyoza dipping sauce',
		})

		const body = JSON.parse(capturedBody!) as { system: string }
		expect(body.system).toContain("following the user's description")
		expect(body.system).toContain('treat it only as a cooking intent')
		expect(body.system).not.toContain('using ONLY')
	})

	test('no description keeps strict system message', async () => {
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

		await generateRecipeFromInventory(makeInventory())

		const body = JSON.parse(capturedBody!) as { system: string }
		expect(body.system).toContain('using ONLY')
		expect(body.system).not.toContain("following the user's description")
	})

	test('passes preferences to prompt', async () => {
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

		await generateRecipeFromInventory(makeInventory(), {
			mealType: 'dinner',
			quickMeal: true,
		})

		const body = JSON.parse(capturedBody!) as {
			messages: Array<{ content: string }>
		}
		const userMessage = body.messages[0]!.content
		expect(userMessage).toContain('Meal type: dinner')
		expect(userMessage).toContain('30 minutes or less')
	})
})
