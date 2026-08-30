import { z } from 'zod'

export const RecipeTitleSchema = z
	.string({
		error: (issue) =>
			issue.input === undefined ? 'Title is required' : undefined,
	})
	.min(1, { message: 'Title is required' })
	.max(100, { message: 'Title is too long' })

export const RecipeDescriptionSchema = z
	.string()
	.max(500, { message: 'Description is too long' })
	.optional()

export const RecipeNotesSchema = z
	.string()
	.max(2000, { message: 'Notes are too long' })
	.optional()

export const IngredientSchema = z.object({
	id: z.string().optional(),
	name: z
		.string()
		.min(1, { message: 'Ingredient name is required' })
		.max(200, { message: 'Ingredient name is too long' }),
	amount: z.string().max(50, { message: 'Amount is too long' }).optional(),
	unit: z.string().max(50, { message: 'Unit is too long' }).optional(),
	notes: z.string().max(500, { message: 'Notes are too long' }).optional(),
	isHeading: z.preprocess((v) => v === 'true', z.boolean()).optional(),
	linkedRecipeId: z.string().optional(),
})

export const InstructionSchema = z.object({
	id: z.string().optional(),
	content: z
		.string()
		.min(1, { message: 'Instruction is required' })
		.max(5000, { message: 'Instruction is too long' }),
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
	z.string().trim().max(100, { message: 'Yield label is too long' }).optional(),
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
				message: 'Add a yield label',
			})
		}
		if (recipe.yieldLabel != null && recipe.yieldAmount == null) {
			context.addIssue({
				code: 'custom',
				path: ['yieldAmount'],
				message: 'Add a yield amount',
			})
		}
	})

export const RecipeSchema = z
	.object({
		title: RecipeTitleSchema,
		description: RecipeDescriptionSchema,
		servings: z.coerce.number().int().min(1).max(100).default(4),
		prepTime: z.coerce.number().int().min(0).max(1440).optional(),
		cookTime: z.coerce.number().int().min(0).max(1440).optional(),
		...recipeTimeYieldFields,
		sourceUrl: z.url().max(2000).optional().or(z.literal('')),
		notes: RecipeNotesSchema,
		ingredients: z
			.array(IngredientSchema)
			.min(1, { message: 'At least one ingredient is required' })
			.max(200, { message: 'Too many ingredients' }),
		instructions: z
			.array(InstructionSchema)
			.min(1, { message: 'At least one instruction is required' })
			.max(200, { message: 'Too many instructions' }),
	})
	.superRefine((recipe, context) => {
		if (recipe.yieldAmount != null && recipe.yieldLabel == null) {
			context.addIssue({
				code: 'custom',
				path: ['yieldLabel'],
				message: 'Add a yield label',
			})
		}
		if (recipe.yieldLabel != null && recipe.yieldAmount == null) {
			context.addIssue({
				code: 'custom',
				path: ['yieldAmount'],
				message: 'Add a yield amount',
			})
		}
	})

export type RecipeFormData = z.infer<typeof RecipeSchema>

export const QuickRecipeSchema = z.object({
	title: RecipeTitleSchema,
	rawText: z
		.string({
			error: (issue) =>
				issue.input === undefined ? 'Recipe text is required' : undefined,
		})
		.min(1, 'Recipe text is required')
		.max(10000),
})

export const ImportUrlSchema = z.object({
	url: z
		.url({ error: 'Please enter a valid URL' })
		.max(2000, 'URL is too long'),
})

export const MAX_RECIPE_IMAGE_SIZE = 1024 * 1024 * 3 // 3MB
export const ACCEPTED_RECIPE_IMAGE_TYPES = [
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/webp',
]
