import { data } from 'react-router'
import { z } from 'zod'
import { prisma } from '#app/utils/db.server.ts'
import {
	type EnhanceableFields,
	enhanceRecipeMetadata,
} from '#app/utils/recipe-enhance-llm.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import { trackEvent } from '#app/utils/usage-tracking.server.ts'
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
			{ error: 'Invalid request', suggestions: null as EnhanceableFields | null },
			{ status: 400 },
		)
	}

	const { recipeId } = parsed.data

	// Rate limit: 10/day per user
	const todayStart = new Date()
	todayStart.setHours(0, 0, 0, 0)

	const usageCount = await prisma.usageEvent.count({
		where: {
			userId,
			type: 'recipe_enhance_llm_call',
			createdAt: { gte: todayStart },
		},
	})

	if (usageCount >= DAILY_LIMIT) {
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
			{ error: 'Recipe not found', suggestions: null as EnhanceableFields | null },
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

	if (!suggestions) {
		return data({
			error: 'Unable to generate suggestions. Please try again.',
			suggestions: null as EnhanceableFields | null,
		})
	}

	// Track only after successful LLM response (so failures don't eat rate limit)
	trackEvent(userId, householdId, 'recipe_enhance_llm_call', { recipeId })

	return data({ error: null, suggestions })
}
