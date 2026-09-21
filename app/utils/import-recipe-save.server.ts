import { parseWithZod } from '@conform-to/zod/v4'
import { data, redirect } from 'react-router'
import { z } from 'zod'
import { prisma } from './db.server.ts'
import {
	RecipeMetadataSelectionError,
	resolveRecipeMetadataValueIds,
} from './recipe-metadata.server.ts'
import { MAX_RAW_TEXT_LENGTH, RecipeSchema } from './recipe-validation.ts'
import { RECIPE_IMPORTED } from './posthog-events.ts'
import { captureServerEvent } from './posthog.server.ts'

export async function saveImportedRecipe(
	formData: FormData,
	{ userId, householdId }: { userId: string; householdId: string },
	jsonReview = false,
) {
	// Validate every submitted row; never truncate at a count limit or a gap.
	const submission = parseWithZod(formData, {
		schema: RecipeSchema.safeExtend({
			// Truncated, never rejected: the user is saving a recipe they already
			// previewed, and rawText is a hidden provenance field they never typed.
			// A validation error on it would be an unfixable dead end.
			rawText: z
				.string()
				.transform((text) => text.slice(0, MAX_RAW_TEXT_LENGTH))
				.optional(),
		}),
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
		notes,
		recipeMetadata,
		ingredients,
		instructions,
	} = submission.value

	let recipe: { id: string }
	try {
		recipe = await prisma.$transaction(async (tx) => {
			// Whatever the review page had ticked, including the AI's suggestions:
			// ordinary selections, resolved and written only now, on this save.
			const metadataValueIds = await resolveRecipeMetadataValueIds(
				tx,
				householdId,
				recipeMetadata,
			)
			return tx.recipe.create({
				data: {
					title,
					description,
					activeTime,
					totalTime,
					yieldAmount,
					yieldLabel,
					sourceUrl: sourceUrl || null,
					rawText: rawText ?? null,
					notes: notes || null,
					userId,
					householdId,
					metadataAssignments: {
						create: metadataValueIds.map((valueId) => ({ valueId })),
					},
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
		})
	} catch (error) {
		// A classification the household does not have is the user's to fix, and
		// nothing was written. Report it against the field the chips submit, the
		// way any other validation error is reported: a form-level error reads on
		// the review page as an unknown outcome and sends them to My Recipes.
		if (error instanceof RecipeMetadataSelectionError) {
			return failure(
				'Correct the fields listed below, then save again.',
				400,
				submission.reply({ fieldErrors: { recipeMetadata: [error.message] } }),
			)
		}
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
