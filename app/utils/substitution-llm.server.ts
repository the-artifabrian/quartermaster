import { type Substitution } from './ingredient-substitutions.ts'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20251001'
const TIMEOUT_MS = 8_000

/**
 * Call Claude Haiku to get substitution suggestions for an ingredient.
 *
 * Returns null if:
 * - No API key is configured
 * - The API call fails or times out
 * - The response can't be parsed
 *
 * Errors are logged server-side but never surfaced to the user.
 */
export async function getLLMSubstitutions(
	ingredientName: string,
): Promise<Substitution[] | null> {
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
				system: 'You are a practical home cook advisor. Return only valid JSON — no markdown, no explanation.',
				messages: [
					{
						role: 'user',
						content: `What are practical cooking substitutions for "${ingredientName}"?

Return a JSON array of 2-4 substitutions. Each object:
{"replacement": "what to use", "context": "one sentence of practical advice", "ratio": "conversion ratio or null"}

Rules:
- Only realistic, commonly available ingredients
- Include ratio when the swap isn't 1:1
- Keep context to one sentence`,
					},
				],
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})

		if (!response.ok) {
			console.error(
				`Substitution LLM error: ${response.status} ${response.statusText}`,
			)
			return null
		}

		const data = (await response.json()) as {
			content?: Array<{ type: string; text?: string }>
		}

		const text = data.content?.[0]?.text
		if (!text) return null

		return parseSubstitutionResponse(text)
	} catch (error) {
		console.error('Substitution LLM error:', error)
		return null
	}
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
