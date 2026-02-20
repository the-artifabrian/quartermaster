const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20251001'
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

/**
 * Call Claude Haiku to suggest metadata improvements for a recipe.
 *
 * Returns the suggestions on success, or `{ error: string }` on failure.
 */
export async function enhanceRecipeMetadata(
	input: RecipeInput,
): Promise<EnhanceableFields | { error: string }> {
	const apiKey = process.env.ANTHROPIC_API_KEY
	if (!apiKey) {
		return { error: 'AI features are not configured. Contact support.' }
	}

	try {
		const response = await fetch(ANTHROPIC_API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
			},
			body: JSON.stringify({
				model: MODEL,
				max_tokens: MAX_TOKENS,
				system:
					'You are a practical home cook. Analyze the recipe and suggest metadata. Return only valid JSON — no markdown, no explanation.',
				messages: [
					{
						role: 'user',
						content: buildEnhancePrompt(input),
					},
				],
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})

		if (!response.ok) {
			console.error(
				`Recipe enhance LLM error: ${response.status} ${response.statusText}`,
			)
			if (response.status === 429) {
				return {
					error: 'Too many requests. Please wait a moment and try again.',
				}
			}
			return {
				error: 'The AI service returned an error. Please try again later.',
			}
		}

		const data = (await response.json()) as {
			content?: Array<{ type: string; text?: string }>
		}

		const text = data.content?.[0]?.text
		if (!text) {
			return {
				error: 'Received an unexpected response. Please try again.',
			}
		}

		const result = parseEnhanceResponse(text)
		if (!result) {
			return {
				error: 'Received an unexpected response. Please try again.',
			}
		}

		return result
	} catch (error) {
		console.error('Recipe enhance LLM error:', error)
		if (error instanceof DOMException && error.name === 'TimeoutError') {
			return {
				error: 'The AI service took too long. Please try again.',
			}
		}
		return {
			error: 'The AI service returned an error. Please try again later.',
		}
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
	try {
		const jsonMatch = text.match(/\{[\s\S]*\}/)
		if (!jsonMatch) return null

		const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
		if (typeof parsed !== 'object' || parsed === null) return null

		return {
			description:
				typeof parsed.description === 'string' &&
				parsed.description.trim().length > 0
					? parsed.description.trim()
					: null,
			servings:
				typeof parsed.servings === 'number' &&
				parsed.servings > 0 &&
				parsed.servings <= 100
					? Math.round(parsed.servings)
					: null,
			prepTime:
				typeof parsed.prepTime === 'number' && parsed.prepTime > 0
					? Math.round(parsed.prepTime)
					: null,
			cookTime:
				typeof parsed.cookTime === 'number' && parsed.cookTime > 0
					? Math.round(parsed.cookTime)
					: null,
		}
	} catch {
		return null
	}
}
