import { type Substitution } from './ingredient-substitutions.ts'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20251001'
const TIMEOUT_MS = 8_000

export type RecipeContext = {
	title: string
	ingredients: string[]
}

/**
 * Call Claude Haiku to get substitution suggestions for an ingredient.
 *
 * When recipeContext is provided, the prompt includes the recipe title and
 * full ingredient list so the model can give contextually appropriate
 * suggestions (e.g. won't suggest broth as a water substitute in a cake).
 *
 * Returns `{ substitutions }` on success (possibly empty),
 * or `{ error }` when the API call fails.
 * Returns `null` only when no API key is configured.
 */
export async function getLLMSubstitutions(
	ingredientName: string,
	recipeContext?: RecipeContext,
): Promise<{ substitutions: Substitution[] } | { error: string } | null> {
	const apiKey = process.env.ANTHROPIC_API_KEY
	if (!apiKey) return null

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
				max_tokens: 512,
				system:
					'You are a practical home cook advisor. Return only valid JSON — no markdown, no explanation.',
				messages: [
					{
						role: 'user',
						content: buildPrompt(ingredientName, recipeContext),
					},
				],
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})

		if (!response.ok) {
			console.error(
				`Substitution LLM error: ${response.status} ${response.statusText}`,
			)
			if (response.status === 429) {
				return { error: 'Too many requests. Please wait a moment and try again.' }
			}
			return { error: 'AI substitution lookup failed. Please try again later.' }
		}

		const data = (await response.json()) as {
			content?: Array<{ type: string; text?: string }>
		}

		const text = data.content?.[0]?.text
		if (!text) return { error: 'AI substitution lookup returned an empty response.' }

		const parsed = parseSubstitutionResponse(text)
		return { substitutions: parsed ?? [] }
	} catch (error) {
		console.error('Substitution LLM error:', error)
		if (error instanceof DOMException && error.name === 'TimeoutError') {
			return { error: 'AI substitution lookup timed out. Please try again.' }
		}
		return { error: 'AI substitution lookup failed. Please try again later.' }
	}
}

function buildPrompt(
	ingredientName: string,
	recipeContext?: RecipeContext,
): string {
	const recipeClause = recipeContext
		? `\nThis ingredient is used in "${recipeContext.title}" which contains: ${recipeContext.ingredients.slice(0, 30).join(', ')}.\nSuggestions must make sense for this specific recipe.\n`
		: ''

	return `What are practical cooking substitutions for "${ingredientName}"?${recipeClause}
Return a JSON array of 2-4 substitutions. Each object:
{"replacement": "what to use", "context": "one sentence of practical advice", "ratio": "conversion ratio or null"}

Rules:
- Only realistic, commonly available ingredients
- Each substitution must serve the same culinary function as the original (a liquid must be replaced by a liquid, a fat by a fat, a spice by a spice, etc.) — do NOT suggest unrelated ingredients that happen to go well in the dish
- Include ratio when the swap isn't 1:1
- Keep context to one sentence
- If a substitution contains a common allergen (nuts, dairy, gluten, soy, eggs, shellfish, sesame), note it in context (e.g. "Contains tree nuts" or "Contains dairy")
- NEVER suggest non-food items or anything unsafe to eat`
}

/**
 * Parse and validate the LLM response.
 * Extracts JSON from the response text, validates structure, caps at 4 results.
 */
function parseSubstitutionResponse(text: string): Substitution[] | null {
	try {
		// Extract JSON array — handle markdown code blocks just in case
		const jsonMatch = text.match(/\[[\s\S]*\]/)
		if (!jsonMatch) return null

		const parsed = JSON.parse(jsonMatch[0]) as unknown[]
		if (!Array.isArray(parsed)) return null

		const substitutions: Substitution[] = []
		for (const item of parsed.slice(0, 4)) {
			if (
				typeof item !== 'object' ||
				item === null ||
				!('replacement' in item) ||
				typeof (item as { replacement: unknown }).replacement !== 'string'
			) {
				continue
			}

			const sub: Substitution = {
				replacement: (item as { replacement: string }).replacement,
			}

			if (
				'context' in item &&
				typeof (item as { context: unknown }).context === 'string'
			) {
				sub.context = (item as { context: string }).context
			}

			if (
				'ratio' in item &&
				typeof (item as { ratio: unknown }).ratio === 'string'
			) {
				sub.ratio = (item as { ratio: string }).ratio
			}

			substitutions.push(sub)
		}

		return substitutions.length > 0 ? substitutions : null
	} catch {
		return null
	}
}
