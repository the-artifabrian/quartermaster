import { z } from 'zod'

export const MealTypeSchema = z.enum(
	['breakfast', 'lunch', 'dinner', 'snack'],
	{
		required_error: 'Meal type is required',
	},
)

export const MealPlanEntrySchema = z.object({
	date: z.coerce.date(),
	mealType: MealTypeSchema,
	recipeId: z.string().min(1, { message: 'Recipe is required' }),
	servings: z.coerce.number().int().positive().optional(),
})

export type MealPlanEntryFormData = z.infer<typeof MealPlanEntrySchema>
