import { z } from 'zod'

export const RecipeTitleSchema = z
	.string({ required_error: 'Title is required' })
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

export const RecipeSchema = z.object({
	title: RecipeTitleSchema,
	description: RecipeDescriptionSchema,
	servings: z.coerce.number().int().min(1).max(100).default(4),
	prepTime: z.coerce.number().int().min(0).max(1440).optional(),
	cookTime: z.coerce.number().int().min(0).max(1440).optional(),
	sourceUrl: z.string().url().max(2000).optional().or(z.literal('')),
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

export type RecipeFormData = z.infer<typeof RecipeSchema>

export const QuickRecipeSchema = z.object({
	title: RecipeTitleSchema,
	rawText: z
		.string({ required_error: 'Recipe text is required' })
		.min(1, 'Recipe text is required')
		.max(10000),
})

export const ImportUrlSchema = z.object({
	url: z.string().url('Please enter a valid URL'),
})

export const MAX_RECIPE_IMAGE_SIZE = 1024 * 1024 * 3 // 3MB
export const ACCEPTED_RECIPE_IMAGE_TYPES = [
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/webp',
]
