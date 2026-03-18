import { data } from 'react-router'
import { z } from 'zod'
import { checkAndRecordAiUsage } from '#app/utils/ai-rate-limit.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	type EnhanceableFields,
	enhanceRecipeMetadata,
} from '#app/utils/recipe-enhance-llm.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/enhance-recipe.ts'

const DAILY_LIMIT = 10

const EnhanceRequestSchema = z.object({
	recipeId: z.string().min(1),
})

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireProTier(request)

	const formData = await request.formData()
	const parsed = EnhanceRequestSchema.safeParse({
		recipeId: formData.get('recipeId'),
	})

	if (!parsed.success) {
		return data(
			{
				error: 'Invalid request',
				suggestions: null as EnhanceableFields | null,
			},
			{ status: 400 },
		)
	}

	const { recipeId } = parsed.data

	const { allowed } = await checkAndRecordAiUsage(
		userId,
		'recipe_enhance_llm_call',
		DAILY_LIMIT,
	)
	if (!allowed) {
		return data(
			{
				error: `You've reached the daily limit of ${DAILY_LIMIT} recipe enhancements. Try again tomorrow.`,
				suggestions: null as EnhanceableFields | null,
			},
			{ status: 429 },
		)
	}

	// Fetch recipe with household scoping
	const recipe = await prisma.recipe.findFirst({
		where: { id: recipeId, householdId },
		select: {
			title: true,
			description: true,
			servings: true,
			prepTime: true,
			cookTime: true,
			ingredients: {
				where: { isHeading: false },
				select: { name: true, amount: true, unit: true },
				orderBy: { order: 'asc' },
			},
			instructions: {
				select: { content: true },
				orderBy: { order: 'asc' },
			},
		},
	})

	if (!recipe) {
		return data(
			{
				error: 'Recipe not found',
				suggestions: null as EnhanceableFields | null,
			},
			{ status: 404 },
		)
	}

	const suggestions = await enhanceRecipeMetadata({
		title: recipe.title,
		description: recipe.description,
		servings: recipe.servings,
		prepTime: recipe.prepTime,
		cookTime: recipe.cookTime,
		ingredients: recipe.ingredients,
		instructions: recipe.instructions,
	})

	if ('error' in suggestions) {
		return data({
			error: suggestions.error,
			suggestions: null as EnhanceableFields | null,
		})
	}

	return data({ error: null, suggestions })
}
