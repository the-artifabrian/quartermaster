import { z } from 'zod'
import {
	ANTHROPIC_MODELS,
	parseAnthropicJson,
	requestAnthropicJson,
	type AnthropicJsonFailure,
} from './anthropic-json.server.ts'

const TIMEOUT_MS = 10_000
const MAX_TOKENS = 1024

export type EnhanceableFields = {
	description: string | null
	servings: number | null
	prepTime: number | null
	cookTime: number | null
}

export type RecipeInput = {
	title: string
	description: string | null
	servings: number
	prepTime: number | null
	cookTime: number | null
	ingredients: Array<{
		name: string
		amount: string | null
		unit: string | null
	}>
	instructions: Array<{ content: string }>
}

const EnhanceableFieldsSchema: z.ZodType<EnhanceableFields> = z
	.object({
		description: z.unknown().optional(),
		servings: z.unknown().optional(),
		prepTime: z.unknown().optional(),
		cookTime: z.unknown().optional(),
	})
	.transform((fields) => ({
		description:
			typeof fields.description === 'string' && fields.description.trim()
				? fields.description.trim()
				: null,
		servings:
			typeof fields.servings === 'number' &&
			fields.servings > 0 &&
			fields.servings <= 100
				? Math.round(fields.servings)
				: null,
		prepTime:
			typeof fields.prepTime === 'number' && fields.prepTime > 0
				? Math.round(fields.prepTime)
				: null,
		cookTime:
			typeof fields.cookTime === 'number' && fields.cookTime > 0
				? Math.round(fields.cookTime)
				: null,
	}))

/**
 * Call Claude Haiku to suggest metadata improvements for a recipe.
 *
 * Returns the suggestions on success, or `{ error: string }` on failure.
 */
export async function enhanceRecipeMetadata(
	input: RecipeInput,
): Promise<EnhanceableFields | { error: string }> {
	const result = await requestAnthropicJson({
		feature: 'recipe-enhance',
		model: ANTHROPIC_MODELS.fast,
		maxTokens: MAX_TOKENS,
		timeoutMs: TIMEOUT_MS,
		system:
			'You are a practical home cook. Analyze the recipe and suggest metadata. Return only valid JSON — no markdown, no explanation.',
		prompt: buildEnhancePrompt(input),
		schema: EnhanceableFieldsSchema,
	})

	return result.ok ? result.data : { error: enhanceError(result.failure) }
}

function enhanceError(failure: AnthropicJsonFailure): string {
	switch (failure.kind) {
		case 'configuration':
			return 'AI features are not configured. Contact support.'
		case 'rate-limit':
			return 'Recipe enhance hit a rate limit. Please wait a moment and try again.'
		case 'timeout':
			return 'Recipe enhance timed out. Please try again.'
		case 'empty-response':
			return 'Recipe enhance returned an empty response. Please try again.'
		case 'parse':
		case 'schema':
			return 'Recipe enhance returned an unexpected response. Please try again.'
		case 'provider':
			return 'Recipe enhance failed — the AI service returned an error. Please try again later.'
	}
}

export function buildEnhancePrompt(input: RecipeInput): string {
	const ingredientLines = input.ingredients
		.map((i) => [i.amount, i.unit, i.name].filter(Boolean).join(' '))
		.join('\n')

	const instructionText = input.instructions
		.map((i, idx) => `${idx + 1}. ${i.content}`)
		.join('\n')

	return `Analyze this recipe and suggest metadata improvements.

Title: ${input.title}
Current description: ${input.description || 'None'}
Current servings: ${input.servings}
Current prep time: ${input.prepTime ? `${input.prepTime} minutes` : 'None'}
Current cook time: ${input.cookTime ? `${input.cookTime} minutes` : 'None'}

Ingredients:
${ingredientLines}

Instructions:
${instructionText}

Return a single JSON object with this exact structure:
{
  "description": "Brief appetizing description (1-2 sentences) or null if current is good",
  "servings": 4,
  "prepTime": 15,
  "cookTime": 30
}

Rules:
- description: Suggest a short, appetizing description (1-2 sentences). Return null if the current description is already good.
- servings: Estimate a reasonable serving count based on ingredient quantities. Return null if uncertain.
- prepTime and cookTime: Estimate in minutes based on the instructions. Return null if unknown.
- Do NOT downgrade existing good values — if a field already has a reasonable value, return that same value or null
- Return null for any field you cannot reasonably estimate`
}

/**
 * Parse and validate the LLM response.
 * Extracts JSON from the response text, validates structure.
 */
export function parseEnhanceResponse(text: string): EnhanceableFields | null {
	const result = parseAnthropicJson(text, EnhanceableFieldsSchema)
	return result.ok ? result.data : null
}
