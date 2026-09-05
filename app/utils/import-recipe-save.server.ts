import { parseWithZod } from '@conform-to/zod/v4'
import { data, redirect } from 'react-router'
import { z } from 'zod'
import { prisma } from './db.server.ts'
import { RecipeSchema } from './recipe-validation.ts'
import { RECIPE_IMPORTED } from './posthog-events.ts'
import { captureServerEvent } from './posthog.server.ts'

export async function saveImportedRecipe(
	formData: FormData,
	{ userId, householdId }: { userId: string; householdId: string },
	jsonReview = false,
) {
	// Validate every submitted row; never truncate at a count limit or a gap.
	const submission = parseWithZod(formData, {
		schema: RecipeSchema.safeExtend({ rawText: z.string().optional() }),
	})
	const failure = (
		error: string,
		status: number,
		result = submission.reply(),
	) => {
		const payload = {
			intent: 'save' as const,
			error,
			result,
			recipe: null,
			duplicates: null,
		}
		return jsonReview
			? Response.json(payload, { status })
			: data(payload, { status })
	}
	if (submission.status !== 'success') {
		return failure('Correct the fields listed below, then save again.', 400)
	}
	const {
		title,
		description,
		activeTime,
		totalTime,
		yieldAmount,
		yieldLabel,
		sourceUrl,
		rawText,
		ingredients,
		instructions,
	} = submission.value

	let recipe: { id: string }
	try {
		recipe = await prisma.recipe.create({
			data: {
				title,
				description,
				activeTime,
				totalTime,
				yieldAmount,
				yieldLabel,
				sourceUrl: sourceUrl || null,
				rawText: rawText ?? null,
				userId,
				householdId,
				ingredients: {
					create: ingredients.map((ing, order) => ({
						name: ing.name,
						amount: ing.isHeading ? null : ing.amount || null,
						unit: ing.isHeading ? null : ing.unit || null,
						notes: ing.isHeading ? null : ing.notes || null,
						isHeading: ing.isHeading ?? false,
						order,
					})),
				},
				instructions: {
					create: instructions.map((inst, order) => ({
						content: inst.content,
						order,
					})),
				},
			},
			select: { id: true },
		})
	} catch {
		return failure(
			'We could not confirm the save. Your corrections are still here. Check My Recipes before trying again.',
			503,
			submission.reply({ formErrors: ['Save could not be confirmed.'] }),
		)
	}

	captureServerEvent(userId, RECIPE_IMPORTED, {
		recipe_title: title,
		ingredient_count: ingredients.length,
	})
	return jsonReview
		? Response.json({ recipeId: recipe.id })
		: redirect(`/recipes/${recipe.id}`)
}
