const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL_FAST = 'claude-haiku-4-5-20251001'
const MODEL_VISION = 'claude-sonnet-4-6'
const TIMEOUT_TEXT_MS = 15_000
const TIMEOUT_IMAGE_MS = 30_000
const MAX_TOKENS = 2048
const MAX_TEXT_LENGTH = 16_000
const MAX_INGREDIENTS = 50
const MAX_INSTRUCTIONS = 30

// Field length caps — prevent absurd LLM output from reaching DB/UI
const MAX_TITLE_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 2000
const MAX_INGREDIENT_NAME_LENGTH = 200
const MAX_INGREDIENT_AMOUNT_LENGTH = 20
const MAX_INGREDIENT_UNIT_LENGTH = 30
const MAX_INGREDIENT_NOTES_LENGTH = 500
const MAX_INSTRUCTION_LENGTH = 5000

export const ALLOWED_IMAGE_MEDIA_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
] as const

export type ExtractedRecipeFromLLM = {
	title: string
	description: string | null
	servings: number
	prepTime: number | null
	cookTime: number | null
	ingredients: Array<{
		name: string
		amount: string | null
		unit: string | null
		notes: string | null
	}>
	instructions: Array<{ content: string }>
}

const SYSTEM_PROMPT =
	'You are a recipe extraction assistant. Extract a structured recipe from informal text or images such as social media captions, screenshots, blog posts, or YouTube descriptions. The content may contain emojis, abbreviations, hashtags, casual language, non-English text, or missing structure. Do your best to identify the recipe. Return only valid JSON — no markdown, no explanation.'

export function buildExtractPrompt(
	mode: 'text' | 'image',
	rawText?: string,
): string {
	const intro =
		mode === 'text'
			? 'Extract a structured recipe from the following text:'
			: 'Extract a structured recipe from the provided image(s). If the recipe spans multiple images, combine the information from all images into a single complete recipe.'

	const textBlock =
		mode === 'text' && rawText
			? `\n---\n${rawText.slice(0, MAX_TEXT_LENGTH)}\n---\n`
			: ''

	return `${intro}${textBlock}

Rules:
- Infer the recipe title if not explicitly stated
- Translate non-English ingredients to English (keep original text in notes). Be precise with food terminology — e.g. Romanian "roșie" = tomato (not rosemary), "căței de usturoi" = garlic cloves (not sausage), "smântână" = sour cream. If unsure of a translation, keep the original name and note it
- Keep the original units from the source text. Do not convert between metric and imperial
- Use null for unit when the quantity is a count (e.g., "2 lemons" → amount: "2", unit: null, name: "lemons"). Never use "unit" as a unit value
- Convert informal measurements to concrete quantities ("a handful" → "1/2 cup", "a pinch" → "1/4 tsp", "a couple twists" → "1/4 tsp")
- Strip emojis, hashtags, and non-recipe content from output
- Convert conversational instructions to imperative form
- Separate combined ingredients ("salt and pepper" → two items)
- When ingredients are grouped into sub-sections (e.g., "For the Sauce", "Dry Batter", "Wet Batter"), list every ingredient from every sub-section individually. Do NOT merge or sum quantities of the same ingredient across different sub-sections — they are used separately. Include the sub-section name in the notes field (e.g., notes: "for dry batter")
- If multiple recipes are present, extract only the main or primary recipe
- If only a total time is given (no prep/cook split), use it as cookTime
- If no recognizable recipe is found, return {"error": "no_recipe_found"}

Return a single JSON object with this exact structure:
{
  "title": "Recipe Name",
  "description": "Brief description (1-2 sentences)",
  "servings": 4,
  "prepTime": 15,
  "cookTime": 30,
  "ingredients": [
    {"name": "chicken breast", "amount": "2", "unit": null, "notes": "diced"},
    {"name": "soy sauce", "amount": "2", "unit": "tbsp", "notes": null},
    {"name": "flour", "amount": "1", "unit": "cup", "notes": "for dry batter"}
  ],
  "instructions": [
    {"content": "Step description in imperative form"}
  ]
}`
}

/**
 * Parse and validate the LLM extraction response.
 * Returns null on failure or if no recipe was found.
 */
export function parseExtractResponse(
	text: string,
): ExtractedRecipeFromLLM | null {
	try {
		const jsonMatch = text.match(/\{[\s\S]*\}/)
		if (!jsonMatch) return null

		const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
		if (typeof parsed !== 'object' || parsed === null) return null

		// Check for explicit "no recipe" response
		if (parsed.error === 'no_recipe_found') return null

		// Validate required fields
		if (typeof parsed.title !== 'string' || !parsed.title.trim()) return null

		const recipe: ExtractedRecipeFromLLM = {
			title: parsed.title.trim().slice(0, MAX_TITLE_LENGTH),
			description:
				typeof parsed.description === 'string'
					? parsed.description.trim().slice(0, MAX_DESCRIPTION_LENGTH) || null
					: null,
			servings:
				typeof parsed.servings === 'number' && parsed.servings > 0
					? Math.min(parsed.servings, 100)
					: 4,
			prepTime:
				typeof parsed.prepTime === 'number' && parsed.prepTime >= 0
					? parsed.prepTime
					: null,
			cookTime:
				typeof parsed.cookTime === 'number' && parsed.cookTime >= 0
					? parsed.cookTime
					: null,
			ingredients: [],
			instructions: [],
		}

		// Parse ingredients
		if (Array.isArray(parsed.ingredients)) {
			for (const item of parsed.ingredients.slice(0, MAX_INGREDIENTS)) {
				if (
					typeof item !== 'object' ||
					item === null ||
					typeof (item as { name?: unknown }).name !== 'string'
				) {
					continue
				}
				const ing = item as Record<string, unknown>
				recipe.ingredients.push({
					name: (ing.name as string)
						.trim()
						.slice(0, MAX_INGREDIENT_NAME_LENGTH),
					amount:
						typeof ing.amount === 'string'
							? ing.amount.trim().slice(0, MAX_INGREDIENT_AMOUNT_LENGTH) ||
								null
							: typeof ing.amount === 'number'
								? String(ing.amount)
								: null,
					unit:
						typeof ing.unit === 'string'
							? ing.unit.trim().slice(0, MAX_INGREDIENT_UNIT_LENGTH) || null
							: null,
					notes:
						typeof ing.notes === 'string'
							? ing.notes.trim().slice(0, MAX_INGREDIENT_NOTES_LENGTH) || null
							: null,
				})
			}
		}

		// Parse instructions
		if (Array.isArray(parsed.instructions)) {
			for (const item of parsed.instructions.slice(0, MAX_INSTRUCTIONS)) {
				if (typeof item === 'string') {
					const trimmed = item.trim().slice(0, MAX_INSTRUCTION_LENGTH)
					if (trimmed) recipe.instructions.push({ content: trimmed })
				} else if (
					typeof item === 'object' &&
					item !== null &&
					typeof (item as { content?: unknown }).content === 'string'
				) {
					const content = ((item as { content: string }).content || '')
						.trim()
						.slice(0, MAX_INSTRUCTION_LENGTH)
					if (content) recipe.instructions.push({ content })
				}
			}
		}

		// Must have at least one ingredient and one instruction
		if (recipe.ingredients.length === 0 || recipe.instructions.length === 0) {
			return null
		}

		return recipe
	} catch {
		return null
	}
}

/**
 * Extract a recipe from informal/unstructured text using Claude Haiku.
 */
export async function extractRecipeFromText(
	rawText: string,
): Promise<ExtractedRecipeFromLLM | { error: string }> {
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
				model: MODEL_FAST,
				max_tokens: MAX_TOKENS,
				system: SYSTEM_PROMPT,
				messages: [
					{
						role: 'user',
						content: buildExtractPrompt('text', rawText),
					},
				],
			}),
			signal: AbortSignal.timeout(TIMEOUT_TEXT_MS),
		})

		if (!response.ok) {
			console.error(
				`Recipe extraction LLM error: ${response.status} ${response.statusText}`,
			)
			if (response.status === 429) {
				return {
					error:
						'Recipe extraction hit a rate limit. Please wait a moment and try again.',
				}
			}
			return {
				error:
					'Recipe extraction failed — the AI service returned an error. Please try again later.',
			}
		}

		const data = (await response.json()) as {
			content?: Array<{ type: string; text?: string }>
		}

		const text = data.content?.[0]?.text
		if (!text) {
			return {
				error:
					'Recipe extraction returned an empty response. Please try again.',
			}
		}

		const result = parseExtractResponse(text)
		if (!result) {
			return {
				error:
					"Couldn't find a recipe in the provided text. Try including ingredients and instructions.",
			}
		}

		return result
	} catch (error) {
		console.error('Recipe extraction LLM error:', error)
		if (error instanceof DOMException && error.name === 'TimeoutError') {
			return { error: 'Recipe extraction timed out. Please try again.' }
		}
		return {
			error:
				'Recipe extraction failed — the AI service returned an error. Please try again later.',
		}
	}
}

const IMAGE_MAX_DIMENSION = 1024

async function prepareImage(
	imageBase64: string,
): Promise<{ data: string; media_type: string }> {
	const { default: sharp } = await import('sharp')
	const buf = Buffer.from(imageBase64, 'base64')
	const optimized = await sharp(buf)
		.resize(IMAGE_MAX_DIMENSION, IMAGE_MAX_DIMENSION, {
			fit: 'inside',
			withoutEnlargement: true,
		})
		.jpeg({ quality: 80 })
		.toBuffer()
	return { data: optimized.toString('base64'), media_type: 'image/jpeg' }
}

/**
 * Extract a recipe from one or more images (screenshots, photos) using Claude Sonnet vision.
 */
export async function extractRecipeFromImages(
	images: Array<{ base64: string; mediaType: string }>,
): Promise<ExtractedRecipeFromLLM | { error: string }> {
	if (images.length === 0) {
		return { error: 'No images provided.' }
	}

	for (const img of images) {
		if (
			!ALLOWED_IMAGE_MEDIA_TYPES.includes(
				img.mediaType as (typeof ALLOWED_IMAGE_MEDIA_TYPES)[number],
			)
		) {
			return {
				error: 'Unsupported image format. Please use JPEG, PNG, or WebP.',
			}
		}
	}

	const apiKey = process.env.ANTHROPIC_API_KEY
	if (!apiKey) {
		return { error: 'AI features are not configured. Contact support.' }
	}

	const preparedImages: Array<{ data: string; media_type: string }> = []
	try {
		for (const img of images) {
			preparedImages.push(await prepareImage(img.base64))
		}
	} catch (error) {
		console.error('Image preparation error:', error)
		return {
			error:
				'Could not process the image(s). Please try different images or formats.',
		}
	}

	try {
		const imageBlocks = preparedImages.map((img) => ({
			type: 'image' as const,
			source: {
				type: 'base64' as const,
				media_type: img.media_type,
				data: img.data,
			},
		}))

		const response = await fetch(ANTHROPIC_API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
			},
			body: JSON.stringify({
				model: MODEL_VISION,
				max_tokens: MAX_TOKENS,
				system: SYSTEM_PROMPT,
				messages: [
					{
						role: 'user',
						content: [
							...imageBlocks,
							{
								type: 'text',
								text: buildExtractPrompt('image'),
							},
						],
					},
				],
			}),
			signal: AbortSignal.timeout(TIMEOUT_IMAGE_MS),
		})

		if (!response.ok) {
			console.error(
				`Recipe extraction LLM error: ${response.status} ${response.statusText}`,
			)
			if (response.status === 429) {
				return {
					error:
						'Recipe extraction hit a rate limit. Please wait a moment and try again.',
				}
			}
			return {
				error:
					'Recipe extraction failed — the AI service returned an error. Please try again later.',
			}
		}

		const data = (await response.json()) as {
			content?: Array<{ type: string; text?: string }>
		}

		const text = data.content?.[0]?.text
		if (!text) {
			return {
				error:
					'Recipe extraction returned an empty response. Please try again.',
			}
		}

		const result = parseExtractResponse(text)
		if (!result) {
			return {
				error:
					"Couldn't find a recipe in the provided image(s). Make sure the image contains recipe text or ingredients.",
			}
		}

		return result
	} catch (error) {
		console.error('Recipe extraction LLM error:', error)
		if (error instanceof DOMException && error.name === 'TimeoutError') {
			return { error: 'Recipe extraction timed out. Please try again.' }
		}
		return {
			error:
				'Recipe extraction failed — the AI service returned an error. Please try again later.',
		}
	}
}
