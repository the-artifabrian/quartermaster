import { z } from 'zod'
import {
	ANTHROPIC_MODELS,
	isAnthropicConfigured,
	parseAnthropicJson,
	requestAnthropicJson,
	type AnthropicJsonFailure,
} from './anthropic-json.server.ts'

const TIMEOUT_TEXT_MS = 15_000
const TIMEOUT_IMAGE_MS = 30_000
const MAX_TOKENS = 4096
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
		isHeading: boolean
	}>
	instructions: Array<{ content: string }>
}

const ExtractedIngredientSchema = z
	.object({
		name: z.string(),
		amount: z.unknown().optional(),
		unit: z.unknown().optional(),
		notes: z.unknown().optional(),
		isHeading: z.unknown().optional(),
	})
	.transform((ingredient) => {
		const isHeading = ingredient.isHeading === true
		return {
			name: ingredient.name.trim().slice(0, MAX_INGREDIENT_NAME_LENGTH),
			amount: isHeading
				? null
				: typeof ingredient.amount === 'string'
					? ingredient.amount.trim().slice(0, MAX_INGREDIENT_AMOUNT_LENGTH) ||
						null
					: typeof ingredient.amount === 'number'
						? String(ingredient.amount)
						: null,
			unit: isHeading
				? null
				: typeof ingredient.unit === 'string'
					? ingredient.unit.trim().slice(0, MAX_INGREDIENT_UNIT_LENGTH) || null
					: null,
			notes: isHeading
				? null
				: typeof ingredient.notes === 'string'
					? ingredient.notes.trim().slice(0, MAX_INGREDIENT_NOTES_LENGTH) ||
						null
					: null,
			isHeading,
		}
	})

const ExtractedInstructionSchema = z
	.union([
		z.string(),
		z.object({ content: z.string() }).transform(({ content }) => content),
	])
	.transform((content) => content.trim().slice(0, MAX_INSTRUCTION_LENGTH))
	.refine(Boolean)
	.transform((content) => ({ content }))

const ExtractedRecipeSchema: z.ZodType<ExtractedRecipeFromLLM> = z
	.object({
		title: z.string().trim().min(1),
		description: z.unknown().optional(),
		servings: z.unknown().optional(),
		prepTime: z.unknown().optional(),
		cookTime: z.unknown().optional(),
		ingredients: z.array(z.unknown()),
		instructions: z.array(z.unknown()),
	})
	.transform((recipe) => ({
		title: recipe.title.slice(0, MAX_TITLE_LENGTH),
		description:
			typeof recipe.description === 'string'
				? recipe.description.trim().slice(0, MAX_DESCRIPTION_LENGTH) || null
				: null,
		servings:
			typeof recipe.servings === 'number' && recipe.servings > 0
				? Math.min(recipe.servings, 100)
				: 4,
		prepTime:
			typeof recipe.prepTime === 'number' && recipe.prepTime >= 0
				? recipe.prepTime
				: null,
		cookTime:
			typeof recipe.cookTime === 'number' && recipe.cookTime >= 0
				? recipe.cookTime
				: null,
		ingredients: recipe.ingredients
			.slice(0, MAX_INGREDIENTS)
			.flatMap((ingredient) => {
				const parsed = ExtractedIngredientSchema.safeParse(ingredient)
				return parsed.success ? [parsed.data] : []
			}),
		instructions: recipe.instructions
			.slice(0, MAX_INSTRUCTIONS)
			.flatMap((instruction) => {
				const parsed = ExtractedInstructionSchema.safeParse(instruction)
				return parsed.success ? [parsed.data] : []
			}),
	}))
	.refine(
		(recipe) =>
			recipe.ingredients.some((ingredient) => !ingredient.isHeading) &&
			recipe.instructions.length > 0,
	)

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
- When ingredients are grouped into sub-sections (e.g., "For the Sauce", "Dry Batter", "Pie Dough", "Streusel Topping"), emit a heading row for each section immediately before the ingredients in that section. A heading row has isHeading: true, name set to the section title (cleaned up — drop a leading "For the" / "For "), and amount/unit/notes set to null. Regular ingredients have isHeading: false. List every ingredient from every sub-section individually; do NOT merge or sum quantities of the same ingredient across different sub-sections — they are used separately. Do NOT put the section name into the notes field — use a heading row instead
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
    {"name": "Sauce", "amount": null, "unit": null, "notes": null, "isHeading": true},
    {"name": "soy sauce", "amount": "2", "unit": "tbsp", "notes": null, "isHeading": false},
    {"name": "garlic", "amount": "3", "unit": null, "notes": "cloves, minced", "isHeading": false},
    {"name": "Stir Fry", "amount": null, "unit": null, "notes": null, "isHeading": true},
    {"name": "chicken breast", "amount": "2", "unit": null, "notes": "diced", "isHeading": false},
    {"name": "flour", "amount": "1", "unit": "cup", "notes": null, "isHeading": false}
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
	const result = parseAnthropicJson(text, ExtractedRecipeSchema)
	return result.ok ? result.data : null
}

/**
 * Extract a recipe from informal/unstructured text using Claude Haiku.
 */
export async function extractRecipeFromText(
	rawText: string,
): Promise<ExtractedRecipeFromLLM | { error: string }> {
	const result = await requestAnthropicJson({
		feature: 'recipe-extract-text',
		model: ANTHROPIC_MODELS.fast,
		maxTokens: MAX_TOKENS,
		timeoutMs: TIMEOUT_TEXT_MS,
		system: SYSTEM_PROMPT,
		prompt: buildExtractPrompt('text', rawText),
		schema: ExtractedRecipeSchema,
	})

	return result.ok
		? result.data
		: { error: extractionError(result.failure, 'text') }
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
	if (!isAnthropicConfigured()) {
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

	const imageBlocks = preparedImages.map((image) => ({
		type: 'image' as const,
		source: {
			type: 'base64' as const,
			media_type: image.media_type,
			data: image.data,
		},
	}))

	const result = await requestAnthropicJson({
		feature: 'recipe-extract-image',
		model: ANTHROPIC_MODELS.vision,
		maxTokens: MAX_TOKENS,
		timeoutMs: TIMEOUT_IMAGE_MS,
		system: SYSTEM_PROMPT,
		prompt: [
			...imageBlocks,
			{ type: 'text', text: buildExtractPrompt('image') },
		],
		schema: ExtractedRecipeSchema,
	})

	return result.ok
		? result.data
		: { error: extractionError(result.failure, 'image') }
}

function extractionError(
	failure: AnthropicJsonFailure,
	mode: 'text' | 'image',
): string {
	switch (failure.kind) {
		case 'configuration':
			return 'AI features are not configured. Contact support.'
		case 'rate-limit':
			return 'Recipe extraction hit a rate limit. Please wait a moment and try again.'
		case 'timeout':
			return 'Recipe extraction timed out. Please try again.'
		case 'empty-response':
			return 'Recipe extraction returned an empty response. Please try again.'
		case 'parse':
		case 'schema':
			return mode === 'text'
				? "Couldn't find a recipe in the provided text. Try including ingredients and instructions."
				: "Couldn't find a recipe in the provided image(s). Make sure the image contains recipe text or ingredients."
		case 'provider':
			return 'Recipe extraction failed — the AI service returned an error. Please try again later.'
	}
}
