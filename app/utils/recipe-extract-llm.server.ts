import { z } from 'zod'
import {
	ANTHROPIC_MODELS,
	isAnthropicConfigured,
	nullable,
	parseAnthropicJson,
	requestAnthropicJson,
	type AnthropicJsonFailure,
	type JsonSchema,
} from './anthropic-json.server.ts'
import {
	emptyRecipeMetadataGroups,
	RECIPE_METADATA_DIMENSIONS,
	RECIPE_METADATA_LABELS,
	recipeMetadataNameKey,
	type RecipeMetadataDimension,
} from './recipe-metadata.ts'
import {
	MAX_RAW_TEXT_LENGTH,
	MAX_RECIPE_DESCRIPTION_LENGTH,
	MAX_RECIPE_INGREDIENTS,
	MAX_RECIPE_INSTRUCTIONS,
	MAX_RECIPE_NOTES_LENGTH,
	MAX_RECIPE_TITLE_LENGTH,
} from './recipe-validation.ts'
import { CANONICAL_COUNT_UNITS, CANONICAL_UNITS } from './unit-conversion.ts'

// Long enough for the whole paste the box accepts and for a recipe that fills
// the row caps below; both were raised together on 2026-09-21.
const TIMEOUT_TEXT_MS = 45_000
const TIMEOUT_IMAGE_MS = 60_000
const MAX_TOKENS = 16_000
// The paste box accepts MAX_RAW_TEXT_LENGTH. Cutting below it drops the recipe
// card blog posts put last, which is the part that matters.
const MAX_TEXT_LENGTH = MAX_RAW_TEXT_LENGTH
// Match the creation form exactly: a row the model is allowed to return is a
// row a save accepts, and neither silently discards the tail of a recipe.
const MAX_INGREDIENTS = MAX_RECIPE_INGREDIENTS
const MAX_INSTRUCTIONS = MAX_RECIPE_INSTRUCTIONS

// Field length caps — prevent absurd LLM output from reaching DB/UI. Titles,
// descriptions and notes use the save schema's own limits so an extraction can
// never produce a recipe that the review page then refuses to save.
const MAX_TITLE_LENGTH = MAX_RECIPE_TITLE_LENGTH
const MAX_DESCRIPTION_LENGTH = MAX_RECIPE_DESCRIPTION_LENGTH
const MAX_NOTES_LENGTH = MAX_RECIPE_NOTES_LENGTH
const MAX_INGREDIENT_NAME_LENGTH = 200
const MAX_INGREDIENT_AMOUNT_LENGTH = 20
const MAX_INGREDIENT_UNIT_LENGTH = 30
const MAX_INGREDIENT_NOTES_LENGTH = 500
const MAX_INSTRUCTION_LENGTH = 5000
// Per dimension. A household with a dozen cuisines can have several that argue
// for themselves; pre-ticking all of them on the review page is noise, and the
// user still has the full list to add from.
const MAX_METADATA_SUGGESTIONS = 3

export const ALLOWED_IMAGE_MEDIA_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
] as const

/**
 * A household's own value names, per dimension — the only Cuisine, Season and
 * Course values an extraction is allowed to come back with. The prompt states
 * them; `matchVocabulary` below is what makes that binding.
 */
export type RecipeMetadataVocabulary = Record<RecipeMetadataDimension, string[]>

export type ExtractedRecipeFromLLM = {
	title: string
	description: string | null
	notes: string | null
	activeTime: number | null
	totalTime: number | null
	yieldAmount: number | null
	yieldLabel: string | null
	ingredients: Array<{
		name: string
		amount: string | null
		unit: string | null
		notes: string | null
		isHeading: boolean
	}>
	instructions: Array<{ content: string }>
	/** Matched household values, in the household's own spelling. */
	metadata: RecipeMetadataVocabulary
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

/**
 * Built per request rather than once: the drop rule below needs the household's
 * own value names, which structured outputs cannot express (the schema subset
 * has no per-request enum) and which the prompt can only ask for.
 */
function extractedRecipeSchema(
	vocabulary: RecipeMetadataVocabulary,
): z.ZodType<ExtractedRecipeFromLLM> {
	return z
		.object({
			title: z.string().trim().min(1),
			description: z.unknown().optional(),
			notes: z.unknown().optional(),
			activeTime: z.unknown().optional(),
			totalTime: z.unknown().optional(),
			yieldAmount: z.unknown().optional(),
			yieldLabel: z.unknown().optional(),
			ingredients: z.array(z.unknown()),
			instructions: z.array(z.unknown()),
			metadata: z.unknown().optional(),
		})
		.transform((recipe) => ({
			title: recipe.title.slice(0, MAX_TITLE_LENGTH),
			description:
				typeof recipe.description === 'string'
					? recipe.description.trim().slice(0, MAX_DESCRIPTION_LENGTH) || null
					: null,
			notes:
				typeof recipe.notes === 'string'
					? recipe.notes.trim().slice(0, MAX_NOTES_LENGTH) || null
					: null,
			...reconcileTimes(recipe.activeTime, recipe.totalTime),
			yieldAmount:
				typeof recipe.yieldAmount === 'number' &&
				recipe.yieldAmount > 0 &&
				typeof recipe.yieldLabel === 'string' &&
				recipe.yieldLabel.trim()
					? recipe.yieldAmount
					: null,
			yieldLabel:
				typeof recipe.yieldAmount === 'number' &&
				recipe.yieldAmount > 0 &&
				typeof recipe.yieldLabel === 'string' &&
				recipe.yieldLabel.trim()
					? recipe.yieldLabel.trim().slice(0, 100)
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
			metadata: matchVocabulary(recipe.metadata, vocabulary),
		}))
		.refine(
			(recipe) =>
				recipe.ingredients.some((ingredient) => !ingredient.isHeading) &&
				recipe.instructions.length > 0,
		)
}

/**
 * Keep only the names this household already has, in its own spelling, and drop
 * everything else. This is what makes "never invent a value" true: the prompt
 * asks for matches, and a value the household cannot name is discarded rather
 * than created. Matching is on the same normalized identity the rest of the
 * app uses, so "italian" from the model finds the household's "Italian".
 */
function matchVocabulary(
	raw: unknown,
	vocabulary: RecipeMetadataVocabulary,
): RecipeMetadataVocabulary {
	const suggested =
		typeof raw === 'object' && raw !== null
			? (raw as Record<string, unknown>)
			: {}
	const matched = emptyRecipeMetadataGroups<string>()

	for (const dimension of RECIPE_METADATA_DIMENSIONS) {
		const known = new Map(
			vocabulary[dimension].map((name) => [recipeMetadataNameKey(name), name]),
		)
		const values = suggested[dimension]
		if (!Array.isArray(values)) continue

		for (const value of values) {
			if (matched[dimension].length >= MAX_METADATA_SUGGESTIONS) break
			if (typeof value !== 'string') continue
			const name = known.get(recipeMetadataNameKey(value))
			if (!name || matched[dimension].includes(name)) continue
			matched[dimension].push(name)
		}
	}

	return matched
}

/**
 * The shape the provider constrains the response to. It settles the types the
 * prompt used to only ask for — a time arrives as a whole number of minutes or
 * not at all — while every cap, trim and coercion stays in the Zod schema
 * above, which structured outputs cannot express.
 */
const EXTRACT_JSON_SCHEMA: JsonSchema = {
	anyOf: [
		{
			type: 'object',
			properties: {
				title: { type: 'string' },
				description: nullable({ type: 'string' }),
				notes: nullable({ type: 'string' }),
				activeTime: nullable({ type: 'integer' }),
				totalTime: nullable({ type: 'integer' }),
				yieldAmount: nullable({ type: 'number' }),
				yieldLabel: nullable({ type: 'string' }),
				ingredients: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							name: { type: 'string' },
							amount: nullable({ type: 'string' }),
							// Left a free string: the prompt asks for a canonical
							// unit or null, and an enum here would make the model
							// pick a wrong unit where it should have picked none.
							unit: nullable({ type: 'string' }),
							notes: nullable({ type: 'string' }),
							isHeading: { type: 'boolean' },
						},
						required: ['name', 'amount', 'unit', 'notes', 'isHeading'],
						additionalProperties: false,
					},
				},
				instructions: {
					type: 'array',
					items: {
						type: 'object',
						properties: { content: { type: 'string' } },
						required: ['content'],
						additionalProperties: false,
					},
				},
				// Free strings, not a per-household enum: an enum would have to be
				// rebuilt per request, and the model would still need the prompt to
				// know what the names mean. The prompt asks; Zod enforces.
				metadata: {
					type: 'object',
					properties: Object.fromEntries(
						RECIPE_METADATA_DIMENSIONS.map((dimension) => [
							dimension,
							{ type: 'array', items: { type: 'string' } },
						]),
					),
					required: RECIPE_METADATA_DIMENSIONS,
					additionalProperties: false,
				},
			},
			required: [
				'title',
				'description',
				'notes',
				'activeTime',
				'totalTime',
				'yieldAmount',
				'yieldLabel',
				'ingredients',
				'instructions',
				'metadata',
			],
			additionalProperties: false,
		},
		// The "there is no recipe here" answer needs its own branch: without one
		// the schema would leave the model no way to say it, and a page with no
		// recipe would come back as an invented one.
		{
			type: 'object',
			properties: { error: { type: 'string', enum: ['no_recipe_found'] } },
			required: ['error'],
			additionalProperties: false,
		},
	],
}

/**
 * Read Active and Total time, and drop a Total shorter than the Active it is
 * paired with. The enhance path applies the same rule to its suggestions; a
 * contradiction reaching the review page is the same confusion either way.
 */
function reconcileTimes(
	rawActiveTime: unknown,
	rawTotalTime: unknown,
): { activeTime: number | null; totalTime: number | null } {
	const activeTime = positiveMinutes(rawActiveTime)
	const totalTime = positiveMinutes(rawTotalTime)
	return {
		activeTime,
		totalTime:
			activeTime != null && totalTime != null && totalTime < activeTime
				? null
				: totalTime,
	}
}

function positiveMinutes(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		return null
	}
	const minutes = Math.round(value)
	return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null
}

const SYSTEM_PROMPT =
	'You are a recipe extraction assistant. Extract a structured recipe from informal text or images such as social media captions, screenshots, blog posts, or YouTube descriptions. The content may contain emojis, abbreviations, hashtags, casual language, non-English text, or missing structure. Do your best to identify the recipe.'

export function buildExtractPrompt(
	mode: 'text' | 'image',
	rawText?: string,
	// Defaulted so the prompt-shape tests can ask for the prompt on its own; both
	// production call sites pass the household's real lists.
	vocabulary: RecipeMetadataVocabulary = emptyRecipeMetadataGroups<string>(),
): string {
	const intro =
		mode === 'text'
			? 'Extract a structured recipe from the following text:'
			: 'Extract a structured recipe from the provided image(s). If the recipe spans multiple images, combine the information from all images into a single complete recipe.'

	const textBlock =
		mode === 'text' && rawText
			? `\n---\n${rawText.slice(0, MAX_TEXT_LENGTH)}\n---\n`
			: ''

	const householdLists = RECIPE_METADATA_DIMENSIONS.map(
		(dimension) =>
			`${RECIPE_METADATA_LABELS[dimension]}: ${
				vocabulary[dimension].join(', ') || '(empty — always answer [])'
			}`,
	).join('; ')

	return `${intro}${textBlock}

Rules:
- Infer the recipe title if not explicitly stated. Keep the title under ${MAX_TITLE_LENGTH} characters — a longer one is rejected when the recipe is saved
- Write the title, description, instructions, ingredient names and notes in English, whatever the source language. Be precise with food terminology — e.g. Romanian "roșie" = tomato (not rosemary), "căței de usturoi" = garlic cloves (not sausage), "smântână" = sour cream. Keep an ingredient's original wording in that ingredient's notes. If unsure of a translation, keep the original name and note it
- unit must be one of: ${CANONICAL_UNITS.join(', ')} — or null. Translate the source's unit word into that list without changing the quantity: Romanian "linguri" and German "EL" are both tbsp, "lingurițe" and "TL" are tsp, "cană" is cup. Never convert between metric and imperial — 200 g stays 200 g, never 7 oz
- Use null for unit when the quantity is a count, and when the source's measure word is not in the list above. Put that measure word in notes instead: "2 lemons" → amount "2", unit null, name "lemons"; "2 cans of chickpeas" → amount "2", unit null, name "chickpeas", notes "cans"; "3 cloves garlic" → amount "3", unit null, name "garlic", notes "cloves". Keep a count word as the unit only when the source itself uses one of: ${CANONICAL_COUNT_UNITS.join(', ')}
- amount must be a plain number ("2"), a decimal written with a dot ("1.5", never "1,5"), a fraction ("1/2"), or a mixed number ("1 1/2"). Nothing else — no words, no units, no "~". For a range, use the lower bound as the amount and put the range in notes: "1 to 2 tsp" → amount "1", unit "tsp", notes "1 to 2 tsp"
- name is the bare ingredient and nothing else. Preparation, state, size and brand belong in notes: "finely chopped fresh parsley" → name "parsley", notes "fresh, finely chopped"; "large egg, room temperature" → name "egg", notes "large, room temperature"
- Convert informal measurements to concrete quantities ("a handful" → "1/2 cup", "a pinch" → "1/4 tsp", "a couple twists" → "1/4 tsp")
- Strip emojis, hashtags, and non-recipe content from the recipe fields
- Put the cook's own advice in the top-level "notes" — substitutions, storage, make-ahead steps, serving suggestions, equipment tips — as short plain-text lines, under ${MAX_NOTES_LENGTH} characters. Use null when the source offers none. Do not repeat the instructions there
- Convert conversational instructions to imperative form
- Separate combined ingredients ("salt and pepper" → two items)
- When ingredients are grouped into sub-sections (e.g., "For the Sauce", "Dry Batter", "Pie Dough", "Streusel Topping"), emit a heading row for each section immediately before the ingredients in that section. A heading row has isHeading: true, name set to the section title (cleaned up — drop a leading "For the" / "For "), and amount/unit/notes set to null. Regular ingredients have isHeading: false. List every ingredient from every sub-section individually; do NOT merge or sum quantities of the same ingredient across different sub-sections — they are used separately. Do NOT put the section name into the notes field — use a heading row instead
- If multiple recipes are present, extract only the main or primary recipe
- Return at most ${MAX_INGREDIENTS} ingredient rows (heading rows count toward that) and at most ${MAX_INSTRUCTIONS} instruction steps. If the source has more, keep the most important ones rather than stopping partway through
- Suggest Cuisine, Season and Course for this recipe by choosing from this household's own lists, copying a name exactly as it is spelled there — ${householdLists}. At most ${MAX_METADATA_SUGGESTIONS} per group, and usually one. Answer [] for a group whose list is empty, or when nothing on it fits, or when the recipe gives no reason to choose. Never invent a value and never answer with one that is not on the list above: anything else is discarded
- Copy Active time, Total time, and Yield only when the source explicitly states them; otherwise use null. Never estimate or default them. Total time must not be shorter than Active time
- activeTime and totalTime are plain whole numbers of minutes: "20 min" is 20, "1 hr 15 min" is 75, "1½ hours" is 90
- A yield must include both a positive numeric amount and its source label (for example, "Serves 6" becomes 6 + "servings"; "Makes 2 loaves" becomes 2 + "loaves")
- If no recognizable recipe is found, return {"error": "no_recipe_found"}

Return a single JSON object with this exact structure:
{
  "title": "Recipe Name",
  "description": "Brief description (1-2 sentences, under ${MAX_DESCRIPTION_LENGTH} characters)",
  "notes": "Cook's notes: substitutions, storage, make-ahead tips — or null",
  "activeTime": null,
  "totalTime": null,
  "yieldAmount": null,
  "yieldLabel": null,
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
  ],
  "metadata": {"cuisine": [], "season": [], "course": []}
}`
}

/**
 * Parse and validate the LLM extraction response.
 * Returns null on failure or if no recipe was found.
 */
export function parseExtractResponse(
	text: string,
	vocabulary: RecipeMetadataVocabulary = emptyRecipeMetadataGroups<string>(),
): ExtractedRecipeFromLLM | null {
	const result = parseAnthropicJson(text, extractedRecipeSchema(vocabulary))
	return result.ok ? result.data : null
}

/**
 * Extract a recipe from informal/unstructured text using Claude Haiku.
 */
export async function extractRecipeFromText(
	rawText: string,
	vocabulary: RecipeMetadataVocabulary = emptyRecipeMetadataGroups<string>(),
): Promise<ExtractedRecipeFromLLM | { error: string }> {
	const result = await requestAnthropicJson({
		feature: 'recipe-extract-text',
		model: ANTHROPIC_MODELS.fast,
		maxTokens: MAX_TOKENS,
		timeoutMs: TIMEOUT_TEXT_MS,
		system: SYSTEM_PROMPT,
		prompt: buildExtractPrompt('text', rawText, vocabulary),
		jsonSchema: EXTRACT_JSON_SCHEMA,
		schema: extractedRecipeSchema(vocabulary),
	})

	return result.ok
		? result.data
		: { error: extractionError(result.failure, 'text') }
}

// Sonnet accepts up to 1568px on the long edge before it downsamples on its
// own, so anything smaller only throws away recipe text: a 1170×2532 phone
// screenshot used to arrive at 473×1024. Quality 88 keeps small type legible
// at a size the request can still carry.
const IMAGE_MAX_DIMENSION = 1568
const IMAGE_JPEG_QUALITY = 88

async function prepareImage(
	imageBase64: string,
): Promise<{ data: string; media_type: string }> {
	const { default: sharp } = await import('sharp')
	const buf = Buffer.from(imageBase64, 'base64')
	const optimized = await sharp(buf)
		// Auto-orient first: sharp drops the EXIF orientation tag on write but
		// does not turn the pixels, so a photo shot in portrait would otherwise
		// reach the model on its side, with every line of the recipe vertical.
		.rotate()
		.resize(IMAGE_MAX_DIMENSION, IMAGE_MAX_DIMENSION, {
			fit: 'inside',
			withoutEnlargement: true,
		})
		.jpeg({ quality: IMAGE_JPEG_QUALITY })
		.toBuffer()
	return { data: optimized.toString('base64'), media_type: 'image/jpeg' }
}

/**
 * Extract a recipe from one or more images (screenshots, photos) using Claude Sonnet vision.
 */
export async function extractRecipeFromImages(
	images: Array<{ base64: string; mediaType: string }>,
	vocabulary: RecipeMetadataVocabulary = emptyRecipeMetadataGroups<string>(),
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
			{
				type: 'text',
				text: buildExtractPrompt('image', undefined, vocabulary),
			},
		],
		jsonSchema: EXTRACT_JSON_SCHEMA,
		schema: extractedRecipeSchema(vocabulary),
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
		case 'max-tokens':
			return mode === 'text'
				? 'This recipe was too long to extract in one go. Try pasting just the recipe card, or splitting it in two.'
				: 'This recipe was too long to extract in one go. Try fewer images at a time.'
		case 'parse':
		case 'schema':
			return mode === 'text'
				? "Couldn't find a recipe in the provided text. Try including ingredients and instructions."
				: "Couldn't find a recipe in the provided image(s). Make sure the image contains recipe text or ingredients."
		case 'provider':
			return 'Recipe extraction failed — the AI service returned an error. Please try again later.'
	}
}
