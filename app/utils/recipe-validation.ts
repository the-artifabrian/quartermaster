import { z } from 'zod'
import { RecipeMetadataSelectionFieldSchema } from './recipe-metadata.ts'

export const MAX_RECIPE_TITLE_LENGTH = 100

export const RecipeTitleSchema = z
	.string({
		error: (issue) =>
			issue.input === undefined ? 'Title is required' : undefined,
	})
	.min(1, { message: 'Title is required' })
	.max(MAX_RECIPE_TITLE_LENGTH, { message: 'Title is too long' })

export const MAX_RECIPE_DESCRIPTION_LENGTH = 500

// The original pasted/scraped source text kept alongside a Recipe. Lives here
// rather than next to one of its writers because there are three of them — the
// paste and URL flows in the Recipe import modules, the JSON data import in
// routes/settings/profile/import.tsx, and saveImportedRecipe — and
// until 2026-09-11 only the first enforced a ceiling. Every other recipe field
// is bounded at its schema; an unbounded one is how oversized user text reaches
// code that was never measured against it.
export const MAX_RAW_TEXT_LENGTH = 50_000

export const RecipeDescriptionSchema = z
	.string()
	.max(MAX_RECIPE_DESCRIPTION_LENGTH, { message: 'Description is too long' })
	.optional()

export const MAX_RECIPE_NOTES_LENGTH = 2000

export const RecipeNotesSchema = z
	.string()
	.max(MAX_RECIPE_NOTES_LENGTH, { message: 'Notes are too long' })
	.optional()

// Row ceilings for one Recipe. The creation form, the save schema and the AI
// extraction prompt all read these, so what the model is told to return and
// what a save accepts cannot drift apart.
export const MAX_RECIPE_INGREDIENTS = 200
export const MAX_RECIPE_INSTRUCTIONS = 200

export const MAX_INGREDIENT_NAME_LENGTH = 200
export const MAX_INGREDIENT_AMOUNT_LENGTH = 50
export const MAX_INGREDIENT_UNIT_LENGTH = 50
export const MAX_INGREDIENT_NOTES_LENGTH = 500
export const MAX_INSTRUCTION_LENGTH = 5000
export const MAX_YIELD_LABEL_LENGTH = 100
export const MAX_SOURCE_URL_LENGTH = 2000

// The edit form shows these at the row they are about, so they say what to
// do there. A heading row shows its own wording for a missing name.
export const INGREDIENT_NAME_REQUIRED_MESSAGE =
	'Name this ingredient, or remove it'
export const HEADING_NAME_REQUIRED_MESSAGE = 'Name this heading, or remove it'
export const INSTRUCTION_REQUIRED_MESSAGE = 'Write this step, or remove it'

export const IngredientSchema = z.object({
	id: z.string().optional(),
	// Conform submits an empty field as missing, so both say the same.
	name: z
		.string({
			error: (issue) =>
				issue.input === undefined
					? INGREDIENT_NAME_REQUIRED_MESSAGE
					: undefined,
		})
		.min(1, { message: INGREDIENT_NAME_REQUIRED_MESSAGE })
		.max(MAX_INGREDIENT_NAME_LENGTH, {
			message: 'Ingredient name is too long',
		}),
	amount: z
		.string()
		.max(MAX_INGREDIENT_AMOUNT_LENGTH, { message: 'Amount is too long' })
		.optional(),
	unit: z
		.string()
		.max(MAX_INGREDIENT_UNIT_LENGTH, { message: 'Unit is too long' })
		.optional(),
	notes: z
		.string()
		.max(MAX_INGREDIENT_NOTES_LENGTH, { message: 'Notes are too long' })
		.optional(),
	isHeading: z.preprocess((v) => v === 'true', z.boolean()).optional(),
	linkedRecipeId: z.string().optional(),
})

export const InstructionSchema = z.object({
	id: z.string().optional(),
	content: z
		.string({
			error: (issue) =>
				issue.input === undefined ? INSTRUCTION_REQUIRED_MESSAGE : undefined,
		})
		.min(1, { message: INSTRUCTION_REQUIRED_MESSAGE })
		.max(MAX_INSTRUCTION_LENGTH, { message: 'Instruction is too long' }),
})

const optionalPositiveInteger = z.preprocess(
	(value) => (value === '' || value == null ? undefined : value),
	z.coerce.number().int().positive().optional(),
)

const optionalPositiveNumber = z.preprocess(
	(value) => (value === '' || value == null ? undefined : value),
	z.coerce.number().positive().optional(),
)

const optionalYieldLabel = z.preprocess(
	(value) =>
		typeof value === 'string' && value.trim() === '' ? undefined : value,
	z
		.string()
		.trim()
		.max(MAX_YIELD_LABEL_LENGTH, {
			message: 'What the recipe makes is too long',
		})
		.optional(),
)

const recipeTimeYieldFields = {
	activeTime: optionalPositiveInteger,
	totalTime: optionalPositiveInteger,
	yieldAmount: optionalPositiveNumber,
	yieldLabel: optionalYieldLabel,
}

export const RecipeTimeYieldSchema = z
	.object(recipeTimeYieldFields)
	.superRefine((recipe, context) => {
		if (recipe.yieldAmount != null && recipe.yieldLabel == null) {
			context.addIssue({
				code: 'custom',
				path: ['yieldLabel'],
				message: 'Say what the recipe makes',
			})
		}
		if (recipe.yieldLabel != null && recipe.yieldAmount == null) {
			context.addIssue({
				code: 'custom',
				path: ['yieldAmount'],
				message: 'Add how many the recipe makes',
			})
		}
	})

export const RecipeSchema = z
	.object({
		title: RecipeTitleSchema,
		description: RecipeDescriptionSchema,
		...recipeTimeYieldFields,
		recipeMetadata: RecipeMetadataSelectionFieldSchema,
		sourceUrl: z.url().max(MAX_SOURCE_URL_LENGTH).optional().or(z.literal('')),
		notes: RecipeNotesSchema,
		ingredients: z
			.array(IngredientSchema)
			.min(1, { message: 'Add at least one ingredient' })
			.max(MAX_RECIPE_INGREDIENTS, {
				message: `A Recipe holds up to ${MAX_RECIPE_INGREDIENTS} ingredients`,
			}),
		instructions: z
			.array(InstructionSchema)
			.min(1, { message: 'Add at least one step' })
			.max(MAX_RECIPE_INSTRUCTIONS, {
				message: `A Recipe holds up to ${MAX_RECIPE_INSTRUCTIONS} steps`,
			}),
	})
	.superRefine((recipe, context) => {
		if (recipe.yieldAmount != null && recipe.yieldLabel == null) {
			context.addIssue({
				code: 'custom',
				path: ['yieldLabel'],
				message: 'Say what the recipe makes',
			})
		}
		if (recipe.yieldLabel != null && recipe.yieldAmount == null) {
			context.addIssue({
				code: 'custom',
				path: ['yieldAmount'],
				message: 'Add how many the recipe makes',
			})
		}
	})

export type RecipeFormData = z.infer<typeof RecipeSchema>

export const ImportUrlSchema = z.object({
	url: z
		.url({ error: 'Please enter a valid URL' })
		.max(2000, 'URL is too long'),
})

export const MAX_RECIPE_IMAGE_SIZE = 1024 * 1024 * 3 // 3MB
/** Each screenshot sent to a Recipe image import. */
export const MAX_IMPORT_IMAGE_SIZE = 5 * 1024 * 1024
/**
 * The most pixels a picked photo may have before the browser shrinks it to
 * 2048 px, however small the file. The app never shows a photo larger than
 * that. The server refuses photos that cost too much to decode
 * (recipe-photo.server.ts); at this many pixels any 8-bit photo is under
 * every one of its limits.
 */
export const MAX_UNSHRUNK_PIXELS = 8_000_000
/** Screenshots in one Recipe image import. */
export const MAX_IMPORT_IMAGE_COUNT = 5

/**
 * The Recipe form's reply when the upload parser stops at a photo over
 * `MAX_RECIPE_IMAGE_SIZE`. The parser stops before reading the other fields,
 * so there is nothing to echo back; the browser still holds what was typed.
 */
export const photoTooLargeResult = {
	status: 'error' as const,
	initialValue: {},
	error: { image: ['Photo is over 3 MB'] },
}
