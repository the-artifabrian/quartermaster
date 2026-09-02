import { z } from 'zod'
import {
	ANTHROPIC_MODELS,
	parseAnthropicJson,
	requestAnthropicJson,
	type AnthropicJsonFailure,
} from './anthropic-json.server.ts'
import { MAX_RECIPE_DESCRIPTION_LENGTH } from './recipe-validation.ts'

const TIMEOUT_MS = 10_000
const MAX_TOKENS = 1024

export type EnhanceableFields = {
	description: string | null
	activeTime: number | null
	totalTime: number | null
}

export type RecipeInput = {
	title: string
	description: string | null
	activeTime: number | null
	totalTime: number | null
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
		activeTime: z.unknown().optional(),
		totalTime: z.unknown().optional(),
	})
	.transform((fields) => {
		const activeTime = positiveMinutes(fields.activeTime)
		const totalTime = positiveMinutes(fields.totalTime)
		return {
			description:
				typeof fields.description === 'string' && fields.description.trim()
					? fields.description
							.trim()
							.slice(0, MAX_RECIPE_DESCRIPTION_LENGTH)
					: null,
			activeTime,
			totalTime:
				activeTime != null && totalTime != null && totalTime < activeTime
					? null
					: totalTime,
		}
	})

function positiveMinutes(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null
	const minutes = Math.round(value)
	return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null
}

type RecipeTimes = Pick<RecipeInput, 'activeTime' | 'totalTime'>

const noCurrentTimes: RecipeTimes = { activeTime: null, totalTime: null }

function reconcileTimeSuggestions(
	fields: EnhanceableFields,
	current: RecipeTimes,
): EnhanceableFields {
	let { activeTime, totalTime } = fields

	const resultingActiveTime = activeTime ?? current.activeTime
	if (
		totalTime != null &&
		resultingActiveTime != null &&
		totalTime < resultingActiveTime
	) {
		totalTime = null
	}

	const resultingTotalTime = totalTime ?? current.totalTime
	if (
		activeTime != null &&
		resultingTotalTime != null &&
		activeTime > resultingTotalTime
	) {
		activeTime = null
	}

	return { ...fields, activeTime, totalTime }
}

/**
 * Call Claude Haiku to suggest reviewed description and time improvements.
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
			'You are a practical home cook. Analyze the recipe and suggest a concise description and realistic time estimates. Return only valid JSON — no markdown, no explanation.',
		prompt: buildEnhancePrompt(input),
		schema: EnhanceableFieldsSchema,
	})

	return result.ok
		? reconcileTimeSuggestions(result.data, input)
		: { error: enhanceError(result.failure) }
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
Current active time: ${input.activeTime ? `${input.activeTime} minutes` : 'None'}
Current total time: ${input.totalTime ? `${input.totalTime} minutes` : 'None'}

Ingredients:
${ingredientLines}

Instructions:
${instructionText}

Return a single JSON object with this exact structure:
{
  "description": "Brief appetizing description (1-2 sentences) or null if current is good",
  "activeTime": 15,
  "totalTime": 45
}

Rules:
- description: Suggest a short, appetizing description (1-2 sentences). Return null if the current description is already good.
- activeTime: Estimate hands-on time in minutes, including preparation and cooking that needs the cook's attention. Return null only if it cannot be estimated.
- totalTime: Estimate total elapsed time in minutes, including unattended cooking, resting, chilling, and rising. It must not be shorter than activeTime. Return null only if it cannot be estimated.
- Do NOT downgrade existing good values — if a field already has a reasonable value, return that same value or null.
- Return null for any field you cannot reasonably estimate. Do not suggest yield or other Recipe metadata.`
}

/**
 * Parse and validate the LLM response.
 * Extracts JSON from the response text, validates structure.
 */
export function parseEnhanceResponse(
	text: string,
	current: RecipeTimes = noCurrentTimes,
): EnhanceableFields | null {
	const result = parseAnthropicJson(text, EnhanceableFieldsSchema)
	return result.ok ? reconcileTimeSuggestions(result.data, current) : null
}
