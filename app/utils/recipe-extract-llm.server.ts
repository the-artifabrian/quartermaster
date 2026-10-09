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
import { CANONICAL_UNITS } from './unit-conversion.ts'

// Long enough for the whole paste the box accepts and for a recipe that fills
// the row caps below; both were raised together on 2026-09-21.
const TIMEOUT_TEXT_MS = 45_000
const TIMEOUT_IMAGE_MS = 60_000
const MAX_TOKENS = 16_000
// The paste box accepts MAX_RAW_TEXT_LENGTH. Cutting below it drops the recipe
// card blog posts put last, which is the part that matters.
const MAX_TEXT_LENGTH = MAX_RAW_TEXT_LENGTH
// The prompt states the save limits. Nothing here cuts to them: a row or a
// field over a limit reaches the import save whole, and `fitImportedRecipe`
// shortens it at a word, moves text to the field beside it when that keeps it
// whole, and reports the cut on the Recipe page.
const MAX_INGREDIENTS = MAX_RECIPE_INGREDIENTS
const MAX_INSTRUCTIONS = MAX_RECIPE_INSTRUCTIONS
const MAX_TITLE_LENGTH = MAX_RECIPE_TITLE_LENGTH
const MAX_DESCRIPTION_LENGTH = MAX_RECIPE_DESCRIPTION_LENGTH
const MAX_NOTES_LENGTH = MAX_RECIPE_NOTES_LENGTH
// Per dimension. A household with a dozen cuisines can have several that argue
// for themselves; saving all of them with an import is noise, and the
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
			name: ingredient.name.trim(),
			amount: isHeading
				? null
				: typeof ingredient.amount === 'string'
					? ingredient.amount.trim() || null
					: typeof ingredient.amount === 'number'
						? String(ingredient.amount)
						: null,
			unit: isHeading
				? null
				: typeof ingredient.unit === 'string'
					? ingredient.unit.trim() || null
					: null,
			notes: isHeading
				? null
				: typeof ingredient.notes === 'string'
					? ingredient.notes.trim() || null
					: null,
			isHeading,
		}
	})

const ExtractedInstructionSchema = z
	.union([
		z.string(),
		z.object({ content: z.string() }).transform(({ content }) => content),
	])
	.transform((content) => content.trim())
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
			title: recipe.title,
			description:
				typeof recipe.description === 'string'
					? recipe.description.trim() || null
					: null,
			notes:
				typeof recipe.notes === 'string' ? recipe.notes.trim() || null : null,
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
					? recipe.yieldLabel.trim()
					: null,
			ingredients: recipe.ingredients.flatMap((ingredient) => {
				const parsed = ExtractedIngredientSchema.safeParse(ingredient)
				return parsed.success ? [parsed.data] : []
			}),
			instructions: recipe.instructions.flatMap((instruction) => {
				const parsed = ExtractedInstructionSchema.safeParse(instruction)
				return parsed.success ? [parsed.data] : []
			}),
			metadata: matchVocabulary(recipe.metadata, vocabulary),
		}))
		.refine(
			// Either half is enough: the import saves what the source gives and
			// the Recipe page asks for the rest. Requiring both pushed the model
			// to invent the steps a caption leaves to its video.
			(recipe) =>
				recipe.ingredients.some((ingredient) => !ingredient.isHeading) ||
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
 * not at all — while every trim and coercion stays in the Zod schema
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
							// unit where one fits and keeps any other measure word
							// ("cloves", "pinch") as written, which no enum holds.
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
 * contradiction reaching a saved Recipe is the same confusion either way.
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

// The Recipe is saved without a review step, so anything the model adds
// would read as the author's. It transcribes; the cook fills any gap.
const SYSTEM_PROMPT =
	'You transcribe recipes into structured data. The source may be a social media caption, a blog post, a YouTube description, a screenshot, a photographed cookbook page or a handwritten card, with emojis, hashtags, abbreviations, casual language, another language, or no structure at all. Copy the recipe it gives and never add to it: an ingredient, amount, step or time the source does not give stays out.'

export function buildExtractPrompt(
	mode: 'text' | 'image',
	rawText?: string,
	// Defaulted so the prompt-shape tests can ask for the prompt on its own; both
	// production call sites pass the household's real lists.
	vocabulary: RecipeMetadataVocabulary = emptyRecipeMetadataGroups<string>(),
): string {
	// The paste comes first and the rules after it. Tags, not a line of dashes:
	// pasted posts are full of those.
	const source =
		mode === 'text' && rawText
			? `<source>\n${rawText.slice(0, MAX_TEXT_LENGTH)}\n</source>\n\n`
			: ''

	const intro =
		mode === 'text'
			? 'Extract the recipe from the text between the <source> tags.'
			: 'Extract the recipe from the provided image(s). Several screenshots of one recipe may arrive out of order, and consecutive screenshots often repeat the lines where they overlap: combine them into one recipe, in the order the recipe itself gives, and list a repeated line once.'

	const householdLists = RECIPE_METADATA_DIMENSIONS.map(
		(dimension) =>
			`${RECIPE_METADATA_LABELS[dimension]}: ${
				vocabulary[dimension].join(', ') || '(empty — always answer [])'
			}`,
	).join('; ')

	return `${source}${intro}

Rules:
- Copy only what the source gives. When it has ingredients but no steps (a caption that says "method in the video"), return "instructions": []. When it has steps but no ingredient list, list the ingredients its steps name, with the amounts the steps give. Never fill a gap with ingredients, amounts or steps of your own: the cook adds what is missing
- If the source has neither ingredients nor steps, return {"error": "no_recipe_found"}
- If it has several recipes, extract only the main one. When a page gives the same recipe twice (step-by-step photos in the post, then a recipe card), use the recipe card
- Leave out everything that is not the recipe: emojis, hashtags, life stories, ratings, comments, nutrition facts, ads and links to other recipes
- title: the source's name for the dish in English, or a short plain English name when it has none. Keep it under ${MAX_TITLE_LENGTH} characters: a longer one is cut when the recipe is saved
- description: the source's own one- or two-sentence summary of the dish, under ${MAX_DESCRIPTION_LENGTH} characters, or null when it has none. Don't write one yourself
- Write the title, description, instructions, ingredient names and notes in English, whatever the source language. Be precise with food terminology — e.g. Romanian "roșie" = tomato (not rosemary), "căței de usturoi" = garlic cloves (not sausage), "smântână" = sour cream. Keep each translated ingredient's original wording in its notes: "3 roșii" → name "tomatoes", notes "roșii". If unsure of a translation, keep the original name and note it
- Shopping copies an ingredient's amount, unit and name, never its notes, so the quantity a shopper needs belongs in those three
- name is the bare ingredient and nothing else. Preparation, state, size and brand belong in notes: "finely chopped fresh parsley" → name "parsley", notes "fresh, finely chopped"; "large egg, room temperature" → name "egg", notes "large, room temperature". Put "optional" in the notes of an optional ingredient: Shopping leaves those out
- Separate combined ingredients: "salt and pepper to taste" → name "salt", notes "to taste" and name "pepper", notes "to taste"
- amount is a plain number ("2"), a decimal written with a dot ("1.5", never "1,5"), a fraction ("1/2"), a mixed number ("1 1/2"), or a range of two of those joined by a hyphen ("2-3", "1/2-1"). Nothing else — no words, no units, no "~". "2 to 3 tbsp" → amount "2-3", unit "tbsp"
- An ingredient the source gives no quantity for ("salt to taste", "oil for frying") has amount null and unit null, with "to taste" or "for frying" in its notes. Never turn a vague measure into a number
- unit: when the source measures in one of ${CANONICAL_UNITS.join(', ')}, or in a word for one of them in any language, use that unit from this list: "tablespoons", Romanian "linguri" and German "EL" are all tbsp; "lingurițe" and "TL" are tsp; "cană" is cup. Never convert between metric and imperial — 200 g stays 200 g, never 7 oz
- Any other measure word the source uses stays the unit, in English: "3 cloves garlic" → amount "3", unit "cloves", name "garlic"; "2 cans of chickpeas" → amount "2", unit "cans", name "chickpeas"; "a pinch of salt" → amount "1", unit "pinch", name "salt"; "a handful of basil" → amount "1", unit "handful", name "basil". When the quantity is a plain count, unit is null: "2 lemons" → amount "2", unit null, name "lemons"
- When the source gives two measures for one ingredient, use the first as amount and unit and put the other in notes: "1 cup (240 ml) cream" → amount "1", unit "cup", notes "240 ml". When it adds two ("1/2 cup plus 2 tbsp"), use the first and put the whole measure in notes
- When ingredients are grouped into sub-sections (e.g., "For the Sauce", "Dry Batter", "Pie Dough", "Streusel Topping"), emit a heading row for each section immediately before the ingredients in that section. A heading row has isHeading: true, name set to the section title without a leading "For the" or "For" ("For the sauce" → "Sauce"), and amount/unit/notes set to null. Regular ingredients have isHeading: false. List every ingredient from every sub-section individually; do NOT merge or sum quantities of the same ingredient across different sub-sections — they are used separately. Do NOT put the section name into the notes field — use a heading row instead
- instructions: the source's own steps, in its order, one entry each, without a number or a "Step 1:" label — the app numbers the steps. Don't split a step into its sentences or merge steps; only a method written as one paragraph is split into steps. Convert conversational instructions to imperative form. A section title in the method ("For the sauce") is never a step on its own
- In steps, write durations and temperatures in digits with their unit ("10 minutes", "180°C", "350°F"): the Recipe page turns those into timers. Never convert between °C and °F
- Return at most ${MAX_INGREDIENTS} ingredient rows (heading rows count toward that) and at most ${MAX_INSTRUCTIONS} instruction steps. If the source has more, keep the most important ones rather than stopping partway through
- Put the cook's own advice in the top-level "notes" — substitutions, storage, make-ahead steps, serving suggestions, equipment — as short plain-text lines, under ${MAX_NOTES_LENGTH} characters. Use null when the source offers none. Do not repeat the instructions there
- Suggest Cuisine, Season and Course for this recipe by choosing from this household's own lists, copying a name exactly as it is spelled there — ${householdLists}. At most ${MAX_METADATA_SUGGESTIONS} per group, and usually one. Answer [] for a group whose list is empty, or when nothing on it fits, or when the recipe gives no reason to choose. Never invent a value and never answer with one that is not on the list above: anything else is discarded
- activeTime is the source's prep or active time. totalTime is a total the source states ("Total time: 45 min", "ready in 45 minutes"), never a sum you work out: "prep 5 min, cook 15 min" gives activeTime 5 and totalTime null. Cook time alone is neither. Never estimate either one. Total time must not be shorter than Active time
- activeTime and totalTime are plain whole numbers of minutes: "20 min" is 20, "1 hr 15 min" is 75, "1½ hours" is 90
- A yield needs a single positive amount and the source's label: "Serves 6" becomes 6 + "servings"; "Makes 2 loaves" becomes 2 + "loaves". A range ("Serves 4-6") has no single amount, so yieldAmount and yieldLabel are both null, as they are when the source states no yield

Return a single JSON object with this exact structure:
{
  "title": "Recipe Name",
  "description": "The source's own one- or two-sentence summary, or null",
  "notes": "Cook's notes: substitutions, storage, make-ahead tips — or null",
  "activeTime": null,
  "totalTime": null,
  "yieldAmount": null,
  "yieldLabel": null,
  "ingredients": [
    {"name": "Sauce", "amount": null, "unit": null, "notes": null, "isHeading": true},
    {"name": "soy sauce", "amount": "2", "unit": "tbsp", "notes": null, "isHeading": false},
    {"name": "garlic", "amount": "3", "unit": "cloves", "notes": "minced", "isHeading": false},
    {"name": "chili flakes", "amount": "1-2", "unit": "tsp", "notes": "optional", "isHeading": false},
    {"name": "Stir Fry", "amount": null, "unit": null, "notes": null, "isHeading": true},
    {"name": "chicken breast", "amount": "2", "unit": null, "notes": "diced", "isHeading": false},
    {"name": "salt", "amount": null, "unit": null, "notes": "to taste", "isHeading": false}
  ],
  "instructions": [
    {"content": "One step in imperative form, without its number"}
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
 * Extract a recipe from informal/unstructured text with the fast model.
 */
export async function extractRecipeFromText(
	rawText: string,
	vocabulary: RecipeMetadataVocabulary = emptyRecipeMetadataGroups<string>(),
): Promise<ExtractedRecipeFromLLM | { error: string }> {
	const result = await requestAnthropicJson({
		feature: 'recipe-extract-text',
		model: ANTHROPIC_MODELS.fast,
		maxTokens: MAX_TOKENS,
		effort: 'low',
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

// Claude accepts up to 1568px on the long edge before it downsamples on its
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
 * Extract a recipe from one or more images (screenshots, photos) with the
 * vision model.
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
		effort: 'low',
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
				? "Couldn't find a recipe in the provided text. Try including ingredients or instructions."
				: "Couldn't find a recipe in the provided image(s). Make sure the image contains recipe text or ingredients."
		case 'provider':
			return 'Recipe extraction failed — the AI service returned an error. Please try again later.'
	}
}
