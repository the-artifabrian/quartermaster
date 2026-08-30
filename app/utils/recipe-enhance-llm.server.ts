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
}

export type RecipeInput = {
	title: string
	description: string | null
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
	})
	.transform((fields) => ({
		description:
			typeof fields.description === 'string' && fields.description.trim()
				? fields.description.trim()
				: null,
	}))

/**
 * Call Claude Haiku to suggest a reviewed description improvement.
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
			'You are a practical home cook. Analyze the recipe and suggest a concise description. Return only valid JSON — no markdown, no explanation.',
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

Ingredients:
${ingredientLines}

Instructions:
${instructionText}

Return a single JSON object with this exact structure:
{
  "description": "Brief appetizing description (1-2 sentences) or null if current is good"
}

Rules:
- description: Suggest a short, appetizing description (1-2 sentences). Return null if the current description is already good.
- Do not suggest or infer time, yield, or other Recipe metadata`
}

/**
 * Parse and validate the LLM response.
 * Extracts JSON from the response text, validates structure.
 */
export function parseEnhanceResponse(text: string): EnhanceableFields | null {
	const result = parseAnthropicJson(text, EnhanceableFieldsSchema)
	return result.ok ? result.data : null
}
