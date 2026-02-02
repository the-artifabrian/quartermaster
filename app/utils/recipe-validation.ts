import { z } from 'zod'

export const RecipeTitleSchema = z
	.string({ required_error: 'Title is required' })
	.min(1, { message: 'Title is required' })
	.max(100, { message: 'Title is too long' })

export const RecipeDescriptionSchema = z
	.string()
	.max(500, { message: 'Description is too long' })
	.optional()

export const IngredientSchema = z.object({
	id: z.string().optional(),
	name: z.string().min(1, { message: 'Ingredient name is required' }),
	amount: z.string().optional(),
	unit: z.string().optional(),
	notes: z.string().optional(),
})

export const InstructionSchema = z.object({
	id: z.string().optional(),
	content: z.string().min(1, { message: 'Instruction is required' }),
})

export const RecipeSchema = z.object({
	title: RecipeTitleSchema,
	description: RecipeDescriptionSchema,
	servings: z.coerce.number().int().min(1).max(100).default(4),
	prepTime: z.coerce.number().int().min(0).max(1440).optional(),
	cookTime: z.coerce.number().int().min(0).max(1440).optional(),
	ingredients: z.array(IngredientSchema).min(1, {
		message: 'At least one ingredient is required',
	}),
	instructions: z.array(InstructionSchema).min(1, {
		message: 'At least one instruction is required',
	}),
	tagIds: z.array(z.string()).optional(),
})

export type RecipeFormData = z.infer<typeof RecipeSchema>

export const MAX_RECIPE_IMAGE_SIZE = 1024 * 1024 * 3 // 3MB
export const ACCEPTED_RECIPE_IMAGE_TYPES = [
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/webp',
]
