const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20251001'
const TIMEOUT_MS = 10_000
const MAX_TOKENS = 1024

const VALID_TAG_NAMES = [
	'Italian',
	'Mexican',
	'Asian',
	'American',
	'Mediterranean',
	'Indian',
	'Breakfast',
	'Lunch',
	'Dinner',
	'Snack',
	'Dessert',
	'Vegetarian',
	'Vegan',
	'Gluten-Free',
	'Dairy-Free',
	'Keto',
]

export type EnhanceableFields = {
	description: string | null
	servings: number | null
	prepTime: number | null
	cookTime: number | null
	suggestedTags: string[]
}

export type RecipeInput = {
	title: string
	description: string | null
	servings: number
	prepTime: number | null
	cookTime: number | null
	currentTags: string[]
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
 * Returns null if:
 * - No API key is configured
 * - The API call fails or times out
 * - The response can't be parsed
 */
export async function enhanceRecipeMetadata(
	input: RecipeInput,
): Promise<EnhanceableFields | null> {
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
			return null
		}

		const data = (await response.json()) as {
			content?: Array<{ type: string; text?: string }>
		}

		const text = data.content?.[0]?.text
		if (!text) return null

		return parseEnhanceResponse(text, input.currentTags)
	} catch (error) {
		console.error('Recipe enhance LLM error:', error)
		return null
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
Current tags: ${input.currentTags.length > 0 ? input.currentTags.join(', ') : 'None'}

Ingredients:
${ingredientLines}

Instructions:
${instructionText}

Return a single JSON object with this exact structure:
{
  "description": "Brief appetizing description (1-2 sentences) or null if current is good",
  "servings": 4,
  "prepTime": 15,
  "cookTime": 30,
  "suggestedTags": ["Italian", "Dinner"]
}

Rules:
- description: Suggest a short, appetizing description (1-2 sentences). Return null if the current description is already good.
- servings: Estimate a reasonable serving count based on ingredient quantities. Return null if uncertain.
- prepTime and cookTime: Estimate in minutes based on the instructions. Return null if unknown.
- suggestedTags: Only suggest tags from this list: ${VALID_TAG_NAMES.join(', ')}
- Only suggest tags NOT already assigned (current tags: ${input.currentTags.join(', ') || 'none'})
- Be conservative — only suggest tags that clearly apply
- Do NOT downgrade existing good values — if a field already has a reasonable value, return that same value or null
- Return null for any field you cannot reasonably estimate`
}

/**
 * Parse and validate the LLM response.
 * Extracts JSON from the response text, validates structure.
 */
export function parseEnhanceResponse(
	text: string,
	currentTags: string[],
): EnhanceableFields | null {
	try {
		const jsonMatch = text.match(/\{[\s\S]*\}/)
		if (!jsonMatch) return null

		const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
		if (typeof parsed !== 'object' || parsed === null) return null

		const currentTagsLower = new Set(
			currentTags.map((t) => t.toLowerCase()),
		)
		const validTagsLower = new Map(
			VALID_TAG_NAMES.map((t) => [t.toLowerCase(), t]),
		)

		const suggestedTags: string[] = []
		if (Array.isArray(parsed.suggestedTags)) {
			for (const tag of parsed.suggestedTags.slice(0, 10)) {
				if (typeof tag !== 'string') continue
				const canonical = validTagsLower.get(tag.trim().toLowerCase())
				if (canonical && !currentTagsLower.has(tag.trim().toLowerCase())) {
					suggestedTags.push(canonical)
				}
			}
		}

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
			suggestedTags,
		}
	} catch {
		return null
	}
}
