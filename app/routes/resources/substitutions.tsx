import { data } from 'react-router'
import { z } from 'zod'
import { prisma } from '#app/utils/db.server.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
import {
	type RecipeContext,
	getSubstitutions,
} from '#app/utils/substitution-lookup.server.ts'
import { trackEvent } from '#app/utils/usage-tracking.server.ts'
import { type Route } from './+types/substitutions.ts'

const SubstitutionRequestSchema = z.object({
	ingredientName: z.string().min(1),
	recipeId: z.string().optional(),
})

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireProTier(request)

	const formData = await request.formData()
	const parsed = SubstitutionRequestSchema.safeParse({
		ingredientName: formData.get('ingredientName'),
		recipeId: formData.get('recipeId') || undefined,
	})

	if (!parsed.success) {
		return data({ substitutions: [], source: 'none' as const }, { status: 400 })
	}

	const { ingredientName, recipeId } = parsed.data

	const [inventoryItems, recipeContext] = await Promise.all([
		prisma.inventoryItem.findMany({
			where: { householdId },
			select: { name: true },
		}),
		recipeId ? getRecipeContext(recipeId, householdId) : undefined,
	])

	const result = await getSubstitutions(
		ingredientName,
		inventoryItems,
		recipeContext ?? undefined,
	)

	if (result.source === 'llm') {
		trackEvent(userId, householdId, 'SUBSTITUTION_LLM_CALL', {
			ingredientName,
			recipeId,
		})
	}

	return data(result)
}

async function getRecipeContext(
	recipeId: string,
	householdId: string,
): Promise<RecipeContext | null> {
	const recipe = await prisma.recipe.findFirst({
		where: { id: recipeId, householdId },
		select: {
			title: true,
			ingredients: {
				where: { isHeading: false },
				select: { name: true },
				orderBy: { order: 'asc' },
			},
		},
	})
	if (!recipe) return null
	return {
		title: recipe.title,
		ingredients: recipe.ingredients.map((i) => i.name),
	}
}
